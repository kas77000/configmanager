# Configuration Manager — Phase 1 Design

**Date:** 2026-07-14
**Author:** Salavat (khalifea.sy@gmail.com)
**Status:** Approved (design), pending implementation plan

---

## 1. Background & Vision

The team maintains a trading-platform application with several instances running on
different servers, named `APIA`, `APIB`, `APIC`, … through `APIM`. Each instance has a
configuration folder of property files. Changes to these files today are made manually,
which is slow and error-prone, and they follow a team procedure (edit → email approval →
Jira tickets → review → deploy → recap email).

The long-term goal is a **GitHub-like web application** for managing these configuration
files: branching, diffs, merge-to-production, teams/roles, an approval workflow, Jira and
email integration, deployment to the live servers, and a full audit "arborescence" of who
did what.

Because that full vision spans six largely independent subsystems, it is being built in
**phases**. This document specifies **Phase 1 only**.

### The full system (for context — most is out of Phase 1 scope)

| # | Subsystem | Phase |
|---|-----------|-------|
| A | Version-control core (branches, commits, diffs, merge) | **1** |
| B | Rule/validation engine (shadow/redundancy detection) | **1** |
| C | Teams & RBAC (admin, requester, approver/stakeholder) | 2 (minimal roles in 1) |
| D | Approval workflow (email templates, approve/reject links) | 2 |
| E | Integrations (Jira, outbound email, deploy to APIA–APIM) | 2 |
| F | Audit arborescence (full who-did-what history) | **1** (foundation) / 2 (workflow events) |

---

## 2. Phase 1 Goal

> A safe, versioned, **multi-user** editor for `ai.fixmsg.properties` that warns in real
> time when a change makes another rule **redundant or unreachable**.

Explicitly **out of scope for Phase 1** (deferred to Phase 2):
- Email / approval workflow
- Jira ticket creation
- Pushing/deploying to the live APIA–APIM servers — **removed as a feature.** The app
  verifies drift read-only (compares live vs recorded) but never writes to instances.
- Multi-file management (Phase 1 works only on `ai.fixmsg.properties`, one version per instance)

The bar for Phase 1: editing the file must be **efficient and correct when several people
use it concurrently.**

---

## 2a. Revision 2026-07-14 — per-instance model (supersedes the single-`main` decisions below)

Two clarifications reshaped the version model after the initial design:

1. **Per-instance versioning.** There is **no single global `main`.** Each instance
   **APIA … APIM** has its own canonical version of `ai.fixmsg.properties` and its own
   history — modeled as one long-lived git branch per instance (`instance/APIA`, …). The
   files legitimately differ per instance (e.g. rules keyed on `algoEnv=APIH^APIA…`).

2. **A change fans out across instances.** A *change* captures one methodology (a
   description) plus a set of target instances. For **each** target instance it holds its
   **own working branch and its own edit** (`change/<id>/<INSTANCE>`), because applying the
   same intent to different instance files produces different concrete diffs. Rule-engine
   analysis therefore runs **per instance version**.

3. **Pull, don't push.** The app reads live config **from** instances (via the service
   account, behind an `InstanceReader` interface) but never writes **to** them. Two
   operations: **verify** (read-only compare, flags drift) and **sync** (fetch live and, only
   when it differs from the recorded version, ingest it as a `Service Account` commit on the
   instance branch — identical content is a no-op). Copying changes *onto* instances stays a
   manual/out-of-app step in Phase 1.

4. **Instance environments.** Each instance has a rollout tier — `pilot` or `production` —
   plus a `uat` flag. **Pilots: APIC, APIF, APIG, APIH; APIH is also the UAT instance;
   everything else is production.** Exposed on `GET /instances` for the workflow (e.g.
   pilot-first rollout, UAT sign-off).

5. **Multi-config ready.** A change targets `(instance, file)` pairs; Phase 1 operates the
   single `ai.fixmsg.properties`, but the model carries `file` so several configs across
   several instances fit without reshaping.

Everywhere below that says "the canonical `main` copy" now means "the targeted instance's
branch"; "merge to `main`" means "merge the change's per-instance branch into that instance's
branch." The merge gate, audit log, identity, and rule engine are unchanged.

## 3. Key Decisions (agreed)

