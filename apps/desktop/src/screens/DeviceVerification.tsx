import { useEffect, useState } from 'react';
import { StatusPill } from '@/components/StatusPill';
import { native } from '@/lib/native';
import { useAppStore } from '@/store/appStore';

export function DeviceVerification() {
  const { fingerprint, setFingerprint, entitlement } = useAppStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void native.getDeviceFingerprint()
      .then(({ fingerprint: value }) => {
        if (active) {
          setFingerprint(value);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Device fingerprint could not be read.');
      });
    return () => { active = false; };
  }, [setFingerprint]);

  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Device verification</h1>
      <p className="text-slate-600">This fingerprint is calculated locally and is used by the licensing service to associate an activation with this computer.</p>
      <div className="space-y-3 rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Local device fingerprint</span>
          <StatusPill tone={fingerprint ? 'ok' : error ? 'bad' : 'idle'} label={fingerprint ? 'Available' : error ? 'Unavailable' : 'Checking'} />
        </div>
        {fingerprint && <code className="block break-all rounded bg-slate-100 p-3 text-xs">{fingerprint}</code>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <p className="text-sm text-slate-600">
          {entitlement.status === 'none'
            ? 'This app build does not verify a device binding with the backend. No bound/unbound or last-verified status is available.'
            : 'An activation is present locally, but this build does not confirm the binding with the backend.'}
        </p>
      </div>
    </section>
  );
}
