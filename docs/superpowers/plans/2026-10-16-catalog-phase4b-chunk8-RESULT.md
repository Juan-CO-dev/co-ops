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

7. As SMM, New sandwich and Toast entries are absent. With a valid same-origin
   request, New sandwich create/preview/reconcile POSTs and Toast POST return
   403 forbidden; Toast GET is refused too. No write or identity disclosure.

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

7. As SMM, Swap and Back to normal entries are absent; same-origin Swap and
   Back preview/save POSTs return 403 forbidden. Swap GET is refused too.

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

5. As SMM, Share is absent on SKU, recipe and menu-item pages; same-origin
   preview and save POSTs for EACH kind return 403 forbidden.

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



## Final chunk 7 P3 correction round (starting HEAD 0caa224b)

Changes remain UNCOMMITTED on `feat/catalog-phase4b-job-pages`, worktree
`C:\Users\conta\co-ops-cat-p4b`. No push, merge, production access, migration or
equivalence-pin change. The supplied Aggie review defines this bounded fix round.

### Dispositions and files

- P3-1: `docs/guides/manager-guide.md` quotes the shipped en/es swap choices,
  Share title and Back preview/confirmation labels. Also corrected the Spanish
  Swap title. Dictionary-driven assertions pin these quoted labels.
- P3-2: `app/admin/items/page.tsx` and `app/admin/menu-costing/page.tsx` derive
  `canOpenSkuItem` using the same `catalogWriteRoleAllowed` gate as the SKU-page
  reader. `CatalogClient.tsx` and `MenuCostingClient.tsx` carry it to SKU links.
  Eligible actors keep scoped item/price destinations; SMM gets the exact usable
  list deep link (`?sku=<id>#<id>`). No reader or write authorization is relaxed.
  Missing capability defaults to the list destination. Server tests cover SMM,
  AGM, GM and MoO; render tests cover both destinations in en/es.
- P3-3: `tests/catalog-entry-navigation.test.ts` adds the negative query assertion
  for the GM/default recipe-list case, exact costing CTA href matching, and the
  missing GM/All-shops costing case in en/es. Two independent temporary mutations
  forced global queries: each failed exactly its two relevant bilingual cases.
  Both source files were restored byte-for-byte in finally blocks.
- P3-4: `app/admin/vendors/[id]/page.tsx` catches only the optional shop-name
  lookup, omits labels and shows a quiet bilingual note. The loader and GET stay
  strict. Added paired copy in `lib/i18n/en.json` and `es.json`.
  `tests/catalog-vendor-page-labels.test.ts` executes the actual page and label
  loader: lookup failure keeps the editor and available SKU, removes names and
  shows the note; successful lookup retains names without a note, in en/es.

The two source-link assertions in `tests/catalog-deep-links.test.ts` now pin the
complete conditional including both destinations. No assertion was removed or
weakened: existing eligible-user expectations remain, expanded with fallback,
server capability and exact no-query assertions.

### Failing-first and probe evidence

`.tmp/final-p3-red-fixed-fixture.json`: 32 passed / 8 failed (four fallback
cases, two guide-copy cases, two page failures from `loadGuideSkuShopNames:
offline`). The first fixture attempt omitted an empty vendor_order_guides table;
those fixture failures are not product evidence. Final correction run:
`.tmp/final-p3-final-focused.json`, 58 passed / 0 failed across three files.
Mutation evidence: `.tmp/final-p3-mutant-recipes.json` and
`.tmp/final-p3-mutant-costing.json`, two expected failures each.

The new vendor test fixture required TypeScript repairs to avoid instantiating
Supabase's recursive generic builder in the spy, and the existing JSX runtime
pattern to satisfy no-children-prop. Its narrow fake-query spy is now typed and
lint-clean. Application code did not change for these fixture repairs.

### Commands and results

