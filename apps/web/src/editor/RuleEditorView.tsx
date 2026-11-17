// 紙面のエディタ。ポータルの見た目のまま、Word と同じ感覚で文言を書き換える。

import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor } from '@tiptap/react';
import { articleSignature, listArticles, parseRule, parseRuleHref } from '@rule-builder/core';
import { ExternalLink, Pencil, Unlink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { docAnchors } from './checks.ts';
import { entryRuleId, lintRuleIndex, loadLinkIndex, useLinkIndex } from '../github/linkIndex.ts';
import { useSettings } from '../state/settings.ts';
import { linkRangeAt, portalUrl } from '../ui/common/linkDialog.tsx';
import { refreshLint } from './lint.ts';
import { getCommand } from '../commands/registry.ts';
import { useCommandContext } from '../commands/useCommandContext.ts';
import { LawTitle } from '../render/RuleView.tsx';
import { useApp, type OpenEntry } from '../state/store.ts';
import { Menu, MiniToolbar, type MenuItem } from '../ui/common/Menu.tsx';
import { bumpEditorVersion, editorHandlers, setActiveEditor } from './activeEditor.ts';
import { articleCursor, cursorLocation } from './commands.ts';
import { bodyFromPM, type PMNode } from './convert.ts';
import { RuleEditing } from './RuleEditing.ts';
import { schemaExtensions } from './schema.ts';

/** エディタの変更をモデルの写しに反映するまでの待ち時間 */
const SYNC_DELAY_MS = 250;

export function RuleEditorView({
  entry,
  hidden,
  onTitleClick,
}: {
  entry: OpenEntry;
  /** 閲覧モードのときは隠す（履歴を残すため作り直さない） */
  hidden: boolean;
  onTitleClick: () => void;
}) {
  const showToast = useApp((s) => s.showToast);
  const updateBody = useApp((s) => s.updateBody);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [mini, setMini] = useState<DOMRect | null>(null);
  /** カーソルのあるリンク（飛び先を出し、変更・解除できる） */
  const [bubble, setBubble] = useState<{ rect: DOMRect; href: string } | null>(null);
  const ctx = useCommandContext();
  useEffect(() => {
    editorHandlers.insertArticle = () => getCommand('article-after').run(ctx);
    editorHandlers.link = () => {
      const c = getCommand('link');
      if (c.enabled?.(ctx) ?? true) c.run(ctx);
      else showToast('リンクにしたい文字を選んでから実行してください');
    };
  });

  // 改正前の条の中身（変更箇所の表示に使う）
  const baseSignatures = useMemo(
    () =>
      entry.op === 'amend'
        ? listArticles(parseRule(entry.baseMarkdown).doc.body).map(articleSignature)
        : null,
    [entry.op, entry.baseMarkdown],
  );
  const editor = useEditor(
    {
      extensions: [
        ...schemaExtensions,
        Collaboration.configure({
          fragment: entry.fragment,
          yUndoOptions: { undoManager: entry.undo },
        }),
        RuleEditing.configure({
          notify: showToast,
          getUndoManager: () => entry.undo,
          onInsertArticle: () => editorHandlers.insertArticle(),
          onLink: () => editorHandlers.link(),
          baseSignatures,
          lintContext: () => {
            const { status, rules } = useLinkIndex.getState();
            return {
              ruleId: entryRuleId(
                useApp.getState().entries.find((e) => e.key === entry.key) ?? entry,
              ),
              rules: lintRuleIndex(
                status === 'ready' ? rules : null,
                useApp.getState().entries,
                (e) => docAnchors(e.doc),
              ),
            };
          },
          autoFullwidth: () => useSettings.getState().autoFullwidth,
        }),
      ],
      editable: !entry.readOnly,
      editorProps: {
        attributes: {
          class: 'rb-editor',
          spellcheck: 'false',
          'aria-label': `${entry.doc.meta.name}の本文`,
        },
      },
      onUpdate({ editor }) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          updateBody(entry.key, bodyFromPM(editor.getJSON() as PMNode));
        }, SYNC_DELAY_MS);
      },
      onTransaction() {
        bumpEditorVersion();
      },
      onSelectionUpdate({ editor }) {
        const { selection } = editor.state;
        const link = linkRangeAt(editor.state);
        if (link) {
          try {
            const a = editor.view.coordsAtPos(link.from);
            setBubble({
              rect: new DOMRect(a.left, a.top, 1, a.bottom - a.top),
              href: link.mark!.attrs.href as string,
            });
          } catch {
            setBubble(null);
          }
        } else setBubble(null);
        if (selection.empty) setMini(null);
        else {
          try {
            const a = editor.view.coordsAtPos(selection.from);
            setMini(new DOMRect(a.left, a.top, 1, a.bottom - a.top));
          } catch {
            setMini(null);
          }
        }
      },
      onBlur({ event }) {
        // 吹き出しのボタンを押したときは消さない
        const to = (event as FocusEvent).relatedTarget as Node | null;
        if (to && (to as Element).closest?.('.mini')) return;
        setMini(null);
        setBubble(null);
      },
    },
    [entry.key],
  );

  // entry はモデルの写しが変わるたびに作り直されるため、文書のキーと UndoManager だけに依存する
  const { key, undo } = entry;
  useEffect(() => {
    if (!editor) return;
    setActiveEditor(editor);
    const bump = () => bumpEditorVersion();
    undo.on('stack-item-added', bump);
    undo.on('stack-item-popped', bump);
    const t = timer;
    return () => {
      undo.off('stack-item-added', bump);
      undo.off('stack-item-popped', bump);
      setActiveEditor(null);
      if (t.current) {
        clearTimeout(t.current);
        t.current = null;
        updateBody(key, bodyFromPM(editor.getJSON() as PMNode));
      }
    };
  }, [editor, key, undo, updateBody]);

  // 公開中のルールの一覧が届いたら、リンク切れを調べ直す
  const indexStatus = useLinkIndex((s) => s.status);
  useEffect(() => {
    void loadLinkIndex();
  }, []);
  useEffect(() => {
    if (editor && !editor.isDestroyed && indexStatus === 'ready') refreshLint(editor.view);
  }, [editor, indexStatus]);

  const onContextMenu = (e: MouseEvent) => {
    if (!editor || entry.readOnly) return;
    e.preventDefault();
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (pos && editor.state.selection.empty) editor.commands.setTextSelection(pos.pos);
    const inArticle = !!articleCursor(editor.state);
    const items: MenuItem[] = [
      ...(inArticle ? [{ type: 'heading' as const, text: cursorLocation(editor.state) }] : []),
      {
        type: 'command',
        id: 'link',
        label: linkRangeAt(editor.state) ? 'リンクの変更…' : '条文へのリンク…',
      },
      ...(linkRangeAt(editor.state) ? [{ type: 'command' as const, id: 'unlink' }] : []),
      { type: 'separator' },
      { type: 'command', id: 'add-para', label: '項を追加' },
      { type: 'command', id: 'add-item', label: '号を追加' },
      { type: 'command', id: 'promote' },
      { type: 'command', id: 'demote' },
      { type: 'separator' },
      { type: 'command', id: 'article-before', label: '前に条を挿入…' },
      { type: 'command', id: 'article-after', label: '後に条を挿入…' },
      {
        type: 'command',
        id: 'general',
        label: articleCursor(editor.state)?.article.attrs.general
          ? '一般向けを解除'
          : '一般向け条文にする',
      },
      articleCursor(editor.state)?.article.attrs.deleted
        ? { type: 'command', id: 'art-undel' }
        : { type: 'command', id: 'art-del', label: 'この条を削除…' },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div className="rb-portal rule-edit" hidden={hidden} onContextMenu={onContextMenu}>
      <div className="law-title-edit" title="クリックして名称・番号・施行日を確認">
        <LawTitle doc={entry.doc} onClick={onTitleClick} />
      </div>
      <EditorContent editor={editor} />
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {mini && !hidden && !menu && <MiniToolbar rect={mini} commands={['link']} />}
      {bubble && !mini && !hidden && !menu && (
        <LinkBubble rect={bubble.rect} href={bubble.href} selfId={entryRuleId(entry)} />
      )}
    </div>
  );
}

