# Module: Reports Console — Vision Doc

**Status:** Future module. Designed once Build #2 (Prep) and Build #3 (Opening) ship the artifacts that feed it.

**Date drafted:** 2026-05-01 (during Module #1 Build #1 step 8, dashboard scope-narrowing).

**Why this doc exists:** Build #1's dashboard intentionally stays small and operator-action-focused. The instinct to grow the dashboard into a "reports console" — tabs for today/yesterday/history, filters, drill-down, data-quality flags, role-scoped synthesis — was deliberately rejected during step 8 design. Those needs are real but they belong to a separate management-facing surface, not the operator dashboard. Capturing the requirements here so they aren't forgotten when the surface gets built properly.

---

## Architectural framing — dashboard vs reports console

**The two surfaces coexist; neither becomes the other.**

| Surface | Audience | Time horizon | Primary question |
|---|---|---|---|
| **Dashboard** (built — step 8) | Operator on shift | Now / today | "What do I need to do right now?" |
| **Reports Console** (this doc) | Management | Today / yesterday / history | "How is the operation going?" |

**Dashboard discipline (locked):**
- Action-oriented, compact, today-focused
- One operational card per selected location
- Edge-case alert when yesterday's closing wasn't confirmed (operator concern: "what didn't get done last shift?")
- No tabs, no filters, no drill-down, no historical view

**Reports Console discipline (planned):**
- Analytical, historical, filterable
- Tabs across time horizons
- Filters across artifact types and roles
- Drill-down per artifact
- Data-quality surfacing (where signal is missing or suspect)

The dashboard does NOT grow into the reports console. They are two distinct surfaces with different mental models. Resist any future ask to "add a History tab to the dashboard." The right answer is: build the reports console.

---

## Reports Console requirements (from Module #1 Build #1 step 8 design conversation)

### R.1 Time-horizon tabs

- **Today** — current operational day (artifacts dated today in location TZ)
- **Yesterday** — immediately prior operational day; primary use case is reviewing the previous shift's quality
- **History** — anything before yesterday, with a date-range picker or a default "last 7 days" view that paginates back

Tab selection persists in URL so deep-linking works.

### R.2 Filters

Any combination of:
- **Artifact type:** opening checklist / prep instance / closing checklist / shift overlay / written report / announcement / training report
- **Role tier:** filter overlay sections by the role that owns them (e.g., AGM-owned cash + voids vs MoO-owned strategic notes). Useful for management to quickly see "what did the AGM-tier work look like?"
- **Location:** when the viewer has multi-location access
- **Status:** confirmed vs incomplete_confirmed vs (for prep) submitted vs not-yet-triggered
- **Triggered-by:** for prep instances, filter by `triggered_by ∈ {closing, opening, manual}` (per SPEC_AMENDMENTS.md C.18) — visible signal for which roles are catching depletion

### R.3 Per-artifact drill-down

Each artifact in a list view expands or links to a detail view showing:
- Full content (every line item with its completion / who / when)
- Audit trail (every state transition this artifact went through)
- Photos attached (when Build #4 ships photos)
- Related artifacts (e.g., a prep instance shows the closing instance that triggered it via `triggered_by`)
- Notes and incomplete_reasons surfaced inline

### R.4 Data-quality flags

The console surfaces cases where signal is missing or suspect:
- **Zero counts where counts are expected** — e.g., a count item completed with `count_value = 0` (could be legitimate "we have zero left" or could be a closer who tapped through; needs management eyes)
- **Missing role-scoped inputs** — e.g., a closing was confirmed but the AGM-tier overlay sections (cash / voids / comps) weren't filled by anyone level 5+
- **Confirmed-with-incomplete patterns** — locations that frequently confirm with incomplete required items
- **Unsupervised closes** — the confirmer's role level is the lowest level that has touched the instance (no senior supervision visible on the artifact)
- **Late confirmations** — closing confirmed long after the operational day ended (e.g., next-morning confirmations)

These flags don't gate the operational flow — they surface for review.

### R.5 Cross-artifact synthesis

The console connects artifacts that are operationally related:
- **Yesterday's closing → today's opening** — when both exist, show the closer's AM Prep List estimate alongside the opener's spot-check observations. Surface disagreements (per SPEC_AMENDMENTS.md C.20: opening as verification, not data-input).
- **Closing → triggered prep instance** — when a closing's Phase 2 (per C.19) generated a prep_instance, link them so management can see closer-estimated needs against actual fulfillment.
- **Mid-day prep triggers within a shift** — show the pattern of `triggered_by: 'manual'` prep instances over time per role / per location, to surface staffing or par-tuning signal.

### R.6 Role-scoped section visibility

The shift_overlay artifact has fields owned by different role tiers (per spec §7.2: KH-tier cash, SL-tier voids/comps/staffing, AGM-tier vendor/people, GM-tier strategic, Owner-tier executive, CGS-tier forecast). The console respects the viewer's level when rendering — a Shift Lead viewing a Manager-of-Operations strategic note still sees the artifact but the section is collapsed-or-redacted.

This isn't an RLS concern — RLS gates row access, not column visibility. App-layer enforcement at the console UI.

### R.7 Read-receipts

Per spec §10 / `report_views` table (already in foundation): track who has viewed each artifact. Surface in the console as a "Reviewed by Pete · 8:14 AM" indicator on each row, so management can see whether their team has actually engaged with what was submitted.

### R.8 Reports history retention

By default, the console paginates indefinitely back through `audit_log` retention (currently unbounded — per spec §4.15). When `audit.retention_change` becomes a real admin action (Phase 5+), history is bounded by retention policy. The console should surface a "showing N days of history; X older artifacts archived" indicator when retention has clipped older data.

### R.9 Export

Bulk export to CSV / JSON for management's own analysis tooling. Per `reports.bulk_export` destructive-actions entry in `lib/destructive-actions.ts`, this is a step-up-gated action.

### R.10 Search

Full-text search across artifact bodies (written_reports, shift_overlay free-text fields, checklist_completion notes, incomplete_reasons). Backed by Postgres `tsvector` columns added when this module ships.

---

## What the dashboard explicitly does NOT do

For future-Claude reading this when someone asks "should we just add a Yesterday tab to the dashboard?":

**No.** The dashboard is the operator's "what now" view. It shows:
- Today's status for the operator's selected location
- A warning when yesterday's closing wasn't confirmed (an operational concern, not a historical view)

That's it. Tabs, filters, drill-down, history — all belong to the reports console. Adding any of them to the dashboard breaks the surface's discipline and starts the slide toward the dashboard becoming a kitchen-sink "everything" page.

The right answer when the ask comes: scope the reports console module, build it as its own surface, link to it from the dashboard if there's an obvious entry point, but keep the surfaces distinct.

---

## Build sequencing

Reports Console can't ship until Build #2 (Prep) and Build #3 (Opening) are live, because:
- R.5 cross-artifact synthesis requires both to exist
- R.4 data-quality flags assume the full artifact set is being produced
- R.2 filters across opening / prep / closing assume all three artifact types are populated

Earliest realistic ship: after Module #1's other builds land. Could be Module #4 (Report Review per spec §9.1) or could be promoted earlier if management's drill-down need becomes acute before then.

---

## Capture-the-spec

The original Module #1 spec (Foundation Spec v1.2) called the Module #4 "Report Review" — synthesis view aggregating closing + opening + prep + overlay artifacts. Reports Console is the operationalization of that spec line, with the requirements above filling in what "synthesis view" actually means in management hands. When Module #4 design starts, this doc is the input.
