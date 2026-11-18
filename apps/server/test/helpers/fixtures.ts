// テスト用：test/fixtures の過去の改正と、公開中のルール一式。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', 'test', 'fixtures');

export const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

/** 公開中のルール一式（基本ルールだけ令和8年ルール第2号の改正前に戻す） */
export function remoteFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const dir = join(ROOT, 'rules', 'rules');
  for (const f of readdirSync(dir)) if (f.endsWith('.md')) files[`rules/${f}`] = read('rules', 'rules', f);
  const rep = join(dir, 'repealed');
  for (const f of readdirSync(rep)) {
    if (f.endsWith('.md')) files[`rules/repealed/${f}`] = read('rules', 'rules', 'repealed', f);
  }
  files['rules/R0701001.md'] = read('commits', 'R0801002-before-R0701001.md');
  return files;
}