| Topic | Decision |
|-------|----------|
| Editing paradigm | **Hybrid (Option C):** raw text is the source of truth, with a per-rule structured **Inspector** panel that also hosts shadow-analysis warnings. |
| Version model | App holds its own canonical **`main`** copy of the file. Users create **branches**, edit in isolation, and merge back. In Phase 1, merging to `main` updates the canonical copy + history only — it does **not** touch real servers. |
| Concurrency / merge | **Full Git-style 3-way merge (Option 1):** branches diverge freely; non-overlapping changes auto-merge; true line conflicts are surfaced for human resolution. |
| Versioning engine | **Git-backed (Option A):** a real bare Git repo is the engine, driven from the backend via the **installed `git` CLI**. Users never see raw Git. |
| Identity / auth | **No passwords, no app-managed credentials.** Identity = the authenticated **Windows ID**, supplied by a reverse proxy doing Windows Integrated Authentication. A dev-only impersonation switch replaces it off-domain. |
| Audit | Raw Git records only author/committer, which is insufficient. An **append-only audit log** records richer events (created-branch, edited, merged, …) with Windows ID + timestamp + IP, each linked to a commit. |
| Tech stack | **Node.js + TypeScript** backend, **React** front-end (the stack the team can maintain long-term). |
| Merge gate policy | **ERROR**-level findings **block** merge (admin-only override, reason logged). **WARNING**-level findings require an explicit "I've reviewed this" acknowledgement before merge. |

---

## 4. Architecture

```
┌─ React front-end ──────────────────────────────────┐
│  • Monaco text editor (source of truth) + Inspector │
│  • Diff view · branch/history tree · warnings panel  │
└───────────────┬─────────────────────────────────────┘
                │ REST/JSON
┌───────────────┴─ Node/TypeScript backend ──────────┐
│  • Git service  (shells out to git CLI)             │
│  • Rule engine  (parse · analyze · shadow-detect)   │
│  • Audit log    (append-only event stream)          │
│  • User directory (WinID → name, email, role)       │
└───────────────┬─────────────────────────────────────┘
                │
   ┌────────────┴───────────┐   ┌──────────────────────┐
   │ Bare Git repo(s)       │   │ DB (Postgres/SQLite): │
   │ = config file history  │   │ users, audit, instances│
   └────────────────────────┘   └──────────────────────┘
        (reverse proxy in front supplies the Windows ID)
```

### 4.1 Components (each with one job)

- **Git service** — the only component that talks to Git. Create branch, commit (authored
  as the real Windows user), diff, 3-way merge, detect conflicts. Wraps the `git` CLI.
- **Rule engine** — pure, stateless, I/O-free functions: `parse(fileText) → Rule[]` and
  `analyze(Rule[]) → Finding[]`. Trivially unit-testable.
- **Audit log** — append-only event records; each event carries Windows ID, timestamp, IP,
  and the related commit hash. Powers the "who did what" arborescence.
- **User directory** — lightweight `WinID → display name, email, role` list. Unknown IDs
  auto-register as **pending** for the admin to assign a role. (Email stored now for the
  Phase-2 mail workflow.)

### 4.2 Data model (Phase 1)

- **`main`** — the app's canonical copy of the file. Merge-to-`main` = update canonical +
  record history. No server contact in Phase 1.
- **Instances (APIA–APIM)** — stored as plain reference data now (so rules referencing
  `algoEnv=APIH^APIA…` are meaningful and Phase 2 has deploy targets). No live connection
  in Phase 1.
- **Roles (Phase 1, minimal):** `admin` (manages users + instances) and `editor` (branch,
  edit, merge). The richer requester/approver/stakeholder split activates in Phase 2.

---

## 5. The Rule Engine

### 5.1 Evaluation model (confirmed with domain owner)

The trading platform evaluates `ai.fixmsg.properties` as follows — **all analysis depends
on this**:

1. Rules are evaluated **top-to-bottom**.
2. **Every** matching rule fires; matches **accumulate** tags onto the order (not
   first-match-wins).
3. A condition reading `tag9012(X)` sees tags **already injected by earlier rules in this
   same file**, not just the original order's tags. (This is why rules are guarded with
   `tag9012(X)=null`.)
4. **Line order is the precedence mechanism.** `!`-prefixed override directives (e.g.
   `!RLMOO`, `!AIMAP`, `!RTG`) are a recognized special case in the parser but do not
   change the core model.

### 5.2 Parse model

Each non-blank line → a `Rule`:
- **outputs** — left side (tags to inject): `9012=144=1`, or compound like
  `9001=VWAP;9012=92=S,5^6=15`. Structured where possible; complex/`<js>` outputs kept raw.
- **conditions** — AND-list of predicates after `::`. Each = `field · operator · value(s)`.
  Operators: `= != < > <= >= ~ !~`. `^` = OR-list. Special forms: `tag9012(X)=null` /
  `!=null`, `fixTag(N)=…`, opaque `<js>…</js>`.
- Metadata: line number, attached comment, enabled/disabled (leading `#` = commented-out
  rule; preserved and shown grayed).

### 5.3 Analyses (three tiers)

**Tier 1 — per-rule (cheap, near-zero false positives):**
- Parse/syntax errors (malformed line, unknown operator).
- Self-contradictory conditions (e.g. `orderSizeADV<0.07` AND `orderSizeADV>=0.15`;
  `X=null` AND `X!=null`).
- Unknown field names, validated against a field dictionary. (Already catches real bugs:
  `oderValueUSD` on line 205, `echangeCode` on line 239.)

