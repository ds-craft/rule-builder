import { formatRuleNumber, isoToWareki } from '@rule-builder/core';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage, fetchRuleList } from '../../github/rules.ts';
import { openRecentProposal } from '../../state/actions.ts';
import { useApp } from '../../state/store.ts';
import { listRecent, type RecentProposal } from '../../storage/recent.ts';
import { openNewProposalDialog } from './NewProposalDialog.tsx';
import { TemplateList, type TemplateKey } from './templates.tsx';

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは';
}

/** 更新日時の表示（今日なら時刻、それ以外は日付） */
export function updatedLabel(iso: string, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今日 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日`;
}

const OP_LABEL = { create: '新規', amend: '改正', repeal: '廃止' } as const;

export const proposalSummary = (p: RecentProposal) =>
  p.rules
    .map((r) => (r.op === 'create' ? r.name || '（名称未設定）' : `${r.name}（${OP_LABEL[r.op]}）`))
    .join('、') || 'ルールなし';

export function useRecent(): RecentProposal[] | null {
  const [list, setList] = useState<RecentProposal[] | null>(null);
  const session = useApp((s) => s.session);
  const proposal = useApp((s) => s.proposal);
  useEffect(() => {
    void listRecent().then(setList);
  }, [session, proposal?.updatedAt]);
  return list;
}

export function RecentList() {
  const list = useRecent();
  const navigate = useNavigate();
  const openId = useApp((s) => s.session?.id);
  const showToast = useApp((s) => s.showToast);
  if (!list) return <p className="muted">読み込み中…</p>;
  if (!list.length) return <p className="muted">まだ改正案はありません。</p>;
  const open = async (id: string) => {
    try {
      await openRecentProposal(id);
      const { entries } = useApp.getState();
      void navigate(entries.length ? '/edit/0' : '/file/info');
    } catch {
      showToast('改正案を開けませんでした');
    }
  };
  return (
    <table className="list files">
      <thead>
        <tr>
          <th>改正案</th>
          <th className="hide-mobile">含まれるルール</th>
          <th className="hide-mobile">施行日</th>
          <th>更新</th>
        </tr>
      </thead>
      <tbody>
        {list.map((p) => (
          <tr
            key={p.id}
            className="row"
            tabIndex={0}
            onClick={() => void open(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void open(p.id);
            }}
          >
            <td>
              <FileText className="i" aria-hidden="true" />{' '}
              <b>{formatRuleNumber(p.amendingNumber) || '（番号なし）'}</b>
              {p.id === openId && <span className="tag amend">開いています</span>}
              <div className="muted only-mobile">{proposalSummary(p)}</div>
            </td>
            <td className="hide-mobile">{proposalSummary(p)}</td>
            <td className="hide-mobile">
              {p.enforcementDate ? isoToWareki(p.enforcementDate) : '未設定'}
            </td>
            <td>{updatedLabel(p.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** テンプレートを選んだとき：既存のルールの改正なら先に公開中のルールの一覧を取る */
export function useTemplatePicker() {
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  return (tpl: TemplateKey) => {
    const go = (to: string) => void navigate(to);
    if (tpl !== 'amend') return openNewProposalDialog(tpl, go);
    fetchRuleList().then(
      (list) => openNewProposalDialog(tpl, go, list.rules),
      (e: unknown) => showToast(errorMessage(e)),
    );
  };
}

export function HomePage() {
  const pick = useTemplatePicker();
  return (
    <>
      <h2>{greeting()}</h2>
      <h3 className="bs-h">新規</h3>
      <TemplateList keys={['create-ルール', 'amend', 'blank']} onPick={pick} />
      <p>
        <Link to="/file/new">その他の種類 →</Link>
      </p>
      <h3 className="bs-h">最近使った改正案</h3>
      <RecentList />
      <p className="muted">
        改正案はこのブラウザに自動で保存されます。ほかの運営者から受け取った下書きファイルは「
        <Link to="/file/open">開く</Link>」から開けます。
      </p>
    </>
  );
}
