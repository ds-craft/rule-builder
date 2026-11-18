// 人のアイコン（Discord のアイコン。なければ名前の1文字目を色つきの丸で出す）。

import { userColor } from '../../state/auth.ts';

export function Avatar({
  id,
  name,
  url,
  size = 'md',
}: {
  id: string;
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = 'av' + (size === 'md' ? '' : ` ${size}`);
  if (url) return <img className={cls} src={url} alt="" aria-hidden="true" />;
  const initial = [...(name.trim() || '?')][0]!.toUpperCase();
  return (
    <span className={cls} style={{ background: userColor(id) }} aria-hidden="true">
      {initial}
    </span>
  );
}
