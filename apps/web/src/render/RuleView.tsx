// ポータル風の表示（閲覧モード・後の対照表で使う）。portal と同じ DOM 構造・クラスを出す。

import { formatRuleNumber, type Inline, type RuleDoc } from '@rule-builder/core';
import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import {
  layoutRule,
  type LawArticle,
  type LawHeading,
  type LawLine,
  type LawSection,
} from './layout.ts';

/** ポータルのルールページの場所（相対リンクの解決に使う）。 */
export const PORTAL_RULE_BASE = 'https://www.ds2.uk/rule/';

export function InlineView({ inlines }: { inlines: readonly Inline[] }): ReactNode {
  return inlines.map((n, i) =>
    n.kind === 'text' ? (
      <Fragment key={i}>{n.value}</Fragment>
    ) : (
      <a
        key={i}
        href={n.href.startsWith('#') ? n.href : new URL(n.href, PORTAL_RULE_BASE).href}
        title={n.title}
        target={n.href.startsWith('#') ? undefined : '_blank'}
        rel="noreferrer"
      >
        <InlineView inlines={n.children} />
      </a>
    ),
  );
}

function Line({ line }: { line: LawLine }) {
  return (
    <p className={`law-line law-line--${line.kind}`} data-line={line.key}>
      <InlineView inlines={line.inlines} />
    </p>
  );
}

function Heading({ h }: { h: LawHeading }) {
  const Tag = h.tag;
  return (
    <Tag id={h.anchor} data-key={h.key} data-general={h.general ? 'true' : undefined}>
      {h.text}
    </Tag>
  );
}

function ArticleView({ a, generalOnly }: { a: LawArticle; generalOnly: boolean }) {
  const [shown, setShown] = useState(false);
  // portal：一般向けでない条は「一般向け条文のみ表示」のとき本文を隠し、「表示」のチェックで出す
  const hideable = !!a.heading && !a.general && a.lines.length > 0;
  const hidden = hideable && generalOnly && !shown;
  return (
    <article className="article">
      {a.heading && <Heading h={a.heading} />}
      {hideable && generalOnly && (
        <label className="dads-checkbox show-non-general" data-size="sm">
          <span className="dads-checkbox__checkbox">
            <input
              type="checkbox"
              className="dads-checkbox__input"
              checked={shown}
              onChange={(e) => setShown(e.target.checked)}
            />
          </span>
          <span className="dads-checkbox__label">表示</span>
        </label>
      )}
      {!hidden && a.lines.map((l, i) => <Line key={i} line={l} />)}
    </article>
  );
}

function SectionView({ s, generalOnly }: { s: LawSection; generalOnly: boolean }) {
  return (
    <section className={s.className}>
      {s.heading && <Heading h={s.heading} />}
      {s.lines.map((l, i) => (
        <Line key={i} line={l} />
      ))}
      {s.items.map((it, i) =>
        it.type === 'heading' ? (
          <Heading key={i} h={it.heading} />
        ) : (
          <ArticleView key={i} a={it} generalOnly={generalOnly} />
        ),
      )}
    </section>
  );
}

export function LawTitle({ doc, onClick }: { doc: RuleDoc; onClick?: () => void }) {
  const number = formatRuleNumber(doc.meta);
  return (
    <div className="law-title" onClick={onClick}>
      {number && <p className="law-number">{number}</p>}
      <h1>{doc.meta.name || '（名称未設定）'}</h1>
    </div>
  );
}

/** 同じ文書内のリンク（#…）は紙面の中で移動する。 */
export function scrollToAnchor(root: HTMLElement, anchor: string) {
  const el = root.querySelector(`[id="${CSS.escape(anchor)}"]`);
  el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export function RuleView({
  doc,
  sections: given,
  generalOnly = false,
  onTitleClick,
}: {
  doc: RuleDoc;
  /** 計算済みのレイアウト（無ければここで作る） */
  sections?: LawSection[];
  generalOnly?: boolean;
  onTitleClick?: () => void;
}) {
  const computed = useMemo(() => (given ? null : layoutRule(doc)), [doc, given]);
  const sections = given ?? computed ?? [];
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (href?.startsWith('#')) {
      e.preventDefault();
      scrollToAnchor(e.currentTarget, decodeURIComponent(href.slice(1)));
    }
  };
  return (
    <div className="rb-portal rule-view" onClick={onClick}>
      <LawTitle doc={doc} onClick={onTitleClick} />
      {sections.map((s, i) => (
        <SectionView key={i} s={s} generalOnly={generalOnly} />
      ))}
    </div>
  );
}
