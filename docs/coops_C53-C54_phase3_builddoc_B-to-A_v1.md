# C.53 §10 Phase 3 — Phase 1 component restructure (spot-check absorbed)

**Status:** plan gate (surfacing to Triad A)
**Build:** Wave 2 Build #1 — C.53 §10 Phase 3
**Activates:** Build #3 PR 4's wired-but-dormant `submitPhase1Atomic` / `needsAttestation` / `count_provenance` paths (per SPEC_AMENDMENTS §11)
**Closes:** d49d1504 stuck-shift class (C.54 §8) once Aggie smoke confirms the operational flow
**Clearance:** PROPRIETARY (default for all tasks unless individually noted)

---

## Pre-build verification (done in this session, before drafting)

### Five rulings folded — references checked

| Ruling | Reference | Status | Anchor |
|---|---|---|---|
| 1. Runtime discriminator via `closerSnapshotsMap.has(id)` | `opening-client.tsx:410` (existing `isSpotCheck`) | ✓ matched | Pattern already in use inside `handlePhase1Submit`; extend to the split derivation |
| 2. Section-verify mounted in `OpeningVerificationStation` | `components/opening/OpeningSectionVerify.tsx` (header-only, 115 LOC) | ✓ matched | Same component imported by `OpeningPrepEntry.tsx:154`; props are pure data (sectionKey, sectionDisplay, verified, disabled, disabledReason, onToggle, language) — no Phase 2 logic coupling |
| 3. `allTicked` filters spot-check items | `opening-client.tsx:177-181` (current `tickedCount`) | ✓ matched | Current loop counts every value with `ticked===true`; spot-check items will live in `phase1Items` post-task-T0.1 and need exclusion |
| 4. `phase1Complete` extended with `spotCheckResolved` | `opening-client.tsx:209-211` (current gate) | ✓ matched | Gate is `allTicked && allTempsFilled`; extension adds a third conjunct |
| 5. Phase 2 tab hide when empty | `opening-client.tsx:596-636` (tab strip) | ✓ matched, no blocking deps (see check below) | Tab always renders today regardless of `phase2Items.length` |

### Phase 2 tab dependency check (pre-task ruling 5)

Required by Triad A before hide is authorized. Verified against `opening-client.tsx` HEAD:

| Surface that could depend on Phase 2 tab presence | Verdict | Evidence |
|---|---|---|
| `activePhase` initial state | safe | Defaults to `"verification"` (line 149); no path lands on `"prep"` unless user clicks the tab |
| `handleTabClick("prep")` reachability | safe | Only invoked from the tab button onClick (line 614). Hidden tab → unreachable |
| Sticky-footer Phase 2 counter | already-gated | `totalPhase2Items > 0 ? ... : null` (line 787) |
| Submit-gate hint Phase 2 branch | already-gated | `activePhase === "verification" ? ... : ...` (line 809); Phase 2 branch only fires when `activePhase === "prep"`, which is unreachable when tab hidden |
| `phase2SubmitEnabled` derivation | safe | Computes when phase2Items empty; for-loop returns `true` at end (vacuously complete). Doesn't matter — `submitEnabled` uses `phase1SubmitEnabled` when `activePhase === "verification"` |
| `<OpeningPrepEntry>` render | safe with patch | Currently renders unconditionally when `activePhase === "prep"`. With tab hidden, never reached. Belt-and-suspenders: also gate the render block (cheap) |
| `handlePhase2Submit` | safe | Only called from `handleSubmit` when `activePhase === "prep"` (line 569-575) — unreachable when tab hidden |
| Piece 4 server-side guardrail | independent | Lives in `app/api/opening/submit/route.ts:464-491`. Triggered by ANY POST to `/api/opening/submit` with instance in `phase1_complete`. Operates on server state, not UI state. Unaffected by tab hide |

**Ruling:** no surface blocks hiding. Tab hide is authorized as task T0.5. No additional defensive code required beyond the tab-button conditional + skipping the `<OpeningPrepEntry>` render (the latter is a 3-LOC belt-and-suspenders, included in task scope).

### i18n key reuse decision (pre-task ruling b)

Existing `opening.phase2.section_*` keys (verified at `lib/i18n/{en,es}.json:427-430`):

| Key | EN | ES | Pure copy? | Reusable on Phase 1? |
|---|---|---|---|---|
| `opening.phase2.section_verify_cta` | "Verify section" | "Verificar sección" | yes | yes |
| `opening.phase2.section_verified_button` | "Verified" | "Verificado" | yes | yes |
| `opening.phase2.section_verified_at` | "Verified at {time} by {name}" | "Verificado a las {time} por {name}" | yes | yes (not yet rendered in Phase 1 surface, but safe) |
| `opening.phase2.section_disabled_null_items` | "Recount items without closer data first" | "Recuenta primero los items sin datos del cierre" | yes | yes |

**Default per Triad A guidance:** reuse all four keys. No new i18n in T0 scope.

