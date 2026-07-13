# Rule Engine — Parsing & Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure TypeScript library that parses `ai.fixmsg.properties` into a structured, analyzable rule model — with zero runtime dependencies and no I/O.

**Architecture:** A standalone npm-workspaces package `packages/rule-engine`. Parsing is split into small pure functions: `splitConditions`, `parsePredicate`, `parseOutputs`, `parseRule`, and `parseFile`. Each is independently unit-tested; a golden test runs the whole thing against the real config file. This library is later imported by the backend (Plan 3) and reused (via the same types) by the front-end (Plan 4).

**Tech Stack:** Node.js 20+, TypeScript 5, Vitest 2, npm workspaces.

**Domain reminder (from the spec, §5.1):** the trading engine evaluates rules top-to-bottom, every matching rule fires and *accumulates* tags, and a `tag9012(X)` condition sees tags injected by *earlier* rules. This plan only builds the *model*; the analysis that uses this model is Plan 2. But the model must capture exactly what analysis needs: each rule's **output tag keys** (which tags it sets) and its **conditions** (as structured predicates where possible, opaque where not).

---

## File Structure

```
package.json                 (root — npm workspaces)
tsconfig.base.json           (shared TS config)
vitest.config.ts             (root — runs all package tests)
packages/rule-engine/
  package.json
  tsconfig.json
  src/
    types.ts                 (all shared types)
    split-conditions.ts      (comma-split respecting <js> blocks)
    parse-predicate.ts       (one condition -> Predicate)
    parse-outputs.ts         (LHS -> OutputSegment[])
    parse-rule.ts            (one line -> Rule)
    parse-file.ts            (whole file -> ParsedFile)
    index.ts                 (public exports)
  test/
    fixtures/ai.fixmsg.properties   (copy of the real file)
    split-conditions.test.ts
    parse-predicate.test.ts
    parse-outputs.test.ts
    parse-rule.test.ts
    parse-file.test.ts
    golden.test.ts
```

Each source file has one responsibility. `types.ts` is the single source of truth for shapes shared across the whole system.

---

