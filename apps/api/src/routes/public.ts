import { Router } from 'express';
import mongoose from 'mongoose';
import { verifyTtlIndex } from '../jobs/maintenance';
import * as c from '../controllers/publicController';
import { activationLimiter, orderLimiter, paymentVerifyLimiter, sessionLimiter } from '../middlewares/rateLimit';
import { validate } from '../middlewares/validate';
import * as v from '../validators';

export const publicRouter = Router();

publicRouter.get('/health', (_req, res) => res.json({ ok: true }));
// Readiness for load balancers and uptime monitors: database up AND the TTL index present.
publicRouter.get('/health/ready', async (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  const ttl = dbUp ? await verifyTtlIndex().catch(() => false) : false;
  res.status(dbUp && ttl ? 200 : 503).json({ db: dbUp, ttlIndex: ttl });
});
publicRouter.get('/products', c.listProducts);

publicRouter.post('/orders', orderLimiter, validate({ body: v.createOrderBody }), c.postOrder);
publicRouter.get('/orders/:orderId', validate({ params: v.orderIdParams }), c.getOrder);
publicRouter.post('/payments/verify', paymentVerifyLimiter, validate({ body: v.verifyPaymentBody }), c.postVerifyPayment);

publicRouter.get('/entitlements/:entitlementId', activationLimiter, validate({ params: v.entitlementParams }), c.getEntitlement);
publicRouter.post('/devices/challenge', activationLimiter, validate({ body: v.challengeBody }), c.postChallenge);
publicRouter.post('/activations', activationLimiter, validate({ body: v.activationBody }), c.postActivation);
publicRouter.post('/activations/verify', activationLimiter, validate({ body: v.activationBody }), c.postActivationVerify);

publicRouter.post('/sessions/start', sessionLimiter, validate({ body: v.startSessionBody }), c.postSessionStart);
publicRouter.get('/sessions/:sessionId', sessionLimiter, validate({ params: v.sessionParams }), c.getSessionById);
publicRouter.post('/sessions/:sessionId/heartbeat', sessionLimiter, validate({ params: v.sessionParams }), c.postHeartbeat);
publicRouter.post('/sessions/:sessionId/end', sessionLimiter, validate({ params: v.sessionParams }), c.postSessionEnd);

publicRouter.get('/releases/latest', c.getLatestRelease);
publicRouter.post('/downloads', orderLimiter, validate({ body: v.downloadBody }), c.postDownload);
publicRouter.get('/downloads/:token', orderLimiter, validate({ params: v.downloadParams }), c.getDownload);
