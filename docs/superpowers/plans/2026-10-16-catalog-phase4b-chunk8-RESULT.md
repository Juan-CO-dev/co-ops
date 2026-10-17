# Catalog Phase 4b: Chunk 6 review corrections and Chunk 8 verification

Worktree: `C:\Users\conta\co-ops-cat-p4b`. Branch:
`feat/catalog-phase4b-job-pages`. Starting HEAD: `92f183c9`.
Comparison main: local `origin/main`, `0ae19e22` (also merge base).
Changes remain UNCOMMITTED. No push, merge, deployment, migration, production
access or equivalence-pin edit. Live SIM and authenticated browser evidence is
CC-owned and pending; the instructions below are not execution evidence.

## Part A dispositions

| Finding | Disposition |
| --- | --- |
| P2-1 | The shared recipe output link uses the current scope only when that scope is editable and the recipe active. Otherwise its section displays the existing bilingual view-only sentence. English/Spanish rendering tests open What it makes and cover own shop, foreign shop and writable global scope. |
| P3-1 | Owned sandwich controls pair the 44px floor with `inline-flex items-center`; link, preview and rebase are pinned. |
| P3-2 | After visibility validation, an owned menu item refuses settings preview/apply with 409 `menu_item_has_no_shop_settings`, before dependency snapshot or cost work. This reuses the SQL refusal and existing bilingual copy. Save, restore and back_to_default are covered. Owned price remains its separate authorized path. |
| P3-3 | An acknowledged owned-price save advances the baseline to the committed request price. Refusals and external refreshes do not advance it. Tests save 10 to 12, preview again with expectedPrice 12, then require rebase when another writer moves to 13. |
| P3-4 | Defensive ordering, not a currently reachable production bug: jobs.ts supplies owner undefined with defaultToShop, and the legacy edit page supplies creation=false. No caller is added. The existing explicit-owner ordering regression stays untouched. This qualifies chunk 6's statement that an explicit owner takes precedence. |
| P3-5 | A real async menu-page test pins OwnedSandwichClient versus MenuItemClient, the exact item/scope/owner key, and the unchanged view prop. Changing owner changes the key. Shared behavior remains covered. |

Failing-first evidence: `.tmp/chunk8-red.json` reports 14 passed / 7 failed.
Both foreign-scope locale cases, all three owned settings actions, own-save
baseline and centring failed before source edits. `.tmp/chunk8-green.json`:
21 passed / 0 failed. Routing coverage: 3 passed; it pins existing correct
behavior, so it is not falsely claimed as a pre-existing failing product case.
Two temporary mutations (drop owner from key; select shared client for an owned
view) each reported two failures / one passing shared control and exited 1. Source was restored byte-for-byte in a finally block; reports
are `.tmp/chunk8-routing-mutant-key.json` and `-client.json`.

## Files and assertion ledger

Part A source: `components/catalog/RecipeItemClient.tsx`,
`components/catalog/OwnedSandwichClient.tsx`, `lib/catalog/menu-item-page.ts`.
Part A tests: `tests/catalog-output-navigation.test.ts` (new),
`tests/catalog-owned-menu-routing.test.ts` (new),
`tests/catalog-owned-menu-ui.test.ts`, `tests/catalog-owned-menu-page.test.ts`.
Part B lint repair: `tests/catalog-toast-link-http.test.ts` calls the typed
`route.GET` export directly instead of casting it to `Function`. No assertion or
runtime behavior changes. Part B records: this RESULT and
`docs/superpowers/plans/2026-10-16-catalog-phase4b-chunk8-WORKPLAN.md`.
Raw command evidence is local ignored `.tmp/chunk8-*`.

No baseline assertion was removed or weakened. Added assertions:

- Output navigation: four per locale, eight evaluated: own scoped href exists;
  foreign legacy href absent; view-only sentence present; writable global href exists.
- Owned UI own-save: no rebase after own commit; input retains 12; next preview
  binds expectedPrice 12; external move exposes rebase (four).
- Owned control classes: floor, centring and inline-flex on link and button in
  normal and stale states (three statements, twelve evaluations).
