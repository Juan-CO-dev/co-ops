# Unified Cross-Surface Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/reports` has a `?q=`, surface People + Pages results alongside the existing Reports results — one search box for the whole app — composing existing authorized loaders (no new route, no migration).

**Architecture:** Extract the nav destination registry into `lib/nav-links.ts` (shared by `DashboardNav` and search). Add pure matchers in `lib/unified-search.ts` (`matchPeople` over `loadProfileDirectory`'s authorized result; `matchPages` over `navDestinationsFor(level)`). The `/reports` page, when `q` is present, loads the directory + runs both matchers and renders two compact sections above the existing report list. Each group is produced by its surface's own authorized loader (federate, don't centralize) — the merge is purely presentational.

**Tech Stack:** Next 16 App Router (Server Components), TS strict + `noUncheckedIndexedAccess`, Supabase. No test framework → `tsc --noEmit` + `next build` + throwaway `tsx`/pure smokes (self-deleted, never committed).

**Branch:** `claude/unified-search` (off `origin/main`; design committed). Commit after each task.

**Confirmed shapes:**
- `auth` on the reports page exposes `auth.locations` (`string[] | "all"`), `auth.level`, `auth.user.id`, `auth.user.language`. `query = (qParam ?? "").trim()`.
- `loadProfileDirectory(service, { viewer: { userId: string; locations: string[] | "all" } })` → `{ staff: DirectoryEntry[]; leadership: LeadershipDirectoryEntry[] }`. `DirectoryEntry = { userId; name; role; mvpWins }`, `LeadershipDirectoryEntry = { userId; name; role }` (both have `userId`/`name`/`role`; `RoleCode`).
- Role label i18n key: `role.<code>` (e.g. `serverT(lang, \`role.${role}\`)`).
- `DashboardNav.tsx` currently inlines `NAV_LINKS` (17 entries), `chipHref`, and renders mid-shift (≥4) before + admin (≥6) after the map.

---

## Task 1: Extract `lib/nav-links.ts` + refactor `DashboardNav`

**Files:** Create `lib/nav-links.ts`; Modify `components/DashboardNav.tsx`.

- [ ] **Step 1: Ground-truth**

Re-read `components/DashboardNav.tsx` in full. Confirm: `NavLink` interface (`{ key: TranslationKey; href: string; scoped: boolean }`), the exact 17 `NAV_LINKS` entries, `chipHref(href, scoped, locationId)`, and the render order — mid-shift chip (`actorLevel >= 4`, href `/mid-shift`, scoped) FIRST, then `NAV_LINKS`, then admin chip (`actorLevel >= 6`, href `/admin`, bare/unscoped) LAST.

- [ ] **Step 2: Create `lib/nav-links.ts`**

```ts
import type { TranslationKey } from "@/lib/i18n/types";

/** A primary navigation destination. */
export interface NavLink {
  key: TranslationKey;
  href: string;
  /** When true, append ?location=<selected> so the active location travels. */
  scoped: boolean;
}

/** The always-available destinations (level-independent), in display order. */
export const NAV_LINKS: NavLink[] = [
  { key: "nav.reports_hub", href: "/reports", scoped: true },
  { key: "nav.trends", href: "/reports/trends", scoped: true },
  { key: "nav.announcements", href: "/announcements", scoped: true },
  { key: "nav.ordering", href: "/ordering", scoped: true },
  { key: "nav.tips", href: "/tips", scoped: true },
  { key: "nav.ai", href: "/ai", scoped: true },
  { key: "nav.rollups", href: "/rollups", scoped: true },
  { key: "nav.deep_cleaning", href: "/deep-cleaning", scoped: true },
  { key: "nav.feedback", href: "/feedback", scoped: true },
  { key: "nav.lto", href: "/lto", scoped: true },
  { key: "nav.written_reports", href: "/written-reports", scoped: true },
  { key: "nav.catering", href: "/catering", scoped: true },
  { key: "nav.training", href: "/training", scoped: false },
  { key: "nav.recipes", href: "/recipes", scoped: false },
  { key: "nav.comms", href: "/comms", scoped: false },
  { key: "nav.profile", href: "/profile", scoped: false },
  { key: "nav.settings", href: "/settings", scoped: false },
  { key: "nav.my_feedback", href: "/my-feedback", scoped: false },
];

/**
 * Destinations the given role level may reach, in display order:
 * mid-shift (≥4) first, then the always-available set, then admin (≥6) last.
 * Single source of truth for DashboardNav AND unified search.
 */
export function navDestinationsFor(level: number): NavLink[] {
  const out: NavLink[] = [];
  if (level >= 4) out.push({ key: "nav.mid_shift", href: "/mid-shift", scoped: true });
  out.push(...NAV_LINKS);
  if (level >= 6) out.push({ key: "nav.admin", href: "/admin", scoped: false });
  return out;
}

/** Append the active location to scoped destinations when one is selected. */
export function chipHref(href: string, scoped: boolean, locationId: string | null): string {
  return scoped && locationId ? `${href}?location=${locationId}` : href;
}
```
NOTE: copy the 17 `NAV_LINKS` entries VERBATIM from the current `DashboardNav.tsx` (Step 1) — if any key/href/scoped differs from the list above, use the file's actual values.

- [ ] **Step 3: Refactor `DashboardNav.tsx` to consume it**

Remove the inline `NavLink` interface, `NAV_LINKS`, and `chipHref` from `DashboardNav.tsx`. Import them:
```ts
import { navDestinationsFor, chipHref } from "@/lib/nav-links";
```
Replace the three render blocks (mid-shift conditional + `NAV_LINKS.map` + admin conditional) with a single map over `navDestinationsFor(actorLevel)`:
```tsx
      <div className="flex flex-wrap gap-2">
        {navDestinationsFor(actorLevel).map(({ key, href, scoped }) => (
          <a key={href} href={chipHref(href, scoped, selectedLocationId)} className={CHIP_CLASS}>
            {serverT(language, key)}
          </a>
        ))}
      </div>
```
Keep `CHIP_CLASS`, the `<nav>` wrapper, and the section label exactly as they are. The rendered chips, order, and level gates are unchanged.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS.
Pure smoke `scripts/smoke-navlinks.ts` (delete after):
```ts
import { navDestinationsFor } from "@/lib/nav-links";
function main() {
  const l3 = navDestinationsFor(3).map((d) => d.href);
  const l4 = navDestinationsFor(4).map((d) => d.href);
  const l6 = navDestinationsFor(6).map((d) => d.href);
  console.log("L3 has mid-shift ===", l3.includes("/mid-shift") ? "FAIL" : "PASS (excluded)");
  console.log("L3 has admin ===", l3.includes("/admin") ? "FAIL" : "PASS (excluded)");
  console.log("L4 has mid-shift ===", l4.includes("/mid-shift") ? "PASS" : "FAIL");
  console.log("L4 has admin ===", l4.includes("/admin") ? "FAIL" : "PASS (excluded)");
  console.log("L6 has admin ===", l6.includes("/admin") ? "PASS" : "FAIL");
  console.log("L6 mid-shift first ===", l6[0] === "/mid-shift" ? "PASS" : "FAIL");
  console.log("L3 count (no mid/admin) ===", l3.length === 18 ? "PASS" : `FAIL(${l3.length})`);
}
main();
```
Run: `npx tsx scripts/smoke-navlinks.ts`. Expected: all PASS (L3 count = 18 = the 18 NAV_LINKS entries; adjust the expected count if the verbatim list differs).

- [ ] **Step 5: Delete smoke + commit**
```
rm -f scripts/smoke-navlinks.ts
git add lib/nav-links.ts components/DashboardNav.tsx
git commit -m "refactor(nav): extract nav destinations to lib/nav-links.ts (shared with search)"
```

---

## Task 2: Pure matchers — `lib/unified-search.ts`

**Files:** Create `lib/unified-search.ts`.

- [ ] **Step 1: Ground-truth**

Confirm in `lib/profiles.ts`: `ProfileDirectoryResult` = `{ staff: DirectoryEntry[]; leadership: LeadershipDirectoryEntry[] }`, and both entry types carry `userId`/`name`/`role` (`RoleCode`). Confirm `lib/nav-links.ts` exports `navDestinationsFor` + `NavLink` (Task 1). Confirm `RoleCode` is exported from `@/lib/roles`.

- [ ] **Step 2: Write the matchers**

```ts
import type { TranslationKey } from "@/lib/i18n/types";
import { navDestinationsFor } from "@/lib/nav-links";
import type { ProfileDirectoryResult } from "@/lib/profiles";
import type { RoleCode } from "@/lib/roles";

export interface PersonResult {
  userId: string;
  name: string;
  role: RoleCode;
}
export interface PageResult {
  label: string;
  href: string;
  scoped: boolean;
}

export const PEOPLE_CAP = 10;

/**
 * Filter an ALREADY-AUTHORIZED profile directory by name / role-label substring.
 * Pure: the caller loads the directory (which enforces visibility) and passes a
 * role-label translator. The matcher never widens the authorized set.
 */
export function matchPeople(
  directory: ProfileDirectoryResult,
  query: string,
  translateRole: (role: RoleCode) => string,
): { people: PersonResult[]; hasMore: boolean } {
  const q = query.trim().toLowerCase();
  if (!q) return { people: [], hasMore: false };
  const all: Array<{ userId: string; name: string; role: RoleCode }> = [
    ...directory.leadership,
    ...directory.staff,
  ];
  const seen = new Set<string>();
  const matched: PersonResult[] = [];
  for (const p of all) {
    if (seen.has(p.userId)) continue;
    if (p.name.toLowerCase().includes(q) || translateRole(p.role).toLowerCase().includes(q)) {
      seen.add(p.userId);
      matched.push({ userId: p.userId, name: p.name, role: p.role });
    }
  }
  return { people: matched.slice(0, PEOPLE_CAP), hasMore: matched.length > PEOPLE_CAP };
}

/**
 * Filter the LEVEL-GATED nav destinations by localized-label substring.
 * Pure: navDestinationsFor(level) already excludes destinations above the
 * viewer's level, so a match can never surface an inaccessible page.
 */
export function matchPages(
  level: number,
  query: string,
  translateLabel: (key: TranslationKey) => string,
): PageResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: PageResult[] = [];
  for (const d of navDestinationsFor(level)) {
    const label = translateLabel(d.key);
    if (label.toLowerCase().includes(q)) out.push({ label, href: d.href, scoped: d.scoped });
  }
  return out;
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → PASS.
Pure smoke `scripts/smoke-matchers.ts` (delete after):
```ts
import { matchPeople, matchPages, PEOPLE_CAP } from "@/lib/unified-search";
import type { ProfileDirectoryResult } from "@/lib/profiles";

function main() {
  const dir: ProfileDirectoryResult = {
    leadership: [{ userId: "L1", name: "Cristian Owner", role: "moo" }],
    staff: [
      { userId: "S1", name: "Ana Lopez", role: "shift_lead", mvpWins: 0 },
      { userId: "S2", name: "Bob Jones", role: "key_holder", mvpWins: 0 },
    ],
  };
  const tr = (r: string) => ({ moo: "Manager of Ops", shift_lead: "Shift Lead", key_holder: "Key Holder" } as Record<string, string>)[r] ?? r;

  const byName = matchPeople(dir, "ana", tr as any);
  console.log("name match ===", byName.people.length === 1 && byName.people[0]!.userId === "S1" ? "PASS" : "FAIL");
  const byRole = matchPeople(dir, "shift", tr as any);
  console.log("role-label match ===", byRole.people.some((p) => p.userId === "S1") ? "PASS" : "FAIL");
  const empty = matchPeople(dir, "zzz", tr as any);
  console.log("no match ===", empty.people.length === 0 ? "PASS" : "FAIL");
  console.log("blank query ===", matchPeople(dir, "  ", tr as any).people.length === 0 ? "PASS" : "FAIL");

  const tl = (k: string) => ({ "nav.mid_shift": "Mid-Shift Pulse", "nav.admin": "Admin", "nav.reports_hub": "Reports Hub" } as Record<string, string>)[k] ?? k;
  const l3 = matchPages(3, "admin", tl as any);
  console.log("L3 no admin page ===", l3.length === 0 ? "PASS" : "FAIL");
  const l6 = matchPages(6, "admin", tl as any);
  console.log("L6 admin page ===", l6.some((p) => p.href === "/admin") ? "PASS" : "FAIL");
  const l4 = matchPages(4, "mid", tl as any);
  console.log("L4 mid-shift page ===", l4.some((p) => p.href === "/mid-shift") ? "PASS" : "FAIL");
}
main();
```
Run: `npx tsx scripts/smoke-matchers.ts`. Expected: all PASS. (The `as any` on the translators is smoke-only convenience.)

- [ ] **Step 4: Delete smoke + commit**
```
rm -f scripts/smoke-matchers.ts
git add lib/unified-search.ts
git commit -m "feat(unified-search): pure matchPeople + matchPages matchers"
```

---

## Task 3: Wire `/reports` + result sections + i18n

**Files:** Modify `app/(authed)/reports/page.tsx`; Create `components/reports-hub/UnifiedSearchResults.tsx`; Modify `lib/i18n/en.json`, `lib/i18n/es.json`.

- [ ] **Step 1: Ground-truth**

Re-read `app/(authed)/reports/page.tsx`: confirm `auth.locations`, `auth.level` (`viewerLevel`), `auth.user.id`, `lang`, `locationId`, and the `query` computation; confirm the imports (`serverT`, `TranslationKey`, `getServiceRoleClient`); confirm the JSX region between `<ReportFilterBar … />` and `<ReportList … />`. Read `components/reports-hub/ReportList.tsx` for the section heading + chip/row token style to mirror, and confirm its empty-state behavior when `items` is empty + `searchQuery` set.

- [ ] **Step 2: Add i18n keys (EN + ES at parity)**

`lib/i18n/en.json`:
```json
  "reports.search.people_heading": "People · {n}",
  "reports.search.pages_heading": "Pages · {n}",
  "reports.search.see_all_people": "See all in the directory",
  "reports.search.no_matches": "No matches for \"{q}\""
```
`lib/i18n/es.json`:
```json
  "reports.search.people_heading": "Personas · {n}",
  "reports.search.pages_heading": "Páginas · {n}",
  "reports.search.see_all_people": "Ver todo en el directorio",
  "reports.search.no_matches": "Sin resultados para \"{q}\""
```

- [ ] **Step 3: Create `components/reports-hub/UnifiedSearchResults.tsx`**

Pure Server Component (mirror `ReportList` tokens — read it first). Renders the People + Pages sections; nothing if both empty.
```tsx
import Link from "next/link";

import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { ROLES } from "@/lib/roles";
import type { PageResult, PersonResult } from "@/lib/unified-search";
import { chipHref } from "@/lib/nav-links";

export function UnifiedSearchResults({
  people,
  peopleHasMore,
  pages,
  locationId,
  language,
}: {
  people: PersonResult[];
  peopleHasMore: boolean;
  pages: PageResult[];
  locationId: string;
  language: Language;
}) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(language, key, params);
  if (people.length === 0 && pages.length === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-4">
      {people.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {t("reports.search.people_heading", { n: people.length })}
          </h2>
          <ul className="flex flex-col gap-1">
            {people.map((p) => (
              <li key={p.userId}>
                <Link
                  href={`/profile/${p.userId}`}
                  className="flex items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text transition hover:border-co-text"
                >
                  <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-co-gold text-xs font-bold text-co-text">
                    {(p.name.charAt(0) || "?").toUpperCase()}
                  </span>
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-[11px] uppercase text-co-text-muted">{ROLES[p.role].shortLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
          {peopleHasMore ? (
            <Link href="/profile" className="mt-1 inline-block text-xs text-co-text-muted hover:underline">
              {t("reports.search.see_all_people")}
            </Link>
          ) : null}
        </section>
      ) : null}

      {pages.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
            {t("reports.search.pages_heading", { n: pages.length })}
          </h2>
          <div className="flex flex-wrap gap-2">
            {pages.map((pg) => (
              <a
                key={pg.href}
                href={chipHref(pg.href, pg.scoped, locationId)}
                className="rounded-full border-2 border-co-border bg-co-surface px-3 py-1.5 text-sm font-semibold text-co-text transition hover:border-co-text"
              >
                {pg.label}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
```
(If `ROLES[p.role].shortLabel` isn't the right label accessor, match how `PublicProfileCard`/`ProfileDirectory` render the role chip.)

- [ ] **Step 4: Wire the page**

In `app/(authed)/reports/page.tsx`, add imports:
```ts
import { loadProfileDirectory } from "@/lib/profiles";
import { matchPeople, matchPages, type PageResult, type PersonResult } from "@/lib/unified-search";
import { UnifiedSearchResults } from "@/components/reports-hub/UnifiedSearchResults";
```
After the existing `query`/`filteredItems`/`snippets` block, add:
```ts
  // Unified search: People + Pages, only when searching. Each source is its
  // own authorized loader — the matchers filter an already-authorized set.
  let people: PersonResult[] = [];
  let peopleHasMore = false;
  let pages: PageResult[] = [];
  if (query) {
    const directory = await loadProfileDirectory(sb, {
      viewer: { userId: auth.user.id, locations: auth.locations },
    });
    const pm = matchPeople(directory, query, (role) => serverT(lang, `role.${role}` as TranslationKey));
    people = pm.people;
    peopleHasMore = pm.hasMore;
    pages = matchPages(viewerLevel, query, (key) => serverT(lang, key));
  }
  const nothingMatched =
    query.length > 0 && people.length === 0 && pages.length === 0 && filteredItems.length === 0;
```
In the JSX, between `<ReportFilterBar … />` and the `<div className="mt-4"><ReportList … /></div>`, insert:
```tsx
      {query ? (
        <div className="mt-4">
          <UnifiedSearchResults
            people={people}
            peopleHasMore={peopleHasMore}
            pages={pages}
            locationId={locationId}
            language={lang}
          />
        </div>
      ) : null}

      {nothingMatched ? (
        <p className="mt-4 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(lang, "reports.search.no_matches", { q: query })}
        </p>
      ) : (
        <div className="mt-4">
          <ReportList
            items={filteredItems}
            locationId={locationId}
            language={lang}
            viewerLevel={viewerLevel}
            searchQuery={qParam ?? ""}
            snippets={snippets}
          />
        </div>
      )}
```
(Replace the existing `<div className="mt-4"><ReportList … /></div>` with the conditional above. Keep the `ReportList` props exactly as they were.)

- [ ] **Step 5: Verify build + parity**

`npx tsc --noEmit && npm run build` → both PASS.
i18n parity:
```
node -e "const en=require('./lib/i18n/en.json'),es=require('./lib/i18n/es.json');const a=Object.keys(en),b=Object.keys(es);const m=a.filter(k=>!b.includes(k)).concat(b.filter(k=>!a.includes(k)));console.log(m.length?'MISSING: '+m.join(', '):'PARITY OK ('+a.length+')')"
```
Expected: `PARITY OK`.

- [ ] **Step 6: Live integration smoke** `scripts/smoke-unified.ts` (delete after):
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadProfileDirectory } from "@/lib/profiles";
import { matchPeople, matchPages } from "@/lib/unified-search";

async function main() {
  const sb = getServiceRoleClient();
  // pick a real viewer with locations
  const { data: u } = await sb.from("users").select("id, name, role").eq("active", true).limit(1).single();
  const { data: ul } = await sb.from("user_locations").select("location_id").eq("user_id", (u as any).id);
  const locations = ((ul ?? []) as Array<{ location_id: string }>).map((r) => r.location_id);
  const dir = await loadProfileDirectory(sb, { viewer: { userId: (u as any).id, locations: locations.length ? locations : "all" } });
  console.log("directory: staff", dir.staff.length, "leadership", dir.leadership.length);
  const sample = (dir.staff[0]?.name ?? dir.leadership[0]?.name ?? "").split(" ")[0] ?? "";
  if (sample) {
    const r = matchPeople(dir, sample, (role) => role);
    console.log(`matchPeople("${sample}") -> ${r.people.length} (>=1?)`, r.people.length >= 1 ? "PASS" : "FAIL");
    console.log("  every result is in the authorized directory ===",
      r.people.every((p) => [...dir.staff, ...dir.leadership].some((d) => d.userId === p.userId)) ? "PASS" : "FAIL");
  }
  const pages = matchPages(10, "report", (k) => (k === "nav.reports_hub" ? "Reports Hub" : k));
  console.log("matchPages L10 'report' ->", pages.map((p) => p.href));
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local scripts/smoke-unified.ts`. Expected: directory counts; `matchPeople` PASS + every-result-authorized PASS; pages list includes `/reports`.

- [ ] **Step 7: Delete smoke + commit**
```
rm -f scripts/smoke-unified.ts
git add "app/(authed)/reports/page.tsx" components/reports-hub/UnifiedSearchResults.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(unified-search): People + Pages result sections on /reports search"
```

---

## Final verification

- [ ] **Full gate:** `npx tsc --noEmit && npm run build` clean; i18n `PARITY OK`.
- [ ] **No smokes committed:** `git status` shows no `scripts/smoke-*.ts`.
- [ ] **T0 review (CC):** People come ONLY from `loadProfileDirectory` (no raw `users` query in the matcher); Pages come ONLY from `navDestinationsFor(level)` (no level-bypass); reports search behavior unchanged; `DashboardNav` renders identical chips after the extraction; no `dangerouslySetInnerHTML`; no migration / no write path.
- [ ] **Open PR** for Juan's preview smoke: on `/reports`, search a teammate's name → People section links to their profile; search a page name (e.g. "trends", "tips") → Pages section links there; search report content → Reports results unchanged; a gibberish query → "no matches"; confirm an L3 account doesn't get an Admin page result.

## Spec coverage map

| Spec requirement | Task |
|---|---|
| Extract nav registry → `lib/nav-links.ts` (`navDestinationsFor`), refactor DashboardNav | Task 1 |
| Pure `matchPeople` (directory-authorized) + `matchPages` (level-gated) | Task 2 |
| `/reports ?q=` loads directory + runs matchers; People+Pages sections above Reports | Task 3 |
| All-empty → single no-matches state | Task 3 (Step 4) |
| Per-source authorization (federate, don't centralize) | Tasks 2, 3 + Final |
| i18n EN/ES parity; no migration / no write path | Task 3 + Final |
