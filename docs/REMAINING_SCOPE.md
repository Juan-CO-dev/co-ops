# CO-OPS — Remaining Scope to "Done"

**Written 2026-06-13.** Shared map: where the build is, what's left, and the order to finish.
Supersedes the scattered "C.54-ish?" mental model. This is the board we plan from.

> **Confidence note:** the wave/amendment ladder below is *reconstructed* from `MODULE_PRIORITY_LIST.md`
> + `SPEC_AMENDMENTS.md` + git history on 2026-06-13. Treat statuses as accurate-as-of-reconstruction.
> **Verify the specific amendment status against `SPEC_AMENDMENTS.md` before locking any wave for build.**
> An Aggie adversarial pass against this doc is queued (see `docs/aggie-briefs/` if present).

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
- **C.43** — LOCKED, awaiting build → **this is the next module**.
- **C.44** — admin tooling **partially shipped** (CC git check found `app/admin/checklist-templates/*`, `app/admin/pars/*`, `app/api/admin/checklist-templates/[id]/items`). Verify functional-vs-stub before relying.
- **C.51** — DEFERRED stub (Status: Deferred — slot reserved).
- **C.52** — CLOSED (realtime-lite shipped via Commit B; live-sync residual deferred by Juan). A phase of Opening Report, not a standalone module.

> **⚠ Caveat (load-bearing):** this map's Wave 4–7 "pending" counts were reconstructed from spec docs. CC's C.44 check already found a shipped admin suite (templates/pars/users/vendors/locations/audit) the spec-only map missed — so the "~8 admin surfaces pending" figure **overcounts remaining work**. Before planning any wave, do a **git-grounded status recount**, not just a spec read. (This is the exact "verify against ground truth" lesson from AGENTS.md.)