- Owned settings: exact status/code from preview and apply; no cost graph read;
  no owned-price writer call, for each of three settings actions (twelve evaluations).
- Page routing: client identity, exact remount key and view identity for two
  owners and shared mode (nine evaluations).

## Per-chunk evidence assembled

These are historical results from each checked-in chunk RESULT, not new runs.
Their full command lines, intermediate failures and assertion inventories remain
in `2026-10-16-catalog-phase4b-chunkN-RESULT.md` in this directory.

| Chunk | Delivered / final recorded evidence |
| --- | --- |
| 1 | Origin inventory, public preview DTOs, DIRTY cleanup and lease quarantine. Focused 10 files/589 tests plus final cleanup 5/204. Full: 12,086 passed, 2 failed, 3 skipped; 715 files. Two tsx startup failures. |
| 2 | Shared job DTOs, authorized loaders, strict bounded builder reads, Toast read/confirmation. Final corrected combined 11 files/360 tests. Raw full: 12,146 passed, 3 failed, 3 skipped; 723 files; one inventory failure fixed afterward, two tsx failures. No second full claimed. |
| 3 | New item flow and independent setup, stable client attempt, role/scope and cleanup review fixes. Focused 23 files/719 tests; lease contracts 5. Full: 12,188 passed, 2 failed, 3 skipped; 725 files. |
| 4 | New sandwich cost/create, read-only lost-response reconcile, Toast, prefiltered recovery link. Focused 26 files/759 tests. Corrected reviewed full: 12,251 passed, zero failed, 3 skipped; 730 files. Historical tsx flakiness is not counted as failure in that corrected result. |
| 5 | Swap, Share, Back, job entry strip, replacement return, explicit setup/replay summaries. Focused 62 files/1,455 tests. Full: 12,305 passed, 2 failed, 3 skipped; 738 files. |
| 6 | Owned recipe/menu pages, legacy reopen, owner-bound yield and price, previous-review corrections. Focused 264 and integration 37 tests recorded. Full: 12,360 passed, 2 failed, 3 skipped; 744 files. This task corrects the new output-link regression and follow-up P3s. |
| 7 | Entry links, scoped costing/catalog destinations, full order-guide owner labels, bilingual guide. Focused 75 files/1,597 tests, guide 18/169. Full: 12,409 passed, 2 failed, 3 skipped; 748 files. |

## BUILD r2 drift dispositions

| Original assumption | Implemented disposition / evidence surface |
| --- | --- |
| GET Share previews | POST kind/id/share/preview with empty body; Share interaction/HTTP suites. |
| GET Back preview | POST swaps/id/back-to-normal/preview; Back interaction/HTTP suites. |
| Write field token; missing dependency fields | previewToken; expectedOwner; required shareSkuIds/shareItemIds by kind. Share and route tests. |
| Swap bound DTO | Allowlisted ordering/followsPrimary/untouchedShops/recipes/refused/costs; normalized preview.request reused. Preview/Swap tests. |
| Existing SandwichDraft/SandwichCost | NewSandwichRequest plus MenuCostRollup and derived margins; incomplete/unknown statuses retained. New sandwich tests. |
| Existing Toast choices GET | Added bounded read-only DTO/GET over loadSandwichToastChoices; explicit confirmed POST remains separate. Toast tests. |
| Sandwich retries replay identities | Read-only exact recent-actor reconciliation; no automatic second create. Durable replay deferred. Reconcile tests. |
| HTTP setup success means complete | Inspect per-step and per-day inner outcome, refreshRequired and unconfirmed state. New item/setup tests. |
| Rebuild legacy owner selectors | Preserve existing selectors; change success destination and entry links. Legacy/navigation tests. |
| Unscoped picker | Reuse authorized builder catalog, strict reads, ownership filters and pagination. Job-view tests. |
| Owned pages already complete | Added owner/capability projection and direct owned paths, with null write scope distinct from owner-shop read scope. Owned tests. |
| All catalog mutations origin-gated | Full catalog mutation inventory and same-origin-first tests; read-only preview POSTs remain reads. |
| Swap preview already minimal | Public projection excludes internal snapshots; server recomputes full evidence. Preview tests. |
| Cleanup automatically blocks re-entry | Shared DIRTY marker and lease quarantine, no automatic clearance. Cleanup/lease tests. |
| Catalog needs new Only-at chip | Existing chip retained; same translation reused for guide rows. Entry/guide tests. |
| postJson distinguishes uncertain creation | Job-local typed transport distinguishes lost response/missing IDs; shared legacy helper preserved. Transport/controller tests. |

