# PRODUCT.md — Configuration Manager

register: product

## Product purpose

A GitHub-like manager for algo-trading FIX configuration files (starting with
`ai.fixmsg.properties`). It versions each trading instance's config independently, lets a
team branch/edit through a review workflow, and warns in real time when a rule change makes
another rule redundant or unreachable. It verifies (never pushes) config drift against the
live instances.

## Users

Trading-infrastructure engineers and their approvers. Fluent in FIX tags, git, and diffs.
They work in long focused sessions reading dense monospace rule files and diffs across many
instances. They value precision and speed over hand-holding; a wrong config reaches live
markets, so the tool must make mistakes visible before they merge.

## Register

Product. The design serves the task and disappears into it. Bar: a Linear/Stripe-fluent
engineer sits down and trusts it immediately. Density is welcome; surprise is not.

## Tone

Precise, calm, factual. Instrument-panel, not dashboard-marketing. No emoji, no exclamation,
no celebratory copy. State facts: "3 rules shadowed", "in sync", "blocked by 1 error".

## Anti-references

- Not a neon "hacker terminal" (green-on-black). Refined, not cliché.
- Not navy-and-gold fintech.
- Not a card-grid SaaS dashboard with hero metrics.
- Not playful. This gates changes to live trading systems.

## Strategic principles

1. Severity is never color-only: every finding pairs a color with an icon glyph and text.
2. The config and diffs are monospace with tabular figures; the app chrome is a clean sans.
3. Instances are grouped by environment (pilot / production) with UAT (APIH) marked; the
   structure mirrors how changes actually roll out.
4. The merge gate is the product's spine: errors block, warnings need acknowledgement, and
   the UI states exactly why at the moment of action.
