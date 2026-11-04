import { useState } from 'react';
import { Button } from '@/components/Button';
import { activate } from '@/services/license';
import { useAppStore } from '@/store/appStore';

export function Activate() {
  const { fingerprint, entitlement, setEntitlement, go } = useAppStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!fingerprint) return setError('Device could not be verified. Restart the app and try again.');
    setBusy(true);
    setError(null);
    try {
      setEntitlement(await activate(code.trim().toUpperCase(), fingerprint));
      go('preview');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Activation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold">Activate this computer</h1>
      <p className="text-slate-600">
        Enter the code from your purchase. One purchase covers this device and one session of up to 15 minutes.
      </p>
      {entitlement.status !== 'none' ? (
        <p className="rounded-md bg-ok/10 p-3 text-sm text-ok">Activated. You can continue to the camera preview.</p>
      ) : (
        <>
          <label className="block text-sm font-medium" htmlFor="code">Activation code</label>
          <input
            id="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono tracking-wider"
            autoComplete="off"
            spellCheck={false}
          />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button onClick={() => void submit()} disabled={busy || code.length < 19}>
            {busy ? 'Verifying…' : 'Activate'}
          </Button>
          <p className="text-xs text-slate-500">Mock mode: any code like AB12-CD34-EF56-GH78 works until the backend exists.</p>
        </>
      )}
    </section>
  );
}
