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
