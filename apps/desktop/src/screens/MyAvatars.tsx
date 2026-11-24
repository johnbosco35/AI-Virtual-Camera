import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Button, IconButton } from '@/components/Button';
import { AvatarImage, CompatibilityBadge } from '@/components/cards';
import { EngineBanner } from '@/components/EngineBanner';
import { PortraitAuthorisationDialog, type PortraitConsent } from '@/components/PortraitAuthorisation';
import { Icon } from '@/components/Icon';
import { AIBadge, Card, EmptyState, Modal, PageHeader, timeAgo, useAsyncUrl } from '@/components/ui';
import { engine } from '@/lib/engine';
import type { Avatar, AvatarDetail } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function validate(file: File) {
  if (!TYPES.includes(file.type)) return `${file.name}: use JPG, JPEG, PNG or WEBP.`;
  if (file.size > 10 * 1024 * 1024) return `${file.name}: images must be 10 MB or smaller.`;
  return null;
}

export function MyAvatars() {
  const avatars = useAppStore((s) => s.avatars);
  const online = useAppStore((s) => s.engineOnline);
  const selectedId = useAppStore((s) => s.settings.selected_avatar_id);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const refreshAvatars = useAppStore((s) => s.refreshAvatars);
  const analyseAvatar = useAppStore((s) => s.analyseAvatar);
  const toast = useAppStore((s) => s.toast);
  const go = useAppStore((s) => s.go);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Avatar | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Avatar | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [authorising, setAuthorising] = useState<Avatar | null>(null);

  // Files are checked first, then held until the user confirms whose face they show.
  const upload = (files: FileList | File[]) => {
    const valid: File[] = [];
    for (const file of Array.from(files)) {
      const problem = validate(file);
      if (problem) toast(problem, 'warn');
      else valid.push(file);
    }
    if (valid.length) setPending(valid);
  };

  const uploadConfirmed = async (consent: PortraitConsent) => {
    const list = pending;
    setPending([]);
    for (const file of list) {
      setUploading((n) => n + 1);
      try {
        const avatar = await engine.uploadAvatar(file, consent);
        await refreshAvatars();
        if (!selectedId) void updateSettings({ selected_avatar_id: avatar.id });
        toast(`Added “${avatar.name}”. Detecting facial landmarks…`, 'ok');
      } catch (cause) {
        toast(cause instanceof Error ? cause.message : 'Upload failed.', 'bad');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) upload(event.dataTransfer.files);
  };

  const remove = async (avatar: Avatar) => {
    try {
      await engine.deleteAvatar(avatar.id);
      await refreshAvatars();
      toast(`Deleted “${avatar.name}” and its image file.`, 'ok');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Delete failed.', 'bad');
    }
    setConfirmDelete(null);
  };

  return (
    <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <PageHeader
        title="My Avatars"
        subtitle="Portraits you can animate: photos, illustrations or paintings with a clearly visible face. Each image is analysed locally for facial landmarks."
        action={
          <>
            <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
            <Button variant="primary" icon="upload" disabled={online === false} onClick={() => inputRef.current?.click()}>
              {uploading ? `Uploading ${uploading}…` : 'Upload images'}
            </Button>
          </>
        }
      />
      <div className="mb-4"><EngineBanner compact /></div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 m-4 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent/10 text-lg font-semibold text-[#A99CFF] backdrop-blur-sm">
          Drop images to add them
        </div>
      )}

      {avatars.length === 0 ? (
        <EmptyState
          icon="avatars"
          title="Upload your first avatar"
          body="Drag JPG, PNG or WEBP portraits here, or choose files from your PC. Front-facing, evenly lit faces animate best."
          action={<Button variant="primary" icon="upload" disabled={online === false} onClick={() => inputRef.current?.click()}>Choose images</Button>}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-5">
          {avatars.map((avatar) => (
            <AvatarCard
              key={avatar.id}
              avatar={avatar}
              selected={avatar.id === selectedId}
              onOpen={() => setPreview(avatar)}
              onUse={() => { void updateSettings({ selected_avatar_id: avatar.id }); go('studio'); }}
              onDelete={() => setConfirmDelete(avatar)}
              onChanged={refreshAvatars}
              onReanalyse={() => void analyseAvatar(avatar)}
              onAuthorise={() => setAuthorising(avatar)}
            />
          ))}
        </div>
      )}

      <AvatarPreviewModal avatar={preview} onClose={() => setPreview(null)} />
      <PortraitAuthorisationDialog
        open={pending.length > 0}
        title={pending.length > 1 ? `Authorise ${pending.length} portraits` : 'Authorise this portrait'}
        count={pending.length}
        onCancel={() => setPending([])}
        onConfirm={(consent) => void uploadConfirmed(consent)}
      />
      <PortraitAuthorisationDialog
        open={!!authorising}
        title={`Authorise “${authorising?.name ?? ''}”`}
        onCancel={() => setAuthorising(null)}
        onConfirm={(consent) => {
          const target = authorising;
          setAuthorising(null);
          if (target) void engine.authoriseAvatar(target.id, consent).then(refreshAvatars).then(() => toast(`“${target.name}” is authorised.`, 'ok')).catch((e: Error) => toast(e.message, 'bad'));
        }}
      />
      <Modal open={!!confirmDelete} title="Delete avatar?" onClose={() => setConfirmDelete(null)}>
        <p className="text-sm text-muted">“{confirmDelete?.name}” and its image file will be permanently removed from this PC.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" icon="trash" onClick={() => confirmDelete && void remove(confirmDelete)}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

function AvatarCard({ avatar, selected, onOpen, onUse, onDelete, onChanged, onReanalyse, onAuthorise }: { avatar: Avatar; selected: boolean; onOpen: () => void; onUse: () => void; onDelete: () => void; onChanged: () => Promise<void>; onReanalyse: () => void; onAuthorise: () => void }) {
  const toast = useAppStore((s) => s.toast);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(avatar.name);
  const [replacement, setReplacement] = useState<File | null>(null);
  useEffect(() => setName(avatar.name), [avatar.name]);

  const save = async (patch: { name?: string; favourite?: boolean }) => {
    try {
      await engine.updateAvatar(avatar.id, patch);
      await onChanged();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'bad');
    }
  };
  const pickReplacement = (file: File) => {
    const problem = validate(file);
    if (problem) { toast(problem, 'warn'); return; }
    if (!avatar.authorised) { toast('Authorise this avatar first.', 'warn'); onAuthorise(); return; }
    setReplacement(file);
  };
  const replace = async (file: File) => {
    setReplacement(null);
    try {
      await engine.replaceAvatarImage(avatar.id, file);
      await onChanged();
      toast('Image replaced. Re-detecting facial landmarks…', 'ok');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Replace failed.', 'bad');
    }
  };

  return (
    <Card className={`group overflow-hidden transition ${selected ? 'border-accent/60 shadow-glow' : 'hover:border-[#2E3850]'}`}>
      <button type="button" onClick={onOpen} className="relative block w-full" aria-label={`Preview ${avatar.name}`}>
        <AvatarImage avatar={avatar} className="aspect-[4/5] w-full transition group-hover:scale-[1.02]" />
        <div className="absolute left-2 top-2"><CompatibilityBadge avatar={avatar} /></div>
        {selected && <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">IN STUDIO</span>}
        {!avatar.authorised && <span className="absolute inset-x-2 bottom-2 rounded-lg bg-warn/90 px-2 py-1 text-center text-[11px] font-semibold text-black">Needs authorisation</span>}
      </button>
      <div className="space-y-2 p-3">
        {editing ? (
          <input
            type="text"
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name !== avatar.name) void save({ name: name.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(avatar.name); setEditing(false); } }}
            className="w-full !py-1"
            aria-label="Avatar name"
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="block w-full truncate text-left text-sm font-semibold hover:text-[#A99CFF]" title="Rename">{avatar.name}</button>
        )}
        <p className="line-clamp-2 min-h-[2rem] text-[11px] leading-4 text-muted" title={avatar.compatibility_note}>{avatar.compatibility_note || `${avatar.width}×${avatar.height}`}</p>
        <div className="flex items-center gap-1">
          {avatar.authorised
            ? <Button size="sm" variant="primary" icon="studio" onClick={onUse}>Animate</Button>
            : <Button size="sm" variant="primary" icon="shield" onClick={onAuthorise}>Authorise</Button>}
          <IconButton icon="star" label={avatar.favourite ? 'Remove from favourites' : 'Add to favourites'} active={avatar.favourite} onClick={() => void save({ favourite: !avatar.favourite })} />
          <input ref={replaceRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickReplacement(f); e.target.value = ''; }} />
          <IconButton icon="replace" label="Replace image" onClick={() => replaceRef.current?.click()} />
          {!avatar.has_landmarks && <IconButton icon="reset" label="Analyse face again" onClick={onReanalyse} />}
          <IconButton icon="trash" label="Delete avatar" onClick={onDelete} className="ml-auto hover:!text-bad" />
        </div>
        <p className="text-[10px] text-faint">
          {avatar.authorised ? `${avatar.consent_relation === 'self' ? 'Own face' : `Authorised by ${avatar.consent_subject}`} · ` : ''}Used {timeAgo(avatar.last_used_at)}
        </p>
      </div>
      <PortraitAuthorisationDialog
        open={!!replacement}
        title="Confirm the new picture"
        fixed={{ subject: avatar.consent_subject, relation: avatar.consent_relation === 'authorised' ? 'authorised' : 'self' }}
        onCancel={() => setReplacement(null)}
        onConfirm={() => replacement && void replace(replacement)}
      />
    </Card>
  );
}

