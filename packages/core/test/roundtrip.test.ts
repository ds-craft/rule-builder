import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRule, serializeRule } from '../src/index.ts';

const FIXTURES = join(import.meta.dirname, '../../../test/fixtures/rules');

function listMarkdown(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return listMarkdown(p);
    return f.endsWith('.md') && f !== 'SOURCE.md' ? [p] : [];
  });
}

const files = listMarkdown(FIXTURES);

describe('Markdown の往復（全フィクスチャ）', () => {
  it('フィクスチャがある', () => {
    expect(files.length).toBeGreaterThanOrEqual(23);
  });

  for (const file of files) {
    const name = relative(FIXTURES, file).replaceAll('\\', '/');
    it(name, () => {
      const md = readFileSync(file, 'utf8');
      const { doc, warnings } = parseRule(md);
      expect(warnings).toEqual([]);
      expect(JSON.stringify(doc.body)).not.toContain('"type":"raw"');
      expect(serializeRule(doc)).toBe(md);
    });
  }
});
