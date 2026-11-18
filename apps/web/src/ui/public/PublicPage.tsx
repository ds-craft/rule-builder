// 公開リンクの閲覧画面（手順書 10-8.5）：ログインなしで見られる。閲覧モードの条文・新旧対照表・状態（どの段階か）。
// 編集はできないので、リボンは表示の切り替え（条文・新旧対照表・一般向け条文のみ）だけにする。
// 中身はサーバーの GET /public/:publicId（発議済みの改正案だけ。編集者名やカーソルは含まない）。

import {
  STATUS_LABEL,
  compareHtml,
  formatRuleNumber,
  isRuleKind,
  isoToWareki,
  parseRule,
} from '@rule-builder/core';
import { Info, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { RuleView } from '../../render/RuleView.tsx';
import { ApiError, fetchPublic, type PublicEntry, type PublicView } from '../../server/api.ts';
import { jstDateTime } from '../file/ProposePage.tsx';
import { TitleBar } from '../shell/TitleBar.tsx';

type Tab = 'rules' | 'compare';

function notice(v: PublicView): string {
  switch (v.status) {
    case 'unei_discussion':
      return '運営内協議中の改正案です。内容は協議に合わせて変わることがあります。';
    case 'mod_vote':
      return `運営投票中です（${jstDateTime(v.voteDeadline)} 締切）。`;
    case 'participant_discussion':
      return v.participantVoteAvailableAt
        ? `参加者協議中です（${jstDateTime(v.participantVoteAvailableAt)} から参加者投票を始められます）。`
        : '運営投票で可決しました。参加者協議の準備中です。';
    case 'participant_vote':
      return `参加者投票中です（${jstDateTime(v.voteDeadline)} 締切）。`;
    case 'passed':
      return `可決しました。施行日（${v.enforcementDate ? isoToWareki(v.enforcementDate) : '未定'}）からポータルに載ります。`;
    case 'enacted':
      return '施行済みです。最新の条文はポータルで見られます。';
    case 'rejected':
      return '否決された改正案です。';
    default:
      return '';
  }
}

const OP_LABEL = { create: '制定', amend: '改正', repeal: '廃止' } as const;

function RuleSection({ e, generalOnly }: { e: PublicEntry; generalOnly: boolean }) {
  const doc = useMemo(() => parseRule(e.markdown).doc, [e.markdown]);
  return (
    <section className="pub-rule">
      <h3 className="bs-h">
        {OP_LABEL[e.op]}：{e.name || doc.meta.name || '（名称未設定）'}
      </h3>
      {e.op === 'repeal' ? (
        <p className="muted">このルールは廃止します（廃止する前の条文を表示しています）。</p>
      ) : null}
      <div className="sheet">
        <RuleView doc={doc} generalOnly={generalOnly} />
      </div>
    </section>
  );
}

function CompareSection({ v }: { v: PublicView }) {
  const date = v.enforcementDate ? isoToWareki(v.enforcementDate) : '';
  const newLabel = date ? `（${date} 施行）` : '（施行日未定）';
  return (
    <div className="print-area rb-portal">
      <p className="muted">改正した条だけを表示し、変わった文字に傍線を引きます。</p>
      {v.entries.map((e) => (
        <section key={`${e.op}:${e.ruleId}:${e.name}`} className="cmp-rule">
          <h3 className="bs-h">
            {OP_LABEL[e.op]}：{e.name || '（名称未設定）'}
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
                  { markdown: e.markdown, date, label: newLabel },
                ),
              }}
            />
          )}
        </section>
      ))}
    </div>
  );
}

export function PublicPage() {
  const { publicId = '' } = useParams();
  // 読み込んだ結果（どの公開リンクのものか）。リンクが変わったら、読み込み直すまで「読み込み中」にする
  const [loaded, setLoaded] = useState<{
    id: string;
    view: PublicView | null;
    error: 'not_found' | 'failed' | null;
  } | null>(null);
  const [tab, setTab] = useState<Tab>('rules');
  const [generalOnly, setGeneralOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPublic(publicId).then(
      (v) => alive && setLoaded({ id: publicId, view: v, error: null }),
      (e: unknown) =>
        alive &&
        setLoaded({
          id: publicId,
          view: null,
          error: e instanceof ApiError && e.status === 404 ? 'not_found' : 'failed',
        }),
    );
    return () => {
      alive = false;
    };
  }, [publicId]);
  const current = loaded?.id === publicId ? loaded : null;
  const view = current?.view ?? null;
  const error = current?.error ?? null;

  const a = view?.amendingNumber;
  const number =
    a && isRuleKind(a.kind)
      ? formatRuleNumber({ kind: a.kind, year: a.year, number: a.number })
      : '';
  const title = view ? `${number} の改正案（公開リンク）` : '改正案';

  if (error || !view) {
    return (
      <>
        <TitleBar center={title} />
        <main className="pub-body">
          {error === 'not_found' ? (
            <>
              <h2>見つかりません</h2>
              <p>この改正案は公開されていないか、取り下げられました。</p>
            </>
          ) : error ? (
            <>
              <h2>読み込めませんでした</h2>
              <p>しばらくしてから、もう一度開いてください。</p>
            </>
          ) : (
            <p className="muted">読み込んでいます…</p>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <TitleBar center={title} />
      <div className="pub-tabs" role="tablist" aria-label="表示">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'rules'}
          onClick={() => setTab('rules')}
        >
          条文
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'compare'}
          onClick={() => setTab('compare')}
        >
          新旧対照表
        </button>
      </div>
      <main className="pub-body">
        <div className="ebanner-wrap flow" role="status">
          <Info className="i" aria-hidden="true" />
          <span className="grow">
            <b>{STATUS_LABEL[view.status]}</b>：{notice(view)}
            {view.portalUrl && (
              <>
                {' '}
                <a href={view.portalUrl} target="_blank" rel="noreferrer">
                  ポータルで見る
                </a>
              </>
            )}
          </span>
        </div>
        <h2>{view.title || number}</h2>
        <p className="muted">
          {number}・施行日 {view.enforcementDate ? isoToWareki(view.enforcementDate) : '未定'}
        </p>
        {tab === 'rules' ? (
          <>
            <div className="row-actions">
              <button
                type="button"
                className={'btn small' + (generalOnly ? ' on' : '')}
                aria-pressed={generalOnly}
                onClick={() => setGeneralOnly(!generalOnly)}
              >
                <Users className="i" aria-hidden="true" />
                一般向け条文のみ
              </button>
            </div>
            {view.entries.map((e) => (
              <RuleSection key={`${e.op}:${e.ruleId}:${e.name}`} e={e} generalOnly={generalOnly} />
            ))}
          </>
        ) : (
          <CompareSection v={view} />
        )}
      </main>
    </>
  );
}
