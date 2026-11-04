import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DeviceActivation, Entitlement } from '../models';
import { activate, verifyActivation } from '../services/activationService';
import { recoverDevice, revokeEntitlement } from '../services/entitlementService';
import { activationCodeFor } from '../utils/crypto';
import { connectDb, makeDevice, paidEntitlement, resetDb, seedProduct } from './helpers';

const norm = (c: string) => c.replace(/-/g, '');
beforeAll(connectDb);
beforeEach(async () => {
  await resetDb();
  await seedProduct();
});

describe('device binding', () => {
  it('binds the first device and is idempotent for the same key (reinstall path)', async () => {
    const { code, entitlementId } = await paidEntitlement();
    const device = makeDevice();
    const first = await activate({ activationCode: code, proof: device.proof('activate', norm(code)) });
    const again = await activate({ activationCode: code, proof: device.proof('activate', norm(code)) });
    expect(first.bound && again.bound).toBe(true);
    expect(await DeviceActivation.countDocuments({ entitlementId, status: 'active' })).toBe(1);
  });

  it('refuses a different device and does not rebind', async () => {
    const { code, entitlementId } = await paidEntitlement();
    const a = makeDevice();
    const b = makeDevice();
    await activate({ activationCode: code, proof: a.proof('activate', norm(code)) });
    await expect(activate({ activationCode: code, proof: b.proof('activate', norm(code)) })).rejects.toMatchObject({ code: 'DEVICE_MISMATCH' });
    const ent = await Entitlement.findById(entitlementId);
    expect(ent!.binding.deviceFingerprint).not.toBeNull();
    expect(await DeviceActivation.countDocuments({ entitlementId })).toBe(1);
  });

  it('lets exactly one of two racing devices win', async () => {
    const { code } = await paidEntitlement();
    const results = await Promise.allSettled([makeDevice(), makeDevice()].map((d) => activate({ activationCode: code, proof: d.proof('activate', norm(code)) })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects bad signatures, wrong context and replayed challenges', async () => {
    const { code } = await paidEntitlement();
    const device = makeDevice();
    const wrongContext = device.proof('activate', 'SOMETHING-ELSE');
    await expect(activate({ activationCode: code, proof: wrongContext })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });

    const good = device.proof('activate', norm(code));
    await activate({ activationCode: code, proof: good });
    await expect(activate({ activationCode: code, proof: good })).rejects.toMatchObject({ code: 'CHALLENGE_REPLAY' });
  });

  it('rejects unknown activation codes', async () => {
    await paidEntitlement();
    const device = makeDevice();
    const fake = activationCodeFor('ent_doesnotexist');
    await expect(activate({ activationCode: fake, proof: device.proof('activate', norm(fake)) })).rejects.toMatchObject({ code: 'INVALID_ACTIVATION_CODE' });
  });

  it('verifyActivation only succeeds for the bound device', async () => {
    const { code } = await paidEntitlement();
    const a = makeDevice();
    const b = makeDevice();
    await activate({ activationCode: code, proof: a.proof('activate', norm(code)) });
    await expect(verifyActivation({ activationCode: code, proof: a.proof('activation:verify', norm(code)) })).resolves.toMatchObject({ bound: true });
    await expect(verifyActivation({ activationCode: code, proof: b.proof('activation:verify', norm(code)) })).rejects.toMatchObject({ code: 'DEVICE_NOT_BOUND' });
  });

  it('admin recovery rebinds an unused entitlement and is refused after the session is used', async () => {
    const { code, entitlementId } = await paidEntitlement();
    const a = makeDevice();
    const b = makeDevice();
    await activate({ activationCode: code, proof: a.proof('activate', norm(code)) });
    await recoverDevice(entitlementId, 'Customer replaced their PC, identity verified', { type: 'admin', id: 'adm1' });
    await expect(activate({ activationCode: code, proof: b.proof('activate', norm(code)) })).resolves.toMatchObject({ bound: true });

    await Entitlement.updateOne({ _id: entitlementId }, { $set: { 'session.consumed': true } });
    await expect(recoverDevice(entitlementId, 'Trying to get another session', { type: 'admin', id: 'adm1' })).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
  });

  it('revoked entitlements cannot activate', async () => {
    const { code, entitlementId } = await paidEntitlement();
    await revokeEntitlement(entitlementId, 'Chargeback investigation, test case', { type: 'admin', id: 'adm1' });
    const d = makeDevice();
    await expect(activate({ activationCode: code, proof: d.proof('activate', norm(code)) })).rejects.toMatchObject({ code: 'ENTITLEMENT_REVOKED' });
  });
});
