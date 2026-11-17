// 利用者の設定（このブラウザに残す）。

import { create } from 'zustand';

export type Settings = {
  /** 入力した「*」「_」や行頭の記号を、その場で全角にする（書式チェック 7-1.2） */
  autoFullwidth: boolean;
};

const KEY = 'rb:settings';
const DEFAULTS: Settings = { autoFullwidth: true };

function load(): Settings {
  try {
    const v = localStorage.getItem(KEY);
    return v ? { ...DEFAULTS, ...(JSON.parse(v) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const useSettings = create<Settings>(() => load());

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useSettings.setState({ [key]: value } as Pick<Settings, K>);
  try {
    localStorage.setItem(KEY, JSON.stringify(useSettings.getState()));
  } catch {
    // 保存できなくてもこの画面の間は効く
  }
}