```powershell
npx.cmd vitest run tests/catalog-entry-navigation.test.ts tests/catalog-vendor-page-labels.test.ts tests/catalog-deep-links.test.ts --maxWorkers=2 --reporter=json --outputFile=.tmp/final-p3-final-focused.json
# PASS: 58 tests, 3 files.

npx.cmd vitest run tests/catalog- tests/swap tests/share.test.ts tests/sku-swaps tests/order-guide tests/shop-owned tests/new-item tests/new-sandwich tests/shop-context.test.ts tests/step-up-tier-map.test.ts --pool=threads --no-cache --maxWorkers=2 --testTimeout=60000 --reporter=json --outputFile=.tmp/final-p3-focused.json
# PASS: 1,960 tests. Includes inventory 170; read-boundary 8;
# shop-context 146; tier-map 13. Final vendor fixture rechecked above.

npx.cmd next typegen
npx.cmd tsc --noEmit
# PASS: final typegen succeeds, final tsc exit 0.

node --max-old-space-size=1536 .tmp/final-p3-lint.cjs
npx.cmd eslint tests/catalog-vendor-page-labels.test.ts --format json --output-file .tmp/final-p3-eslint-recheck.json
# Fresh repository comparison: 2,239 current / 2,178 main source paths.
# Replacing the corrected test's result yields 65 errors / 369 warnings
# on both current and main: error delta 0, warning delta 0.
# Existing lint debt remains. No suppression added.
```

Lint uses the same local origin/main and full-repository comparison method
recorded earlier in this RESULT. Evidence: `.tmp/final-p3-eslint-current.json`,
`-main.json`, `-recheck.json`, `-current-final.json`, `-summary-final.json`.
Relevant bug-class checks: BC-004 both access directions, BC-017 shipped
vocabulary, BC-040 optional-label failure path.

The first full run recorded 12,433 passed / 4 failed / 3 skipped, 751 files.
Besides the two known tsx startup failures, it found two text-assertion failures
from CRLF introduced by Windows file writing (manager-guide-scheduling and
step-up-edit-window-wiring). Restored LF in touched files without changing those
assertions. Final targeted and full rerun evidence follows below.


```powershell
npx.cmd vitest run tests/manager-guide tests/step-up-edit-window-wiring.test.ts tests/catalog-entry-navigation.test.ts tests/catalog-vendor-page-labels.test.ts tests/catalog-deep-links.test.ts --maxWorkers=2 --reporter=json --outputFile=.tmp/final-p3-final-guide.json
# PASS: 69 tests / 5 files after restoring LF.
```

### Known tsx ENOMEM spawns (separate from application findings)

- `tests/people-chunkE-review.test.ts:130`: starts `scripts/check-boh-positions.ts`.
- `tests/pm-criteria.test.ts:140`: starts `scripts/seed-pm-criteria.ts`.

Both reproduced independently with NEXT_PUBLIC_SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY explicitly blank: child exit 1 before the scripts'
expected missing-credentials exit 2. Neither accessed a database. Evidence:
`.tmp/final-p3-tsx-startup.json`.

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
errno: -4057; syscall: uv_os_get_passwd
```


### Final full-suite outcome and handoff

```powershell
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=2 --testTimeout=60000 --reporter=json --outputFile=.tmp/final-p3-full-final.json
# Exit 1: 12,435 passed / 2 failed / 3 skipped, 751 files.
# ONLY failures: people-chunkE-review.test.ts and pm-criteria.test.ts,
# the independently reproduced tsx ENOMEM startup failures listed above.