/** リンクにカーソルを置いたときの吹き出し（飛び先・変更・解除・ポータルで開く） */
function LinkBubble({ rect, href, selfId }: { rect: DOMRect; href: string; selfId: string }) {
  const ctx = useCommandContext();
  const rules = useLinkIndex((s) => s.rules);
  const t = parseRuleHref(href);
  const rule = t?.ruleId && t.ruleId !== selfId ? rules.find((r) => r.id === t.ruleId) : null;
  const where = !t
    ? href
    : `${t.ruleId && t.ruleId !== selfId ? (rule?.name ?? t.ruleId) : 'このルール'}${t.anchor ? ' ' + t.anchor : ''}`;
  const run = (id: string) => getCommand(id).run(ctx);
  return (
    <div
      className="mini link-bubble no-print"
      style={{ left: Math.max(8, rect.left), top: rect.bottom + 6 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="where" title={href}>
        リンク先：{where}
      </span>
      <a
        href={portalUrl(href, selfId)}
        target="_blank"
        rel="noreferrer"
        title="ポータルで開く"
        aria-label="ポータルで開く"
      >
        <ExternalLink className="i" aria-hidden="true" />
      </a>
      <button type="button" title="リンクの変更" onClick={() => run('link')}>
        <Pencil className="i" aria-hidden="true" />
        変更
      </button>
      <button type="button" title="リンクを解除" onClick={() => run('unlink')}>
        <Unlink className="i" aria-hidden="true" />
        解除
      </button>
    </div>
  );
}
