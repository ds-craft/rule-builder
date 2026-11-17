// 情報：左に改正案の情報と含まれるルールの一覧、右に選んだルールのプロパティ（書誌情報）。

import {
  articleChanges,
  formatRuleNumber,
  isoToWareki,
  readFragmentJSON,
  removeEntry,
  RULE_KINDS,
  updateProposalMeta,
  type RuleKind,
} from '@rule-builder/core';
import { Ban, Pencil, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../github/rules.ts';
import {
  addCreateEntry,
  addRepealEntry,
  loadNumberSources,
  newRuleDoc,
  suggestNumber,
  suggestOrder,
} from '../../state/actions.ts';
import { useApp, type OpenEntry } from '../../state/store.ts';
import { closeDialog, openDialog } from '../common/dialogs.tsx';
import { RuleMetaForm } from '../panes/RuleMetaForm.tsx';
import { RemoteRuleTable } from './OpenPage.tsx';

export const OP_TAG = {
  create: { cls: 'new', label: '新規' },
  amend: { cls: 'amend', label: '改正' },
  repeal: { cls: 'repeal', label: '廃止' },
} as const;

/** 改正のルールで変更した条の数 */
export function changedCount(e: OpenEntry): number | null {
  if (e.op !== 'amend') return null;
  return articleChanges(e.baseMarkdown, readFragmentJSON(e.fragment)).count;
}

export function InfoPage() {
  const navigate = useNavigate();
  const session = useApp((s) => s.session)!;
  const p = useApp((s) => s.proposal)!;
  const entries = useApp((s) => s.entries);
  const current = useApp((s) => s.current);
  const refresh = useApp((s) => s.refresh);
  const setUi = useApp((s) => s.setUi);
  const showToast = useApp((s) => s.showToast);
  const selected = entries[current] ?? entries[0];

  const update = (patch: Parameters<typeof updateProposalMeta>[1]) => {
    updateProposalMeta(session.ydoc, patch);
    refresh();
  };
  const a = p.amendingNumber;

  const addNew = async () => {
    const src = await loadNumberSources();
    const hasCreate = entries.some((e) => e.op === 'create');
    // 新規1件だけの改正案では、改正ルール番号＝新規ルールの番号
    const number = hasCreate ? suggestNumber(a.kind, a.year, src) : a.number;
    const i = addCreateEntry(
      newRuleDoc({
        kind: a.kind,
        year: a.year,
        number,
        name: '',
        enforcementDate: p.enforcementDate,
        order: suggestOrder(a.kind, src),
        extra: {},
      }),
    );
    setUi({ pane: 'info', mode: 'edit' });
    void navigate(`/edit/${i}`);
  };

  const addRepeal = () =>
    openDialog({
      title: '既存のルールの廃止を追加',
      body: (
        <RemoteRuleTable
          actionLabel="廃止する"
          exclude={entries.filter((e) => e.op === 'repeal').map((e) => e.ruleId)}
          onPick={(r) => {
            closeDialog();
            addRepealEntry(r.id).then(
              () => showToast(`「${r.meta.name}」の廃止を追加しました`),
              (e: unknown) => showToast(errorMessage(e)),
            );
          }}
        />
      ),
      actions: [{ label: '閉じる' }],
    });

  const remove = (e: OpenEntry) =>
    openDialog({
      title: 'ルールを外す',
      body: `「${e.doc.meta.name || '（名称未設定）'}」をこの改正案から外します。このルールへの編集内容は失われます。`,
      actions: [
        { label: 'キャンセル' },
        {
          label: '外す',
          primary: true,
          run: () => {
            removeEntry(session.ydoc, e.key);
            refresh();
          },
        },
      ],
    });

  return (
    <>
      <h2>情報</h2>
      <div className="info-cols">
        <div>
          <section className="prop-card">
            <h3 className="bs-h" style={{ marginTop: 0 }}>
              改正案
            </h3>
            <div className="form-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
              <label htmlFor="am-num">改正ルール番号</label>
              <div className="inline-fields">
                令和
                <input
                  type="number"
                  min={1}
                  aria-label="年"
                  value={a.year || ''}
                  onChange={(e) =>
                    update({ amendingNumber: { ...a, year: Number(e.target.value) } })
                  }
                />
                年
                <select
                  aria-label="種類"
                  value={a.kind}
                  onChange={(e) =>
                    update({ amendingNumber: { ...a, kind: e.target.value as RuleKind } })
                  }
                >
                  {RULE_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                第
                <input
                  type="number"
                  id="am-num"
                  min={1}
                  value={a.number || ''}
                  onChange={(e) =>
                    update({ amendingNumber: { ...a, number: Number(e.target.value) } })
                  }
                />
                号
              </div>
              <label htmlFor="am-date">施行日</label>
              <div className="inline-fields">
                <input
                  type="date"
                  id="am-date"
                  value={p.enforcementDate}
                  onChange={(e) => update({ enforcementDate: e.target.value })}
                />
                <span className="muted">
                  {p.enforcementDate ? isoToWareki(p.enforcementDate) : ''}
                </span>
              </div>
              <label htmlFor="am-sum">説明（任意）</label>
              <input
                type="text"
                id="am-sum"
                value={p.summary}
                placeholder="例：運営の短縮投票に関する基本ルール改正"
                onChange={(e) => update({ summary: e.target.value })}
              />
            </div>
          </section>
          <h3 className="bs-h">この改正案に含まれるルール</h3>
          {entries.length ? (
            <table className="list files">
              <tbody>
                {entries.map((e, i) => {
                  const n = changedCount(e);
                  return (
                    <tr
                      key={e.key}
                      className="row"
                      tabIndex={0}
                      onClick={() => {
                        useApp.getState().setCurrent(i);
                        // 廃止のルールは本文を開かず、閲覧で表示する
                        useApp.getState().setUi({ mode: e.op === 'repeal' ? 'read' : 'edit' });
                        void navigate(`/edit/${i}`);
                      }}
                    >
                      <td>
                        <span className={`tag ${OP_TAG[e.op].cls}`}>{OP_TAG[e.op].label}</span>{' '}
                        <b>{e.doc.meta.name || '（名称未設定）'}</b>
                        {i === current && <span className="muted">（編集中）</span>}
                        <div className="muted">
                          {formatRuleNumber(e.doc.meta) || '（番号なし）'}
                          {n !== null && `・変更 ${n}条`}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {e.op !== 'repeal' && (
                          <button type="button" className="btn small primary">
                            編集
                          </button>
                        )}{' '}
                        <button
                          type="button"
                          className="btn small"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            remove(e);
                          }}
                        >
                          外す
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">まだルールがありません。下のボタンから追加してください。</p>
          )}
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => void addNew()}>
              <Plus className="i" aria-hidden="true" />
              新しいルールを追加
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setUi({ openLocation: 'remote' });
                void navigate('/file/open');
              }}
            >
              <Pencil className="i" aria-hidden="true" />
              既存のルールの改正を追加
            </button>
            <button type="button" className="btn" onClick={addRepeal}>
              <Ban className="i" aria-hidden="true" />
              既存のルールの廃止を追加
            </button>
          </div>
        </div>
        <div>
          {selected && (
            <section className="prop-card">
              <h3 className="bs-h" style={{ marginTop: 0 }}>
                プロパティ：{selected.doc.meta.name || '（名称未設定）'}
              </h3>
              <RuleMetaForm entry={selected} />
              {selected.op !== 'create' && (
                <dl className="gen" style={{ marginTop: 12 }}>
                  <dt>元にした版</dt>
                  <dd>ds-craft/rules {selected.baseSha.slice(0, 7)}</dd>
                </dl>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