git diff --check
# PASS.
```

The final full run includes the final fixture and restored LF files. Both earlier
line-ending failures now pass. No application-test failure remains; the full
suite is explicitly NOT reported all-green because the two environment startup
failures remain. All requested focused/inventory/read-boundary/shop-context/
tier-map checks passed; typegen then tsc passed; ESLint delta is zero.

Open limits: existing repository lint debt, the two recorded environment startup
failures, and CC's review plus the previously documented CC-owned authenticated
browser/SIM gates. No browser/SIM run or new cross-family approval is claimed.
All changes remain UNCOMMITTED; HEAD is still `0caa224b` on
`feat/catalog-phase4b-job-pages`, worktree `C:\Users\conta\co-ops-cat-p4b`.

## Final origin and P3 repair round (starting HEAD 3f4b616b)

### Scope, plan and dispositions

CC's supplied rulings authorize this bounded correction pass: enumerate every
route in recipes/items/skus/products/menu-items plus every other admin route
using assertStepUp; prove rejection before work with failing tests, add the
existing guard first, correct retired-recipe copy, update the CC walkthrough,
and run focused, boundary, type, lint and full-suite checks. The affected
contract is rejection of missing/foreign Origin before session/body/I/O.
The compatibility risk is synthetic or non-browser callers missing Origin.
No schema, tier, grant, role, business writer or translation changes.

- P2: **121 unguarded mutation handlers -> 0**, across 111 repaired
  files. The five named families account for 24; the other step-up admin
  routes account for 97. Explicit inventory: 142 files / 173 handlers,
  including 153 mutations (32 already guarded) and 20 GET handlers.
  Every added guard uses the existing assertSameOrigin helper, first in the
  handler and immediately returned on refusal.
- P3-1: the requested whole-branch whitespace check ALREADY passed at intake
  on 3f4b616b; the older 0caa224b finding is not reproduced at this head.
  The updated RESULT is written with exactly one terminal newline.
- P3-2: walkthrough sections 2, 3 and 4 now explicitly require SMM entry
  absence and 403 forbidden on New sandwich/Toast, Swap/Back and each Share
  kind, including preview/reconcile and associated reads. These are CC-owned
  walkthrough instructions, not claims that authenticated walks were run.
- P3-3: RecipeItemClient's output section uses writable scope (target) to
  select retirement versus view-only copy; inactive recipes retain no edit
  link. Reuses the existing en/es recipe_inactive sentence.

### Complete missing-guard list (before; all guarded after)

Paths below are relative to app/api/admin/. Mixed read handlers are unchanged.

| Route file | Mutation handlers repaired |
|---|---|
| `categories/route.ts` | POST |
| `catering/capacity/[id]/route.ts` | PATCH |
| `catering/capacity/route.ts` | POST |
| `catering/faq/[id]/route.ts` | PATCH |
| `catering/faq/route.ts` | POST |
| `catering/fulfillment/route.ts` | PATCH |
| `catering/item-sizes/[sizeId]/route.ts` | PATCH, DELETE |
| `catering/lto/events/[id]/cancel/route.ts` | POST |
| `catering/lto/events/route.ts` | POST |
| `catering/menu/[id]/route.ts` | PATCH |
| `catering/menu/[id]/sizes/route.ts` | POST |
| `catering/packages/[id]/route.ts` | PATCH |
| `catering/packages/route.ts` | POST |
| `catering/pricing/[id]/route.ts` | PATCH |
| `catering/pricing/route.ts` | POST |
| `catering/rate-rules/[ruleId]/route.ts` | DELETE |
| `catering/rate-rules/route.ts` | POST |
| `catering/zones/[id]/route.ts` | PATCH |
| `catering/zones/route.ts` | POST |
| `checklist-templates/[id]/items/[itemId]/definition/route.ts` | PATCH |
| `checklist-templates/[id]/items/[itemId]/input-type/route.ts` | PATCH |
| `checklist-templates/[id]/items/[itemId]/min-role/route.ts` | PATCH |
| `checklist-templates/[id]/items/[itemId]/par/route.ts` | PATCH |
| `checklist-templates/[id]/items/[itemId]/promote/route.ts` | POST |
| `checklist-templates/[id]/items/[itemId]/route.ts` | PATCH, DELETE |
| `checklist-templates/[id]/items/[itemId]/section/route.ts` | PATCH |
| `checklist-templates/[id]/items/[itemId]/unlink/route.ts` | POST |
| `checklist-templates/[id]/items/route.ts` | POST |
| `checklist-templates/enable/route.ts` | POST |
| `checklist-templates/item-questions/[id]/route.ts` | PATCH, DELETE |
| `checklist-templates/item-questions/route.ts` | POST |
| `checklist-templates/needs-link/[lineId]/route.ts` | POST |
| `checklist-templates/registry/[itemId]/default/route.ts` | PATCH |
| `checklist-templates/registry/[itemId]/opening-verify/route.ts` | PATCH |
| `checklist-templates/registry/[itemId]/route.ts` | PATCH |
| `checklist-templates/registry/route.ts` | POST |
| `checklist-templates/section-questions/[id]/route.ts` | PATCH, DELETE |
| `checklist-templates/section-questions/route.ts` | POST |
| `checklist-templates/sections/[slug]/disable/route.ts` | POST |
| `checklist-templates/sections/[slug]/reorder/route.ts` | PATCH |
| `checklist-templates/sections/[slug]/route.ts` | PATCH |
| `checklist-templates/sections/[slug]/shape/route.ts` | PATCH |
| `checklist-templates/sections/route.ts` | POST |
| `checklist-templates/units/route.ts` | POST |
| `customers/confirm/route.ts` | POST |
| `customers/export/route.ts` | POST |
| `customers/route.ts` | POST |
| `ezcater/location/route.ts` | POST |
| `items/[itemId]/sold-directly/route.ts` | PATCH |
| `menu-items/[id]/price/route.ts` | PATCH |
| `menu-items/route.ts` | POST |
| `order-types/route.ts` | POST |
| `products/[id]/active/route.ts` | POST |
| `products/[id]/members/route.ts` | POST, DELETE |
| `products/[id]/primary/route.ts` | POST |
| `products/[id]/route.ts` | PATCH |
| `products/route.ts` | POST |
| `recipes/[id]/inputs/[inputId]/route.ts` | PATCH |
| `recipes/[id]/inputs/route.ts` | POST |
| `recipes/[id]/outputs/route.ts` | POST |
| `recipes/[id]/route.ts` | PATCH, DELETE |
| `recipes/edges/route.ts` | DELETE |
| `recipes/full/route.ts` | POST |
| `recipes/route.ts` | POST |
| `report-recipients/route.ts` | POST |
| `report-recipients/settings/route.ts` | POST |
| `sevenshifts/route.ts` | POST |
| `skus/[id]/location-settings/route.ts` | PUT |
| `skus/[id]/pack-chain/route.ts` | POST |
| `skus/[id]/price/route.ts` | POST |
| `skus/[id]/route.ts` | PATCH |
| `skus/measure-units/route.ts` | POST |
| `skus/pack-formats/route.ts` | POST |
| `skus/route.ts` | POST |
| `stations/route.ts` | POST |
| `template-builder/[id]/items/[itemId]/spine-link/route.ts` | POST |
| `template-builder/[id]/items/[itemId]/translations/route.ts` | PATCH |
| `template-builder/[id]/publish/route.ts` | POST |
| `toast-employees/route.ts` | POST |
| `toast-map/[id]/route.ts` | POST |
| `toast-map/location/route.ts` | POST |
| `toast-map/manual/route.ts` | POST |
| `toast-map/match/route.ts` | POST |
| `toast-sales/exclusions/[id]/route.ts` | POST |
| `toast-sales/exclusions/route.ts` | POST |
| `toast-sales/pull/route.ts` | POST |
| `users/[id]/activate/route.ts` | POST |
| `users/[id]/deactivate/route.ts` | POST |
| `users/[id]/dormant/route.ts` | POST |
| `users/[id]/locations/route.ts` | POST |
| `users/[id]/reset-pin/route.ts` | POST |
| `users/[id]/role/route.ts` | POST |
| `users/[id]/route.ts` | PATCH |
| `users/[id]/set-password/route.ts` | POST |
| `users/[id]/wake/route.ts` | POST |
| `users/route.ts` | POST |
| `vendors/[id]/categories/route.ts` | PUT |
| `vendors/[id]/contacts/[contactId]/route.ts` | PATCH, DELETE |
| `vendors/[id]/contacts/route.ts` | POST |
| `vendors/[id]/cutoffs/[cutoffId]/route.ts` | DELETE |
| `vendors/[id]/cutoffs/route.ts` | POST |
| `vendors/[id]/order-types/route.ts` | PUT |
| `vendors/[id]/ordering-details/[detailId]/route.ts` | PATCH, DELETE |
| `vendors/[id]/ordering-details/route.ts` | POST |
| `vendors/[id]/rhythm/route.ts` | POST, DELETE |
| `vendors/[id]/rhythm/skips/route.ts` | POST, DELETE |
| `vendors/[id]/route.ts` | PATCH |
| `vendors/[id]/schedule/route.ts` | PATCH |
| `vendors/[id]/transmission/route.ts` | PATCH |
| `vendors/route.ts` | POST |
| `weights/route.ts` | POST |

### Failing-first evidence

The initial regression run on unchanged application code produced **282 passed /
486 failed**: exactly 484 origin failures (121 handlers x four invalid-origin
cases), plus the two en/es retired-recipe cases. No import or fixture error in
that red run. Evidence: .tmp/final-origin-red.json.

The first green run passed 1,105 tests across the two new suites plus catalog
write inventory, read boundary, shop context and tier map. A subsequent addition
to the inventory test also pins the first two statements of every mutation
handler, preventing work from being inserted ahead of the guard.

The inventory is explicit, compares discovery to its route list, and compares
each module's HTTP exports to its listed methods. Each mutation executes four
invalid-origin requests against the actual handler and asserts no session,
body parsing, step-up or database call. Same-origin controls reach the existing
session gate. The UI regression renders the actual output section in en/es,
with both retired and active writable-shop cases.

### Fixture compatibility and completed checks

Fifteen existing test files construct browser requests without Origin. The
isolated pre-update fixture run recorded 195 passed / 82 failed. Added only
same-origin headers, and replaced station-schedule-api's plain Request cast with
an actual NextRequest. All existing assertions remain unchanged. The complete
focused rerun passes **1,535 tests / 21 files**, including:

- admin-write-origin: 919 (142-file inventory; 153 mutations x six checks).
- catalog-write-origin: 170; catalog-read-boundary: 8.
- shop-context: 146; step-up-tier-map: 13; retired-recipe render: 2.
- The 277 existing tests in the 15 fixture files all pass.

A structural comparison strips precisely the added import and two statements
from each repaired handler: all 111 route files then match HEAD (line endings
normalized for comparison). No other route logic changed.

Walkthrough probe against HEAD: sections 2/3/4 each lack the SMM 403 refusal
step; the working copy passes all three. Both HEAD and working copy already
have exactly one terminal newline. No false failing-first claim for P3-1.

Commands (raw reports are local ignored .tmp files):

```powershell
# Fifteen fixture files plus these six boundary/regression suites:
npx.cmd vitest run tests/catering-catalog-window.test.ts tests/step-up-grants.test.ts tests/sevenshifts-admin-route.test.ts tests/recipe-inline-output.test.ts tests/customer-pr2-routes.test.ts tests/report-recipients-api.test.ts tests/station-schedule-api.test.ts tests/shop-owned-write-errors.test.ts tests/shop-owned-full-route-pglite.test.ts tests/shop-owned-recipe-writes.test.ts tests/recipe-line-edit-server.test.ts tests/catalog-job-routes.test.ts tests/shop-owned-registry.test.ts tests/menu-prices-data.test.ts tests/shop-owned-menu-price.test.ts tests/admin-write-origin.test.ts tests/catalog-recipe-retired.test.ts tests/catalog-write-origin.test.ts tests/catalog-read-boundary.test.ts tests/shop-context.test.ts tests/step-up-tier-map.test.ts --pool=threads --maxWorkers=2 --reporter=json --outputFile=.tmp/final-origin-focused-final.json
# PASS: 1,535 / 1,535; 21 files. Exact fixture paths are in the JSON report.

