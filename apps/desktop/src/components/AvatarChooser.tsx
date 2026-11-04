import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { AvatarPreview } from '@/components/AvatarPreview';
import { validateLocalImage } from '@/lib/validateLocalImage';
import { useAppStore, type AvatarId } from '@/store/appStore';
import type { TrackingMetrics } from '@/hooks/useFaceTracking';

const stillMetrics: TrackingMetrics = {
  faceFound: false,
  quality: 0,
  issue: 'no-face',
  yaw: 0,
  pitch: 0,
  roll: 0,
  blinkLeft: 0,
  blinkRight: 0,
  browRaise: 0,
  mouthOpen: 0,
  landmarks: [],
};

const builtInAvatars: { id: Exclude<AvatarId, 'custom'>; name: string; description: string }[] = [
  { id: 'aria', name: 'Aria', description: 'Teal and charcoal' },
  { id: 'sol', name: 'Sol', description: 'Warm amber' },
  { id: 'milo', name: 'Milo', description: 'Indigo and slate' },
];

interface AvatarChooserProps {
  metrics?: TrackingMetrics;
  tracking?: boolean;
}

export function AvatarChooser({ metrics = stillMetrics, tracking = false }: AvatarChooserProps) {
  const { selectedAvatar, setSelectedAvatar, customAvatar, setCustomAvatar } = useAppStore();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const navigateAvatarChoices = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const choices = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    if (!choices?.length) return;
    const currentIndex = Array.from(choices).indexOf(event.currentTarget);
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex = (currentIndex + direction + choices.length) % choices.length;
    choices[nextIndex].focus();
    choices[nextIndex].click();
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (!consent) throw new Error('Confirm that this is your own image before uploading.');
      await validateLocalImage(file);
      const url = URL.createObjectURL(file);
      setCustomAvatar({ id: crypto.randomUUID(), blob: file, url, name: file.name });
      setSelectedAvatar('custom');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="avatar-choice-title" className="space-y-4">
      <div>
        <h2 id="avatar-choice-title" className="text-lg font-semibold">Choose an avatar</h2>
        <p className="mt-1 text-sm text-slate-600">Built-in illustrated avatars are the recommended choice. Animated photo avatars are limited to your own likeness.</p>
      </div>
      <div role="radiogroup" aria-label="Built-in avatar choices" className="grid gap-3 sm:grid-cols-3">
        {builtInAvatars.map((avatar) => (
          <button
            key={avatar.id}
            type="button"
            role="radio"
            aria-checked={selectedAvatar === avatar.id}
            onClick={() => setSelectedAvatar(avatar.id)}
            onKeyDown={navigateAvatarChoices}
            className={`rounded-lg bg-white p-2 text-left ring-2 transition-colors ${
              selectedAvatar === avatar.id ? 'ring-lens' : 'ring-slate-200 hover:ring-slate-400'
            }`}
          >
            <span className="block aspect-video overflow-hidden rounded-md">
              <AvatarPreview avatar={avatar.id} metrics={metrics} tracking={tracking} />
            </span>
            <span className="mt-2 block text-sm font-semibold">{avatar.name}</span>
            <span className="block text-xs text-slate-500">{avatar.description}</span>
          </button>
        ))}
        {customAvatar && (
          <button
            type="button"
            role="radio"
            aria-checked={selectedAvatar === 'custom'}
            onClick={() => setSelectedAvatar('custom')}
            onKeyDown={navigateAvatarChoices}
            className={`rounded-lg bg-white p-2 text-left ring-2 transition-colors ${
              selectedAvatar === 'custom' ? 'ring-lens' : 'ring-slate-200 hover:ring-slate-400'
            }`}
          >
            <span className="block aspect-video overflow-hidden rounded-md">
              <AvatarPreview customImageUrl={customAvatar.url} metrics={metrics} tracking={tracking} />
            </span>
            <span className="mt-2 block text-sm font-semibold">Your picture</span>
            <span className="block text-xs text-slate-500">AI-labeled photo preview</span>
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="font-medium">Use your own picture</h3>
        <p className="text-sm text-slate-600">
          The local face tracker maps your expressions and head movement onto your own image. Results depend on image quality, face angle, and lighting.
          The rendered preview is always labeled AI-generated.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-1"
          />
          <span>I am the person shown and authorize local animation of my own likeness. I understand this creates AI-generated media and the label stays visible.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`inline-flex cursor-pointer items-center rounded-md px-4 py-2 text-sm font-semibold ${
            consent && !busy ? 'bg-lens text-slate9 hover:bg-[#d18d22]' : 'cursor-not-allowed bg-slate-200 text-slate-500'
          }`}>
            {busy ? 'Checking image…' : customAvatar ? 'Choose another image' : 'Upload image'}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              disabled={!consent || busy}
              onChange={(event) => void upload(event)}
              className="sr-only"
              aria-label="Upload a PNG, JPEG, or WebP avatar image"
            />
          </label>
          {customAvatar && (
            <span className="text-sm text-slate-600">Selected: {customAvatar.name}</span>
          )}
          {selectedAvatar === 'custom' && customAvatar && (
            <span className="rounded-full bg-slate9 px-2.5 py-1 text-xs font-semibold text-white">AI avatar</span>
          )}
          {customAvatar && (
            <button type="button" className="text-sm font-medium text-bad underline" onClick={() => {
              setCustomAvatar(null);
              setSelectedAvatar('aria');
              setConsent(false);
            }}>
              Remove image
            </button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <p className="text-xs text-slate-500">
          PNG, JPEG, or WebP; up to 10 MB and 4096 × 4096 pixels. The image stays in memory on this PC and is not saved or uploaded.
          Only upload your own likeness. The generated avatar is labeled AI-generated; call-app output is unavailable until the native virtual camera is implemented and tested.
        </p>
      </div>
    </section>
  );
}
