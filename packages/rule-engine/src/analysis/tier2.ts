import type { Finding, Rule } from '../types';
import { hasOnlySimpleConditions, ruleRegionSubset } from './constraints';

const GUARD_RE = /^tag9012\((.+)\)$/;

/**
 * Flags rules that are unreachable because an earlier rule always sets the tag they guard on.
 * A rule B with a `tag9012(X)=null` condition is dead if some earlier rule A sets X and B's
 * whole matching region lies inside A's region (so A always fired first and set X).
 * A must have only simple conditions, else we cannot prove it fired — kept deliberately conservative.
 */
export function detectDeadRules(enabled: Rule[]): Finding[] {
  const findings: Finding[] = [];

  for (const b of enabled) {
    let reported = false;
    for (const g of b.conditions) {
      if (reported) break;
      if (g.opaque || !g.field || g.operator !== '=') continue;
      if (!g.values || g.values.length !== 1 || g.values[0] !== 'null') continue;
      const m = GUARD_RE.exec(g.field);
      if (!m) continue;
      const tag = m[1];

      for (const a of enabled) {
        if (a.lineNumber >= b.lineNumber) continue;
        if (!a.outputTagKeys.includes(tag)) continue;
        if (!hasOnlySimpleConditions(a)) continue;
        if (ruleRegionSubset(b, a)) {
          findings.push({
            severity: 'error',
            code: 'dead-rule',
            message:
              `Line ${b.lineNumber} is unreachable: it only applies when tag9012(${tag}) is unset, ` +
              `but line ${a.lineNumber} already sets tag ${tag} for every order this rule would match.`,
            lineNumber: b.lineNumber,
            relatedLineNumbers: [a.lineNumber],
          });
          reported = true;
          break;
        }
      }
    }
  }
  return findings;
}

/** Normalized signature of a rule's conditions (whitespace-insensitive, order-insensitive). */
function conditionSignature(rule: Rule): string {
  return rule.conditions
    .map((c) => c.raw.replace(/\s+/g, ''))
    .sort()
    .join('|');
}

/**
 * Flags pairs of enabled rules with identical conditions that both set a shared tag —
 * the later rule's value wins, so one of them is redundant or silently conflicting.
 */
export function detectRedundant(enabled: Rule[]): Finding[] {
  const groups = new Map<string, Rule[]>();
  for (const r of enabled) {
    const sig = conditionSignature(r);
    if (sig === '') continue; // unconditional rules are too broad to call redundant
    const arr = groups.get(sig) ?? [];
    arr.push(r);
    groups.set(sig, arr);
  }

  const findings: Finding[] = [];
  for (const rules of groups.values()) {
    if (rules.length < 2) continue;
    const sorted = [...rules].sort((a, b) => a.lineNumber - b.lineNumber);
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      for (let j = 0; j < i; j++) {
        const prev = sorted[j];
        const shared = cur.outputTagKeys.filter((k) => prev.outputTagKeys.includes(k));
        if (shared.length > 0) {
          findings.push({
            severity: 'warning',
            code: 'redundant-conditions',
            message:
              `Line ${cur.lineNumber} has the same conditions as line ${prev.lineNumber} and both set ` +
              `tag(s) ${shared.join(', ')}; the later value wins, so one may be redundant or conflicting.`,
            lineNumber: cur.lineNumber,
            relatedLineNumbers: [prev.lineNumber],
          });
          break;
        }
      }
    }
  }
  return findings;
}
