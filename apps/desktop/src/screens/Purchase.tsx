import { Button } from '@/components/Button';
import { useAppStore } from '@/store/appStore';

export function Purchase() {
  const go = useAppStore((state) => state.go);
  return (
    <section className="max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold">Purchase and activation</h1>
      <div role="status" className="rounded-lg bg-warn/10 p-4 text-sm text-warn">
        Checkout is not configured in this build. No external purchase page has been opened.
      </div>
      <p className="text-slate-600">Once you have an activation code, enter it here. Do not share your code with anyone.</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => go('activate')}>Enter activation code</Button>
        <Button variant="secondary" onClick={() => go('help')}>Help</Button>
      </div>
    </section>
  );
}
