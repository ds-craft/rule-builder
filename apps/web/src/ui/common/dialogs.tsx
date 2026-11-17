// ダイアログ。openDialog で開き、DialogHost が1つだけ描画する（Word と同じく同時に1つ）。

import { formatRuleId, type RuleDoc } from '@rule-builder/core';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';

export type DialogAction = {
  label: string;
  primary?: boolean;
  /** false を返すとダイアログを閉じない */
  run?: () => boolean | void;
};

export type DialogSpec = {
  title: string;
  body: ReactNode;
  actions: DialogAction[];
};

const useDialogStore = create<{ spec: DialogSpec | null; seq: number }>(() => ({
  spec: null,
  seq: 0,
}));

export function openDialog(spec: DialogSpec) {
  useDialogStore.setState((s) => ({ spec, seq: s.seq + 1 }));
}

export function closeDialog() {
  useDialogStore.setState({ spec: null });
}

export function DialogHost() {
  const { spec, seq } = useDialogStore();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (spec && !d.open) d.showModal();
    if (!spec && d.open) d.close();
  }, [spec, seq]);
  return (
    <dialog ref={ref} onClose={closeDialog} aria-labelledby="dlg-title">
      {spec && (
        <>
          <div className="dh">
            <span id="dlg-title">{spec.title}</span>
            <button type="button" aria-label="閉じる" onClick={closeDialog}>
              <X className="i" aria-hidden="true" />
            </button>
          </div>
          <div className="db">{spec.body}</div>
          <div className="df">
            {spec.actions.map((a, i) => (
              <button
                key={i}
                type="button"
                className={'btn' + (a.primary ? ' primary' : '')}
                onClick={() => {
                  if (a.run && a.run() === false) return;
                  closeDialog();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </dialog>
  );
}

export async function copyText(text: string, toast: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました');
  } catch {
    toast('コピーできませんでした');
  }
}

/** 書き出される Markdown を読み取り専用で表示する。 */
export function openMarkdownDialog(doc: RuleDoc, md: string, toast: (m: string) => void) {
  openDialog({
    title: `Markdown（rules/${formatRuleId(doc.meta)}.md）`,
    body: (
      <>
        <p className="muted" style={{ marginTop: 0 }}>
          書き出されるファイルの中身です。編集はできません。
        </p>
        <textarea className="md" readOnly value={md} aria-label="Markdown" />
      </>
    ),
    actions: [
      {
        label: 'コピー',
        run: () => {
          void copyText(md, toast);
          return false;
        },
      },
      { label: '閉じる', primary: true },
    ],
  });
}
