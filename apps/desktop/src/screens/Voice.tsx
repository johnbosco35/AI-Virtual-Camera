import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { useMicrophone } from '@/hooks/useMicrophone';
import { useAppStore } from '@/store/appStore';

export function Voice() {
  const microphone = useMicrophone();
  const entitlement = useAppStore((state) => state.entitlement);
  const [cableConfirmed, setCableConfirmed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (entitlement.status !== 'active') {
      microphone.stop();
      return;
    }
    const expiresAt = entitlement.expiresAt - entitlement.serverOffsetMs;
    const interval = window.setInterval(() => {
      if (Date.now() >= expiresAt) {
        microphone.stop();
        window.clearInterval(interval);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [entitlement, microphone.stop]);

  const enableMicrophone = async () => {
    setActionError(null);
    try {
      await microphone.start();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Microphone could not be started.');
    }
  };

  const startPassthrough = async () => {
    setActionError(null);
    try {
      if (entitlement.status !== 'active' || Date.now() >= entitlement.expiresAt - entitlement.serverOffsetMs) {
        throw new Error('Start an active video session before routing microphone audio.');
      }
      await microphone.routeToSelectedOutput();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Microphone could not be routed.');
    }
  };

  const outputsSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

  return (
    <section className="max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Voice and microphone</h1>
        <p className="mt-1 text-slate-600">Choose and test your microphone. Voice conversion and personal voice enrollment are not available.</p>
      </header>

      <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Voice add-on not verified.</strong> The licensing service is not connected to this screen, and no conversion model is bundled.
        Audio here is only monitored locally or passed through unchanged; this is not voice conversion.
      </div>

      <section className="space-y-4 rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Microphone</h2>
            <p className="text-sm text-slate-600">The input meter is computed locally. Microphone audio is not saved or uploaded; passthrough has no app-level voice effects.</p>
          </div>
          <span
            role="status"
            className={`rounded-full px-3 py-1 text-sm font-medium ${microphone.active ? 'bg-ok/10 text-ok' : 'bg-slate-100 text-slate-700'}`}
          >
            {microphone.routing ? 'Mic passthrough ON' : microphone.active ? 'Microphone monitoring ON' : 'Microphone off'}
          </span>
        </div>

        <div>
          <label htmlFor="microphone-device" className="mb-1 block text-sm font-medium">Input device</label>
          <select
            id="microphone-device"
            value={microphone.microphoneDeviceId ?? ''}
            disabled={microphone.active}
            onChange={(event) => microphone.setMicrophoneDeviceId(event.target.value || null)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
          >
            <option value="">Default microphone</option>
            {microphone.inputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium">Input level</span>
            <span>{microphone.active ? `${Math.round(microphone.level * 100)}%` : 'Start microphone to measure'}</span>
          </div>
          <div
            role="meter"
            aria-label="Microphone input level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(microphone.level * 100)}
            className="h-3 overflow-hidden rounded-full bg-slate-200"
          >
            <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${microphone.level * 100}%` }} />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {microphone.active ? (
            <>
              <Button variant="secondary" onClick={() => microphone.setMuted(!microphone.muted)}>
                {microphone.muted ? 'Unmute microphone' : 'Mute microphone'}
              </Button>
              <Button variant="secondary" onClick={microphone.stop}>Stop microphone</Button>
            </>
          ) : (
            <Button onClick={() => void enableMicrophone()}>Enable microphone</Button>
          )}
        </div>
        {microphone.muted && <p role="status" className="text-sm font-medium text-warn">Microphone muted</p>}
      </section>

      <section className="space-y-4 rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <div>
          <h2 className="font-semibold">Virtual audio cable (unchanged voice)</h2>
          <p className="mt-1 text-sm text-slate-600">
            This app does not include or license a virtual audio cable. Install and license one separately. Choose its playback/input endpoint below;
            in your call app, select that cable’s recording/output endpoint as the microphone.
          </p>
        </div>
        {!outputsSupported && (
          <p role="status" className="rounded bg-slate-100 p-3 text-sm text-slate-700">
            This runtime cannot select audio output devices, so cable routing is unavailable here.
          </p>
        )}
        <div>
          <label htmlFor="audio-output" className="mb-1 block text-sm font-medium">Cable playback endpoint</label>
          <select
            id="audio-output"
            value={microphone.audioOutputDeviceId ?? ''}
            disabled={microphone.routing}
            onChange={(event) => microphone.setAudioOutputDeviceId(event.target.value || null)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
          >
            <option value="">Choose an audio output</option>
            {microphone.outputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Audio output ${index + 1}`}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={cableConfirmed}
            onChange={(event) => setCableConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I have installed and licensed the selected virtual audio cable. I understand this sends my microphone unchanged.</span>
        </label>
        {microphone.routing ? (
          <Button variant="danger" onClick={microphone.stopRouting}>Stop mic passthrough</Button>
        ) : (
          <Button
            onClick={() => void startPassthrough()}
            disabled={!cableConfirmed || !microphone.audioOutputDeviceId || !outputsSupported}
          >
            Start unchanged mic passthrough
          </Button>
        )}
      </section>

      {(microphone.error || actionError) && (
        <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">{actionError ?? microphone.error}</p>
      )}
      {entitlement.status === 'active' && (
        <p className="text-xs text-slate-500">
          Leaving this screen stops microphone capture and cable routing. End the video session to release all media capture.
        </p>
      )}
      <p className="text-xs text-slate-500">
        Voice conversion, AI voice disclosure, and personal-voice enrollment remain unavailable. Personal voices are deliberately deferred.
      </p>
    </section>
  );
}
