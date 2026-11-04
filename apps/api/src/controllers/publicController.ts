import type { Request, Response } from 'express';
import fs from 'node:fs';
import { tron } from '../config';
import { Product } from '../models';
import * as activation from '../services/activationService';
import { createChallenge } from '../services/deviceProof';
import { getEntitlementView } from '../services/entitlementService';
import { createOrder, getOrderView } from '../services/orderService';
import { verifyPayment } from '../services/paymentService';
import { issueDownload, latestRelease, openDownload } from '../services/releaseService';
import * as sessions from '../services/sessionService';
import { asyncHandler } from '../utils/asyncHandler';
import { formatBaseUnits } from '../utils/money';

const actorOf = (req: Request) => ({ type: 'customer' as const, ip: req.ip });
const deviceHeaders = (req: Request) => ({ ts: req.header('x-avc-ts'), sig: req.header('x-avc-sig') });

export const listProducts = asyncHandler(async (_req, res) => {
  const products = await Product.find({ active: true });
  res.json({
    products: products.map((p) => ({
      id: p._id,
      name: p.name,
      version: p.version,
      price: formatBaseUnits(BigInt(p.priceBaseUnits)), // before the per-order unique suffix
      currency: 'USDT',
      network: 'TRON',
      token: 'USDT (TRC-20)',
      tokenContract: tron.usdtContract,
      grants: { devices: 1, sessions: 1, sessionSeconds: p.entitlementConfig?.sessionSeconds ?? 900 },
    })),
  });
});

export const postOrder = asyncHandler(async (req, res) => {
  const order = await createOrder(req.body.productId, actorOf(req));
  res.status(201).json(await getOrderView(order._id));
});

export const getOrder = asyncHandler(async (req, res) => {
  res.json(await getOrderView(req.params.orderId));
});

export const postVerifyPayment = asyncHandler(async (req, res) => {
  const outcome = await verifyPayment({ orderId: req.body.orderId, txHash: req.body.txHash, actor: actorOf(req) });
  res.json({ ...outcome, order: await getOrderView(req.body.orderId) });
});

export const getEntitlement = asyncHandler(async (req, res) => {
  res.json(await getEntitlementView(req.params.entitlementId, req.header('x-activation-code')));
});

export const postChallenge = asyncHandler(async (req, res) => {
  res.json(createChallenge(req.body.purpose));
});

export const postActivation = asyncHandler(async (req, res) => {
  res.json(await activation.activate(req.body));
});
export const postActivationVerify = asyncHandler(async (req, res) => {
  res.json(await activation.verifyActivation(req.body));
});

export const postSessionStart = asyncHandler(async (req, res) => {
  const out = await sessions.startSession(req.body);
  res.status(out.resumed ? 200 : 201).json(out);
});
export const getSessionById = asyncHandler(async (req, res) => {
  const { ts, sig } = deviceHeaders(req);
  res.json(await sessions.getSession(req.params.sessionId, ts, sig));
});
export const postHeartbeat = asyncHandler(async (req, res) => {
  const { ts, sig } = deviceHeaders(req);
  res.json(await sessions.heartbeat(req.params.sessionId, ts, sig));
});
export const postSessionEnd = asyncHandler(async (req, res) => {
  const { ts, sig } = deviceHeaders(req);
  res.json(await sessions.endSession(req.params.sessionId, ts, sig));
});

export const getLatestRelease = asyncHandler(async (_req, res) => {
  res.json(await latestRelease());
});
export const postDownload = asyncHandler(async (req, res) => {
  res.json(await issueDownload(req.body.orderId, actorOf(req)));
});
export const getDownload = asyncHandler(async (req: Request, res: Response) => {
  const { file, filename, sha256 } = await openDownload(req.params.token, actorOf(req));
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`);
  res.setHeader('X-Content-SHA256', sha256);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});
