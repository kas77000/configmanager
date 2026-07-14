export const VERSION = '0.1.0';

export * from './types';
export { splitConditions } from './split-conditions';
export { parsePredicate } from './parse-predicate';
export { parseOutputs } from './parse-outputs';
export { parseRule } from './parse-rule';
export { parseFile } from './parse-file';

export { analyze } from './analysis/analyze';
export { KNOWN_FIELDS, isTagLikeField } from './analysis/field-dictionary';
export { checkUnknownFields, checkSelfContradiction } from './analysis/tier1';
export { detectDeadRules, detectRedundant } from './analysis/tier2';
export {
  buildConstraints,
  fieldSubset,
  ruleRegionSubset,
  hasOnlySimpleConditions,
  simplePredicates,
} from './analysis/constraints';
export type { FieldConstraint, NumericConstraint, CategoricalConstraint } from './analysis/constraints';
