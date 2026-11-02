# Landing go-live sitting

CAPI ready (D6) is a launch gate. Preparation is not authorization to deploy, change DNS/env, apply migrations or spend. Each activation needs Juan's OK. CC owns evidence; Pete owns GoDaddy access. No secrets, IPs or customer data in evidence.

1. **CC, before the sitting:** review and merge the OFF chunks through the normal process. 0273 is already applied; 0289 is authored only (0288 reserved). Apply 0289 to sim after dependency verification; run the real migration harness and `scripts/sim/marketing-0289-lock-check-management.mjs` on sim, plus independent-session counter proof. Review ownership/grants and refusal evidence. Draft the [WAF rules](../landing/waf-rules.md); do not enable flags. Record the reviewed revision and rollback revision.
2. **Pete + Juan at the sitting:** verify Meta domain, ad account, Pixel and AEM. With Juan's OK, CC adds bare and www domains to the existing Vercel project. Pete screenshots existing GoDaddy records, then enters only Vercel's exact records and Meta TXT. Preserve MX/TXT for Resend/SPF/DKIM and unrelated records.
3. **CC:** prove TLS for bare/www, www 308 to bare (never staff HTML), bare landing routes and staff isolation. Production identity: landing `https://complimentsonlyoperations.com`, staff `https://co-ops-ashy.vercel.app` (confirm). www is not in LANDING_HOSTS. Landing refuses `/admin/marketing` and `/api/admin/marketing/*`; staff refuses `/api/landing/*` with 404 and sends no Meta requests. Keep existing staff login/reset/portal behavior.
4. **CC:** execute [D4 steps 1–7](../deploy.md#production-identity-and-ordered-activation-d4), each with Juan's OK and redeploy. In order: staff/landing identity after DNS/TLS; D2 burst evidence and CC/Juan D3 attestation then WAF env; 0289 sim→prod then counter and counter_on; matching Pixel IDs with uncached rebuild; v25.0/token pasted by Juan/approved UA; Preview-only test code and CAPI; Production CAPI last and capi_on. Pete checks Preview Deduplicated for all three supported events at step 6. Production has no test code. Complete [all D6 checks](../evidence/landing-waf-attestation-TEMPLATE.md#remaining-d6-launch-evidence), including consent suppression, Production Browser + Server and tested CAPI false/redeploy rollback. Never enrich EMQ with IP/contact data. Separately authorize MARKETING_SCORECARD=1 after 0289 to expose milestone recording; ships OFF.
5. **CC:** activate [monitoring](../monitoring.md) only after reviewed bare-origin baseline, actual merchant/branch inspection, successful US runner proof, received deliberate failure alert and independent stale-heartbeat alarm. Juan pauses spend on broken ordering or a landing 5xx outage over 10 minutes; missing probes are never recovery.
6. **MoO/Owner/CGS:** record planned `first_ad_spend` in ET, with the four prior weeks as baseline. **CC:** create the approved codes through the registry's authorized workflow (role-gated, no raw DB edits). **Juan:** every ad links to `https://complimentsonlyoperations.com/?ad=<code>`. Create each exact code used before publication, including any approved `-a`/`-b` ad variant suffix; preserve the ad-set mapping below. Retired codes are never reused. Do not point ads directly at merchant destinations: landing routes onward and records consenting visitors' taps, not orders.

   | Approved ad-set code | Target | Phase |
   |---|---|---|
   | crave-walk-caphill | Capitol Hill walk | 1 |
   | crave-walk-dupont | Dupont walk | 1 |
   | deliv-zip-caphill | Capitol Hill delivery ZIPs | 1 |
   | deliv-zip-dupont | Dupont delivery ZIPs | 1 |
   | cater-kstreet | K Street / Golden Triangle / Foggy Bottom | 1 |
   | cater-downtown | Downtown / Penn Quarter | 1 |
   | cater-capitol | Capitol complex | 1 |
   | cater-navyyard | Navy Yard / SW federal / Wharf | 1 |
   | cater-noma | NoMa / Union Station | 2 |
   | cater-gtown-rosslyn | Georgetown / Rosslyn | 2 |
   | cater-medcorridor | Hospital / university corridor | 2 |
   | cater-natlanding | National Landing | 3 |

   Each ad set has its own budget. Phase 1: walk 30%, delivery 30%, catering 40%. Add phase 2 clusters next and test National Landing last, per the approved geo plan.

7. **Spend starts only after every launch gate passes. MoO/Owner/CGS:** choose “Lock baseline numbers” for [D−28, D−1]. Verify coverage, unknown labels, large checks, baseline drift and no incomplete-week deltas. An already-started first_ad_spend correction or baseline correction requires Owner/CGS; append a reason, never overwrite history. Enter weekly all-shop Meta spend and per-shop/platform promo spend.
8. **Email send that week:** create the actual `email-MMDD` code before sending; link to the same bare landing with `?ad=email-MMDD`. Record the as-of list size and opted-in count only when CUSTOMER_PROFILES is enabled. Never put recipient details into manual notes or evidence.
9. **Indexing is a separate reviewed change.** Current noindex/empty sitemap remain. SITE_ORIGIN does not enable indexing; review metadata and proxy together before that later change.

Record owner/date/revision/artifact/result for every gate. Blank or failed evidence blocks launch. Do not treat local tests, declared runner counts or env booleans as live acceptance.
