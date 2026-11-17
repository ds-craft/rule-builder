// 開く：場所の切り替え（最近使った改正案／公開中のルール／このデバイス）。

import { derivedFrontMatter, parseRule } from '@rule-builder/core';
import { Cloud, FileText, FolderOpen, Search, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  errorMessage,
  fetchRuleList,
  fetchRuleMarkdown,
  type RemoteRule,
  type RuleList,
} from '../../github/rules.ts';
import { useApp, type OpenLocation } from '../../state/store.ts';
import { RecentList } from './HomePage.tsx';

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
          <Place
            loc="recent"
            icon={FileText}
            label="最近使った改正案"
            desc="このブラウザに保存されているもの"
          />
          <Place loc="remote" icon={Cloud} label="公開中のルール" desc="ds-craft/rules の最新版" />
          <Place
            loc="device"
            icon={FolderOpen}
            label="このデバイス"
            desc="下書きファイル（.json）"
          />
        </div>
        <div>
          {loc === 'recent' && <RecentList />}
          {loc === 'remote' && <RemoteRules />}
          {loc === 'device' && <DeviceDrop />}
        </div>
      </div>
    </>
  );
}

const ruleNumberLabel = (r: RemoteRule) => derivedFrontMatter(r.meta).rule_number || '（番号なし）';

function RemoteRules() {
  const [list, setList] = useState<RuleList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const navigate = useNavigate();
  const openEntry = useApp((s) => s.openEntry);
  const setUi = useApp((s) => s.setUi);

  const load = useCallback((force = false) => {
    fetchRuleList(fetch, force).then(setList, (e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(() => load(), [load]);
  const retry = () => {
    setError(null);
    load(true);
  };

  const open = async (r: RemoteRule) => {
    if (!list || opening) return;
    setOpening(r.id);
    try {
      const md = await fetchRuleMarkdown(list.sha, r.path);
      const { doc } = parseRule(md);
      const i = openEntry({
        key: `remote:${r.id}:${list.sha}`,
        source: 'remote',
        ruleId: r.id,
        path: r.path,
        sha: list.sha,
        markdown: md,
        doc,
        readOnly: true,
      });
      setUi({ mode: 'read', tab: 'view' });
      void navigate(`/edit/${i}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };

  if (error) {
    return (
      <div className="issue error">
        <span className="lv">エラー</span>
        {error}
        <div className="acts">
          <button type="button" className="btn small" onClick={retry}>
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
        開くと、ポータルと同じ見た目で閲覧できます（取得元：ds-craft/rules main{' '}
        {list.sha.slice(0, 7)}）。
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
              onClick={() => void open(r)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void open(r);
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
                  disabled={opening === r.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    void open(r);
                  }}
                >
                  {opening === r.id ? '読み込み中…' : '開く'}
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

function DeviceDrop() {
  return (
    <div className="drop" aria-disabled="true">
      <FolderOpen className="i" aria-hidden="true" />
      <p>
        <b>下書きファイルをここにドラッグ</b>
        <br />
        <span className="muted">または</span>
      </p>
      <button type="button" className="btn primary" disabled title="準備中です">
        ファイルを選ぶ
      </button>
      <p className="muted">
        ほかの運営者が「保存」から書き出した .json ファイルを開けます（準備中）。
      </p>
    </div>
  );
}