**Flag for follow-up (not blocking T0):** namespace is semantically misaligned once spot-check section-verify mounts on the Phase 1 tab — `phase2.*` keys rendering inside Phase 1 chrome. Re-namespace to `opening.section_verify.*` is mechanical (grep+replace across 4 keys × 2 files + 2 callsite renames) and Flash-eligible (pure rename, no logic). Defer to a follow-up rename PR after T0 ships and Aggie smokes the operational flow — flagging now so it's tracked, not blocking T0.

---

## Hotspot accounting

| File | Tasks touching | Owner | Notes |
|---|---|---|---|
| `app/(authed)/operations/opening/opening-client.tsx` | T0.1, T0.3, T0.4, T0.5 | T0 (single owner, single commit) | Hotspot — 4 of 5 tasks land here; tightly coupled via shared derived state |
| `components/opening/OpeningVerificationStation.tsx` | T0.2 | T0 | Adds section-verify header + per-item branching render for spot-check rows |
| `components/opening/OpeningChecklistItem.tsx` | T0.2 (consulted) | T0 | Already has tri-state `closerCount` prop per JSDoc; verify the spot-check render path is rendered when `closerCount !== undefined` and add the recount affordance if missing |
| `components/opening/OpeningRecountPanel.tsx` | T0.2 (consulted) | none | Re-used as-is; props confirmed compatible (`itemId`, `itemLabel`, `initialValue`, `onSave`, `onCancel`, `language`) |
| `components/opening/OpeningPrepEntry.tsx` | T0 cleanup (deferred) | T0 (follow-up commit) | Once spot-check items leave `phase2Items`, the Phase 2 surface naturally has nothing to render. The component stays compiled (referenced from `opening-client.tsx`) but is functionally unreached when `phase2Items.length === 0`. Cleanup (removal of the spot-check rendering half) is C.53 §10 Phase 4 scope, NOT this build |

---

## Lane map (coupled vs parallel)

```
Pre-task (DONE — this session)
├── Phase 2 tab dependency check  ← ruling 5 unblocked
└── i18n key reuse decision        ← ruling (b) default locked

Lane A — opening-client.tsx (T0, sequential, single commit)
├── T0.1  split logic — spot-check items into phase1Items via runtime predicate
├── T0.3  allTicked derivation — filter out spot-check items
├── T0.4  phase1Complete gate — add spotCheckResolved conjunct
└── T0.5  Phase 2 tab hide — conditional on phase2Items.length === 0

Lane B — OpeningVerificationStation.tsx (T0, depends on Lane A interface)
└── T0.2  section-verify header + per-item recount affordance for spot-check rows

Follow-ups (not in this build's scope)
├── Aggie smoke against d49d1504 EM instance (post-merge operational verification)
├── i18n re-namespace opening.phase2.section_* → opening.section_verify.* (Flash)
└── C.53 §10 Phase 4 — OpeningPrepEntry cleanup (remove spot-check render half)
```

**Lane A is one commit.** Tasks T0.1, T0.3, T0.4, T0.5 all live in `opening-client.tsx` and share derived state (`spotCheckItems`, `tickItems`, gate composition). Splitting them across commits creates broken intermediate compile states (Lane A is the canonical "wire-shape coupling" case from the AGENTS.md durable lesson).

**Lane B depends on Lane A's interface lock.** The new prop surface for `OpeningVerificationStation` (whether spot-check rows render section-verify header + recount affordance inside the same station card, or whether a sibling `OpeningSpotCheckStation` is introduced) is a sub-decision Lane A's T0.1 implicitly resolves. Lock: render in the same station card via an in-component branch on `closerSnapshotsMap.has(id)`, avoiding a new component file (stays within Aggie size ceiling). If Lane A's commit reveals a need for a sibling component, Lane B reopens.

**Parallelization opportunity:** Lane B's component changes CAN be drafted in parallel against the locked interface (above) while Lane A is in-flight, BUT must merge after Lane A so the runtime split is in place. Practical recommendation: serialize (Lane A → Lane B) since the LOC delta is small and parallel coordination overhead exceeds the saved time.

---

## Task table

