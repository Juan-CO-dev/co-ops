# Launch-readiness runner (F4 / F2)

## G1-C customer first use

`customer` adds Node contracts and the real anonymous-to-customer Playwright journey. It requires
`cold-empty` and a production build. The parent stops the app and restores before the Node pass
and before **each shop in each viewport**, so customer A is new at both EM and MEP. Repetitions
also restore. CC runs (Git Bash):

```sh
LRA_PROJECTS=phone-en node ~/.claude/hooks/lra-suite.mjs <checkout> customer cold-empty
# Complete matrix / repeated evidence, after CC builds the candidate:
node --import tsx scripts/sim/launch-readiness/run.ts --suite customer --fixture cold-empty --repeat 2
```

Integration wiring prerequisite: the shared `playwright.config.ts` currently rejects `customer`.
It needs the customer journey selector, `LRA_CUSTOMER_SLICE` validation
(`phone|tablet` + `en|es` + attempt + `EM|MEP`), customer report directories and numeric attempt
extraction before CC can execute this suite. That file was excluded from G1-C's authorized file
list; scope clarification is pending. The runner and specs do not bypass the shared fixture.

Mail is private: after `loadSimEnv`, the runner sets `SIM_EMAIL_CAPTURE_DIR` to
`.private/<run-id>/mail` and passes that same path to specs as `LRA_MAIL_DIR`. It overrides any
inherited capture directory. Neither name belongs in `.env.sim` or `ALLOWED_PREFERENCE_KEYS`;
`buildChildEnv` preserves `SIM_` names, and `startProduction` passes the runner's environment.
`RESEND_API_KEY` remains empty. Only `customer-a@sim.invalid` and `customer-b@sim.invalid` can be
captured. A message is `<timestamp>-<sha8>.json`, containing recipient, subject, text, HTML and
hrefs; `sendEmail` returns `{ id: "sim-<sha8>" }` or `{ error }`, never a provider receipt.
**Never export, attach, log or commit these files:** they contain live one-use links. They remain
with local traces until the private run directory is removed. Public artifacts contain closed
assertion/finding IDs, statuses and counts, never mail or tokens. Specs consume only files added
after their request, preventing stale captures from satisfying a restored slice.

Sequence: storefront and denied photos; denied-geocoder error observation; pickup intake;
constant-shape request; real captured link and cookie; customer/draft/Inquiry oracle;
reused/malformed link refusal; two persisted menu lines; immediate final edit/review and real
relogin; concurrent UI submit plus HTTP peer; exact quote/pipeline/payment/demand cardinality;
payment hold; account order; customer B and anonymous refusals; suppressed-mail honesty.
Screenshots cover start, decisions and outcomes. The cart race uses the real UI handlers inside
one browser task, without delaying the persistence endpoint. Submit dispatches its peer while
the UI request is intercepted, then releases both to the app; both responses and persisted effects
must agree. Inquiry produces **zero** prep-demand rows, not a fabricated reservation.

Node contracts cover newest-link replacement, request six in the same fixed 15-minute bucket
(including audit readback), app allowlist suppression separately from `sim_recipient_refused`,
and draft failure through a valid-shaped nonexistent location (no oracle mutations). The delivery
contract resolves `routeDeliveryAction` from the attested build's manifest and makes 12 anonymous
HTTP action calls, requiring real routed/out-of-zone/no-capacity results before naming LRA-053.
A rate-window rollover fails evidence rather than being called a throttle pass.

Findings are soft in the browser and individually recorded in Node results: LRA-005/097 language,
LRA-006 silent draft failure, LRA-007 lost last edit, LRA-009 false delivery claim, LRA-044 missing
error after a denied geocoder, LRA-053 no routing throttle. The denied geocoder is evidence of the
intake error surface; it does not exercise a successfully geocoded pin followed by a failed server
action. That delivery path remains blocked pending the approved geocoder fixture packet.
LRA-008 is **blocked payment activation**, independently of the required `stub: true` / `due`
assertions and the soft assertion against review copy claiming payment through Stripe. Local
capture does not prove Resend/DNS delivery (LRA-139). Known photo/geocoder requests count as
`expectedDenials` only for the specific reviewed host/path pairs; unknown destinations still fail.
The 18 new guide claims remain pending at revision `5241016`, with literal quote hashes; no sim
walk has been claimed by implementation or unit-test results. No i18n keys or product fixes land
in this packet.

