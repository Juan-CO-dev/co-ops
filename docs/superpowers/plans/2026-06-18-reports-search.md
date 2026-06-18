# Reports Hub Quick-Find Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `?q=` quick-find on the Reports Hub list that filters the already-authorized results by submitter name + report-type, composed AND with the existing filters.

**Architecture:** A pure `matchesReportQuery` helper; a text input added to the existing server GET filter form; the `/reports` page filters the `listReports` output in memory when `q` is present. No client JS, no migration, no new redaction surface (operates only on fields already on each authorized row).

**Tech Stack:** Next.js 16 App Router (Server Components), TS strict + `noUncheckedIndexedAccess`, Tailwind v4. No test framework — `tsc --noEmit` + `next build` + a throwaway `tsx` pure smoke.

**Branch:** `claude/reports-search` (created; spec committed there).

**Spec:** `docs/superpowers/specs/2026-06-18-reports-search-design.md`

---

## Ground-truth (verified)

- **`lib/reports-hub.ts`** `ReportListItem` has `type: ReportTypeKey`, `submitterName: string | null` (+ id/date/locationId/status/signalSummary). `ReportTypeKey = "opening"|"closing"|"am_prep"|"mid_day"|"cash"|"pm"`. `listReports` returns the fully-authorized, gated, IDOR-bound list.
- **`components/reports-hub/ReportFilterBar.tsx`** — server `<form method="get">`; hidden `location`; `from`/`to` date inputs; `type` select; `sf_*` checkboxes; an apply submit (`ActionButton`). Props: `{ locationId, dateFrom, dateTo, selectedType, allowedTypes, language, viewerLevel, activeSignalFilters }`. Uses `serverT` via local `t`.
- **`components/reports-hub/ReportList.tsx`** — `export function ReportList({ items, locationId, language, viewerLevel })`; when `items.length === 0` renders `t("reports.empty")`.
- **`app/(authed)/reports/page.tsx`** — `searchParams` Promise of `{ location?, type?, from?, to?, sf_underPar?, sf_overPar?, sf_skipped?, sf_tempFlag?, sf_cashOver?, sf_cashShort? }`; resolves `lang = auth.user.language`, `locationId`; builds `const items = await listReports(sb, {...})`; renders `<ReportFilterBar .../>` then `<ReportList items={items} locationId={locationId} language={lang} viewerLevel={viewerLevel} />`. There's a header row with the title + a Trends link.
- i18n: `reports.type.<type>` keys exist for all 6 types; `reports.empty` exists. Flat dotted keys, en/es parity.
- Reports page is a Server Component; `serverT(lang, key)` available; `TranslationKey` from `@/lib/i18n/types`.

---

### Task 1: `lib/reports-search.ts` — pure `matchesReportQuery`

**Files:** Create `lib/reports-search.ts`; Smoke `scripts/smoke-reports-search.ts` (throwaway).

- [ ] **Step 1: Write the failing smoke** `scripts/smoke-reports-search.ts` (wrap in `async function main(){...}; main();`):
```ts
import { matchesReportQuery } from "@/lib/reports-search";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  const item = { submitterName: "Maria Lopez", type: "closing" };
  assert(matchesReportQuery(item, "maria", "Closing") === true, "matches submitter name (ci)");
  assert(matchesReportQuery(item, "LOPEZ", "Closing") === true, "matches name case-insensitive");
  assert(matchesReportQuery(item, "clos", "Closing") === true, "matches type label substring");
  assert(matchesReportQuery(item, "cierre", "Cierre") === true, "matches localized type label");
  assert(matchesReportQuery(item, "closing", "Cierre") === true, "matches raw type key regardless of label language");
  assert(matchesReportQuery(item, "zzz", "Closing") === false, "non-match returns false");
  assert(matchesReportQuery(item, "   ", "Closing") === true, "blank query → true (defensive; caller skips)");
  assert(matchesReportQuery({ submitterName: null, type: "cash" }, "cash", "Cash") === true, "null name still matches via type");
  assert(matchesReportQuery({ submitterName: null, type: "cash" }, "maria", "Cash") === false, "null name, no name match");
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module`). `npx tsx --env-file=.env.local scripts/smoke-reports-search.ts`

- [ ] **Step 3: Create `lib/reports-search.ts`:**
```ts
/**
 * Reports Hub quick-find (Phase 1). Pure case-insensitive substring match over
 * the fields already on an authorized list row — submitter name + report type.
 * No tier-sensitive fields are touched (deep authorized-content search is a
 * separate Phase-2 cycle), so this never widens disclosure: it only filters a
 * list the viewer can already see in full.
 */
export function matchesReportQuery(
  item: { submitterName: string | null; type: string },
  q: string,
  /** Viewer-localized report-type label (e.g. "Closing" / "Cierre"). */
  typeLabel: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true; // callers skip filtering on blank q; defensive default
  const haystack = `${item.submitterName ?? ""} ${typeLabel} ${item.type}`.toLowerCase();
  return haystack.includes(needle);
}
```

