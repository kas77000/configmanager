export type Severity = 'error' | 'warning' | 'info';

export type Operator = '=' | '!=' | '<' | '>' | '<=' | '>=' | '~' | '!~';

/** One condition on the right-hand side of a rule (`field op value^value`). */
export interface Predicate {
  /** Original text of this predicate, trimmed. */
  raw: string;
  /** Left-hand field, e.g. "compositeExchangeCode" or "tag9012(164)". Undefined when opaque. */
  field?: string;
  operator?: Operator;
  /** Values split on '^' (an OR-list). Undefined when opaque. */
  values?: string[];
  /** True when the predicate involves <js> or a regex (`~`/`!~`) and cannot be reasoned about. */
  opaque: boolean;
}

/** One segment of the left-hand (output) side, e.g. "9012=164=0^LOR=0" or "9001=VWAP". */
export interface OutputSegment {
  raw: string;
  /** The channel key before the first '=', e.g. "9012", "9001", "9060". */
  channel?: string;
  /** Best-effort sub-tag keys this segment sets, e.g. ["164","LOR"]. For non-9012 channels this is [channel]. */
  tagKeys: string[];
}

export type RuleKind = 'rule' | 'directive' | 'unparseable';

export interface Rule {
  kind: RuleKind;
  /** 1-based line number in the source file. */
  lineNumber: number;
  /** The original, untrimmed line text. */
  raw: string;
  /** False when the rule is commented out (a leading '#'). */
  enabled: boolean;
  /** Preceding prose comment block attached to this rule, if any. */
  comment?: string;
  outputs: OutputSegment[];
  /** Union of all segment tagKeys — the tags this rule sets. */
  outputTagKeys: string[];
  conditions: Predicate[];
}

export interface ParsedFile {
  /** All rules in file order, including directive/unparseable/disabled entries. */
  rules: Rule[];
}
