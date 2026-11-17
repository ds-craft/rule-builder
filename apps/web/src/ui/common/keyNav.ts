// 矢印キーでボタンの間を移る（リボンのタブ・ボタン、メニュー、スマホの下部バー）。

import type { KeyboardEvent } from 'react';

/**
 * 矢印キー・Home・End で、container の中の items（押せるもの）の間をフォーカスが移るようにする。
 * @param axis 'horizontal'：←→、'vertical'：↑↓
 * @returns 動かしたら true
 */
export function moveFocus(
  e: KeyboardEvent<HTMLElement>,
  selector: string,
  axis: 'horizontal' | 'vertical' = 'horizontal',
): boolean {
  const prev = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  const next = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  if (![prev, next, 'Home', 'End'].includes(e.key)) return false;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
  );
  if (items.length === 0) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let j: number;
  if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = items.length - 1;
  else if (e.key === next) j = i < 0 ? 0 : (i + 1) % items.length;
  else j = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
  e.preventDefault();
  items[j]!.focus();
  return true;
}