- [ ] **Step 4: Run smoke → `ALL PASS`. Step 5: `npx tsc --noEmit` → clean. Step 6: delete smoke + commit:**
```bash
rm scripts/smoke-reports-search.ts
git add lib/reports-search.ts
git commit -m "feat(reports-search): pure matchesReportQuery quick-find helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: i18n `reports.search.*` (en + es)

**Files:** Modify `lib/i18n/en.json` + `es.json`; Smoke parity (throwaway).

- [ ] **Step 1:** Add to `lib/i18n/en.json` (alongside the other `reports.*` keys):
```json
  "reports.search.placeholder": "Search name or type",
  "reports.search.aria": "Search reports by name or type",
  "reports.search.label": "Search",
  "reports.search.empty": "No reports match “{q}”."
```
- [ ] **Step 2:** Add the same keys to `lib/i18n/es.json` (tú-form):
```json
  "reports.search.placeholder": "Buscar nombre o tipo",
  "reports.search.aria": "Buscar reportes por nombre o tipo",
  "reports.search.label": "Buscar",
  "reports.search.empty": "Ningún reporte coincide con “{q}”."
```
- [ ] **Step 3: Parity smoke** `scripts/smoke-search-i18n.ts` (wrap in main()): assert `Object.keys(en)` ≡ `Object.keys(es)`; assert all 4 `reports.search.*` keys present in both; assert the `{q}` token is present in both `reports.search.empty` values. Run → `ALL PASS`.
- [ ] **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
rm scripts/smoke-search-i18n.ts
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(reports-search): reports.search.* i18n (en+es)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: search input on `ReportFilterBar` + `searchQuery` empty-state on `ReportList`

**Files:** Modify `components/reports-hub/ReportFilterBar.tsx` + `components/reports-hub/ReportList.tsx`.

- [ ] **Step 1: `ReportFilterBar`** — add a `query` prop and a search input as the first field in the flex row.
  - In `ReportFilterBarProps` add: `query: string;`
  - In the destructured params add `query,`.
  - Immediately after `<div className="flex flex-wrap gap-3">` (before the Date-from block), insert:
```tsx
        {/* Free-text quick-find — matches submitter name + report type */}
        <div className="flex flex-col gap-1">
          <label htmlFor="rpt-q" className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("reports.search.label")}
          </label>
          <input
            id="rpt-q"
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("reports.search.placeholder")}
            aria-label={t("reports.search.aria")}
            className="rounded border border-co-border bg-co-bg px-2 py-1 text-sm text-co-text"
          />
        </div>
```
  (The GET form already serializes all named fields on submit, so `q` is preserved alongside `location`/`from`/`to`/`type`/`sf_*` automatically.)

- [ ] **Step 2: `ReportList`** — add an optional `searchQuery` prop and a query-specific empty message.
  - In `ReportListProps` add: `searchQuery?: string;`
  - In the destructured params add `searchQuery,`.
  - Replace the empty branch:
```tsx
  if (items.length === 0) {
    return (
      // ...existing wrapper...
      {t("reports.empty")}
      // ...
    );
  }
```
  with one that prefers the search message when a query is active:
```tsx
  if (items.length === 0) {
    const q = searchQuery?.trim();
    const message = q
      ? serverT(language, "reports.search.empty", { q })
      : t("reports.empty");
    return (
      // ...keep the SAME wrapper element/classes the file currently uses...
      {message}
      // ...
    );
  }
```
  Keep the exact wrapper markup/classes the file already has around the empty message; only swap the text expression. If `serverT` isn't already imported in `ReportList.tsx`, use the existing `t(...)` for the static case and import `serverT` for the parameterized case (or, if `t` is defined as `(key) => serverT(language, key)`, add a `serverT` import and call it directly for the `{q}` param). Report which you did.

- [ ] **Step 3:** `npx tsc --noEmit` + `npm run build` → both clean (the page doesn't yet pass `query`/`searchQuery` — `query` is required on `ReportFilterBar`, so the build will FAIL until Task 4 wires it. **Therefore: do Step 3's `tsc`/build at the END of Task 4, not here.** For Task 3, only commit after a `tsc` that may show the single "missing query prop at the page call site" error — that's expected and resolved in Task 4).

  To keep Task 3 independently green, make `query` optional with a default instead: in `ReportFilterBar` use `query = ""` default (`query?: string` in props). Then Task 3 compiles standalone. Do that — `query?: string` + `query = ""`.

- [ ] **Step 4:** `npx tsc --noEmit` → clean (with `query` optional). **Step 5:** commit:
```bash
git add components/reports-hub/ReportFilterBar.tsx components/reports-hub/ReportList.tsx
git commit -m "feat(reports-search): search input on filter bar + query-aware empty state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: wire `/reports` page (read q, filter, pass through) + final verify + PR

