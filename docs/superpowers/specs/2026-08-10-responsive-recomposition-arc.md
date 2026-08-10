# Responsive recomposition arc — spec (2026-08-10)

Juan-ratified kickoff decisions (2026-08-10, follow-up to council-audit PR #244):
the width-ladder sweep widened CONTAINERS; this arc recomposes CONTENT. Phone
stays exactly as tight as today; desktop gets real composition; **tablet (md) is
a first-class form factor — the shops run tablets** (ratified), so the middle
breakpoint gets designed, not interpolated.

## Ratified decisions

- **D1 — Checklist composition = TWO-COLUMN FLOW** on lg+: sections flow into two
  side-by-side columns (more visible at once, same tap-through order); single
  stack on phone; md = wider single column with two-up item grids where items are
  short (temps, checkboxes). The existing mobile auto-collapse observer stays
  disabled on desktop (UI-system law).
- **D2 — Surface order (Juan's call): DASHBOARD FIRST**, then opening/closing,
  then the inventory spine (counts/receiving/ordering), then remaining ops
  (cash/pm-report/mid-day/am-prep), then admin stragglers.
- **D3 — Cadence: ONE PR PER SURFACE FAMILY**, each smoked by Juan on preview
  before merge. His eyes are the gate; CI is necessary, not sufficient.
- **D4 — The `(authed)` layout shell lands with the FIRST PR** (dashboard):
  admin-style width shell at the layout level, per-page wrappers retire as each
  family is recomposed (never a blind strip).

## Composition rules (all surfaces)

1. Phone (base): unchanged from today — the current layouts are the mobile spec.
2. Tablet (md): designed middle — two-up grids for short items, side-by-side
   form field pairs, but no side rails.
3. Desktop (lg/xl): real composition — columns/rails/master-detail as fits the
   surface; content never exceeds readable line lengths inside its column.
4. Grid rule stands: cards/lists compose in grids; charts and forms never
   stretch full-bleed (a form field's max width is a readability decision).
5. Curated elevation, EmptyState, co-card, ladder tokens: reuse, never re-derive.
6. Every PR: screenshot-verified locally where possible + Juan preview smoke
   (UI-arc law: build-green ≠ renders-right).

## PR 1 — Dashboard (next)

The front door. Current state: renders through AuthShell's narrow ladder — a
breakpoint narrower than every hub page (council C1 finding). Scope:
- Move dashboard off AuthShell's width onto the house shell (D4's layout shell).
- Recompose tiles: phone = today's stack; md = 2-col tile grid; lg+ = 3-col
  with the attention/pulse strip spanning full width above.
- AuthShell itself is untouched for login/verify (narrow is CORRECT there).
- Opening flow is NOT in PR 1 (PR 2) — but the shell must not disturb it.

## Deferred-with-reasons (carried from PR #244 close-out)

Wave-2 bucket unchanged (atomicity RPCs, portal Spanish, etc. — see
`docs/superpowers/plans/2026-08-09-council-audit-fix-program.md`). The 7 leftover
en-CA copies and receiving "oz/each" hardcode ride along opportunistically as
their files get recomposed.