Deferred as in BUILD: durable sandwich request replay; broader vendor/item-number
uniqueness; Catering Toast-tab retirement; sibling admin-family same-origin
hardening. New-item attempt identity remains client-only and does not survive
reopening. No other promised job feature is relabelled as deferred UI work.

## CC-owned SIM and browser execution contract

Before any walk, CC verifies the SIM target and applied 0264/0265/0266 lineage,
exclusive clean fixture lease, synthetic personas and server identity. DIRTY or
failed cleanup blocks entry. Never point these steps at production. Use synthetic
GM-A, GM-B, MoO and SMM accounts, shops A/B, vendors and uniquely prefixed items.
Record the actual IDs privately in the SIM fixture manifest. Use the registered
F4 runner/cleanup lifecycle. Keep tokens, credentials and customer data out of
evidence. Afterward verify retirement and lease cleanup; preserve DIRTY on failure.

Run EVERY numbered job below twice: English (`en`) then Spanish (`es`, operational
tú), using fresh synthetic names per locale. Start authenticated at 375x812.
Repeat successful navigation/save/reopen at tablet and desktop widths. For each
run record role, locale, URL/scope, viewport, expected/actual outcome, sanitized
screenshot or trace and fixture IDs. A missing walk is PENDING, never PASS.

### Keyboard procedure to apply to each job, in each language

1. Use only Tab/Shift+Tab, Enter, Space and native select/number keys from the
   job entry link through completion. Verify visible focus and logical order.
2. Open every used disclosure with Enter/Space; verify aria-expanded and the
   matching controlled region. Closed content must leave the tab order; a dirty
   editor must not disappear on collapse. Ensure translated labels/ARIA identify
   every control, and screen-reader error/status regions announce results.
3. Check every interactive target is at least 44px high with centred content.
   At 375px verify document/body scrollWidth equals clientWidth, including long
   bilingual names, notices, preview, errors, dependency lists and step-up dialog.
4. Cancel the password prompt: no write, draft stays, focus returns usefully.
   Complete it once, then test expiry/stale unlock: named refusal, no automatic
   retry, re-prompt and fresh review. Check double activation sends one write.
5. Switch shop while a preview/read is in flight; old responses must not populate
   the new keyed page. Reload after a confirmed save and inspect persisted values.

### 1. New item

1. As GM-A, open Admin > New item (`/admin/catalog/new/item`). Confirm remembered
   authorized A; a remembered B cannot authorize it. MoO also checks explicit
   global creation, while GM cannot create globally. SMM sees no job entry and
   cannot open/POST it.
2. Pick an existing vendor; in a second case add a synthetic vendor with all
   required contact/ordering/category fields. Cancel Tier B and verify no vendor;
   then save vendor. Cancel item and verify the separate vendor save remains.
3. Enter English/Spanish item name, vendor item number, complete pack chain,
   purchase denomination and price. Verify the pre-Create summary, selected shop
   and cost units. Correct an invalid field and preserve the other entries.
4. Cancel Tier E once; then create. Verify one identity and named success. In a
   fresh attempt let SIM commit but drop its response; retry in the same open
   client with the same request ID, including edited fields. Verify replay opens
   the original identity and explicitly says later edits were not applied.
5. Save pars, order days, guide placement, recipe use and barcode separately.
   Force one order-day/setup refusal through the approved SIM harness. Confirm
   per-day outcomes, partial/unconfirmed notice, and earlier durable saves remain.
   Retry only the failed step after refresh. Reject a short barcode with its
   specific translated message; save a valid synthetic code.
6. Open item and reload: exact returned SKU and shop (global for MoO's global
   item), price/pack and completed setup persist. Skip optional steps and verify
   no false completion. Record that closing an uncertain attempt loses its
   client request identity; do not call that durable replay.

