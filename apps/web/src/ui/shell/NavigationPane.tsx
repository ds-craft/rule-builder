// ナビゲーション：検索欄と目次。検索語があるときは目次の代わりに結果一覧を出す（F-19）。

import { Search, X } from 'lucide-react';
import { useMemo } from 'react';
import { searchLines, tocItems, type LawSection } from '../../render/layout.ts';
import { useApp } from '../../state/store.ts';

export function NavigationPane({
  sections,
  onGoHeading,
  onGoLine,
  activeKey,
  articleMarks = null,
}: {
  sections: LawSection[];
  onGoHeading: (key: string) => void;
  onGoLine: (key: string) => void;
  activeKey?: string | null;
  /** 条ごとの変更（文書の条の順）。改正中のルールで変更箇所を表示するとき */
  articleMarks?: ('new' | 'changed' | null)[] | null;
}) {
  const search = useApp((s) => s.ui.search);
  const setUi = useApp((s) => s.setUi);
  const toc = useMemo(() => tocItems(sections), [sections]);
  const hits = useMemo(() => searchLines(sections, search), [sections, search]);

  return (
    <nav className="nav" aria-label="ナビゲーション">
      <div className="ph">
        ナビゲーション
        <button type="button" aria-label="閉じる" onClick={() => setUi({ nav: false })}>
          <X className="i" aria-hidden="true" />
        </button>
      </div>
      <label className="search">
        <Search className="i" aria-hidden="true" />
        <input
          type="search"
          id="navsearch"
          placeholder="文書を検索"
          aria-label="文書を検索"
          value={search}
          onChange={(e) => setUi({ search: e.target.value })}
        />
      </label>
      <div className="pbody">
        {search.trim() ? (
          <>
            <p className="muted" style={{ margin: '0 0 6px' }}>
              {hits.length}件の結果
            </p>
            <ul className="navlist">
              {hits.map((h, i) => (
                <li className="res" key={i}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onGoLine(h.lineKey);
                    }}
                  >
                    <b>{h.label}</b>
                    <br />…{h.before}
                    <mark>{h.match}</mark>
                    {h.after}…
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="navlist">
            {toc.map((t) => (
              <li className={`lv${Math.min(t.level, 4)}`} key={t.key}>
                <a
                  href="#"
                  className={activeKey === t.key ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    onGoHeading(t.key);
                  }}
                >
                  {t.text}
                  {t.articleIndex !== undefined && articleMarks?.[t.articleIndex] && (
                    <span
                      className={'chg' + (articleMarks[t.articleIndex] === 'new' ? ' new' : '')}
                      title={
                        articleMarks[t.articleIndex] === 'new' ? '新しく追加した条' : '変更した条'
                      }
                    />
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
        {!search.trim() && articleMarks && (
          <p className="muted" style={{ marginTop: 12 }}>
            ●は変更した条（緑は追加した条）
          </p>
        )}
      </div>
    </nav>
  );
}
