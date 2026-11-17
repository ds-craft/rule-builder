// 作業ウィンドウ「ルールの情報」。Phase 5 で書誌情報フォームに置き換える（今は閲覧のみ）。

import { derivedFrontMatter, formatRuleId, isoToWareki, type RuleDoc } from '@rule-builder/core';

export function RuleInfoPane({ doc, note }: { doc: RuleDoc; note?: string }) {
  const m = doc.meta;
  const fm = derivedFrontMatter(m);
  const id = formatRuleId(m);
  return (
    <>
      {note && (
        <p className="muted" style={{ marginTop: 0 }}>
          {note}
        </p>
      )}
      <dl className="gen">
        <dt>名称</dt>
        <dd>{m.name}</dd>
        <dt>種類</dt>
        <dd>{m.kind}</dd>
        <dt>番号</dt>
        <dd>{fm.rule_number || '（番号なし）'}</dd>
        <dt>施行日</dt>
        <dd>{m.enforcementDate ? isoToWareki(m.enforcementDate) : '未設定'}</dd>
        <dt>一覧での並び順</dt>
        <dd>{m.order ?? '—'}</dd>
        <dt>ファイル名</dt>
        <dd>rules/{id}.md</dd>
        <dt>公開URL</dt>
        <dd>{fm.permalink}</dd>
      </dl>
    </>
  );
}

export function NotReadyPane() {
  return <p className="muted">この機能は準備中です。</p>;
}