### 2. New sandwich, reconciliation and Toast

1. As GM-A open `/admin/catalog/new/sandwich`; verify A ownership and scoped
   ingredient choices. Enter bilingual names and price. Add/change/remove lines
   with the sentence editor. Verify cost changes and incomplete/unweighed/
   unresolved cases are not presented as complete cost or margin.
2. Review the cost and explicit confirmation checkbox. Edit a line afterward:
   confirmation and prior cost preview must invalidate. Cancel Tier E once,
   then save; exactly one recipe/menu pair is created. Open both scoped pages.
3. For a fresh unique name, drop the create response AFTER SIM commits. Verify
   automatic read-only reconcile, no second create, matched explanation and
   links to the exact recipe/menu IDs. Missing success identities follows the
   same uncertain path. A failed reconciliation read stays uncertain.
4. Reproduce name conflict from another actor and an older existing row: neither
   is treated as this user's replay. Verify ordinary conflict/refusal and no
   foreign identity disclosure. Edit names during an uncertain attempt and
   verify recovery remains bound to the submitted name/scope.
5. For a committed lost response, wait beyond ten minutes before reconciliation.
   Verify the exact localized unmatched explanation, follow its submitted-name
   prefiltered catalog link, find the visible saved sandwich and open it. Record
   this recovery as search/reconciliation, not durable request replay.
6. On Toast, verify suggestion/search does not save. Select a synthetic Toast
   item, explicitly confirm and perform the separate Tier A save. Change search
   or selection and ensure confirmation clears. Exercise no choices/stale choice:
   sandwich remains saved, no false linked status. Reopen and complete the link;
   confirmed state survives reload. Existing Catering Toast tab remains present.

### 3. Swap for now / for good and Back to normal

1. From SKU A's item page choose Swap vendor (`/admin/catalog/sku/<id>/swap`)
   at A. Pick a visible replacement; separately Add item, create replacement,
   and return to this exact source/shop with the replacement selected.
2. Choose For now, review recipe substitutions/refusals, primary followers,
   untouched shops, grouping, costs and ordering/par consequences. Owned sources
   offer only their owner shop. A new product offers optional bilingual names;
   an existing product does not. Change replacement/name/scope after preview:
   confirmation invalidates and a new review is required.
3. Move a dependency from the second SIM session, then confirm the old preview.
   Verify named stale refusal and no partial write. Refresh/review, cancel Tier E
   once, then confirm once. Reload source and verify live temporary-swap banner
   and scoped journal. B is unchanged unless explicitly included and authorized.
4. Modify one affected recipe line after the temporary swap. Review Back to
   normal from the source banner, then save. Check restored lines, retained later
   edits, primary choice and grouping separately. The retained line must NOT be
   described as restored. Replacement creation remains independently saved.
5. Drop the Back response after commit: require journal reload before another
   preview; check already-closed/unchanged outcomes without duplicating a write.
6. With a fresh fixture choose For good; review/confirm/reopen its permanent
   result. Verify there is no live temporary banner offering Back for that act.

### 4. Share

1. As GM-A open owned SKU, recipe and menu pages: Share is absent. As MoO open
   each in its owner scope and preview Share. Verify actual shop/dependency names
   and explicit required SKU/item selections (including empty arrays).
2. For a blocked prep dependency, follow its producing recipe link, verify the
   correct identity/scope, then return and re-preview after resolving the fixture.
3. Cancel Tier E: no share, draft choices remain. Confirm each kind separately;
   SKU's `{shared:true}` response must show success, just as recipe/menu responses
   do. Reload and verify shared visibility and ownership-dependent controls.
4. Change ownership/dependency after preview in the second session. Old confirm
   must refuse with named freshness/ownership error, including for MoO. Check
   previous owner-scoped draft does not survive the ownership remount.

### 5. Owned pages and legacy reopen

1. Create an owned prep recipe with output and an owned sandwich at A; open via
   legacy and catalog links. Confirm owner label, A-scoped picker/cost and correct
   item IDs. GM-B foreign/global reads of owned identities are denied; SMM is
   excluded. Shared recipes still support read-only foreign-shop viewing.
