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

F2 is implemented as a guarded PostgREST reset path, but **the provisioned inventory currently blocks every restore before any database request**. This is not a live-verified restore. `fixtures/manifest.json` records the blockers:

- CONFIG-INVENTORY expands to 140 tables (56 CONFIG, 12 AUTH, 72 HISTORY), not 141. `deep_clean_assignments` appears in 0058 but has no inventory classification. No placeholder table pads the count.
- Original table definitions are missing from the local migration history; 49 primary keys and complete FK provenance remain unverified. The supplied snapshot manifest shape contains counts/hashes but no PKs. Optional `primaryKey` arrays are supported; missing keys fail closed.
- Equipment/template-item and delivery/email-receipt relationships contain mutual FKs. Plain ordered DELETE/POST cannot restore populated cycles. The supplied orders are explicitly incomplete and cannot execute. The reset still needs nullable-link staging and verification for those cycles. This implementation currently refuses them.
- Pack-level self-references need row dependency ordering across 500-row batches. The current table-order implementation cannot claim this works.
- Warm-history measurements, incomplete-chain evidence, the second actual product member, local order-quantity oracles and a named prep dirtying input are not provisioned. They remain blocked rather than invented.

The only reset writer is `reset.ts`, called by the parent lease owner with the app stopped (both loopback addresses on port 3100 checked). It asserts the exact sim target and confirmation, validates snapshot hashes/counts/classification and all recipe prerequisites before mutation. After those gates, it empties all classified tables including CONFIG (plain INSERT requires empty CONFIG too), checks each DELETE exact count and emptiness, loads CONFIG with plain POST in batches of 500, imports F3 `seed-staff.main()`, verifies 9 users / 10 memberships, writes one recipe, and reads every table back with 500-row stable-PK pagination and exact totals. There is no upsert, direct DB URL or production access.

The runner requires `LRA_SCHEMA_DIGEST`, a SHA-256 digest supplied by CC from reviewed schema definitions, FKs, 0196 index predicates, grants and RLS. A migration filename digest is not a substitute. The script records this supplied digest; it does not claim to independently inspect database schema through PostgREST. Set reset controls in the invoking environment, not in the closed F1 `.env.sim` file:

```powershell
$env:LRA_RESET_CONFIRM = 'jepgzucrvklhqpthowsc'
# CC supplies the reviewed 64-character schema digest:
$env:LRA_SCHEMA_DIGEST = '<reviewed-schema-sha256>'
$env:LRA_SNAPSHOT_DIR = 'C:/Users/conta/co-ops-assets/lra-snapshot/sanitized-2026-09-09'
node --import tsx scripts/sim/launch-readiness/run.ts --restore-only cold-empty
node --import tsx scripts/sim/launch-readiness/run.ts --suite fixtures
```

`--restore-only <fixture>` also accepts `--restore-only --fixture <fixture>`; it verifies, prints only the fingerprint, and releases the lease without launching the app. `--no-restore` is restricted to the runner suite and still refuses DIRTY. The fixture suite owns stop/restore/start itself, preserving one lease across both resets and normal-app dirtying. It is a Node contract because the existing Playwright config allows only the three F4 suites and a Playwright worker cannot own the parent reset lifecycle. Its incomplete-pack UI and shipped last-received consumer assertions are explicitly blocked, not passed or skipped. Existing Playwright `--repeat` still repeats tests inside one restored scenario; it is not per-test reset evidence.

Any reset failure creates `.private/DIRTY`; the marker is also written before the first DELETE so an interrupted process cannot leave an apparently clean sim. The next attempt starts with a full reset; no continuation/repair mode exists. Only complete verification removes DIRTY. Do not delete the marker to force a journey to boot.

Successful reset output: `.private/<runId>/receipt.json` holds fixture/version, snapshot-manifest hash, supplied schema digest, exact counts, semantic fingerprint, timestamps, roster digest and a separate actual-ID identity digest. `.artifacts/<runId>/fixture.json` contains only fixture ID, counts and fingerprint. Credentials never enter either receipt. Canonical comparison sorts keys/tables/PKs and preserves exact decimal lexemes. F3-generated user IDs/actor references normalize to persona aliases; roster comparison uses its verified identity/membership contract and excludes credentials and generated roster timestamps. Operational timestamps are retained.

Fixture recipes:

| Fixture | Implemented planning content | Runtime status |
|---|---|---|
| `cold-empty` | CONFIG snapshot + 9 personas/10 memberships; exact zeros across HISTORY and remaining AUTH | Blocked by global inventory/schema/FK prerequisites |
| `warm-history` | 21-day/prior-day/current-day scope contract; named Ham/HAM handles | Blocked: independent source/quantity/money manifest missing |
| `incomplete-pack` | Required honest unresolved/null oracle; no fabricated deficiency | Blocked: evidenced deficient chain + complete control missing |
| `over-1000` | Deterministic fragment of 1,205 headers +1,205 items; latest item ranks 1,205 by PK | Blocked: full headers/chain/two-member/warm/control prerequisites missing |
| `two-shop-divergent` | Two synthetic count-event scopes with the actual location UUIDs and distinct dates | Blocked: opposing primaries/par/on-hand/order quantities missing |

The non-cold fragments are planner tests, not complete fixtures. No expected fingerprint is copied from a mutable sim. Complete content is compared to the supplied snapshot and declared synthetic rows before fingerprinting. CC must complete/review the missing semantic manifests and execute the live contracts before accepting F2. The tests deliberately verify the current 140-table inventory is refused; a separate synthetic 141-table input exercises the validator without asserting a fictitious operational table exists.

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

No listener should remain. CC must install the dependency/browser and boot every harness deliverable before merge; passing unit tests alone do not verify browser contracts. On the authoring sandbox npm registry access was denied. The exact dependency pin and three resolved lock entries were prepared from [official v1.63.0 metadata](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-test/package.json), which requires Node >=20. Integrity hashes were omitted rather than invented; npm must validate/hydrate the lock. Offline lock generation was also blocked by an uncached existing Tailwind package. Chromium was not installed. The attempted CLI smoke hit a `tsx` Windows `uv_os_get_passwd` failure before runner code loaded; this is an execution blocker, not a passed harness run.
