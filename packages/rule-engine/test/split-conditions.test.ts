import { describe, it, expect } from 'vitest';
import { splitConditions } from '../src/split-conditions';

describe('splitConditions', () => {
  it('splits a simple AND-list and trims each part', () => {
    expect(splitConditions('clientAlgorithm=SENSATOLOWALPHA, marketCapUSD >= 10000'))
      .toEqual(['clientAlgorithm=SENSATOLOWALPHA', 'marketCapUSD >= 10000']);
  });

  it('does not split on commas inside a <js> block', () => {
    const rhs = 'basket~.*SSGA.*, <js> _param.size() < _stock.adv() * 0.03, ok </js>, adv > 0';
    expect(splitConditions(rhs)).toEqual([
      'basket~.*SSGA.*',
      '<js> _param.size() < _stock.adv() * 0.03, ok </js>',
      'adv > 0',
    ]);
  });

  it('drops empty segments', () => {
    expect(splitConditions('a=1, , b=2')).toEqual(['a=1', 'b=2']);
  });

  it('returns an empty array for a blank string', () => {
    expect(splitConditions('   ')).toEqual([]);
  });
});
