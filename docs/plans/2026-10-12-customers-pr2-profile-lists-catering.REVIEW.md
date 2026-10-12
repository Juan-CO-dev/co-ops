# Customers PR 2 — Astra review of CC's plan

Reviewed before implementation, 2026-10-12, on `feat/customers-pr2`. References: customer loaders, shared stats/access/list/export modules, customer pages/components/routes, 0234 identity/order/consent/merge/export bodies, 0249 list/link schema and grants, existing customer tests, disclosure doctrine, local Next page/route guides. No production reads or SQL execution.

| Plan item | Verdict and implementation decision |
| --- | --- |
| 1: authorized detail loader | AGREE: feature, level, UUID and scope gates precede detail reads; read scoped orders once. Preserve `loadProfile` compatibility. CHANGE: select order `id` for stable ties and `contact_masked` for guest classification; read identifier kinds only, never values. Missing, erased and merged-away profile IDs return 404. |
| Monthly visits | AGREE: 12 calendar buckets ending in ET's current month; empty months zero, any unknown total makes a nonempty month's spend unknown. |
| Shop split | AGREE: visits descending, ID ties, scoped dates and null-honest money. |
| Order history | CHANGE: use the persisted order UUID as the same-day tiebreak. Project only date/shop/channel/source/money and first three item names/quantities; clamp pages. |
| Catering summary and favourites | AGREE: non-Toast OR catering channel, top five favourites, never combine advisory orders with root statistics. |
| Outgoing advisory links | AGREE: follow one merge hop, reject erased endpoints. CHANGE: scope the resolved target before projecting any identity; the other-shop placeholder carries no target ID/name. Suppress self-links after merges. |
| Incoming guest links | CHANGE: apply the same scope protection to guests; omit inaccessible guests and count only visible ones. Read links to root plus merged members, resolve endpoints and exclude erased/self links. This closes the reverse-direction leak not explicitly covered in the plan. |
| Profile layout | AGREE: phone cards, desktop fixed-layout table, 12 CSS bars and accessible equivalent, shop names, unknown money, five favourites, catering entry point, existing reveal unchanged. Secondary link/history sections use counted disclosures per D3/D5. |
| 2: segment route | CHANGE: parsed params have nested `filters`, `search`, `locationId`; `parseListParams` consumes flat URL fields. Validate/convert the parsed wire shape, then call `parseListParams` with the session level. Reject unknown payload/params/filter keys; params only for segment. |
| Segment export | AGREE: level-9 refusal audit, existing email consent RPC first, no list query on empty consent, page size 200, force opted-in and exclude guests, intersect and filter consent again. CHANGE: an explicitly opted-out or guest-only view returns zero rather than replacing its restriction with a wider view. |
| Export audit and filename | AGREE: closed action registry, parsed filter/sort/shop metadata and search length only, ET filename date. No search text, names, contacts, or database error details in logs. |
| Download control and summary | AGREE: shared Tier-B download/retry helper, level-9-only control, global email-opt-in count from the existing view, clear disabled/import state. The global count describes whether any import exists, not matches in the current view. Meta unchanged. |
| 3: catering loader | AGREE: authorize before I/O, scope orders and total visits, drop erased/merged people. CHANGE: chunk account IDs in bounded groups and page each read, avoiding both PostgREST row caps and request-line limits. |
| Catering math/sort/parser | AGREE: null-honest sums/averages, distinct shops/sources, repeat >=2, quiet strictly >90 ET calendar days, spend over a 365-day window ending today, stable ID ties and nulls last. Quiet sort restricts to quiet accounts. |
| Catering page/entry points | AGREE: 50 rows, shop/sort/quiet filters retained in pagination, summary chips, cards below lg, table on lg, en/es throughout. |
| 4: revoke SQL | AGREE: exact line-2 gate, identity lock then row lock, not-found exception, idempotent false, update only link revocation fields, explicit revoke/grant matching 0249. SQL remains unapplied. |
| Revoke lib/route/button | AGREE: level 9 before I/O, UUID validation, Tier A, closed audit action, changed link audit contains IDs only, refresh on success. Replayed revocation does not fabricate a second mutation audit. |
| Tests | AGREE: pure date/money/paging/sort/intersection cases, fake-client scope/privacy cases, real route validation and export guards, SQL text contract, page-render controls and translation parity. CHANGE: replace the old export-signature text assertion (which prohibited all filters) with opted-in enforcement tests for the new narrowing-only segment contract. |
| Gates | AGREE: full npm test, tsc, changed-file lint. No commits, pushes, SQL application, environment/config edits or node_modules mutation. |

Implementation touches the two pure modules; customer server boundary and export core/parameter adapter; profile/list/catering pages and small client controls; en/es keys; audit registries; migration 0250; regression tests. Main risks are scope leaks at graph edges, consent widening, error-message PII, pagination truncation and calendar boundaries. Catalog applied: BC-001–010, BC-011–019, BC-022–025, BC-027, BC-030–034, BC-036–043, BC-048/051. Geometry, transport and unrelated auth classes are not applicable. CC's independent final diff review remains required before any merge; this task leaves an uncommitted implementation.

## Verification after implementation

- `npm.cmd test`: 466 files passed; 7,162 tests passed, 1 skipped. Initial run found the two new client step-up sites missing from the pinned tier map; registered revoke A and shared download B, then reran the full suite successfully.
- `npx.cmd tsc --noEmit --incremental false`: only the allowed pre-existing missing `three` module and Leaflet PNG declarations in unchanged Floor3D, ZoneMap and DeliveryRouteMap files. No other errors.
- `npx.cmd eslint -- <changed TS/TSX files>`: passed without warnings; final touched list/map tests checked again. `git diff --check`: passed.
- Chromium at 360px with actual compiled `app/globals.css`, synthetic long names/items, en/es, expanded disclosures: all six profile/list/catering cases measured document scrollWidth 360 and zero overflowing elements. The first pass reproduced list-name overflow; fixed both name anchors with explicit anywhere wrapping and reran successfully. Temporary smoke files removed.
- New suites: customer-profile-detail-shared, customer-catering-accounts, customer-pr2-loaders, customer-pr2-routes, customer-profile-page-ui, customer-catering-page-ui. Existing export/list/list-UI/tier-map tests extended. Scope failure tests assert database messages never escape; merged guest headings count distinct roots while retaining independent revoke controls.
- SQL 0250 was text-checked only, never applied. No real customer data, authenticated database integration, env/config edits, commits, pushes or merges. Node modules junction untouched by implementation. Branch `feat/customers-pr2`, clone `C:/Users/conta/co-ops-customers`.

## CC follow-up (after the Opus review)

The Opus review (privacy, consent, scope, correctness, UI) found no privacy, consent or scope defect. Fixed:
- A revoked link could come back: `link-marketplace-guests plan` re-proposed the pair and the 0249 upsert only
  looked for ACTIVE rows. 0250 now adds a BEFORE INSERT trigger that refuses a pair with a revoked row
  (`customer_probable_link_revoked`; private, no grants), and `plan` reads the revoked pairs and never proposes
  them. Tests: the planner skip, and the 0250 text contract.
- Month bars: the aria-label read as a single day and the caption was a bare month number. Both now use the
  existing month formatters (`formatMonthLabel`, `formatTrendMonthLabels`, which adds the year across a year).
- Profile dates had no year across a multi-year history: new `formatDateLabelWithYear` in lib/i18n/format.ts,
  used by the profile and catering display helper.
Not changed: 0250 uses `create function` (matches 0249; the file is transactional and stamped once applied).
