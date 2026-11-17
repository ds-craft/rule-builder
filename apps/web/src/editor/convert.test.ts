import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseRule, serializeRule } from '@rule-builder/core';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { bodyFromPM, bodyToPM, type PMNode } from './convert.ts';
import { schemaExtensions } from './schema.ts';

const FIXTURES = join(import.meta.dirname, '../../../../test/fixtures/rules');
const schema = getSchema(schemaExtensions);

function listMarkdown(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return listMarkdown(p);
    return f.endsWith('.md') && f !== 'SOURCE.md' ? [p] : [];
  });
}

describe('Markdown → モデル → エディタ → モデル → Markdown の往復', () => {
  for (const file of listMarkdown(FIXTURES)) {
    it(relative(FIXTURES, file).replaceAll('\\', '/'), () => {
      const md = readFileSync(file, 'utf8');
      const { doc } = parseRule(md);
      const node = schema.nodeFromJSON(bodyToPM(doc.body));
      node.check();
      const back = bodyFromPM(node.toJSON() as PMNode);
      expect(serializeRule({ meta: doc.meta, body: back })).toBe(md);
    });
  }
});