**Files:** Modify `app/(authed)/reports/page.tsx`.

- [ ] **Step 1:** Add `q?: string;` to the `searchParams` Promise type, and destructure `q` from `await searchParams`.

- [ ] **Step 2:** Import the helper + type at the top:
```ts
import { matchesReportQuery } from "@/lib/reports-search";
import type { TranslationKey } from "@/lib/i18n/types";
```
(If `TranslationKey` is already imported, don't duplicate.)

- [ ] **Step 3:** After `const items = await listReports(sb, {...});`, add the in-memory filter:
```ts
  // Phase-1 quick-find: filter the already-authorized list by submitter name +
  // localized report-type label + raw type key. AND-composed with the filters above.
  const query = (q ?? "").trim();
  const filteredItems = query
    ? items.filter((it) =>
        matchesReportQuery(it, query, serverT(lang, `reports.type.${it.type}` as TranslationKey)),
      )
    : items;
```

- [ ] **Step 4:** Pass `query={q ?? ""}` to `<ReportFilterBar .../>` and change the `<ReportList .../>` call to use `filteredItems` + pass `searchQuery={q ?? ""}`:
```tsx
      <ReportFilterBar
        // ...existing props...
        query={q ?? ""}
      />
      // ...
        <ReportList
          items={filteredItems}
          locationId={locationId}
          language={lang}
          viewerLevel={viewerLevel}
          searchQuery={q ?? ""}
        />
```
(Keep all existing `ReportFilterBar` props as-is; only add `query`.)

- [ ] **Step 5:** `npx tsc --noEmit` + `npm run build` → both clean. Confirm `/reports` still in the route list.

- [ ] **Step 6:** Manual smoke note for the PR (preview): type a submitter name → only their reports; type "closing" (or "cierre" in ES) → only closing; combine with a date/type filter → AND; clear box → all return; gibberish → "No reports match …" message.

- [ ] **Step 7:** Commit + push + PR:
```bash
git add "app/(authed)/reports/page.tsx"
git commit -m "feat(reports-search): wire quick-find into /reports (filter + pass-through)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin claude/reports-search
gh pr create --title "Reports Hub: free-text quick-find search (Phase 1)" --body "$(cat <<'BODY'
## What
Phase-1 quick-find on the Reports Hub: a `?q=` search box that filters the already-authorized list by **submitter name + report-type** (localized label + raw key), composed AND with the existing date/type/signal filters.

- Pure `matchesReportQuery` helper (`lib/reports-search.ts`).
- `q` text input on the existing server GET filter form (no client JS); `q` preserved across submits.
- Page filters `listReports` output in memory when `q` is present; query-aware empty state.
- i18n `reports.search.*` EN+ES.

## Security / privacy
Matches ONLY fields already shown on each authorized row (submitter name, type) — no tier-sensitive field touched, no new redaction surface. Operates on the gated + IDOR-bound `listReports` output. **No migration.**

## Deferred — Phase 2
Deep authorized-content search (notes / item labels / PM area-to-improve / cash notes / completer names), each tier-gated with redact-before-match. Its own cycle.

## Test plan
- tsc + next build clean.
- Pure smoke on matchesReportQuery (name ci, localized label, raw key, non-match, blank, null name).
- Manual (preview): name search, type search (EN + "cierre" ES), AND with filters, clear, empty-state.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```
- [ ] **Step 8:** Report the preview URL (`co-ops-git-claude-reports-search-juan-co-devs-projects.vercel.app`).

---

## Self-review

**Spec coverage:** `?q=` server-form field (T3); in-memory AND filter over authorized list (T4); match on name + localized type label + raw key (T1 helper, T4 wiring); empty-state with `{q}` (T2 key, T3 ReportList, T4 pass-through); no migration / no client JS / no redaction surface ✓; Phase 2 deferred ✓; i18n EN+ES (T2).

**Placeholder scan:** complete code in every step; no TBD. The Task 3 note about `query` optional-vs-required is resolved explicitly (make it `query?: string = ""` so Task 3 is independently green).

**Type consistency:** `matchesReportQuery(item: {submitterName, type}, q, typeLabel)` signature consistent T1↔T4; `query?: string` prop (T3) matches `query={q ?? ""}` call (T4); `searchQuery?: string` prop (T3) matches `searchQuery={q ?? ""}` call (T4); `reports.search.*` keys (T2) match all usages (T3 bar labels, ReportList empty, T4 — T4 uses only `reports.type.*` + the helper). `reports.type.${it.type}` cast to `TranslationKey` (T4).
