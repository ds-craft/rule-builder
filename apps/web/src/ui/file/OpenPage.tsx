// 開く：場所の切り替え（運営の改正案／公開中のルール／このデバイス）。

import { DraftFileError, formatRuleNumber } from '@rule-builder/core';
import { Cloud, FileText, FolderOpen, Search, Users, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage, fetchRuleList, type RemoteRule, type RuleList } from '../../github/rules.ts';
import { addAmendEntry, openDraftFile } from '../../state/actions.ts';
import { useApp, type OpenLocation } from '../../state/store.ts';
import { openDialog } from '../common/dialogs.tsx';
import { ServerList, STATUS_LABEL } from './HomePage.tsx';
import { openNewProposalDialog } from './NewProposalDialog.tsx';

function Place({
  loc,
  icon: Icon,
  label,
  desc,
}: {
  loc: OpenLocation;
  icon: LucideIcon;
  label: string;
  desc: string;
}) {
  const current = useApp((s) => s.ui.openLocation);
  const setUi = useApp((s) => s.setUi);
  return (
    <a
      href="#"
      className={current === loc ? 'active' : ''}
      aria-current={current === loc ? 'true' : undefined}
      onClick={(e) => {
        e.preventDefault();
        setUi({ openLocation: loc });
      }}
    >
      <Icon className="i" aria-hidden="true" />
      <span>
        <b>{label}</b>
        <br />
        <span className="muted">{desc}</span>
      </span>
    </a>
  );
}

export function OpenPage() {
  const loc = useApp((s) => s.ui.openLocation);
  return (
    <>
      <h2>開く</h2>
      <div className="places">
        <div className="pl">
          <Place loc="server" icon={Users} label="運営の改正案" desc="サーバー上のすべての改正案" />
          <Place loc="remote" icon={Cloud} label="公開中のルール" desc="ds-craft/rules の最新版" />
          <Place
            loc="device"
            icon={FolderOpen}
            label="このデバイス"
            desc="下書きファイル（.json）"
          />
        </div>
        <div>
          {loc === 'server' && <ServerProposals />}
          {loc === 'remote' && <RemoteRules />}
          {loc === 'device' && <DeviceDrop />}
        </div>
      </div>
    </>
  );
}

/** 運営の改正案（状態で絞り込み） */
function ServerProposals() {
  const [status, setStatus] = useState('all');
  const chips: [string, string][] = [['all', 'すべて'], ...Object.entries(STATUS_LABEL)];
  return (
    <>
      <div className="status-filter" role="group" aria-label="状態で絞り込む">
        {chips.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>
            {label}
          </button>
        ))}
      </div>
      <ServerList status={status} />
    </>
  );
}

export const ruleNumberLabel = (r: RemoteRule) => formatRuleNumber(r.meta) || '（番号なし）';

/** 公開中のルールの一覧（絞り込みつき）。ボタンの文言と動作は呼び出し側が決める */
export function RemoteRuleTable({
  onPick,
  actionLabel,
  exclude = [],
}: {
  onPick: (r: RemoteRule, list: RuleList) => void;
  actionLabel: string;
  exclude?: string[];
}) {
  const [list, setList] = useState<RuleList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback((force = false) => {
    fetchRuleList(fetch, force).then(setList, (e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(() => load(), [load]);

  if (error) {
    return (
      <div className="issue error">
        <span className="lv">エラー</span>
        {error}
        <div className="acts">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setError(null);
              load(true);
            }}
          >
            再試行
          </button>
        </div>
      </div>
    );
  }
  if (!list) return <p className="muted">読み込み中…</p>;
  const query = q.trim();
  const rules = list.rules.filter(
    (r) =>
      !r.repealed &&
      !exclude.includes(r.id) &&
      (!query ||
        r.meta.name.includes(query) ||
        ruleNumberLabel(r).includes(query) ||
        r.id.includes(query)),
  );
  return (
    <>
      <label className="search" style={{ margin: '0 0 10px' }}>
        <Search className="i" aria-hidden="true" />
        <input
          type="search"
          placeholder="ルール名・番号で絞り込み"
          aria-label="ルールを絞り込む"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        取得元：ds-craft/rules main {list.sha.slice(0, 7)}
      </p>
      <table className="list files">
        <thead>
          <tr>
            <th>ルール</th>
            <th className="hide-mobile">番号</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr
              key={r.id}
              className="row"
              tabIndex={0}
              onClick={() => onPick(r, list)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onPick(r, list);
              }}
            >
              <td>
                <FileText className="i" aria-hidden="true" /> {r.meta.name}
                <div className="muted only-mobile">{ruleNumberLabel(r)}</div>
              </td>
              <td className="hide-mobile">{ruleNumberLabel(r)}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(r, list);
                  }}
                >
                  {actionLabel}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rules.length === 0 && <p className="muted">該当するルールはありません。</p>}
    </>
  );
}

