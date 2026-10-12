# Customers v2 — PR 2: profile page, opted-in marketing lists, catering accounts (Juan 2026-10-12)

Design approved by Juan 2026-10-12 ("Yes, go"; PR 2 go: "Do it"). PR 1 (#454, 0249) is live: list rankings and
filters, DoorDash relay fix, marketplace guests, 197 advisory guest→customer links (`customer_probable_links`).

## Ground truth (prod, 2026-10-12)

- 11,239 people, 25,887 DoorDash guests, 197 active probable links. Max orders for one person: 58, so loading one
  person's full order history in TS is cheap.
- 0 consent rows opted in (the Toast marketing list has not been imported yet), so every marketing list is empty
  today. The UI must say so plainly instead of offering an empty download as if something were wrong.
- 271 catering orders (`source_kind <> 'toast' or channel = 'catering'`), all of them Toast catering-channel orders
  today (0 catering-desk, 0 ezCater links). The catering view must still handle all three sources.
- Merges move orders, identifiers and cards to the kept person and set `merged_into` to the kept person in one
  hop (0234 `customer_merge` re-points earlier members), so a live root id owns every order.

## Rules that do not change

- No email or phone value ever reaches a page, a client component, a log or an audit row. The list page and the
  profile page stay stats-only. Only the existing level-9 reveal panel shows contact data.
- Level gates: CUSTOMER_STATS_MIN 7 (own shops only), CUSTOMER_ALL_SHOPS_MIN 8, CUSTOMER_CONTACT_MIN 9.
  Every new loader authorises before any I/O, as `lib/customers/customers.ts` does today.
- Marketing data is used ONLY for people who opted in, with no override (exports-core.ts header). Meta stays OFF
  (`META_AUDIENCE_EXPORT` unset). Nothing is uploaded or emailed: downloads only.
- Unknown money never reads as $0 (null when any in-scope order total is null).
- Shops by NAME. Every new string in en.json AND es.json.
- An advisory link never changes visits, spend or rankings for either person.

## 1. Profile page (`app/admin/customers/[id]/page.tsx`)

Loader `loadProfileDetail(viewer, customerId, { page })` in `lib/customers/customers.ts` (keep `loadProfile`, which
other code uses, or make it a thin wrapper). Same auth order as `loadProfile`: enabled → stats level → uuid →
`assertInScope` → reads. It reads the person's orders once (scoped to the viewer's shops), selecting
`customer_id,business_date,channel,total_cents,items,location_id,source_kind`, and the shop names.

Pure module `lib/customers/profile-detail-shared.ts` (client-safe, no I/O), all from the scoped order rows:
- `monthlyVisits(orders, todayEt, months = 12)` → the last 12 calendar months ending with today's ET month, oldest
  first, each `{ month: "YYYY-MM", visits, spendCents | null }` (null when any order that month has a null total).
  Months with no orders are present with 0 visits and 0 spend.
- `shopSplit(orders)` → `{ locationId, visits, spendCents | null, lastOrder }[]`, most visits first, ties by id.
- `orderHistory(orders, page, pageSize = 25)` → newest first (business_date desc, then a stable tiebreak), each
  `{ date, locationId, channel, source: "toast" | "catering" | "ezcater", totalCents | null, items: first 3 item
  names by qty, moreItems: count of the rest }`, plus `{ total, page, pages }`. Page clamped to 1..pages.
- `cateringSummary(orders)` → `{ orders, spendCents | null, lastOrder }` over catering orders (same definition as
  the list: source_kind <> 'toast' OR channel = 'catering'), or null when there are none.
- Favourites: top 5 (the list keeps 3; `profileStats(orders, 5)`).

Advisory links, read through the service client from `customer_probable_links` where `revoked_at is null`:
- When the person IS a guest with an active link: show "Probably the same person as <name>" with a link to that
  profile, the confidence as a percentage and the reason codes translated (`customers.link.reason.<code>`). Follow
  `merged_into` one hop to the live root; drop the link if either side is erased. Level 7 sees the target's name
  and link only when the target is in their shop scope; otherwise "a customer at another shop" with no link.
