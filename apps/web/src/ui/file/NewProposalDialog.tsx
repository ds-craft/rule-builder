// 新しい改正案の作成（テンプレートを選んだあとに出るダイアログ）。
// 番号は次の空き番号を提案し、手で変えたら提案で上書きしない。施行日は空でもよい。

import { formatRuleNumber, isoToWareki, RULE_KINDS, type RuleKind } from '@rule-builder/core';
import { useEffect, useState } from 'react';
import { errorMessage, type RemoteRule } from '../../github/rules.ts';
import {
  createProposal,
  fetchRemoteRule,
  loadNumberSources,
  newRuleDoc,
  suggestNumber,
  suggestOrder,
  type NumberSources,
} from '../../state/actions.ts';
import { useApp } from '../../state/store.ts';
import { closeDialog, openDialog } from '../common/dialogs.tsx';
import type { TemplateKey } from './templates.tsx';

/** 今の令和の年 */
export function currentReiwaYear(now = new Date()): number {
  return now.getFullYear() - 2018;
}

type Form = {
  ruleId: string;
  name: string;
  year: number;
  kind: RuleKind;
  number: string;
  touched: boolean;
  date: string;
};

/** 入力欄の値をダイアログの外（作成ボタン）から読むための入れ物 */
type FormBox = { value: Form };

function NewProposalForm({
  tpl,
  initial,
  onChange,
  rules,
  error,
}: {
  tpl: TemplateKey;
  initial: Form;
  /** 入力が変わるたびに、今の値（番号は提案を反映したもの）を知らせる */
  onChange: (f: Form) => void;
  rules: RemoteRule[];
  error: string | null;
}) {
  const isAmend = tpl === 'amend';
  const isBlank = tpl === 'blank';
  const kind0 = tpl.startsWith('create-') ? (tpl.slice(7) as RuleKind) : 'ルール';
  const [f, setF] = useState<Form>(initial);
  const [src, setSrc] = useState<NumberSources | null>(null);
  useEffect(() => {
    void loadNumberSources().then(setSrc);
  }, []);
  const suggestion = src ? suggestNumber(f.kind, f.year, src) : null;
  const shown = f.touched ? f.number : suggestion !== null ? String(suggestion) : f.number;
  const update = (patch: Partial<Form>) => {
    const next = { ...f, ...patch };
    setF(next);
    onChange({ ...next, number: next.touched ? next.number : shown });
  };
  useEffect(() => {
    onChange({ ...f, number: shown });
  });

  return (
    <>
      {isAmend && (
        <div className="field">
          <label htmlFor="nd-rule">改正するルール</label>
          <select
            id="nd-rule"
            style={{ width: '100%' }}
            value={f.ruleId}
            onChange={(e) => update({ ruleId: e.target.value })}
          >
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.meta.name}（{formatRuleNumber(r.meta) || '番号なし'}）
              </option>
            ))}
          </select>
        </div>
      )}
      {!isAmend && !isBlank && (
        <div className="field">
          <label htmlFor="nd-name">{kind0}の名称</label>
          <input
            type="text"
            id="nd-name"
            style={{ width: '100%' }}
            placeholder={`例：〇〇に関する${kind0}`}
            value={f.name}
            autoFocus
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="nd-num">{isAmend || isBlank ? '改正ルール番号' : `${kind0}の番号`}</label>
        <div className="inline-fields">
          令和
          <input
            type="number"
            id="nd-year"
            min={1}
            aria-label="年"
            value={f.year}
            onChange={(e) => update({ year: Number(e.target.value) })}
          />
          年
          <select
            id="nd-kind"
            aria-label="種類"
            value={f.kind}
            onChange={(e) => update({ kind: e.target.value as RuleKind })}
          >
            {RULE_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          第
          <input
            type="number"
            id="nd-num"
            min={1}
            value={shown}
            onChange={(e) => update({ number: e.target.value, touched: true })}
          />
          号
        </div>
        <div className="muted">
          {suggestion !== null ? `次の番号：第${suggestion}号` : '番号を調べています…'}
        </div>
      </div>
      <div className="field">
        <label htmlFor="nd-date">施行日</label>
        <input
          type="date"
          id="nd-date"
          value={f.date}
          onChange={(e) => update({ date: e.target.value })}
        />{' '}
        <span className="muted">{f.date ? isoToWareki(f.date) : 'あとで決めてもかまいません'}</span>
      </div>
      {error && (
        <p className="issue error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const TITLES: Record<string, string> = { amend: '既存のルールを改正', blank: '空の改正案' };

/** テンプレートからの新規作成。ruleIdPreset は「開く ＞ 公開中のルール」から来たときの改正対象 */
export function openNewProposalDialog(
  tpl: TemplateKey,
  navigate: (to: string) => void,
  rules: RemoteRule[] = [],
  ruleIdPreset?: string,
) {
  const kind0 = tpl.startsWith('create-') ? (tpl.slice(7) as RuleKind) : 'ルール';
  const box: FormBox = {
    value: {
      ruleId: ruleIdPreset ?? rules.find((r) => !r.repealed)?.id ?? '',
      name: '',
      year: currentReiwaYear(),
      kind: kind0,
      number: '',
      touched: false,
      date: '',
    },
  };
  let busy = false;
  const render = (error: string | null) =>
    openDialog({
      title: TITLES[tpl] ?? `${kind0}を制定`,
      body: (
        <NewProposalForm
          tpl={tpl}
          initial={box.value}
          onChange={(v) => (box.value = v)}
          rules={rules.filter((r) => !r.repealed)}
          error={error}
        />
      ),
      actions: [
        { label: 'キャンセル' },
        {
          label: '作成',
          primary: true,
          run: () => {
            if (busy) return false;
            const f = box.value;
            const number = Number(f.number);
            if (
              !Number.isInteger(number) ||
              number < 1 ||
              !Number.isInteger(f.year) ||
              f.year < 1
            ) {
              render('番号を正しく入れてください');
              return false;
            }
            busy = true;
            void (async () => {
              try {
                const amendingNumber = { kind: f.kind, year: f.year, number };
                if (tpl === 'amend') {
                  const { sha, markdown } = await fetchRemoteRule(f.ruleId);
                  await createProposal(
                    { amendingNumber, enforcementDate: f.date },
                    { op: 'amend', ruleId: f.ruleId, baseSha: sha, baseMarkdown: markdown },
                  );
                } else if (tpl === 'blank') {
                  await createProposal({ amendingNumber, enforcementDate: f.date });
                } else {
                  const src = await loadNumberSources();
                  // 新規1件だけの改正案では、改正ルール番号＝新規ルールの番号
                  const doc = newRuleDoc({
                    kind: f.kind,
                    year: f.year,
                    number,
                    name: f.name,
                    enforcementDate: f.date,
                    order: suggestOrder(f.kind, src),
                    extra: {},
                  });
                  await createProposal(
                    { amendingNumber, enforcementDate: f.date },
                    { op: 'create', doc },
                  );
                }
                closeDialog();
                const { entries, showToast, setUi } = useApp.getState();
                showToast(`${formatRuleNumber(amendingNumber) || '改正案'}の改正案を作りました`);
                setUi({ mode: 'edit', tab: 'home' });
                navigate(entries.length ? '/edit/0' : '/file/info');
              } catch (e) {
                busy = false;
                render(errorMessage(e));
              }
            })();
            return false;
          },
        },
      ],
    });
  render(null);
}
