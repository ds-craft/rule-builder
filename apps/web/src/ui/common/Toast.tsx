import { useEffect, useState } from 'react';
import { useApp, type Toast as ToastData } from '../../state/store.ts';

export function Toast() {
  const toast = useApp((s) => s.toast);
  // 新しいトーストごとに作り直し、2秒後に消す
  return toast ? <ToastMessage key={toast.id} toast={toast} /> : <ToastMessage toast={null} />;
}

function ToastMessage({ toast }: { toast: ToastData | null }) {
  const [shown, setShown] = useState(!!toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setShown(false), 2000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className={'toast' + (shown ? ' show' : '')} role="status" aria-live="polite">
      {toast?.message}
    </div>
  );
}
