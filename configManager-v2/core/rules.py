"""Rule engine — a faithful Python port of @config-manager/rule-engine.

Pure functions for parsing `ai.fixmsg.properties` and detecting shadowed /
redundant / unreachable / self-contradictory rules. Mirrors the TypeScript
package one-for-one (parse-file, parse-rule, parse-outputs, parse-predicate,
split-conditions, analysis/tier1, analysis/tier2, analysis/constraints,
analysis/field-dictionary) so the Streamlit app produces identical findings.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# types.ts
# ---------------------------------------------------------------------------

Severity = str  # 'error' | 'warning' | 'info'
Operator = str  # '=' '!=' '<' '>' '<=' '>=' '~' '!~'
RuleKind = str  # 'rule' | 'directive' | 'unparseable'


@dataclass
class Predicate:
    raw: str
    opaque: bool
    field: Optional[str] = None
    operator: Optional[str] = None
    values: Optional[list[str]] = None


@dataclass
class OutputSegment:
    raw: str
    tag_keys: list[str]
    channel: Optional[str] = None


@dataclass
class Rule:
    kind: RuleKind
    line_number: int
    raw: str
    enabled: bool
    outputs: list[OutputSegment]
    output_tag_keys: list[str]
    conditions: list[Predicate]
    comment: Optional[str] = None


@dataclass
class ParsedFile:
    rules: list[Rule]


@dataclass
class Finding:
    severity: Severity
    code: str
    message: str
    line_number: int
    related_line_numbers: Optional[list[int]] = None


# ---------------------------------------------------------------------------
# JS-number semantics helpers
# ---------------------------------------------------------------------------

def _js_number(s: str) -> float:
    """Mimic JS `Number(s)` enough for config values: returns NaN on failure."""
    t = s.strip()
    if t == "":
        return 0.0  # JS Number('') === 0 (callers guard against empty first)
    try:
        return float(t)
    except ValueError:
        return math.nan


def _is_finite_number(s: str) -> bool:
    t = s.strip()
    if t == "":
        return False
    v = _js_number(s)
    return not (math.isnan(v) or math.isinf(v))


# ---------------------------------------------------------------------------
# split-conditions.ts
# ---------------------------------------------------------------------------

def split_conditions(rhs: str) -> list[str]:
    """Split a right-hand condition string on top-level commas, ignoring
    commas inside <js> ... </js>."""
    parts: list[str] = []
    depth = 0
    current = ""
    i = 0
    n = len(rhs)
    while i < n:
        if rhs.startswith("<js>", i):
            depth += 1
            current += "<js>"
            i += 4
            continue
        if rhs.startswith("</js>", i):
            depth = max(0, depth - 1)
            current += "</js>"
            i += 5
            continue
        ch = rhs[i]
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
            i += 1
            continue
        current += ch
        i += 1
    parts.append(current)
    return [p.strip() for p in parts if p.strip() != ""]


# ---------------------------------------------------------------------------
# parse-predicate.ts
# ---------------------------------------------------------------------------

_TWO_CHAR_OPS = ["!=", "<=", ">=", "!~"]
_ONE_CHAR_OPS = ["=", "<", ">", "~"]


def _find_operator(s: str):
    for candidates in (_TWO_CHAR_OPS, _ONE_CHAR_OPS):
        best = None
        for op in candidates:
            idx = s.find(op)
            if idx > 0 and (best is None or idx < best[1]):
                best = (op, idx)
        if best:
            return best
    return None


def parse_predicate(raw0: str) -> Predicate:
    raw = raw0.strip()
    if "<js>" in raw:
        return Predicate(raw=raw, opaque=True)

    found = _find_operator(raw)
    if not found:
        return Predicate(raw=raw, opaque=True)

    op, index = found
    fld = raw[:index].strip()
    value_str = raw[index + len(op):].strip()
    values = [v.strip() for v in value_str.split("^")]
    opaque = op in ("~", "!~")
    return Predicate(raw=raw, field=fld, operator=op, values=values, opaque=opaque)


# ---------------------------------------------------------------------------
# parse-outputs.ts
# ---------------------------------------------------------------------------

def _split_top_level(s: str, sep: str) -> list[str]:
    """Split `s` on top-level occurrences of `sep`, ignoring separators inside
    <js> ... </js>."""
    parts: list[str] = []
    depth = 0
    current = ""
    i = 0
    n = len(s)
    while i < n:
        if s.startswith("<js>", i):
            depth += 1
            current += "<js>"
            i += 4
            continue
        if s.startswith("</js>", i):
            depth = max(0, depth - 1)
            current += "</js>"
            i += 5
            continue
        if s[i] == sep and depth == 0:
            parts.append(current)
            current = ""
            i += 1
            continue
        current += s[i]
        i += 1
    parts.append(current)
    return parts


def parse_outputs(lhs: str) -> list[OutputSegment]:
    segments: list[OutputSegment] = []
    for seg0 in _split_top_level(lhs, ";"):
        raw = seg0.strip()
        if len(raw) == 0:
            segments.append(OutputSegment(raw=raw, tag_keys=[]))
            continue
        eq = raw.find("=")
        if eq == -1:
            segments.append(OutputSegment(raw=raw, tag_keys=[]))
            continue
        channel = raw[:eq].strip()
        body = raw[eq + 1:]
        if channel == "9012":
            tag_keys = []
            for part in _split_top_level(body, "^"):
                e = part.find("=")
                key = (part if e == -1 else part[:e]).strip()
                if len(key) > 0 and "<js>" not in key:
                    tag_keys.append(key)
            segments.append(OutputSegment(raw=raw, channel=channel, tag_keys=tag_keys))
        else:
            segments.append(OutputSegment(raw=raw, channel=channel, tag_keys=[channel]))
    return segments


# ---------------------------------------------------------------------------
# parse-rule.ts / parse-file.ts
# ---------------------------------------------------------------------------

_DIRECTIVE_PREFIX = "internal_config_include_files"


def parse_rule(raw_line: str, line_number: int, comment: Optional[str] = None) -> Rule:
    trimmed = raw_line.strip()

    enabled = True
    work = trimmed
    if work.startswith("#"):
        enabled = False
        work = re.sub(r"^#+", "", work).strip()

    if work.startswith(_DIRECTIVE_PREFIX):
        return Rule(
            kind="directive", line_number=line_number, raw=raw_line, enabled=enabled,
            comment=comment, outputs=[], output_tag_keys=[], conditions=[],
        )

    sep_idx = work.find("::")
    lhs = work if sep_idx == -1 else work[:sep_idx]
    rhs = "" if sep_idx == -1 else work[sep_idx + 2:]

    outputs = parse_outputs(lhs)
    conditions = [parse_predicate(c) for c in split_conditions(rhs)] if rhs.strip() else []

    seen: dict[str, None] = {}
    for s in outputs:
        for k in s.tag_keys:
            seen.setdefault(k, None)
    output_tag_keys = list(seen.keys())

    kind: RuleKind = "rule" if any(len(s.tag_keys) > 0 for s in outputs) else "unparseable"

    return Rule(
        kind=kind, line_number=line_number, raw=raw_line, enabled=enabled, comment=comment,
        outputs=outputs, output_tag_keys=output_tag_keys, conditions=conditions,
    )


def parse_file(text: str) -> ParsedFile:
    lines = re.split(r"\r?\n", text)
    rules: list[Rule] = []
    pending_comment: list[str] = []

    for idx, line in enumerate(lines):
        line_number = idx + 1
        trimmed = line.strip()

        if len(trimmed) == 0:
            pending_comment = []
            continue

        if trimmed.startswith(_DIRECTIVE_PREFIX):
            rules.append(parse_rule(line, line_number, "\n".join(pending_comment) or None))
            pending_comment = []
            continue

        de_hash = re.sub(r"^#+", "", trimmed).strip() if trimmed.startswith("#") else trimmed
        is_rule = "::" in de_hash

        if not is_rule:
            if trimmed.startswith("#"):
                pending_comment.append(de_hash)
            continue

        comment = "\n".join(pending_comment) if pending_comment else None
        rules.append(parse_rule(line, line_number, comment))
        pending_comment = []

    return ParsedFile(rules=rules)


# ---------------------------------------------------------------------------
# analysis/field-dictionary.ts
# ---------------------------------------------------------------------------

KNOWN_FIELDS: frozenset[str] = frozenset([
    "adv", "aggression", "algoEnv", "algorithm", "avgTradeCount", "basket", "caiid_str",
    "clientAlgorithm", "compositeExchangeCode", "dark_mid_price_mode", "doCash", "doClose",
    "doOpen", "end_to_close", "end_to_cont_end", "enforceRegSHO", "exchMktGrp", "exchangeCode",
    "execution_style", "fixmsg", "has9009", "inClose9015", "indexTrackerAdaptionMode",
    "indexTrackerAdaptionStr", "isIPO", "limitPriceStrUsed", "marketCapUSD", "maxLitPartLevel",
    "maxPartLevel", "minPartLevel", "moc_mode", "moc_rate", "moc_rate_type", "monitor_period",
    "moo_mode", "moo_rate_type", "noPMOpen", "now_to_close", "opened", "orderSizeADV",
    "orderTag", "orderValueUSD", "pair_balance_mode", "pair_balance_ratio", "parentRelayAlgo",
    "passive_only", "price", "prorate_mode", "queue_mode", "regSHOState", "roundLotSize",
    "side", "size", "spread", "start_open", "start_to_close", "start_to_cont_begin",
    "start_to_earliest_auction", "start_to_moc", "start_to_moo", "stockType", "stripedBasketID",
    "symbol", "syntheticVClose", "targetPartLevel", "use_ioi_exclusively", "wouldDarkOnly",
    "wouldPercentageRaw", "wouldVenue",
])

_TAG_LIKE_1 = re.compile(r"^(tag)?\d{2,4}(\(.*\))?$")
_TAG_LIKE_2 = re.compile(r"^tag\d+")
_TAG_LIKE_3 = re.compile(r"^fixTag\(")
_TAG_LIKE_4 = re.compile(r"^\d+\(")


def is_tag_like_field(fld: str) -> bool:
    return bool(
        _TAG_LIKE_1.search(fld)
        or _TAG_LIKE_2.search(fld)
        or _TAG_LIKE_3.search(fld)
        or _TAG_LIKE_4.search(fld)
    )


# ---------------------------------------------------------------------------
# analysis/constraints.ts
# ---------------------------------------------------------------------------

@dataclass
class NumericConstraint:
    lo: float
    lo_inc: bool
    hi: float
    hi_inc: bool
    has_eq_or_ne: bool
    kind: str = "numeric"


@dataclass
class CategoricalConstraint:
    allow: Optional[set[str]]
    deny: set[str]
    kind: str = "categorical"


def _is_numeric(s: str) -> bool:
    if s.strip() == "":
        return False
    v = _js_number(s)
    return not (math.isnan(v) or math.isinf(v))


def simple_predicates(rule: Rule) -> list[Predicate]:
    return [
        c for c in rule.conditions
        if (not c.opaque) and c.field and c.operator and c.values is not None
        and not is_tag_like_field(c.field)
    ]


def has_only_simple_conditions(rule: Rule) -> bool:
    return all(
        (not c.opaque) and c.field and c.operator and c.values is not None
        and not is_tag_like_field(c.field)
        for c in rule.conditions
    )


def _build_numeric(preds: list[Predicate]) -> NumericConstraint:
    lo = -math.inf
    lo_inc = False
    hi = math.inf
    hi_inc = False
    has_eq_or_ne = False

    def tighten_upper(v: float, inc: bool):
        nonlocal hi, hi_inc
        if v < hi or (v == hi and not inc):
            hi = v
            hi_inc = inc

    def tighten_lower(v: float, inc: bool):
        nonlocal lo, lo_inc
        if v > lo or (v == lo and not inc):
            lo = v
            lo_inc = inc

    for p in preds:
        multi = len(p.values) > 1
        v = _js_number(p.values[0])
        op = p.operator
        if op == "<":
            tighten_upper(v, False)
        elif op == "<=":
            tighten_upper(v, True)
        elif op == ">":
            tighten_lower(v, False)
        elif op == ">=":
            tighten_lower(v, True)
        elif op == "=":
            has_eq_or_ne = True
            if not multi:
                tighten_lower(v, True)
                tighten_upper(v, True)
        elif op == "!=":
            has_eq_or_ne = True

    return NumericConstraint(lo=lo, lo_inc=lo_inc, hi=hi, hi_inc=hi_inc, has_eq_or_ne=has_eq_or_ne)


def _build_categorical(preds: list[Predicate]) -> CategoricalConstraint:
    allow: Optional[set[str]] = None
    deny: set[str] = set()
    for p in preds:
        if p.operator == "=":
            vs = set(p.values)
            allow = (allow & vs) if allow is not None else vs
        elif p.operator == "!=":
            for v in p.values:
                deny.add(v)
    return CategoricalConstraint(allow=allow, deny=deny)


def build_constraints(rule: Rule) -> dict[str, object]:
    by_field: dict[str, list[Predicate]] = {}
    for p in simple_predicates(rule):
        by_field.setdefault(p.field, []).append(p)

    out: dict[str, object] = {}
    for fld, preds in by_field.items():
        all_numeric = all(all(_is_numeric(v) for v in p.values) for p in preds)
        out[fld] = _build_numeric(preds) if all_numeric else _build_categorical(preds)
    return out


def field_subset(b: object, a: object) -> bool:
    if a.kind != b.kind:
        return False

    if a.kind == "numeric":
        if a.has_eq_or_ne:
            return False
        lower_ok = b.lo > a.lo or (b.lo == a.lo and (a.lo_inc or not b.lo_inc))
        upper_ok = b.hi < a.hi or (b.hi == a.hi and (a.hi_inc or not b.hi_inc))
        return lower_ok and upper_ok

    if a.kind == "categorical":
        if a.allow is not None:
            if b.allow is None:
                return False
            for v in b.allow:
                if v not in a.allow:
                    return False
        for d in a.deny:
            excluded_by_allow = (d not in b.allow) if b.allow is not None else False
            if d not in b.deny and not excluded_by_allow:
                return False
        return True

    return False


def rule_region_subset(b: Rule, a: Rule) -> bool:
    bc = build_constraints(b)
    ac = build_constraints(a)
    for fld, a_con in ac.items():
        b_con = bc.get(fld)
        if b_con is None:
            return False
        if not field_subset(b_con, a_con):
            return False
    return True


# ---------------------------------------------------------------------------
# analysis/tier1.ts
# ---------------------------------------------------------------------------

def check_unknown_fields(rule: Rule) -> list[Finding]:
    findings: list[Finding] = []
    for c in rule.conditions:
        if c.opaque or not c.field:
            continue
        if is_tag_like_field(c.field):
            continue
        if c.field not in KNOWN_FIELDS:
            findings.append(Finding(
                severity="warning",
                code="unknown-field",
                message=f'Unknown condition field "{c.field}" — likely a typo (not in the known-field dictionary).',
                line_number=rule.line_number,
            ))
    return findings


def _contradiction_reason(fld: str, preds: list[Predicate]) -> Optional[str]:
    has_null_eq = any(p.operator == "=" and len(p.values) == 1 and p.values[0] == "null" for p in preds)
    has_null_ne = any(p.operator == "!=" and len(p.values) == 1 and p.values[0] == "null" for p in preds)
    if has_null_eq and has_null_ne:
        return f'"{fld}" is required to be both null and not-null'

    all_numeric = all(all(_is_numeric(v) for v in p.values) for p in preds)
    if all_numeric:
        lo = -math.inf
        lo_inc = False
        hi = math.inf
        hi_inc = False
        eq_vals: set[float] = set()
        for p in preds:
            if len(p.values) != 1:
                continue  # OR-list: skip for interval
            v = _js_number(p.values[0])
            op = p.operator
            if op == "<":
                if v < hi or (v == hi and hi_inc):
                    hi = v
                    hi_inc = False
            elif op == "<=":
                if v < hi:
                    hi = v
                    hi_inc = True
            elif op == ">":
                if v > lo or (v == lo and lo_inc):
                    lo = v
                    lo_inc = False
            elif op == ">=":
                if v > lo:
                    lo = v
                    lo_inc = True
            elif op == "=":
                eq_vals.add(v)
                if v > lo:
                    lo = v
                    lo_inc = True
                if v < hi:
                    hi = v
                    hi_inc = True
        if len(eq_vals) > 1:
            return f'"{fld}" is set equal to multiple different values'
        if lo > hi:
            return f'"{fld}" is bounded to an empty range'
        if lo == hi and (not lo_inc or not hi_inc):
            return f'"{fld}" is bounded to an empty range'
        return None

    # Categorical: intersection of '=' value-sets must be non-empty.
    allow: Optional[set[str]] = None
    for p in preds:
        if p.operator == "=":
            vs = set(p.values)
            allow = (allow & vs) if allow is not None else vs
    if allow is not None and len(allow) == 0:
        return f'"{fld}" is constrained to disjoint values'
    return None


def check_self_contradiction(rule: Rule) -> list[Finding]:
    by_field: dict[str, list[Predicate]] = {}
    for c in rule.conditions:
        if c.opaque or not c.field or not c.operator or c.values is None:
            continue
        by_field.setdefault(c.field, []).append(c)

    findings: list[Finding] = []
    for fld, preds in by_field.items():
        reason = _contradiction_reason(fld, preds)
        if reason:
            findings.append(Finding(
                severity="error",
                code="self-contradiction",
                message=f"Line {rule.line_number} can never match: {reason}.",
                line_number=rule.line_number,
            ))
    return findings


# ---------------------------------------------------------------------------
# analysis/tier2.ts
# ---------------------------------------------------------------------------

_GUARD_RE = re.compile(r"^tag9012\((.+)\)$")


def detect_dead_rules(enabled: list[Rule]) -> list[Finding]:
    findings: list[Finding] = []

    for b in enabled:
        reported = False
        for g in b.conditions:
            if reported:
                break
            if g.opaque or not g.field or g.operator != "=":
                continue
            if not g.values or len(g.values) != 1 or g.values[0] != "null":
                continue
            m = _GUARD_RE.match(g.field)
            if not m:
                continue
            tag = m.group(1)

            for a in enabled:
                if a.line_number >= b.line_number:
                    continue
                if tag not in a.output_tag_keys:
                    continue
                if not has_only_simple_conditions(a):
                    continue
                if rule_region_subset(b, a):
                    findings.append(Finding(
                        severity="error",
                        code="dead-rule",
                        message=(
                            f"Line {b.line_number} is unreachable: it only applies when tag9012({tag}) is unset, "
                            f"but line {a.line_number} already sets tag {tag} for every order this rule would match."
                        ),
                        line_number=b.line_number,
                        related_line_numbers=[a.line_number],
                    ))
                    reported = True
                    break
    return findings


def _condition_signature(rule: Rule) -> str:
    return "|".join(sorted(re.sub(r"\s+", "", c.raw) for c in rule.conditions))


def detect_redundant(enabled: list[Rule]) -> list[Finding]:
    groups: dict[str, list[Rule]] = {}
    for r in enabled:
        sig = _condition_signature(r)
        if sig == "":
            continue  # unconditional rules are too broad to call redundant
        groups.setdefault(sig, []).append(r)

    findings: list[Finding] = []
    for rules in groups.values():
        if len(rules) < 2:
            continue
        srt = sorted(rules, key=lambda r: r.line_number)
        for i in range(1, len(srt)):
            cur = srt[i]
            for j in range(i):
                prev = srt[j]
                shared = [k for k in cur.output_tag_keys if k in prev.output_tag_keys]
                if len(shared) > 0:
                    findings.append(Finding(
                        severity="warning",
                        code="redundant-conditions",
                        message=(
                            f"Line {cur.line_number} has the same conditions as line {prev.line_number} and both set "
                            f"tag(s) {', '.join(shared)}; the later value wins, so one may be redundant or conflicting."
                        ),
                        line_number=cur.line_number,
                        related_line_numbers=[prev.line_number],
                    ))
                    break
    return findings


# ---------------------------------------------------------------------------
# analysis/analyze.ts
# ---------------------------------------------------------------------------

_SEVERITY_RANK = {"error": 0, "warning": 1, "info": 2}


def analyze(file: ParsedFile) -> list[Finding]:
    enabled = [r for r in file.rules if r.kind == "rule" and r.enabled]

    findings: list[Finding] = []
    for rule in enabled:
        findings.extend(check_unknown_fields(rule))
        findings.extend(check_self_contradiction(rule))
    findings.extend(detect_dead_rules(enabled))
    findings.extend(detect_redundant(enabled))

    findings.sort(key=lambda f: (f.line_number, _SEVERITY_RANK[f.severity]))
    return findings


def analyze_text(text: str) -> list[Finding]:
    return analyze(parse_file(text))


def severity_counts(findings: list[Finding]) -> dict[str, int]:
    counts = {"error": 0, "warning": 0, "info": 0}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    return counts