npx.cmd next typegen
npx.cmd tsc --noEmit --incremental false
# Initial and final post-fixture runs: PASS, exit 0 for both.
# Final logs: .tmp/final-origin-typegen-final.log and -tsc-final.log.

node --max-old-space-size=1536 .tmp/final-origin-lint.cjs
# Full repository comparison: 2,241 current / 2,178 main source files.
# Both: 65 errors / 369 warnings; error delta 0, warning delta 0.
# Re-linting the 15 updated fixtures plus the two new suites and replacing
# those entries in the full report keeps the same totals and delta.
# Evidence: final-origin-eslint-summary-final.json, -current-final.json,
# -main.json and -recheck.json. Existing lint debt remains.

git diff --check origin/main
git diff --check d28ec084
# PASS: both exit 0, including the tracked RESULT across the whole branch.
```

The first full-suite attempt was stopped before completion to repair the
confirmed request fixtures. It is NOT a completed full-suite result. The final
full run uses the completed code and fixtures, with no tests skipped or weakened.

### Known tsx ENOMEM spawns (separate)

- tests/people-chunkE-review.test.ts: starts scripts/check-boh-positions.ts.
- tests/pm-criteria.test.ts: starts scripts/seed-pm-criteria.ts.

Both reproduced independently in this round with NEXT_PUBLIC_SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY explicitly blank. Each child exited 1 before the
script's expected missing-credentials exit 2; neither accessed a database.
Evidence: .tmp/final-origin-tsx-startup.json.

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
code: ENOMEM; syscall: uv_os_get_passwd
```

