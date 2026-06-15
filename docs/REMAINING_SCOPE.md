# CO-OPS — Remaining Scope to "Done"

**Written 2026-06-13.** Shared map: where the build is, what's left, and the order to finish.
Supersedes the scattered "C.54-ish?" mental model. This is the board we plan from.

> **Confidence note:** the wave/amendment ladder below is *reconstructed* from `MODULE_PRIORITY_LIST.md`
> + `SPEC_AMENDMENTS.md` + git history on 2026-06-13. Treat statuses as accurate-as-of-reconstruction.
> **Verify the specific amendment status against `SPEC_AMENDMENTS.md` before locking any wave for build.**
> An Aggie adversarial pass against this doc is queued (see `docs/aggie-briefs/` if present).

---

## 0. Scope posture + build order (Juan, 2026-06-15) — READ FIRST

**CO-OPS is being finished LIGHTER but robust.** Pete and Juan didn't reach a pay agreement, so Juan is trimming CO-OPS to a lean-but-solid daily-operations ledger and shifting more time to BLOC OS. **Wave 2 (daily report surfaces) gets built for real; Waves 3–8 (vendor/inventory, comms, training, customer-facing, AI, time clock) are now MAYBE — build only if a clear need surfaces.** Don't plan as if the full 7-wave roadmap is committed.

**Build order (CC's recommendation — build in this order unless Juan re-prioritizes):**
1. **Cash Deposit Confirmation** — completes the daily-capture set (opening / am-prep / mid-day / closing already built). **Operational flow (Juan, 2026-06-15):** at end of day — count the register + verify it's correct → count the tips → write out the names of everyone on shift → deposit the money in the office safe. So the capture artifact = register count + verification, tip total, on-shift staff list, deposit confirmation. (`/cash` stub; `/api/photos` available if a photo of the count/deposit is wanted, but it's primarily counts + names, not photo-driven.)
2. **Maintenance Log** — cheap read surface over equipment-tagged completions across opening / closing / mid-day. Surfaces already-captured data. (`/maintenance` stub.)
3. **PM / Mid-Shift Report** — read surface aggregating the day's reports. (Net-new route.)
4. **Reports Hub** — browse/search across all report types; do AFTER 2–3 report types exist. (`/reports` stub.)
5. **Admin UI (C.44)** — robustness/maintainability: edit templates / pars / users without re-seeding. API backend already exists (§6); this is the UI. The "finish it right" capstone so CO staff can run it without a dev.

Each module: brainstorm fresh, reuse the rich shared backend (§6), one captured migration per DB change, smoke each.

---

## 1. Where we are (the C.5x opening-report arc is DONE)

Production is live at `co-ops-ashy.vercel.app`. `main` is clean — **0 open PRs, 0 open issues.**
The opening-report arc that consumed the last several sessions has fully shipped:

| Amendment | What | Shipped via |
|---|---|---|
| C.41 | Role-model renumber to 0–10 scale (migration 0058) | PR #47 (`eee61e7`) |
| C.55 | Cross-user mark-not-done (KH+ reopen of a false completion) | PR #48 (`5586056`) |
| C.53 §10 | Three-phase opening restructure; spot-check absorbed into Phase 1 | `899061f` + `42562d3` |
| C.53 Phase 2 (Commit B) | Dual-membership prep write-path + Phase 2 prep UI | PR #50 (`7a4ef2e`) |
| C.52 (realtime-lite) | Phase 2 collaborative prep — per-item save + `saved_by`/`saved_at` attribution + multi-author-on-load + append-only revoke (live-sync **deferred** by Juan) | subsumed by PR #50 |
| FT.2 | i18n re-namespace (`section_verify.*` / `recount.*`) | 2026-06-13 (this cleanup) |

**The build is NOT "almost done."** The opening report is one module. The roadmap is 7 waves.

---

## 2. The frontier (next unbuilt MODULE)

