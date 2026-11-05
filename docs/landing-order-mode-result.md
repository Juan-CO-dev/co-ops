# Landing order mode implementation

Branch: `feat/landing-order-mode`; worktree: `C:/Users/conta/co-ops-astra-landing`. No commit, push, merge, database access or migration application.

## Decisions

- Delivery URL: `https://complimentsonlysubs.appfront.app/order/?servingOptionType=delivery` (no branch). No live Appfront probe was performed; merchant delivery-tab behavior remains unverified here.
- Counter sentinel: `any` iff intent is delivery, enforced by CHECK and RPC validation. Requests omit the store; server maps to sentinel.
- Vendors: existing counter excludes them; preserved. Vendor Meta events reject mode.
- Items: pickup at lineup/crave/guide requires a bounded item; delivery may carry that same bounded item only at those placements.
- Compatibility: old two-field counter requests and named two-argument RPC calls record legacy. Apply reviewed 0292 before the app.
- Scorecard: old aggregate read retains totals; separate intent read supplies per-ad split. Unassigned delivery appears only under all shops.

## Files

- `docs/landing-order-mode-result.md`: complete review report, decisions, privacy quotes and verification evidence.
- `tests/landing/privacy-intent.test.ts`: assert complete prior disclosure remains intact and Spanish accents round-trip.