### Final full-suite result and handoff (2026-10-17)

```powershell
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=2 --testTimeout=60000 --reporter=json --outputFile=.tmp/final-origin-full-final.json
# Exit 1: 753 files; 13,356 passed / 2 failed / 3 skipped; 13,361 total.
# ONLY failures: people-chunkE-review.test.ts:130 and pm-criteria.test.ts:140,
# the independently reproduced tsx ENOMEM startup failures above.
```

The full suite is explicitly NOT all-green. No application-test failure remains,
and no test was skipped, suppressed or weakened by this repair. Final typegen
and tsc both exit 0; final ESLint error/warning deltas are both zero. Separate
`git diff --no-index --check -- /dev/null <file>` checks pass for both new tests,
so the whitespace evidence also covers untracked deliverables.

Changes: 111 route files, RecipeItemClient, this RESULT, 15 existing request
fixture files, and two new suites (admin-write-origin, catalog-recipe-retired).
All 130 files remain UNCOMMITTED on `feat/catalog-phase4b-job-pages` at
`3f4b616b`, clone `C:\Users\conta\co-ops-cat-p4b`. No push or merge.

Open limits: the two environment startup failures, pre-existing lint debt,
CC's final cross-family review and the documented authenticated browser/SIM
walkthroughs. This repair pass claims no new independent approval, live schema
access, production write, or authenticated walkthrough execution.

