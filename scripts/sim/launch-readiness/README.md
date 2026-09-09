# Launch-readiness runner (F4)

Run from the dedicated checkout with Node 22. CC commits and reviews the working tree. Never point this harness at production.

```powershell
npm.cmd install --save-dev --save-exact @playwright/test@1.63.0
npx.cmd playwright install chromium
$env:LRA_LEASE_DIR = Join-Path (Get-Location) 'scripts/sim/launch-readiness/.private/lease-test'
node --test scripts/sim/launch-readiness/contracts/lease.test.mjs
node --import tsx scripts/sim/launch-readiness/run.ts --suite runner --fixture cold-empty --dev --no-restore
```

The lease override above is for sandbox tests only. Ordinary runs must unset it so all clones share `C:/Users/conta/co-ops-assets/lra-sim-lease/`. Do not run two clones with different overrides against the shared sim. Acquisition is an atomic mkdir; `owner.json` contains PID, started-at, run ID and host. A live owner refuses a second invocation before configuration, DB access or login. A dead PID is automatically cleared with `clearing stale lease from <runId>`. Missing/malformed ownership records fail closed. There is no heartbeat or age-based expiry. The runner itself launches a second invocation to verify refusal on every acquired run.

Suites: `runner`, `isolation`, `personas`. Fixtures: `warm-history`, `cold-empty`, `incomplete-pack`, `over-1000`, `two-shop-divergent`. Unknown flags/names return 2. `--repeat N` repeats every test without overwriting earlier evidence. All four Chromium projects run serially: phone/tablet × en/es, fresh browser context for each test. Project locale is a tag; it does not change a persona's saved app preference. Persona login checks the actual seeded language.

`.env.sim` is the sole app configuration source and must satisfy F1. Next autoload env filenames are forbidden. Optional `SIM_PIN_MARCUS`, `SIM_PIN_ROSA`, and `SIM_PIN_ANGEL` come from that private file or the process environment; no credential is in a spec. The runner extracts only these closed controls and writes an ephemeral private config copy for the unchanged F1 loader and F3 oracle, then deletes it on cleanup. Never commit or print either file. Missing PIN controls fail the relevant login contract. The real UI is location → role → name → four-digit PIN; wrong-shop refusal means the persona cannot be selected in that shop (the PIN API has no location field).

F2 restore is explicitly stubbed: `restoreFixture()` throws `F2 required` unless `--no-restore` is supplied. The fixture ID is recorded, **not a claim that the mutable sim equals that fixture**. No fixtures are written. Repetitions do not restore yet and are not Gate 1 repeatability evidence.

F5 production build/start is not implemented. Both the temporary default and `--dev` launch the local Next binary with `dev -p 3100 -H localhost`, F1 child env, `NODE_ENV=development`, and `SIM_PHASE=build`. The runner refuses an occupied port, checks fresh locally generated dev asset bytes against the served asset, and on Windows verifies the listener PID descends from its child. It initializes the driver and compares real `locations` readback with both `SIM_LOCATIONS`; the driver also validates all nine personas. This is dev identity only, not a production BUILD_ID receipt. Next's F1 instrumentation guards server fetch/HTTP; the temporary dev phase retains the reviewed font build exception. The isolation suite's no-external projection is browser evidence, not a claim of complete server-network telemetry. No existing GET API route with an external fetch was found in the current route scan.

Published evidence lives under `.artifacts/<runId>/`:

- `manifest.json`: candidate SHA/dirty flag, dependency lock hash, policy/dev identity, fixture stub status, persona metadata, ET anchor/timestamps, per-test project/viewport/assertion IDs/attempt/status, denied counts and artifact hashes.
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
