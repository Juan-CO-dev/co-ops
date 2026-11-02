# Landing activation notes - r5

Preparation only. No resources, DNS, deployment, env change or production migration is authorized by this document. CC/Juan own activation; E3-E5 release evidence remains outstanding.

- Verify actual Vercel Host/X-Forwarded-Host agreement before landing activation. Invalid or disagreeing authorities select STAFF with landing/tracking dormant and a PII-free warning. Staff routes serve normally; valid landing hosts still refuse staff routes. Do not log host/header values or request identifiers.
- Verify landing HTML/RSC is Cache-Control: private, no-store and content differs from staff root. Vercel CDN keys by host; no Vary: Host patch. Preserve Next stock same-host slash canonicalization and test canonical follow-ups.
- Keep LANDING_CAPI_ENABLED, LANDING_COUNTER_ENABLED and LANDING_META_UA_APPROVED false until their independent approvals. WAF attestation uses LANDING_WAF_STATE, LANDING_WAF_VERIFIED_AT and LANDING_WAF_RULE_IDS; validate actual rule scope/entitlement/bursts rather than trusting env as proof.
- META_GRAPH_API_VERSION is code-pinned to v25.0. Changing versions requires reviewed code plus env changes and provider verification.
- 0273 is already applied on sim and prod (verified 2026-11-01); do not reapply it. Apply 0289 through CC/Juan's authorized process, sim first, and prove independent-session increments and ad-code allocation before enabling the counter. Enabling LANDING_COUNTER_ENABLED first yields 503 on eligible click-counter requests. Native navigation never waits for that request.
- Landing metadata has its own bilingual title/description/og:description, metadataBase and canonical from approved SITE_ORIGIN. Preview remains noindex. Final OG assets, public HTTPS/canonical smoke, merchant flow, consented real Meta performance and activation evidence remain later gates.

## Required real-iPhone Safari preview check

Before acceptance, open the allowlisted preview on a real iPhone in Safari. Confirm the real hero poster shows immediately, trigger the hero and confirm it plays, and watch the full loop with no black box. Also scroll to SUBDEX and verify its still-to-motion transition, pause/resume, viewport-exit pause and reduced-motion fallback. Record device, iOS/Safari version, preview revision, date and result. Playwright WebKit on non-Darwin platforms cannot certify H.264 decoding: only decode-dependent checks are skipped there; keyboard/offscreen/visibility pause and geometry run with a media adapter, and axe, poster, fallback, no-JS and reduced-motion checks still run. Chromium supplies the local decoder proof.

Landing media is now content-addressed and immutable. Verify `/_next/static` retains stock public/immutable caching, approved `/media/*` has `public, max-age=31536000, immutable`, and those media paths return 404 on the staff host. Verify every landing HTML/RSC response remains private/no-store. Vercel host cache keys remain the deployment assumption to verify at ingress; no Vary: Host patch is added.

Nearest-shop permission is conditional: both configured shops need valid verified coordinates before landing permits `geolocation=(self)` or renders its opt-in button. Staff always denies it. Confirm there is no prompt on load, denial preserves both order links, and the displayed distance is explicitly straight-line distance rather than walking time. Run `node scripts/assets/inventory.mjs --sources` at release; ordinary CI verifies output bytes and eligible confirmed source identities without accessing external masters.
## Activation procedure (CC / Juan)

This is preparation only. Read docs/release-checklist.md and README's PREVIEW section. No environment values were set, no resource/domain/alias created, and no migration applied. The preview hostname is not known locally: CC must retrieve the existing feat/landing-p1 branch preview from the existing Vercel project; do not invent an alias.

