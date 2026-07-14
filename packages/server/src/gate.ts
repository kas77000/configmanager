import { analyze, parseFile, type Finding } from '@config-manager/rule-engine';

export interface GateResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

/** Runs the rule engine over file content and summarizes findings for the merge gate. */
export function evaluateGate(content: string): GateResult {
  const findings = analyze(parseFile(content));
  return {
    findings,
    errorCount: findings.filter((f) => f.severity === 'error').length,
    warningCount: findings.filter((f) => f.severity === 'warning').length,
    infoCount: findings.filter((f) => f.severity === 'info').length,
  };
}
