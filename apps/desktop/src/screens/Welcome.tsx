import { Button } from '@/components/Button';
import { useAppStore } from '@/store/appStore';

export function Welcome() {
  const go = useAppStore((s) => s.go);

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Local avatar preview</p>
        <h1 className="mt-1 text-3xl font-semibold">See your avatar follow your expressions</h1>
        <p className="mt-2 text-slate-600">
          Your webcam drives a live preview on this PC. Choose an illustrated avatar or upload your own picture
          to try experimental, AI-labeled face animation.
        </p>
      </div>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" role="note">
        <h2 className="font-semibold text-slate-900">Preview only — not sent to video-call apps</h2>
        <p className="mt-1 text-sm text-slate-700">
          The native virtual camera and outgoing call video are not implemented yet. Custom-picture animation
          works only in this local preview and may distort.
        </p>
      </div>
      <Button onClick={() => go('avatars')}>Open live avatar preview</Button>
      <p className="text-xs text-slate-500">
        For a photo avatar, upload only your own likeness and confirm consent on the avatar-selection screen.
        The photo is processed locally, kept in memory, and visibly labeled AI-generated.
      </p>
    </section>
  );
}
