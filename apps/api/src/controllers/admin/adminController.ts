import type { Request } from 'express';
import { Admin, AuditLog, DeviceActivation, Entitlement, Order, Payment, Product, Release, VideoSession, effectivePermissions } from '../../models';
import { audit, type Actor } from '../../services/auditService';
import { hashPassword, login } from '../../services/adminAuthService';
import { recoverDevice, revokeEntitlement } from '../../services/entitlementService';
import { reconcilePayments, verifyPayment } from '../../services/paymentService';
import { terminateSession } from '../../services/sessionService';
import { asyncHandler } from '../../utils/asyncHandler';
import { now } from '../../utils/clock';
import { AppError, isDuplicateKeyError } from '../../utils/errors';
import { parseDecimalToBaseUnits } from '../../utils/money';

const actorOf = (req: Request): Actor => ({ type: 'admin', id: req.admin?.id, ip: req.ip });

function paging(req: Request) {
  const q = req.query as unknown as { page: number; limit: number; status?: string };
  return { skip: (q.page - 1) * q.limit, limit: q.limit, status: q.status, page: q.page };
}

export const adminLogin = asyncHandler(async (req, res) => {
  res.json(await login(req.body.email, req.body.password, { type: 'admin', ip: req.ip }));
});

export const me = asyncHandler(async (req, res) => {
  res.json({ id: req.admin!.id, email: req.admin!.email, permissions: [...req.admin!.permissions] });
});

// ---- products ----
export const listProducts = asyncHandler(async (_req, res) => {
  res.json({ products: await Product.find().sort({ createdAt: -1 }) });
});
export const createProduct = asyncHandler(async (req, res) => {
  const { id, priceUsdt, ...rest } = req.body;
  try {
    const p = await Product.create({ _id: id, priceBaseUnits: parseDecimalToBaseUnits(priceUsdt).toString(), ...rest });
    await audit({ actor: actorOf(req), action: 'product.created', targetType: 'Product', targetId: id, metadata: { priceUsdt } });
    res.status(201).json(p);
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError(409, 'PRODUCT_EXISTS', 'A product with this id already exists.');
    throw e;
  }
});
export const patchProduct = asyncHandler(async (req, res) => {
  const { priceUsdt, ...rest } = req.body;
  const update: Record<string, unknown> = { ...rest };
  if (priceUsdt) update.priceBaseUnits = parseDecimalToBaseUnits(priceUsdt).toString();
  const p = await Product.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
  if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  await audit({ actor: actorOf(req), action: 'product.updated', targetType: 'Product', targetId: p._id, metadata: req.body });
  res.json(p);
});

// ---- orders & payments ----
export const listOrders = asyncHandler(async (req, res) => {
  const { skip, limit, status, page } = paging(req);
  const filter = status ? { status } : {};
  const [items, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Order.countDocuments(filter)]);
  res.json({ items, total, page });
});
export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const [payment, entitlement] = await Promise.all([Payment.findOne({ orderId: order._id }), Entitlement.findOne({ orderId: order._id })]);
  res.json({ order, payment, entitlement });
});
export const listPayments = asyncHandler(async (req, res) => {
  const { skip, limit, page } = paging(req);
  const [items, total] = await Promise.all([Payment.find().sort({ createdAt: -1 }).skip(skip).limit(limit), Payment.countDocuments()]);
  res.json({ items, total, page });
});
export const reconcileNow = asyncHandler(async (req, res) => {
  const result = await reconcilePayments(actorOf(req));
  await audit({ actor: actorOf(req), action: 'payments.reconcile_triggered', metadata: result });
  res.json(result);
});
/** Manual correction still verifies the transaction on chain. It cannot mark anything paid by assertion. */
export const manualPayment = asyncHandler(async (req, res) => {
  const actor = actorOf(req);
  await audit({ actor, action: 'payment.manual_correction_attempt', targetType: 'Order', targetId: req.params.id, severity: 'warn', metadata: { txHash: req.body.txHash, reason: req.body.reason } });
  const outcome = await verifyPayment({ orderId: req.params.id, txHash: req.body.txHash, actor, ignoreExpiry: true });
  res.json(outcome);
});

