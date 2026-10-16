# Landing review fixes and Chunk D handoff

Base `51829f5e461d94ddb05e5c4964d3a7f485913314`, branch `feat/landing-p1`, dedicated clone `C:/Users/conta/co-ops-landing`. All current changes remain UNCOMMITTED. No push, merge, deployment or production data access. Migration 0273 remains unchanged and file-only.

## Separate review-fix change set

Applied CC's chunk-B rulings first. Captured the pre-D binary patch at `tmp/landing-review-fixes/chunk-b-rulings.patch` with a SHA256 receipt alongside it. This includes renamed media bytes and new text files, without staging or committing. The receipt records subsequent B-only amendments: default camera/geolocation denial, the old global permission-test pin, historical C custody, and WebKit-only DOMContentLoaded navigation. The packet's landing tests passed 200/200 before D; cache/provenance/co-scenes checks passed 46/46. Final verification below covers the combined tree. The combined code-review packet is `tmp/landing-review-fixes/combined-review.md` (115,692 bytes); asset provenance is reviewed separately.

- `proxy.ts`, security headers, public asset inventory and media/export tooling: private/no-store pages; stock Next static caching; immutable content-hashed media; staff media refusal. Only public IDs/paths enter application bundles. CI checks every public media file is approved and real photos map to eligible confirmed IDs and exact source hashes. Local source rehash remains a release step.
- Staff-routing fingerprint includes forwarded identity headers, slash paths and absent Next slash flag. All five requested source/config mutations are detected, including the fixture's otherwise unreachable public branch.
- Shared motion watchdog uses stable playback eligibility and actual time progress, including freezes after playback starts. Scroll cannot restart the timer. WebKit axe uses DOMContentLoaded and longer timeouts; only H.264 checks skip on non-Darwin WebKit. Slash chains pin hop bounds, terminal status, origin and no cookies.
- Removed unused identity-reference helper; independently re-derived origins with `notFound()`; corrected historical A/A+B custody lines. The tsconfig replay exclusion was already committed in chunk C, so no new tsconfig change was needed.

## Chunk D

`SubdexMoment`, `Shops`/`NearbyShop`, `Catering`, `Footer`, the page and bilingual dictionaries implement the remaining sections. SUBDEX is drawn/hash-tagged, 63,770-byte opaque silent MP4 plus 17,576-byte still; original hash verified before/after export. Shops use the real public loader; client location is click-only, coordinates stay in the callback, and only derived distances remain in memory. No coordinates or hours are fabricated. Geolocation stays denied until both configured shops have valid coordinates; then only landing permits self. Camera/microphone remain denied on landing.

Toast catering and inquiry remain active; portal flag OFF. Missing footer URLs render nothing; configured delivery destinations sort last and smaller. No unapproved catering photo is shown. Client receives only translated shop labels, not the full staff dictionaries. Local production-browser tests use fictional records through a loopback-only HTTP fixture and the real locations loader; there is no production fixture switch.

## Juan/Pete inputs and acceptance still needed

1. Confirm each shop's current public name, address and phone in `locations`; supply each shop's opening hours and verified latitude/longitude. Optional walking copy requires verified landmarks/routes/times; none is guessed.
2. Exact verified URLs for gift cards, app landing page, iOS App Store, Android Play Store, Instagram, Facebook, Uber Eats and DoorDash. All are currently absent. Confirm the supplied Appfront branch/serving-option links, Toast catering and inquiry in a real merchant flow.
3. Approved real catering platter photo with exact source identity/hash. Candidate lifestyle images are not approvals.
4. SUBDEX 17.3–18.2s hero/bite excerpt and phone composition approval; real-iPhone Safari hero/SUBDEX playback, controls and fallback checks at the preview.
5. Carried-forward C hold: approved real Field Guide cut-face source, current Crunchy Boi build sheet/layer facts, and the ten product ingredient lists named in `docs/content-evidence.md`. Existing scaffold/name-only lineup remain honest about missing facts. Marisa stays absent.
6. Final bilingual copy/section/phone approval. No public labels were added. Existing activation/Meta/WAF/merchant gates in `docs/deploy.md` remain separate.