- `app/admin/marketing/ScorecardClient.tsx`: Read and display per-ad intent totals using existing scorecard patterns.
- `app/eat/page.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/CrunchyOrder.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/FighterSelect.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/Footer.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/Hero.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/Lineup.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/NearbyShop.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/OrderLink.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/OrderSheet.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/Shops.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/StickyOrderBar.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `components/landing/TrackingProvider.tsx`: Wire pickup, shared delivery, or consent-gated directions controls.
- `config/tenant/landing.ts`: Replace invalid order mode with branch pickup URLs and tenant delivery URL.
- `docs/landing-v2-BUILD.md`: Correct URL guidance or monitoring baseline without inventing live evidence.
- `docs/landing-v2-chunk8-RESULT.md`: Correct URL guidance or monitoring baseline without inventing live evidence.
- `docs/landing-v2-creative-plan.md`: Correct URL guidance or monitoring baseline without inventing live evidence.
- `docs/landing-v2-facts.md`: Correct URL guidance or monitoring baseline without inventing live evidence.
- `docs/monitoring.md`: Correct URL guidance or monitoring baseline without inventing live evidence.
- `docs/superpowers/plans/2026-10-16-landing-page-phase1-BUILD.md`: Correct URL guidance or monitoring baseline without inventing live evidence.
- `docs/superpowers/specs/2026-10-16-landing-page-phase1-design.md`: Correct URL guidance or monitoring baseline without inventing live evidence.
- `lib/i18n/en.json`: Pickup/delivery labels, intent breakdown and additive privacy disclosure.
- `lib/i18n/es.json`: Pickup/delivery labels, intent breakdown and additive privacy disclosure.
- `lib/landing/item-order-url-shared.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/links.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/meta-server.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/order-click-server.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/order-click-shared.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/stores.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/structured-data-shared.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/tracking-client.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/landing/tracking-schema-shared.ts`: Propagate bounded modes/visit intent through landing links, schema and server/client transport.
- `lib/marketing/scorecard-shared.ts`: Read and display per-ad intent totals using existing scorecard patterns.
- `lib/marketing/scorecard.ts`: Read and display per-ad intent totals using existing scorecard patterns.
- `scripts/landing/e2e-server.mjs`: Update monitored destinations or offline fixture counter signature.
- `scripts/probe-money-path.mjs`: Update monitored destinations or offline fixture counter signature.
- `scripts/sql-harness-0292.mjs`: Offline migration/ACL/compatibility proof including broken writer failure.
- `supabase/migrations/0292_landing_click_intent.sql`: File-only intent rekey, compatible counter RPC and scorecard reads.
- `tests/e2e/landing/crave-field-guide.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/dedup.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/fixround.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/hero.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/host-isolation.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/lineup.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/order-intent.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/order-links.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/review-regressions.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/shell.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/shops.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/sticky-order.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/e2e/landing/tracking.spec.ts`: Browser assertions for pickup/delivery links, intent payloads or visit tracking.
- `tests/landing/click-intent.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/config.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/dedup.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/footer-tracking.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/item-deeplinks-ui.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/item-deeplinks.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/meta-route.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/meta-schema.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/monitor.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/nearby.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/order-click.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/placements.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/sticky-review.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/stores.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/structured-data.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/tracking-client.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/landing/v4-convert.test.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/live/landing-links.probe.ts`: Update landing contract coverage for URLs, controls, events or monitoring.
- `tests/marketing-loader.test.ts`: Protect scorecard totals, intent grouping and translated rendering.
- `tests/marketing-scorecard-ui.test.ts`: Protect scorecard totals, intent grouping and translated rendering.
- `tests/marketing-scorecard.test.ts`: Protect scorecard totals, intent grouping and translated rendering.

## Privacy copy before and after

Every original sentence is preserved as an exact prefix. The following quotes are complete values, not shortened excerpts.

### en: `landing.privacy.meta`

Before:

> When enabled and accepted, Meta receives page and section views and outbound order or catering clicks. Approved ad attribution and a valid Facebook click identifier may be kept for this session. Meta may use its own browser identifiers. Server measurement may send the same click with its event ID and approved browser identifiers for deduplication. With your permission, server measurement may also send browser information (user agent) to Meta. Our application does not send your IP in server events or collect your name, email or phone here; Meta sees network information such as your IP when its browser Pixel connects. We do not store these browser identifiers or server-event payloads in our database or logs. Meta processes data under its own policies. You can reject or withdraw optional measurement here at any time.

After:

> When enabled and accepted, Meta receives page and section views and outbound order or catering clicks. Approved ad attribution and a valid Facebook click identifier may be kept for this session. Meta may use its own browser identifiers. Server measurement may send the same click with its event ID and approved browser identifiers for deduplication. With your permission, server measurement may also send browser information (user agent) to Meta. Our application does not send your IP in server events or collect your name, email or phone here; Meta sees network information such as your IP when its browser Pixel connects. We do not store these browser identifiers or server-event payloads in our database or logs. Meta processes data under its own policies. You can reject or withdraw optional measurement here at any time. Directions taps are also measured. Order taps record pickup or delivery.

### en: `landing.privacy.body`

Before:

> Ordering happens on the ordering provider's site. This page has no customer form. Optional measurement starts only after you accept and is disabled by Do Not Track or Global Privacy Control. We count approximate order clicks by day, shop and approved ad code, not purchases or unique people. We do not save personal identifiers in that counter.

After:

> Ordering happens on the ordering provider's site. This page has no customer form. Optional measurement starts only after you accept and is disabled by Do Not Track or Global Privacy Control. We count approximate order clicks by day, shop and approved ad code, not purchases or unique people. We do not save personal identifiers in that counter. The counter also records directions taps and separates pickup, delivery and visit intent. Delivery is not assigned to a shop.

### en: `landing.consent.notice`

Before:

> With your permission, we count order clicks and, when configured, share visits and clicks with Meta to understand our ads. Ordering works either way.

After:

> With your permission, we count order clicks and, when configured, share visits and clicks with Meta to understand our ads. Ordering works either way. This includes directions taps and pickup or delivery choices.

### es: `landing.privacy.meta`

Before:

> Si está habilitado y aceptas, Meta recibe visitas a la página y sus secciones y clics para pedidos o catering. La atribución aprobada del anuncio y un identificador válido de clic de Facebook pueden guardarse durante esta sesión. Meta puede usar sus propios identificadores del navegador. La medición del servidor puede enviar el mismo clic con su identificador de evento e identificadores aprobados del navegador para evitar duplicados. Con tu permiso, la medición del servidor también puede enviar a Meta información del navegador (agente de usuario). Nuestra aplicación no envía tu IP en eventos del servidor ni recoge aquí tu nombre, correo o teléfono; Meta recibe información de red como tu IP cuando se conecta su Pixel. No guardamos estos identificadores del navegador ni los eventos del servidor en nuestra base de datos o registros. Meta procesa los datos según sus propias políticas. Puedes rechazar o retirar tu permiso para la medición opcional aquí cuando quieras.

After:

> Si está habilitado y aceptas, Meta recibe visitas a la página y sus secciones y clics para pedidos o catering. La atribución aprobada del anuncio y un identificador válido de clic de Facebook pueden guardarse durante esta sesión. Meta puede usar sus propios identificadores del navegador. La medición del servidor puede enviar el mismo clic con su identificador de evento e identificadores aprobados del navegador para evitar duplicados. Con tu permiso, la medición del servidor también puede enviar a Meta información del navegador (agente de usuario). Nuestra aplicación no envía tu IP en eventos del servidor ni recoge aquí tu nombre, correo o teléfono; Meta recibe información de red como tu IP cuando se conecta su Pixel. No guardamos estos identificadores del navegador ni los eventos del servidor en nuestra base de datos o registros. Meta procesa los datos según sus propias políticas. Puedes rechazar o retirar tu permiso para la medición opcional aquí cuando quieras. También medimos los clics para obtener indicaciones. Los clics para pedidos registran recogida o entrega a domicilio.

### es: `landing.privacy.body`

Before:

> Los pedidos se hacen en el sitio del proveedor de pedidos. Esta página no tiene formularios para clientes. La medición opcional empieza solo si aceptas y se desactiva con Do Not Track o Global Privacy Control. Contamos clics aproximados por día, tienda y código de anuncio aprobado, no compras ni personas únicas. No guardamos identificadores personales en ese contador.

After:

> Los pedidos se hacen en el sitio del proveedor de pedidos. Esta página no tiene formularios para clientes. La medición opcional empieza solo si aceptas y se desactiva con Do Not Track o Global Privacy Control. Contamos clics aproximados por día, tienda y código de anuncio aprobado, no compras ni personas únicas. No guardamos identificadores personales en ese contador. El contador también registra los clics para obtener indicaciones y distingue la intención de recogida, entrega a domicilio o visita. La entrega a domicilio no se asigna a una tienda.

### es: `landing.consent.notice`

Before:

> Con tu permiso, contamos clics de pedidos y, si está configurado, compartimos visitas y clics con Meta para entender nuestros anuncios. Puedes pedir con cualquier opción.

After:

> Con tu permiso, contamos clics de pedidos y, si está configurado, compartimos visitas y clics con Meta para entender nuestros anuncios. Puedes pedir con cualquier opción. Esto incluye los clics para obtener indicaciones y las opciones de recogida o entrega a domicilio.

## Verification

- `npx.cmd vitest run tests/landing --reporter=json --outputFile=tmp/landing-units-final.json`: 504 passed, zero failed.
- `npx.cmd vitest run tests/marketing`: 343 passed (13 files); log `tmp/landing-marketing-final.log`.
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/landing/order-click-sql-check.ts`: 174 checks passed. The original tsx launcher could not initialize `os.userInfo` in this sandbox (ENOMEM); native Node type stripping ran the unchanged harness successfully.
- `node scripts/sql-harness-0289.mjs`: 201 checks passed.
- `node scripts/sql-harness-0292.mjs`: 36 checks passed, including expected FAIL for the broken variant.
- `npx.cmd tsc --noEmit --incremental false`: passed with zero diagnostics after the Next build generated image declarations. Initial fresh-clone run had six PNG declaration errors in untouched Leaflet files; no source fix or suppression was needed.
- Core Chromium Playwright suite (order-intent, order-links, tracking, dedup): 21 passed. Main Next production build and separate webpack fixture build passed.
- Expanded Chromium suite: 140 passed / 2 initially failed. Failure output: guide precondition `Expected true, Received false` before tapping; Spanish notice `Expected <=100, Received 111` after required additive disclosure. Tests now await native-order enhancement before measuring the guide and allow 120px for the Spanish notice while retaining hidden-pill assertions. Focused rerun: 3 passed (both languages plus guide); log `tmp/landing-order-mode-e2e-recheck-final.log`. No remaining observed browser failure. Core + expanded covered 163 distinct browser cases; the full expanded suite was not repeated after these test-only corrections.
- Browser scope: Chromium. WebKit/mobile-WebKit and unrelated landing performance suites were not run; affected accessibility, reflow, languages, no-JS, sticky, shops, lineup and field-guide tests were run.
- Core command: `npx.cmd playwright test --project=chromium tests/e2e/landing/order-intent.spec.ts tests/e2e/landing/order-links.spec.ts tests/e2e/landing/tracking.spec.ts tests/e2e/landing/dedup.spec.ts`.
- Expanded command: `LANDING_E2E_USE_BUILD=1 npx.cmd playwright test --project=chromium` with the 12 affected spec paths (hero, lineup, shops, sticky-order, crave-field-guide, fixround, review-regressions, languages, reflow, accessibility, shell, host-isolation). The harness rebuilt its separate webpack fixture.
- Focused command: `LANDING_E2E_USE_BUILD=1 LANDING_PERF_CONSENT=unknown npx.cmd playwright test --project=chromium tests/e2e/landing/crave-field-guide.spec.ts tests/e2e/landing/sticky-order.spec.ts --grep "finding all six by taps alone|consent showing"`. These tests need no separate nearby fixture; the existing harness switch skips it. Environment assignments are shown in portable notation; actual Windows invocation used PowerShell environment variables.
- One attempted focused invocation raced the previous server teardown and got connection refusals; rerunning with harness-owned startup resolved that infrastructure failure.
- `git diff --check`: passed. Spanish reread as Unicode code points; appended accents are U+00E9 / U+00F3 and old privacy paragraphs remain exact prefixes.
- No live Appfront probe or independent-session SQL lock test ran. No migration was applied.

