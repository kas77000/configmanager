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
