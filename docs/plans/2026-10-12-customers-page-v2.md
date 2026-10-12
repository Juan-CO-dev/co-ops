# Customers page v2 — PR 1: relay fix, DoorDash guests, rankings + filters (Juan 2026-10-12)

Juan: "improve the admin/customers page… filter the customers… most visits, most spent, most cards on file, most
catering, etc… and think of further improvements." Design approved by Juan 2026-10-12 ("Yes, go"). PR 2 (profile
page, marketing lists, catering accounts) is a separate plan.

## Ground truth (prod, 2026-10-12, after the 12-month re-pull)

- 37,150 live customers, 46,549 customer_orders, 33 open merge suggestions, 0 consent events.
- 91% came once; 706 have 5+ visits; 31 have 20+; 291 have 5+ visits and nothing in 60 days; 533 ordered at both
  shops; 190 have a catering order; 1,632 have 2+ cards (max 28).
- **Bug:** Toast hands DoorDash orders a relay email `dd.toast.orders+<order id>@gmail.com`. `classifyEmail`
  (lib/customers/identity-shared.ts) and `customer_email_is_relay` (0234) only know marketplace DOMAINS, so the relay
  passes as a real gmail address: 25,887 such identifiers stored; every DoorDash order created a NEW person
  (26,004 third-party-only people for 26,030 orders, 7 repeats); "with email" reads 37,137 when ~11k are real.
  No harm yet (0 opt-ins; the marketing export requires consent), but it must never reach a list.

## 1. Relay fix (TS + SQL, one rule)

- `lib/customers/identity-shared.ts`: add `RELAY_EMAIL_LOCALS` — a local-part BASE (text before `+`, dots kept)
  that marks a relay regardless of domain: `["dd.toast.orders"]`. `classifyEmail` returns `{kind:"masked"}` when the
  base matches. Gmail dot-insensitivity is NOT assumed (exact base only). Tests: the relay with and without `+tag`,
  uppercase, a real `dd.toast.orders.fan@gmail.com` stays ok (base differs), existing cases unchanged.
- Migration `0249_customer_list_v2.sql` (header: `-- AUTHORED 2026-10-12, NOT YET APPLIED -- GATE CC: sim first,
  then prod.`): `create or replace function public.customer_email_is_relay` — every existing branch byte-identical,
  plus `or regexp_replace(split_part(p_email,'@',1),'\+.*$','') = any(array['dd.toast.orders'])`. Keep its existing
  volatility/grants. A pinned test asserts the TS list and the SQL list name the same bases.

## 2. DoorDash guests keep existing, with no fake contact (ingest change)

Today a row with no email and no phone is dropped (`extractCustomerRows` `continue`). With the fix, every DoorDash
order would be dropped and the guests would stop existing. Instead:
- `extractCustomerRows`: a row that is `masked` (marketplace) with no email/phone but WITH a name is emitted
  (`email: null, phone: null, contact_masked: true`). A row with no name and no contact is still skipped. Counters
  unchanged in meaning (`maskedOnly` counts masked rows with no name).
- 0249 `create or replace function public.customer_ingest_orders` — identical except: when `customer_resolve`
  returns null, NOT suppressed, the row is `contact_masked` and has a non-blank `full_name`, then
  (a) if a customer_orders row already exists for (location, order_guid) reuse its customer (`customer_root`) —
  re-captures are idempotent; else (b) create a name-only "marketplace guest" via a new helper
  `customer_marketplace_guest(p_full_name, p_first, p_last, p_location_id, p_seen_at, p_source, p_masked_channel)`
  (same insert shape as `customer_resolve`'s create branch, takes `customer_identity_lock()`, never writes an
  identifier, never files consent). Counts as created/linked. Grants: same as the 0234 writers (service_role only).
- No email/phone ever stored for a guest. Two guests with the same name are NOT joined by ingest (names are not
  identity); linking is §3.

## 3. Probable links (soft, reversible — never a merge)

- 0249 table `customer_probable_links(guest_id uuid references customers, customer_id uuid references customers,
  confidence numeric(3,2) check 0..1, reasons text[] not null, decided_by text check in ('rule','review'),
  created_at timestamptz default now(), revoked_at timestamptz, revoked_by uuid references users,
  id uuid primary key default gen_random_uuid())` plus a partial unique index on (guest_id) where revoked_at is
  null (one active link per guest), and check guest_id <> customer_id. RLS on, no policies (service-role reads, like the other customer tables). Add to the 0234
  table-list test(s) that pin RLS/grants.
- A link never changes either profile's visits/spend/rankings (the list ranks the direct customer on its OWN orders).
  The list shows it only as a count (§4 summary) in PR 1; the profile badge is PR 2.
- Pure scorer `lib/customers/marketplace-link-shared.ts` `marketplaceLinkVerdict({ guest, candidates })`:
  guest = { nameKey, locationId, items[], dates[] }; candidates = direct (non-guest) customers at the SAME shop whose
  first token equals the guest's first token AND whose last-name initial equals the guest's last initial (or full last
  names equal when both are full). Returns a link only when EXACTLY ONE candidate qualifies AND at least one of:
  (a) full name_key equal (both full names), or (b) item overlap — the guest ordered ≥1 item that is among the
  candidate's top 5 items by qty. Confidence: 0.9 for (a)+(b), 0.8 for (a) alone, 0.7 for (b) alone. Reasons are
  codes (`same_name`, `same_initial`, `same_shop`, `shared_items`), never free text. Multiple candidates → no link.
  Tests cover each branch + ambiguity + cross-shop never links.
