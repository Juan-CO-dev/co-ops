# LANDING v2 chunk 2 result

Scope: BUILD r2 chunk 2 only, with the task-specific neutral butter wording and CI-only full e2e/perf gate. Dedicated clone `C:/Users/conta/co-ops-landing`, branch `feat/landing-v2`, base/HEAD `21922b70d3d22a4224e7e285b48078a6dcfbc67c`. Changes remain UNCOMMITTED. No push, merge, migration, environment, deployment or connected database changes.

## Implementation

- `config/tenant/landing.ts`: verified public addresses (including Ste A / Front 1), phones, bilingual daily hours, structured addresses/opening hours and coordinates. Official app hub, Instagram, careers (no callback), DoorDash and Uber Eats links. No Facebook destination.
- `lib/landing/stores.ts`: explicitly projected shared public model for visible content and later JSON-LD. Successful queries determine active membership; verified config supplies public facts. Successful empty results remain empty; explicit inactive rows are excluded. Provider/client failures use verified fallback with the existing fixed, non-sensitive diagnostic. Query remains `code,name,address,phone`, active filter and configured codes only.
- `config/tenant/landing-products.json`, `lib/landing/products.ts`, `lib/i18n/{en,es}.json`, `components/landing/Lineup.tsx`: ten complete menu lists, roll included, names aligned with supplied facts, same names in both languages, no Marisa. Photos and identity/source constraints remain unchanged. Routine salt/oregano omitted per glossary except The Frex retains oregano explicitly as required by r2. Vodka + marinara becomes vodka sauce.
- `components/landing/{Shops,NearbyShop}.tsx`, new `ShopMap.tsx`: opt-in nearby behavior retained; native directions use complete verified addresses. Static coordinate-based two-pin schematic with bilingual accessible name, schematic disclaimer and OSM attribution. No tile requests or automatic geolocation. Existing Footer renders the now-populated config with existing vendor tracking; no Footer transport rewrite.
- `scripts/landing/e2e-nearby-fixture.mjs`: necessary file-list extension announced during implementation. The fixture previously required null coordinates and empty footer links, which chunk 2 intentionally removes. It now retains verified coordinates and replaces only its delivery destinations with fictional URLs. The separate not-found fixture remains intact.
- Tests changed: `tests/landing/{products,stores,stores-failure,config,content,remaining-sections}.test.ts` and `tests/e2e/landing/{lineup,shops,languages,host-isolation,remaining-sections,review-regressions}.spec.ts`. `remaining-sections.test.ts` and the last three browser specs are additional affected assertion files beyond the r2 list; changes only reconcile their old empty-config/fallback assumptions with chunk 2.

## Every changed assertion

Existing assertions replaced (none silently dropped):

1. `products.test.ts`: absence of raw `ingredients` becomes the exact per-product `ingredientsKey` mapping. Existing approved image path, source identity, classification, resize-only and byte-ceiling assertions stay.
2. `stores.test.ts`: fixture name/address/phone and null hours/coordinates projection becomes verified Capitol Hill name, full address, real phone and coordinates. Existing projection string, one-row count and private integration-field exclusion stay.
3. `stores-failure.test.ts`: each of provider error result, rejected query and client construction failure now expects both verified fallback shops/phones instead of `[]`. Fixed diagnostic assertion stays.
4. `config.test.ts`: empty footer array becomes the exact five official key/URL pairs; null hours/coordinates becomes the exact two phones, all seven opening days, opening/closing times and coordinates. Nearby-enabled assertion added.
5. `remaining-sections.test.ts`: shop visible address, visible phone and telephone href switch from fictional to verified Capitol Hill values. Footer address switches likewise; DoorDash absence becomes presence. Gift-card absence, privacy, native navigation, translation and vendor-order assertions stay.
6. `shops.spec.ts`: fictional two addresses become supplied suite-qualified addresses; aggregate two-phone count becomes one exact telephone href assertion per shop; nearest button count becomes one instead of zero. The no-unsolicited-geolocation guard and page-error assertion stay.

New assertions:

7. `products.test.ts`: server-rendered en and es each contain all ten exact names and full expected ingredient lists (20 lists), including roll; rendered Marisa exclusion.
8. `stores.test.ts`: successful empty projection remains empty; an explicit inactive row remains excluded; both exact structured postal addresses; each directions destination equals the complete address; English daily opening and Spanish opening text; exact public-model key allowlist.
9. `stores-failure.test.ts`: successful empty query remains empty; successful EM-only query returns Dupont only.
10. `content.test.ts`: one `landing.lineup.butter` key has English `butter` / Spanish `mantequilla`; both Turkey Caesar templates interpolate `{butter}`; all ingredient strings exclude damaged question-mark replacement characters. Existing full landing translation parity test now covers the 16 new keys per language.
11. `shops.spec.ts`: both exact daily hours, visible schematic label, two native Google directions links, one OSM attribution link. Existing >=44px links, no overflow, no-JS, decoded SUBDEX still and no unsolicited location checks stay.
12. `lineup.spec.ts`: every card contains its roll with JS on and off. Existing ten-card count, Marisa exclusion, keyboard/native scroll, image loading and order navigation assertions stay.
13. `languages.spec.ts`: every ingredient card includes the language-appropriate roll; careers displays the translated label; no Facebook link. Existing language switching/section/consent assertions stay.