function AvatarPreviewModal({ avatar, onClose }: { avatar: Avatar | null; onClose: () => void }) {
  const [detail, setDetail] = useState<AvatarDetail | null>(null);
  const [showMesh, setShowMesh] = useState(true);
  const url = useAsyncUrl(avatar ? () => engine.avatarImageUrl(avatar) : null, [avatar?.id, avatar?.updated_at]);
  useEffect(() => {
    setDetail(null);
    if (avatar) void engine.avatar(avatar.id).then(setDetail).catch(() => undefined);
  }, [avatar]);

  return (
    <Modal open={!!avatar} title={avatar?.name ?? ''} onClose={onClose} wide>
      {avatar && (
        <div className="grid gap-5 md:grid-cols-[1fr_220px]">
          <div className="relative overflow-hidden rounded-xl bg-black">
            {url && <img src={url} alt={avatar.name} className="w-full" />}
            {showMesh && detail?.landmarks && (
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                {detail.landmarks.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.0022} fill={i >= 468 ? '#22D3EE' : '#A99CFF'} opacity={0.85} />)}
              </svg>
            )}
            <div className="absolute left-3 top-3"><AIBadge label="SOURCE PORTRAIT" /></div>
          </div>
          <div className="space-y-3 text-sm">
            <CompatibilityBadge avatar={avatar} />
            <p className="text-muted">{avatar.compatibility_note}</p>
            <dl className="space-y-1 text-xs text-muted">
              <div className="flex justify-between"><dt>Size</dt><dd className="text-text">{avatar.width} × {avatar.height}</dd></div>
              <div className="flex justify-between"><dt>Landmarks</dt><dd className="text-text">{detail?.landmarks?.length ?? 0}</dd></div>
              <div className="flex justify-between"><dt>Added</dt><dd className="text-text">{new Date(avatar.created_at).toLocaleDateString()}</dd></div>
            </dl>
            {detail?.landmarks && (
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showMesh} onChange={(e) => setShowMesh(e.target.checked)} /> Show detected face mesh</label>
            )}
            <p className="flex items-start gap-1.5 text-[11px] text-faint"><Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />Stored only on this PC. Deleting removes the file.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
