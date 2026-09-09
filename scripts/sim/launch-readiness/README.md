# Launch-readiness runner (F4 / F2)

Run from the dedicated checkout with Node 22. CC commits and reviews the working tree. Never point this harness at production.

```powershell
npm.cmd install --save-dev --save-exact @playwright/test@1.63.0
npx.cmd playwright install chromium
$env:LRA_LEASE_DIR = Join-Path (Get-Location) 'scripts/sim/launch-readiness/.private/lease-test'
node --test scripts/sim/launch-readiness/contracts/lease.test.mjs
node --import tsx scripts/sim/launch-readiness/run.ts --suite runner --fixture cold-empty --dev --no-restore
```

The lease override above is for sandbox tests only. Ordinary runs must unset it so all clones share `C:/Users/conta/co-ops-assets/lra-sim-lease/`. Do not run two clones with different overrides against the shared sim. Acquisition is an atomic mkdir; `owner.json` contains PID, started-at, run ID and host. A live owner refuses a second invocation before configuration, DB access or login. A dead PID is automatically cleared with `clearing stale lease from <runId>`. Missing/malformed ownership records fail closed. There is no heartbeat or age-based expiry. The runner itself launches a second invocation to verify refusal on every acquired run.

Suites: `runner`, `isolation`, `personas`, `fixtures` (parent-owned Node lifecycle contract). Fixtures: `warm-history`, `cold-empty`, `incomplete-pack`, `over-1000`, `two-shop-divergent`. Unknown flags/names return 2. `--repeat N` repeats every test without overwriting earlier evidence. All four Chromium projects run serially: phone/tablet × en/es, fresh browser context for each test. Project locale is a tag; it does not change a persona's saved app preference. Persona login checks the actual seeded language.

`.env.sim` is the sole app configuration source and must satisfy F1. Next autoload env filenames are forbidden. Optional `SIM_PIN_MARCUS`, `SIM_PIN_ROSA`, and `SIM_PIN_ANGEL` come from that private file or the process environment; no credential is in a spec. The runner extracts only these closed controls and writes an ephemeral private config copy for the unchanged F1 loader and F3 oracle, then deletes it on cleanup. Never commit or print either file. Missing PIN controls fail the relevant login contract. The real UI is location → role → name → four-digit PIN; wrong-shop refusal means the persona cannot be selected in that shop (the PIN API has no location field).

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

`--restore-only <fixture>` also accepts `--restore-only --fixture <fixture>`; it verifies, prints only the fingerprint, and releases the lease without launching the app. `--no-restore` is restricted to the runner suite and still refuses DIRTY. The fixture suite owns stop/restore/start itself, preserving one lease across both resets and normal-app dirtying. It is a Node contract because the existing Playwright config allows only the three F4 suites and a Playwright worker cannot own the parent reset lifecycle. Its incomplete-pack UI and shipped last-received consumer assertions are explicitly blocked, not passed or skipped. Existing Playwright `--repeat` still repeats tests inside one restored scenario; it is not per-test reset evidence.

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

F5 production build/start is not implemented. Both the temporary default and `--dev` launch the local Next binary with `dev -p 3100 -H localhost`, F1 child env, `NODE_ENV=development`, and `SIM_PHASE=build`. The runner refuses an occupied port, checks fresh locally generated dev asset bytes against the served asset, and on Windows verifies the listener PID descends from its child. It initializes the driver and compares real `locations` readback with both `SIM_LOCATIONS`; the driver also validates all nine personas. This is dev identity only, not a production BUILD_ID receipt. Next's F1 instrumentation guards server fetch/HTTP; the temporary dev phase retains the reviewed font build exception. The isolation suite's no-external projection is browser evidence, not a claim of complete server-network telemetry. No existing GET API route with an external fetch was found in the current route scan.

Published evidence lives under `.artifacts/<runId>/`:

- `manifest.json`: candidate SHA/dirty flag, dependency lock hash, policy/dev identity, fixture restore status, persona metadata, ET anchor/timestamps, per-test project/viewport/assertion IDs/attempt/status, denied counts and artifact hashes.
- `results.json`, `html/index.html`: Playwright reports after the first reporter strips raw errors, console strings, step arguments and all attachments. A run that never reaches the browser writes explicitly empty/blocked reports.
- `shots/`: named masked screenshots. Password/numeric fields, PIN keypad and `[data-sensitive]` are masked. Credential entry stops tracing and takes no screenshots.
- `network.json`, `console.json`: closed projections only. Network carries method, route template, status, timing and domain category; console carries event type only. Queries, arbitrary path segments, headers, bodies and raw messages are never projected.

`.private/<runId>/pw/` holds local failure traces. They are **never exported or attached to public reports or manifests**. Private projections/config are also under `.private/`. Delete private traces with the run; never attach them to a PR or upload them. `claims.json` deliberately starts empty. A missing or zero-byte required artifact makes finalization fail. Unexpected denied destinations fail a test; the deliberate external-navigation contract expects exactly one refusal.

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
