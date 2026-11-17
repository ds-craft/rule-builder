import { describe, expect, it } from 'vitest';
import type { Article, RuleDoc } from '../model/types.ts';
import { parseInline, serializeInline } from './inline.ts';
import { parseRule } from './parse.ts';
import { serializeRule } from './serialize.ts';

const FM = `---
layout: rule
permalink: /rule/R0801004.html
order: 9
title: テストルール
rule_name: テストルール
rule_number: 令和8年ルール第4号
enforcement_date: 令和8年12月1日
category: ルール
og_description: テストルール(令和8年ルール第4号)
---
`;

describe('インライン', () => {
  it('リンク（title 付き）', () => {
    const src = '前に[第8条](R0701002.html#第8条（窃盗の禁止） "現：第8条")に基づき';
    const inl = parseInline(src);
    expect(inl).toEqual([
      { kind: 'text', value: '前に' },
      {
        kind: 'link',
        href: 'R0701002.html#第8条（窃盗の禁止）',
        title: '現：第8条',
        children: [{ kind: 'text', value: '第8条' }],
      },
      { kind: 'text', value: 'に基づき' },
    ]);
    expect(serializeInline(inl)).toBe(src);
  });
  it('記法の文字は文字として保持する', () => {
    expect(parseInline('*強調*と_下線_')).toEqual([{ kind: 'text', value: '*強調*と_下線_' }]);
  });
});

describe('パーサー', () => {
  it('front matter を書誌情報にする', () => {
    const { doc } = parseRule(FM);
    expect(doc.meta).toMatchObject({
      kind: 'ルール',
      year: 8,
      number: 4,
      name: 'テストルール',
      enforcementDate: '2026-12-01',
      order: 9,
      extra: {},
    });
    expect(doc.meta.format?.overrides).toEqual({});
  });

  it('項・号・細分の木にする（番号は持たない）', () => {
    const md = `${FM}
##### 第1条（定義）
{: data-general="true"}

①　第一項
一　第一号
イ　細分
ロ　細分2
二　第二号
②　第二項
`;
    const { doc, warnings } = parseRule(md);
    expect(warnings).toEqual([]);
    const a = doc.body[0] as Article;
    expect(a.num).toEqual({ main: 1, branches: [] });
    expect(a.caption).toBe('定義');
    expect(a.general).toBe(true);
    expect(a.paragraphs).toHaveLength(2);
    expect(a.paragraphs[0]!.items).toHaveLength(2);
    expect(a.paragraphs[0]!.items[0]!.subitems).toHaveLength(2);
    expect(serializeRule(doc)).toBe(md);
  });

  it('項のない条は本文を第1項にする', () => {
    const md = `${FM}
##### 第1条

　本文です。
一　号
`;
    const a = parseRule(md).doc.body[0] as Article;
    expect(a.paragraphs).toEqual([
      {
        text: [{ kind: 'text', value: '本文です。' }],
        items: [{ text: [{ kind: 'text', value: '号' }], subitems: [] }],
      },
    ]);
  });

  it('削除した条', () => {
    const md = `${FM}
##### 第4条

　本文。

##### 第5条　削除

##### 第6条

　本文。
`;
    const { doc, warnings } = parseRule(md);
    expect(warnings).toEqual([]);
    const a = doc.body[1] as Article;
    expect(a.deleted).toBe(true);
    expect(a.paragraphs).toEqual([]);
    expect(serializeRule(doc)).toBe(md);
  });

  it('解釈できない見出しは RawLine として残し、警告を出す', () => {
    const md = `${FM}
## よくわからない見出し

##### 第1条

　本文。
`;
    const { doc, warnings } = parseRule(md);
    expect(doc.body[0]).toMatchObject({ type: 'raw', source: '## よくわからない見出し' });
    expect(warnings).toHaveLength(1);
    expect(serializeRule(doc)).toBe(md);
  });

  it('CRLF は LF にそろえる', () => {
    const md = `${FM}\n##### 第1条\n\n　本文。\n`;
    expect(serializeRule(parseRule(md.replaceAll('\n', '\r\n')).doc)).toBe(md);
  });
});

describe('シリアライザー', () => {
  it('新規のルールは既定のキー順で書き出す', () => {
    const doc: RuleDoc = {
      meta: {
        kind: 'ルール',
        year: 8,
        number: 4,
        name: 'テストルール',
        enforcementDate: '2026-12-01',
        order: 9,
        extra: {},
      },
      body: [
        {
          type: 'article',
          num: { main: 1, branches: [] },
          caption: '',
          general: false,
          deleted: false,
          paragraphs: [{ text: [{ kind: 'text', value: '本文。' }], items: [] }],
        },
      ],
    };
    expect(serializeRule(doc)).toBe(`${FM}\n##### 第1条\n\n　本文。\n`);
  });

  it('廃止のキーは enforcement_date の直後に入る', () => {
    const { doc } = parseRule(FM);
    doc.meta.extra.repealed_date = '令和9年1月1日';
    doc.meta.extra.repealed_by = 'R0901001';
    expect(serializeRule(doc)).toContain(
      'enforcement_date: 令和8年12月1日\nrepealed_date: 令和9年1月1日\nrepealed_by: R0901001\ncategory: ルール',
    );
  });

  it('国内法は rule_number を空にし、og_description は名称だけ', () => {
    const { doc } = parseRule(FM);
    doc.meta.kind = '国内法';
    doc.meta.year = 4;
    doc.meta.number = 1;
    const out = serializeRule(doc);
    expect(out).toContain('permalink: /rule/R0410001.html');
    expect(out).toContain('rule_number: ""');
    expect(out).toContain('og_description: テストルール\n');
  });
});