Run from the dedicated checkout with Node 22. CC commits and reviews the working tree. Never point this harness at production.

```powershell
npm.cmd install --save-dev --save-exact @playwright/test@1.63.0
npx.cmd playwright install chromium
$env:LRA_LEASE_DIR = Join-Path (Get-Location) 'scripts/sim/launch-readiness/.private/lease-test'
node --test scripts/sim/launch-readiness/contracts/lease.test.mjs
node --import tsx scripts/sim/launch-readiness/run.ts --suite runner --fixture cold-empty --dev --no-restore
```

The lease override above is for sandbox tests only. Ordinary runs must unset it so all clones share `C:/Users/conta/co-ops-assets/lra-sim-lease/`. Do not run two clones with different overrides against the shared sim. Acquisition is an atomic mkdir; `owner.json` contains PID, started-at, run ID and host. A live owner refuses a second invocation before configuration, DB access or login. A dead PID is automatically cleared with `clearing stale lease from <runId>`. Missing/malformed ownership records fail closed. There is no heartbeat or age-based expiry. The runner itself launches a second invocation to verify refusal on every acquired run.

Suites: `runner`, `isolation`, `personas`, `fixtures` (parent-owned Node lifecycle contract), `opening` (G1-A Node contracts + browser journeys), `ordering` (G1-O Node contracts + ordering/receiving journeys). Fixtures: `warm-history`, `cold-empty`, `incomplete-pack`, `over-1000`, `two-shop-divergent`. Unknown flags/names return 2. `--repeat N` repeats every test without overwriting earlier evidence. All four Chromium projects run serially: phone/tablet × en/es, fresh browser context for each test. Project locale is a tag; it does not change a persona's saved app preference. Persona login checks the actual seeded language.

`.env.sim` is the sole app configuration source and must satisfy F1. Next autoload env filenames are forbidden. Optional `SIM_PIN_MARCUS`, `SIM_PIN_ROSA`, `SIM_PIN_ANGEL`, `SIM_PIN_MAYA`, and `SIM_PIN_LUIS` come from that private file or the process environment; no credential is in a spec. The runner extracts the closed `RUNNER_PRIVATE_KEYS` controls and writes an ephemeral private config copy for the unchanged F1 loader and F3 oracle, then deletes it on cleanup. Never commit or print either file. Missing PIN controls fail the relevant login contract. The real UI is location → role → name → four-digit PIN; wrong-shop refusal means the persona cannot be selected in that shop (the PIN API has no location field).

F2 `cold-empty` now derives its reset plan from the authoritative private `schema-meta.json`: 141 tables, 372 FK constraints, primary keys and FK-column nullability. The classification is 56 CONFIG / 12 AUTH / 73 HISTORY, including `deep_clean_assignments` as HISTORY. The metadata and classification must agree exactly; the catalog no longer carries a competing handwritten PK/FK map or order. The supplied snapshot has 54 CONFIG files; the dropped `vendor_contacts` and `notification_recipients` remain empty.

Only the three CC-approved mutual-cycle edges may be staged, and each must be explicitly nullable in the metadata: `catering_companies.claimed_by_customer_id`, `email_receipts.linked_delivery_id`, and `checklist_template_items.equipment_id`. Before deletion these columns are PATCHed to null, with exact affected-row counts and readback. The CONFIG load stages only `checklist_template_items.equipment_id`, then restores each non-null value by PK with an exact one-row PATCH. The final CONFIG comparison includes every deferred value.

Self-FKs are never staged. `checklist_templates.supersedes_template_id` (10 rows), `checklist_template_items.references_template_item_id` (499 rows), and `sku_pack_levels.contains_level_id` (149 rows) are ordered leaf-first before batching: every pointer resolves to an earlier row, and every snapshot value is preserved. Missing pointers, cycles and self-loops refuse before mutation with the unresolved row's PK. The pack-level XOR CHECK therefore holds throughout insertion. The other self-referencing tables are emptied in one DELETE statement each; their HISTORY/AUTH rows are not snapshot-loaded.