## Aggie security-review repair (2026-10-17, base 110ab5aa)

Scope follows Aggie's reviewed remediation: fix the ezCater POST boundary, classify every admin route, pin the three inert stubs, and update manual gates and the deployment contract. No schema, step-up, or CSRF-host implementation changes.

- P2-1: ezcater-review POST starts with assertSameOrigin and immediate refusal. Its valid fixtures now send the same-host Origin; four refusal cases prove authentication and body parsing are not reached.
- P2-2: admin-write-origin discovers every route.ts/tsx/js/jsx/mts under app/api/admin, requires an explicit disjoint classification, and verifies exported methods. It covers 167 files: 146 mutation-bearing files (157 mutation handlers), 18 read routes, and three inert stubs. POST read exceptions reuse the reviewed read-boundary check. The existing order-guide parameter destructuring has a single exact source exception before its guard; invalid requests still cannot parse a body or authenticate. Multipart import fixtures now reach its existing session gate.
- P3-1: the inventory test has an explicit 120,000 ms timeout.
- P3-4: locations, pars, and vendors/[id]/items are explicit non-mutations because they return a constant 501 without I/O; tests pin their imports, constant response, and handler bodies so implementation requires reclassification.
- P3-3: the three manual curl gates in the phase 1 / 2a / 3a plans send Origin: http://localhost:3100 and use that request host.
- P3-2: AGENTS.md records nextUrl.host semantics, the established Vercel production evidence, and mandatory authenticated custom-domain/alias smoke testing. lib/portal/csrf.ts is unchanged.

