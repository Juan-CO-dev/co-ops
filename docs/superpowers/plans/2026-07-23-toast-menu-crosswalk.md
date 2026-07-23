# Toast Menu Crosswalk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This run:** CC executes inline, fully auto per Juan; STOP at the open PR — no merge, no prod migration apply.

**Goal:** Per-location Toast menu crosswalk (`toast_menu_map`) + advisory drift report, dormant-until-credentials via fixture mode.

**Architecture:** Pure matcher + pure menu-normalizer (unit-tested, zero I/O) under a server-only OAuth client with fixture fallback; deny-all config table written only through a GM+/Tier-A admin lib; UI = Toast tab on the existing `/admin/catering/menu` page. Spec (source of truth for all contracts, schema SQL, scoring rules, route shapes): `docs/superpowers/specs/2026-07-23-toast-menu-crosswalk-design.md`.

**Tech Stack:** Next.js 16 App Router · Supabase (service-role via `lib/supabase-server`) · vitest · existing admin patterns (`lib/admin/catering/menu.ts`, `app/api/admin/catering/menu/[id]/route.ts`, 0143 migration RLS shape).

---

### Task 1: Migration 0146 (file only — NOT applied to prod)
**Files:** Create `supabase/migrations/0146_toast_menu_crosswalk.sql`
- [ ] Copy the SQL from spec §"Data model" verbatim (locations.toast_restaurant_guid + toast_menu_map + deny-all RLS + partial unique indexes), with the house provenance header noting "staged in PR #<n>; prod apply deferred to Juan's go".
- [ ] Commit: `feat(toast): migration 0146 toast_menu_map + locations.toast_restaurant_guid (staged)`

### Task 2: Matcher (pure) — TDD
**Files:** Create `lib/toast/matcher.ts` · Test `tests/toast-matcher.test.ts`
- [ ] Write tests first: normalizeName (diacritics/punctuation/whitespace), exact-name=1.0, token-set Jaccard partial, +0.15 price bonus within 5% (cap 0.99), 0.8 threshold exclusion, greedy one-per-side uniqueness, deterministic tie-break (name then guid).
- [ ] Run `npx vitest run tests/toast-matcher.test.ts` → FAIL (module missing).
- [ ] Implement `CoEntity`/`ToastItem`/`MatchCandidate` + `normalizeName` + `matchCandidates` per spec §Matcher: score all pairs, sort desc (score, name, guid), greedily take pairs whose entity+guid are both unused, filter ≥0.8.
- [ ] Tests green → commit `feat(toast): pure menu matcher`.

### Task 3: Client + fixtures — TDD
**Files:** Create `lib/toast/client.ts`, `tests/fixtures/toast/menus-v2-sample.json` · Test `tests/toast-client.test.ts`
- [ ] Fixture: two menus / three groups / ~10 items incl. one price-less item + one duplicate guid (shape: `[{name, groups:[{name, items:[{guid, name, price}]}]}]`).
- [ ] Tests: `tokenIsFresh(expiresAtMs, nowMs)` buffer math (fresh, within-60s-buffer=stale, expired); fixture-mode routing (`toastConfigured()` false → `toastGet` returns fixture JSON for key `menus-v2-sample`).
- [ ] Implement per spec §Toast client: `import "server-only"`… wait — vitest imports it; mirror the house pattern instead: keep client.ts server-only-free but ONLY imported from server libs (menus.ts/toast-map.ts are the server surface), with pure helpers exported for tests. `ToastApiError`, env reads, module token cache `{token, expiresAtMs}`, `getToastToken()` (POST login, TOAST_MACHINE_CLIENT, cache with 60s buffer, one re-auth on 401), `toastGet(path, restaurantGuid)` (bearer + `Toast-Restaurant-External-ID`; fixture branch when `!toastConfigured() || TOAST_FIXTURES=1`, resolving `tests/fixtures/toast/<key>.json` via a path→key map: `/menus/v2/menus` → `menus-v2-sample`).
- [ ] Tests green → commit `feat(toast): api client with fixture mode`.

