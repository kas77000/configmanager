import { describe, it, expect } from 'vitest';
import { parseOutputs } from '../src/parse-outputs';

describe('parseOutputs', () => {
  it('extracts 9012 sub-tag keys', () => {
    const segs = parseOutputs('9012=164=0^LOR=0');
    expect(segs).toHaveLength(1);
    expect(segs[0].channel).toBe('9012');
    expect(segs[0].tagKeys).toEqual(['164', 'LOR']);
  });

  it('handles a compound output with multiple channels', () => {
    const segs = parseOutputs('9001=VWAP;9012=92=S,5^6=8');
    expect(segs.map((s) => s.channel)).toEqual(['9001', '9012']);
    expect(segs[0].tagKeys).toEqual(['9001']);
    expect(segs[1].tagKeys).toEqual(['92', '6']);
  });

  it('keeps a KO output as a single 9012 key', () => {
    const segs = parseOutputs('9012=KO=arrowst+orders+without+79+tag');
    expect(segs[0].tagKeys).toEqual(['KO']);
  });

  it('handles a trailing semicolon without producing empty tag keys', () => {
    const segs = parseOutputs('9001=LINE;');
    expect(segs[0].tagKeys).toEqual(['9001']);
    expect(segs.flatMap((s) => s.tagKeys)).toEqual(['9001']);
  });

  it('does not split on ^ inside a <js> output value', () => {
    const segs = parseOutputs('9012=ERB=<js>"" + (1^2) </js>');
    expect(segs[0].channel).toBe('9012');
    expect(segs[0].tagKeys).toEqual(['ERB']);
  });
});
