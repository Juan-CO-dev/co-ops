# Meta lead intake (build 1)

Ships OFF. Migration 0300 is an unapplied file; no database apply is authorized by this build.

Before enabling:

1. Run the offline 0300 harness, then arrange the separate two-session sim proof and prerequisite schema check through CC. The preflight accepts only the 0275 four-job lease or the 0298/0300 six-job union and refuses drift in the 0234 source constraints and missing helpers/columns.
2. Configure the pinned form/question mapping and tenant-specific English/Spanish consent text from `META_CONSENT_COPY`. The text version is `meta-email-marketing-v2`; update both the application constant and SQL writer when the copy changes (including tenant copy), and publish the matching form text.
3. Verify with Meta's Lead Ads Testing Tool before enabling: submit checked and unchecked examples and confirm the pinned `email_marketing_opt_in` disclaimer arrives as `true`, `"1"`, or `"true"` only when checked. Other values must not authorize marketing. Confirm identity, shop and fulfillment mappings and optional free-text recovery.
4. Verify duplicate delivery and retry behavior in sim. Consent effective time comes from the immutable receipt, not a later Graph response. Inspect the closed error codes and manager assignment before enabling `META_LEADS_ENABLED=1`.

Carried to build 2 / operational follow-up:

- P3-4: token-rotation requeue for terminal configuration/auth failures; no automatic backfill in build 1.
- P3-5: snapshot retention/erase workflow; build 2 must atomically clear the snapshot when issuing a portal token and take the same `catering_customer_intake:` advisory lock.
- P3-6: UNVERIFIED EMAIL CONSENT flag: per Juan, record explicit consent as submitted even though ownership of the supplied email has not been verified. Treat that evidence as unverified; build 1 does not issue an email-verification claim.
