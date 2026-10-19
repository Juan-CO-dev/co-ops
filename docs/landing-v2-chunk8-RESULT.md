# Landing v2 chunk 8 — production indexing and shop structured data

2026-10-18. UNCOMMITTED on `feat/landing-v2`, base/HEAD `0ab3fe7066ae615ee8a750964428bbb422b8779e`, worktree `C:/Users/conta/co-ops-landing`. No commit, push, merge, deployment, persistent environment/domain change or DB write.

## Implementation and boundary

Read chunk 8, the actual host/config/proxy/page/layout/store projection, tenant facts, affected tests, browser fixtures and local Next 16 metadata-route guides before implementation. Plan: test the deployment/host policy and explicit schema projection, wire a stripped proxy-derived hint into landing metadata, then validate staff isolation and browser/performance behavior. Root metadata has no inherited robots directive and requires no change.

- `lib/landing/indexing-shared.ts`: production deployment identity AND approved Host authority matching `SITE_ORIGIN`, including port. Forwarded-host disagreement fails closed; NODE_ENV and request hints grant nothing.
- `lib/landing/config.ts`, `proxy.ts`, `app/eat/layout.tsx`: server deployment identity, stripped/overwritten internal hint, query-free root/privacy canonical, index/follow on the canonical production host; noindex/nofollow elsewhere on landing. Existing proxy robots/sitemap own the endpoints. Robots allow production and sitemap contains exactly `/` and `/privacy`; previews disallow and get an empty sitemap.
- `lib/landing/structured-data-shared.ts`, `components/landing/ShopStructuredData.tsx`, `app/eat/page.tsx`: server-only rendering of two Restaurant nodes from the same verified public shop projection used visibly. Explicit address/geo/phone/hours/menu fields, existing approved hero image, no ratings/prices, `<` escaped as `\u003c`. Optional DB membership continues to narrow visible shops and schema together; ordinary fixtures and outage fallback both render the two configured shops.
- `scripts/landing/e2e-server.mjs`: scrub inherited VERCEL_ENV; active instance explicitly production, matching-origin unavailable instance explicitly preview, dormant/nearby fixtures explicitly preview. No fifth server.
- `docs/landing-release-packet.md`: production indexing deliberately retains private/no-store HTML and robots/sitemap for host isolation, hence **no CDN HTML caching despite LCP pressure**. Hashed media/framework caching remains unchanged.

No new client JavaScript, third-party request, visible tag or privacy copy. Schema image is a reference to existing approved media, not a new download directive or preload.

## Changed/added assertion ledger

| File | Assertion change | Equal-or-stronger rationale |
|---|---|---|
| `tests/landing/indexing.test.ts` (new) | Production/preview/missing/malformed identity and origin; alias/staff/unlisted/port/forwarded disagreement; forged hint overwrite; alternating metadata bodies/headers | Fail-closed indexing requires both independent conditions; both root and privacy are covered. |
| `tests/landing/structured-data.test.ts` (new) | Exact two-node public projection, published phones/display phones, seven days, addresses/geo/menu, XSS termination and extra-field exclusion | Exact deep equality rejects invented fields; JSON roundtrip proves escaping preserves values. |
| `tests/landing/metadata.test.ts` | Canonical becomes query-free in both languages | Contract changes intentionally; retains title/description/OG/theme/noindex fallback checks. |
| `tests/landing/host-matrix.test.ts` | Adds deployment indexing distinction across approved/alias/staff/unlisted hosts | Existing host/route matrix retained unchanged. |
| `tests/landing/staff-routing.test.ts` | Registers new pure dependency in mutation compiler; adds complete response-header/body comparison with landing enabled | Existing mutation sentinels and routing fingerprint remain; complete headers strengthen previous selected-header proof. |
| `tests/landing/cache-inventory.test.ts` | Robots/sitemap private/no-store instead of public max-age=300 | Required host-isolation policy; brand, immutable media, framework and API caching checks retained. |
| `tests/e2e/landing/indexing.spec.ts` (new) | Raw headers + SSR canonical/robots in en/es root/privacy, same-origin preview denial, visible/schema facts/phones, alternating host bodies/cache | Tests the deployed framework path, not only pure helpers. |
| `tests/e2e/landing/host-isolation.spec.ts` | Forged indexing/path hints on staff HTML/robots/sitemap | Staff headers/status/robots behavior unchanged, no schema leakage. |
| `tests/e2e/landing/cache.spec.ts` | Adds robots/sitemap to private/no-store inventory | Retains hashed asset tests. |
| `tests/e2e/landing/hero.spec.ts` | Query-free canonical in en/es | Necessary adjacent assertion update outside chunk's named list; old query canonical conflicts with the new explicit contract. All other hero checks retained. |
| `tests/e2e/landing/review-regressions.spec.ts` | Private metadata caching, public brand caching retained | Necessary adjacent assertion update outside chunk's named list; no blanket relaxation. |

