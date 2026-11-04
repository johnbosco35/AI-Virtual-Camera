import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { StatusPill } from '@/components/StatusPill';
import { native } from '@/lib/native';
import { useAppStore } from '@/store/appStore';
import type { VirtualCameraStatus } from '@shared/schemas';

export function VirtualCamera() {
  const go = useAppStore((state) => state.go);
  const [status, setStatus] = useState<VirtualCameraStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void native.getVirtualCameraStatus().then(setStatus).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Virtual camera status could not be checked.');
    });
  };
  useEffect(refresh, []);

  const tone = status?.state === 'running' || status?.state === 'installed' ? 'ok' : error ? 'bad' : 'warn';
  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Virtual camera</h1>
      <div className="space-y-3 rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <span className="font-medium">Component status</span>
          <StatusPill tone={tone} label={status?.state ?? (error ? 'Error' : 'Checking')} />
        </div>
        <p className="text-sm text-slate-600">{status?.detail ?? 'Checking the native camera component…'}</p>
        <p className="text-sm text-slate-600">Version and repair controls are unavailable because the native camera component has not been built or connected.</p>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <Button variant="secondary" onClick={refresh}>Refresh status</Button>
      </div>
      <p className="text-sm text-slate-600">The animated avatar preview works inside this app. It cannot yet be selected in a video-call application.</p>
      <Button variant="secondary" onClick={() => go('preview')}>Back to camera preview</Button>
    </section>
  );
}
