# Meta lead forms → catering portal (builds 1 + 2)

Ships OFF. `META_LEADS_ENABLED=1` (exact) is the only switch that creates anything; every other
value = webhook verify + ledger receipt only. Migration 0300 is an unapplied FILE: sim first (with
the two-session lock proof), prod only on Juan's word, and only then the switch.

## What happens on a submission (the contract)

1. Meta POSTs the `leadgen` notification. The raw bytes are HMAC-verified (`META_LEADS_APP_SECRET`)
   before any parse or database work; the receipt lands in `meta_lead_events` keyed by `leadgen_id`
   (the replay defense: a repeated delivery is refused by the primary key, not by reasoning).
2. The worker (`after()` from the webhook; `/api/cron/meta-leads` every 10 min is the retry
   backstop, NOT in `JOBS_REGISTRY`) claims a 5-minute lease, fetches the lead from Graph
   (`v25.0`, Page token in the Authorization header + `appsecret_proof`), maps the fields, resolves
   the shop by `locations.code`, records explicit consent (checkbox ticked only), resolves the
   customer by the ORDER email, and calls `meta_lead_intake_apply` under the customer intake lock:
   - no open lead → `created` (stage inquiry, source `meta_lead_form`, assignee = the catering
     manager resolver, the Meta profile email as a note when it differs);
   - exactly one open inquiry/quote_sent lead owned by that customer → `attached` (an append-only
     note; no field, stage, assignee or quote change; no email);
   - a confirmed/out lead or several candidates → `needs_human` (`closed_lead` / `ambiguous_leads`).