The only reset writer is `reset.ts`, called by the parent lease owner with the app stopped (both loopback addresses on port 3100 checked). It asserts the exact sim target and confirmation, validates snapshot hashes/counts/classification and all recipe prerequisites before mutation. After those gates, it empties all classified tables including CONFIG (plain INSERT requires empty CONFIG too), checks each DELETE exact count and emptiness, loads the preplanned CONFIG rows with plain POST in batches of 500, restores the deferred equipment values, imports F3 `seed-staff.main()`, verifies 9 users / 10 memberships, writes one recipe, and reads every table back with 500-row stable-PK pagination and exact totals. There is no upsert, direct DB URL or production access.

The runner requires `LRA_SCHEMA_DIGEST`, a SHA-256 digest supplied by CC from reviewed schema definitions, FKs, 0196 index predicates, grants and RLS. A migration filename digest is not a substitute. The script records this supplied digest; it does not claim to independently inspect database schema through PostgREST. Set reset controls in the invoking environment, not in the closed F1 `.env.sim` file:

```powershell
$env:LRA_RESET_CONFIRM = 'jepgzucrvklhqpthowsc'
# CC supplies the reviewed 64-character schema digest:
$env:LRA_SCHEMA_DIGEST = '<reviewed-schema-sha256>'
$env:LRA_SNAPSHOT_DIR = 'scripts/sim/launch-readiness/.private/snapshot'
node --import tsx scripts/sim/launch-readiness/run.ts --restore-only cold-empty
```

`--restore-only <fixture>` also accepts `--restore-only --fixture <fixture>`; it verifies, prints only the fingerprint, and releases the lease without launching the app. `--no-restore` is restricted to the runner suite and still refuses DIRTY. The fixture suite owns stop/restore/start itself, preserving one lease across both resets and normal-app dirtying. It is a Node contract because a Playwright worker cannot own the parent reset lifecycle. Its incomplete-pack UI and shipped last-received consumer assertions are explicitly blocked, not passed or skipped. The original F4 suites' Playwright `--repeat` repeats tests inside one restored scenario; it is not per-test reset evidence. G1-A instead restores between projects and repeats as described below.

Any reset failure creates `.private/DIRTY`; the marker is also written before the first staging PATCH so an interrupted process cannot leave an apparently clean sim. The next attempt starts with a full reset; no continuation/repair mode exists. Only complete verification removes DIRTY. Do not delete the marker to force a journey to boot.

Successful reset output: `.private/<runId>/receipt.json` holds fixture/version, snapshot-manifest hash, supplied schema digest, exact counts, semantic fingerprint, timestamps, roster digest, a separate actual-ID identity digest, and the derived orders/staged columns/leaf-first row counts. `.artifacts/<runId>/fixture.json` contains only fixture ID, counts and fingerprint. Credentials never enter either receipt. Canonical comparison sorts keys/tables/PKs and preserves exact decimal lexemes. F3-generated user IDs/actor references normalize to persona aliases; roster comparison uses its verified identity/membership contract and excludes credentials and generated roster timestamps. Operational timestamps are retained.

Fixture recipes:

| Fixture | Implemented planning content | Runtime status |
|---|---|---|
| `cold-empty` | CONFIG snapshot + 9 personas/10 memberships; exact zeros across HISTORY and remaining AUTH | Executable; CC must verify against the sim |
| `warm-history` | 21-day/prior-day/current-day scope contract; named Ham/HAM handles | Blocked: independent source/quantity/money manifest missing |
| `incomplete-pack` | Required honest unresolved/null oracle; no fabricated deficiency | Blocked: evidenced deficient chain + complete control missing |
| `over-1000` | Deterministic fragment of 1,205 headers +1,205 items; latest item ranks 1,205 by PK | Blocked: full headers/chain/two-member/warm/control prerequisites missing |
| `two-shop-divergent` | Two synthetic count-event scopes with the actual location UUIDs and distinct dates | Blocked: opposing primaries/par/on-hand/order quantities missing |

The non-cold fragments are planner tests, not complete fixtures. No expected fingerprint is copied from a mutable sim. Complete content is compared to the supplied snapshot and declared synthetic rows before fingerprinting. CC must complete/review the missing semantic manifests and execute the live contracts before accepting F2. Local tests validate the real schema and all snapshot hashes/counts and self-FK ordering without DB access. This private-data test is explicitly skipped in CI when the snapshot is absent; embedded graph, refusal and 1,002-row chain tests always run. The four synthetic recipes retain their planner-only blocked reasons, and the reset explicitly admits only cold-empty.

