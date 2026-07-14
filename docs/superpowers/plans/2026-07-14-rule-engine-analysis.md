# Rule Engine — Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On top of Plan 1's model, produce `Finding[]` that warn when a change is redundant or makes another rule unreachable — the "one condition outshines another" feature.

**Architecture:** Pure functions in `packages/rule-engine/src/analysis/`. Tier 1 checks each rule in isolation; Tier 2 reasons across rules using a small constraint algebra (categorical sets + numeric intervals). Opaque predicates (`<js>`, regex) are never used to prove a rule dead — the engine stays conservative to avoid false alarms.

**Tech Stack:** TypeScript, Vitest (same package as Plan 1).

## File Structure

```
packages/rule-engine/src/
  types.ts                    (add: Finding)
  analysis/
    field-dictionary.ts       (known field allow-list + isTagLikeField)
    constraints.ts            (FieldConstraint, buildConstraints, fieldSubset, ruleRegionSubset)
    tier1.ts                  (checkUnknownFields, checkSelfContradiction)
    tier2.ts                  (detectDeadRules, detectRedundant)
    analyze.ts                (analyze(ParsedFile) -> Finding[])
  index.ts                    (export analyze + Finding)
```

## Findings model

`Finding = { severity: 'error'|'warning'|'info'; code: string; message: string; lineNumber: number; relatedLineNumbers?: number[] }`

Codes & severities:
- `unknown-field` — **warning** (dictionary may be incomplete; still surfaces typos like `oderValueUSD`, `echangeCode`).
- `self-contradiction` — **error** (conditions can never all hold: numeric interval empty, or disjoint equality, or `=null` & `!=null`).
- `dead-rule` — **error** (rule requires `tag9012(X)=null` but an earlier all-simple rule that sets `X` covers its whole region).
- `redundant-conditions` — **warning** (two enabled rules with identical conditions both set a shared tag; later value wins).

## Conservative rules (must hold)
1. Only **simple predicates** (non-opaque, plain non-tag field, has operator) feed the constraint algebra.
2. `dead-rule` requires the *earlier* rule `A` to have **only simple conditions**, so "B's region ⊆ A's region" truly implies A fired. Any opaque/tag-guard condition on A ⇒ skip (no false "dead").
3. Numeric subset bails if A has numeric `=`/`!=` (not a clean range).

## Tasks (TDD, one commit each)
1. Add `Finding` type + `field-dictionary.ts` (the 68 known fields from the real file, excluding the two typos; `isTagLikeField`). Test: known field passes, `echangeCode` fails, `tag9012(164)` is tag-like.
2. `constraints.ts` — `buildConstraints`, `fieldSubset`, `ruleRegionSubset`. Tests: numeric interval subset, categorical allow/deny subset, non-subset cases.
3. `tier1.ts` — `checkUnknownFields`, `checkSelfContradiction`. Tests: typo flagged; `orderSizeADV<0.07` & `>=0.15` → error; `=null` & `!=null` → error; clean rule → none.
4. `tier2.ts` — `detectDeadRules`, `detectRedundant`. Tests: crafted dead rule (unconditional setter then guarded rule) → error; identical-condition pair sharing a tag → warning; opaque earlier rule → no false dead.
5. `analyze.ts` + exports. Golden test over the real file: unknown-field lines are exactly `[205, 239]`; a `redundant-conditions` finding relates lines 15 & 16; `analyze` never throws.
