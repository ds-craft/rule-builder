// 新旧対照表・印刷（F-32）。portal の「条文比較」と同じ処理で、改正した条だけを左に改正後・右に改正前で並べる。

import {
  compareHtml,
  formatRuleNumber,
  isoToWareki,
  readProposal,
  serializeRule,
} from '@rule-builder/core';
import { Columns2 } from 'lucide-react';
import { useApp } from '../../state/store.ts';

export function PrintPage() {
  const session = useApp((s) => s.session)!;
  const entries = useApp((s) => s.entries);
  // 改正案の情報が変わったら描き直す
  useApp((s) => s.proposal);
  // 改正案の情報やルールが変わるたびに描き直されるので、そのたびに Y.Doc から読み直す
  const proposal = readProposal(session.ydoc);
  const date = proposal.enforcementDate ? isoToWareki(proposal.enforcementDate) : '';
  const newLabel = date ? `（${date} 施行）` : '（施行日未定）';

  return (
    <>
      <h2>新旧対照表・印刷</h2>
      <div className="row-actions no-print" style={{ margin: '-8px 0 16px' }}>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          <Columns2 className="i" aria-hidden="true" />
          印刷・PDFに保存
        </button>
      </div>
      <div className="print-area rb-portal">
        <p className="muted">
          {formatRuleNumber(proposal.amendingNumber)}（施行日 {date || '未設定'}
          ）。改正した条だけを表示し、変わった文字に傍線を引きます。
        </p>
        {proposal.entries.map((e) => {
          const doc = e.op === 'repeal' ? null : e.doc;
          const name =
            doc?.meta.name ?? entries.find((x) => x.key === e.entryId)?.doc.meta.name ?? '';
          const number = doc ? formatRuleNumber(doc.meta) : '';
          return (
            <section key={e.entryId} className="cmp-rule">
              <h3 className="bs-h">
                {name || '（名称未設定）'}
                {number && `（${number}）`}
              </h3>
              {e.op === 'create' && (
                <p className="muted">新しく作るルールのため、対照表はありません。</p>
              )}
              {e.op === 'repeal' && <p className="muted">このルールは廃止します。</p>}
              {e.op === 'amend' && (
                <div
                  className="cmp-table"
                  // compareHtml は文字をすべてエスケープした HTML を返す（portal の条文比較と同じもの）
                  dangerouslySetInnerHTML={{
                    __html: compareHtml(
                      { markdown: e.baseMarkdown, date: '', label: '（現行）' },
                      { markdown: serializeRule(e.doc), date, label: newLabel },
                    ),
                  }}
                />
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
