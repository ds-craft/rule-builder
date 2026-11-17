import { useSyncExternalStore } from 'react';

/** スマホ用のレイアウトに切り替える幅（プロトタイプと同じ 768px 未満）。 */
export const MOBILE_QUERY = '(max-width: 767px)';

function subscribe(cb: () => void) {
  const mq = matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function isMobileNow(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
