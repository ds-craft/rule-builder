// 新規作成のテンプレート（Word の「新規」の白紙・テンプレートに相当）。

import { FileText, Pencil, Plus, type LucideIcon } from 'lucide-react';

export type TemplateKey =
  'create-ルール' | 'amend' | 'create-ルール施行令' | 'create-国内法' | 'blank';

export type Template = {
  key: TemplateKey;
  icon: LucideIcon;
  title: string;
  desc: string;
  lines: number[];
};

export const TEMPLATES: Template[] = [
  {
    key: 'create-ルール',
    icon: FileText,
    title: '新しいルールを制定',
    desc: 'ルールを一から作る',
    lines: [70, 90, 85, 60],
  },
  {
    key: 'amend',
    icon: Pencil,
    title: '既存のルールを改正',
    desc: '公開中のルールを直す',
    lines: [80, 90, 50, 85],
  },
  {
    key: 'create-ルール施行令',
    icon: FileText,
    title: 'ルール施行令を制定',
    desc: '施行令を一から作る',
    lines: [60, 85, 75],
  },
  {
    key: 'create-国内法',
    icon: FileText,
    title: '国内法を制定',
    desc: '国内法を一から作る',
    lines: [75, 65, 90],
  },
  { key: 'blank', icon: Plus, title: '空の改正案', desc: '番号と施行日だけ先に決める', lines: [] },
];

export function TemplateList({
  keys,
  onPick,
}: {
  keys?: TemplateKey[];
  /** 未指定なら押せない（準備中） */
  onPick?: (key: TemplateKey) => void;
}) {
  const list = keys ? TEMPLATES.filter((t) => keys.includes(t.key)) : TEMPLATES;
  return (
    <div className="tpls">
      {list.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            className="tpl"
            disabled={!onPick}
            title={onPick ? undefined : '準備中です'}
            onClick={() => onPick?.(t.key)}
          >
            <span className="thumb">
              {t.lines.map((w, i) => (
                <i key={i} style={{ width: `${w}%` }} />
              ))}
              <span className="badge">
                <Icon className="i" aria-hidden="true" />
              </span>
            </span>
            <span className="tl">{t.title}</span>
            <span className="td">{t.desc}</span>
          </button>
        );
      })}
    </div>
  );
}