F5 production mode is the default and is required for release evidence. From the dedicated checkout, after provisioning the fixture/reset controls above:

```powershell
node --import tsx scripts/sim/launch-readiness/target.ts build
node --import tsx scripts/sim/launch-readiness/run.ts --suite runner --fixture cold-empty
# Development smoke only:
node --import tsx scripts/sim/launch-readiness/run.ts --suite runner --fixture cold-empty --dev
```

Stop on any nonzero exit. `target.ts start` refuses with `use run.ts` (exit 2): only the runner owns the restore/start lifecycle. Build acquires the same shared lease, validates `.env.sim` and rejects Next autoload filenames before spawning the local Next binary. It restores nothing and performs no fixture writes. Build uses `NODE_ENV=production`, `SIM_MODE=1`, `SIM_PHASE=build`; runtime uses the same F1 sim environment with `SIM_PHASE=runtime`. The existing `next.config.ts` selects `.next-sim-launch/`. Google Fonts hosts are a BUILD-TIME-ONLY allowlist exception; runtime denies them. No font localization is involved. The sandbox cannot run this network-dependent build; CC runs it outside the sandbox.

A successful build writes `.next-sim-launch/lra-build-receipt.json`, read back after writing:

- `candidateSha`, `dirty`: current Git HEAD and whether `git status --porcelain` is nonempty.
- `lockfileSha256`, `policyVersion`: dependency lock hash and F1 policy revision.
- `publicConfigDigest`: SHA-256 of sorted `NEXT_PUBLIC_*` keys paired with hashed values from the child env. No configuration values are stored; non-public keys do not affect this digest.
- `buildId`: `.next-sim-launch/BUILD_ID`, plus `builtAt`, `nodeVersion`, and installed `nextVersion`.

Start refuses missing/malformed receipts, changed SHA, dirty flag, lockfile, policy, public configuration, BUILD_ID, Node or Next version. `builtAt` must be a valid timestamp; it is historical metadata, not an expiry. A rebuild removes the old receipt before invoking Next, so a failed build cannot reuse it. Checkout identity is also checked across the build. **Rebuild after every source edit**, including edits while already dirty: the prescribed boolean dirty flag is not a content hash and cannot detect dirty-to-dirty changes. CC committing the candidate changes its SHA and requires a fresh build.

After restore, the runner refuses an occupied port, verifies the receipt, and starts `next start -p 3100 -H localhost`. It checks listener ancestry on Windows, requires the served HTML to contain a local `/_next/static/<buildId>/...` asset, rejects mixed build IDs, and requires that build's `_buildManifest.js` to return 200. Generic hashed chunk paths alone do not establish this identity: if the installed App Router emits no BUILD_ID asset path, the run fails closed and CC must adjudicate the identity contract before accepting release evidence. The manifest records the receipt's BUILD_ID and sets `identity.server` only after verification. The driver independently reads both locations and all nine personas before login. The `runner production identity` browser contract repeats the HTML check; it is skipped under `--dev`. Existing PIN login and secure cookie settings are unchanged.

`--dev` retains `dev -p 3100 -H localhost`, `NODE_ENV=development`, `SIM_PHASE=build`, and served dev-chunk byte equality against disk. It does not require a production receipt and cannot supply release evidence. The fixture suite also respects the selected production/development mode. The isolation suite's no-external projection is browser evidence, not complete server-network telemetry.

Published evidence lives under `.artifacts/<runId>/`:

- `manifest.json`: candidate SHA/dirty flag, dependency lock hash, policy/dev identity, fixture restore status, persona metadata, ET anchor/timestamps, per-test project/viewport/assertion IDs/attempt/status, denied counts and artifact hashes.
- `results.json`, `html/index.html`: Playwright reports after the first reporter strips raw errors, console strings, step arguments and all attachments. A run that never reaches the browser writes explicitly empty/blocked reports.
- `shots/`: named masked screenshots. Password/numeric fields, PIN keypad and `[data-sensitive]` are masked. Credential entry stops tracing and takes no screenshots.
- `network.json`, `console.json`: closed projections only. Network carries method, route template, status, timing and domain category; console carries event type only. Queries, arbitrary path segments, headers, bodies and raw messages are never projected.

