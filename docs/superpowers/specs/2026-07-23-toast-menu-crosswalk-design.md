# Toast Spec #1 — Menu Crosswalk + Drift (design)

**Date:** 2026-07-23 · **Approved:** Juan (design presented + "looks right", run on auto; merge + prod migration reserved for his review)
**Grounding:** Toast landscape council 2026-07-23 (`~/.claude/council/2026-07-23-toast-pos/report.md`) — read-first sequencing, 7/7; crosswalk as the foundational artifact, 6 seats. This is sub-project 1 of the read track; sales-ingest (spec #2) and variance (spec #3) build on it. The write track (LTO push) stays a rep conversation; `lib/catering/lto-pos-push.ts` is untouched.

## Purpose

Establish the curated, per-location `(CO-OPS entity) → (Toast menu item GUID)` crosswalk and an advisory drift report, so that (a) sales ingest has a mapping to deplete through, and (b) menu divergence between CO-OPS and Toast is visible instead of silent. **Toast remains menu source-of-truth; CO-OPS never auto-mutates either system.** Everything ships dormant-until-credentials via fixture mode.

## Data model (migration 0146 — staged in PR, applied to prod only on Juan's go)

```sql
-- 0146_toast_menu_crosswalk.sql
alter table public.locations add column toast_restaurant_guid text;

create table public.toast_menu_map (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  menu_item_id uuid references public.menu_items(id),
  item_id uuid references public.items(id),
  toast_item_guid text not null,
  toast_item_name text not null,
  toast_price_cents integer,          -- snapshot at match time; drift baseline
  match_status text not null check (match_status in ('candidate','confirmed','rejected','stale')),
  match_score numeric,                -- auto-matcher score; null for manual maps
  matched_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint toast_map_entity_xor check (
    (menu_item_id is not null and item_id is null) or
    (menu_item_id is null and item_id is not null)
  )
);
alter table public.toast_menu_map enable row level security;
-- Deny-all config table (service-role/lib authority) — 0143 item_sizes pattern:
create policy toast_menu_map_no_user_insert on public.toast_menu_map for insert with check (false);
create policy toast_menu_map_no_user_update on public.toast_menu_map for update using (false);
create policy toast_menu_map_no_user_delete on public.toast_menu_map for delete using (false);
-- One ACTIVE confirmed mapping per (location, toast guid) and per (location, entity):
create unique index toast_map_uq_guid on public.toast_menu_map(location_id, toast_item_guid)
  where active and match_status = 'confirmed';
create unique index toast_map_uq_menu_item on public.toast_menu_map(location_id, menu_item_id)
  where active and match_status = 'confirmed' and menu_item_id is not null;
create unique index toast_map_uq_item on public.toast_menu_map(location_id, item_id)
  where active and match_status = 'confirmed' and item_id is not null;
create index toast_map_loc_status_idx on public.toast_menu_map(location_id, match_status) where active;
```

Append-only discipline: rows are never UPDATEd for state transitions that change mapping identity — confirm/reject flip `match_status` + stamp via lib (allowed in-place: status/confirmed_by/confirmed_at/active only); superseding a confirmed mapping = new row + old row `active=false`. No DELETE, ever.

- `menu_item_id` = subs/resale (`menu_items`); `item_id` = sold-directly items (`items`). XOR enforced.
- `locations.toast_restaurant_guid`: per-location Toast scoping id — DATA, not env (tenant boundary law); edited on the existing `/admin/locations` surface.

## Toast client — `lib/toast/client.ts` (SERVER-ONLY, `import "server-only"`)

- Env (documented in `.env.local.example`, values never logged): `TOAST_API_HOSTNAME` (default `https://ws-api.toasttab.com`), `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`.
- `toastConfigured(): boolean` — true iff clientId+secret present.
- Token: `POST {host}/authentication/v1/authentication/login` body `{clientId, clientSecret, userAccessType: "TOAST_MACHINE_CLIENT"}` → `{token: {accessToken, expiresIn}}` (per Toast auth docs). Cached in module scope with a 60s expiry buffer; one silent re-auth on 401 then typed failure.
- `toastGet<T>(path, restaurantGuid)`: `Authorization: Bearer` + `Toast-Restaurant-External-ID: <guid>` headers.
- **Fixture mode:** when `!toastConfigured()` OR `TOAST_FIXTURES=1`, `toastGet` resolves from `tests/fixtures/toast/<fixture-key>.json` (keyed by path prefix). Fixtures are hand-shaped from Toast's public docs and double as test data. This is what makes the whole spec buildable and testable pre-credentials.
- Errors: `ToastApiError(status, code)` — `not_configured` | `auth_failed` | `http_<status>` | `bad_payload`. Callers degrade to advisory UI states; nothing 500s a page.

## Menu pull — `lib/toast/menus.ts` (server-only)

`fetchToastMenuItems(restaurantGuid): Promise<ToastMenuItem[]>` — GET `/menus/v2/menus`, walk menus → groups → items, normalize to flat `{ itemGuid, name, priceCents (null when price absent/complex), groupName }`, dedupe by itemGuid (first-wins). The doc-shape walk lives in a **pure exported `flattenToastMenus(json)`** so normalization is fixture-unit-tested without I/O. Malformed payload → `bad_payload` (whole pull poisons; no partial results — house flatten doctrine).

## Matcher — `lib/toast/matcher.ts` (PURE, client-safe, zero I/O)

```ts
export interface CoEntity { kind: "menu_item" | "item"; id: string; name: string; priceCents: number | null }
export interface ToastItem { itemGuid: string; name: string; priceCents: number | null; groupName: string | null }
export interface MatchCandidate { entity: CoEntity; toast: ToastItem; score: number }
export function matchCandidates(entities: CoEntity[], toastItems: ToastItem[]): MatchCandidate[]
```

- Name normalization: lowercase, strip diacritics/punctuation, collapse whitespace.
- Scoring: normalized exact = 1.0; else token-set Jaccard (0..1) + 0.15 bonus when prices within 5% (capped 0.99). Threshold **0.8** → candidate. Each Toast item pairs with its best entity and vice versa (greedy best-first, one candidate per side).
- Deterministic; ties broken by name then guid. The most-tested file in the spec (CO reality: "Hot Pants" vs Toast's listing is exactly what the confirm queue is for — the matcher only has to be good, not perfect).

## Server lib — `lib/admin/toast-map.ts` (server-only; `TOAST_MAP_MIN = 7` GM+, mirrors menu.ts)

- `loadToastMapState(actor)`: locations (+guid presence), active map rows grouped by status, and the CO-entity universe. **Entity universe (pinned):** all active `menu_items` (global) + active global `items` with `sold_directly = true`. (Prep-only items never appear on Toast's sell menu; if one ever does, it becomes sold_directly first — that's the existing model.)
- `runAutoMatch(actor, locationId)`: pull live/fixture menu → `matchCandidates` against UNMAPPED entities only (confirmed/rejected rows excluded on both sides) → idempotently insert `candidate` rows (skip when an active candidate for the same (location, entity, guid) exists). Returns counts. Audits `toast_map.auto_match` with counts. **Never touches confirmed rows.**
- `confirmMapping(actor, mapId)` / `rejectMapping(actor, mapId)`: candidate → confirmed/rejected, stamps confirmed_by/at; confirming supersedes (deactivates) any other active row for the same entity or guid at that location. Audits `toast_map.confirm` / `toast_map.reject`.
- `unmapConfirmed(actor, mapId)`: active confirmed row → `active=false` (supersede-out; audit `toast_map.unmap`). Correction path — no delete.
- `driftReport(actor, locationId)`: live/fixture pull compared to active confirmed mappings + current CO prices → `{ priceChanged: [{map, toastNowCents, coCents, snapshotCents}], renamed: [{map, toastNowName}], missingOnToast: [map] (also flips row to 'stale'), newOnToast: [ToastItem], unmappedCo: [CoEntity] }`. Advisory; the only write is the `stale` flip (audited `toast_map.stale`).

## Routes — `app/api/admin/toast-map/*` (standard admin pattern: `requireSession` → level ≥7 → `assertStepUp(ctx, "A")` on writes)

- `POST /api/admin/toast-map/match` `{locationId}` → runAutoMatch (step-up).
- `POST /api/admin/toast-map/[id]` `{action: "confirm"|"reject"|"unmap"}` (step-up).
- `GET /api/admin/toast-map/drift?locationId=` → driftReport (read; no step-up — advisory read, though it may flip stale: acceptable, audited, mirrors read-time classifier precedent from W4c-a).

## UI — Toast tab on `/admin/catering/menu`

Server page loads `loadToastMapState` alongside the existing menu load; `MenuClient` gains a two-tab header (Menu | Toast) — existing content untouched under Menu. Toast tab, per location:

- Not-configured state when `!toastConfigured()` (setup hint referencing `.env.local.example`) or location missing `toast_restaurant_guid` (hint → `/admin/locations`).
- Buttons: **Run match** · **Check drift** (both call the routes; step-up modal per the page's existing pattern).
- **Confirm queue:** candidate rows side-by-side (CO name+price vs Toast name+price, score badge) with Confirm / Reject.
- **Mapped list:** confirmed rows (+ Unmap), stale rows flagged.
- **Drift report:** grouped advisory lists (price changed / renamed / missing on Toast / new on Toast / CO unmapped).
- All new strings in `en.json` + `es.json` under `admin.toast.*` (i18n law; operational tú-form Spanish).

~~`/admin/locations` field~~ **Corrected during build:** `/admin/locations` is still a placeholder page (no editor exists). The per-location `Toast restaurant GUID` field lives INLINE in the Toast tab instead (input + save, Tier-A step-up, via `setLocationToastGuid` + `POST /api/admin/toast-map/location`, audited `toast_map.set_location_guid`) — one surface for everything Toast.

## Testing (vitest additions)

- `tests/toast-matcher.test.ts`: normalization (diacritics/punct), exact-hit, Jaccard partials, price bonus, threshold edge, greedy uniqueness, determinism.
- `tests/toast-menus.test.ts`: `flattenToastMenus` on the checked-in fixture (nesting walk, price normalization, dedupe, malformed → throw).
- `tests/toast-client.test.ts`: expiry-buffer math (pure helper `tokenIsFresh(expiresAt, now)`), fixture-mode routing.
- Fixture: `tests/fixtures/toast/menus-v2-sample.json` — two menus, three groups, ~10 items incl. one no-price item and one duplicate guid.

## Error handling summary

Not-configured → informative empty states, never errors. Auth/HTTP failures → typed `ToastApiError` → advisory banner. Partial/malformed pulls poison the whole operation (no partial writes). No retries beyond one 401 re-auth (on-demand actions only — no storms). Rate-limit 429 surfaces as advisory.

## Deliberately OUT (specs #2/#3 or write-track)

Webhooks · scheduled/cron drift · sales ingest + depletion + the catering double-count rule · variance · Stock-API 86-push · any Toast write · BYO modifier mapping (sales-ingest concern; the crosswalk maps items, not selections).

## Done criteria

Typecheck + all tests green with zero Toast credentials present; the Toast tab renders the not-configured state on a fresh env; with fixtures forced (`TOAST_FIXTURES=1`) an admin can run match → confirm → see drift end-to-end locally. Migration file staged in the PR; **prod apply + merge = Juan's explicit go.**
