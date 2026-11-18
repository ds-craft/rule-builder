// 発議（F-50〜F-59・手順書 10-8.1）：発議前の確認と「発議」、進み具合と投票の締切・結果、状態に応じたボタン、
// Discord に貼るための文面（運営内協議用・会議場用）と公開リンクのコピー、取り下げ。
// 状態を変えるのはサーバー（rule-builder・OpsBot）だけで、ここはボタンで頼むだけ（state/flow.ts）。

import {
  FLOW_STEPS,
  STATUS_LABEL,
  flowStepIndex,
  formatRuleNumber,
  isWithdrawable,
  isoToWareki,
  lintRule,
  type ProposalStatus,
} from '@rule-builder/core';
import { Copy, ExternalLink, Flag, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { docAnchors, incomingWarnings, checkCounts } from '../../editor/checks.ts';
import { entryRuleId, lintRuleIndex, useLinkIndex } from '../../github/linkIndex.ts';
import type { FlowView, PreflightCheck, RuleVoteSummary } from '../../server/api.ts';
import { staleEntries } from '../../state/actions.ts';
import { runFlow, useFlow } from '../../state/flow.ts';
import { useApp, type OpenEntry } from '../../state/store.ts';
import { copyText, openDialog } from '../common/dialogs.tsx';
import { changedCount } from './InfoPage.tsx';

// ---------- 表示の小物 ----------

const JST = { timeZone: 'Asia/Tokyo' } as const;

/** 「12月18日 20:00」 */
export function jstDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const md = d.toLocaleDateString('ja-JP', { ...JST, month: 'long', day: 'numeric' });
  const hm = d.toLocaleTimeString('ja-JP', { ...JST, hour: '2-digit', minute: '2-digit' });
  return `${md} ${hm}`;
}

