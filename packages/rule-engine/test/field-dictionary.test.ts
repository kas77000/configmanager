import { describe, it, expect } from 'vitest';
import { KNOWN_FIELDS, isTagLikeField } from '../src/analysis/field-dictionary';

describe('field dictionary', () => {
  it('contains real fields and correct spellings', () => {
    expect(KNOWN_FIELDS.has('compositeExchangeCode')).toBe(true);
    expect(KNOWN_FIELDS.has('exchangeCode')).toBe(true);
    expect(KNOWN_FIELDS.has('orderValueUSD')).toBe(true);
  });

  it('excludes the known typos so they get flagged', () => {
    expect(KNOWN_FIELDS.has('echangeCode')).toBe(false);
    expect(KNOWN_FIELDS.has('oderValueUSD')).toBe(false);
  });

  it('recognizes tag-like fields', () => {
    expect(isTagLikeField('tag9012(164)')).toBe(true);
    expect(isTagLikeField('tag9001')).toBe(true);
    expect(isTagLikeField('fixTag(109)')).toBe(true);
    expect(isTagLikeField('9012(IGNORE_ARROWST_CHECK)')).toBe(true);
    expect(isTagLikeField('compositeExchangeCode')).toBe(false);
    expect(isTagLikeField('has9009')).toBe(false);
  });
});
