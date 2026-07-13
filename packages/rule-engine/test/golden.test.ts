import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFile } from '../src/parse-file';

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, 'fixtures', 'ai.fixmsg.properties'), 'utf8');

describe('golden: ai.fixmsg.properties', () => {
  const { rules } = parseFile(text);

  it('parses a substantial number of rules without throwing', () => {
    const ruleCount = rules.filter((r) => r.kind === 'rule').length;
    expect(ruleCount).toBeGreaterThan(300);
  });

  it('has no unparseable enabled rules', () => {
    const bad = rules.filter((r) => r.kind === 'unparseable' && r.enabled);
    expect(bad.map((r) => `${r.lineNumber}: ${r.raw}`)).toEqual([]);
  });

  it('models the first directive line', () => {
    expect(rules[0]).toMatchObject({ kind: 'directive', lineNumber: 1 });
  });

  it('captures a known guard rule and its output tags', () => {
    const guard = rules.find(
      (r) => r.outputTagKeys.includes('164') && r.outputTagKeys.includes('LOR') && r.enabled &&
        r.conditions.some((c) => c.field === 'tag9012(LOR)'),
    );
    expect(guard).toBeDefined();
  });

  it('marks the SSGA <js> rule condition opaque', () => {
    const jsRule = rules.find((r) => r.raw.includes('_stock.adv() * 0.03'));
    expect(jsRule).toBeDefined();
    expect(jsRule!.conditions.some((c) => c.opaque)).toBe(true);
  });
});
