# SIM DAY — controller incident ledger (2026-08-11)

## SIM-1 · Opening phase 1 is single-sitting/single-submitter — employee work is VOLATILE
Maya (employee, EM) filled the ENTIRE phase 1 (44 verifications, 8 temps) — UI showed
"44 of 44 verified · 8 of 8". Submit correctly refused her role ("contact a manager").
DB probe: instance `open`, **0 completion rows** — phase 1 persists atomically at
submit only; all her work lived in client state and died at logout. The collaboration
story (employee preps → manager confirms) requires HANDING OVER THE PHYSICAL SCREEN
without navigation. Rosa's shift will confirm she inherits an empty form.
Class: workflow design. Question for Juan: is phase 1 meant to be manager-driven-only
(then why can employees fill it?), or should partial work persist?

## SIM-2 · An EMPLOYEE was offered the "location was closed (planned)" closure assertion
Maya reports selecting closure reason "Location was closed (planned)" during her
opening flow. A closure assertion is operational truth with downstream meaning
(gap/taint machinery) — should the least-informed role on the floor be able to
assert it casually? Verify which surface asked + whether it wrote anything (probe
found no rows — may also be volatile client state), and whether it should role-gate.

## SIM-3 (watch) · AM prep not findable by an employee
Maya (level 3) couldn't find AM prep in 3 honest tries (no tile visible to her, nav
had no entry, reports hub empty). Employee IS the base level for am-prep per the
visibility comment — either the predicate excludes her (intended?) or this is a
discoverability gap. Luis (MEP, es) retries this shift — watch his result.

## Positive signals so far
Location-bind held (instance landed EM despite haiku's misnaming). Role gate on
opening submit held with a human-readable message. Tile login + PIN flow: zero
friction for a haiku-grade user.

## SIM-4 · PROD DATA ODDITY: location codes and names are CROSSED
Live locations (cloned verbatim): code `EM` → name "P Street"; code `MEP` →
name "Capitol Hill". Every doc/memory assumed EM=Eastern Market & MEP=P Street.
Both sim agents logged into their correct ASSIGNED shops and flagged the naming
mismatch against their briefing — gates held. QUESTION FOR JUAN: are prod's
location codes/names intentionally crossed, or is this a real prod data bug
(display codes like EM-20260811-BALDOR carry these codes on POs!).

## SIM-1 addendum · persistence contradiction resolved
Luis's "work persisted" = in-tab client state (no logout between visits); Maya's
died at logout. DB: BOTH opening instances have 0 completion rows. Confirms:
phase-1 entry is browser-held until the atomic submit. Dashboard "En progreso"
derives from the instance existing, not from any saved work — arguably
overstates progress to the next person.

## SIM-3 upgrade · AM-prep unfindable by employees: CONFIRMED (2/2 agents)
Both employees searched the reports hub (where it is not) and never found the
am-prep surface. Whatever the visibility predicate intends, the DISCOVERY path
for the role that does the prep is broken or absent.

## SIM-5 (harness note) · numeric spinbuttons resist Playwright's fill
Luis: spinbutton controls unresponsive to automation (plain textboxes fine).
Future agents instructed to click + TYPE into number fields. If a real tablet's
numpad behaves oddly on these, same class — worth one human check.

## SIM-6 · ⭐ P1 CAUGHT LIVE: lined-discrepancy credits have NEVER filed (V1-to-now)
Rosa flagged one line `short` at the door → delivery saved, credit LOST, cryptic
`credit_write_failed` 500. Root cause (DB-verified): `vendor_credits_line_reason_uq`
is a PARTIAL unique index (WHERE delivery_item_id IS NOT NULL) and Postgres refuses
partial indexes as bare ON CONFLICT arbiters — supabase-js upsert cannot emit the
predicate, so deriveAndUpsertCredits 500'd on EVERY lined credit since V1 shipped.
Never seen before because all prior smokes used the missing-item path (plain insert).
FIXED in working tree (app-side idempotency: pre-read existing pairs → insert missing;
same re-run semantics) + `receiving.error.credit_write_failed` i18n pair added.
PROD IMPACT: any real flagged-line credit would have been silently lost. Ships in the
sim-findings PR.

## SIM-7 · Phase-2 finalize contradicts its own summary (BLOCKED Rosa's confirm)
"36 de 36 entradas · Listo para enviar" + enabled button → click → "Faltan 1
artículo(s) de prep por guardar" though every item showed "Guardado por Rosa".
Validation iterates a different structure than the counter (the known
validation-vs-operator-state bug class). BLOCKS the opening confirm ceremony
downstream. Investigate post-sim in the phase-2 finalize validator.

## SIM-8 (minor) · duplicate_delivery rendered the ENGLISH server message on an es UI
The es key exists — that path shows raw server `message` instead of t(code).
Also "[PHOTO PENDING]" note suffix is untranslated. i18n render-path minor.

## Rosa positives
KH+ CAN submit phase 1 (SIM-1's intended flow = employee fills, KH+ submits, one
sitting). Dup-invoice guard caught the double-file correctly. First-ever-delivery
door flow completed by a stranger. Yesterday-closure prompt gave honest
"no closing data" context (SIM-2 softened: the prompt explains itself).

## SIM-9 · BACK button repaints the PREVIOUS user's cached page (shared-tablet concern)
Deshawn hit browser BACK mid-flow → the page showed Luis's session (name, Spanish,
Capitol Hill) with no warning. Almost certainly bfcache serving a stale snapshot —
NOT an auth switch (cookie stays Deshawn's; live requests render Deshawn) — but on a
SHARED SHOP TABLET a stale view of another employee's screen post-logout is a real
privacy/confusion finding. Fix class: Cache-Control no-store on authed pages +
Clear-Site-Data on logout. MUST repro on a prod build before filing (dev-server
caching differs). Severity: P2 pending repro.

## SIM-3 extension · mid-day prep ALSO unfindable by an employee (pattern 3/3)
Deshawn couldn't find mid-day prep from the dashboard. Combined with AM-prep (2/2
employees blocked): the prep surfaces' employee-level DISCOVERY story is broken as a
CLASS — tiles either gated above employee or not rendered; nav has no entries.
Check the tile visibility predicates vs intent post-sim.

