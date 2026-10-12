# Customers v2 — Astra review of CC's plan

Reviewed before implementation against AGENTS.md, 0234's tables, resolver, ingest, merge, erase, grants and list RPC; customer access/extract/identity/stats/loaders; existing migration, access and extract tests; page, ProfileStats and disclosure primitive. No live data or credentials read. This is the requested cross-model plan critique; CC still reviews the resulting implementation before any commit or SQL application.

## Item decisions

| Plan item | Verdict and implementation |
| --- | --- |
| 1 TS relay bases | AGREE. Exact normalized local base, retaining dots; fixture tests for tagged, bare, uppercase and near-match addresses. |
| 1 SQL relay parity | AGREE. Preserve all 0234 branches and immutable/private grant boundary; add the exact base rule. Resolver already lowercases input. |
| 2 named masked extraction | CHANGE. Emit named masked rows; also treat marketplace metadata/channel as masked even when both contacts are absent, and drop phones when the email itself proves a relay. The relay-only case must not turn a relay phone into strong identity. Attribute the known local base to doordash rather than gmail. |
| 2 guest helper and re-capture | CHANGE. Preserve existing ingest branches, resolve suppression first, then reuse the existing order owner under the identity transaction lock. Refuse erased roots; never create replacement guests for an erased order. Helper writes names/profile metadata only, no identifier or consent. Existing orders are uniquely keyed by location/order; names never resolve identity. |
| 3 link table | CHANGE. Match 0234: deny-all RLS plus explicit no-user-delete, revoke every role including service_role, grant SELECT only. Definer writer owns mutations. Require non-null ids/confidence/decision fields. |
| 3 advisory semantics | AGREE. No order reassignment, merge or ranking changes. Count only currently valid live links; erased/merged subjects cannot contribute. |
| 3 scorer | CHANGE. Full first token plus compatible last token; two different full surnames sharing an initial never match. Reject ambiguity across all name-compatible candidates before item evidence can cherry-pick one. Names require at least two tokens, both full names require non-initial surname. Scores are rule strengths, not calibrated identity probabilities; links remain reviewable advisory records. |
| 3 candidates RPC | CHANGE. Return a complete candidate set per guest in a bounded guest page (optional cursor/limit), rather than silently truncating candidate pairs at PostgREST's row cap. Aggregate item quantities before selecting deterministic top five. No contact values in its projection. |
| 3 CLI plan/apply | CHANGE. Explicit flag gate and direct-invocation guard; schema-whitelist decision files and generic error output. Apply revalidates live eligibility under identity lock, is idempotent for identical active decisions, and refuses replacing a different active link. No capture hook or automatic invocation. |
| 4 list aggregate | AGREE. One grouped in-scope order pass, separate pre-aggregated cards/identifiers/consent to avoid fanout. 0234 merge physically reassigns orders/cards/identifiers to the root; no per-order customer_root calls needed. Unknown totals poison both sum and average. |
| 4 sorts and filters | AGREE. Closed SQL whitelist with strict type/range validation; deterministic id tie-break; pure URL parser defaults/clamps malformed values. guests=true includes guests (false excludes), consistent with the specified boolean. |
| 4 summary | AGREE. Same aggregate semantics, scope follows selected authorized shop; reachable omitted from the app DTO below level 9. |
| 4 performance | CHANGE. Avoid per-customer consent helper calls: compute latest completed-import consent set-wise. No new speculative index. The <1 s target and 8 s ceiling require CC's sim EXPLAIN/timing: executing SQL anywhere is prohibited in this task. |
| 4 loaders/authorization | CHANGE. Parse again inside loader so typed callers cannot bypass contact filters. Level 7 forced to membership scope regardless of URL; 8+ may select one shop or all; 9+ alone receives contact booleans. Whitelist DTO fields rather than spread RPC objects. Keep old loader for existing consumers/tests. |
| 4 controls and rows | AGREE. URL-owned controls, named shops, summary links, all sorts/segments/channel/minimums/search, 50 rows, preserved pagination; responsive cards/table and default-collapsed suggestions. Generic marketplace label avoids falsely calling every masked provider DoorDash. |
| 4 i18n | AGREE. en/es together; date/money use shared formatters. |
| 5 data cleanup | AGREE: excluded. No seed, database apply, historical identifier mutation or backlog execution. Existing relay identifiers remain until CC's cleanup. |
| Tests/gates | AGREE. Pure fixtures, fake-client authorization/mapping, SQL contract checks, full npm test, tsc, changed-file lint. SQL text checks do not prove execution or performance. |