// ---- entitlements, activations, sessions ----
export const listEntitlements = asyncHandler(async (req, res) => {
  const { skip, limit, status, page } = paging(req);
  const filter = status ? { status } : {};
  const [items, total] = await Promise.all([Entitlement.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Entitlement.countDocuments(filter)]);
  res.json({ items, total, page });
});
export const getEntitlement = asyncHandler(async (req, res) => {
  const ent = await Entitlement.findById(req.params.id);
  if (!ent) throw new AppError(404, 'ENTITLEMENT_NOT_FOUND', 'Entitlement not found.');
  const [activations, sessions] = await Promise.all([DeviceActivation.find({ entitlementId: ent._id }, { publicKey: 0 }), VideoSession.find({ entitlementId: ent._id })]);
  res.json({ entitlement: ent, activations, sessions });
});
export const revoke = asyncHandler(async (req, res) => {
  res.json(await revokeEntitlement(req.params.id, req.body.reason, actorOf(req)));
});
export const recover = asyncHandler(async (req, res) => {
  res.json(await recoverDevice(req.params.id, req.body.reason, actorOf(req)));
});
export const listActivations = asyncHandler(async (req, res) => {
  const { skip, limit, page } = paging(req);
  const [items, total] = await Promise.all([DeviceActivation.find({}, { publicKey: 0 }).sort({ createdAt: -1 }).skip(skip).limit(limit), DeviceActivation.countDocuments()]);
  res.json({ items, total, page });
});
export const listSessions = asyncHandler(async (req, res) => {
  const { skip, limit, status, page } = paging(req);
  const filter = status ? { status } : {};
  const [items, total] = await Promise.all([VideoSession.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit), VideoSession.countDocuments(filter)]);
  res.json({ items, total, page });
});
export const getSession = asyncHandler(async (req, res) => {
  const s = await VideoSession.findById(req.params.id);
  if (!s) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found (it may have been cleaned up).');
  res.json(s);
});
export const terminate = asyncHandler(async (req, res) => {
  const s = await terminateSession(req.params.id, 'admin_terminated');
  if (!s) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  await audit({ actor: actorOf(req), action: 'session.admin_terminated', targetType: 'VideoSession', targetId: s._id, severity: 'warn', metadata: { reason: req.body.reason } });
  res.json(s);
});

// ---- releases ----
export const listReleases = asyncHandler(async (_req, res) => {
  res.json({ releases: await Release.find().sort({ createdAt: -1 }) });
});
export const createRelease = asyncHandler(async (req, res) => {
  try {
    const r = await Release.create(req.body);
    await audit({ actor: actorOf(req), action: 'release.created', targetType: 'Release', targetId: r._id.toString(), metadata: { version: r.version, sha256: r.sha256 } });
    res.status(201).json(r);
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError(409, 'RELEASE_EXISTS', 'That version already exists.');
    throw e;
  }
});
export const patchRelease = asyncHandler(async (req, res) => {
  const r = await Release.findByIdAndUpdate(req.params.id, { $set: { active: req.body.active } }, { new: true });
  if (!r) throw new AppError(404, 'RELEASE_NOT_FOUND', 'Release not found.');
  await audit({ actor: actorOf(req), action: 'release.updated', targetType: 'Release', targetId: r._id.toString(), metadata: req.body });
  res.json(r);
});

// ---- audit & stats ----
export const listAudit = asyncHandler(async (req, res) => {
  const { skip, limit, page } = paging(req);
  const q = req.query as unknown as { status?: string };
  const filter = q.status ? { severity: q.status } : {};
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit), AuditLog.countDocuments(filter)]);
  res.json({ items, total, page });
});
export const stats = asyncHandler(async (_req, res) => {
  const since = new Date(now().getTime() - 24 * 3600_000);
  const [orders, paid24h, activeSessions, consumed, revoked, securityEvents24h] = await Promise.all([
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.countDocuments({ status: 'paid', paidAt: { $gte: since } }),
    VideoSession.countDocuments({ status: 'active' }),
    Entitlement.countDocuments({ 'session.consumed': true }),
    Entitlement.countDocuments({ status: 'revoked' }),
    AuditLog.countDocuments({ severity: 'security', at: { $gte: since } }),
  ]);
  res.json({ ordersByStatus: Object.fromEntries(orders.map((o) => [o._id, o.count])), paid24h, activeSessions, entitlementsConsumed: consumed, entitlementsRevoked: revoked, securityEvents24h });
});

// ---- admin management ----
export const listAdmins = asyncHandler(async (_req, res) => {
  const admins = await Admin.find({}, { passwordHash: 0 });
  res.json({ admins: admins.map((a) => ({ id: a._id, email: a.email, role: a.role, status: a.status, lastLoginAt: a.lastLoginAt, permissions: [...effectivePermissions(a)] })) });
});
export const createAdmin = asyncHandler(async (req, res) => {
  try {
    const a = await Admin.create({ ...req.body, passwordHash: await hashPassword(req.body.password) });
    await audit({ actor: actorOf(req), action: 'admin.created', targetType: 'Admin', targetId: a._id.toString(), severity: 'warn', metadata: { role: a.role } });
    res.status(201).json({ id: a._id, email: a.email, role: a.role });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError(409, 'ADMIN_EXISTS', 'An administrator with this email already exists.');
    throw e;
  }
});
export const patchAdmin = asyncHandler(async (req, res) => {
  if (req.params.id === req.admin!.id) throw new AppError(409, 'SELF_EDIT', 'You cannot change your own role or status.');
  const a = await Admin.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!a) throw new AppError(404, 'ADMIN_NOT_FOUND', 'Administrator not found.');
  await audit({ actor: actorOf(req), action: 'admin.updated', targetType: 'Admin', targetId: a._id.toString(), severity: 'warn', metadata: req.body });
  res.json({ id: a._id, email: a.email, role: a.role, status: a.status });
});
