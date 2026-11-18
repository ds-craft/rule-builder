// 状態の帯（手順書 10-8.2・10-8.3）。運営内協議中は編集できるまま、運営投票の開始後は読み取り専用であることを出す。

import { isoToWareki } from '@rule-builder/core';
import { Flag, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useFlow } from '../../state/flow.ts';
import { useApp } from '../../state/store.ts';
import { jstDateTime } from '../file/ProposePage.tsx';

export function FlowBanner() {
  const view = useFlow((s) => s.view);
  const enforcementDate = useApp((s) => s.proposal?.enforcementDate ?? '');
  const navigate = useNavigate();
  if (!view || view.status === 'draft') return null;
  const o = view.opsbot;
  const r = view.reflect;
  let icon = <Lock className="i" aria-hidden="true" />;
  let text: ReactNode;
  switch (view.status) {
    case 'unei_discussion':
      icon = <Flag className="i" aria-hidden="true" />;
      text = (
        <>
          <b>発議済み：運営内協議中</b>（変更は公開リンクにもすぐ反映されます）
        </>
      );
      break;
    case 'mod_vote':
      text = (
        <>
          <b>運営投票中：{jstDateTime(o?.modVote?.closesAt)} 締切</b>
          （内容は固定されています。直すには取り下げて発議し直します）
        </>
      );
      break;
    case 'participant_discussion':
      text = o?.participantDiscussion ? (
        <>
          <b>
            参加者協議中：{jstDateTime(o.participantVoteAvailableAt)} から参加者投票を開始できます
          </b>
        </>
      ) : (
        <>
          <b>運営投票で可決しました</b>：会議場に投稿して「参加者協議を開始」を押してください
        </>
      );
      break;
    case 'participant_vote':
      text = (
        <>
          <b>参加者投票中：{jstDateTime(o?.participantVote?.closesAt)} 締切</b>
        </>
      );
      break;
    case 'passed':
      text =
        r?.stage === 'blocked' ? (
          <>
            <b>可決（施行前）：反映を止めました</b>（改正対象のファイルが変わっています）
          </>
        ) : (
          <>
            <b>
              可決（施行前）：{enforcementDate ? isoToWareki(enforcementDate) : ''} 0時に反映します
            </b>
            {r?.finalNumber && `（${r.finalNumber}）`}
          </>
        );
      break;
    case 'enacted':
      text = (
        <>
          <b>反映済み</b>：{r?.finalNumber ?? ''}として {view.rulesRepo} に反映しました
        </>
      );
      break;
    case 'rejected':
      text = (
        <>
          <b>否決</b>：この改正案は否決されました
        </>
      );
      break;
  }
  return (
    <div className="ebanner-wrap flow" role="status">
      {icon}
      <span className="grow">{text}</span>
      <button type="button" className="btn small" onClick={() => void navigate('/file/propose')}>
        発議の状況を見る
      </button>
    </div>
  );
}
