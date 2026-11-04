import { Router } from 'express';
import * as c from '../controllers/admin/adminController';
import { requireAdmin, requirePermission as can } from '../middlewares/adminAuth';
import { adminLoginLimiter } from '../middlewares/rateLimit';
import { validate } from '../middlewares/validate';
import * as v from '../validators';

export const adminRouter = Router();

adminRouter.post('/auth/login', adminLoginLimiter, validate({ body: v.adminLoginBody }), c.adminLogin);

adminRouter.use(requireAdmin);
adminRouter.get('/me', c.me);

adminRouter.get('/products', can('products:read'), c.listProducts);
adminRouter.post('/products', can('products:write'), validate({ body: v.productBody }), c.createProduct);
adminRouter.patch('/products/:id', can('products:write'), validate({ params: v.idParams, body: v.productPatchBody }), c.patchProduct);

adminRouter.get('/orders', can('orders:read'), validate({ query: v.pageQuery }), c.listOrders);
adminRouter.get('/orders/:id', can('orders:read'), validate({ params: v.idParams }), c.getOrder);
adminRouter.post('/orders/:id/manual-payment', can('payments:manual'), validate({ params: v.idParams, body: v.manualPaymentBody }), c.manualPayment);
adminRouter.get('/payments', can('payments:read'), validate({ query: v.pageQuery }), c.listPayments);
adminRouter.post('/payments/reconcile', can('payments:reconcile'), c.reconcileNow);

adminRouter.get('/entitlements', can('entitlements:read'), validate({ query: v.pageQuery }), c.listEntitlements);
adminRouter.get('/entitlements/:id', can('entitlements:read'), validate({ params: v.idParams }), c.getEntitlement);
adminRouter.post('/entitlements/:id/revoke', can('entitlements:revoke'), validate({ params: v.idParams, body: v.reasonBody }), c.revoke);
adminRouter.post('/entitlements/:id/recover', can('entitlements:recover'), validate({ params: v.idParams, body: v.reasonBody }), c.recover);

adminRouter.get('/activations', can('activations:read'), validate({ query: v.pageQuery }), c.listActivations);
adminRouter.get('/sessions', can('sessions:read'), validate({ query: v.pageQuery }), c.listSessions);
adminRouter.get('/sessions/:id', can('sessions:read'), validate({ params: v.idParams }), c.getSession);
adminRouter.post('/sessions/:id/terminate', can('sessions:terminate'), validate({ params: v.idParams, body: v.reasonBody }), c.terminate);

adminRouter.get('/releases', can('releases:read'), c.listReleases);
adminRouter.post('/releases', can('releases:write'), validate({ body: v.releaseBody }), c.createRelease);
adminRouter.patch('/releases/:id', can('releases:write'), validate({ params: v.idParams, body: v.releasePatchBody }), c.patchRelease);

adminRouter.get('/audit-logs', can('audit:read'), validate({ query: v.pageQuery }), c.listAudit);
adminRouter.get('/stats', can('stats:read'), c.stats);

adminRouter.get('/admins', can('admins:manage'), c.listAdmins);
adminRouter.post('/admins', can('admins:manage'), validate({ body: v.adminCreateBody }), c.createAdmin);
adminRouter.patch('/admins/:id', can('admins:manage'), validate({ params: v.adminIdParams, body: v.adminPatchBody }), c.patchAdmin);
