import type { OutputSegment } from './types';

/** Splits `s` on top-level occurrences of `sep`, ignoring separators inside <js> ... </js>. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('<js>', i)) { depth++; current += '<js>'; i += 4; continue; }
    if (s.startsWith('</js>', i)) { depth = Math.max(0, depth - 1); current += '</js>'; i += 5; continue; }
    if (s[i] === sep && depth === 0) { parts.push(current); current = ''; i++; continue; }
    current += s[i];
    i++;
  }
  parts.push(current);
  return parts;
}

/** Parses the left-hand (output) side of a rule into segments with best-effort tag keys. Never throws. */
export function parseOutputs(lhs: string): OutputSegment[] {
  return splitTopLevel(lhs, ';').map((seg0): OutputSegment => {
    const raw = seg0.trim();
    if (raw.length === 0) return { raw, tagKeys: [] };
    const eq = raw.indexOf('=');
    if (eq === -1) return { raw, tagKeys: [] };
    const channel = raw.slice(0, eq).trim();
    const body = raw.slice(eq + 1);
    if (channel === '9012') {
      const tagKeys = splitTopLevel(body, '^')
        .map((part) => {
          const e = part.indexOf('=');
          return (e === -1 ? part : part.slice(0, e)).trim();
        })
        .filter((k) => k.length > 0 && !k.includes('<js>'));
      return { raw, channel, tagKeys };
    }
    return { raw, channel, tagKeys: [channel] };
  });
}
