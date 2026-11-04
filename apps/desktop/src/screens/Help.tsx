import { Button } from '@/components/Button';
import { useAppStore } from '@/store/appStore';

export function Help() {
  const go = useAppStore((state) => state.go);
  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Help and troubleshooting</h1>
      <ul className="list-disc space-y-2 pl-5 text-slate-700">
        <li>Camera is black or missing: close other apps that use the camera, then press Try again in the preview.</li>
        <li>Camera blocked: allow desktop apps in Windows Settings &gt; Privacy &gt; Camera.</li>
        <li>Poor tracking: face a light source and keep your whole face in frame.</li>
        <li>Webcam video is processed on this computer and is not uploaded or recorded.</li>
        <li>Voice conversion is not available. The Voice screen can measure your microphone locally or pass it through unchanged to a separately installed audio cable.</li>
        <li>Background choices are local previews only until feature-code authorization is connected.</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => go('recovery')}>Recovery options</Button>
        <Button variant="secondary" onClick={() => go('privacy')}>Privacy and permissions</Button>
        <Button variant="secondary" onClick={() => go('purchase')}>Purchase or activate</Button>
      </div>
    </section>
  );
}
