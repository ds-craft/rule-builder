// 書き出し（F-31・F-33）：運営者が手作業でコミットできるだけの成果物を出す。
//   ルールのファイル（ルールごとのコピー・ダウンロード、まとめて zip）とコミット情報（件名は編集できる）。

import {
  commitInfo,
  exportProposal,
  lintRule,
  formatRuleId,
  gitCommitCommand,
  pendingFiles,
  readProposal,
} from '@rule-builder/core';
import { strToU8, zipSync } from 'fflate';
import { Cloud, Code, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { downloadBlob } from '../../state/actions.ts';
import { useApp } from '../../state/store.ts';
import { copyText } from '../common/dialogs.tsx';
import { changedCount } from './InfoPage.tsx';
import { docAnchors } from '../../editor/checks.ts';
import { entryRuleId, lintRuleIndex, useLinkIndex } from '../../github/linkIndex.ts';

/** 今日（日本時間）の ISO 形式の日付 */
function todayIso(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function ExportPage() {
  const session = useApp((s) => s.session)!;
  const entries = useApp((s) => s.entries);
  // 改正案の情報が変わったら描き直す
  useApp((s) => s.proposal);
  const showToast = useApp((s) => s.showToast);
  // 改正案の情報やルールが変わるたびに描き直されるので、そのたびに Y.Doc から読み直す
  const proposal = readProposal(session.ydoc);
  const ex = exportProposal(proposal);
  const [subject, setSubject] = useState<string | null>(null);
  const info = commitInfo(proposal, subject ?? undefined, ex);
  const command = gitCommitCommand(info, ex);
  const future = !!proposal.enforcementDate && proposal.enforcementDate > todayIso();
  const [withPending, setWithPending] = useState(false);
  // 書式チェックのエラーの件数（6-1.4）
  const linkIndex = useLinkIndex();
  const index = lintRuleIndex(linkIndex.status === 'ready' ? linkIndex.rules : null, entries, (e) =>
    docAnchors(e.doc),
  );
  const lintErrors = entries
    .filter((e) => e.op !== 'repeal')
    .reduce(
      (n, e) =>
        n +
        lintRule(e.doc, { ruleId: entryRuleId(e), rules: index }).filter((i) => i.level === 'error')
          .length,
      0,
    );

  const status = (entryId: string) => {
    const e = entries.find((x) => x.key === entryId);
    if (!e) return '';
    if (e.op === 'create') return '新規';
    if (e.op === 'repeal') return '廃止（rules/repealed/ に移す）';
    return `${changedCount(e) ?? 0}条を改正`;
  };

  const zip = () => {
    const files: Record<string, Uint8Array> = {};
    for (const f of ex.files) files[f.path] = strToU8(f.content);
    files['commit-message.txt'] = strToU8(info.message);
    if (ex.deletes.length) files['delete.txt'] = strToU8(ex.deletes.join('\n') + '\n');
    if (withPending)
      for (const f of pendingFiles(proposal, info, ex)) files[f.path] = strToU8(f.content);
    const name = `${formatRuleId(proposal.amendingNumber)}.zip`;
    downloadBlob(
      name,
      new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    );
    showToast(`${name} をダウンロードしました`);
  };

  return (
    <>
      <h2>書き出し</h2>
      {!proposal.enforcementDate && (
        <div className="issue warn" style={{ maxWidth: 720 }}>
          <span className="lv">注意</span>施行日が決まっていません。「
          <Link to="/file/info">情報</Link>」で入力してください。
        </div>
      )}
      {lintErrors > 0 && (
        <div className="issue error" style={{ maxWidth: 720 }}>
          <span className="lv">エラー</span>書式チェックのエラーが{lintErrors}
          件あります。書き出しはできますが、ポータルで表示が崩れるおそれがあります。
        </div>
      )}
      <div className="export-opts">
        <section className="prop-card">
          <h3 className="bs-h" style={{ marginTop: 0 }}>
            <Upload className="i" aria-hidden="true" /> ルールのファイル
          </h3>
          <table className="list">
            <tbody>
              {ex.files.map((f) => (
                <tr key={f.path}>
                  <td>
                    <code>{f.path}</code>
                    <div className="muted">
                      {f.name || '（名称未設定）'}・{status(f.entryId)}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => void copyText(f.content, showToast)}
                    >
                      コピー
                    </button>{' '}
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        downloadBlob(
                          f.path.split('/').pop()!,
                          new Blob([f.content], { type: 'text/markdown' }),
                        )
                      }
                    >
                      ダウンロード
                    </button>
                  </td>
                </tr>
              ))}
              {ex.unchanged.map((u) => (
                <tr key={u.entryId}>
                  <td>
                    <span className="muted">{u.name}・変更なし（書き出しません）</span>
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {ex.deletes.length > 0 && (
            <p className="muted">
              元の場所から消すファイル：<code>{ex.deletes.join('、')}</code>（コマンド例の{' '}
              <code>git rm</code>）
            </p>
          )}
          {future && (
            <label className="muted" style={{ display: 'block', marginTop: 8 }}>
              <input
                type="checkbox"
                checked={withPending}
                onChange={(e) => setWithPending(e.target.checked)}
              />{' '}
              施行前としてポータルに載せるための{' '}
              <code>pending/{formatRuleId(proposal.amendingNumber)}/</code> 一式も入れる
            </label>
          )}
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn primary"
              disabled={ex.files.length === 0}
              onClick={zip}
            >
              まとめてダウンロード（zip）
            </button>
          </div>
          <p className="muted">
            zip には、リポジトリと同じパスで変更のあるルールのファイルと commit-message.txt
            が入ります
            {ex.deletes.length ? '（廃止があるので delete.txt も）' : ''}。
          </p>
        </section>
        <section className="prop-card">
          <h3 className="bs-h" style={{ marginTop: 0 }}>
            <Code className="i" aria-hidden="true" /> コミット情報
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            ds-craft/rules の改正履歴の決まり（作者＝改正ルール番号、日時＝施行日
            0時）に合わせています。
          </p>
          <div className="field">
            <label htmlFor="cm-subject">件名</label>
            <input
              id="cm-subject"
              type="text"
              style={{ width: '100%' }}
              value={info.subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <textarea
            readOnly
            aria-label="コミットメッセージ"
            value={info.message}
            style={{
              width: '100%',
              height: 170,
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: 13,
            }}
          />
          <div className="row-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => void copyText(info.message, showToast)}
            >
              コピー
            </button>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="muted">コミットのコマンド例</summary>
            <pre className="code">{command}</pre>
            <button
              type="button"
              className="btn small"
              onClick={() => void copyText(command, showToast)}
            >
              コピー
            </button>
          </details>
        </section>
        <section className="prop-card">
          <h3 className="bs-h" style={{ marginTop: 0 }}>
            <Cloud className="i" aria-hidden="true" /> GitHub に直接反映
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            アプリからの発議と、可決後の自動反映は、サーバーの準備ができてから使えるようになります。
          </p>
          <button type="button" className="btn" disabled>
            発議する
          </button>
        </section>
      </div>
    </>
  );
}
