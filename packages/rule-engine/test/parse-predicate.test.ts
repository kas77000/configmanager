import { describe, it, expect } from 'vitest';
import { parsePredicate } from '../src/parse-predicate';

describe('parsePredicate', () => {
  it('parses a simple equality with an OR-list', () => {
    expect(parsePredicate('compositeExchangeCode=AU^HK^JP')).toEqual({
      raw: 'compositeExchangeCode=AU^HK^JP',
      field: 'compositeExchangeCode',
      operator: '=',
      values: ['AU', 'HK', 'JP'],
      opaque: false,
    });
  });

  it('parses a not-equal with an OR-list on a tag field', () => {
    const p = parsePredicate('tag9012(42)!=1^5');
    expect(p.field).toBe('tag9012(42)');
    expect(p.operator).toBe('!=');
    expect(p.values).toEqual(['1', '5']);
    expect(p.opaque).toBe(false);
  });

  it('parses numeric comparisons and trims whitespace', () => {
    expect(parsePredicate('marketCapUSD >= 10000')).toMatchObject({
      field: 'marketCapUSD', operator: '>=', values: ['10000'],
    });
    expect(parsePredicate('start_to_close < 0')).toMatchObject({
      field: 'start_to_close', operator: '<', values: ['0'],
    });
  });

  it('parses a null guard', () => {
    expect(parsePredicate('tag9012(164)=null')).toMatchObject({
      field: 'tag9012(164)', operator: '=', values: ['null'],
    });
  });

  it('marks regex predicates opaque but still records field/operator', () => {
    const p = parsePredicate('basket~.*SSGA.*');
    expect(p.field).toBe('basket');
    expect(p.operator).toBe('~');
    expect(p.opaque).toBe(true);
  });

  it('marks a bare <js> predicate opaque with no field', () => {
    const p = parsePredicate('<js> _param.size() < 1 </js>');
    expect(p.opaque).toBe(true);
    expect(p.field).toBeUndefined();
    expect(p.operator).toBeUndefined();
  });

  it('marks a predicate with no operator opaque', () => {
    const p = parsePredicate('somethingWeird');
    expect(p.opaque).toBe(true);
    expect(p.field).toBeUndefined();
  });
});
