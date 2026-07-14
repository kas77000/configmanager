import { describe, it, expect } from 'vitest';
import { parseRule } from '../src/parse-rule';
import { checkUnknownFields, checkSelfContradiction } from '../src/analysis/tier1';

describe('checkUnknownFields', () => {
  it('flags a typo field', () => {
    const r = parseRule('9012=1=1 :: oderValueUSD < 100000', 205);
    const f = checkUnknownFields(r);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: 'unknown-field', severity: 'warning', lineNumber: 205 });
  });

  it('does not flag known fields or tag fields', () => {
    const r = parseRule('9012=1=1 :: compositeExchangeCode=HK, tag9012(164)=null', 1);
    expect(checkUnknownFields(r)).toEqual([]);
  });
});

describe('checkSelfContradiction', () => {
  it('flags an empty numeric range', () => {
    const r = parseRule('9012=1=1 :: orderSizeADV < 0.07, orderSizeADV >= 0.15', 1);
    const f = checkSelfContradiction(r);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ code: 'self-contradiction', severity: 'error' });
  });

  it('flags a null / not-null contradiction', () => {
    const r = parseRule('9012=1=1 :: tag9012(23)=null, tag9012(23)!=null', 1);
    expect(checkSelfContradiction(r).some((x) => x.code === 'self-contradiction')).toBe(true);
  });

  it('flags disjoint categorical equality', () => {
    const r = parseRule('9012=1=1 :: side=buy, side=sellshort', 1);
    expect(checkSelfContradiction(r)).toHaveLength(1);
  });

  it('does not flag a satisfiable rule', () => {
    const r = parseRule('9012=1=1 :: orderSizeADV >= 0.07, orderSizeADV < 0.15', 1);
    expect(checkSelfContradiction(r)).toEqual([]);
  });
});
