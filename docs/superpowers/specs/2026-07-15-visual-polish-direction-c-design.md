# Visual polish pass — direction C (Dimensional / Premium) — design

**Date:** 2026-07-15
**Status:** approved (brainstormed with the companion; direction "C" chosen; adaptive dense-surface + stretch-fix plan confirmed)
**Scope:** presentational — visual language + layout adaptation. No data/auth/logic changes. Phone experience preserved (elevation/radii are fine on phone; layout adaptation is desktop-only at `lg:`).

## Goal

Make the app more visually pleasing and striking while staying on-brand (Mayo / Mustard / Diet Coke + blue/green accents). Direction **C — Dimensional / Premium**: real elevation (soft warm shadows), generous radii, gradient-filled charts, a sense of depth and craft. Plus: (a) kill the desktop *stretch* on forms, and (b) make the dense surfaces — checklists, trends, reports — genuinely *adapt* to desktop, not just widen.

## 1. Visual foundation (the shared system)

Added to `app/globals.css`:
- **Elevation scale** (warm-tinted, not neutral grey):
  - `--co-shadow-card: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(120,100,20,0.09)`
  - `--co-shadow-card-hover: 0 2px 4px rgba(0,0,0,0.05), 0 14px 34px rgba(120,100,20,0.14)`
  - `--co-shadow-raised` (modals/popovers), stronger.
- **`.co-card` utility** — the canonical card: `background: var(--co-surface)`, `border: 1px solid var(--co-card-border)` (a lighter #F0E7C4 — shadow carries the elevation now), `border-radius: 1rem` (16px, was ~12), `box-shadow: var(--co-shadow-card)`. `.co-card--interactive` adds a hover lift (`translateY(-1px)` + hover shadow) + `transition`.
- **Subtle app-bg gradient** — body goes from flat Mayo to a soft `linear-gradient(170deg, #FFFDF5, #FFF3D4)` for warmth/depth (visible app-wide, one change).
- **Radii scale** standardized (cards 16px, chips stay pill, insets 10px).
- **Type refinement** — bump stat/display numbers (bigger, tighter `tracking-[-0.02em]`); keep DM Sans.
- Motion respects `prefers-reduced-motion` (hover lift only when motion is allowed).

## 2. Card restyle (app-wide)

Migrate the flat `border-2 border-co-border bg-co-surface rounded-xl` card pattern to `.co-card` (interactive variant for tappable tiles). Rolled out per-surface (see phases). Cards gain soft elevation + rounder corners + lighter borders — the core "premium" feel.

## 3. Charts (gradient + refined)

The hand-rolled SVG charts (`components/**` trends/report charts): add gradient fills (`<linearGradient>` mustard→transparent for bars/areas, blue for cash), thin clean gridlines, rounded bar caps, refined axis labels. A small shared chart-style helper so all charts match.

## 4. Stretch fix

- **`components/layout/FocusedShell.tsx`** — wraps form/reading surfaces: centers content at `max-w-2xl`, and renders `CanvasWatermark` (a large, faint, `lg:`-only, `aria-hidden`, `pointer-events-none` BrandMark in the corner, `-z-10` so it sits behind content but above the bg) so the empty desktop canvas reads intentional.
- Apply to: cash, am-prep, mid-day, production, receiving(+[id]), pm-report, and the admin editor pages (recipe/vendor editors) that currently inherit the wide admin container — constrain those forms to focused width.

## 5. Adaptive dense surfaces (desktop `lg:`+)

- **Checklist** (opening / closing / prep clients) — stations flow from one scroll column into a **2–3 column layout** on desktop (CSS columns or a responsive grid of station cards), so the whole shift is visible at once. Item toggles / temp / photo inputs unchanged. This is the highest-impact adaptation; done carefully in the checklist client components.
- **Trends** — the stacked charts become a **panel grid** (`lg:grid-cols-2`) of elevated chart cards.
- **Reports** — the 2-col card list (shipped) gets the `.co-card` treatment; consider a wider comfortable density on desktop.

## Phases (each its own PR, verified with desktop+mobile screenshots)

1. **Foundation + dashboard exemplar** — the globals system (§1) + app-bg gradient + apply `.co-card` to the dashboard so the premium look is visible + proven.
2. **Card restyle sweep** — `.co-card` across the remaining surfaces (workflow-orchestrated, per-surface, phone-safe).
3. **Charts** — gradient/refined chart styling.
4. **Stretch fix** — FocusedShell + watermark on forms/editors.
5. **Adaptive dense surfaces** — checklist multi-column, trends panel-grid.

## Verification

Per phase: `build` + `typecheck` + a desktop (≥1280px) and mobile (390px) screenshot on a local dev server (login where needed). The #113 lesson stands: build-green ≠ renders-right — eyeball every surface at both widths.

## Risk

Low per change (presentational), but broad. Phasing + per-surface screenshots contain it. Phone layout preserved; elevation/radii are safe at all sizes.
