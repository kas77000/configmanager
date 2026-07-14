import type { Finding, Predicate, Rule } from '../types';
import { KNOWN_FIELDS, isTagLikeField } from './field-dictionary';

/** Flags condition fields that are not in the known-field dictionary (likely typos). */
export function checkUnknownFields(rule: Rule): Finding[] {
  const findings: Finding[] = [];
  for (const c of rule.conditions) {
    if (c.opaque || !c.field) continue;
    if (isTagLikeField(c.field)) continue;
    if (!KNOWN_FIELDS.has(c.field)) {
      findings.push({
        severity: 'warning',
        code: 'unknown-field',
        message: `Unknown condition field "${c.field}" — likely a typo (not in the known-field dictionary).`,
        lineNumber: rule.lineNumber,
      });
    }
  }
  return findings;
}

function isNumericValue(s: string): boolean {
  return s.trim() !== '' && Number.isFinite(Number(s));
}

/** Flags rules whose conditions can never all be true simultaneously. */
export function checkSelfContradiction(rule: Rule): Finding[] {
  const byField = new Map<string, Predicate[]>();
  for (const c of rule.conditions) {
    if (c.opaque || !c.field || !c.operator || !c.values) continue;
    const arr = byField.get(c.field) ?? [];
    arr.push(c);
    byField.set(c.field, arr);
  }

  const findings: Finding[] = [];
  for (const [field, preds] of byField) {
    const reason = contradictionReason(field, preds);
    if (reason) {
      findings.push({
        severity: 'error',
        code: 'self-contradiction',
        message: `Line ${rule.lineNumber} can never match: ${reason}.`,
        lineNumber: rule.lineNumber,
      });
    }
  }
  return findings;
}

function contradictionReason(field: string, preds: Predicate[]): string | null {
  const hasNullEq = preds.some((p) => p.operator === '=' && p.values!.length === 1 && p.values![0] === 'null');
  const hasNullNe = preds.some((p) => p.operator === '!=' && p.values!.length === 1 && p.values![0] === 'null');
  if (hasNullEq && hasNullNe) return `"${field}" is required to be both null and not-null`;

  const allNumeric = preds.every((p) => p.values!.every(isNumericValue));
  if (allNumeric) {
    let lo = -Infinity, loInc = false, hi = Infinity, hiInc = false;
    const eqVals = new Set<number>();
    for (const p of preds) {
      if (p.values!.length !== 1) continue; // OR-list: skip for interval
      const v = Number(p.values![0]);
      switch (p.operator) {
        case '<': if (v < hi || (v === hi && hiInc)) { hi = v; hiInc = false; } break;
        case '<=': if (v < hi) { hi = v; hiInc = true; } break;
        case '>': if (v > lo || (v === lo && loInc)) { lo = v; loInc = false; } break;
        case '>=': if (v > lo) { lo = v; loInc = true; } break;
        case '=': eqVals.add(v); if (v > lo) { lo = v; loInc = true; } if (v < hi) { hi = v; hiInc = true; } break;
      }
    }
    if (eqVals.size > 1) return `"${field}" is set equal to multiple different values`;
    if (lo > hi) return `"${field}" is bounded to an empty range`;
    if (lo === hi && (!loInc || !hiInc)) return `"${field}" is bounded to an empty range`;
    return null;
  }

  // Categorical: intersection of '=' value-sets must be non-empty.
  let allow: Set<string> | undefined;
  for (const p of preds) {
    if (p.operator === '=') {
      const vs = new Set(p.values!);
      allow = allow ? new Set([...allow].filter((x) => vs.has(x))) : vs;
    }
  }
  if (allow && allow.size === 0) return `"${field}" is constrained to disjoint values`;
  return null;
}
