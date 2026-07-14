# DESIGN.md — Configuration Manager

## Theme

Scene: a trading-infra engineer, mid-session, scanning 13 instances and reading dense
monospace FIX-rule diffs for long stretches on a multi-monitor desk in a dimmed ops room.
Low-glare calm surfaces so red/amber severity flags pop. **Dark is the considered default;
light is a first-class peer** (bright-office reviewers). Theme follows the OS and a manual
toggle stamps `data-theme` on `:root`.

Not terminal-native green-on-black (the second-order fintech reflex). It reads as a precise
instrument panel: cool graphite surfaces, hairline borders, one restrained indigo accent,
and status colors that behave like panel LEDs.

## Color (OKLCH, tinted neutrals — never #000/#fff)

Strategy: **Restrained.** Tinted-graphite neutrals + one indigo accent (≤10% of surface).
Semantic status colors are functional (paired with icon + text), not decoration. Neutrals
tinted toward hue 260.

Dark (default):
- `--bg`: oklch(0.19 0.008 260) · `--surface`: oklch(0.23 0.010 260) · `--raised`: oklch(0.27 0.012 260)
- `--border`: oklch(0.33 0.012 260) · `--border-strong`: oklch(0.42 0.014 260)
- `--text`: oklch(0.94 0.006 260) · `--muted`: oklch(0.70 0.010 260) · `--faint`: oklch(0.56 0.010 260)
- `--accent`: oklch(0.68 0.13 265) · `--accent-hover`: oklch(0.73 0.14 265) · `--accent-fg`: oklch(0.16 0.01 265)
- `--error`: oklch(0.66 0.19 25) · `--warning`: oklch(0.78 0.14 78) · `--success`: oklch(0.72 0.14 152) · `--info`: oklch(0.70 0.11 240)

Light:
- `--bg`: oklch(0.975 0.004 260) · `--surface`: oklch(0.995 0.003 260) · `--raised`: oklch(1 0 0 / 0) → use surface
- `--border`: oklch(0.90 0.006 260) · `--border-strong`: oklch(0.82 0.008 260)
- `--text`: oklch(0.24 0.010 260) · `--muted`: oklch(0.47 0.012 260) · `--faint`: oklch(0.60 0.012 260)
- `--accent`: oklch(0.52 0.16 265) · `--accent-hover`: oklch(0.47 0.17 265) · `--accent-fg`: oklch(0.99 0.005 265)
- `--error`: oklch(0.55 0.20 25) · `--warning`: oklch(0.66 0.15 70) · `--success`: oklch(0.55 0.15 152) · `--info`: oklch(0.52 0.14 240)

Environment tags (small dot + label, never full fills):
- production: neutral graphite (`--muted`) · pilot: `--warning` hue · uat (APIH): oklch violet ~300.

## Typography

- Chrome: system sans — `ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`. One family.
- Config / data / diffs: mono — `ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace`, with `font-variant-numeric: tabular-nums`.
- Fixed rem scale (ratio ~1.15): 11 / 12 / 13 / 14 / 16 / 20 / 24 px. Base UI 13px (dense tool).
- Weights: 400 body, 500 labels/nav, 600 headings. No display fonts anywhere.

## Spacing & layout

- 4px rhythm: 4 / 8 / 12 / 16 / 24 / 32. Vary for rhythm; not uniform padding.
- App shell: fixed left sidebar (nav: Instances, Changes, History) + main content. Standard,
  predictable. Cards only where a card is the right affordance (never nested).
- Tables for instance/commit/audit lists (dense, tabular). Hairline `--border` separators.

## Components (every one: default, hover, focus, active, disabled, loading, error)

- Buttons: primary (accent fill), secondary (border), ghost. 28–32px height, radius 6px.
- Severity badge: colored dot/glyph + count + label. Error ▲, Warning ◆, Info ●.
- Instance row: code (mono), env tag, uat marker, sync state, actions.
- Editor: Monaco (mono), gutter markers from findings; right rail = Warnings list; click a
  line → Inspector (parsed rule: outputs, conditions, interactions).
- Loading: skeleton rows, not center spinners. Empty states teach the next action.

## Motion

150–250ms, ease-out (cubic-bezier(0.22,1,0.36,1)). Opacity/transform only. Motion conveys
state (panel open, row select, save success), never decoration. No page-load choreography.

## Absolute bans honored

No side-stripe accent borders, no gradient text, no glassmorphism, no hero-metric template,
no identical card grids, no modal-first flows (edit/analyze inline), no em dashes in UI copy.