Red-first evidence: the two new unit suites ran before implementation, exit 1 because the two new modules did not exist. After implementation, full landing/security suite passed. No test deleted or skipped by this change.

## Staff byte-identity proof

Compared HEAD with the working tree, LF-normalized: the entire staff branch of `proxy.ts` (from the `/eat` refusal through matcher export) is identical, SHA256 `0470ee2452f59d1936c933667d5cf7e1b6a2d55795f5b04c3922ce173047ea63`. `app/layout.tsx`, `next.config.ts`, `lib/security-headers.ts`, and `app/eat/privacy/page.tsx` are unchanged. Tests compare the original routing fixture's status, every response header and body across staff root/privacy/robots/sitemap/admin/order/API/static routes with/without a session, while production landing is enabled. Existing empty-allowlist and mutation-sentinel tests remain.

Runtime discrepancy, explicitly preserved: the brief calls staff HTML no-store, but this baseline's public static staff **login** root emits `Cache-Control: s-maxage=31536000` in the local production build. The original staff route, root page/layout and Next config are unchanged. The added test now pins that existing value and compares clean/forged-hint responses, rather than introducing a global staff cache change. Landing root/privacy HTML remains private/no-store. Authenticated staff page caching was not independently exercised with a live staff session; no production credentials or data were accessed.

Next's metadata serializer removes the root trailing slash: raw canonical is `https://localhost:44170`, equivalent to `/`; `/privacy` is unchanged. Unit metadata returns the clean URL with `/`, and browser assertions pin the actual serialized output. Query strings remain forbidden in both languages.

`package.json` had a pre-existing status-only modification with no content diff at intake; it was not edited. `app/eat/layout.tsx` also had a status-only entry at intake; its actual content changes are now limited to indexing/canonical policy.

## Verification

- `npm.cmd test -- tests/landing tests/security-headers.test.ts --maxWorkers=2`: PASS, 55 files / 409 tests, exit 0.
- `npm.cmd run typecheck`: PASS, exit 0.
- `npm.cmd run assets:check`: PASS, 45 assets, exit 0.
- `npm.cmd run build`: PASS, exit 0.
- Changed-file ESLint across all 19 TS/TSX/MJS source/test files: PASS, exit 0; one existing `@next/next/no-img-element` advisory on the page's wordmark. Used existing `--config tmp/roundf-eslint.config.mjs` wrapper to register jsx-a11y globally, with no disabled rules or repo lint config changes.
- `LANDING_E2E_USE_BUILD=1 node node_modules/@playwright/test/cli.js test --workers=2`: completed full suite, exit 1, **485 passed / 13 existing skips / 7 failed**, 17.4 minutes. Failures were new/updated test expectations: root canonical trailing slash (hero in three projects and indexing in two), plus an incorrect new assumption that the pre-existing staff login HTML is no-store (two projects). No application code changed afterward.
- Corrected only those assertions, then `LANDING_E2E_USE_BUILD=1 LANDING_PERF_CONSENT=unset node node_modules/@playwright/test/cli.js test --last-failed --workers=2`: **7 passed**, exit 0, 31.8 seconds. The existing perf harness flag skips only the unnecessary nearby fixture build for these seven cases; active production and matching-origin preview servers remain real. All 492 non-skipped browser cases have passing evidence against the same application build; the complete suite was not rerun after these test-only corrections. Logs: `tmp/chunk8-full-e2e.log`, `tmp/chunk8-e2e-corrections.log`.
- Re-ran changed-test ESLint and TypeScript after the assertion corrections: PASS, exit 0.
- `npm.cmd run perf:ci` exactly once: FAIL, exit 1. Applied TBT fails both consent states; applied median LCP, performance, accessibility and CLS pass. Simulated LCP warnings remain report-only. Applied throttling and all thresholds unchanged; CI remains the gate.

One heavy job at a time. Browser workers and Vitest maxWorkers are 2. Exact emitted JSON-LD follows below.

## Open gates

CC cross-family review and exact-revision CI remain external. No independent cross-family review is claimed in this local implementation turn. Public HTTPS/deployment identity verification and release approval remain CC/Juan-owned. Local performance does not establish a causal zero-impact claim without a paired baseline.

## Exact emitted JSON-LD

