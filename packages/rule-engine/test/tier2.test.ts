import { describe, it, expect } from 'vitest';
import { parseRule } from '../src/parse-rule';
import { detectDeadRules, detectRedundant } from '../src/analysis/tier2';

describe('detectDeadRules', () => {
  it('flags a rule guarded on a tag an earlier unconditional rule always sets', () => {
    const a = parseRule('9012=164=0 :: compositeExchangeCode=HK', 1);
    const b = parseRule('9012=LOR=1 :: compositeExchangeCode=HK, tag9012(164)=null', 2);
    const f = detectDeadRules([a, b]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: 'dead-rule', lineNumber: 2, relatedLineNumbers: [1] });
  });

  it('does not flag when the earlier setter is narrower than the guarded rule', () => {
    const a = parseRule('9012=164=0 :: compositeExchangeCode=HK', 1);
    const b = parseRule('9012=LOR=1 :: tag9012(164)=null', 2); // broader: any exchange
    expect(detectDeadRules([a, b])).toEqual([]);
  });

  it('does not raise a false dead-rule when the earlier setter has an opaque condition', () => {
    const a = parseRule('9012=164=0 :: compositeExchangeCode=HK, basket~.*SSGA.*', 1);
    const b = parseRule('9012=LOR=1 :: compositeExchangeCode=HK, tag9012(164)=null', 2);
    expect(detectDeadRules([a, b])).toEqual([]);
  });
});

describe('detectRedundant', () => {
  it('flags two rules with identical conditions that set a shared tag', () => {
    const a = parseRule('9012=6=8 :: clientAlgorithm=X, orderSizeADV < 0.07', 15);
    const b = parseRule('9012=6=12 :: clientAlgorithm=X, orderSizeADV < 0.07', 16);
    const f = detectRedundant([a, b]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: 'redundant-conditions', lineNumber: 16, relatedLineNumbers: [15] });
  });

  it('does not flag rules with different conditions', () => {
    const a = parseRule('9012=6=8 :: orderSizeADV < 0.07', 1);
    const b = parseRule('9012=6=12 :: orderSizeADV >= 0.07', 2);
    expect(detectRedundant([a, b])).toEqual([]);
  });
});