`.private/<runId>/pw/` holds local failure traces. They are **never exported or attached to public reports or manifests**. Private projections/config are also under `.private/`. Delete private traces with the run; never attach them to a PR or upload them. `claims.json` contains pending opening claims pinned to guide commit `5241016`; this packet does not promote claims to proven. A missing or zero-byte required artifact makes finalization fail. Unexpected denied destinations fail a test; the deliberate external-navigation contract expects exactly one refusal.

G1-A runs only with `cold-empty`. CC supplies the existing reset/snapshot/schema controls above, adds `SIM_PIN_MAYA` and `SIM_PIN_LUIS` to `.env.sim`, and ensures `SIM_PIN_ROSA` and `SIM_PIN_ANGEL` match the restored personas. Marcus is not used by this suite. No warm closing baseline is fabricated.

```powershell
node --import tsx scripts/sim/launch-readiness/target.ts build
node --import tsx scripts/sim/launch-readiness/run.ts --suite opening --fixture cold-empty
# Full fresh-fixture repeat, including all four viewports:
node --import tsx scripts/sim/launch-readiness/run.ts --suite opening --fixture cold-empty --repeat 2
```

The parent runs `contracts/opening.spec.ts` without a browser, restores again, then runs `journeys/opening.spec.ts` in each of `phone-en`, `phone-es`, `tablet-en`, and `tablet-es`, stopping the app and restoring before each project. Every project walks both shops: Maya (en) → Rosa (es) at EM, Luis (es) → Angel (en) at MEP. KH handoff uses a fresh, guarded browser context and the same `login()` helper. No instance is shared across viewport/repeat runs. Phase 2 finalization means `phase2_complete`, not Phase 3 confirmation.

Node results live in `opening-contracts.json`; each browser invocation has its own `opening/<project>-<attempt>/results.json` and HTML report. Top-level reports index those slices; the manifest collects every test, assertion ID, failure ID and screenshot. The injected prep abort is consumed once and counted as `denied.injected` with one expected denial. It is separate from the real-session 403/422 assertions, which are app responses rather than refused destinations. Screenshots include start/decision/outcome plus handoff readback, injected failure and successful retry. All oracle reads are SELECT-only and paginated; every mutation uses the normal browser or `Session.call` route.

A red finding is an intended deliverable, never an expected-pass annotation: `opening.phase1.persist-before-submit` reproduces **LRA-121 / STAFF-5** when the fresh KH loses the employee's ticks, temperature or comment. A soft assertion leaves the whole test failed while letting the KH redo the work and exercise later phases. `opening.phase2.concurrent-save` fails on raw 500s even if live-head cardinality survives (0196 / LRA-126 regression guard). `opening.report.truth` fails if saved Phase 2 quantities are absent from the report; the current loader/view expose Phase 1 only, so this is a source-identified candidate finding awaiting CC's runtime evidence. KH note redaction below L5 remains the current contract; the comment is checked in persisted completions. This cold suite cannot verify the historical 342-row production restoration (LRA-127). No runtime reproduction is claimed by local unit/type checks.

G1-O `ordering` also requires `cold-empty`. It runs `contracts/ordering-receiving.spec.ts` in Node first, then restores separately for every `journeys/ordering-receiving.spec.ts` project and repeat under the same parent lease. Both shops use their actual persona language: Rosa (KH L4, es) at EM and Angel (KH L4, en) at MEP, with Maya/Luis employee denials. The journey opens `/ordering`, expands Boar's Head, applies suggested/full-par/zero decisions, generates and reviews the draft, then records manual placement. It receives that order at `/operations/receiving` with short, damaged, missing and complete lines, then reloads and signs in again for history/credit readback. Manual placement must disclose that it records an order; it does not transmit it to the vendor. Expected money comes from frozen snapshot prices rather than displayed totals.

