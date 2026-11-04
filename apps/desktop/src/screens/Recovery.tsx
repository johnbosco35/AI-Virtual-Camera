import { Button } from '@/components/Button';
import { useAppStore } from '@/store/appStore';

export function Recovery() {
  const go = useAppStore((state) => state.go);
  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Errors and recovery</h1>
      <p className="text-slate-600">Choose the issue that best matches what you see. The app does not have a backend connection monitor or a device-repair service in this build.</p>
      <div className="space-y-3">
        <article className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-semibold">Camera unplugged or unavailable</h2>
          <p className="mt-1 text-sm text-slate-600">Reconnect the camera, close other apps using it, then retry from Camera preview.</p>
          <button type="button" className="mt-2 text-sm underline" onClick={() => go('preview')}>Open camera preview</button>
        </article>
        <article className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-semibold">Face tracking model failed</h2>
          <p className="mt-1 text-sm text-slate-600">Restart the app. The bundled model and WebAssembly runtime are loaded locally; no runtime download is required.</p>
        </article>
        <article className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
          <h2 className="font-semibold">Activation or session conflict</h2>
          <p className="mt-1 text-sm text-slate-600">This build uses a mock licensing service and cannot report a real server conflict. Review the current activation state or contact support.</p>
          <button type="button" className="mt-2 text-sm underline" onClick={() => go('activate')}>Open activation</button>
        </article>
      </div>
      <Button variant="secondary" onClick={() => go('help')}>General help</Button>
    </section>
  );
}