### Task 1: Scaffold the workspace and rule-engine package

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/rule-engine/package.json`
- Create: `packages/rule-engine/tsconfig.json`
- Create: `packages/rule-engine/src/index.ts`
- Test: `packages/rule-engine/test/smoke.test.ts`

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "configuration-manager",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `packages/rule-engine/package.json`**

```json
{
  "name": "@config-manager/rule-engine",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 5: Create `packages/rule-engine/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create a placeholder `packages/rule-engine/src/index.ts`**

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 7: Write a smoke test at `packages/rule-engine/test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index';

describe('smoke', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 8: Install dependencies**

Run (from repo root): `npm install`
Expected: dependencies install, `node_modules` and `package-lock.json` created.

- [ ] **Step 9: Run the smoke test**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts packages/rule-engine .gitignore
git commit -m "chore: scaffold npm workspace and rule-engine package"
```

(Also create a `.gitignore` containing `node_modules` and `dist` before committing.)

---

### Task 2: Define the shared types

**Files:**
- Create: `packages/rule-engine/src/types.ts`
- Test: `packages/rule-engine/test/types.test.ts`

- [ ] **Step 1: Write a test that constructs each type (compile + shape check)**

`packages/rule-engine/test/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Predicate, OutputSegment, Rule, ParsedFile } from '../src/types';

describe('types', () => {
  it('can construct a structured predicate', () => {
    const p: Predicate = {
      raw: 'compositeExchangeCode=AU^HK',
      field: 'compositeExchangeCode',
      operator: '=',
      values: ['AU', 'HK'],
      opaque: false,
    };
    expect(p.values).toEqual(['AU', 'HK']);
  });

  it('can construct an opaque predicate', () => {
    const p: Predicate = { raw: '<js> _param.size() < 1 </js>', opaque: true };
    expect(p.opaque).toBe(true);
    expect(p.field).toBeUndefined();
  });

  it('can construct a rule with output tag keys', () => {
    const seg: OutputSegment = { raw: '9012=164=0^LOR=0', channel: '9012', tagKeys: ['164', 'LOR'] };
    const rule: Rule = {
      kind: 'rule',
      lineNumber: 132,
      raw: '9012=164=0^LOR=0 :: compositeExchangeCode=HK',
      enabled: true,
      outputs: [seg],
      outputTagKeys: ['164', 'LOR'],
      conditions: [],
    };
    const file: ParsedFile = { rules: [rule] };
    expect(file.rules[0].outputTagKeys).toContain('LOR');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/rule-engine/test/types.test.ts`
Expected: FAIL — cannot find module `../src/types`.

- [ ] **Step 3: Create `packages/rule-engine/src/types.ts`**

```ts
export type Severity = 'error' | 'warning' | 'info';

export type Operator = '=' | '!=' | '<' | '>' | '<=' | '>=' | '~' | '!~';

/** One condition on the right-hand side of a rule (`field op value^value`). */
export interface Predicate {
  /** Original text of this predicate, trimmed. */
  raw: string;
  /** Left-hand field, e.g. "compositeExchangeCode" or "tag9012(164)". Undefined when opaque. */
  field?: string;
  operator?: Operator;
  /** Values split on '^' (an OR-list). Undefined when opaque. */
  values?: string[];
  /** True when the predicate involves <js> or a regex (`~`/`!~`) and cannot be reasoned about. */
  opaque: boolean;
}

/** One segment of the left-hand (output) side, e.g. "9012=164=0^LOR=0" or "9001=VWAP". */
export interface OutputSegment {
  raw: string;
  /** The channel key before the first '=', e.g. "9012", "9001", "9060". */
  channel?: string;
  /** Best-effort sub-tag keys this segment sets, e.g. ["164","LOR"]. For non-9012 channels this is [channel]. */
  tagKeys: string[];
}

export type RuleKind = 'rule' | 'directive' | 'unparseable';

export interface Rule {
  kind: RuleKind;
  /** 1-based line number in the source file. */
  lineNumber: number;
  /** The original, untrimmed line text. */
  raw: string;
  /** False when the rule is commented out (a leading '#'). */
  enabled: boolean;
  /** Preceding prose comment block attached to this rule, if any. */
  comment?: string;
  outputs: OutputSegment[];
  /** Union of all segment tagKeys — the tags this rule sets. */
  outputTagKeys: string[];
  conditions: Predicate[];
}

export interface ParsedFile {
  /** All rules in file order, including directive/unparseable/disabled entries. */
  rules: Rule[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/rule-engine/test/types.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/types.ts packages/rule-engine/test/types.test.ts
git commit -m "feat(rule-engine): add core model types"
```

---

### Task 3: `splitConditions` — split the RHS on commas, respecting `<js>` blocks

Conditions are comma-separated, **but** an inline `<js> ... </js>` block may itself contain commas (see line 490). The splitter must not break inside a `<js>` block.

**Files:**
- Create: `packages/rule-engine/src/split-conditions.ts`
- Test: `packages/rule-engine/test/split-conditions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/rule-engine/test/split-conditions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitConditions } from '../src/split-conditions';

describe('splitConditions', () => {
  it('splits a simple AND-list and trims each part', () => {
    expect(splitConditions('clientAlgorithm=SENSATOLOWALPHA, marketCapUSD >= 10000'))
      .toEqual(['clientAlgorithm=SENSATOLOWALPHA', 'marketCapUSD >= 10000']);
  });

  it('does not split on commas inside a <js> block', () => {
    const rhs = 'basket~.*SSGA.*, <js> _param.size() < _stock.adv() * 0.03, ok </js>, adv > 0';
    expect(splitConditions(rhs)).toEqual([
      'basket~.*SSGA.*',
      '<js> _param.size() < _stock.adv() * 0.03, ok </js>',
      'adv > 0',
    ]);
  });

  it('drops empty segments', () => {
    expect(splitConditions('a=1, , b=2')).toEqual(['a=1', 'b=2']);
  });

  it('returns an empty array for a blank string', () => {
    expect(splitConditions('   ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/rule-engine/test/split-conditions.test.ts`
Expected: FAIL — cannot find module `../src/split-conditions`.

- [ ] **Step 3: Implement `packages/rule-engine/src/split-conditions.ts`**

```ts
/** Splits a right-hand condition string on top-level commas, ignoring commas inside <js> ... </js>. */
export function splitConditions(rhs: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < rhs.length) {
    if (rhs.startsWith('<js>', i)) { depth++; current += '<js>'; i += 4; continue; }
    if (rhs.startsWith('</js>', i)) { depth = Math.max(0, depth - 1); current += '</js>'; i += 5; continue; }
    const ch = rhs[i];
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; i++; continue; }
    current += ch;
    i++;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/rule-engine/test/split-conditions.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/split-conditions.ts packages/rule-engine/test/split-conditions.test.ts
git commit -m "feat(rule-engine): split conditions respecting <js> blocks"
```

---

### Task 4: `parsePredicate` — parse one condition into a `Predicate`

Detects two-character operators (`!=`, `<=`, `>=`, `!~`) before single-character ones (`=`, `<`, `>`, `~`), splits values on `^`, and marks regex/`<js>` predicates opaque.

**Files:**
- Create: `packages/rule-engine/src/parse-predicate.ts`
- Test: `packages/rule-engine/test/parse-predicate.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/rule-engine/test/parse-predicate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePredicate } from '../src/parse-predicate';

describe('parsePredicate', () => {
  it('parses a simple equality with an OR-list', () => {
    expect(parsePredicate('compositeExchangeCode=AU^HK^JP')).toEqual({
      raw: 'compositeExchangeCode=AU^HK^JP',
      field: 'compositeExchangeCode',
      operator: '=',
      values: ['AU', 'HK', 'JP'],
      opaque: false,
    });
  });

  it('parses a not-equal with an OR-list on a tag field', () => {
    const p = parsePredicate('tag9012(42)!=1^5');
    expect(p.field).toBe('tag9012(42)');
    expect(p.operator).toBe('!=');
    expect(p.values).toEqual(['1', '5']);
    expect(p.opaque).toBe(false);
  });

  it('parses numeric comparisons and trims whitespace', () => {
    expect(parsePredicate('marketCapUSD >= 10000')).toMatchObject({
      field: 'marketCapUSD', operator: '>=', values: ['10000'],
    });
    expect(parsePredicate('start_to_close < 0')).toMatchObject({
      field: 'start_to_close', operator: '<', values: ['0'],
    });
  });

  it('parses a null guard', () => {
    expect(parsePredicate('tag9012(164)=null')).toMatchObject({
      field: 'tag9012(164)', operator: '=', values: ['null'],
    });
  });

  it('marks regex predicates opaque but still records field/operator', () => {
    const p = parsePredicate('basket~.*SSGA.*');
    expect(p.field).toBe('basket');
    expect(p.operator).toBe('~');
    expect(p.opaque).toBe(true);
  });

  it('marks a bare <js> predicate opaque with no field', () => {
    const p = parsePredicate('<js> _param.size() < 1 </js>');
    expect(p.opaque).toBe(true);
    expect(p.field).toBeUndefined();
    expect(p.operator).toBeUndefined();
  });

  it('marks a predicate with no operator opaque', () => {
    const p = parsePredicate('somethingWeird');
    expect(p.opaque).toBe(true);
    expect(p.field).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/rule-engine/test/parse-predicate.test.ts`
Expected: FAIL — cannot find module `../src/parse-predicate`.

- [ ] **Step 3: Implement `packages/rule-engine/src/parse-predicate.ts`**

```ts
import type { Operator, Predicate } from './types';

const TWO_CHAR_OPS: Operator[] = ['!=', '<=', '>=', '!~'];
const ONE_CHAR_OPS: Operator[] = ['=', '<', '>', '~'];

/** Finds the earliest operator in the string, preferring two-character operators. */
function findOperator(s: string): { op: Operator; index: number } | null {
  for (const candidates of [TWO_CHAR_OPS, ONE_CHAR_OPS]) {
    let best: { op: Operator; index: number } | null = null;
    for (const op of candidates) {
      const idx = s.indexOf(op);
      if (idx > 0 && (best === null || idx < best.index)) best = { op, index: idx };
    }
    if (best) return best;
  }
  return null;
}

/** Parses a single condition string into a Predicate. Never throws. */
export function parsePredicate(raw0: string): Predicate {
  const raw = raw0.trim();
  if (raw.includes('<js>')) return { raw, opaque: true };

  const found = findOperator(raw);
  if (!found) return { raw, opaque: true };

  const field = raw.slice(0, found.index).trim();
  const valueStr = raw.slice(found.index + found.op.length).trim();
  const values = valueStr.split('^').map((v) => v.trim());
  const opaque = found.op === '~' || found.op === '!~';
  return { raw, field, operator: found.op, values, opaque };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/rule-engine/test/parse-predicate.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/parse-predicate.ts packages/rule-engine/test/parse-predicate.test.ts
git commit -m "feat(rule-engine): parse a single condition predicate"
```

---

### Task 5: `parseOutputs` — parse the LHS into `OutputSegment[]`

Splits the left side on top-level `;` (respecting `<js>`), then for each `9012=` segment extracts sub-tag keys (split on `^`, take the text before each `=`). Never throws; anything unrecognized keeps `tagKeys: []`.

**Files:**
- Create: `packages/rule-engine/src/parse-outputs.ts`
- Test: `packages/rule-engine/test/parse-outputs.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/rule-engine/test/parse-outputs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseOutputs } from '../src/parse-outputs';

describe('parseOutputs', () => {
  it('extracts 9012 sub-tag keys', () => {
    const segs = parseOutputs('9012=164=0^LOR=0');
    expect(segs).toHaveLength(1);
    expect(segs[0].channel).toBe('9012');
    expect(segs[0].tagKeys).toEqual(['164', 'LOR']);
  });

  it('handles a compound output with multiple channels', () => {
    const segs = parseOutputs('9001=VWAP;9012=92=S,5^6=8');
    expect(segs.map((s) => s.channel)).toEqual(['9001', '9012']);
    expect(segs[0].tagKeys).toEqual(['9001']);
    expect(segs[1].tagKeys).toEqual(['92', '6']);
  });

  it('keeps a KO output as a single 9012 key', () => {
    const segs = parseOutputs('9012=KO=arrowst+orders+without+79+tag');
    expect(segs[0].tagKeys).toEqual(['KO']);
  });

  it('handles a trailing semicolon without producing empty tag keys', () => {
    const segs = parseOutputs('9001=LINE;');
    expect(segs[0].tagKeys).toEqual(['9001']);
    // trailing empty segment contributes no keys
    expect(segs.flatMap((s) => s.tagKeys)).toEqual(['9001']);
  });

  it('does not split on ^ inside a <js> output value', () => {
    const segs = parseOutputs('9012=ERB=<js>"" + (1^2) </js>');
    expect(segs[0].channel).toBe('9012');
    expect(segs[0].tagKeys).toEqual(['ERB']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/rule-engine/test/parse-outputs.test.ts`
Expected: FAIL — cannot find module `../src/parse-outputs`.

- [ ] **Step 3: Implement `packages/rule-engine/src/parse-outputs.ts`**

```ts
import type { OutputSegment } from './types';

/** Splits `s` on top-level occurrences of `sep`, ignoring separators inside <js> ... </js>. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('<js>', i)) { depth++; current += '<js>'; i += 4; continue; }
    if (s.startsWith('</js>', i)) { depth = Math.max(0, depth - 1); current += '</js>'; i += 5; continue; }
    if (s[i] === sep && depth === 0) { parts.push(current); current = ''; i++; continue; }
    current += s[i];
    i++;
  }
  parts.push(current);
  return parts;
}

/** Parses the left-hand (output) side of a rule into segments with best-effort tag keys. Never throws. */
export function parseOutputs(lhs: string): OutputSegment[] {
  return splitTopLevel(lhs, ';').map((seg0): OutputSegment => {
    const raw = seg0.trim();
    if (raw.length === 0) return { raw, tagKeys: [] };
    const eq = raw.indexOf('=');
    if (eq === -1) return { raw, tagKeys: [] };
    const channel = raw.slice(0, eq).trim();
    const body = raw.slice(eq + 1);
    if (channel === '9012') {
      const tagKeys = splitTopLevel(body, '^')
        .map((part) => {
          const e = part.indexOf('=');
          return (e === -1 ? part : part.slice(0, e)).trim();
        })
        .filter((k) => k.length > 0 && !k.includes('<js>'));
      return { raw, channel, tagKeys };
    }
    return { raw, channel, tagKeys: [channel] };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/rule-engine/test/parse-outputs.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/parse-outputs.ts packages/rule-engine/test/parse-outputs.test.ts
git commit -m "feat(rule-engine): parse output segments and tag keys"
```

---

### Task 6: `parseRule` — parse one line into a `Rule`

Splits on `::`, detects disabled (`#`) rules and the include directive, and assembles a `Rule` from `parseOutputs` + `splitConditions` + `parsePredicate`.

**Files:**
- Create: `packages/rule-engine/src/parse-rule.ts`
- Test: `packages/rule-engine/test/parse-rule.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/rule-engine/test/parse-rule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRule } from '../src/parse-rule';

describe('parseRule', () => {
  it('parses an enabled rule with outputs and conditions', () => {
    const rule = parseRule('9012=164=0^LOR=0 :: compositeExchangeCode=HK, tag9012(LOR)=null', 133);
    expect(rule.kind).toBe('rule');
    expect(rule.enabled).toBe(true);
    expect(rule.lineNumber).toBe(133);
    expect(rule.outputTagKeys).toEqual(['164', 'LOR']);
    expect(rule.conditions).toHaveLength(2);
    expect(rule.conditions[0]).toMatchObject({ field: 'compositeExchangeCode', values: ['HK'] });
    expect(rule.conditions[1]).toMatchObject({ field: 'tag9012(LOR)', values: ['null'] });
  });

  it('marks a commented-out rule as disabled but still parses it', () => {
    const rule = parseRule('#9012=11=0 :: passive_only=2, wouldVenue>0', 50);
    expect(rule.enabled).toBe(false);
    expect(rule.kind).toBe('rule');
    expect(rule.outputTagKeys).toEqual(['11']);
    expect(rule.conditions).toHaveLength(2);
  });

  it('classifies the include line as a directive', () => {
    const rule = parseRule('internal_config_include_files: data/ai.tag155.properties', 1);
    expect(rule.kind).toBe('directive');
    expect(rule.conditions).toEqual([]);
  });

  it('attaches a provided comment', () => {
    const rule = parseRule('9012=144=1 :: compositeExchangeCode=KS', 368, 'Eric 2020.06.10 add 144=1 for Korea');
    expect(rule.comment).toBe('Eric 2020.06.10 add 144=1 for Korea');
  });

  it('treats a line with outputs but no recognizable tag keys as unparseable', () => {
    const rule = parseRule('garbage-without-tags :: a=1', 999);
    expect(rule.kind).toBe('unparseable');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/rule-engine/test/parse-rule.test.ts`
Expected: FAIL — cannot find module `../src/parse-rule`.

- [ ] **Step 3: Implement `packages/rule-engine/src/parse-rule.ts`**

```ts
import type { Rule, RuleKind } from './types';
import { parseOutputs } from './parse-outputs';
import { splitConditions } from './split-conditions';
import { parsePredicate } from './parse-predicate';

const DIRECTIVE_PREFIX = 'internal_config_include_files';

/** Parses a single source line into a Rule. Never throws. */
export function parseRule(rawLine: string, lineNumber: number, comment?: string): Rule {
  const trimmed = rawLine.trim();

  let enabled = true;
  let work = trimmed;
  if (work.startsWith('#')) {
    enabled = false;
    work = work.replace(/^#+/, '').trim();
  }

  if (work.startsWith(DIRECTIVE_PREFIX)) {
    return {
      kind: 'directive', lineNumber, raw: rawLine, enabled, comment,
      outputs: [], outputTagKeys: [], conditions: [],
    };
  }

  const sepIdx = work.indexOf('::');
  const lhs = sepIdx === -1 ? work : work.slice(0, sepIdx);
  const rhs = sepIdx === -1 ? '' : work.slice(sepIdx + 2);

  const outputs = parseOutputs(lhs);
  const conditions = rhs.trim().length ? splitConditions(rhs).map(parsePredicate) : [];
  const outputTagKeys = Array.from(new Set(outputs.flatMap((s) => s.tagKeys)));

  const kind: RuleKind = outputs.some((s) => s.tagKeys.length > 0) ? 'rule' : 'unparseable';

  return { kind, lineNumber, raw: rawLine, enabled, comment, outputs, outputTagKeys, conditions };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/rule-engine/test/parse-rule.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/parse-rule.ts packages/rule-engine/test/parse-rule.test.ts
git commit -m "feat(rule-engine): parse a single rule line"
```

---

### Task 7: `parseFile` — parse the whole file into a `ParsedFile`

Iterates lines, classifies each (blank / prose-comment / directive / rule), attaches the preceding prose comment block to the following rule, and preserves file order. Discriminator: a line is a **rule** iff its de-`#`'d content contains `::`.

**Files:**
- Create: `packages/rule-engine/src/parse-file.ts`
- Modify: `packages/rule-engine/src/index.ts`
- Test: `packages/rule-engine/test/parse-file.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/rule-engine/test/parse-file.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/parse-file';

const SAMPLE = [
  'internal_config_include_files: data/ai.tag155.properties',
  '',
  '#Sensato Algo Wheel Low Alpha',
  '9001=VWAP;9012=92=S,5^6=8 :: clientAlgorithm=SENSATOLOWALPHA, orderSizeADV < 0.07',
  '',
  '9012=144=1 :: compositeExchangeCode=KS',
  '#9012=11=0 :: passive_only=2, wouldVenue>0',
].join('\n');

describe('parseFile', () => {
  it('parses rules and preserves line numbers', () => {
    const { rules } = parseFile(SAMPLE);
    // directive + 3 rule lines (the two prose/blank lines are not rules)
    const ruleLines = rules.filter((r) => r.kind === 'rule');
    expect(ruleLines.map((r) => r.lineNumber)).toEqual([4, 6, 7]);
  });

  it('classifies the directive', () => {
    const { rules } = parseFile(SAMPLE);
    expect(rules[0].kind).toBe('directive');
    expect(rules[0].lineNumber).toBe(1);
  });

  it('attaches a preceding prose comment to the next rule', () => {
    const { rules } = parseFile(SAMPLE);
    const sensato = rules.find((r) => r.lineNumber === 4);
    expect(sensato?.comment).toBe('Sensato Algo Wheel Low Alpha');
  });

  it('marks the commented-out rule disabled', () => {
    const { rules } = parseFile(SAMPLE);
    const disabled = rules.find((r) => r.lineNumber === 7);
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.kind).toBe('rule');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/rule-engine/test/parse-file.test.ts`
Expected: FAIL — cannot find module `../src/parse-file`.

- [ ] **Step 3: Implement `packages/rule-engine/src/parse-file.ts`**

```ts
import type { ParsedFile } from './types';
import { parseRule } from './parse-rule';

const DIRECTIVE_PREFIX = 'internal_config_include_files';

/** Parses the full file text into a ParsedFile, preserving order and attaching prose comments. */
export function parseFile(text: string): ParsedFile {
  const lines = text.split(/\r?\n/);
  const rules: ParsedFile['rules'] = [];
  let pendingComment: string[] = [];

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      pendingComment = [];
      return;
    }

    if (trimmed.startsWith(DIRECTIVE_PREFIX)) {
      rules.push(parseRule(line, lineNumber, pendingComment.join('\n') || undefined));
      pendingComment = [];
      return;
    }

    const deHash = trimmed.startsWith('#') ? trimmed.replace(/^#+/, '').trim() : trimmed;
    const isRule = deHash.includes('::');

    if (!isRule) {
      if (trimmed.startsWith('#')) pendingComment.push(deHash);
      return;
    }

    const comment = pendingComment.length ? pendingComment.join('\n') : undefined;
    rules.push(parseRule(line, lineNumber, comment));
    pendingComment = [];
  });

  return { rules };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/rule-engine/test/parse-file.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Update `packages/rule-engine/src/index.ts` to export the public API**

```ts
export const VERSION = '0.1.0';

export * from './types';
export { splitConditions } from './split-conditions';
export { parsePredicate } from './parse-predicate';
export { parseOutputs } from './parse-outputs';
export { parseRule } from './parse-rule';
export { parseFile } from './parse-file';
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add packages/rule-engine/src/parse-file.ts packages/rule-engine/src/index.ts packages/rule-engine/test/parse-file.test.ts
git commit -m "feat(rule-engine): parse the full file into a model"
```

---

### Task 8: Golden test against the real `ai.fixmsg.properties`

Proves the parser survives the real 605-line file and models known lines correctly. This is the regression net for Plan 2.

**Files:**
- Create: `packages/rule-engine/test/fixtures/ai.fixmsg.properties` (copy of the real file)
- Test: `packages/rule-engine/test/golden.test.ts`

- [ ] **Step 1: Copy the real config file into the fixtures folder**

Run (Windows PowerShell, from repo root):
```powershell
New-Item -ItemType Directory -Force packages/rule-engine/test/fixtures
Copy-Item "ai.fixmsg.properties" "packages/rule-engine/test/fixtures/ai.fixmsg.properties"
```
Expected: the fixture file exists.

- [ ] **Step 2: Write the golden test**

`packages/rule-engine/test/golden.test.ts`:

```ts
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
    // Report offending lines to make failures actionable.
    expect(bad.map((r) => `${r.lineNumber}: ${r.raw}`)).toEqual([]);
  });

  it('models the first directive line', () => {
    expect(rules[0]).toMatchObject({ kind: 'directive', lineNumber: 1 });
  });

  it('captures a known guard rule and its output tags', () => {
    // Line: 9012=164=0^LOR=0 :: compositeExchangeCode=HK, tag9012(LOR)=null  (around line 133)
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
```

- [ ] **Step 3: Run the golden test**

Run: `npx vitest run packages/rule-engine/test/golden.test.ts`
Expected: PASS. If "has no unparseable enabled rules" fails, the assertion prints the offending `line: raw` pairs — inspect them: either fix the parser for a real format we missed, or (if it is a genuinely malformed line in the source) adjust the assertion to allow that specific known line with a comment explaining why.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/test/fixtures packages/rule-engine/test/golden.test.ts
git commit -m "test(rule-engine): golden parse of real ai.fixmsg.properties"
```

---

## Self-Review

**Spec coverage (against spec §5.2 Parse model):**
- "outputs — structured where possible, raw kept" → Task 5 (`OutputSegment.raw` + `tagKeys`). ✓
- "conditions — field·operator·value(s), `^` OR-list, special forms `tag9012`, `<js>`" → Tasks 3–4. ✓
- "metadata: line number, comment, enabled/disabled" → Tasks 6–7. ✓
- "`!`-prefixed override directives recognized as special case, don't change model" → handled implicitly: `!RLMOO` becomes an ordinary tag key like `!RLMOO`; parser does not choke. ✓ (Deeper `!` semantics belong to Plan 2 analysis, not the model.)
- Evaluation model (§5.1) is documented in the plan header and captured structurally via `outputTagKeys` + ordered `rules`; it is *used* in Plan 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command and expected result. ✓

**Type consistency:** `Predicate`, `OutputSegment`, `Rule`, `ParsedFile` defined in Task 2 and used identically in Tasks 3–8. Function names stable: `splitConditions`, `parsePredicate`, `parseOutputs`, `parseRule`, `parseFile`. `outputTagKeys` used consistently everywhere. ✓

**Out-of-scope confirms:** analysis/findings (Tier 1/2/3) are deliberately **not** here — they are Plan 2, which imports this library's `ParsedFile`. ✓
