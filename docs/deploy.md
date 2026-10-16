# Landing activation notes - r5

Preparation only. No resources, DNS, deployment, env change or production migration is authorized by this document. CC/Juan own activation; E3-E5 release evidence remains outstanding.

- Verify actual Vercel Host/X-Forwarded-Host agreement before landing activation. Invalid or disagreeing authorities select STAFF with landing/tracking dormant and a PII-free warning. Staff routes serve normally; valid landing hosts still refuse staff routes. Do not log host/header values or request identifiers.
- Verify landing HTML/RSC is Cache-Control: private, no-store and content differs from staff root. Vercel CDN keys by host; no Vary: Host patch. Preserve Next stock same-host slash canonicalization and test canonical follow-ups.
- Keep LANDING_CAPI_ENABLED, LANDING_COUNTER_ENABLED and LANDING_META_UA_APPROVED false until their independent approvals. WAF attestation uses LANDING_WAF_STATE, LANDING_WAF_VERIFIED_AT and LANDING_WAF_RULE_IDS; validate actual rule scope/entitlement/bursts rather than trusting env as proof.
- META_GRAPH_API_VERSION is code-pinned to v25.0. Changing versions requires reviewed code plus env changes and provider verification.
- Apply 0273 only through CC/Juan's authorized migration process after review; prove independent-session increments before enabling the counter. Enabling LANDING_COUNTER_ENABLED first yields 503 on eligible click-counter requests. Native navigation never waits for that request.
- Landing metadata has its own bilingual title/description/og:description, metadataBase and canonical from approved SITE_ORIGIN. Preview remains noindex. Final OG assets, public HTTPS/canonical smoke, merchant flow, consented real Meta performance and activation evidence remain later gates.

## Required real-iPhone Safari preview check

Before acceptance, open the allowlisted preview on a real iPhone in Safari. Confirm the real hero poster shows immediately, trigger the hero and confirm it plays, and watch the full loop with no black box. Check pause/resume and the reduced-motion poster fallback. Record device, iOS/Safari version, preview revision, date and result. Playwright WebKit on non-Darwin platforms cannot certify H.264 decoding: its six decode/playback checks are skipped there; poster, fallback, no-JS and reduced-motion checks still run. Chromium supplies the local decoder proof.