Captured from raw production-build HTTP HTML at `http://localhost:44170/?lang=en` and `?lang=es`, not reconstructed from config. Runtime canonical is the fixture `https://localhost:44170`; production will use the configured approved SITE_ORIGIN. Facts are language-invariant; both serialized payloads are identical. Each payload below is the exact compact script text.

### en

```json
{"@context":"https://schema.org","@graph":[{"@type":"Restaurant","@id":"https://localhost:44170/#capitol-hill","name":"Compliments Only — Capitol Hill","image":"https://localhost:44170/media/v2-p013-960-8271dfa0ca7d.webp","url":"https://localhost:44170/#shops","address":{"@type":"PostalAddress","streetAddress":"526 8th St SE Ste A","addressLocality":"Washington","addressRegion":"DC","postalCode":"20003","addressCountry":"US"},"geo":{"@type":"GeoCoordinates","latitude":38.8817492,"longitude":-76.9947597},"telephone":"+12026218645","openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"10:30","closes":"18:00"}],"hasMenu":"https://complimentsonlysubs.appfront.app/order/?branchId=69bdd5a0daeb710cb2cbdb0d&servingOptionType=a"},{"@type":"Restaurant","@id":"https://localhost:44170/#dupont","name":"Compliments Only — Dupont","image":"https://localhost:44170/media/v2-p013-960-8271dfa0ca7d.webp","url":"https://localhost:44170/#shops","address":{"@type":"PostalAddress","streetAddress":"2029 P St NW Front 1","addressLocality":"Washington","addressRegion":"DC","postalCode":"20036","addressCountry":"US"},"geo":{"@type":"GeoCoordinates","latitude":38.9098292,"longitude":-77.0462506},"telephone":"+12027944638","openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"10:30","closes":"20:00"}],"hasMenu":"https://complimentsonlysubs.appfront.app/order/?branchId=69bdddee7150a60c8dc37f73&servingOptionType=a"}]}
```

### es

```json
{"@context":"https://schema.org","@graph":[{"@type":"Restaurant","@id":"https://localhost:44170/#capitol-hill","name":"Compliments Only — Capitol Hill","image":"https://localhost:44170/media/v2-p013-960-8271dfa0ca7d.webp","url":"https://localhost:44170/#shops","address":{"@type":"PostalAddress","streetAddress":"526 8th St SE Ste A","addressLocality":"Washington","addressRegion":"DC","postalCode":"20003","addressCountry":"US"},"geo":{"@type":"GeoCoordinates","latitude":38.8817492,"longitude":-76.9947597},"telephone":"+12026218645","openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"10:30","closes":"18:00"}],"hasMenu":"https://complimentsonlysubs.appfront.app/order/?branchId=69bdd5a0daeb710cb2cbdb0d&servingOptionType=a"},{"@type":"Restaurant","@id":"https://localhost:44170/#dupont","name":"Compliments Only — Dupont","image":"https://localhost:44170/media/v2-p013-960-8271dfa0ca7d.webp","url":"https://localhost:44170/#shops","address":{"@type":"PostalAddress","streetAddress":"2029 P St NW Front 1","addressLocality":"Washington","addressRegion":"DC","postalCode":"20036","addressCountry":"US"},"geo":{"@type":"GeoCoordinates","latitude":38.9098292,"longitude":-77.0462506},"telephone":"+12027944638","openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"10:30","closes":"20:00"}],"hasMenu":"https://complimentsonlysubs.appfront.app/order/?branchId=69bdddee7150a60c8dc37f73&servingOptionType=a"}]}
```

## Advisory performance evidence and cleanup

Command: `npm.cmd run perf:ci`, once, with `LANDING_E2E_USE_BUILD=1`, `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`, `LANDING_PERF_NO_SANDBOX=1`, and cached pinned LHCI 0.15.1 at `LHCI_CLI_PATH=C:/Users/conta/AppData/Local/npm-cache/_npx/7c4c7312e9ccc7bf/node_modules/@lhci/cli/src/cli.js`. Log: `tmp/chunk8-perf.log`. Raw evidence: `tmp/landing-performance/2026-10-18T16-24-26.047Z-merge-8bda7d05/` (all 20 raw runs and four assertion sets retained).

Medians, milliseconds:

| Collection | Consent | CLI exit | LCP | TBT | Performance | Summary failures |
|---|---|---:|---:|---:|---:|---|
| simulated-report-only | unset | 0 | 3052.098 | 52.000 | 0.94 | lcp |
| simulated-report-only | accepted | 0 | 3060.605 | 47.500 | 0.93 | lcp |
| applied-blocking | unset | 1 | 2128.662 | 284.903 | 0.90 | tbt |
| applied-blocking | accepted | 1 | 2270.781 | 239.647 | 0.91 | tbt |

