import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import mongoose from 'mongoose';
import { tron } from '../config';
import * as M from '../models';
import { createChallenge } from '../services/deviceProof';
import { setTronProvider } from '../services/tron/registry';
import type { ChainTransfer, TronProvider, TxLookup } from '../services/tron/types';
import { resetClock } from '../utils/clock';
import { createOrder } from '../services/orderService';
import { verifyPayment } from '../services/paymentService';
import { activationCodeFor } from '../utils/crypto';
import { activate } from '../services/activationService';

export const models = [M.Admin, M.AuditLog, M.DeviceActivation, M.Entitlement, M.Order, M.Payment, M.Product, M.Release, M.UsedNonce, M.VideoSession];

export async function connectDb() {
  await mongoose.connect(process.env.MONGODB_URI!);
  await Promise.all(models.map((m) => m.createIndexes()));
}
export async function resetDb() {
  await Promise.all(models.map((m) => m.deleteMany({})));
  setTronProvider(null);
  resetClock();
}

export async function seedProduct() {
  return M.Product.create({ _id: 'avc-standard', name: 'Standard', priceBaseUnits: '25000000', version: '0.1.0' });
}

/** Stub for the blockchain provider. Tests describe chain state; production code is unchanged. */
export class StubProvider implements TronProvider {
  readonly name = 'stub';
  txs = new Map<string, TxLookup>();
  async getTransaction(h: string): Promise<TxLookup> {
    return this.txs.get(h) ?? { state: 'not_found' };
  }
  async listIncomingTransfers() {
    return [];
  }
  add(h: string, lookup: TxLookup) {
    this.txs.set(h, lookup);
  }
}

export const hash = (n: number) => n.toString(16).padStart(64, '0');

export const goodTransfer = (amount: string, over: Partial<ChainTransfer> = {}): ChainTransfer => ({
  contractAddress: tron.usdtContract,
  from: tron.destination,
  to: tron.destination,
  amountBaseUnits: amount,
  ...over,
});

export const confirmedTx = (h: string, transfers: ChainTransfer[], ts = Date.now()): TxLookup => ({
  state: 'confirmed',
  txHash: h,
  blockTimestampMs: ts,
  blockNumber: 1,
  transfers,
});

export function makeDevice() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const signMsg = (msg: string) => sign(null, Buffer.from(msg), privateKey as KeyObject).toString('base64');
  return {
    publicKey: spki,
    signMsg,
    /** Builds a single-use challenge proof for the given purpose and context. */
    proof(purpose: 'activate' | 'activation:verify' | 'session:start', context: string) {
      const { challenge } = createChallenge(purpose);
      return { publicKey: spki, challenge, signature: signMsg(`${challenge}|${context}`) };
    },
    /** Signed-timestamp headers for in-session calls. */
    headers(action: string, sessionId: string, ts = Date.now()) {
      return { ts: String(ts), signature: signMsg(`${action}|${sessionId}|${ts}`) };
    },
  };
}

/** Creates a paid order + entitlement through the real verification path. */
export async function paidEntitlement(n = 1) {
  const stub = new StubProvider();
  setTronProvider(stub);
  const order = await createOrder('avc-standard', { type: 'customer' });
  const h = hash(n);
  stub.add(h, confirmedTx(h, [goodTransfer(order.expectedAmountBaseUnits)]));
  const out = await verifyPayment({ orderId: order._id, txHash: h, actor: { type: 'customer' } });
  const entitlementId = out.entitlementId!;
  return { stub, order, entitlementId, code: activationCodeFor(entitlementId) };
}

export async function activatedEntitlement(device = makeDevice(), n = 1) {
  const base = await paidEntitlement(n);
  await activate({ activationCode: base.code, proof: device.proof('activate', base.code.replace(/-/g, '')) });
  return { ...base, device };
}