## Implementation plan and risks

Touch the above customer modules, add list-params/scorer modules, controls and list page, bilingual keys, the link CLI and 0249 migration, plus focused tests. Read destination files before edits and inspect persisted diffs. Primary regression checks: BC-001/002/004/005 (scope/privacy), BC-006 (pagination), BC-007/037 (identity serialization), BC-031 (normalization), BC-040 (safe refusal). No config/env/node_modules edits; no commit/push/apply. Remaining release gates belong to CC: migration execution/concurrency/performance on sim and independent implementation review.

## Implementation review follow-through

- Re-capture now refuses a resolved identity different from an existing order owner. Raising rolls back resolver writes too; otherwise the old order and newly recorded cards could belong to different people. This deliberately refuses the entire ingest RPC batch for CC to investigate, rather than silently reassigning history.
- SQL and TS use the same conservative name spelling: lowercase, remove dots, collapse whitespace, trim; accents and apostrophes retain their identity. Initial-only first names and conflicting full surnames are refused. Candidate sets remain complete before scoring.
- The decision file permits only ids, safe name keys, reason codes and the specified score. A contact-shaped name skips the whole guest, never only one candidate. Apply validates the entire file before its first write, rechecks live SQL evidence, and accepts identical-link replay without replacing conflicting links.
- List errors return fixed codes rather than database error text. List/summary DTOs omit contact booleans/counts below 9; raw contact columns are never selected. Out-of-range pagination returns the first filtered page instead of a false zero total.
- Shop labels include historical shops; the UI spend input uses dollars while the URL/RPC use cents. Relative dates follow the existing Eastern calendar helper. The original loader remains for profile consumers/tests.

## Verification and handoff

- `npm.cmd test`: full suite passed (460 files; 7,107 passed, one skipped). `.cmd` uses the installed npm executable because PowerShell blocks its `.ps1` wrapper.
- Focused coverage includes 16 parser/loader tests, 8 migration contracts, marketplace scoring/file/replay tests, relay/guest extraction tests, and 9 server-page render tests. Changed TypeScript/TSX ESLint and `git diff --check` pass.
- `npx.cmd tsc --noEmit`: fails on missing `three` declarations (the allowed environmental exception) AND six TS2307 PNG-import errors in unchanged `components/admin/catering/fulfillment/ZoneMap.tsx:24–26` and `components/order/DeliveryRouteMap.tsx:6–8`. The three Leaflet images and Next image declarations exist; the clone's generated `next-env.d.ts` is absent. No config/env file was created to hide this additional blocker. No errors reported in changed files.
- SQL application, execution/concurrency tests, EXPLAIN and the <1 s timing target are unverified: CC must run them on sim. A browser viewport smoke was not performed; server-render tests do not prove 360 px geometry.
- No data cleanup or link backlog run; no database calls by this implementation session. All work is uncommitted on `feat/customers-page-v2`, `C:/Users/conta/co-ops-customers`.

## CC follow-up after the Opus implementation review (2026-10-12)

- P1 reversed: a re-captured order whose contact now resolves to someone else no longer raises. The pinger re-feeds the
  whole business day every tick, so one edited email would have rolled back every 500-row chunk for that shop-day on
  every tick. The order keeps its owner, its facts refresh, no cards attach to either person, and the ingest returns
  `owner_conflicts` (summed into `CustomerCaptureResult.ownerConflicts`, never named).
- P2: list and candidate helpers treat a relay address as no contact (`customer_email_is_relay(i.value)`, evaluated in SQL,
  never projected), so the page is right before cleanup seed 53 runs and the planner cannot pick a relay profile as a
  direct candidate. Prod read-only timing of the list projection: 364 ms all shops; 11,263 people, 25,887 guests.
- P3: the guests chip opens guests only (`only_guests`); "gone quiet"/"new" use the Eastern business date; an
  initial-only link needs two shared top items (TS scorer and SQL revalidation agree).
