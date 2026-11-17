import { formatRuleId } from '@rule-builder/core';
import { Cloud, Save } from 'lucide-react';
import { downloadDraft } from '../../state/actions.ts';
import { useApp } from '../../state/store.ts';
import { updatedLabel } from './HomePage.tsx';

export function SavePage() {
  const p = useApp((s) => s.proposal)!;
  const saveState = useApp((s) => s.saveState);
  const showToast = useApp((s) => s.showToast);
  return (
    <>
      <h2>保存</h2>
      <section className="prop-card" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Cloud className="i" aria-hidden="true" />
          <div>
            <b>自動保存：オン</b>
            <div className="muted">
              この改正案は、このブラウザに自動で保存されています（
              {saveState === 'saving'
                ? '保存中…'
                : `最終保存：${updatedLabel(p.updatedAt) || 'たった今'}`}
              ）。
            </div>
          </div>
        </div>
      </section>
      <h3 className="bs-h">下書きファイルとして保存</h3>
      <p style={{ maxWidth: 640 }}>
        ほかの運営者に渡したいとき、別のパソコンで続けたいときは、下書きファイル（.json）に保存します。受け取った人は「開く」→「このデバイス」から開けます。
      </p>
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          if (downloadDraft()) showToast('下書きファイルを保存しました');
        }}
      >
        <Save className="i" aria-hidden="true" />
        下書きファイルをダウンロード
      </button>{' '}
      <span className="muted">proposal-{formatRuleId(p.amendingNumber)}.json</span>
    </>
  );
}