/** 「あと3時間12分」 */
export function remaining(ms: number): string {
  if (ms <= 0) return '';
  const m = Math.ceil(ms / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `あと${h}時間${m % 60}分` : `あと${m}分`;
}

/** datetime-local の値（JST）と ISO の行き来 */
const toLocalInput = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => new Date(`${v}:00+09:00`).toISOString();

/** いまの時刻（intervalMs ごと、と at の時刻ちょうどに描き直す） */
function useNow(intervalMs = 30_000, at: number | null = null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  useEffect(() => {
    if (at === null || !Number.isFinite(at)) return;
    const wait = at - Date.now();
    if (wait <= 0) {
      const t = setTimeout(() => setNow(Date.now()), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setNow(Date.now()), Math.min(wait + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [at]);
  return now;
}

/** 変更点の要約（会議場の文面用）：「基本ルール：3条を改正」 */
function changeSummary(entries: OpenEntry[]): string[] {
  return entries.map((e) => {
    const name = e.doc.meta.name || '（名称未設定）';
    if (e.op === 'create') return `${name}：新しく制定`;
    if (e.op === 'repeal') return `${name}：廃止`;
    const n = changedCount(e);
    return n ? `${name}：${n}条を改正` : `${name}：変更なし`;
  });
}

export function discordTexts(args: {
  title: string;
  number: string;
  enforcementDate: string;
  publicUrl: string;
  entries: OpenEntry[];
}) {
  const date = args.enforcementDate ? isoToWareki(args.enforcementDate) : '未定';
  return {
    unei: [
      `【改正案】${args.title}（${args.number}・仮番号）`,
      `施行日：${date}`,
      `公開リンク：${args.publicUrl}`,
      '',
      '内容は公開リンクで確認できます（協議中の変更もすぐ反映されます）。協議が済んだら、rule-builder の発議ページから運営投票を始めます。',
    ].join('\n'),
    hall: [
      `【参加者協議】${args.title}`,
      `施行日：${date}`,
      `改正案（条文・新旧対照表）：${args.publicUrl}`,
      '',
      '運営投票で可決しました。この投稿から24時間以上協議したあと、参加者投票を行います。',
      '変更点：',
      ...changeSummary(args.entries).map((l) => `・${l}`),
    ].join('\n'),
  };
}

// ---------- 発議前の確認（画面側） ----------

type Check = {
  key: PreflightCheck['key'];
  label: string;
  ok: boolean;
  details: string[];
  to?: string;
};

function useClientChecks(): { checks: Check[]; loading: boolean } {
  const p = useApp((s) => s.proposal)!;
  const entries = useApp((s) => s.entries);
  const linkIndex = useLinkIndex();
  const [stale, setStale] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    staleEntries().then(
      (r) => alive && setStale(r.keys),
      () => alive && setStale([]),
    );
    return () => {
      alive = false;
    };
  }, [entries.length]);

  const index = lintRuleIndex(linkIndex.status === 'ready' ? linkIndex.rules : null, entries, (e) =>
    docAnchors(e.doc),
  );
  const lint = entries
    .filter((e) => e.op !== 'repeal')
    .map((e) => ({
      e,
      n: lintRule(e.doc, { ruleId: entryRuleId(e), rules: index }).filter(
        (i) => i.level === 'error',
      ).length,
    }))
    .filter((x) => x.n > 0);
  // 参照の確認：開いているエディタの候補と、ほかのルールからのリンクが切れるもの
  const incoming = entries.reduce(
    (n, e) => n + incomingWarnings(e, linkIndex.status === 'ready' ? linkIndex.rules : []).length,
    0,
  );
  const refs = checkCounts().refs + incoming;
  const changed = entries.some((e) => e.op !== 'amend' || changedCount(e));
  const checks: Check[] = [
    {
      key: 'entries',
      label: '改正するルールがある',
      ok: changed,
      details: changed ? [] : ['制定・改正・廃止するルールがありません'],
      to: '/file/info',
    },
    {
      key: 'enforcement',
      label: '施行日が入力されている',
      ok: !!p.enforcementDate,
      details: p.enforcementDate ? [] : ['「情報」で施行日を入力してください'],
      to: '/file/info',
    },
    {
      key: 'lint',
      label: '書式チェックのエラーが0件',
      ok: lint.length === 0,
      details: lint.map((x) => `${x.e.doc.meta.name || '（名称未設定）'}：${x.n}件`),
    },
    {
      key: 'refs',
      label: '参照の確認の残りが0件',
      ok: refs === 0,
      details: refs ? [`${refs}件残っています（校閲タブの「参照の確認」）`] : [],
    },
    {
      key: 'base',
      label: '元にした版が最新',
      ok: stale !== null && stale.length === 0,
      details:
        stale && stale.length
          ? entries
              .filter((e) => stale.includes(e.key))
              .map((e) => `${e.doc.meta.name}：公開中のルールが更新されています`)
          : [],
    },
  ];
  return { checks, loading: stale === null };
}

// ---------- 進み具合 ----------

function Steps({ view }: { view: FlowView }) {
  const status = view.status;
  // 否決は、否決した投票の段階で止める
  const rejectedAt = status === 'rejected' ? (view.opsbot?.participantVote ? 4 : 2) : -1;
  const at = status === 'rejected' ? rejectedAt : flowStepIndex(status);
  return (
    <ol className="flow-steps" aria-label="進み具合">
      {FLOW_STEPS.map((s, i) => {
        const cls =
          status === 'rejected' && i === at
            ? 'stop'
            : i < at || (status === 'enacted' && i === at)
              ? 'done'
              : i === at
                ? 'now'
                : '';
        return (
          <li key={s.key} className={cls} aria-current={i === at ? 'step' : undefined}>
            {s.label}
            {cls === 'stop' && '（否決）'}
          </li>
        );
      })}
    </ol>
  );
}

function VoteResult({ v }: { v: RuleVoteSummary }) {
  if (!v.result) return null;
  if (v.result.cancelled) return <>打ち切り（取り下げ）</>;
  return (
    <>
      {v.result.passed ? '可決' : '否決'}（賛成{v.result.yes}・反対{v.result.no}・棄権
      {v.result.abstain}）
    </>
  );
}

function PasteBox({ id, label, text }: { id: string; label: string; text: string }) {
  const showToast = useApp((s) => s.showToast);
  return (
    <div className="paste-box">
      <label className="muted" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="paste" readOnly value={text} />
      <div className="row-actions">
        <button type="button" className="btn small" onClick={() => void copyText(text, showToast)}>
          <Copy className="i" aria-hidden="true" />
          コピー
        </button>
      </div>
    </div>
  );
}

function PublicLink({ url }: { url: string }) {
  const showToast = useApp((s) => s.showToast);
  return (
    <p className="public-link">
      公開リンク（ログインなしで見られます）：
      <a href={url} target="_blank" rel="noreferrer">
        {url}
      </a>{' '}
      <button type="button" className="btn small" onClick={() => void copyText(url, showToast)}>
        <Copy className="i" aria-hidden="true" />
        コピー
      </button>
    </p>
  );
}

// ---------- ダイアログ ----------

type ModVoteChoice = { method: 'secret' | 'quick'; confirmed: boolean };

function ModVoteForm({ onChange }: { onChange: (c: ModVoteChoice) => void }) {
  const [method, setMethodState] = useState<ModVoteChoice['method']>('secret');
  const [confirmed, setConfirmedState] = useState(false);
  const setMethod = (m: ModVoteChoice['method']) => {
    setMethodState(m);
    onChange({ method: m, confirmed });
  };
  const setConfirmed = (c: boolean) => {
    setConfirmedState(c);
    onChange({ method, confirmed: c });
  };
  return (
    <>
      <p style={{ marginTop: 0 }}>
        開始すると内容を固定し、OpsBot
        が投票場に運営投票（ルールの制定・改正、投票者の3分の2以上）を出します。以降は編集できません。
      </p>
      <fieldset className="plain">
        <legend className="muted">投票の方式</legend>
        <label>
          <input
            type="radio"
            name="vm"
            checked={method === 'secret'}
            onChange={() => setMethod('secret')}
          />{' '}
          通常（24時間）
        </label>
        <br />
        <label>
          <input
            type="radio"
            name="vm"
            checked={method === 'quick'}
            onChange={() => setMethod('quick')}
          />{' '}
          短縮投票（同時会議で全運営者が同意したとき）
        </label>
      </fieldset>
      {method === 'quick' && (
        <p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            同時会議で全運営者が同意したことを確かめました
          </label>
        </p>
      )}
    </>
  );
}

// ---------- ページ ----------

export function ProposePage() {
  const p = useApp((s) => s.proposal)!;
  const entries = useApp((s) => s.entries);
  const showToast = useApp((s) => s.showToast);
  const { view, error, busy, serverChecks } = useFlow();
  // 参加者投票を始められる時刻ちょうどにも描き直す（ボタンを押せるようにする）
  const availableAt = view?.opsbot?.participantVoteAvailableAt;
  const now = useNow(30_000, availableAt ? Date.parse(availableAt) : null);

  if (!view) {
    return (
      <>
        <h2>発議</h2>
        <p className="muted">{error ?? '発議の状況を読み込んでいます…'}</p>
        {error && (
          <p className="muted">
            発議はサーバーに保存された改正案で行います。ログインしてサーバーにつながっているか確かめてください。
          </p>
        )}
      </>
    );
  }

  const status: ProposalStatus = view.status;
  const o = view.opsbot;
  const number = formatRuleNumber(p.amendingNumber);
  const texts = view.publicUrl
    ? discordTexts({
        title: view.title,
        number,
        enforcementDate: p.enforcementDate,
        publicUrl: view.publicUrl,
        entries,
      })
    : null;
  const disabled = busy !== null;

  const withdraw = isWithdrawable(status) && (
    <button
      type="button"
      className="btn"
      disabled={disabled}
      onClick={() =>
        openDialog({
          title: '取り下げ',
          body: (
            <p>
              改正案を取り下げて下書きに戻します。公開リンクは見られなくなり、進行中の投票は OpsBot
              が打ち切ります。直したあと、発議し直せます（投票はやり直しになります）。
            </p>
          ),
          actions: [
            {
              label: '取り下げる',
              primary: true,
              run: () => {
                void runFlow({ kind: 'withdraw' }).then((ok) => ok && showToast('取り下げました'));
              },
            },
            { label: 'キャンセル' },
          ],
        })
      }
    >
      取り下げ
    </button>
  );

  const sim = view.simulated && (status === 'mod_vote' || status === 'participant_vote') && (
    <section className="prop-card">
      <span className="proto">ステージング・手元の開発だけ</span> <b>模擬の投票</b>
      <p className="muted">
        ここでは本物の OpsBot ではなく模擬の OpsBot につながっています。本番では OpsBot が Discord
        で投票を行い、締切で集計します。
      </p>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => void runFlow({ kind: 'sim-vote', passed: true })}
      >
        可決にする
      </button>{' '}
      <button
        type="button"
        className="btn"
        disabled={disabled}
        onClick={() => void runFlow({ kind: 'sim-vote', passed: false })}
      >
        否決にする
      </button>
    </section>
  );

  let main: ReactNode = null;
  if (status === 'draft') main = <DraftSection serverChecks={serverChecks} disabled={disabled} />;
  else if (status === 'unei_discussion')
    main = (
      <>
        <section className="prop-card">
          <h3 className="bs-h">運営内協議</h3>
          {view.publicUrl && <PublicLink url={view.publicUrl} />}
          <p>
            協議は
            Discord（運営内の新ルールのチャンネルなど）で進めます。下の文面を貼って始めてください。内容の変更は公開リンクにすぐ反映されるので、Discord
            には知らせません。
          </p>
          {texts && <PasteBox id="tx-unei" label="運営内協議に貼る文面" text={texts.unei} />}
        </section>
        <section className="prop-card">
          <h3 className="bs-h">運営投票</h3>
          <p>協議が済んだら運営投票を始めます。始めると内容が固定され、編集できなくなります。</p>
          <div className="row-actions">
            <button
              type="button"
              className="btn primary"
              disabled={disabled}
              onClick={() => {
                let choice: ModVoteChoice = { method: 'secret', confirmed: false };
                openDialog({
                  title: '運営投票を開始',
                  body: <ModVoteForm onChange={(c) => (choice = c)} />,
                  actions: [
                    {
                      label: '開始',
                      primary: true,
                      run: () => {
                        if (choice.method === 'quick' && !choice.confirmed) {
                          showToast('短縮投票では、全運営者の同意を確かめてください');
                          return false;
                        }
                        void runFlow({
                          kind: 'mod-vote',
                          method: choice.method,
                          quickConfirmed: choice.confirmed,
                        }).then((ok) => ok && showToast('運営投票を開始しました'));
                      },
                    },
                    { label: 'キャンセル' },
                  ],
                });
              }}
            >
              <Flag className="i" aria-hidden="true" />
              運営投票を開始…
            </button>
            {withdraw}
          </div>
        </section>
      </>
    );
  else if (status === 'mod_vote' || status === 'participant_vote') {
    const isMod = status === 'mod_vote';
    const v = isMod ? o?.modVote : o?.participantVote;
    main = (
      <>
        <section className="prop-card">
          <h3 className="bs-h">{isMod ? '運営投票中' : '参加者投票中'}</h3>
          {view.publicUrl && <PublicLink url={view.publicUrl} />}
          <dl className="kv">
            <dt>方式</dt>
            <dd>
              {isMod
                ? v?.method === 'quick'
                  ? '短縮投票'
                  : '通常（24時間）'
                : '参加者投票（24時間）'}
            </dd>
            <dt>締切</dt>
            <dd>
              {jstDateTime(v?.closesAt)}
              {v && v.status === 'open' && Date.parse(v.closesAt) > now && (
                <span className="muted">（{remaining(Date.parse(v.closesAt) - now)}）</span>
              )}
              {v && v.status === 'open' && Date.parse(v.closesAt) <= now && (
                <span className="muted">（締切を過ぎました。OpsBot の集計を待っています）</span>
              )}
            </dd>
            {isMod && view.frozen && (
              <>
                <dt>内容のハッシュ</dt>
                <dd>
                  <code>{view.frozen.contentHash}</code>
                </dd>
              </>
            )}
            {view.pr && (
              <>
                <dt>GitHub</dt>
                <dd>
                  <a href={view.pr.url} target="_blank" rel="noreferrer">
                    Draft PR #{view.pr.number}（参照用）
                  </a>
                </dd>
              </>
            )}
            {!isMod && o?.modVote && (
              <>
                <dt>運営投票</dt>
                <dd>
                  <VoteResult v={o.modVote} />
                </dd>
              </>
            )}
          </dl>
          <p className="muted">
            投票は OpsBot が{isMod ? '投票場' : '参加者投票のチャンネル'}
            で行い、締切で集計します。結果はここにも出ます。
          </p>
          <div className="row-actions">{withdraw}</div>
        </section>
        {sim}
      </>
    );
  } else if (status === 'participant_discussion') {
    main = (
      <ParticipantDiscussion
        view={view}
        texts={texts}
        now={now}
        withdraw={withdraw}
        disabled={disabled}
      />
    );
  } else if (status === 'passed') {
    main = <PassedSection view={view} disabled={disabled} />;
  } else if (status === 'enacted') {
    main = (
      <section className="prop-card">
        <h3 className="bs-h">反映済み</h3>
        <p>
          {view.reflect?.finalNumber ?? o?.finalNumber}として {view.rulesRepo} に反映し、OpsBot
          で告知しました。
        </p>
        {view.reflect?.portalUrl && (
          <p>
            <a href={view.reflect.portalUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="i" aria-hidden="true" />
              ポータルで見る
            </a>
          </p>
        )}
      </section>
    );
  } else if (status === 'rejected') {
    const v = o?.participantVote ?? o?.modVote;
    main = (
      <section className="prop-card">
        <h3 className="bs-h">否決</h3>
        <p>
          {o?.participantVote ? '参加者投票' : '運営投票'}で否決されました
          {v && (
            <>
              （<VoteResult v={v} />）
            </>
          )}
          。結果は OpsBot が告知しています。
        </p>
      </section>
    );
  }

  return (
    <>
      <h2>発議</h2>
      <Steps view={view} />
      <p className="muted flow-state">
        いまの状態：<b>{STATUS_LABEL[status]}</b>
        {view.title && <>（{view.title}）</>}
      </p>
      <div className="flow-grid">{main}</div>
    </>
  );
}

function DraftSection({
  serverChecks,
  disabled,
}: {
  serverChecks: PreflightCheck[] | null;
  disabled: boolean;
}) {
  const p = useApp((s) => s.proposal)!;
  const showToast = useApp((s) => s.showToast);
  const { checks, loading } = useClientChecks();
  // サーバーが断った項目があれば、それを優先して出す
  const shown: Check[] = serverChecks
    ? checks.map((c) => {
        const s = serverChecks.find((x) => x.key === c.key);
        return s ? { ...c, ok: s.ok, details: s.ok ? [] : s.details } : c;
      })
    : checks;
  const ok = !loading && shown.every((c) => c.ok);
  const refsRemaining = shown.find((c) => c.key === 'refs')?.ok ? 0 : 1;
  const number = formatRuleNumber(p.amendingNumber);
  return (
    <section className="prop-card">
      <h3 className="bs-h">発議前の確認</h3>
      <ul className="checks">
        {shown.map((c) => (
          <li key={c.key} className={c.ok ? 'ok' : loading && c.key === 'base' ? '' : 'ng'}>
            <span className="mk" aria-hidden="true">
              {c.ok ? '✓' : loading && c.key === 'base' ? '…' : '×'}
            </span>
            <span>
              {c.label}
              <span className="visually-hidden">
                {c.ok ? '：満たしています' : '：満たしていません'}
              </span>
              {!c.ok &&
                c.details.map((d) => (
                  <div key={d} className="muted">
                    {d}
                    {c.to && (
                      <>
                        {' '}
                        <Link to={c.to}>直す</Link>
                      </>
                    )}
                  </div>
                ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">
        発議すると公開リンクが発行され、OpsBot に発議が記録されます（Discord
        には投稿しません）。運営内協議の間は引き続き編集できます。サーバーでも同じ確認をやり直します。
      </p>
      <div className="row-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!ok || disabled}
          onClick={() =>
            openDialog({
              title: '発議',
              body: (
                <>
                  <p>{number}（仮番号）の改正案を発議します。</p>
                  <ul>
                    <li>公開リンクが発行され、ログインなしで見られるようになります</li>
                    <li>OpsBot に発議が記録されます（Discord には投稿しません）</li>
                    <li>運営内協議の間は引き続き編集できます</li>
                  </ul>
                </>
              ),
              actions: [
                {
                  label: '発議',
                  primary: true,
                  run: () => {
                    void runFlow({ kind: 'submit', refsRemaining }).then(
                      (done) => done && showToast('発議しました'),
                    );
                  },
                },
                { label: 'キャンセル' },
              ],
            })
          }
        >
          <Flag className="i" aria-hidden="true" />
          発議
        </button>
        {!ok && !loading && <span className="muted">満たしていない項目があります</span>}
      </div>
    </section>
  );
}

function ParticipantDiscussion({
  view,
  texts,
  now,
  withdraw,
  disabled,
}: {
  view: FlowView;
  texts: ReturnType<typeof discordTexts> | null;
  now: number;
  withdraw: ReactNode;
  disabled: boolean;
}) {
  const o = view.opsbot;
  const showToast = useApp((s) => s.showToast);
  const [editing, setEditing] = useState(false);
  const [at, setAt] = useState(() => toLocalInput(Date.now()));
  const started = o?.participantDiscussion ?? null;
  const availableAt = o?.participantVoteAvailableAt
    ? Date.parse(o.participantVoteAvailableAt)
    : NaN;
  const canVote = Number.isFinite(availableAt) && now >= availableAt;
  const inputRef = useRef<HTMLInputElement>(null);

  const record = () => {
    const iso = fromLocalInput(at);
    if (Date.parse(iso) > Date.now() + 60_000) {
      showToast('投稿した時刻を未来にはできません');
      return;
    }
    void runFlow({ kind: 'participant-discussion', startedAt: iso }).then((ok) => {
      if (!ok) return;
      setEditing(false);
      showToast('参加者協議の開始を記録しました');
    });
  };

  const form = (
    <p className="disc-at">
      <label>
        投稿した時刻{' '}
        <input
          ref={inputRef}
          type="datetime-local"
          value={at}
          max={toLocalInput(now)}
          onChange={(e) => setAt(e.target.value)}
        />
      </label>{' '}
      <span className="muted">押し忘れたときは、実際に投稿した時刻に直せます</span>
    </p>
  );

  if (!started || editing) {
    return (
      <section className="prop-card">
        <h3 className="bs-h">参加者協議</h3>
        {!started && (
          <p>
            <b>運営投票で可決しました。</b>
            会議場に下の文面で協議の投稿を作り、投稿したら「参加者協議を開始」を押してください。
          </p>
        )}
        {texts && !started && <PasteBox id="tx-hall" label="会議場に貼る文面" text={texts.hall} />}
        {form}
        <div className="row-actions">
          <button type="button" className="btn primary" disabled={disabled} onClick={record}>
            {started ? '開始時刻を直す' : '参加者協議を開始'}
          </button>
          {editing && (
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              キャンセル
            </button>
          )}
          {!editing && withdraw}
        </div>
      </section>
    );
  }

  return (
    <section className="prop-card">
      <h3 className="bs-h">参加者協議中</h3>
      {view.publicUrl && <PublicLink url={view.publicUrl} />}
      <dl className="kv">
        <dt>運営投票</dt>
        <dd>{o?.modVote && <VoteResult v={o.modVote} />}</dd>
        <dt>協議の開始</dt>
        <dd>
          {jstDateTime(started.startedAt)}{' '}
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setAt(toLocalInput(Date.parse(started.startedAt)));
              setEditing(true);
            }}
          >
            開始時刻を直す
          </button>
        </dd>
        <dt>参加者投票</dt>
        <dd>{jstDateTime(o?.participantVoteAvailableAt)} から開始できます</dd>
      </dl>
      {texts && (
        <details>
          <summary className="muted">会議場に貼る文面</summary>
          <PasteBox id="tx-hall" label="会議場に貼る文面" text={texts.hall} />
        </details>
      )}
      <div className="row-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!canVote || disabled}
          onClick={() =>
            void runFlow({ kind: 'participant-vote' }).then(
              (ok) => ok && showToast('参加者投票を開始しました'),
            )
          }
        >
          <Flag className="i" aria-hidden="true" />
          参加者投票を開始
        </button>
        {!canVote && Number.isFinite(availableAt) && (
          <span className="muted">{remaining(availableAt - now)}</span>
        )}
        {withdraw}
      </div>
      <p className="muted">
        協議を延ばすとき（3人以上から協議継続の求めがあった・協議が続いている）は、押さずに待ってください。
      </p>
    </section>
  );
}

const STAGE_LABEL: Record<string, string> = {
  number: '改正ルール番号を確定しています',
  pending: '施行前としてポータルに載せています',
  waiting: '施行日を待っています',
  enact: 'ds-craft/rules に反映しています',
  cleanup: '施行前の掲載を外しています',
  notify: '反映を告知しています',
  done: '反映しました',
  blocked: '反映を止めました',
};

function PassedSection({ view, disabled }: { view: FlowView; disabled: boolean }) {
  const p = useApp((s) => s.proposal)!;
  const r = view.reflect;
  const showToast = useApp((s) => s.showToast);
  if (r?.stage === 'blocked' && r.blocked) {
    return (
      <section className="prop-card">
        <div className="notice err" role="alert">
          <TriangleAlert className="i" aria-hidden="true" />
          <span className="grow">
            <b>反映を止めました。</b>
            {r.blocked.message}（
            {r.blocked.paths.map((x) => (
              <code key={x}>{x}</code>
            ))}
            ）。運営者には OpsBot で知らせました。
          </span>
        </div>
        <h3 className="bs-h">対応のしかた</h3>
        <ol>
          <li>{view.rulesRepo} の main で、誰がなぜ変えたかを確かめる</li>
          <li>変更を戻せるなら戻してから「反映をやり直す」を押す</li>
          <li>
            戻せないときは、「<Link to="/file/export">書き出し</Link>
            」のファイルとコマンド例で手作業でコミットする（改正ルール番号：{r.finalNumber}）
          </li>
        </ol>
        <button
          type="button"
          className="btn primary"
          disabled={disabled}
          onClick={() =>
            void runFlow({ kind: 'retry' }).then((ok) => ok && showToast('反映をやり直しました'))
          }
        >
          反映をやり直す
        </button>
      </section>
    );
  }
  return (
    <section className="prop-card">
      <h3 className="bs-h">可決（施行前）</h3>
      <dl className="kv">
        <dt>改正ルール番号</dt>
        <dd>{r?.finalNumber ? `${r.finalNumber}（確定）` : '確定しています…'}</dd>
        <dt>施行日</dt>
        <dd>{p.enforcementDate ? isoToWareki(p.enforcementDate) : ''}</dd>
        <dt>反映</dt>
        <dd>
          {r ? STAGE_LABEL[r.stage] : ''}
          {r?.stage === 'waiting' && r.amendingId && (
            <span className="muted">
              （ポータルに施行前として載せています：pending/{r.amendingId}/）
            </span>
          )}
        </dd>
        {r && r.attempts > 0 && (
          <>
            <dt>失敗</dt>
            <dd>
              {r.attempts}回続けて失敗しました（{r.lastError}）。
              {r.nextAttemptAt && `${jstDateTime(r.nextAttemptAt)} にやり直します。`}
            </dd>
          </>
        )}
      </dl>
      <p className="muted">
        施行日の 0時に、規約どおりのコミット（作者＝改正ルール番号、日時＝施行日 0時）で{' '}
        {view.rulesRepo} に反映します。
      </p>
      {r && r.attempts > 0 && (
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => void runFlow({ kind: 'retry' })}
        >
          いますぐやり直す
        </button>
      )}
    </section>
  );
}

/** 校閲タブ・帯などから使う：この改正案の手続の状態（読み込み前は null） */
export function useFlowStatus(): ProposalStatus | null {
  return useFlow((s) => s.view?.status ?? null);
}