Failing-first evidence (ignored local .tmp reports):

- aggie-ezcater-red.json: 20 pass / 4 fail on the pre-fix handler; all four refusal cases returned 400 instead of 403.
- aggie-inventory-red-final.json: 951 pass / 5 fail before adding the guard, all five on ezcater-review (source ordering plus four runtime Origin refusals). An initial run also exposed the multipart fixture mismatch; that fixture was corrected before this final red run.
- aggie-unlisted-probe.json: five temporary unlisted route files, one per requested extension, made discovery fail (172 discovered vs 167 classified). All probe files were removed before final verification.

Focused verification: 1,571 passed / 0 failed across 37 files, including admin-write-origin (956), catalog-write-origin, catalog-read-boundary, step-up-tier-map, and all ezcater-matching suites. No timeout override.

Verification commands and remaining outcomes follow below.

```powershell
npx.cmd vitest run tests/admin-write-origin.test.ts tests/catalog-write-origin.test.ts tests/catalog-read-boundary.test.ts tests/step-up-tier-map.test.ts ezcater --pool=threads --maxWorkers=2 --reporter=json --outputFile=.tmp/aggie-focused.json
# PASS: 1,571 tests, 37 files.
npx.cmd next typegen
npx.cmd tsc --noEmit --incremental false
# PASS: exit 0, zero TypeScript diagnostics. Logs: aggie-typegen.log / aggie-tsc.log.
node --max-old-space-size=1536 .tmp/aggie-lint.cjs
# PASS: node exit 0. ESLint compares all three changed code/test files with HEAD.
# Current 0 errors / 0 warnings; HEAD 0 / 0; both deltas 0.
# Unchanged files have no delta. Reports: aggie-eslint.json / aggie-lint-final.log.
```

### Known tsx ENOMEM spawns (separate, reproduced this pass)

- tests/people-chunkE-review.test.ts: scripts/check-boh-positions.ts.
- tests/pm-criteria.test.ts: scripts/seed-pm-criteria.ts.

Both were independently invoked with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY blank; each exited 1 before the expected missing-credentials exit 2. No database access. Evidence: .tmp/aggie-tsx-startup.json.

```text
SystemError [ERR_SYSTEM_ERROR]: uv_os_get_passwd returned ENOMEM (not enough memory)
code: ENOMEM; syscall: uv_os_get_passwd
```

### Completed full-suite run and handoff

```powershell
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=2 --reporter=json --outputFile=.tmp/aggie-full.json
# Exit 1: 753 files; 13397 passed / 2 failed / 3 skipped; 13402 total.
# Only failures: the two independently reproduced tsx ENOMEM startup tests above.
# Default repository timeout retained; inventory has its explicit 120-second timeout.
```

The full suite is NOT all-green. No other test failed; no test was skipped, suppressed, or weakened by this repair. Final whitespace verification: git diff --check.

Eight changed files remain UNCOMMITTED: AGENTS.md, the ezcater-review route, admin-write-origin and ezcater-mapping-review-route tests, the phase 1/2a/3a manual-gate plans, and this chunk 8 RESULT. Branch: feat/catalog-phase4b-job-pages; HEAD remains 110ab5aa66ce6d0a918080aba30e7b6c0c30de09. Clone: C:/Users/conta/co-ops-cat-p4b. No commit, push, merge, deployment, or production write.

Open limits: the two reproduced environment startup failures; CC/Aggie's final cross-family re-review; authenticated custom-domain/alias smoke remains a deployment gate and was not performed here.
