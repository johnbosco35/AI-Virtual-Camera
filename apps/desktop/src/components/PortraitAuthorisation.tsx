import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/ui';

export interface PortraitConsent {
  subject: string;
  relation: 'self' | 'authorised';
}

/**
 * Asks whose face a portrait shows and records the user's confirmation that they may animate it
 * (the portrait counterpart of the voice-profile authorisation). The engine refuses portraits without it.
 */
export function PortraitAuthorisationDialog({ open, title, count = 1, fixed, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  /** Number of pictures the confirmation covers (multi-file upload of the same person). */
  count?: number;
  /** Re-confirmation for a replacement picture: the person is already known. */
  fixed?: PortraitConsent | null;
  onCancel: () => void;
  onConfirm: (consent: PortraitConsent) => void;
}) {
  const [relation, setRelation] = useState<'self' | 'authorised'>('self');
  const [subject, setSubject] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRelation(fixed?.relation ?? 'self');
    setSubject(fixed?.subject ?? '');
    setConfirmed(false);
  }, [open, fixed]);

  const pictures = count > 1 ? `these ${count} pictures` : 'this picture';
  const name = subject.trim() || 'this person';
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div className="space-y-4">
        <fieldset className="space-y-3 rounded-xl border border-warn/30 bg-warn/5 p-4">
          <legend className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-warn"><Icon name="shield" className="h-3.5 w-3.5" />Authorisation required</legend>
          {!fixed && (
            <div className="flex gap-2">
              {(['self', 'authorised'] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRelation(r)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${relation === r ? 'bg-accent text-white' : 'bg-raised text-muted ring-1 ring-line'}`}>
                  {r === 'self' ? 'This is my own face' : 'Someone authorised me'}
                </button>
              ))}
            </div>
          )}
          {!fixed && (
            <Field label={relation === 'self' ? 'Your name' : 'Name of the person shown'} htmlFor="portrait-subject">
              <input id="portrait-subject" type="text" className="w-full" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              {relation === 'self'
                ? `I confirm ${pictures} show${count > 1 ? '' : 's'} me (${name}) and I consent to animating ${count > 1 ? 'them' : 'it'} as an AI avatar.`
                : `I confirm that ${name} has explicitly authorised me to animate ${pictures} of them and use ${count > 1 ? 'them' : 'it'} as an AI avatar.`}{' '}
              The output is labelled as AI-generated, and I will not use it to impersonate anyone or to mislead people about who they are talking to.
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!confirmed || !subject.trim()} onClick={() => onConfirm({ subject: subject.trim(), relation })}>Confirm</Button>
        </div>
      </div>
    </Modal>
  );
}
