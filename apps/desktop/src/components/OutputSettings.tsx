import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import { Card, CardHeader, Field, Slider, Toggle } from '@/components/ui';
import { looksLikeVirtualCable } from '@/lib/audio';
import { engine } from '@/lib/engine';
import type { StudioSettings, VirtualCameraStatus } from '@/lib/types';

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <button type="button" className="text-[#A99CFF] underline-offset-2 hover:underline" onClick={() => void window.avc?.openExternal(href).catch(() => undefined)}>
      {children}
    </button>
  );
}

/** Settings → Outputs: background, virtual camera, virtual microphone and recording. */
export function OutputSettings({ settings, set, outputs, onRefreshDevices }: {
  settings: StudioSettings;
  set: <K extends keyof StudioSettings>(key: K) => (value: StudioSettings[K]) => void;
  outputs: MediaDeviceInfo[];
  onRefreshDevices: () => void;
}) {
  const [vcam, setVcam] = useState<VirtualCameraStatus | null>(null);
  const [vcamError, setVcamError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => engine.virtualCameraStatus().then((s) => { if (alive) { setVcam(s); setVcamError(null); } }).catch((e: Error) => alive && setVcamError(e.message));
    void load();
    const timer = window.setInterval(load, 4000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const usableDriver = vcam?.backends.some((b) => b.usable) ?? false;
  const cables = outputs.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && looksLikeVirtualCable(d.label));
  const others = outputs.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && !looksLikeVirtualCable(d.label));
  const selectedMic = outputs.find((d) => d.deviceId === settings.virtual_mic_device_id);

  return (
    <Card className="pb-5 xl:col-span-2">
      <CardHeader title="Outputs" icon="studio" subtitle="Background, virtual camera, virtual microphone and recording" />
      <div className="grid gap-6 px-5 pt-4 lg:grid-cols-2">
        {/* ---------------- picture */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Picture</h3>
          <Toggle
            label="Keep the original background static"
            description="Only the person moves. The background of the uploaded picture stays exactly as it is; the area behind the person is reconstructed from its surroundings where movement reveals it."
            checked={settings.preserve_background}
            onChange={set('preserve_background')}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Output size" htmlFor="out-res" hint="Used by the virtual camera and recordings">
              <select id="out-res" className="w-full" value={settings.output_resolution} onChange={(e) => set('output_resolution')(e.target.value as StudioSettings['output_resolution'])}>
                <option value="360p">640×360</option><option value="540p">960×540</option><option value="720p">1280×720</option><option value="1080p">1920×1080</option>
              </select>
            </Field>
            <Field label="Frame rate" htmlFor="out-fps">
              <select id="out-fps" className="w-full" value={settings.output_fps} onChange={(e) => set('output_fps')(Number(e.target.value))}>
                {[15, 24, 30].map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </Field>
            <Field label="Framing" htmlFor="out-frame">
              <select id="out-frame" className="w-full" value={settings.output_framing} onChange={(e) => set('output_framing')(e.target.value as StudioSettings['output_framing'])}>
                <option value="fill">Fill 16:9 (crop around the face)</option>
                <option value="fit">Fit whole picture</option>
              </select>
            </Field>
          </div>
          <p className="text-xs text-faint">The output carries a small “AI-generated” label so people on the call know the video is synthetic.</p>
        </section>

        {/* ---------------- recording */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Recording</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Save as" htmlFor="rec-format" hint="Both can be exported later">
              <select id="rec-format" className="w-full" value={settings.recording_format} onChange={(e) => set('recording_format')(e.target.value as StudioSettings['recording_format'])}>
                <option value="mp4">MP4 (H.264 + AAC)</option>
                <option value="webm">WebM (VP8/H.264 + Opus)</option>
              </select>
            </Field>
            <Field label="Quality" htmlFor="rec-quality">
              <select id="rec-quality" className="w-full" value={settings.recording_quality} onChange={(e) => set('recording_quality')(e.target.value as StudioSettings['recording_quality'])}>
                <option value="standard">Standard</option>
                <option value="high">High (larger files)</option>
              </select>
            </Field>
          </div>
          <p className="text-xs text-faint">Recordings contain the animated avatar and the converted voice only, never the raw webcam or microphone. When MP4 cannot be recorded directly, it is converted from WebM after you stop (this takes a while for long recordings on slower PCs).</p>
        </section>

        {/* ---------------- virtual camera */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Virtual camera</h3>
            <StatusPill tone={vcam?.active ? 'ok' : usableDriver ? 'info' : 'warn'} label={vcam?.active ? `On · ${vcam.device} · ${vcam.output_fps} fps` : usableDriver ? 'Driver found' : vcam ? 'No driver installed' : 'Checking…'} />
          </div>
          <ul className="space-y-1.5">
            {(vcam?.backends ?? []).map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-xs">
                <Icon name={b.usable ? 'check' : 'alert'} className={`h-4 w-4 ${b.usable ? 'text-ok' : 'text-faint'}`} />
                <span className={b.usable ? 'text-text' : 'text-muted'}>{b.label}</span>
                <span className="text-faint">{b.usable ? 'installed' : b.installed ? 'installed, but the Python bridge is missing' : 'not installed'}</span>
              </li>
            ))}
          </ul>
          {vcamError && <p className="text-xs text-bad">{vcamError}</p>}
          {vcam?.last_error && <p className="rounded-lg bg-bad/10 p-2 text-xs text-bad">{vcam.last_error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Driver" htmlFor="vcam-backend">
              <select id="vcam-backend" className="w-full" value={settings.virtual_camera_backend} onChange={(e) => set('virtual_camera_backend')(e.target.value as StudioSettings['virtual_camera_backend'])}>
                <option value="auto">Automatic</option>
                <option value="obs">OBS Virtual Camera</option>
                <option value="unitycapture">Unity Capture</option>
              </select>
            </Field>
          </div>
          <Toggle label="Turn on when the studio opens" checked={settings.virtual_camera_autostart} onChange={set('virtual_camera_autostart')} />
          {!usableDriver && (
            <div className="rounded-lg border border-line bg-raised/60 p-3 text-xs text-muted">
              <p className="mb-1 font-semibold text-text">Install one camera driver (one time, needs administrator rights):</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  <ExternalLink href="https://obsproject.com/download">OBS Studio</ExternalLink> (includes “OBS Virtual Camera”; OBS does not need to be running), or
                </li>
                <li>
                  <ExternalLink href="https://github.com/schellingb/UnityCapture">Unity Capture</ExternalLink>: run <code>Install.bat</code> from its <code>Install</code> folder as administrator.
                </li>
              </ol>
              <p className="mt-2">Then restart call apps so they list the new camera.</p>
            </div>
          )}
          <p className="text-xs text-faint">
            Windows 10 has no built-in way for apps to create a camera, so the avatar is sent through one of these DirectShow drivers. Apps that read cameras only through Media Foundation (for example the Windows Camera app) do not list DirectShow cameras. Check each call app; see the compatibility table in the README.
          </p>
        </section>

        {/* ---------------- virtual microphone */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Virtual microphone</h3>
            <StatusPill tone={settings.virtual_mic_device_id ? (selectedMic ? 'ok' : 'warn') : cables.length ? 'info' : 'warn'} label={settings.virtual_mic_device_id ? (selectedMic ? 'On' : 'Device missing') : cables.length ? 'Cable found' : 'No virtual cable'} />
          </div>
          <Field label="Send the converted voice to" htmlFor="vmic-device" hint="Then choose the cable's other end (e.g. “CABLE Output”) as the microphone in the call app">
            <select id="vmic-device" className="w-full" value={settings.virtual_mic_device_id ?? ''} onChange={(e) => set('virtual_mic_device_id')(e.target.value || null)}>
              <option value="">Off</option>
              {cables.length > 0 && <optgroup label="Virtual cables">{cables.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Other outputs">{others.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>)}</optgroup>}
            </select>
          </Field>
          <Slider
            id="vmic-delay"
            label="Extra delay (align with the virtual camera)"
            value={settings.virtual_mic_delay_ms}
            min={0}
            max={400}
            step={10}
            onChange={set('virtual_mic_delay_ms')}
            format={(v) => `${v} ms`}
          />
          {!cables.length && (
            <div className="rounded-lg border border-line bg-raised/60 p-3 text-xs text-muted">
              <p className="mb-1 font-semibold text-text">Install a virtual audio cable (one time):</p>
              <p>
                <ExternalLink href="https://vb-audio.com/Cable/">VB-CABLE</ExternalLink> adds “CABLE Input” (select it here) and “CABLE Output” (select it as the microphone in WhatsApp, Zoom, Meet, Teams…). Device names appear here after microphone permission was granted in the studio.
              </p>
            </div>
          )}
          <p className="text-xs text-faint">
            Only the converted voice is sent; while conversion is off or muted the virtual microphone is silent. Your raw microphone is never passed through. If lips look early or late in the call, adjust the extra delay.
          </p>
          <Button size="sm" variant="ghost" onClick={onRefreshDevices}>Refresh devices</Button>
        </section>
      </div>
    </Card>
  );
}