1. Before deploy: review the two change sets and local evidence in docs/qa/phase1.md. Confirm the exact commit after CC commits; uncommitted local tests do not certify a later deployed revision. Run `node scripts/assets/inventory.mjs --sources` where external originals are available. CI intentionally cannot access the masters.
2. Preview: set only the approved Preview branch scope using README's values, through CC/Juan. Tracking and counter remain dormant. Audit inherited Preview variables so a global Pixel ID does not accidentally make this preview track. Verify approved public location reads and both translations. Record the exact URL/revision and real iPhone/Android/VoiceOver checks.
3. Ingress: check root/privacy, /eat canonical redirect, no-store HTML and RSC, immutable media and stock framework caching; compare staff root and portal on the same deployment. Refuse landing /admin, /order, staff APIs, arbitrary optimizer sources; reject disagreeing Host/X-Forwarded-Host. Record actual response headers, no host-only auth/shop cookies on landing, no Meta requests on staff or unlisted previews.
4. Merchant: from an external US location inspect the actual Appfront payload endpoint/schema, both branch IDs and serving-option selection; verify active catering and inquiry. Record reviewed response/normalized branch hashes in the monitoring baseline. A 200 shell or synthetic local locations do not prove this gate.
5. Alias/DNS: only after Juan approves the exact alias and Pete supplies access, CC uses the existing Vercel project and the exact DNS record it supplies. Record current DNS, TTL, deployed rollback revision and ad destinations first. Preserve existing GoDaddy MX/TXT (Resend/SPF/DKIM), Meta TXT and unrelated records; change only the approved Vercel domain records. Confirm HTTPS/TLS and public origin before switching ad destinations. Production scope requires exact LANDING_HOSTS, SITE_ORIGIN and STAFF_ORIGIN; do not copy preview hostnames into Production.
6. Indexing: current metadata/proxy intentionally keep every landing host noindex with an empty sitemap. An approved production-indexing change requires reviewed code for both metadata and proxy robots/sitemap. Setting SITE_ORIGIN alone does not remove noindex. Staff metadata stays untouched.
7. Pixel: Pete verifies domain, allowed host and AEM, then records Test Events and the custom OrderClick conversion. Test consent/reject/withdraw and DNT/GPC. Measure five cold runs each with and without consent on public HTTPS with the real Pixel. Local offline transfer measurements are not live Meta cost evidence. CAPI ready (D6) is a launch gate. Complete every readiness item before paid spend.
8. CAPI launch gate: actual WAF entitlement, host/path/method scope, per-IP/aggregate concurrent bursts, 429s and spoof resistance must pass before attestation is set. Require approved UA disclosure, exact server credentials, fresh evidence, browser/server event-ID dedup and match quality before enabling. Never place provider credentials or user data in evidence files. Never leave a production META_TEST_EVENT_CODE.
9. Counter: 0273 is already applied; 0289 remains authored and unapplied. Only CC/Juan's separately authorized migration process may apply 0289 after sim proof. Verify independent-session increments and no identifying data before enabling LANDING_COUNTER_ENABLED. Native order navigation must work while all measurement fails.
10. Monitoring: follow docs/monitoring.md; activate only with reviewed baselines, proven US runner, successful probe, received deliberate failure notification and independent stale-heartbeat alarm. Juan pauses spend for broken ordering or a >10-minute landing 5xx incident. A 15-minute cron has up to roughly 15-minute detection delay plus scheduler latency; one-minute incident rechecks cannot erase that initial gap.
11. Rollback: Juan pauses campaigns first; CC restores prior ad destinations and approved prior Vercel revision/DNS values. Disable optional tracking/counter flags if implicated. Re-run host/staff/merchant/privacy checks and obtain Juan's recovery approval before resuming. Missing probe results never count as recovery.

## Local measurement commands for CC

PowerShell, from this clone, with Node 22 and the existing locked dependencies:

```powershell
npm.cmd run build
$env:LANDING_E2E_USE_BUILD = '1' # this shell/test process only, never a deployment setting
npm.cmd run perf:ci
Remove-Item Env:LANDING_E2E_USE_BUILD
node scripts/assets/inventory.mjs --sources
```

