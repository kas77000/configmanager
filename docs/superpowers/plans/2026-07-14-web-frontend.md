# Web Front-End Implementation Plan (Plan 4)

**Goal:** A React + TypeScript + Vite UI over the existing REST API: instance dashboard,
change workflow, Monaco editor with live shadow-analysis, per-instance diff, and history.

**Design:** Follows `PRODUCT.md` / `DESIGN.md` (product register; Restrained OKLCH neutrals +
one indigo accent; dark default, light peer; system sans chrome, monospace config; severity
always icon+text). Built with the ui-ux-pro-max and impeccable skills' guidance.

**Architecture:** `packages/web`. The pure `@config-manager/rule-engine` package is imported
**in the browser** so the editor gets instant inspector + warnings; the backend remains the
authoritative merge gate. Vite dev-proxies `/api` to the server on :4000 and injects the
`x-remote-user` header (a reverse proxy does Windows Integrated Auth in production).

## Files
- `vite.config.ts`, `tsconfig.json`, `index.html`, `styles.css` (tokens), `main.tsx` (Monaco
  self-hosted worker + theme init), `theme.ts`, `icons.tsx` (inline SVG, no emoji),
  `components.tsx` (badges, banners, skeletons), `api.ts` (typed client), `App.tsx` (shell + router).
- `pages/Dashboard.tsx` — instances grouped by environment; verify/sync (drift) per row.
- `pages/Changes.tsx` — change list + create (pick target instances by environment).
- `pages/ChangeDetail.tsx` — per-instance tabs; Monaco editor + Warnings/Inspector rail;
  diff; the merge-gate panel (errors block / admin override with reason / warning ack).
- `pages/History.tsx` — audit activity + commit graph.

## Verification
- `tsc --noEmit` clean (web + server).
- `vite build` succeeds (Monaco worker + rule-engine bundled).
- End-to-end HTTP smoke: seed 13 instance branches, create change, edit, analysis, merge,
  audit trail. First user becomes admin (bootstrap).

## Follow-ups (not blocking)
- Slim the Monaco bundle (currently ships all language tokenizers) to editor core + `ini`.
- Real `InstanceReader` (service-account network-share/SSH) behind the existing interface.
- Custom Monaco tokenizer for the `OUTPUT :: CONDITIONS` grammar (nice-to-have over `ini`).