## Risks and handoff

Migration remains FILE ONLY. CC owns cross-family review and migration/deployment sequencing. Offline PGlite proves behavior but cannot establish independent-session blocking. No live merchant or production data was accessed.

## Self-check and review status

Relevant catalog surfaces checked: BC-004 consent gate directions; BC-007 atomic upsert; BC-008 ET buckets retained; BC-017/018 vocabulary and translated dynamic keys; BC-019 stale link docs; BC-030/031 real migration harness and aggregate partition proof; BC-040 bounded invalid inputs refuse. This is implementation self-check, not independent cross-family review. CC review remains outstanding under the multi-seat-review handoff.

### en: `marketing.tap_disclosure`

Before:

> Taps from visitors who accepted measurement, not orders. Retired codes remain in history.

After:

> Taps from visitors who accepted measurement, not orders. Retired codes remain in history. Includes pickup, delivery and directions intent; delivery has no assigned shop.

### en: `marketing.section.taps`

Before:

> Order taps by ad code

After:

> Order taps by ad code / directions

### es: `marketing.tap_disclosure`

Before:

> Toques de visitantes que aceptaron la medición, no pedidos. Los códigos retirados permanecen en el historial.

After:

> Toques de visitantes que aceptaron la medición, no pedidos. Los códigos retirados permanecen en el historial. Incluye la intención de recogida, entrega a domicilio e indicaciones; la entrega a domicilio no tiene tienda asignada.

### es: `marketing.section.taps`

Before:

> Toques para pedir por código de anuncio

After:

> Toques para pedir por código de anuncio / indicaciones
