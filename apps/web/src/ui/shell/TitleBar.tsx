import { Cloud } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export type SaveState = 'saved' | 'saving' | null;

/** タイトルバー：アプリ名、中央のタイトル（エディタではルールの切り替えボタン）、保存状態。 */
export function TitleBar({ center, save = null }: { center: ReactNode; save?: SaveState }) {
  return (
    <header className="titlebar">
      <Link className="brand" to="/file/home" title="ホーム">
        rule-builder
      </Link>
      <span className="doc-title">{center}</span>
      {save && (
        <span className="save" aria-live="polite">
          <Cloud className="i" aria-hidden="true" />
          {save === 'saving' ? '保存中…' : '保存済み'}
        </span>
      )}
    </header>
  );
}
