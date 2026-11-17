import { Link } from 'react-router';
import { TemplateList } from './templates.tsx';

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは';
}

export function RecentList() {
  // 最近使った改正案（Phase 5 でブラウザ内の保存から読む）
  return <p className="muted">まだ改正案はありません。</p>;
}

export function HomePage() {
  return (
    <>
      <h2>{greeting()}</h2>
      <h3 className="bs-h">新規</h3>
      <TemplateList keys={['create-ルール', 'amend', 'blank']} />
      <p>
        <Link to="/file/new">その他の種類 →</Link>
      </p>
      <h3 className="bs-h">最近使った改正案</h3>
      <RecentList />
      <p className="muted">
        改正案はこのブラウザに自動で保存されます。ほかの運営者から受け取った下書きファイルは「
        <Link to="/file/open">開く</Link>
        」から開けます。公開中のルールの閲覧も「開く」からできます。
      </p>
    </>
  );
}
