import type { Finding, ParsedFile, Severity } from '../types';
import { checkSelfContradiction, checkUnknownFields } from './tier1';
import { detectDeadRules, detectRedundant } from './tier2';

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Runs all Tier 1 and Tier 2 analyses over a parsed file and returns findings, sorted for display. */
export function analyze(file: ParsedFile): Finding[] {
  const enabled = file.rules.filter((r) => r.kind === 'rule' && r.enabled);

  const findings: Finding[] = [];
  for (const rule of enabled) {
    findings.push(...checkUnknownFields(rule));
    findings.push(...checkSelfContradiction(rule));
  }
  findings.push(...detectDeadRules(enabled));
  findings.push(...detectRedundant(enabled));

  return findings.sort(
    (a, b) => a.lineNumber - b.lineNumber || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}
