import { describe, it, expect } from 'vitest';
import { parseRule } from '../src/parse-rule';
import { buildConstraints, ruleRegionSubset, hasOnlySimpleConditions } from '../src/analysis/constraints';

describe('buildConstraints', () => {
  it('builds a numeric interval from range predicates', () => {
    const r = parseRule('9012=1=1 :: orderSizeADV >= 0.07, orderSizeADV < 0.15', 1);
    const c = buildConstraints(r).get('orderSizeADV');
    expect(c).toMatchObject({ kind: 'numeric', lo: 0.07, loInc: true, hi: 0.15, hiInc: false });
  });

  it('builds a categorical allow-set from equality', () => {
    const r = parseRule('9012=1=1 :: compositeExchangeCode=AU^HK', 1);
    const c = buildConstraints(r).get('compositeExchangeCode');
    expect(c?.kind).toBe('categorical');
    expect(c && c.kind === 'categorical' && [...(c.allow ?? [])].sort()).toEqual(['AU', 'HK']);
  });
});

describe('ruleRegionSubset', () => {
  it('is true when B is numerically inside A', () => {
    const a = parseRule('9012=1=1 :: orderSizeADV < 0.15', 1);
    const b = parseRule('9012=1=1 :: orderSizeADV < 0.07', 2);
    expect(ruleRegionSubset(b, a)).toBe(true);
  });

  it('is false when B is broader than A', () => {
    const a = parseRule('9012=1=1 :: orderSizeADV < 0.07', 1);
    const b = parseRule('9012=1=1 :: orderSizeADV < 0.15', 2);
    expect(ruleRegionSubset(b, a)).toBe(false);
  });

  it('is true for a categorical subset', () => {
    const a = parseRule('9012=1=1 :: compositeExchangeCode=AU^HK^JP', 1);
    const b = parseRule('9012=1=1 :: compositeExchangeCode=HK', 2);
    expect(ruleRegionSubset(b, a)).toBe(true);
  });

  it('is false when A constrains a field B does not', () => {
    const a = parseRule('9012=1=1 :: side=buy', 1);
    const b = parseRule('9012=1=1 :: compositeExchangeCode=HK', 2);
    expect(ruleRegionSubset(b, a)).toBe(false);
  });
});

describe('hasOnlySimpleConditions', () => {
  it('is false when a tag guard is present', () => {
    const r = parseRule('9012=1=1 :: compositeExchangeCode=HK, tag9012(164)=null', 1);
    expect(hasOnlySimpleConditions(r)).toBe(false);
  });

  it('is true for a rule with only plain field conditions', () => {
    const r = parseRule('9012=1=1 :: compositeExchangeCode=HK, side=buy', 1);
    expect(hasOnlySimpleConditions(r)).toBe(true);
  });
});
