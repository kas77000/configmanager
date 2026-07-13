import type { ParsedFile } from './types';
import { parseRule } from './parse-rule';

const DIRECTIVE_PREFIX = 'internal_config_include_files';

/** Parses the full file text into a ParsedFile, preserving order and attaching prose comments. */
export function parseFile(text: string): ParsedFile {
  const lines = text.split(/\r?\n/);
  const rules: ParsedFile['rules'] = [];
  let pendingComment: string[] = [];

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      pendingComment = [];
      return;
    }

    if (trimmed.startsWith(DIRECTIVE_PREFIX)) {
      rules.push(parseRule(line, lineNumber, pendingComment.join('\n') || undefined));
      pendingComment = [];
      return;
    }

    const deHash = trimmed.startsWith('#') ? trimmed.replace(/^#+/, '').trim() : trimmed;
    const isRule = deHash.includes('::');

    if (!isRule) {
      if (trimmed.startsWith('#')) pendingComment.push(deHash);
      return;
    }

    const comment = pendingComment.length ? pendingComment.join('\n') : undefined;
    rules.push(parseRule(line, lineNumber, comment));
    pendingComment = [];
  });

  return { rules };
}
