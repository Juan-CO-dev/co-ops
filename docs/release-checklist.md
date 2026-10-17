# Landing release checklist

Custody (2026-10-16): branch `feat/landing-p1`, HEAD/base `21eeedde`, dedicated clone `C:/Users/conta/co-ops-landing`; clean before this round. Only this merge-gate/P3 round is UNCOMMITTED. Earlier rounds are committed. No push, merge, deploy, environment change or production write; 0273 remains file-only. Current evidence: [merge-gate result](landing-merge-gate-result.md). Release status: PREPARATION, NOT APPROVED FOR SPEND.

## Local release packet

CI-LCP sampling follow-up at `ac4171f3`: CC approved five cold runs for merge and launch. See the [investigation and verification](landing-ci-lcp-investigation.md), [reviewed plan](landing-ci-lcp-plan.md), and [historical baselines](qa/landing-ci-lcp-baselines.json). Changes remain uncommitted for CC review; CI is authoritative for performance on the loaded laptop.

- [ ] CC reviews the uncommitted merge-gate/P3 diff against 21eeedde and its verification report; reconcile it with Aggie's supplied 21eeedde review.
- [ ] Landing tests and full Vitest suite --maxWorkers=3: zero failures, actual totals in docs/qa/phase1.md.
- [ ] tsc and production build pass.
- [ ] Chromium + WebKit browser suite passes; lineup repeats three times, lineup/tracking repeat twice. Record decoder skips separately.
- [ ] `node scripts/assets/inventory.mjs --sources` re-hashes original masters and re-derives photo outputs. CI only checks manifest/outputs because original masters are local-only.
- [ ] MERGE / CI: `npm run perf:ci` passes five cold runs each for UNSET and ACCEPTED with Pixel blocked by Lighthouse only. Unchanged medians: Performance >=85, Accessibility >=95, LCP <2500ms, CLS <=0.1, TBT <=200ms; first-party <=500,000 bytes in every run. Evidence lives in unique per-invocation directories under `tmp/landing-performance/`. Registry failure is NOT a score.
- [ ] Initial compressed transfer <=500KB, LCP critical <=250KB, initial JS <=200KB, lazy media after full scroll <=5MB. Repeat consented with real Meta traffic before spend.

## Content and device approval

- [ ] Juan approves all seven sections and ten real-photo compositions. Field Guide stays held without anatomy photo; Marisa remains excluded.
- [ ] SUBDEX inspected timecode approved by Juan; record no baked text or held item.
- [ ] Approved store addresses/phones verified; hours/coordinates/footer destinations remain absent unless verified.
- [ ] Real iPhone Safari: device/OS/revision/date, poster immediately visible, opaque H264 hero and SUBDEX, keyboard/control/viewport/visibility pause, reduced-motion stills. Non-Darwin Playwright does not prove H264.
- [ ] Android mid-range phone on 4G, VoiceOver, 200% zoom, English/Spanish, 375px, 44px targets, no overflow, blocked media/Meta, JS disabled.

## Deployment operator gates

- [ ] Follow README's single PREVIEW section; exact existing branch preview hostname verified. No new resources by Astra.
- [ ] Review docs/deploy.md, approve exact alias and separate Preview/Production environment audit. Preserve staff configuration and host-only cookies.
- [ ] Verify Vercel Host/X-Forwarded-Host agreement, no-store HTML/RSC and host cache isolation, landing media caching, robots/canonical/icons, staff login/reset/portal, landing refusal matrix on public HTTPS.
- [ ] Merchant inspection proves both configured Appfront branch IDs and serving-option flow using real payloads; active catering + inquiry work from US. Do not accept a 200 shell as branch proof.
- [ ] Record prior DNS/ad destinations/Vercel rollback revision before any cutover. Preserve apex/www/MX/SpotHopper. Use only Vercel-supplied DNS record after Juan approval.
- [ ] Production indexing decision reviewed: current code remains noindex; do not infer that setting SITE_ORIGIN enables indexing.

## Paid activation gates

- [ ] LAUNCH (not CI): set process-local `LANDING_PERF_URL` to the actual HTTPS preview and run `npm run perf:launch`. Five accepted-consent cold runs with real Pixel traffic; report performance, LCP, total TBT, third-party blocking attribution and bytes to Juan before paid spend. Require completed real SDK traffic; missing/unfinished traffic is unmeasured, never zero cost. Preserve raw LHRs and record revision/URL/date. No budget thresholds are loosened.

- [ ] Pete verifies Meta domain, pixel allowed host and AEM; records Test Events for PageView/ViewContent/Lead/custom OrderClick/CateringClick and OrderClick conversion for CRAVE/RETARGET.
- [ ] Record PIXEL-ONLY or PIXEL+CAPI. Pixel proof and real consented performance mandatory. CAPI absence alone does not block verified pixel-only launch.
- [ ] CAPI only: actual WAF entitlement/rule scope/burst/aggregate/multi-instance/spoof/429 proofs; timestamp/rule IDs; dedup event IDs/retries and match-quality evidence. Incomplete protection leaves CAPI dormant.
- [ ] Counter only: separate CC/Juan migration approval/application and independent-session increment proof before enabling LANDING_COUNTER_ENABLED.
- [ ] E5 reviewed baseline includes actual merchant endpoint/schema and branch digests. Successful US external run, deliberate failure email RECEIVED, recovery verified, independent stale-heartbeat alert tested. See docs/monitoring.md.
- [ ] Juan pauses spend on broken ordering or >10min landing 5xx; missing/stale probes never count as recovery. Juan verifies recovery before resuming.

Evidence record for each manual gate: owner, date, exact revision/URL, private evidence location, result, follow-up. Blank boxes remain blockers, not implied approvals.