Every sample (no exclusions):

| Collection | Consent | Run | LCP ms | TBT ms | First-party bytes |
|---|---|---:|---:|---:|---:|
| simulated-report-only | unset | 1 | 3044.655 | 37.500 | 303052 |
| simulated-report-only | unset | 2 | 3077.706 | 55.500 | 303052 |
| simulated-report-only | unset | 3 | 3052.098 | 45.500 | 303052 |
| simulated-report-only | unset | 4 | 3027.119 | 180.500 | 303052 |
| simulated-report-only | unset | 5 | 3064.717 | 52.000 | 303052 |
| simulated-report-only | accepted | 1 | 3021.538 | 23.000 | 303052 |
| simulated-report-only | accepted | 2 | 3071.966 | 54.500 | 303052 |
| simulated-report-only | accepted | 3 | 3069.064 | 50.000 | 303052 |
| simulated-report-only | accepted | 4 | 3051.840 | 43.500 | 303052 |
| simulated-report-only | accepted | 5 | 3060.605 | 47.500 | 303052 |
| applied-blocking | unset | 1 | 2076.594 | 105.183 | 303052 |
| applied-blocking | unset | 2 | 2547.701 | 284.903 | 303052 |
| applied-blocking | unset | 3 | 2128.662 | 243.576 | 303052 |
| applied-blocking | unset | 4 | 2900.606 | 335.375 | 303052 |
| applied-blocking | unset | 5 | 2100.119 | 311.619 | 303052 |
| applied-blocking | accepted | 1 | 2948.426 | 187.479 | 303052 |
| applied-blocking | accepted | 2 | 2270.781 | 229.009 | 303052 |
| applied-blocking | accepted | 3 | 2200.684 | 244.996 | 303052 |
| applied-blocking | accepted | 4 | 2567.045 | 304.671 | 303052 |
| applied-blocking | accepted | 5 | 2264.468 | 239.647 | 303052 |

The 1,625-byte script text is identical in en/es. Measured first-party transfer is 303,052 bytes in every sample, +1,417 bytes versus the prior Round G report's 301,635 bytes. That historical report recorded applied medians LCP 2174.360/2428.795 ms and TBT 260.566/247.039 ms (unset/accepted); it is not a same-session paired baseline. Current applied LCP passes but TBT remains over budget, so **no claim that JSON-LD has zero measurable LCP/TBT impact** is made. No perf gate, assertion, retry count or throttle was changed. Pixel is blocked in this advisory harness; real third-party cost is not measured. Exact-revision CI and CC review remain open.

Cleanup: all ports 44170-44175 verified closed after perf, PID file absent. No test server left running. `git diff --check` passed. Branch remains `feat/landing-v2`, HEAD `0ab3fe7066ae615ee8a750964428bbb422b8779e`; all changes uncommitted.

## Chunk 8 fold-ins

2026-10-18, Part 0 of chunk 9, uncommitted on feat/landing-v2 at 2eb38e1b.

P3-1: classify once in proxy; production and preview malformed-host tests pin one fixed warning.
P3-2: public passthrough forwards sanitized request headers. Forged identity/indexability hints are removed on order, locations, portal, webhook and cron paths. Next internal request-override headers intentionally change; staff routing, body and public response headers remain identical to the fixture.
P3-3: production listed aliases redirect 301 with pathname/search; apex serves and preview stays noindex.
P3-4: explicit origin guards in proxy and page fail closed with 404.
P3-5: per-language canonical, en-US/es-US/x-default alternates, four-URL sitemap with xhtml alternates. BUILD section 8 records the intentional amendment.
P3-6: schema uses approved v2-p013-1280, individual visible shop IDs, and omits hasMenu because the page has ordering links, not shop menu anchors. No asset changes.
Launch packet now requires LANDING_HOSTS coverage for every public landing host. Staff login caching remains outside this task.

Initial targeted verification: `npm.cmd test -- tests/landing/indexing.test.ts tests/landing/metadata.test.ts tests/landing/structured-data.test.ts tests/landing/staff-routing.test.ts tests/landing/host-matrix.test.ts --maxWorkers=2`: 5 files / 98 tests passed. Full chunk 9 verification follows in its RESULT. Cross-family final review remains CC-owned.

Fold-in final verification: chunk 9 final landing/security suite 435 passed; final full browser run 500 passed / 13 existing skips, exit 0 (18.4 minutes); production build, typecheck, 45-asset check and changed-file lint passed. Full results, advisory performance and remaining CC gates are in [chunk 9 RESULT](landing-v2-chunk9-RESULT.md).
