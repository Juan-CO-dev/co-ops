# Adaptive desktop layout (direction B) — design

**Date:** 2026-07-15
**Status:** approved (brainstormed with the visual companion; direction "B — adaptive multi-column", the three adaptation rules confirmed)
**Scope:** presentational/layout only — no data, auth, or logic. Phone rendering is UNCHANGED (every rule is gated at `lg:` and up).

## Problem

Every surface is a mobile-first centered column: 32 use `max-w-2xl` (672px); the dashboard + opening wrap in `AuthShell` which is `max-w-md` (448px). On a phone these fill the screen (great). On a ≥1024px laptop the content is a narrow ribbon marooned in a wide sea of Mayo background — sparse and "weird". The problem is two-fold: content is *too narrow* AND has *nothing around it*.

## Direction: B — adaptive multi-column

Make wide screens feel designed-for by (a) gridding what should grid and (b) giving focused surfaces an intentional canvas — without touching the phone layout or the app's minimal-chrome design.

## The primitive

`components/layout/PageShell.tsx` — a responsive container, `variant`:
- **`wide`** — `mx-auto w-full max-w-2xl lg:max-w-6xl px-4 sm:px-6`. For grid/tile/list surfaces.
- **`focused`** — children centered in `max-w-2xl` at all sizes, PLUS a large faded `BrandMark` watermark in the background canvas (`hidden lg:block`, `aria-hidden`, `pointer-events-none`, opacity ~0.05, positioned bottom-right). For forms + reading. This is what makes the empty desktop canvas read *intentional* instead of empty; reuses the `BrandMark` shipped in #113.

Props: `variant?: "wide" | "focused"` (default `wide`), `className?`, `children`. Renders a wrapper `<div>` (the page keeps its own `<main>`/chrome), so it drops into existing structure with minimal churn.

## The three adaptation rules (approved)

| Content | Phone | Desktop (`lg:`+) |
|---|---|---|
| Cards & tiles (dashboard tiles, nav chips, admin cards, widgets) | 1 col | `lg:grid-cols-2 xl:grid-cols-3` |
| Lists (reports list, feedback lists) | 1 col | `lg:grid-cols-2` (or 1 wider col where rows are already dense) |
| Forms & reading (cash, prep, a single report detail) | 1 col | `focused` shell — centered ~680px + watermark canvas |

## Rollout — per-surface, incremental (never one big rewrite)

- **PR 1 (this spec's implementation): Dashboard only.** Introduce `PageShell`; migrate the dashboard to `wide`; report tiles + nav chips + widgets become responsive grids. Resolve the `AuthShell` width interaction (the dashboard currently wraps in the 448px `AuthShell`). This is the "see + feel the pattern" PR before rolling wider.
- **PR 2: Reports** (`/reports`) — `wide` + list two-column.
- **PR 3: One focused exemplar** — cash count or a single report detail — proves the `focused` + watermark pattern.
- **Later:** remaining surfaces migrate incrementally, reusing `PageShell`.

## Opportunistic (while in the shell)

`AuthShell` still typesets "Compliments Only" as text (the pre-wordmark version). Swap it to the real wordmark image, matching login/loading — small brand-consistency fix on a file we're already touching.

## Verification

Per surface: a **desktop (≥1280px) + mobile (390px) screenshot** on a local dev server, confirming the desktop grid fills the space AND the phone layout is unchanged. Plus `build` + `typecheck`. (Lesson from #113: build-green ≠ renders-correctly — the layout must be eyeballed at both widths.)

## Risk

Low and contained. Each surface is independent; all changes gated at `lg:` so phones are untouched; no data/auth/logic. Fully reversible.
