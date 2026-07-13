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
