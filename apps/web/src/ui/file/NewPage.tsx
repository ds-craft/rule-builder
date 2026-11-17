import { useTemplatePicker } from './HomePage.tsx';
import { TemplateList } from './templates.tsx';

export function NewPage() {
  const pick = useTemplatePicker();
  return (
    <>
      <h2>新規</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        作りたいものを選んでください。改正ルール番号と施行日を入れると、すぐに編集を始められます。
      </p>
      <TemplateList onPick={pick} />
    </>
  );
}
