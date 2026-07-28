# The Disclosure Doctrine (admin/backend UX law — Juan-ratified 2026-07-28)

Six-seat council, session `.claude/council/2026-07-27-admin-disclosure/`
(report.md = full synthesis). Owner's driver: "If the managers don't want to
use it, employees won't either… collapse/expand everywhere, lose NO
functionality." Every NEW admin surface is born compliant; existing surfaces
migrate in waves (below). Measured baseline that motivated this: /admin/skus
rendered ~163 full cost panels on first paint; RecipeBuilder ~1330 lines of
always-open sections.

## The 10 laws (apply without judgment calls)
- **D1** Identity line always visible: name + status badge + count. Never collapsed.
- **D2** Alerts NEVER collapse: issue/readiness badges (rendered ON the
  collapsed summary), errors, over-par, step-up prompts, unsaved-state,
  inactive badges, campaign counters (unchained N). A collapsed broken thing
  still shouts it's broken.
- **D3** SECONDARY content default-collapsed (cost panels, readouts, dossier
  edges, danger zones); PRIMARY work sections default-open (a recipe's
  inputs/outputs ARE the job).
- **D4** Add/edit forms are TRIGGERED, never pre-rendered.
- **D5** Every collapsed header carries an i18n'd count: t(key, { n }) —
  never string-concat.
- **D6** Search/lens chips replace scroll on lists ≥10 rows. Tabs partition
  concerns and never collapse (prep-demand is the model).
- **D7** Multi-expand (Set) for browse surfaces; single-expand for
  space-aggressive in-list editors. Collapse preserves scroll position.
- **D8** Phone-first: collapsed state IS the design (~48px rows, 44px tap
  targets, FULL-ROW toggle — never icon-only). Desktop gets denser summaries,
  never more default-open content.
- **D9** Disclosure state = per-session useState only. No localStorage, no
  URL state (the router.refresh/useState law). ?tab= stays where it exists.
- **D10** a11y contract: <button> + aria-expanded + aria-controls, i18n'd
  labels. Collapsed content conditional-renders (perf) EXCEPT a drawer with
  unsaved edits — it stays mounted and locked open.

## Primitives (v1 — exactly two; jump-bar/sticky DEFERRED per council)
- `CollapsibleSection` — header = title + count + badge slot + chevron;
  controlled/uncontrolled; a11y baked; lazy children.
- `SummaryRow` pattern — extracted from CatalogClient's row+drawer (the
  proven house pattern). SectionGroup rollups compose these two.

## Migration waves (one PR each, pure relocation, zero functional diff,
preview smoke en+es per PR; dashboards stay glanceable — these laws bind
EDITORS and CATALOGS, not the manager's read-only landing numbers)
W0 primitives + Catalog parity → W1 prep-demand DaySections (over-par stays
on the collapsed line) → W2 SkuCostPanel behind toggle (the ×163 fix) →
W3 Packages rows (advice panel lazy-fetch = free perf) → W4 Menu section
collapse (>6 items) → W5 RecipeBuilder sections (save bar OUTSIDE wrappers,
LiveReadout → one-line summary, delete zone behind a Danger disclosure).
