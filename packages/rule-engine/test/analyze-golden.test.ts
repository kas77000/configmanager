import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFile } from '../src/parse-file';
import { analyze } from '../src/analysis/analyze';

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, 'fixtures', 'ai.fixmsg.properties'), 'utf8');

describe('golden analysis: ai.fixmsg.properties', () => {
  const findings = analyze(parseFile(text));

  it('runs without throwing and returns findings', () => {
    expect(Array.isArray(findings)).toBe(true);
  });

  it('flags exactly the two known typo fields (low false-positive rate)', () => {
    const unknown = findings.filter((f) => f.code === 'unknown-field');
    expect(unknown.map((f) => f.lineNumber).sort((a, b) => a - b)).toEqual([205, 239]);
  });

  it('flags the identical-condition redundancy at lines 15 and 16', () => {
    const redundant = findings.find(
      (f) => f.code === 'redundant-conditions' && f.lineNumber === 16 && f.relatedLineNumbers?.includes(15),
    );
    expect(redundant).toBeDefined();
  });

  it('produces findings sorted by line number', () => {
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i].lineNumber).toBeGreaterThanOrEqual(findings[i - 1].lineNumber);
    }
  });
});