## Deshawn positives + minors
Role gates held everywhere he poked (locked forms, refused finalize, clear message).
Post-submit opening reads as locked to employees — correct posture. MINOR: logout
affordance hard to find (he escaped via root URL); UserMenu discoverability on
phone-size worth a look.

## SIM-11 · ⭐ P1 CAUGHT LIVE #2: /ordering 500'd for every key-holder
Angel (KH) → /ordering crashed 3/3: loadWalkerData→loadOnHand carries the counts
SURFACE gate (COUNT_READ_MIN=AGM+), so the walker died for the exact role the walk
was designed for. Never seen live: every prior smoke ran at L10. FIX (hot-applied +
verified 200 as a real KH session): derivation/surface split — loadOnHand keeps its
AGM+ gate for the counts page; new loadOnHandDerived core feeds the walker under the
walker's own PAR_PASS_MIN + location bind (server = derivation authority). Ships in
the sim-findings PR. LESSON: role-persona simulation catches what owner-level smokes
structurally cannot.

## SIM-10 · Stale on-device receiving draft resurrects into a FRESH intake (shared-tablet class)
Angel picked a vendor and an unlabeled "New item" line from a PRIOR session's
localStorage draft silently joined his fresh delivery — no item name, easy to fill
blind. Same shared-device class as SIM-9. Fix ideas: key drafts by user+day, label
restored rows loudly ("restored from earlier"), offer discard. P2.

## SIM-11 hardening addendum (automated security review concur)
The hot-fix's first shape exported the derivation UNGATED (caller-enforced) — the
exact rely-on-caller class our own verifier hunts. Hardened: loadOnHandDerived now
SELF-GATES (KH+ ON_HAND_DERIVED_MIN + location bind, actor required); counts surface
stays AGM+ via loadOnHand. Re-verified /ordering 200 as a real KH post-hardening.

## PRIYA'S HAUL (AGM, first-ever UI count + full PO lifecycle — DB-verified: 1 count/7 lines, PO EM-20260811-PFG→placed+transmission)

## SIM-12 · Step-up runs BEFORE validation → credential "spent" on a doomed save (UX, not a bypass)
Count submit prompted password, she entered it, THEN the save failed unit-conversion
validation. Retry did NOT re-prompt. CLASSIFICATION: working-as-designed — step-up
unlocks for a window (the counts step-up surface flag), so the retry correctly rode
the live unlock; NOT a security hole. But the ORDER is wrong UX: validate payload
BEFORE demanding the credential (don't burn a step-up on a request that can't succeed).
Fix: move the step-up gate after input validation in the counts route. P2.

## SIM-13 · ⭐ ON-HAND PANEL is honest plumbing but an unreadable GAUGE (manager verdict)
An AGM could not answer "am I short?" from it: oz-only (1 case iceberg = "640 oz"),
NO par / NO variance / NO cost columns, "since: 0.0 oz · 0d ago" mute on every row,
provenance copy contradicts itself ("No audit yet" while rows read "counted:"). This
is the surface managers will live in once counts go live — it needs the par/variance/
cost triad and human units. P2, design-worthy (feeds Dynamic Pars).