## Review request for CC

QA correctness/completeness of the combined uncommitted tree against 51829f5e: verify cache isolation and immutable naming; eligible source IDs and generated inventory equality; staff identity/slash mutations; watchdog progress semantics; no geolocation on load or coordinate persistence; missing-fact omission; native catering/footer destinations and no fabricated photos. Report P1/P2/P3 with file:line and a concrete failure scenario, including BC-040 refusal handling. CC arranges cross-family review and independent verification before accepting/committing. No review or launch approval is claimed.

## Final verification

All final gates passed. Application source stayed frozen after the successful production build; subsequent changes were test harnesses and documentation only.

| Command | Outcome | Evidence |
| --- | --- | --- |
| `npx.cmd vitest run tests/landing --maxWorkers=3` | 212 passed, 27 files | `tmp-landing-d-unit.log` |
| `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3` | **9,853 passed / 3 existing skips / 0 failures**; 645 files passed / 1 skipped | `tmp-landing-d-full-final.log` |
| `npx.cmd tsc --noEmit --incremental false` | Exit 0, no diagnostics | `tmp-landing-d-tsc-final.log` |
| `npm.cmd run build` | Exit 0, default Next 16.2.4 Turbopack production build | `tmp-landing-d-build.log` |
| `LANDING_E2E_USE_BUILD=1 npx.cmd playwright test` | **127 passed / 7 authorized codec skips / 0 failures**, Chromium + WebKit | `tmp-landing-d-e2e-verified.log` |
| `npx.cmd tsc --noEmit` after final browser-test edits | Exit 0, no diagnostics | `tmp-landing-d-tsc-complete.log` |
| `node scripts/assets/inventory.mjs --sources` | 26 assets and original hashes passed | Final terminal run |
| `git diff --check`; migration/tsconfig diff; staged diff | Passed; migrations/tsconfig unchanged; nothing staged | Final terminal run |

Seven browser skips are exactly the six pre-existing hero/control H.264 checks plus SUBDEX playback, only on non-Darwin WebKit. Axe, still-image decoding, no-JS, reduced-motion, autoplay rejection, watchdog freezes, native links, source inventory/cache boundaries, both languages and location grant/denial/timeout/unavailable all run. No test was skipped to hide a failure.

Initial failures were retained and resolved: the full suite first had one stale unconditional-geolocation assertion (9,852 passed/1 failed); the initial browser run had eight test-bundler resolution failures and one Chromium no-JS scroll-actionability timeout (118 passed/9 failed/7 codec skips). The fixture now resolves source files through permitted Node file reads without parent-directory discovery; native keyboard movement remains independently asserted before scrolling to the last card. A later browser run exposed two Chromium consent clicks before readiness (125 passed/2 failed/7 skips); DOMContentLoaded is now scoped to WebKit exactly as ruled, with Chromium retaining its normal load wait. The final complete run is green. Early TypeScript optional-ad typing was corrected; both final typechecks are clean.

Local e2e servers use 44170/44171 and the public-facts fixture uses loopback 44172 because 43170 was already occupied. The existing process was left alone. These are test-only ports; application origins still come from deployment config. The fixture source is the actual NearbyShop component with explicit synthetic coordinates, not a production test switch.

Visual QA: inspected the 375px full page, SUBDEX still with JS disabled, and WebKit shop cards (`test-results/shops-shop-facts-and-native-links-work-at-375px-JS-false-chromium/subdex-375.png` and `test-results/shops-shop-facts-and-native-links-work-at-375px-JS-true-webkit/shops-375.png`). The full-page capture does not trigger below-fold lazy assets; explicit viewport tests also prove the SUBDEX poster decoded at 720px. Native cards/buttons fit; source-framed food and pixel hero remain intact. This is local QA, not Juan's phone or real-iPhone approval.

Final HEAD remains `51829f5e461d94ddb05e5c4964d3a7f485913314`, branch `feat/landing-p1`, workspace `C:/Users/conta/co-ops-landing`. All changes remain uncommitted.