2. Edit owned recipe lines/directions and, for a batch recipe, its sole output
   yield. Review/cancel/save through Tier E; reload legacy/catalog and verify the
   same committed values. A captured old owner or yield is refused. Do not remove
   and re-add the sole batch output to simulate yield editing.
3. On the owned sandwich change price 10 to 12, preview and save. After refresh,
   verify no false rebase requirement; next preview uses 12 as baseline. In a
   second session move price to 13 while the first has a draft: preserve its
   draft, hide stale save, explicitly rebase to 13. Refusal/cancel keeps draft.
4. Send synthetic owned-item save/restore/back_to_default settings previews via
   the authenticated SIM harness: 409 menu_item_has_no_shop_settings before
   write, with localized explanation. Owned-price remains usable by owner GM.
5. As GM-A read a SHARED recipe at B, open What it makes: view-only sentence and
   no Edit outputs link. At writable A, the link opens `/admin/recipes/<id>` with
   A scope and no error boundary. As MoO at global, verify the global link works.
6. Check owned recipe link, preview and rebase labels are vertically centred at
   44px floor in both languages. Share and navigate scopes; verify client remount
   discards old owner/scope drafts and ignores late responses.

### 6. Entry links, guides and legacy ownership

1. For GM-A and MoO, follow Admin New item/New sandwich, costing + New sandwich,
   and recipe-list New recipe/New sandwich. Verify exact routes and authorized
   remembered scope; explicit MoO global stays global. AGM/SMM do not gain writes.
2. Expand catalog SKU edges and follow costing SKU-price warnings: exact SKU,
   selected shop and price job. Follow prep warnings: exact registry item anchor
   and shop. Existing product links retain their correct expansion/anchor.
3. In a vendor guide inspect placed and unplaced owned rows for A and B, plus
   retired-owner and missing-metadata cases. Initial render and reload show the
   same valid Only-at names, no raw UUID or invented shop. Place/save a row and
   verify the complete guide still contains other shops' lines.
4. Open legacy SKU and recipe creation; confirm existing owner selectors and
   inline owned output remain intact. Successful recipe creation opens the
   catalog recipe at its committed scope; failed save retains the draft.
5. Read the English/Spanish manager-guide job section against the observed
   flow: separate saves, partial setup, replay/reconcile and retained Back edits.

## Final command evidence

All test commands use installed dependencies and no live database. Raw reports
are under ignored `.tmp/`; the following counts are from this task.

```powershell
npx.cmd vitest run tests/catalog- tests/swap tests/share.test.ts tests/sku-swaps tests/order-guide tests/shop-owned tests/new-item tests/new-sandwich tests/shop-context.test.ts tests/step-up-tier-map.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts --pool=threads --no-cache --maxWorkers=2 --testTimeout=60000 --reporter=json --outputFile=.tmp/chunk8-focused.json
# PASS: 103 files / 2,010 tests, zero failures/pending.
# Inventory 170; read-boundary 8; shop-context 146; tier-map 13.
# Protected equivalence: counts-onhand 48, recipe 8, shop-owned 27, shop versions 10.
# PGlite: new item 17; owned full route 1; owned 21; owned mutations 6;
# owned review 14; SKU swaps 21. Also shop-owned SQL equivalence 1.

npx.cmd next typegen
npx.cmd tsc --noEmit --incremental false
# Final PASS: both exit 0; no tsc diagnostics.
# Handoff tsc rerun after the test-only cast removal also exits 0 with no diagnostics
# (.tmp/chunk8-tsc-handoff.log).
# Initial tsc exited 2: two TS2345 sites in the new test used an incomplete
# save patch. Added required soldHere/nameOverride/nameOverrideEs fixture fields;
# assertions unchanged. The final full suite includes this corrected fixture.

git diff --check origin/main
# PASS: entire main-to-working-tree tracked range, exit 0.
git diff --exit-code origin/main -- supabase/migrations tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts
# PASS: exit 0; no migration or protected equivalence-file changes across 4b.
```