**The Opening Report arc is fully done** (see §1). Its Phase 2 — **C.52 collaborative prep** — is **CLOSED**:
shipped as *realtime-lite* via C.53 Commit B (PR #50) — per-item save, `saved_by`/`saved_at` attribution,
multi-author hydration on load (`loadOpeningState`, unfiltered), append-only revoke. The spec's literal
*live real-time subscription* clause (C.52 §, "updates surface immediately") is **intentionally deferred**
(Juan, 2026-06-13): for a ~10-person kitchen where preppers split stations and a page refresh shows everyone's
work, realtime-lite is the chosen v1. **C.52 is a *phase of Opening Report*, not a standalone module** (per
Aggie's spec read — corrects the earlier "competing Wave 2 item" framing).

**Next unbuilt module = C.43 Mid-day Prep.** It depends on Opening Report's bring-to-par output (which Phase 2
now produces), so the dependency is satisfied. This is the recommended next build.

---

## 3. The wave ladder (remaining modules)

Status legend: ✅ shipped · 🔨 in progress · ⏳ pending · 💤 deferred (needs its own design conversation / data runway)

### Wave 2 — Operational report surfaces (CURRENT)
- ✅ Opening Report (Build #3) — incl. **Phase 2 / C.52 realtime-lite** (live-sync deferred) · ✅ Standard Closing v2
- 🔨 **Mid-day Prep (C.43)** — *next build*; multiple numbered instances/day; needs the `loadAmPrepState` discriminator (AGENTS.md flags it)
- ⏳ Mid-Shift Report (read surface) · ⏳ PM Report
- ⏳ Cash Deposit Confirmation (needs photo service) · ⏳ Maintenance Log (read surface) · ⏳ Catering Reports

### Wave 3 — Reports Hub
- ⏳ Search/filter/inbox across all report types (depends on Wave 2 report types being live)

### Wave 4 — Supply chain
- ⏳ Vendor Profiles → ⏳ Inventory Ordering (closes the par→order→delivery loop)

### Wave 5 — Operational tooling
- ⏳ Internal Comms · ⏳ Tip Pool Calculator · ⏳ Catering Pipeline + Customers

### Wave 6 — People / training
- ⏳ AOR / Training Module · ⏳ Deep Cleaning Rotation · ⏳ Recipe Flash Cards
- 💤 Module #2 User Lifecycle & Recruitment (C.34/C.25/C.45 — tag-based trainee/trainer capability)

### Wave 7 — Customer-facing + analytics
- ⏳ Customer Feedback (QR/no-login form) · ⏳ LTO Performance Tracking · ⏳ Weekly/Monthly Rollups (needs ~12 wks data)

### Wave 8 — Deferred (needs runway / integrations)
- 💤 AI Insights (needs 3–6 months operational history) · 💤 Time Clock (C.47 — Toast/7shifts adapters)

---

## 4. What blocks "launch" vs what's enhancement

- **Launch-blocking:** Wave 2 report surfaces + Reports Hub (operators need full daily visibility), plus the
  prod-data scrub in `docs/LAUNCH_PURGE_MANIFEST.md`.
- **Post-launch enhancement:** Waves 4–7 deepen value but the ledger can run without them.
- **Explicitly deferred:** Wave 8 (AI, Time Clock) — gated on data runway / third-party integration phases.

**Definition of done:** CO-OPS runs as the primary operational ledger for 3+ months with no spreadsheets/paper
for shift accountability, cost tracking, or inventory.

---

## 5. Amendment status — reconciled (Aggie spec pass + CC git check, 2026-06-13)
- **C.21** — LOCKED (mid-day prep init open to level 3+); settled, not pending.
- **C.22** — ✅ SHIPPED in Build #1 (notes-edit = re-completion event). Not pending.
- **C.24** — documented *intentional deviation* (service-role page reads; hardening pass planned in v1.3). Not an unbuilt feature.
- **C.25 / C.45** — DEFERRED to Module #2 user lifecycle (C.45 supersedes C.25's framing).
- **C.43** — ✅ SHIPPED (2026-06-14, merged `03be60c`) — full two-phase Mid-day Prep module + closing auto-tick.
- **C.44** — admin **API backend built** (`/api/admin/checklist-templates[/id]/items`, `/pars`, `/users`, `/vendors[/id]/items`, `/locations`) but every admin **page is a PlaceholderCard stub** → the admin **UI is unbuilt** (that's the C.44 build target).
- **C.51** — DEFERRED stub (Status: Deferred — slot reserved).
- **C.52** — CLOSED (realtime-lite shipped via Commit B; live-sync residual deferred by Juan). A phase of Opening Report, not a standalone module.

## 6. Git-grounded recount — verified by reading the actual `page.tsx` files (2026-06-14)

| State | Routes |
|---|---|
| **REAL (shipped feature pages)** | `dashboard` · Opening Report · AM Prep · **Mid-day Prep** · Closing v2 · auth (login / verify / reset-password) |
| **STUB (`PlaceholderCard`, ~17 lines — unbuilt)** | `operations/prep`(sheet) · `operations/overlay` · `operations/synthesis` · `reports` · `ordering` · `recipes` · `rollups` · `tips` · `training` · `comms` · `cash` · `catering/customers` · `catering/pipeline` · `lto` · `maintenance` · `feedback` · `ai` · `announcements` · `written-reports` · `deep-cleaning` |
| **PARTIAL** | **admin (C.44)** — API backend built, all admin pages are stubs (UI unbuilt) |

Each stub is a ready-to-replace scaffold. **Rich shared backend already exists** for new report modules to lean on: `/api/checklist/*` (completions, submissions, confirm, revoke, mark-not-done, tag-actual-completer, instances, `prep/generate`), `/api/photos`, `/api/notifications`, `/api/toast`, `/api/shifts`, `/api/sms/process-queue`.

> **Net:** the spec map's "pending" is **accurate** — those Wave 2–8 routes are stubs, not hidden shipped work. (This corrects an earlier CC over-claim that the map "undercounts shipped work" — that came from seeing route *names* in `next build` output without reading the pages. Verify-against-ground-truth, applied to CC's own prior claim.)
