import type { Predicate, Rule } from '../types';
import { isTagLikeField } from './field-dictionary';

export interface NumericConstraint {
  kind: 'numeric';
  lo: number;
  loInc: boolean;
  hi: number;
  hiInc: boolean;
  /** True if a numeric '=' or '!=' predicate is present (range reasoning is then incomplete). */
  hasEqOrNe: boolean;
}

export interface CategoricalConstraint {
  kind: 'categorical';
  /** Intersection of all '=' value-sets; undefined means "any value allowed". */
  allow?: Set<string>;
  /** Union of all '!=' value-sets. */
  deny: Set<string>;
}

export type FieldConstraint = NumericConstraint | CategoricalConstraint;

function isNumeric(s: string): boolean {
  if (s.trim() === '') return false;
  return Number.isFinite(Number(s));
}

/** Non-opaque predicates with a plain (non-tag) field and an operator. */
export function simplePredicates(rule: Rule): Predicate[] {
  return rule.conditions.filter(
    (c) => !c.opaque && !!c.field && !!c.operator && !!c.values && !isTagLikeField(c.field),
  );
}

/** True when every condition of the rule is a simple predicate (nothing opaque or tag-based). */
export function hasOnlySimpleConditions(rule: Rule): boolean {
  return rule.conditions.every(
    (c) => !c.opaque && !!c.field && !!c.operator && !!c.values && !isTagLikeField(c.field),
  );
}

/** Builds one FieldConstraint per field from a rule's simple predicates. */
export function buildConstraints(rule: Rule): Map<string, FieldConstraint> {
  const byField = new Map<string, Predicate[]>();
  for (const p of simplePredicates(rule)) {
    const arr = byField.get(p.field!) ?? [];
    arr.push(p);
    byField.set(p.field!, arr);
  }

  const out = new Map<string, FieldConstraint>();
  for (const [field, preds] of byField) {
    const allNumeric = preds.every((p) => p.values!.every(isNumeric));
    if (allNumeric) {
      out.set(field, buildNumeric(preds));
    } else {
      out.set(field, buildCategorical(preds));
    }
  }
  return out;
}

function buildNumeric(preds: Predicate[]): NumericConstraint {
  let lo = -Infinity;
  let loInc = false;
  let hi = Infinity;
  let hiInc = false;
  let hasEqOrNe = false;

  const tightenUpper = (v: number, inc: boolean) => {
    if (v < hi || (v === hi && !inc)) { hi = v; hiInc = inc; }
  };
  const tightenLower = (v: number, inc: boolean) => {
    if (v > lo || (v === lo && !inc)) { lo = v; loInc = inc; }
  };

  for (const p of preds) {
    const multi = p.values!.length > 1;
    const v = Number(p.values![0]);
    switch (p.operator) {
      case '<': tightenUpper(v, false); break;
      case '<=': tightenUpper(v, true); break;
      case '>': tightenLower(v, false); break;
      case '>=': tightenLower(v, true); break;
      case '=':
        hasEqOrNe = true;
        if (!multi) { tightenLower(v, true); tightenUpper(v, true); }
        break;
      case '!=':
        hasEqOrNe = true;
        break;
    }
  }
  return { kind: 'numeric', lo, loInc, hi, hiInc, hasEqOrNe };
}

function buildCategorical(preds: Predicate[]): CategoricalConstraint {
  let allow: Set<string> | undefined;
  const deny = new Set<string>();
  for (const p of preds) {
    if (p.operator === '=') {
      const vs = new Set(p.values!);
      allow = allow ? new Set([...allow].filter((x) => vs.has(x))) : vs;
    } else if (p.operator === '!=') {
      for (const v of p.values!) deny.add(v);
    }
  }
  return { kind: 'categorical', allow, deny };
}

/** True when B's region for a single field is a subset of A's region for that field. */
export function fieldSubset(b: FieldConstraint, a: FieldConstraint): boolean {
  if (a.kind !== b.kind) return false;

  if (a.kind === 'numeric' && b.kind === 'numeric') {
    if (a.hasEqOrNe) return false; // A is not a clean range; cannot prove containment
    const lowerOK = b.lo > a.lo || (b.lo === a.lo && (a.loInc || !b.loInc));
    const upperOK = b.hi < a.hi || (b.hi === a.hi && (a.hiInc || !b.hiInc));
    return lowerOK && upperOK;
  }

  if (a.kind === 'categorical' && b.kind === 'categorical') {
    if (a.allow) {
      if (!b.allow) return false;
      for (const v of b.allow) if (!a.allow.has(v)) return false;
    }
    for (const d of a.deny) {
      const excludedByAllow = b.allow ? !b.allow.has(d) : false;
      if (!b.deny.has(d) && !excludedByAllow) return false;
    }
    return true;
  }

  return false;
}

/** True when rule B's whole matching region is a subset of rule A's (over every field A constrains). */
export function ruleRegionSubset(b: Rule, a: Rule): boolean {
  const bc = buildConstraints(b);
  const ac = buildConstraints(a);
  for (const [field, aCon] of ac) {
    const bCon = bc.get(field);
    if (!bCon) return false;
    if (!fieldSubset(bCon, aCon)) return false;
  }
  return true;
}
