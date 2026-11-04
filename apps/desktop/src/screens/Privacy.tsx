import { Button } from '@/components/Button';
import { useAppStore } from '@/store/appStore';

export function Privacy() {
  const go = useAppStore((state) => state.go);
  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Privacy and permissions</h1>
      <div className="space-y-4 rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <section>
          <h2 className="font-semibold">Processed on this PC</h2>
          <p className="mt-1 text-sm text-slate-600">Webcam frames, face landmarks, tracking results, and any selected avatar picture are handled locally in memory. This app does not save or upload them.</p>
        </section>
        <section>
          <h2 className="font-semibold">What licensing can see</h2>
          <p className="mt-1 text-sm text-slate-600">The licensing service receives activation and session requests and a hashed device fingerprint. It does not receive webcam frames, avatar pictures, or face landmarks.</p>
        </section>
        <section>
          <h2 className="font-semibold">Camera permissions</h2>
          <p className="mt-1 text-sm text-slate-600">Allow camera and microphone access for desktop apps in Windows Settings → Privacy & security. Microphone input is analyzed locally for its level; optional cable passthrough sends the unmodified microphone signal to the output you choose. Voice conversion and personal-voice enrollment are unavailable.</p>
        </section>
        <section>
          <h2 className="font-semibold">Background images</h2>
          <p className="mt-1 text-sm text-slate-600">A custom background is decoded and held in memory on this PC. Delete it from the Background screen; it is not uploaded. Background replacement is a preview only until feature-code authorization is connected.</p>
        </section>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => go('camera')}>Camera settings</Button>
        <Button variant="secondary" onClick={() => go('help')}>Help</Button>
      </div>
    </section>
  );
}
