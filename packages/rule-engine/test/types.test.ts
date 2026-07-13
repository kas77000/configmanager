import { describe, it, expect } from 'vitest';
import type { Predicate, OutputSegment, Rule, ParsedFile } from '../src/types';

describe('types', () => {
  it('can construct a structured predicate', () => {
    const p: Predicate = {
      raw: 'compositeExchangeCode=AU^HK',
      field: 'compositeExchangeCode',
      operator: '=',
      values: ['AU', 'HK'],
      opaque: false,
    };
    expect(p.values).toEqual(['AU', 'HK']);
  });

  it('can construct an opaque predicate', () => {
    const p: Predicate = { raw: '<js> _param.size() < 1 </js>', opaque: true };
    expect(p.opaque).toBe(true);
    expect(p.field).toBeUndefined();
  });

  it('can construct a rule with output tag keys', () => {
    const seg: OutputSegment = { raw: '9012=164=0^LOR=0', channel: '9012', tagKeys: ['164', 'LOR'] };
    const rule: Rule = {
      kind: 'rule',
      lineNumber: 132,
      raw: '9012=164=0^LOR=0 :: compositeExchangeCode=HK',
      enabled: true,
      outputs: [seg],
      outputTagKeys: ['164', 'LOR'],
      conditions: [],
    };
    const file: ParsedFile = { rules: [rule] };
    expect(file.rules[0].outputTagKeys).toContain('LOR');
  });
});
