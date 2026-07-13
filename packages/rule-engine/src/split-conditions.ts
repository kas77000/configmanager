/** Splits a right-hand condition string on top-level commas, ignoring commas inside <js> ... </js>. */
export function splitConditions(rhs: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < rhs.length) {
    if (rhs.startsWith('<js>', i)) { depth++; current += '<js>'; i += 4; continue; }
    if (rhs.startsWith('</js>', i)) { depth = Math.max(0, depth - 1); current += '</js>'; i += 5; continue; }
    const ch = rhs[i];
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; i++; continue; }
    current += ch;
    i++;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}