## SIM-14 · Loose/partial count contributes 0 oz (Duke's Mayo 2 cases→256oz, partial dropped)
Partial/loose fraction shown as a footnote ("1 loose · 1 partial") but NOT summed into
on-hand oz. Either a resolve bug or an unimplemented path — real inventory undercount.
Investigate resolvePerSkuAnchors partial handling. P2.

## SIM-15 · DATA: seeded pack sizes wrong (Ham 1 case=16oz vs Bacon 240oz) — 37/79 PFG SKUs "no weight set"
The missing-weight hints (our T13 build!) WORKED — flagged 37 unconvertible rows, and
those correctly lose the Suggest chip. But it surfaces how much seed weight data is
missing/wrong. This is Juan's SKU-weight-checklist errand made concrete: the app is
now POINTING at exactly which SKUs need weighing. Positive for the feature, TODO for data.

## SIM-16 · Suggest doesn't net out on-order ("Suggest 1" after placing 1 today)
After placing a qty-1 order, the walker still says "Suggest 1" (cryptic "last: 1"
marker). Suggested-qty math ignores already-on-order POs → double-order risk. P2,
real operational bug.

## SIM-17 (minors, ordering polish) · Price column all em-dashes + no order total (no price history in sim — EXPECTED, but a live shop with no price history sees the same blank approve screen) · changing a row's item keeps prior qty · validation error names no row + dev language ("pack chain") · channel defaults to "In person" · "1 vendor orders" grammar · portal-url "TBD" shown as copyable data.

## PRIYA POSITIVES
THE COUNT LANDED (first ever via UI — census spine works end to end). Full PO lifecycle
draft→confirmed→placed+transmission+timeline with actor name = "best screen in the app"
(her words). Two-tap confirm, order-day auto-expand, missing-weight hints all praised.
Step-up modal appeared and worked. Provenance badges present on every row.

## NICOLE'S HAUL (AGM Capitol Hill — 2nd full PO lifecycle MEP-20260811-PFG→placed via Phone; 2nd UI count)

## SIM-14 RECONCILED · partials DO count (Nicole: Cucumber 2+0.5 → 158oz correct)
Priya's "0 oz partial" was a NARROWER path (specific SKU/unit), not a general partials
bug. Downgrade SIM-14 to: investigate the specific case, not the whole partial engine.

## SIM-18 · ⭐⭐ DASHBOARD DOESN'T REFLECT REALITY — 2/2 AGM CONVERGENCE (the arc's top UX finding)
Both AGMs independently: after a placed PO + a recorded count + a logged delivery, the
dashboard still reads "Log a delivery when a truck arrives" / "Run a full audit when the
owner calls" — while Cash/PM tiles DO show status. The landing page is the LEAST
informative screen; nothing told either manager that today's delivery existed or that
it's missing its photo. Every individual screen is good; the dashboard doesn't compose
their state. THIS is the highest-value post-sim work (and dovetails with the
recomposition arc's dashboard PR — same surface). P1-UX.

## SIM-19 · Count form's free-text unit trap (2/2 AGMs, 3 submits each)
SKUs with NO pack chain render a FREE-TEXT unit box that accepts any string, then the
WHOLE audit is rejected at submit ("Can't convert that unit to ounces"). Managers can't
tell which items are un-auditable until failure. Several real shelf items
(Provolone/Turkey/Gloves) cannot be counted at all. Also: "Partial" silently needs a
0-1 fraction (no hint) and reads as a different mental model than the "Loose (below a
full container)" checkbox. Count-entry UX + the same missing-pack-chain data gap as SIM-15.

## SIM-20 · Money absent across the ordering/receiving spine
All PO line costs "—", Ordered/Billed totals blank; only 2/5 receiving lines carried
prices against a $462.30 invoice → three-way match can't close. Partly sim-data (no
price history seeded) BUT a live shop with sparse price history sees the same blank
approve screen. Ordering needs a price-coverage signal + the receiving intake should
push for line prices. P2.

## SIM-21 · Receiving shows Invoice# where a PO code belongs; unordered-truck not flagged
Nicole: Baldor delivery detail shows "#BLD-88421" (an invoice number) styled like the
PO-code thread, and links back to no order — because Angel received an UNORDERED truck.
The page never says "no order behind this" (unlike the vendor-claim block which flags
its own gap). Distinguish invoice# from PO-code in the UI; flag unordered deliveries. P2.

## SIM-18b · "Today's orders" board didn't live-update after a walk
Said "Nothing ordered yet today" while rendering the new draft directly below it —
router.refresh/revalidation gap on the ordering board. P2 (same staleness family as SIM-18).