`perf:ci` attempts pinned `@lhci/cli@0.15.1`, five cold mobile simulated-4G/4x-CPU runs for accepted and unset consent at 375px. Preserve `.lighthouseci/` and `tmp/landing-performance/`, including failed runs. This task's registry probe was denied EACCES, so no Lighthouse score is claimed. Repeat on real public HTTPS/Pixel before spend; do not substitute the faster unconsented run. See docs/qa/phase1.md for final local command outcomes.

The pinned SUBDEX source frame is a local-only PNG under `assets/work/`. On a clean operator clone with the approved source video available, run `node scripts/assets/export-subdex.mjs` to reconstruct that frame before `assets:check -- --sources`; this reuses the pinned video/timecode/crop and does not generate new imagery. CI deliberately omits `--sources`.

## Production identity and ordered activation (D4)

Landing: `https://complimentsonlyoperations.com`. Staff: `https://co-ops-ashy.vercel.app` (CC confirms before activation). `www.complimentsonlyoperations.com` is a Vercel **308 redirect to bare**, never in `LANDING_HOSTS`. Test root and staff-path requests on www: it must redirect, never serve staff HTML. Bare admits only landing routes; `/admin/marketing` and `/api/admin/marketing/*` return 404 there. Staff landing APIs return 404 and staff sends no Meta requests.

Pete screenshots GoDaddy records before edits. Preserve MX and TXT for Resend/SPF/DKIM and the Meta verification TXT, plus unrelated records. Use only exact Vercel-supplied records after Juan approves.

Each Production step requires Juan's OK and a redeploy; nothing is activated by these documents. Keep CAPI/counter false through WAF proof.

1. After DNS/TLS pass, confirm `STAFF_ORIGIN=https://co-ops-ashy.vercel.app`; then set `LANDING_HOSTS=complimentsonlyoperations.com` and `SITE_ORIGIN=https://complimentsonlyoperations.com`. Smoke bare, www 308 and staff isolation.
2. Complete [D2 rules/proof](landing/waf-rules.md) and [D3 attestation](evidence/landing-waf-attestation-TEMPLATE.md). Only then set `LANDING_WAF_STATE=active`, `LANDING_WAF_RULE_IDS` and `LANDING_WAF_VERIFIED_AT` (YYYY-MM-DD).
3. Apply 0289 sim then prod after reviewed harness and concurrency proof; stamp the applied migration only when actually applied. Then `LANDING_COUNTER_ENABLED=true`; record `counter_on`. Separately authorize `MARKETING_SCORECARD=1` after 0289 to expose the recording UI; it ships OFF.
4. Set `NEXT_PUBLIC_META_PIXEL_ID` equal to `META_PIXEL_ID`; rebuild without cache.
5. Set `META_GRAPH_API_VERSION=v25.0`. Juan pastes `META_CAPI_ACCESS_TOKEN` himself in Vercel, never in evidence. Set `LANDING_META_UA_APPROVED=true` only after he confirms the existing disclosure.
6. Preview only: `META_TEST_EVENT_CODE` and `LANDING_CAPI_ENABLED=true`. Pete verifies Deduplicated for Lead, OrderClick and CateringClick. Never copy the test code to Production (503). PageView/ViewContent remain pixel-only; navigating resolution taps remain server-only. Use paired dispatches for dedup proof.
7. Production `LANDING_CAPI_ENABLED=true` last, then record `capi_on`. Verify Browser + Server received, all D6 checks, and test rollback once: `LANDING_CAPI_ENABLED=false` plus redeploy. Restore only with Juan's approval and repeat proof before spend.

D6 includes recorded rules, phases a-g, CC review/Juan approval, `landingRateLimit(env)==='allowed'`, matching Pixel IDs, token present, v25.0, no Production test code, approved UA, three-event Preview dedup, Production Browser + Server, zero Meta requests for reject/withdraw/DNT/GPC, staff isolation and tested rollback. Values remain private; the scorecard shows booleans. EMQ is accepted as-is: never add IP, email or phone. Follow the [nine-step sitting runbook](runbooks/landing-go-live.md).