**Tier 2 — cross-rule interactions ("one condition outshines another"):**
- **Dead rule via guard shadowing** — Rule B requires `tag9012(X)=null`, but an earlier
  Rule A sets X and B's region ⊆ A's region → B can never fire. *"Line N is unreachable:
  tag X is always already set by line M."*
- **Redundant / duplicate rule** — equivalent conditions + same output (e.g. lines 15 & 16).
- **Conflicting values** — two rules set the same tag to different values in an overlapping
  region; report which wins given top-to-bottom order.

**Tier 3 — live impact preview (while typing):** as a rule is added/edited, the Inspector
reports in real time what it would shadow, what shadows it, and which lines a new condition
newly kills.

### 5.4 Overlap / shadowing algorithm and its limits

- Each predicate → a constraint on a field: categorical `^`-lists → sets; numeric
  comparisons → intervals; tag-presence → boolean.
- Two rules **can co-fire** iff every shared field's constraints intersect.
- Rule B is **provably dead under A** iff A is earlier, A sets the guarded tag, and B's
  region ⊆ A's region on every field A constrains.
- **Opaque predicates** (regex `~`, `<js>`) cannot be reasoned inside. The engine is
  deliberately **conservative**: it only reports "definitely dead" when provable on the
  decidable parts; otherwise it downgrades to a softer "possible interaction — involves
  inline JS/regex, please verify."

### 5.5 Finding severities

- **ERROR** — provably broken (parse error, self-contradiction, provably dead rule).
- **WARNING** — probable, or involves opaque predicates / partial overlap.
- **INFO** — overlap worth knowing about.

Severity drives the merge gate (§7).

---

## 6. Editor & Diff Experience

- **Editor** — **Monaco** (VS Code's editor engine; React/TypeScript-native) showing raw
  file text with custom highlighting for this grammar, inline squiggles from Tier 1–2, and
  gutter markers.
- **Inspector panel (Option C)** — click a line for its structured breakdown: output tags,
  each condition as an editable `field/op/value` chip, and an **Interactions** section
  listing what it shadows / is shadowed by, with clickable line links. Text ⇄ Inspector stay
  in sync both ways.
- **Warnings panel** — all findings across the file, grouped by severity, click to jump.
- **Diff view** — git diff of branch vs `main`, **plus a semantic-impact summary** ("adds 2
  rules, removes 1; newly shadows line 44; resolves the 15/16 redundancy").
- **History / branch tree** — the git commit graph rendered as the arborescence, annotated
  with audit events (who edited, who merged, when).
- **Merge flow** — branch → edit → warnings clean/acknowledged → open merge → git 3-way
  merge; conflicts go to a resolve view; on success `main` updates + audit event + history
  node.

---

## 7. Merge Gate Policy

- **ERROR** findings **block** merge to `main`. An **admin** may override, and the override
  reason is recorded in the audit log.
- **WARNING** findings require an explicit "I've reviewed this" acknowledgement (recorded
  with the acknowledging user) before merge.
- **INFO** findings never block.

This is the mechanism for the "reduce human error to zero" goal without refusing legitimate
edge cases.

---

## 8. Error Handling

- **Parser** never throws on bad input; unparseable lines become a `Rule` of kind
  `unparseable` carrying the raw text and a Tier-1 ERROR finding, so one bad line never
  breaks analysis of the rest of the file.
- **Git service** surfaces conflicts as structured data (not raw CLI text) for the resolve
  view; unexpected Git failures are logged and returned as actionable errors.
- **Auth** — a request with no resolvable Windows ID (misconfigured proxy) is rejected with
  a clear operator-facing error; the app never falls back to anonymous editing.
- **Audit log** is append-only; a failure to write an audit event fails the associated
  action (no silent, unaudited changes).

---

## 9. Testing Strategy

- **Rule engine** — the priority. Pure functions → exhaustive unit tests: parser
  round-trips, each Tier-1/2 analysis, and a golden-file suite built from the real
  `ai.fixmsg.properties` (including known issues: 15/16 redundancy, `oderValueUSD`,
  `echangeCode`). Conservative-analysis tests assert we do **not** over-report on `<js>`/regex
  rules.
- **Git service** — integration tests against a throwaway temp repo: branch, commit, diff,
  clean merge, conflicting merge.
- **Audit log** — assert every state-changing action writes exactly one correct event.
- **API** — endpoint tests with an impersonated Windows ID.
- **Front-end** — component tests for the Inspector text⇄structure sync and the warnings
  panel.

---

## 10. Open Questions / Assumptions for Phase 2 (not blocking Phase 1)

- Which identity system backs Windows Integrated Auth in production (AD/LDAP specifics) —
  needed when wiring the real reverse proxy.
- The exact email-approval template and Jira project mapping — Phase 2.
- How the service account connects to APIA–APIM for deploy (SSH? file share?) — Phase 2.
- The field dictionary for Tier-1 unknown-field detection must be seeded from the platform's
  real supported field list; initial version derived from fields observed in the file.
```