## NICOLE POSITIVES
2nd clean PO lifecycle (Phone channel, conf# logged, timeline+actor). Partials work.
Receiving-against-PO preload ("Expected N × unit", one-tap confirms) praised. Draft
badge surfaces correctly. Cross-link threading strong AT LOG TIME.

## TOMMY'S CLOSE (SL P Street — closing confirmed, cash deposited; DB end-state CLEAN)

## SIM-22 · ⚠ confirmInstance 500-then-retry-200 on CLOSING confirm — DEFER, do NOT guess-fix
Instance f484bf6a: /api/checklist/confirm threw 500 "confirmInstance update returned 0
rows — RLS denial or status changed since load", retry 200. FINAL DB STATE CLEAN:
status incomplete_confirmed, 1 submission, 1 final_confirm, 4 reasons — NO duplication,
so T6b retry-idempotence HELD (this is my council-arc code; it did not corrupt). Root
cause AMBIGUOUS from data: either (a) a race-loser correctly refusing a double-confirm
and surfacing the raw guard error instead of a friendly "already confirmed" 409, or
(b) a status-precondition mismatch specific to the CLOSING confirm path (closing may
enter confirm at a status other than "open"). NEEDS clean-room repro + systematic-
debugging POST-SIM. NOT hot-fixed (load-bearing + unconfirmed root cause = defer, per
confirm-before-authoring). User-facing wart regardless: a raw dev-language 500 where a
human 409 belongs. Likely related to SIM-7 (phase-2 finalize) closing-ref machinery.

## SIM-23 · Cash "Projected (from Toast)" not pre-filled despite the label
Label implies live Toast; sim has no Toast so it's blank — but a live shop mid-integration
sees the same empty "from Toast" field and types manually. Either wire it or soften the
label when no sales data. P3 (partly sim-data).

## SIM-24 · Cash drawer-total mental model trap (the $200 float)
Drawer total must be sales+float; entering just sales read "$203 short" and looked like
an emergency before the math clicked. Final readout ("Deposit $503 · $2 short") was clean.
Add a field hint: "enter the full drawer incl. the $200 float". P2 UX.

## TOMMY POSITIVES
Closing confirm ceremony works (review→explain-unfinished→PIN). Report-ref items behave
correctly: read-only status links, "Cash deposited" AUTO-FLIPPED the instant cash was
filed (the pull-based reconcile working live!), others stayed Pending needing typed
reasons. Cash over/short + post-submit summary "clean and trustworthy". Cash-before-close
gate enforced.

## MARCUS'S VERDICT (GM both shops — the sim's thesis)

## SIM-18 CONFIRMED 3/3 · GM CANNOT SEE THE OPERATION FROM THE DASHBOARD
Priya + Nicole + Marcus, independently, unanimous. Deliveries, the count, and the placed
order are invisible/buried on dashboard + mid-shift; the dashboard shows the empty "log a
delivery" CTA WHILE a delivery exists (actively lying). Only cash/close surface. To
reconstruct the day the GM had to open /operations/receiving + /counts + /ordering across
2 locations. THE #1 POST-SIM BUILD. Dovetails exactly with the recomposition arc's queued
dashboard work — same surface, now with a proven content spec: put deliveries, counts,
orders ON the dashboard + mid-shift.

## SIM-25 · ⚠ STATUS FIDELITY: one close reads THREE ways + a FALSE FRIDGE ALL-CLEAR
Same P St close: "Submitted with incomplete items" (dashboard) / "Done" (mid-shift,
over-optimistic flattening) / "incomplete_confirmed" (reports hub, truthful). Pick ONE
source of truth. WORSE — Cap Hill mid-shift shows "All fridges in range" while ALSO
alerting "8 fridges have no reading": a false all-clear on a FOOD-SAFETY surface. That
second half is elevated — a no-reading fridge must never render as in-range. Investigate
mid-shift fridge aggregation post-sim. P1-display (safety-adjacent).

## SIM-26 · PM eval opt-out bias + missing-crew
Two-up eval layout WORKS (measured 2-across, no cramping — recomposition win). But every
eval defaults to "Good" (opt-out grading biases scores up) and only auto-lists crew who
FILED reports — the 0-task sloppy employee is the one you must remember to ADD. Flip to
explicit grading + auto-surface everyone on shift. P2.

## SIM-27 · /rollups is an unbuilt stub; no both-shops combined view
Reports hub indexes report artifacts well (best status fidelity in the app) but only
report TYPES — receiving/counts/orders absent; /rollups stub; no cross-location roll-up.
The "assemble today's story" surface doesn't exist yet. Design-worthy.

## MARCUS POSITIVES
PM report + 4 evals filed clean. Two-up eval layout verified genuinely 2-across.
Reports hub = best status fidelity in the app ($2 short, incomplete_confirmed shown
truthfully). Location switcher worked for a dual-location actor. Nothing broke under
the GM's whole-board poking.