The named cold ledger uses Provolone/Genoa/Turkey suggestions, Capicola full-par and Pepperoni explicit zero. Provolone arrives one unit short; Genoa arrives one unit short and is explicitly flagged damaged; Turkey never arrives; Capicola is the complete control. The invoice charges the ordered quantities. Each credit is the independently computed missing quantity times its frozen cent price, including the damaged line's positive delta under the current rule. The form does not prefill prices: the journey enters the frozen prices explicitly. Missing Turkey creates a line-less short credit, never a zero-quantity receipt row. Receipt completion uses the sanctioned `Photo later` checkbox (`ReceivingForm.tsx:438`); no additional PIN/step-up is required.

Source-identified findings remain red, pending runtime reproduction: `ordering.draft.matches-walk` checks the cutoff draft against the unsaved observations, then closes it and performs Review order → Record walk. The current sibling islands ignore those observations at Generate draft and create a second PO at Record walk; a soft exact-one-PO assertion records this before the journey places the walk's exact PO. `ordering.invoice.serial` requires `duplicate_delivery`, while the current linked-PO state guard may return `po_already_received` first. `ordering.receipt.timestamp` compares the real private loader's result against the delivery header timestamp; the loader currently returns the receipt-line timestamp. The contract executes the unchanged loader source selected by TypeScript AST, with its real paginator and the lease-guarded SELECT-only driver, rather than copying its query into a test oracle. No >1000-row or page-two failure claim is inferred from this cold probe.

CC runs the initial phone slice outside the sandbox before the full matrix, with the same private PIN and reset controls used above:

```powershell
$env:LRA_PROJECTS = 'phone-en'
node ~/.claude/hooks/lra-suite.mjs C:/Users/conta/co-ops-astra ordering cold-empty
# After reviewing the first slice, run all four projects:
Remove-Item Env:LRA_PROJECTS
node ~/.claude/hooks/lra-suite.mjs C:/Users/conta/co-ops-astra ordering cold-empty
# Direct runner equivalent after a matching production build:
node --import tsx scripts/sim/launch-readiness/run.ts --suite ordering --fixture cold-empty
```

Ordering Node evidence is `ordering-contracts.json`; browser reports are `ordering/<project>-<attempt>/results.json` and `html/index.html`, indexed by the top-level reports. Each slice has start/decision/outcome screenshots and closed assertion IDs. Raw 500 responses are findings. Node contracts cover duplicate-draft concurrency, serial/racing invoice retries, the KH 4/SL 5 reconcile boundary, cross-shop refusal, independent credit arithmetic and last-received timestamp readback. The `warm-history`, `incomplete-pack`, `over-1000` and `two-shop-divergent` cases remain blocked planner-only fixtures; cold-empty evidence cannot prove them. Claims remain pending until CC runs and reviews the actual assertion evidence.

The exact SL 5 boundary uses Tommy at EM with `SIM_PIN_TOMMY` supplied only in the runner's parent process environment. Never add it to `.env.sim`: that file's closed schema excludes it. The runner validates its four digits, keeps it for the in-process Node contracts and removes it from app, browser and contender child environments. Build before supplying this control; standalone `target.ts build` does not scrub this additional control. A wrapper that builds must withhold it during that build and supply it only to `run.ts`. Marcus at MEP exercises the existing GM control separately. Missing Tommy credentials leave the exact SL boundary unproved.

Exit codes: 0 contracts pass; 1 failure; 2 usage or blocked prerequisite. Signals and errors enter cleanup. Windows uses native `taskkill.exe /PID <pid> /T /F` (the argument-array equivalent of Git Bash `taskkill //T`); POSIX uses the detached process group. The runner checks the port is free after child cleanup. Verify independently after a local smoke:

```powershell
netstat -ano | Select-String ':3100\s'
npm.cmd test
npx.cmd tsc --noEmit
```

No listener should remain. CC must boot every harness deliverable before merge; passing unit tests alone do not verify browser contracts. First-pass environment notes (historical): npm registry access was denied. The exact dependency pin and three resolved lock entries were prepared from [official v1.63.0 metadata](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-test/package.json), which requires Node >=20. Integrity hashes were omitted rather than invented; npm must validate/hydrate the lock. Offline lock generation was also blocked by an uncached existing Tailwind package. Chromium was not installed. The attempted CLI smoke hit a `tsx` Windows `uv_os_get_passwd` failure before runner code loaded; this is an execution blocker, not a passed harness run.