14. `host-isolation.spec.ts`: both landing-host Permissions-Policy assertions now expect `geolocation=(self)` because verified coordinates activate the existing opt-in feature. Status, cookies, host isolation and staff-policy checks remain unchanged.
15. `remaining-sections.spec.ts`: Spanish footer expects the real Capitol Hill address instead of the mock-provider address.
16. `review-regressions.spec.ts`: each language's dead-provider page now requires two shop cards and two footer addresses instead of no shops/addresses. The 200 response and privacy-link checks remain.

Fixture guard change: the old null-coordinate-count/empty-footer precondition is replaced by a required footer-block match. This enables the existing isolated fixture against populated chunk 2 facts; no runtime gate is relaxed.

## Verification

Tests-first evidence: focused four-file run before implementation produced 9 failing / 5 passing tests. Failures covered missing menu copy, verified facts, outage fallback and inactive membership. Raw local logs: `tmp/landing-v2-chunk2/` (ignored).

- `npm.cmd test -- tests/landing --maxWorkers=2`: PASS, 37 files / 306 tests.
- `npm.cmd run assets:check`: PASS, 40 assets. No media changes.
- `npx.cmd next typegen`: PASS.
- `npx.cmd tsc --noEmit`: PASS after narrowing the product translation-key type; initial TS2345 is resolved.
- `npm.cmd run build`: PASS (Next 16.2.4 Turbopack; compiled successfully, TypeScript and route generation completed).
- `npm.cmd test -- --maxWorkers=3`: EXIT 1, 745 files passed / 2 failed / 1 skipped; 12,141 tests passed / 2 failed / 3 skipped, 438.02 seconds. No landing failures.
- Scoped browser specs: PASS, 76 tests across Chromium/WebKit, 6.6 minutes, two workers. Reused the successful ordinary build; the existing harness also built its isolated fixture successfully. Exact command:

```powershell
$env:LANDING_E2E_USE_BUILD='1'
npx.cmd playwright test tests/e2e/landing/lineup.spec.ts tests/e2e/landing/shops.spec.ts tests/e2e/landing/languages.spec.ts tests/e2e/landing/host-isolation.spec.ts tests/e2e/landing/remaining-sections.spec.ts tests/e2e/landing/review-regressions.spec.ts --workers=2
```

- Visually inspected `test-results/shops-shop-facts-and-native-links-work-at-375px-JS-true-chromium/shops-375.png` and `test-results/lineup-lineup-is-usable-with-JS-true-webkit/lineup-375.png`: readable mobile schematic/facts and ingredient text below the untouched image rectangle. These are browser captures, not physical-device evidence.
- `git diff --check`: PASS.

Full local e2e and perf are deliberately not run. PR #491 CI remains the authoritative full e2e/performance gate; no claim is made about its current result.

## Known tsx ENOMEM spawns (separate from landing results)

The full suite is NOT a clean pass. Both unrelated CLI smoke tests failed during tsx startup, before their intended missing-configuration checks:

- `tests/people-chunkE-review.test.ts:130`: expected the named missing-config diagnostic; received ENOMEM.
- `tests/pm-criteria.test.ts:140`: expected `must be set`; received ENOMEM.

Both report the same stack in `tsx/dist/temporary-directory-CwHp0_NW.mjs`, via `node:os` `userInfo()`:

```text
SystemError [ERR_SYSTEM_ERROR]: A system error occurred:
uv_os_get_passwd returned ENOMEM (not enough memory)
code: 'ENOMEM'; syscall: 'uv_os_get_passwd'
Node.js v22.20.0
```

No workaround, test relaxation or unrelated code change was made for these failures.

## Open flags

- Turkey Caesar uses neutral **butter / mantequilla**. Change only `landing.lineup.butter` in each language dictionary when Juan answers Compound Butter wording; the menu interpolates it. Exact-copy tests must be updated alongside the approved wording.
- Balsamic Vin uses the creative plan's **balsamic vinaigrette / vinagreta balsamica**; final wording confirmation remains a copy gate as documented in r2. The Frex includes oil & vinegar, balsamic vinaigrette, prosciutto, oregano and roll.
- Public hours are daily per the supplied facts; Juan can correct them. Native map destinations preserve the exact supplied addresses, including Capitol Hill's shared-building suite. No merchant-navigation or physical-device confirmation is claimed.
- CC cross-family review and authoritative CI remain handoff gates.

## Result

Chunk 2 implemented and left uncommitted at the branch/path above. Landing tests, assets, type generation, TypeScript, production build and the 76 scoped browser tests pass. Full suite has the two separately listed known tsx ENOMEM startup failures. Every changed assertion is listed above. Butter and balsamic wording flags, CC review and authoritative PR #491 CI remain open.
