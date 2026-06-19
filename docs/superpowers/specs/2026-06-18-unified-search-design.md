# Unified Cross-Surface Search — Design

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on:** the Reports Hub search (#72 quick-find, #73 deep authorized-content — `lib/reports-search.ts` `buildSearchCorpus`/`searchReport`, `app/(authed)/reports/page.tsx` `?q=` wiring; maintenance notes now in the corpus via #76), the profiles directory (#74 — `lib/profiles.ts` `loadProfileDirectory`), and the nav registry (`components/DashboardNav.tsx` `NAV_LINKS`).
**Cycle:** Juan's #2 — extend search beyond hub reports to "one box for the whole app."

---

## Goal

When `/reports` has a `?q=` query, surface results from **three sources** — Reports, People, and Pages — not just reports. With no query, `/reports` is the unchanged report library. No new route; the existing search box + `?q=` plumbing gain two result groups. **Read/compose only — no migration, no write path.**

## Decisions (locked with Juan)

- **Scope:** Reports + People + Pages (all three real source kinds).
- **Surface:** expand the existing `/reports ?q=` (no dedicated `/search` page, no omnibox).
- **Pages:** all nav destinations the viewer can reach (respecting level gates), including coming-soon stubs — a navigational index.
- **Layout:** when a query is present, compact **People** + **Pages** sections render first (quick jump-to), then the existing **Reports** results below (primary content). Each group renders only when it has hits.

## The three sources (each keeps its own authorization — federate, don't centralize)

### Reports (existing — unchanged)
`listReports` + `buildSearchCorpus` + `searchReport`. Tier-redacted (notes L5+, cash L5+, PM own/all), location-bound (IDOR two-halves), with where-it-matched snippets. Maintenance rides this corpus (#76). **No change to reports search behavior.**

### People (new)
`loadProfileDirectory(service, { viewer: { userId, locations } })` → `{ staff: DirectoryEntry[], leadership: LeadershipDirectoryEntry[] }`. The directory **already returns only viewable people** — staff = shares ≥1 location with the viewer; leadership (level ≥ 8) = company-wide. Reusing it keeps the visibility gate intact (no new auth logic).
- **Match:** case-insensitive substring on `name` and the localized role label (`role.<code>`), across both staff and leadership.
- **Result:** `{ userId, name, role }` → links to `/profile/{userId}`.
- **Cap:** first ~10 matches; if more, a "see all in the directory" link to `/profile`.
- Names + roles are already shown in the directory — no new exposure.

### Pages (new)
The nav destinations registry. **Extract** `NAV_LINKS` + the conditional mid-shift/admin entries out of `DashboardNav.tsx` into a shared `lib/nav-links.ts` with a `navDestinationsFor(level): NavLink[]` helper (single source of truth for both DashboardNav and search). `NavLink = { key: TranslationKey; href: string; scoped: boolean }`.
- **Access gates (preserved exactly):** mid-shift requires level ≥ 4; admin requires level ≥ 6; all other destinations open. `navDestinationsFor(level)` returns only the accessible set.
- **Match:** case-insensitive substring on the **localized label** (`serverT(lang, key)`).
- **Result:** `{ label, href }` → links to the destination; scoped destinations get `?location={selectedLocation}` appended (same `chipHref` logic, reused from `lib/nav-links.ts`).
- Show all matches (small set). Pages carry no data sensitivity (labels + links only).

## Result model + UI

A query (`q` non-empty, after trim) drives the search; the page assembles:
- `people: Array<{ userId; name; role }>` (capped, + `hasMore` flag)
- `pages: Array<{ label; href }>`
- the existing filtered `reports` list (+ snippets)

Render order when searching: **People** section (compact rows: avatar initial · name · role chip → profile), **Pages** section (chips → href), then the **Reports** section (existing list + snippets). Each section has a localized heading with a count; omitted when empty. If all three are empty → a single "no matches for '{q}'" state. With no query: only the normal report library renders (People/Pages sections absent).

New i18n: `reports.search.people_heading`, `reports.search.pages_heading`, `reports.search.see_all_people`, `reports.search.no_matches` (+ count params) — EN + ES at parity.

## Architecture / files

- **`lib/nav-links.ts`** (new) — `NavLink` type, `NAV_LINKS`, and `navDestinationsFor(level)` (folds in mid-shift ≥4 + admin ≥6). `DashboardNav.tsx` refactors to consume it (behavior identical).
- **`lib/unified-search.ts`** (new) — pure matchers, no I/O on their own:
  - `matchPeople(directory, query, lang, t): Array<{ userId; name; role }>` — filters a `ProfileDirectoryResult` by name/role-label.
  - `matchPages(level, query, lang, t): Array<{ label; href }>` — filters `navDestinationsFor(level)` by localized label.
  Keeping these pure (the page passes in the loaded directory + level + a translate fn) makes them unit-smokeable and keeps the auth I/O (`loadProfileDirectory`) in the page where the session lives.
- **`app/(authed)/reports/page.tsx`** — when `q` is present, also call `loadProfileDirectory` (with `auth` locations) + `matchPeople`, and `matchPages(level, …)`; pass `people`/`pages` to the list UI. Append `?location=` to scoped page hrefs via the shared helper.
- **`components/reports-hub/`** — small presentational additions: a `PeopleResults` + `PagesResults` section (or fold into the existing results component). Server Components, plain text, no `dangerouslySetInnerHTML`.

## Security / privacy

- **Per-source authorization, never merge-then-filter.** Reports stay tier-redacted + location-bound; People come *only* from `loadProfileDirectory` (the existing visibility gate); Pages come *only* from `navDestinationsFor(level)` (the existing level gates). No result reaches the page that its source loader wouldn't already show on its own surface.
- **People match runs on the already-authorized directory result** — the query filters an authorized set; it never widens it (no raw `users` query in the matcher).
- **Pages match runs on the level-gated destination set** — a viewer can't surface an admin link below L6.
- No new tables, no new RLS, no audit (read surface).

## Verification (no test framework)

`tsc --noEmit` + `next build` + throwaway `tsx`/pure smokes:
1. **`matchPages`:** for L3 excludes mid-shift + admin; for L4 includes mid-shift, excludes admin; for L6 includes both; label match is case-insensitive and localized (a Spanish label matches a Spanish query).
2. **`matchPeople`:** filters a sample `ProfileDirectoryResult` by name substring and role label; respects the cap + `hasMore`; never returns a userId absent from the input directory.
3. **Live integration:** on `/reports` with a query matching a teammate's name, `loadProfileDirectory` + `matchPeople` returns them; a query matching no one returns empty; a viewer who shares no location with a staff member doesn't get them (directory gate intact); a query matching a page label returns the page; an L3 viewer never gets the admin page.
4. **No regression:** with no query, the page renders the normal report list; with a query, Reports results match pre-change behavior; `DashboardNav` renders the same chips after the `nav-links.ts` extraction.

## Deferred (tracked)

- Type-ahead omnibox / global header search (this builds the federated backend; a live dropdown can layer on later).
- Indexing module *content* beyond reports (recipes, announcements, etc.) once those modules exist and hold data.
- Cross-kind relevance ranking (v1 is grouped-by-kind, which sidesteps cross-kind scoring).
- Fuzzy matching / typo tolerance (v1 is case-insensitive substring).
