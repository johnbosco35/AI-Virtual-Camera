import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { engine } from '@/lib/engine';
import { useAppStore } from '@/store/appStore';

/** Explains engine/model problems in place and offers the fix. */
export function EngineBanner({ compact = false }: { compact?: boolean }) {
  const online = useAppStore((s) => s.engineOnline);
  const status = useAppStore((s) => s.status);
  const refreshStatus = useAppStore((s) => s.refreshStatus);
  const toast = useAppStore((s) => s.toast);

  if (online === false) {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm">
        <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
        <div className="flex-1">
          <p className="font-semibold text-bad">The local AI engine is not running.</p>
          {!compact && <p className="mt-0.5 text-muted">Face tracking still works. Voice features, the avatar gallery and the voice library need the engine. It starts with the app; see Settings → Engine for setup steps.</p>}
        </div>
        <Button size="sm" onClick={() => void refreshStatus()}>Retry</Button>
      </div>
    );
  }
  if (!status || status.model_state === 'ready') return null;

  if (status.model_state === 'missing' || status.model_state === 'error') {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm">
        <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <div className="flex-1">
          <p className="font-semibold text-warn">{status.model_state === 'error' ? 'The voice model needs attention.' : 'Download the voice conversion model to enable AI voices.'}</p>
          <p className="mt-0.5 text-muted">{status.model_detail || 'OpenVoice V2 (MIT licence, ~130 MB) is downloaded once from Hugging Face. No personal data is sent.'}</p>
        </div>
        <Button
          size="sm"
          variant="primary"
          icon="upload"
          onClick={() => void engine.downloadModels().then(refreshStatus).catch((e: Error) => toast(e.message, 'bad'))}
        >
          {status.model_state === 'error' ? 'Retry download' : 'Download model'}
        </Button>
      </div>
    );
  }
  return (
    <div role="status" className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm">
      <p className="font-semibold text-[#A99CFF]">{status.model_detail || 'Preparing the voice model…'}</p>
      {status.model_state === 'downloading' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-gradient-to-r from-accent to-accent2 transition-[width]" style={{ width: `${Math.round(status.download_progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
