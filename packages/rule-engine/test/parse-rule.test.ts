import { describe, it, expect } from 'vitest';
import { parseRule } from '../src/parse-rule';

describe('parseRule', () => {
  it('parses an enabled rule with outputs and conditions', () => {
    const rule = parseRule('9012=164=0^LOR=0 :: compositeExchangeCode=HK, tag9012(LOR)=null', 133);
    expect(rule.kind).toBe('rule');
    expect(rule.enabled).toBe(true);
    expect(rule.lineNumber).toBe(133);
    expect(rule.outputTagKeys).toEqual(['164', 'LOR']);
    expect(rule.conditions).toHaveLength(2);
    expect(rule.conditions[0]).toMatchObject({ field: 'compositeExchangeCode', values: ['HK'] });
    expect(rule.conditions[1]).toMatchObject({ field: 'tag9012(LOR)', values: ['null'] });
  });

  it('marks a commented-out rule as disabled but still parses it', () => {
    const rule = parseRule('#9012=11=0 :: passive_only=2, wouldVenue>0', 50);
    expect(rule.enabled).toBe(false);
    expect(rule.kind).toBe('rule');
    expect(rule.outputTagKeys).toEqual(['11']);
    expect(rule.conditions).toHaveLength(2);
  });

  it('classifies the include line as a directive', () => {
    const rule = parseRule('internal_config_include_files: data/ai.tag155.properties', 1);
    expect(rule.kind).toBe('directive');
    expect(rule.conditions).toEqual([]);
  });

  it('attaches a provided comment', () => {
    const rule = parseRule('9012=144=1 :: compositeExchangeCode=KS', 368, 'Eric 2020.06.10 add 144=1 for Korea');
    expect(rule.comment).toBe('Eric 2020.06.10 add 144=1 for Korea');
  });

  it('treats a line with outputs but no recognizable tag keys as unparseable', () => {
    const rule = parseRule('garbage-without-tags :: a=1', 999);
    expect(rule.kind).toBe('unparseable');
  });
});