- Script `scripts/link-marketplace-guests.ts` (CC runs it; flag-gated `CUSTOMER_PROFILES=1`): `plan` mode reads
  candidates via a new read RPC `customer_marketplace_candidates(p_location_id)` (returns guest id, guest name_key,
  candidate id, candidate name_key, items as jsonb — no contact columns), runs the scorer, writes a JSONL decisions
  file (ids, name_keys, reasons, confidence; NO email/phone) to a path given by `--out`. `apply --in <file>` inserts
  links via `customer_probable_link_upsert(p_guest_id, p_customer_id, p_confidence, p_reasons, p_decided_by)`
  (service_role) and is idempotent. No auto-run in capture in PR 1 (CC runs the backlog after review; ongoing
  linking is a follow-up once the rule has a review record).

## 4. List page: summary, sort, filters (app/admin/customers/page.tsx)

- New read RPC in 0249 `customer_list_page(p_location_ids uuid[], p_search text, p_sort text, p_filters jsonb,
  p_limit int, p_offset int)` (security definer, stable, service_role execute only like `customer_profile_page`).
  Aggregates per live root customer over IN-SCOPE orders only (p_location_ids null = all shops):
  visits, spend_cents (NULL when any in-scope order total is null — never reads as $0), avg_order_cents (null with
  spend), first_order, last_order, shops (distinct locations), catering_orders (source_kind <> 'toast' or channel =
  'catering'), cards (count of customer_cards), channel set, is_guest (no identifier AND every order contact_masked),
  has_email, has_phone (booleans only — never values), opted_in (any `customer_consent_current` opted_in row),
  total_rows (window count). Ties always broken by customer id.
- `p_sort` whitelist: `recent` (default; last_order desc), `visits`, `spend` (nulls last), `avg_order` (nulls last),
  `cards`, `catering`, `newest` (first_order desc), `quiet` (last_order asc among visits ≥ 2). Unknown → error.
- `p_filters` keys (all optional, validated, unknown key → error): `segment` one of `regulars` (visits ≥ 5),
  `lapsed` (visits ≥ 5 and last_order < current_date − 60), `one_time` (visits = 1), `new` (first_order ≥
  current_date − 30), `both_shops` (shops ≥ 2), `catering` (catering_orders ≥ 1); `channel` one of in_store
  (dine_in/takeout), online, app, delivery, catering; `min_visits` int 1..1000; `min_spend_cents` int ≥ 0;
  `guests` boolean (default false = exclude is_guest); `reachable` boolean and `opted_in` boolean — the app passes
  these two ONLY for level ≥ CUSTOMER_CONTACT_MIN (server-enforced in lib, not just hidden in UI).
- `customer_list_summary(p_location_ids uuid[])` → people (non-guest), reachable (non-guest with an email or phone
  identifier), regulars, lapsed, both_shops, catering, guests, guests_linked (active probable links). One call.
- Performance budget: both RPCs < 1 s on prod for all shops (46k orders). Use one aggregate CTE over customer_orders
  joined once to customers/cards counts; add an index only if EXPLAIN on sim shows the need. PostgREST 8 s cap.
- `lib/customers/customers.ts`: `loadCustomerList(viewer, params)` replaces `loadProfilePage` for the page (keep
  `loadProfilePage` exported until nothing uses it, or remove it with its tests if unused). Parses/validates
  searchParams in a pure `lib/customers/list-params-shared.ts` (`parseListParams(searchParams, level)` → typed params;
  drops `reachable`/`opted_in` below level 9; clamps; unknown values → defaults, never throw on bad URLs).
  `loadCustomerSummary(viewer)`.
- UI (server component + small client form `components/admin/customers/CustomerListControls.tsx`):
  - Summary strip of tappable stat chips (people, reachable [level 9+ only], regulars, gone quiet, both shops,
    catering, "DoorDash guests: N · L linked"); tapping a chip applies its filter (guests chip sets `guests=1`).
  - Sort select + segment chips + shop select (level 8+: each shop; level 7: own shop fixed) + channel select +
    min visits / min spend inputs + search; all in the URL (shareable, back-button safe); "Clear" link.
  - Rows: name (or "DoorDash guest" + name for guests), visits, spend (or "—" with the existing unknown-spend copy),
    avg order, last order (relative + date), cards, catering orders, shop chip(s). Desktop: table; phone: stacked
    cards (no horizontal page scroll at 360 px). Each row links to `/admin/customers/[id]` as today.
  - Keep `CustomerSuggestions` but move it below the list under a collapsed "Likely same person (N)" disclosure.
  - Page size 50; pagination preserves all params.
- i18n: every new string in en.json + es.json (`customers.list.*`, `customers.sort.*`, `customers.filter.*`,
  `customers.summary.*`). Names of shops by NAME. No contact values anywhere on this page (unchanged rule).

## 5. Cleanup data (CC, after merge — NOT in this PR's code)

Seed 53 (CC writes, prod-gated; seed 52 = the 33 merge-suggestion decisions): delete the relay identifiers (`customer_email_is_relay(value)` true after 0249) with
one aggregate `audit_log` row (`customer_identifier.delete`, count, actor_context seed_53, destructive true); mark
those customers' masked_channels include `doordash`. Then the linking backlog: plan → CC review → Astra review →
Aggie tiebreak on disagreements → apply.

## Tests

Pure: classifyEmail relay cases; TS/SQL relay list parity; extractCustomerRows guest emission; scorer branches;
parseListParams (whitelists, level gating, clamps, bad input). Migration text tests (0249 header gate line,
grants/revokes restated, RLS on the new table, relay function keeps every 0234 branch). Loader tests with a fake
client: summary + list mapping, level-7 shop scope forced, reachable/opted_in dropped below 9. Page render test if
the repo has the pattern for admin pages.

## Gates

`npm test`, `npx tsc --noEmit` (the local `three` missing-module error is environmental), lint. Do NOT apply SQL
anywhere; CC applies 0249 sim → prod.