```powershell
npx.cmd vitest run tests/catalog-toast-link-http.test.ts tests/catalog-owned-menu-page.test.ts --maxWorkers=2 --reporter=json --outputFile=.tmp/chunk8-fixture-final.json
# PASS: 2 files / 14 tests after the fixture completion and type-only lint repair.

npx.cmd vitest run --pool=threads --no-cache --maxWorkers=2 --testTimeout=60000 --reporter=json --outputFile=.tmp/chunk8-full.json
# EXIT 1: 750 files; 12,419 passed / 2 failed / 3 skipped, 12,424 tests total.
# Only failures are the two tsx startup cases listed separately below.

npx.cmd next build
# PASS: exit 0; optimized compilation, TypeScript, page data and static generation.
```

The full suite is NOT green. No test was newly skipped, suppressed or rebaselined to
hide the two failures. The full run began before the final Toast test's type-only
cast removal; its four unchanged runtime tests passed in the full run and again
in the 14-test targeted run after that removal.

### Repository lint delta against main

`node --max-old-space-size=1536 .tmp/chunk8-lint.cjs` uses installed ESLint on ALL
tracked repository JS/TS/JSX/TSX/MJS/CJS sources plus new deliverable source files,
respecting its existing ignores. It excludes local ignored scratch/build files.
There are 2,238 current paths versus 2,178 at local origin/main. Main's changed
sources are read with `git show origin/main:<path>` and linted at their original
file paths; byte-identical unchanged files reuse the same diagnostic result.
ESLint config, package.json and lockfile are unchanged across the range.

Initial completed comparison: current 66 errors / 369 warnings, main 65 / 369,
error delta +1. The sole per-file count increase was
`tests/catalog-toast-link-http.test.ts` (`no-unsafe-function-type`). Removed its
obsolete broad cast; no assertion changed. Then ran:

```powershell
npx.cmd eslint tests/catalog-toast-link-http.test.ts --format json --output-file .tmp/chunk8-eslint-recheck.json
# PASS: exit 0, zero errors/warnings.
```

Replacing that file's result in the full repository report yields **65 errors /
369 warnings on both current and main: errors delta 0, warnings delta 0**.
Existing repository lint debt remains; this is a delta pass, not a lint-clean
claim. No suppression was added. Evidence: `.tmp/chunk8-eslint-main.json`,
`chunk8-eslint-current-final.json`, `chunk8-eslint-summary-final.json`, and
`chunk8-eslint-recheck.json`. The first unbatched lint attempt was interrupted;
only the completed batched comparison and final recheck are evidence.

### Known tsx ENOMEM spawns (separate)

- `tests/people-chunkE-review.test.ts:130`: BOH no-database startup of
  `scripts/check-boh-positions.ts`.
- `tests/pm-criteria.test.ts:140`: no-database startup of
  `scripts/seed-pm-criteria.ts`.

Both failed in this full run. Direct child-process reproduction used
`node node_modules/tsx/dist/cli.mjs <script>` with `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` explicitly blank. Both exited 1 before reaching the
scripts' expected missing-credentials exit 2; neither accessed a database.
Evidence: `.tmp/chunk8-tsx-startup.json`.

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
at Object.userInfo (node:os:305:11)
at node_modules/tsx/dist/temporary-directory-CwHp0_NW.mjs:1:84
errno: -4057; syscall: uv_os_get_passwd; Node.js v22.20.0
```


## Implementation review and remaining gates

The current bug-class catalog is v1.8.0 (67 active classes), newer than the
charter's historical v1.7 count. Relevant checks: BC-001/004 owner visibility
before refusal and writable/read-only scope cases; BC-007 captured-price baseline
and existing atomic writer; BC-013 owned versus shop-overlay semantics;
BC-018/019 reuse of bilingual keys and correction of stale handoff claims;
BC-030/041 actual client/page paths and owner/shared personas; BC-057 named
refusal before a dead-end navigation/snapshot; BC-061 identity/scope/owner remount
key; BC-063 44px floor plus centring. These are author checks, not an independent
cross-family approval (BC-043). CC's final review and live/authenticated walks
remain required. No live schema, real keyboard navigation or SIM write is claimed.

