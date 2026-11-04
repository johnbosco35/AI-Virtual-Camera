import { Button } from '@/components/Button';
import { useAppStore } from '@/store/appStore';

export function Complete() {
  const go = useAppStore((state) => state.go);
  return (
    <section className="max-w-lg space-y-3">
      <h1 className="text-2xl font-semibold">Session finished</h1>
      <p className="text-slate-600">
        Your session has ended. To start another session, you need a new purchase.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => go('purchase')}>Purchase a new session</Button>
        <Button variant="secondary" onClick={() => go('preview')}>Return to preview</Button>
        <Button variant="secondary" onClick={() => go('help')}>Help</Button>
      </div>
    </section>
  );
}
