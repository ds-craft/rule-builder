// 紙面のエディタ。ポータルの見た目のまま、Word と同じ感覚で文言を書き換える。

import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor } from '@tiptap/react';
import { articleSignature, listArticles, parseRule } from '@rule-builder/core';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
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
  const ctx = useCommandContext();
  useEffect(() => {
    editorHandlers.insertArticle = () => getCommand('article-after').run(ctx);
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
          baseSignatures,
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
      onBlur() {
        setMini(null);
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

  const onContextMenu = (e: MouseEvent) => {
    if (!editor || entry.readOnly) return;
    e.preventDefault();
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (pos && editor.state.selection.empty) editor.commands.setTextSelection(pos.pos);
    const inArticle = !!articleCursor(editor.state);
    const items: MenuItem[] = [
      ...(inArticle ? [{ type: 'heading' as const, text: cursorLocation(editor.state) }] : []),
      { type: 'command', id: 'link', label: '条文へのリンク…' },
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
    </div>
  );
}