Derived order reference (CC metadata, 2026-09-09). Runtime recomputes these from the selected snapshot directory; this documentation is not an execution input. CONFIG is also emptied so plain INSERT and repeated restores start from the same state.

Delete: 141 tables, in execution order.

```text
vendor_credits -> vendor_delivery_items -> production_inputs -> maintenance_notes
catering_quote_item_options -> vendor_deliveries -> productions -> opening_closer_count_snapshots
maintenance_equipment -> customer_feedback -> checklist_incomplete_reasons -> checklist_completions
catering_quote_items -> catering_prep_demand -> catering_payments -> catering_order_items
vendor_price_history -> toast_menu_map -> toast_daily_depletion -> toast_catering_orders
sms_queue -> sms_messages -> sku_pack_levels -> sku_inferred_baselines
sku_count_lines -> recipe_inputs -> product_primaries -> prep_list_resolutions
po_transmissions -> po_lines -> par_suggestion_actions -> par_pass_lines
par_levels -> par_auto_moves -> opening_setup_verifications -> opening_section_verifications
location_sku_settings -> item_components -> ezcater_events -> email_receipts
checklist_template_items -> checklist_submissions -> catering_quotes -> catering_pipeline_events
catering_package_slot_options -> catering_orders -> vendor_rhythm_skips -> vendor_orders
vendor_ordering_details -> vendor_order_types -> vendor_items -> vendor_delivery_rhythm
vendor_cutoffs -> vendor_contacts -> vendor_categories -> tip_pool_distributions
shift_overlay_corrections -> recipe_outputs -> purchase_orders -> pm_employee_evals
notification_recipients -> lto_event_items -> item_sizes -> item_questions
item_par_levels -> checklist_instances -> catering_portal_sessions -> catering_pipeline
catering_package_items -> catering_food_facts -> catering_allergens -> announcement_acknowledgements
written_reports -> weekly_rollups -> vendors -> user_locations
training_reports -> training_progress -> toast_sales_events -> toast_ingest_exclusions
toast_daily_sales_signals -> toast_daily_data -> tip_pools -> sku_count_events
shifts_daily_data -> shift_overlays -> section_questions -> report_assignments
recipe_steps -> recipe_ingredients -> pm_reports -> photos
par_pass_events -> opening_setup_items -> notifications -> maintenance_tickets
lto_performance -> lto_events -> items -> deep_clean_assignments
checklist_templates -> catering_rate_rules -> catering_pricing_rules -> catering_packages
catering_fulfillment_nodes -> catering_faq -> catering_delivery_zones -> catering_customers
catering_company_domains -> catering_capacity_policy -> catering_blackout_dates -> cash_reports
announcements -> user_notification_prefs -> units -> training_modules
sku_pack_formats -> sessions -> report_views -> report_photos
recipes -> products -> prep_sections -> position_responsibilities
password_resets -> order_types -> measure_units -> locations
email_verifications -> catering_companies -> catering_allergen_types -> categories
audit_log -> ai_reports -> users -> toast_menu_cache
positions -> menu_items -> deep_clean_tasks -> catering_portal_tokens
catering_portal_rate_limits
```

CONFIG load: 56 tables, in execution order.

```text
categories -> catering_allergen_types -> deep_clean_tasks -> locations
measure_units -> menu_items -> notification_recipients -> order_types
positions -> prep_sections -> products -> recipes
sku_pack_formats -> toast_menu_cache -> units -> catering_blackout_dates
catering_capacity_policy -> catering_delivery_zones -> catering_faq -> catering_fulfillment_nodes
catering_packages -> catering_pricing_rules -> catering_rate_rules -> checklist_templates
items -> position_responsibilities -> recipe_ingredients -> recipe_steps
section_questions -> toast_ingest_exclusions -> training_modules -> vendors
catering_food_facts -> catering_package_items -> item_par_levels -> item_questions
item_sizes -> recipe_outputs -> vendor_categories -> vendor_contacts
vendor_cutoffs -> vendor_delivery_rhythm -> vendor_items -> vendor_order_types
vendor_ordering_details -> catering_package_slot_options -> checklist_template_items -> item_components
location_sku_settings -> product_primaries -> recipe_inputs -> sku_inferred_baselines
sku_pack_levels -> toast_menu_map -> vendor_price_history -> maintenance_equipment
```