3. **Build 2 — the ONE continuation email**, only for `created`:
   - `meta_lead_email_claim` (SQL) takes the per-address advisory lock
     (`meta_lead_email:<email_sha256>`) FIRST, then the receipt row, parks the row as
     `needs_human / email_unknown` BEFORE any token is minted or any provider call is made, and
     refuses a second email to the same address inside 24 h (`email_capped`). Two receipts for one
     address therefore serialize their cap check (the offline harness proves it sequentially; **the
     two-session proof is CC's sim step**, with the 0300 lock check). The portal's
     `magic_link_email` rate limit (5 / 15 min) is applied too.
   - The portal's own mint + send (`mintAndSendPortalLink`): a single-use token, **72 h** lifetime,
     "latest link wins" (the customer's older live portal links are retired), the form's language,
     Resend idempotency key `meta-lead-email:<leadgen_id>`, at most **two identical** in-process
     tries (the second only after a timeout / network / 5xx / concurrent-idempotent outcome).
   - `meta_lead_email_result` records ONE outcome and clears the intake snapshot in the same
     write as the token id (A9): `sent` (a confirmed provider id — the lead returns to `created`),
     `failed`, `unknown` (the link MAY have landed; the token is kept), `capped`, `suppressed`
     (allowlist / portal identity / sender config off → error `configuration`).
   - **Nothing re-mints or resends automatically.** See "Email states" below.
4. The customer taps the link → `/order/verify` (Spanish copy for a Spanish form) → the token is
   consumed once → `createDraftFromIntake` with the token's `pipelineId` → `portal_intake_attach`
   (same customer lock) attaches ONLY a draft quote to that lead when the verified customer owns
   it, it is still inquiry/quote_sent and has no live quote; otherwise it writes nothing and
   today's portal path runs unchanged (a new portal lead). The build page opens on that draft.
   **The plain portal path (no pipelineId) is byte-identical to before build 2** — the same three
   JS inserts, same audit row, no lock, no new refusal (pinned by a comparative test).

### Double capture (Juan's ruling, 2026-11-11)

- The form has an OPTIONAL question "Work email for this order (if different)" (key `work_email`).
  Present and valid → it is the **order email**: the `catering_customers` identity, the portal
  account, the continuation email, quotes/updates, and the company match by domain.
- The Meta pre-filled email is the **marketing email**. The opt-in checkbox applies ONLY to it and
  is recorded at submission (`customer_consent_record_explicit`, evidence `<leadgen_id>:email_marketing_opt_in`,
  text version `meta-email-marketing-v3`). The work email is never passed to the consent writer.
- Same address in both (case-insensitive) → one address. The pipeline lead stores the Meta email
  only as a note ("Secondary email (Meta profile): …"), never as an identity.
- An invalid work email is kept as typed in the notes ("Work email (as typed): …") and the Meta
  email is the order email — tolerant like every optional field.

### The live form and its mapping (meta-leads-v3, 2026-11-11)

**Form "Catering Inquiry - EN", id `2514347029057258`** (the first Testing Tool lead was refused
`invalid_payload` under v2 — the answers are Meta option LABELS, not codes). Raw `field_data` keys,
exactly: `fulfillment_method, preferred_shop, headcount, seconds, extras, event_date, notes, email,
phone_number, full_name, work_email, work_phone_number, company_name, job_title`. Consent arrives in
`custom_disclaimer_responses` (unchanged). `mapping_version` = `meta-leads-v3`.

| Key | Answers (labels) | Mapping |
|---|---|---|
| `fulfillment_method` | Pickup · Delivery | case-insensitive, "pick up" / "pick-up" accepted; anything else = `invalid_payload` |
| `preferred_shop` | Pickup: "Dupont Circle (P Street)" · "Capitol Hill"; Delivery: "Our catering team picks the closest shop" | the TENANT label table (`config/tenant/meta-leads.ts` `shopLabels`: label or raw code → `locations.code`, case-insensitive, whitespace-normalized). The delivery placeholder = NO choice → routing. Pickup + unknown label = `invalid_payload`; delivery + any non-shop value = routing (an unknown label is kept as typed) |
| `headcount` | 10-20 · 21-40 · 41-75 · 76-150 · 150+ | a plain integer is the number; a range label stays NULL + a notes line "Headcount: 21-40" (never an invented number); anything else "Headcount (as typed): …" |
| `seconds` / `extras` | Yes · No / Just the subs · Add sides · Add sides and drinks · The works: sides + drinks + desserts | one notes line "Sizing: seconds yes · add sides and drinks" (yes/y/yeah/sure → yes, no/n/nope → no, else as typed) |
| `event_date` | free text, hint "e.g. Nov 20" | tolerant ET date-only parse: `YYYY-MM-DD`, `M/D`, `M/D/YY(YY)`, "Nov 20", "November 20th", "20 Nov" (en + es month names), optional year; no year → the NEXT occurrence on or after today in America/New_York (today counts); impossible / anything else → null + "Event date (as typed): …" |
| `work_phone_number`, `job_title` | optional prefill | notes lines "Work phone: …" / "Job title: …" — never identity |
| any future key | — | never refuses the lead: appended to the notes as `<key>: <value>` (≤ 20 keys, ≤ 200 chars each); the key still lands in `raw_keys` (keys only, never values) |

**Notes order** (bounded to 4000): the customer's notes → Sizing → Headcount → Routed → extras /
unknown keys → the "(as typed)" fallbacks. The generated lines (Sizing, Headcount, Routed) are
reserved first; the free text is cut into what is left, each cut line ending in "…".

**Delivery routing (Juan's rulings, 2026-11-11)** — a delivery lead with no shop choice gets its
shop in the worker, in this order, and the WHY lands on the lead as a notes line:

1. **History** — a returning customer (the ORDER email in `catering_customers`, in the portal
   resolver's own precedence: the active contact first, else the NEWEST inactive / null-active one —
   read-only, nothing is revived here) or a known company (the customer's `company_id`, else the
   domain auto-attach `catering_company_domains`) → the `location_id` of the MOST RECENT
   `catering_pipeline` lead (`created_at` desc, `location_id not null`; an inactive shop falls
   through). The company's latest lead is ONE database-side row through the FK-named inner embed
   `catering_customers!catering_pipeline_customer_id_fkey!inner(company_id)` — never a client-side
   contact list. Nothing is created before the shop is known. Note: "Routed: last order at <shop name>".
2. **Ad set** — the lead's Graph `adset_id` (a documented Lead-node field, now requested beside
   `ad_id`) through the tenant table `adSetShop` (`config/tenant/meta-leads.ts`; EMPTY until the geo
   ad sets exist — add `"<adset id>": "<locations.code>"` entries there). Note: "Routed: ad set <id>".
3. **Default** — the tenant's `defaultShopCode` (CO: `MEP`, Capitol Hill). Note: "Routed: default
   shop — please confirm (delivery, no shop chosen)". A missing/inactive default = `invalid_location`.

Pickup leads carry no routing line. Keith can move a lead between shops as before (existing feature).
**Both tables — the labels and the ad sets — plus the default shop are tenant DATA in
`config/tenant/meta-leads.ts`, never logic**; a second tenant edits that file only.

### Checkbox copy to paste into the form (TENANT_NAME-based; CO rendering)

- en: `Email me news and offers from Compliments Only at my email above. I can unsubscribe anytime.`
- es: `Quiero recibir novedades y ofertas de Compliments Only en mi correo de arriba. Puedo cancelar la suscripción cuando quiera.`
- Version `meta-email-marketing-v3`. Changing a word = bump `META_CONSENT_TEXT_VERSION`
  (lib/meta-leads/intake-shared.ts) AND the SQL writer's pinned string in 0300, then re-publish.

## Juan's Meta checklist (A12)

Do these in order; the UI labels vary by account, so confirm each screen.

1. **App Mode: Live** (Meta for Developers → the business app → App settings → Basic). Development
   mode delivers test leads only.
2. **A system-user token → Page token.** Business Settings → Users → System users → add/select
   the system user (admin), assign the Page and the app, Generate token with the permissions below;
   then exchange for the Page token (Graph API Explorer → `/me/accounts` with that user token, or
   the Page's access token in Business Settings). This is `META_LEADS_PAGE_TOKEN` — Juan enters it
   in Vercel directly; builders never see it.
3. **Permissions:** `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`,
   `pages_read_engagement` (+ `ads_management` if the Leads setup screen flags it).
4. **Leads Access:** Business Settings → Integrations → Leads Access → the CO Page → CRM tab →
   assign the app (and the system user). Without this the Graph fetch is `graph_auth`.
5. **Webhooks:** App Dashboard → Webhooks → Page → callback
   `https://co-ops-ashy.vercel.app/api/webhooks/meta-leads`, verify token = `META_LEADS_VERIFY_TOKEN`
   (set in Vercel first; the GET verify answers 503 until it is) → Verify and save → subscribe the
   **`leadgen`** field. Then install the app on the Page: `POST /<PAGE_ID>/subscribed_apps` with
   `subscribed_fields=leadgen` (app-level subscription alone is not enough).
6. **Form type: "Higher intent"** (review step before submit) — fewer accidental submissions.
   Questions: name / email / phone (pre-filled), **Work email for this order (if different)**
   (optional, key `work_email`), headcount, event date, shop (required; option LABELS listed in
   `config/tenant/meta-leads.ts` — the placeholder label for delivery), pickup vs delivery (required; "Pickup" / "Delivery"), company,
   notes (optional), and the optional marketing checkbox (key `email_marketing_opt_in`, copy above,
   initially unchecked). One form per language; `META_LEADS_FORMS` lists each
   `{"pageId","formId","language"}`.
7. **Privacy link:** the form's privacy policy URL = the landing privacy page
   (`https://eat.complimentsonlyoperations.com/privacy`). **A11 gate: the lead-form section
   (`landing.privacy.leadform.*`, en + es) and the checkbox copy were APPROVED by Juan on
   2026-11-11**, with one change applied: the deletion line names the catering address, read from
   the tenant config (`cateringContactEmail`, config/tenant/landing.ts — `catering@complimentsonlysubs.com`
   for CO; unset → the sentence without an address). Any further wording change = re-approval.
8. **Lead Ads Testing Tool** (Meta for Developers → Tools → Lead Ads Testing): submit one ticked
   and one unticked example per language. Confirm the webhook receipt, the Graph fetch and the
   ledger row.
9. **Capture the real `field_data` keys** from the test lead: `select raw_keys from meta_lead_events`
   — identity, shop and fulfillment keys must match the live-form list above (a different key for
   those makes the lead `invalid_payload`); any OTHER key rides along as a notes line. Fix the form
   (or the label table) before enabling.
10. **Verify `is_checked`:** the disclaimer response must arrive as `true`, `"1"` or `"true"` only
    when ticked; anything else is unticked. An unticked box creates NO consent event, never an
    opt-out.
11. **Enable:** 0300 on sim (harness + two-session proof) → prod on Juan's word → `META_LEADS_ENABLED=1`
    → `PORTAL_MAGIC_LINK_ALLOWLIST` and the portal identity decide delivery.

## Email states and what a human does

| `state` / `email_state` / `error_code` | Meaning | Action |
|---|---|---|
| created / sent / — | Link delivered (provider id recorded). | None. |
| created / pending / — | Lead created, email never attempted (claim write failed). | Investigate; follow up by hand. |
| needs_human / unknown / email_unknown | Timeout / network / 5xx / concurrent idempotent request; the link MAY have landed. | Check Resend by the idempotency key; follow up by hand. |
| needs_human / failed / email_failed | Provider refused (bad address, quota…). | Follow up by hand from the lead. |
| needs_human / capped / email_capped | A second email to that address inside 24 h, or the 5 / 15 min cap. | The earlier link stands; follow up by hand if needed. |
| needs_human / suppressed / configuration | Allowlist, portal identity or sender config off. | Expected before launch. |
| attached / not_applicable | Attached to an open lead; no email by design. | The assignee follows up. |

**Never resend from code.** Recovery is by hand, and it is honest about what the portal does:

- A customer who lost the email can start again at `/order/start`. That creates a **NEW** portal
  request (a new `portal` lead + draft) — the public parser strips every id on purpose, so a public
  request can never attach itself to the Meta lead. The Meta lead stays in the pipeline as its own row.
- Keith then **merges by hand** in the pipeline: keep the lead that carries the live quote (the
  portal one), copy anything only the Meta lead knows (company text, notes, the Meta profile email
  note, headcount/date as typed) into it, and move the Meta lead to **`lost`** with a note
  "duplicate — continued as portal request <id>" (append-only; nothing is deleted). If the Meta lead
  already has a quote in progress, keep THAT one and mark the new portal lead `lost` the same way.
- Only a token minted by the worker (the continuation email) attaches to the Meta lead, and only
  while that lead is still inquiry/quote_sent with no live quote; after that the attach answers
  `attached=false` and the portal's ordinary create path runs.

## Carried operational items (from the build-1 review)

- **P3-4 token-rotation requeue.** A rotated Page token leaves terminal `graph_auth` /
  `configuration` rows. After the new token is in Vercel, requeue by hand on the sim-proven path:
  `update meta_lead_events set state='retry', attempts=0, error_code=null, next_attempt_at=now(),
  completed_at=null where state='needs_human' and error_code in ('graph_auth','configuration') and
  pipeline_id is null` (service role, after review of the exact ids). Rows that already carry a
  `pipeline_id` are NOT requeued (the lead exists).
- **P3-5 snapshot retention / erase.** The intake snapshot lives only between `created` and the
  email result (A9 clears it in the same write as the token). `needs_human` rows from
  `closed_lead` / `ambiguous_leads` keep their snapshot until a human resolves them: erase with
  `update meta_lead_events set intake_snapshot=null where leadgen_id=$1` once the lead is handled.
  A delete request from a customer: erase every row's snapshot for their email hash
  (`email_sha256 = customer_sha256(lower(email))`), then the 0234 delete-on-request path.
- **P3-6 unverified-email consent.** Per Juan, explicit consent is recorded as submitted even
  though ownership of the Meta email is not verified at submission (the portal verifies the ORDER
  email on the first link tap). Treat the evidence as unverified in any audit; the delete /
  opt-out paths above apply.
