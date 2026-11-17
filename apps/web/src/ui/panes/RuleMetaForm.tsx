// 書誌情報フォーム（F-20・F-21）。情報ページの右と、作業ウィンドウ「ルールの情報」で共通に使う。
// ファイル名・permalink・title・rule_number・og_description は書誌情報から作り、「自動で作られる項目」に出す。

import {
  derivedFrontMatter,
  formatRuleId,
  isoToWareki,
  RULE_KINDS,
  updateRuleMeta,
  type RuleKind,
  type RuleMetaPatch,
} from '@rule-builder/core';
import { useEffect, useState } from 'react';
import {
  loadNumberSources,
  suggestNumber,
  suggestOrder,
  type NumberSources,
} from '../../state/actions.ts';
import { useApp, type OpenEntry } from '../../state/store.ts';

export function RuleMetaForm({ entry }: { entry: OpenEntry }) {
  const m = entry.doc.meta;
  const lock = entry.op !== 'create';
  const readOnly = entry.op === 'repeal';
  const [src, setSrc] = useState<NumberSources | null>(null);
  useEffect(() => {
    if (!lock) void loadNumberSources().then(setSrc);
  }, [lock]);

  const update = (patch: RuleMetaPatch) => {
    updateRuleMeta(entry.ydoc, entry.key, patch);
    useApp.getState().refresh();
  };
  const fm = derivedFrontMatter(m);
  const id = formatRuleId(m);
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="meta-form">
      {readOnly ? (
        <p className="muted" style={{ marginTop: 0 }}>
          <span className="tag repeal">廃止</span>{' '}
          このルールは改正案で廃止します。書誌情報は変えられません。
        </p>
      ) : lock ? (
        <p className="muted" style={{ marginTop: 0 }}>
          既存ルールの改正のため、種類と番号は変えられません。
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          ファイル名や公開URLはここから自動で作られます。
        </p>
      )}
      <div className="field">
        <label htmlFor={`m-name-${entry.key}`}>名称</label>
        <input
          type="text"
          id={`m-name-${entry.key}`}
          value={m.name}
          style={{ width: '100%' }}
          placeholder="例：〇〇に関するルール"
          disabled={readOnly}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`m-kind-${entry.key}`}>種類</label>
        <select
          id={`m-kind-${entry.key}`}
          value={m.kind}
          disabled={lock}
          onChange={(e) => update({ kind: e.target.value as RuleKind })}
        >
          {RULE_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`m-num-${entry.key}`}>番号</label>
        <div className="inline-fields">
          令和
          <input
            type="number"
            aria-label="年"
            value={m.year || ''}
            disabled={lock}
            onChange={(e) => update({ year: num(e.target.value) })}
          />
          年 第
          <input
            type="number"
            id={`m-num-${entry.key}`}
            value={m.number || ''}
            disabled={lock}
            onChange={(e) => update({ number: num(e.target.value) })}
          />
          号
        </div>
        {!lock && src && (
          <div className="muted">次の番号：第{suggestNumber(m.kind, m.year, src, entry.key)}号</div>
        )}
      </div>
      <div className="field">
        <label htmlFor={`m-date-${entry.key}`}>施行日</label>
        <input
          type="date"
          id={`m-date-${entry.key}`}
          value={m.enforcementDate}
          disabled={readOnly}
          onChange={(e) => update({ enforcementDate: e.target.value })}
        />{' '}
        <span className="muted">{m.enforcementDate ? isoToWareki(m.enforcementDate) : ''}</span>
      </div>
      <div className="field">
        <label htmlFor={`m-order-${entry.key}`}>一覧での並び順</label>
        <input
          type="number"
          id={`m-order-${entry.key}`}
          value={m.order ?? ''}
          disabled={readOnly}
          onChange={(e) => update({ order: e.target.value === '' ? null : Number(e.target.value) })}
        />
        {!lock && src && <span className="muted"> 提案：{suggestOrder(m.kind, src)}</span>}
      </div>
      <details>
        <summary className="muted">自動で作られる項目</summary>
        <dl className="gen">
          <dt>ファイル名</dt>
          <dd>
            rules/{entry.op === 'repeal' ? 'repealed/' : ''}
            {id}.md
          </dd>
          <dt>公開URL</dt>
          <dd>{fm.permalink}</dd>
          <dt>ルール番号</dt>
          <dd>{fm.rule_number || '（番号なし）'}</dd>
          <dt>説明文（OGP）</dt>
          <dd>{fm.og_description}</dd>
        </dl>
      </details>
    </div>
  );
}