### Task 4: Menu normalizer — TDD
**Files:** Create `lib/toast/menus.ts` · Test `tests/toast-menus.test.ts`
- [ ] Tests on `flattenToastMenus(json)` with the fixture: flat count, priceCents = Math.round(price*100) | null, dedupe first-wins on guid, groupName carried, malformed (non-array / missing guid) → throws.
- [ ] Implement: pure `flattenToastMenus` + `fetchToastMenuItems(restaurantGuid)` = `toastGet("/menus/v2/menus", guid)` → flatten. Menus.ts is the server import surface for client.ts.
- [ ] Tests green → commit `feat(toast): menu pull + pure normalizer`.

### Task 5: Server lib
**Files:** Create `lib/admin/toast-map.ts`
- [ ] Implement per spec §Server lib: `TOAST_MAP_MIN=7`, `AdminToastMapError` (mirror `AdminCateringMenuError`), `loadToastMapState` (locations w/ toast_restaurant_guid; active map rows; entity universe = active global menu_items + active global items where sold_directly), `runAutoMatch` (unmapped-only both sides, idempotent candidate insert, audit `toast_map.auto_match` w/ counts), `confirmMapping`/`rejectMapping` (status flip + stamps; confirm supersedes competing active rows → active=false; audits), `unmapConfirmed` (active=false, audit `toast_map.unmap`), `driftReport` (compare pull vs confirmed + CO prices; flip missing→`stale` + audit `toast_map.stale`; return advisory groups incl. unmappedCo + newOnToast). Every Supabase write checks `error` and rowcount.
- [ ] `npx tsc --noEmit` clean → commit `feat(toast): admin crosswalk data layer`.

### Task 6: Routes
**Files:** Create `app/api/admin/toast-map/match/route.ts`, `app/api/admin/toast-map/[id]/route.ts`, `app/api/admin/toast-map/drift/route.ts`
- [ ] Clone the shape of `app/api/admin/catering/menu/[id]/route.ts` (requireSession → level via lib → `assertStepUp(ctx,"A")` on POSTs; drift GET = no step-up). Map `AdminToastMapError`/`ToastApiError` → jsonError(status, code); unknown → 500 generic.
- [ ] `npx tsc --noEmit` clean → commit `feat(toast): admin crosswalk routes`.

### Task 7: UI + i18n + locations field
**Files:** Modify `app/admin/catering/menu/page.tsx`, `components/admin/catering/menu/MenuClient.tsx` (tab shell + new `ToastTab` child component in same dir), `app/admin/locations/page.tsx` + its client/editor (add Toast GUID field via the page's existing edit pattern), `lib/i18n/en.json` + `es.json` (`admin.toast.*` keys, tú-form es).
- [ ] Page: also `loadToastMapState`; pass to client. MenuClient: two-tab header (Menu | Toast), existing content = Menu tab unchanged; `ToastTab` renders per-location sections: not-configured / missing-guid hints, Run match + Check drift buttons (existing step-up + fetch pattern from this client), candidate confirm queue (side-by-side + score + Confirm/Reject), mapped list (+Unmap), stale flags, drift groups.
- [ ] Locations admin: Toast GUID input on the location editor, same write route/gate that page already uses (read it first; follow exactly).
- [ ] All new visible strings + ARIA via i18n keys, en + es in the same commit.
- [ ] `npx tsc --noEmit` → commit `feat(toast): admin crosswalk UI + locations guid field + i18n`.

### Task 8: Verify + PR (STOP)
- [ ] `npx tsc --noEmit` && `npx vitest run` (expect 75 + new all green) && `npm run build` locally.
- [ ] `.env.local.example`: add TOAST_API_HOSTNAME/TOAST_CLIENT_ID/TOAST_CLIENT_SECRET + fixture note under the tenant block.
- [ ] Push branch, open PR titled "Toast read-track 1: menu crosswalk + drift (dormant until creds; migration staged)". Body: spec link, done-criteria checklist, explicit "migration 0146 NOT applied to prod — awaiting Juan".
- [ ] Run a code-reviewer subagent over the full diff (confidence rule); fix real findings; push.
- [ ] STOP. No merge, no prod migration.