- When the person HAS linked guests (links whose `customer_id` is the person or any member merged into them):
  a "Probably also orders on DoorDash" section with the guest count, their order count, dates and spend (scoped
  to the viewer's shops), each guest linked to its own profile, and the plain note that these orders are NOT
  counted in the stats above.
- Level 9+: each link row has a "Not the same person" button that revokes it (see §4). Level 7/8 see no button.

Page layout (server component, phone first, no horizontal scroll at 360 px):
1. Back link. Header: name (or "DoorDash guest · <name>"), marketing status chip (existing), masked channels note.
2. Stat grid: visits, spend, average order, first order, last order (days ago + date), how often, cards, shops.
3. "Visits by month": 12 CSS bars (no chart library) with the month label and visit count under each, plus an
   accessible text equivalent (a visually hidden list, or `aria-label` on each bar giving month + visits + spend).
4. "By shop": one row per shop (name, visits, spend, last order). Hidden when the person has one shop.
5. Favourites (top 5) and channel mix (existing).
6. Catering card when `cateringSummary` is non-null: orders, spend, last catering order, and a link to
   `/admin/customers/catering`.
7. Links section(s) from above.
8. "Order history": a table on `lg`, stacked cards below it, 25 per page, `?page=` in the URL (pagination keeps
   the path). Each row: date, shop name, channel (existing `customers.channel.*` keys), source when not Toast,
   total (or "—" with the unknown copy), items "Sub ×2 · Chips +3 more".
9. Level 9+: the existing `CustomerContactPanel`, unchanged, at the end.

## 2. Opted-in marketing list for the current view (level 9+)

On the list page, level 9+ only: a "Download opted-in list for this view" control under the filters. It sends the
CURRENT list params (the parsed `CustomerListParams`, not raw searchParams) to the existing export route.
- `app/api/admin/customers/export/route.ts`: accept `{ kind: "marketing_segment", params: <object> }` in addition
  to the two existing kinds (`params` allowed ONLY with that kind; any other key → 400). The route reparses
  `params` through `parseListParams(params, ctx.level)` (it already drops level-gated keys and clamps), so the
  client cannot widen anything. Step-up B, as today.
- `exportCustomers(actor, "marketing_segment", meta, deps, params)`:
  1. Level 9 gate and refusal audit, exactly like the existing kinds.
  2. `marketingRows(sb, "email")` (the existing opted-in-only SQL read). If it is empty, return the header-only
     CSV with count 0 (no list query at all).
  3. Otherwise collect the ids of the people in the view by paging `customer_list_page` (page size 200, the RPC's
     cap) with the parsed filters PLUS `opted_in: true` forced on, so the paging only walks opted-in people.
     Guests are never included (they have no identifiers; also keep `guests`/`only_guests` false in this call).
  4. Keep only the marketing rows whose `customer_id` is in that set, then `marketingCsv(...)` (which applies
     `optedInOnly` again). The pure intersection is `segmentMarketingRows(rows, ids)` in `exports-core.ts`.
  5. Audit `customer.export_marketing_segment` with `{ kind, rows, filters: <the parsed filters and sort, the
     shop id>, searchLength }`. Never the search text, never any value.
  6. Filename `marketing-opted-in-view-YYYY-MM-DD.csv`.
- UI: a small client component `components/admin/customers/MarketingListButton.tsx`, reusing the step-up and
  download pattern from `ConsentTools.onExport` (factor the shared download helper into one place if it stays
  small; do not duplicate the step-up retry loop twice). Copy under the button: "Only people who opted in to
  email are included." When the summary shows 0 opted in, the button is disabled and reads "No one has opted in
  yet: the list fills after the Toast marketing list is imported (Consent page)". Get that number from a new
  `optedIn` field on the summary, filled by the existing `customer_consent_current` count (level 9+ only), not
  from a new SQL function.
- The Meta export stays exactly as it is (OFF). No segment variant of the Meta file.

## 3. Catering accounts (`app/admin/customers/catering/page.tsx`)

Level 7+, shop-scoped exactly like the list (level 7 = own shops; level 8+ = all or one chosen shop). No new SQL:
- Loader `loadCateringAccounts(viewer, raw)`: select the catering orders (`or('source_kind.neq.toast,channel.eq.catering')`)
  scoped to the shops, with `customer_id,business_date,total_cents,location_id,source_kind`, via `selectAllRows`.
  Then the people (`id,full_name,merged_into,erased_at`) for those ids; drop merged and erased people (orders
  live on roots, so there is no re-pointing to do). Then the in-scope total visit count per account (one
  `customer_orders` count per account is too many calls: select `customer_id` for those ids, scoped, and count in
  TS; ≤ 200 accounts today).
- Pure `lib/customers/catering-accounts-shared.ts`:
  `cateringAccounts(orders, people, visitsById, todayEt)` → rows `{ id, name, orders, spendCents | null,
  avgOrderCents | null, firstOrder, lastOrder, sources: ("toast" | "catering" | "ezcater")[], shops: string[],
  allVisits, quiet }` where `quiet` = at least 2 catering orders AND the last catering order is more than 90 days
  before today (ET). Plus `cateringSummary`-style totals: accounts, repeat accounts (≥ 2 orders), gone quiet, and
  catering spend over the last 365 days (null-honest).
  `sortCateringAccounts(rows, sort)` with the whitelist `spend` (default, nulls last), `orders`, `recent`
  (last order desc), `quiet` (last order asc, quiet rows only). Ties broken by id.
- Params: a small pure parser beside it (`sort`, `quiet=1`, `location` for level 8+, `page`), unknown values →
  defaults, never throws.
- Page: summary chips (accounts, repeat, gone quiet → applies `quiet=1`, 12-month catering spend), sort select,
  shop select (8+), the rows as table/cards like the list page (name → profile, catering orders, catering spend,
  average, last catering order as days ago + date, all visits, sources, shops). 50 per page.
- Entry points: a "Catering accounts" pill in the list page header (all levels 7+), and the profile catering card.

## 4. Revoking an advisory link (level 9+) — migration 0250

`supabase/migrations/0250_customer_link_revoke.sql`, header line 2:
`-- AUTHORED 2026-10-12, NOT YET APPLIED -- GATE CC: sim first, then prod.` (CC applies it; do not apply SQL).
- `public.customer_probable_link_revoke(p_link_id uuid, p_actor_id uuid) returns jsonb`, plpgsql, security
  definer, `set search_path = pg_catalog, public`. Takes `customer_identity_lock()`. Locks the row for update.
  Missing → raise `customer_probable_link_not_found`. Already revoked → return `{ "revoked": false }`
  (idempotent). Otherwise set `revoked_at = now(), revoked_by = p_actor_id` and return
  `{ "revoked": true, "guest_id", "customer_id" }`. Touches nothing else (no customers, orders or merges).
- `revoke all ... from public, anon, authenticated;` then `grant execute ... to service_role;` like 0249.
- Wire it: `revokeProbableLink(actor, linkId, meta)` (level 9, uuid check, rpc, audit
  `customer.probable_link_revoke` with the link id, guest id and customer id only), the `known` error list gets
  `customer_probable_link_not_found`, and the existing operation-style route `app/api/admin/customers/route.ts`
  gets an operation for it (step-up A, the same tier as dismissing a merge suggestion). The button is a small
  client component that refreshes the page after success.
- A revoked guest is no longer counted in `guests_linked` (0249's summary already filters `revoked_at is null`).

## Tests

- Pure: `monthlyVisits` (12 months, month boundaries in ET, an empty month, a null total makes that month's
  spend null), `shopSplit`, `orderHistory` (ordering, paging clamp, items "+N more"), profile `cateringSummary`,
  `cateringAccounts` + sort + `quiet` (89 vs 91 days), `segmentMarketingRows`, the catering params parser.
- Loader tests with the fake client (the pattern in `tests/customer-list.test.ts`): `loadProfileDetail` level 7
  out of scope → 403 before order reads; the link target out of scope shows no link; links to an erased person are
  dropped; `loadCateringAccounts` drops merged/erased people and scopes level 7.
- Export: `marketing_segment` refused below level 9 (audited); empty consent → header-only file and NO
  `customer_list_page` call; the paging forces `opted_in: true`; a person who matches the view but did not opt in
  never appears; the route rejects `params` on the other two kinds and rejects unknown keys.
- Revoke: the 0250 text test (gate line, definer, search_path, identity lock, grants), the loader's level gate
  and audit row content (no names, no values).
- A page-render or static UI test where the repo already has one (`tests/customers-list-page-ui.test.ts`) for the
  new pill and the level-9-only marketing button.
- i18n: every new key in en.json and es.json (the existing parity test must pass).

## Gates

`npm test`, `npx tsc --noEmit` (the local `three` missing-module error is environmental), `npm run lint`.
Do NOT apply SQL anywhere; CC applies 0250 sim → prod.