| ID | Task | Owner | Tier | Depends-on | Hotspot | Size (ceiling) | Clearance |
|---|---|---|---|---|---|---|---|
| **PT.0** | Phase 2 tab dependency check | (DONE this session) | — | — | opening-client.tsx | 0 LOC (verification only) | proprietary |
| **PT.1** | i18n key reuse decision | (DONE this session) | — | — | lib/i18n/*.json | 0 LOC (decision only) | proprietary |
| **T0.1** | Split logic — `phase1Items` includes spot-check items via runtime predicate `closerSnapshotsMap.has(item.id)`. Touches `useMemo` split at opening-client.tsx:82-91 | T0 | T0 | none | opening-client.tsx (Lane A) | ~25 LOC patch (ceiling: 30) | proprietary |
| **T0.2** | Extend `OpeningVerificationStation` to render section-verify header (via existing `OpeningSectionVerify` component) for stations containing spot-check items + branch per-item render to surface recount affordance for spot-check rows (via existing `OpeningRecountPanel`) | T0 | T0 | T0.1 (interface lock — spot-check items in phase1Items) | OpeningVerificationStation.tsx (Lane B) + OpeningChecklistItem.tsx (consulted) | ~70 LOC patch (ceiling: 80 — declared, exceeds default 50 due to dual concerns of header + per-item branch) | proprietary |
| **T0.3** | `allTicked` derivation — filter out spot-check items from tick count (they're verified via section-verify, not per-item tick). Touches opening-client.tsx:177-181 + 209 | T0 | T0 | T0.1 (depends on split being in place) | opening-client.tsx (Lane A) | ~15 LOC patch (ceiling: 30) | proprietary |
| **T0.4** | `phase1Complete` gate — add `spotCheckResolved` conjunct (all spot-check items have either section verified OR `openerRecount` populated). Touches opening-client.tsx:211 + new derivation block | T0 | T0 | T0.1, T0.3 | opening-client.tsx (Lane A) | ~25 LOC patch (ceiling: 30) | proprietary |
| **T0.5** | Phase 2 tab hide — conditional render of tab button + `<OpeningPrepEntry>` block when `phase2Items.length === 0`. Touches opening-client.tsx:612-636 + 720-732 | T0 | T0 | T0.1 (depends on the split removing spot-check items from phase2Items) | opening-client.tsx (Lane A) | ~20 LOC patch (ceiling: 30) | proprietary |
| **FT.1** | Aggie operational smoke against d49d1504 EM instance — confirms NULL-source path lands the inline attestation + Phase 1 submits + `count_provenance='reconstructed_morning'` rows + Pattern A MoO+ notification dispatches | Aggie | smoke | T0.1–T0.5 (post-merge) | (operational) | — | proprietary |
| **FT.2** | i18n re-namespace `opening.phase2.section_*` → `opening.section_verify.*` (4 keys × 2 locale files + 2 callsite renames in `OpeningSectionVerify.tsx`) | Flash | Flash | T0.2 (post-merge, no logic coupling) | lib/i18n/*.json + OpeningSectionVerify.tsx | ~12 LOC (Flash ceiling N/A — pure mechanical) | proprietary |
| **FT.3** | C.53 §10 Phase 4 — `OpeningPrepEntry` cleanup (remove spot-check render half; component scope shrinks to non-spot-check Phase 2 items if any, else file deletion) | TBD (next build) | TBD | T0.1–T0.5 + first prod week of phase2Items=empty observed | OpeningPrepEntry.tsx | TBD | proprietary |

**Lane A combined commit size (T0.1 + T0.3 + T0.4 + T0.5):** ~85 LOC patch across opening-client.tsx. Within Aggie aggregate-commit reasonability for a single-file coupled set. Per-task ceilings declared above; combined exceeds default-50 but each individual task is at-or-near default ceiling.

**Lane B commit size (T0.2):** ~70 LOC patch declared ceiling 80; the 30-LOC-default for new files does not apply (no new file is being created — extension of existing OpeningVerificationStation).

---

## Build sequence (recommended)

1. **Lane A commit** (T0.1 + T0.3 + T0.4 + T0.5 bundled) — opening-client.tsx changes go in together; CI runs full build + typecheck against the bundled diff. tsc must be green at the commit boundary.
2. **Lane B commit** (T0.2) — OpeningVerificationStation extension plus any OpeningChecklistItem follow-on changes. CI re-runs.
3. **Single-PR umbrella** — both commits land in one PR (per the AGENTS.md ship-complete principle and the wire-shape coupling rule). PR description includes the preview URL for FT.1 smoke.
4. **Aggie smoke (FT.1)** against the preview URL using EM's d49d1504 instance as the canonical NULL-source case. Confirm the form lights up the inline attestation prompt, allows submit, and that the post-submit state shows `count_provenance='reconstructed_morning'` rows + `opening.submitted_with_no_prior_closing_data` notification dispatched to MoO+.
5. **Merge to main** only after FT.1 passes. Production deploy follows.
6. **FT.2 Flash rename PR** queued for after a clean prod week (low risk, mechanical, no urgency).
7. **FT.3 OpeningPrepEntry cleanup** queued as the C.53 §10 Phase 4 build.

---

## Plan gate items for Triad A

1. **Lane A single-commit bundling** (T0.1+T0.3+T0.4+T0.5 in one commit) — confirms the wire-shape coupling treatment is correct
2. **T0.2 size ceiling override to 80 LOC** (vs default 50) — explicit declaration with rationale
3. **Lane B extension in-place (no sibling component)** — interface-lock decision implicit in T0.1; flag if Triad A prefers a sibling `OpeningSpotCheckStation` instead
4. **FT.2 deferred** (Flash rename non-blocking) — confirm OK to ship T0 with `phase2.*` keys rendering in Phase 1 chrome temporarily
5. **FT.3 deferred to next build** (OpeningPrepEntry cleanup) — confirms C.53 §10 Phase 4 stays its own build, not folded in here
6. **No new i18n keys** — defaults to reuse per ruling (b); confirm no Phase-1-flavor copy variants needed