function RemoteRules() {
  const navigate = useNavigate();
  const go = (to: string) => void navigate(to);
  const session = useApp((s) => s.session);
  const proposal = useApp((s) => s.proposal);
  const entries = useApp((s) => s.entries);
  const showToast = useApp((s) => s.showToast);

  const addToCurrent = async (r: RemoteRule) => {
    try {
      const i = await addAmendEntry(r.id);
      useApp.getState().setUi({ mode: 'edit' });
      go(`/edit/${i}`);
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  const pick = (r: RemoteRule, list: RuleList) => {
    if (!session || !proposal) return openNewProposalDialog('amend', go, list.rules, r.id);
    const already = entries.findIndex((e) => e.ruleId === r.id && e.op === 'amend');
    if (already >= 0) return go(`/edit/${already}`);
    // 公開中のルールを開くとき、改正案を開いていれば「その改正案に追加」か「新しい改正案」かを選ぶ
    const choice = { value: 'add' };
    openDialog({
      title: `「${r.meta.name}」を開く`,
      body: (
        <>
          <p style={{ marginTop: 0 }}>このルールの改正を、どの改正案で行いますか？</p>
          <label className="choice">
            <input type="radio" name="op" defaultChecked onChange={() => (choice.value = 'add')} />{' '}
            <span className="ttl">
              開いている改正案（{formatRuleNumber(proposal.amendingNumber)}）に追加
            </span>
            <ul>
              <li>1回の改正で複数のルールを直すとき</li>
            </ul>
          </label>
          <label className="choice">
            <input type="radio" name="op" onChange={() => (choice.value = 'new')} />{' '}
            <span className="ttl">新しい改正案を作る</span>
            <ul>
              <li>別の改正として扱うとき</li>
            </ul>
          </label>
        </>
      ),
      actions: [
        { label: 'キャンセル' },
        {
          label: '開く',
          primary: true,
          run: () => {
            if (choice.value === 'new')
              setTimeout(() => openNewProposalDialog('amend', go, list.rules, r.id));
            else void addToCurrent(r);
          },
        },
      ],
    });
  };

  return (
    <>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        開くと、そのルールを改正する改正案になります。
      </p>
      <RemoteRuleTable onPick={pick} actionLabel="改正する" />
    </>
  );
}

function DeviceDrop() {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  const load = async (f: File) => {
    try {
      const r = await openDraftFile(await f.text());
      showToast(r === 'merged' ? 'この端末の同じ改正案に取り込みました' : '下書きを開きました');
      const { entries } = useApp.getState();
      void navigate(entries.length ? '/edit/0' : '/file/info');
    } catch (e) {
      showToast(e instanceof DraftFileError ? e.message : '下書きファイルを開けませんでした');
    }
  };
  return (
    <div
      className={'drop' + (over ? ' over' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void load(f);
      }}
    >
      <FolderOpen className="i" aria-hidden="true" />
      <p>
        <b>下書きファイルをここにドラッグ</b>
        <br />
        <span className="muted">または</span>
      </p>
      <button type="button" className="btn primary" onClick={() => input.current?.click()}>
        ファイルを選ぶ
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = '';
        }}
      />
      <p className="muted">ほかの運営者が「保存」から書き出した .json ファイルを開けます。</p>
    </div>
  );
}
