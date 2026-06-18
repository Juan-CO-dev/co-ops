# Reports Hub Deep Search (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/reports` search to match text inside reports (item labels/stations, completer names, completion notes, cash notes, PM feedback) — redacted to the viewer's tier before matching — with where-it-matched snippets linking to the rich detail.

**Architecture:** A `buildSearchCorpus` bulk loader assembles a per-report authorized text blob applying the exact detail-loader gates; `searchReport` matches `q` over it (deep match → snippet; name/type-only → falls back to Phase-1 `matchesReportQuery`, no snippet). The page builds the corpus only when `q` is present and filters the already-authorized list. No migration, in-memory.

**Tech Stack:** Next.js 16 App Router (Server Components), TS strict + `noUncheckedIndexedAccess`, Supabase service-role reads, Tailwind v4. No test framework — `tsc` + `next build` + throwaway `tsx` smokes (incl. a live gate-holds smoke).

**Branch:** `claude/reports-search-phase2` (created; spec committed there).

**Spec:** `docs/superpowers/specs/2026-06-18-reports-search-phase2-design.md`

---

## Ground-truth (verified)

- **`selectAllRows<T>(build, pageSize=1000)`** is currently **module-private in `lib/team-metrics.ts`** (line ~40): pages a PostgREST query via `.range(from,to)` until a short page. It must be **extracted to a shared util** so the corpus loader can use it (the corpus loads completions/evals that can exceed the 1000-row default cap — the PR #63 truncation class).
- **Detail-loader gates (mirror EXACTLY) — from `lib/reports-hub.ts`:**
  - `REPORTS_HUB_CASH_LEVEL = 4`, `REPORTS_HUB_NOTES_LEVEL = 5`.
  - Checklist detail: `checklist_template_items` → `label`, `station` (all viewers). `checklist_completions` → `completed_by` (name via `users`, all viewers), `notes` shown only when `viewer.level >= REPORTS_HUB_NOTES_LEVEL` (L5+).
  - Cash detail: `cash_reports.over_short_note` shown only when `viewer.level >= REPORTS_HUB_NOTES_LEVEL` (L5+); cash reports themselves are KH+ (already gated out of the list for <L4).
  - PM detail: `isManager = viewer.level >= REPORTS_HUB_CASH_LEVEL` (L4+) → all evals; else the eval query adds `.eq("employee_id", viewer.userId)` (own only). `pm_employee_evals` cols include `area_to_improve` (shown for whatever evals are loaded) + `note` (only `isManager && showNotes` → L4+ & L5+). `pm_reports.mvp_note` only `isManager` (L4+).
- **`ReportListItem`** (`lib/reports-hub.ts`): `{ type: ReportTypeKey, id, date, locationId, submitterName: string | null, status, signalSummary? }`. The list item does NOT carry `template_id` — checklist instances must be loaded by id to get `template_id`.
- **`lib/reports-search.ts`** has `matchesReportQuery(item, q, typeLabel)` (Phase 1). **`/reports` page** filters via `matchesReportQuery` per item with `serverT(lang, \`reports.type.${it.type}\`)` as the typeLabel; passes `query`/`searchQuery` to `ReportFilterBar`/`ReportList`. **`ReportList`** rows link to `/reports/${item.type}/${item.id}?location=${locationId}`; has `searchQuery?` prop for the empty state.
- i18n: `reports.search.{placeholder,aria,label,empty}` exist (en/es parity 979). `reports.type.<type>` exist.
- DB cols (verified earlier): `checklist_instances(id, template_id, location_id)`, `checklist_template_items(id, template_id, label, station, active)`, `checklist_completions(instance_id, template_item_id, completed_by, notes, superseded_at, revoked_at)`, `cash_reports(id, location_id, over_short_note, superseded_at)`, `pm_reports(id, location_id, mvp_note, superseded_at)`, `pm_employee_evals(pm_report_id, employee_id, area_to_improve, note, superseded_at)`, `users(id, name)`.

---

## File structure

- **Create `lib/supabase-paginate.ts`** — `selectAllRows` (moved from team-metrics).
- **Modify `lib/team-metrics.ts`** — import `selectAllRows` from the new util; delete the local copy.
- **Modify `lib/reports-search.ts`** — add corpus types + `searchReport` + `makeSnippet` (pure) + `buildSearchCorpus` (loader). Keep `matchesReportQuery` (reused by `searchReport`).
- **Modify `lib/i18n/en.json` + `es.json`** — `reports.search.snippet_field.*`.
- **Modify `components/reports-hub/ReportList.tsx`** — render a snippet line under matching rows.
- **Modify `app/(authed)/reports/page.tsx`** — build corpus + filter via `searchReport`, pass snippets to `ReportList`.

---

### Task 1: Extract `selectAllRows` to `lib/supabase-paginate.ts`

**Files:** Create `lib/supabase-paginate.ts`; Modify `lib/team-metrics.ts`; Smoke `scripts/smoke-paginate.ts` (throwaway).

- [ ] **Step 1: Read `lib/team-metrics.ts`** and copy the exact `selectAllRows` definition (≈ line 40).

- [ ] **Step 2: Create `lib/supabase-paginate.ts`:**
```ts
/**
 * Page a PostgREST query past the 1000-row default cap. `build(from, to)` must
 * return a query with `.range(from, to)` (and a stable `.order(...)`). Without
 * this, an all-rows scan silently truncates at 1000 (the PR #63 lesson).
 * Extracted from lib/team-metrics.ts so multiple loaders can share it.
 */
export async function selectAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await build(from, from + pageSize - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
```
(Match the exact current body byte-for-byte; the above is the current implementation.)

- [ ] **Step 3: In `lib/team-metrics.ts`** delete the local `async function selectAllRows<T>(...)` definition and add to the imports: `import { selectAllRows } from "@/lib/supabase-paginate";`.

- [ ] **Step 4: Behavior-preserving smoke** `scripts/smoke-paginate.ts` (wrap in `main()`): import `loadTeamOperatingHealth` from `@/lib/team-metrics`, run it for a real location (day/compare:true), assert `members.length >= 0` and ranked-desc holds (proves the moved pagination still works end-to-end). Run → `ALL PASS`.

- [ ] **Step 5:** `npx tsc --noEmit` → clean. **Step 6:** delete smoke + commit:
```bash
rm scripts/smoke-paginate.ts
git add lib/supabase-paginate.ts lib/team-metrics.ts
git commit -m "refactor: extract selectAllRows to lib/supabase-paginate (shared by search corpus)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `searchReport` + `makeSnippet` (pure) in `lib/reports-search.ts`

**Files:** Modify `lib/reports-search.ts`; Smoke `scripts/smoke-search-report.ts` (throwaway).

- [ ] **Step 1: Append to `lib/reports-search.ts`** (keep the existing `matchesReportQuery`):
```ts
/** A field of authorized searchable text for one report. `fieldKey` selects
 *  the snippet label (reports.search.snippet_field.<fieldKey>). */
export interface SearchCorpusField {
  fieldKey: "item" | "station" | "completer" | "note" | "cash_note" | "area_to_improve" | "pm_note" | "mvp_note";
  text: string;
}

export interface SearchCorpusEntry {
  fields: SearchCorpusField[];
}

export interface SearchSnippet {
  fieldKey: SearchCorpusField["fieldKey"];
  text: string; // ellipsized context window around the match
}

export interface SearchResult {
  matched: boolean;
  snippet?: SearchSnippet;
}

/** Ellipsized ~60-char window centered on the first occurrence of `needle` (already lowercased) in `text`. */
export function makeSnippet(text: string, needle: string, radius = 28): string {
  const idx = text.toLowerCase().indexOf(needle);
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Match `q` for one report. Prefers a DEEP field match (returns a snippet);
 * otherwise falls back to the Phase-1 name/type match (matched, no snippet).
 * `entry` is the viewer-authorized corpus (already redacted), so any snippet is safe.
 */
export function searchReport(
  base: { submitterName: string | null; type: string },
  typeLabel: string,
  entry: SearchCorpusEntry | undefined,
  q: string,
): SearchResult {
  const needle = q.trim().toLowerCase();
  if (!needle) return { matched: true };
  // 1. Deep fields first → informative snippet.
  for (const f of entry?.fields ?? []) {
    if (f.text.toLowerCase().includes(needle)) {
      return { matched: true, snippet: { fieldKey: f.fieldKey, text: makeSnippet(f.text, needle) } };
    }
  }
  // 2. Fall back to Phase-1 name/type (no snippet — those fields are already on the row).
  if (matchesReportQuery(base, q, typeLabel)) return { matched: true };
  return { matched: false };
}
```

- [ ] **Step 2: Smoke** `scripts/smoke-search-report.ts` (wrap in `main()`):
```ts
import { searchReport, makeSnippet } from "@/lib/reports-search";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  const base = { submitterName: "Maria", type: "closing" };
  const entry = { fields: [{ fieldKey: "note" as const, text: "speed on the slicer during rush was slow" }] };

  const deep = searchReport(base, "Closing", entry, "slicer");
  assert(deep.matched && deep.snippet?.fieldKey === "note", "deep match returns note snippet");
  assert(deep.snippet!.text.includes("slicer") && deep.snippet!.text.includes("…"), "snippet windows around match + ellipsizes");

  const nameOnly = searchReport(base, "Closing", entry, "maria");
  assert(nameOnly.matched && !nameOnly.snippet, "name match → matched, no snippet");

  const typeOnly = searchReport(base, "Closing", entry, "clos");
  assert(typeOnly.matched && !typeOnly.snippet, "type match → matched, no snippet");

  const none = searchReport(base, "Closing", entry, "zzz");
  assert(!none.matched, "no match");

  const blank = searchReport(base, "Closing", entry, "  ");
  assert(blank.matched && !blank.snippet, "blank q → matched all, no snippet");

  const noEntry = searchReport(base, "Closing", undefined, "slicer");
  assert(!noEntry.matched, "no corpus entry + deep-only term → no match");

  assert(makeSnippet("abcdefghij", "cd", 2).startsWith("…") === false && makeSnippet("the quick brown fox jumps", "brown").includes("…"), "snippet ellipsis edges");
  console.log("ALL PASS");
}
main();
```

- [ ] **Step 3:** Run → `ALL PASS`. **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
rm scripts/smoke-search-report.ts
git add lib/reports-search.ts
git commit -m "feat(reports-search-p2): searchReport + makeSnippet (deep match → snippet, name/type fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `buildSearchCorpus` loader in `lib/reports-search.ts`

**Files:** Modify `lib/reports-search.ts` (append + imports); Smoke `scripts/smoke-corpus.ts` (throwaway, live gate-holds).

- [ ] **Step 1: Add imports** at the top of `lib/reports-search.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/supabase-paginate";
import { REPORTS_HUB_CASH_LEVEL, REPORTS_HUB_NOTES_LEVEL, type ReportListItem } from "@/lib/reports-hub";
```

- [ ] **Step 2: Append `buildSearchCorpus`:**
```ts
/**
 * Build the viewer-authorized searchable corpus for a set of already-authorized
 * report list items. Applies the EXACT detail-loader gates BEFORE returning any
 * text, so a later match/snippet can never disclose a field the viewer can't see:
 *   - item labels / stations / completer names → all viewers
 *   - completion notes + cash over/short note   → L5+ (REPORTS_HUB_NOTES_LEVEL)
 *   - PM area_to_improve → managers (L4+) all evals; employees own only
 *   - PM note / mvp_note → L4+ (note further L5+)
 * Bulk-loaded + paginated (selectAllRows) over the in-window report ids, bound to
 * locationId. Keyed `${type}:${id}`. Build ONLY when q is non-empty (caller gates).
 */
export async function buildSearchCorpus(
  service: SupabaseClient,
  args: { viewer: { userId: string; level: number }; locationId: string; items: ReportListItem[] },
): Promise<Map<string, SearchCorpusEntry>> {
  const corpus = new Map<string, SearchCorpusEntry>();
  const push = (key: string, fieldKey: SearchCorpusField["fieldKey"], text: string | null | undefined) => {
    if (!text || !text.trim()) return;
    let e = corpus.get(key);
    if (!e) { e = { fields: [] }; corpus.set(key, e); }
    e.fields.push({ fieldKey, text });
  };
  const showNotes = args.viewer.level >= REPORTS_HUB_NOTES_LEVEL;
  const isManager = args.viewer.level >= REPORTS_HUB_CASH_LEVEL;

  // ── Checklist reports (opening/closing/am_prep/mid_day) ──
  const checklistItems = args.items.filter((it) => it.type !== "cash" && it.type !== "pm");
  const instanceIds = checklistItems.map((it) => it.id);
  const keyByInstance = new Map(checklistItems.map((it) => [it.id, `${it.type}:${it.id}`] as const));
  if (instanceIds.length) {
    // instance → template_id (location-bound)
    const insts = await selectAllRows<{ id: string; template_id: string }>(
      (from, to) => service.from("checklist_instances").select("id, template_id")
        .eq("location_id", args.locationId).in("id", instanceIds)
        .order("id", { ascending: true }).range(from, to),
    );
    const templateIdByInstance = new Map(insts.map((r) => [r.id, r.template_id] as const));
    const templateIds = [...new Set(insts.map((r) => r.template_id))];

    // template items: labels + stations, grouped by template_id
    const titemsByTemplate = new Map<string, { label: string; station: string }[]>();
    if (templateIds.length) {
      const titems = await selectAllRows<{ template_id: string; label: string; station: string }>(
        (from, to) => service.from("checklist_template_items").select("template_id, label, station")
          .in("template_id", templateIds).eq("active", true)
          .order("template_id", { ascending: true }).range(from, to),
      );
      for (const ti of titems) {
        const arr = titemsByTemplate.get(ti.template_id) ?? [];
        arr.push({ label: ti.label, station: ti.station });
        titemsByTemplate.set(ti.template_id, arr);
      }
    }
    // attach labels/stations per instance (all viewers)
    for (const inst of insts) {
      const key = keyByInstance.get(inst.id);
      if (!key) continue;
      for (const ti of titemsByTemplate.get(inst.template_id) ?? []) {
        push(key, "item", ti.label);
        push(key, "station", ti.station);
      }
    }

    // live completions: completer names (all) + notes (L5+)
    const comps = await selectAllRows<{ instance_id: string; completed_by: string | null; notes: string | null }>(
      (from, to) => service.from("checklist_completions").select("instance_id, completed_by, notes")
        .in("instance_id", instanceIds).is("superseded_at", null).is("revoked_at", null)
        .order("instance_id", { ascending: true }).range(from, to),
    );
    const completerIds = [...new Set(comps.map((c) => c.completed_by).filter((v): v is string => !!v))];
    const nameById = new Map<string, string>();
    if (completerIds.length) {
      const { data: users } = await service.from("users").select("id, name").in("id", completerIds);
      for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
    }
    for (const c of comps) {
      const key = keyByInstance.get(c.instance_id);
      if (!key) continue;
      if (c.completed_by) push(key, "completer", nameById.get(c.completed_by));
      if (showNotes) push(key, "note", c.notes);
    }
  }

  // ── Cash reports (over/short note, L5+ only) ──
  if (showNotes) {
    const cashItems = args.items.filter((it) => it.type === "cash");
    const cashIds = cashItems.map((it) => it.id);
    if (cashIds.length) {
      const { data: cash } = await service.from("cash_reports").select("id, over_short_note")
        .eq("location_id", args.locationId).in("id", cashIds).is("superseded_at", null);
      for (const r of (cash ?? []) as Array<{ id: string; over_short_note: string | null }>) {
        push(`cash:${r.id}`, "cash_note", r.over_short_note);
      }
    }
  }

  // ── PM reports (area_to_improve / note / mvp_note, gated) ──
  const pmItems = args.items.filter((it) => it.type === "pm");
  const pmIds = pmItems.map((it) => it.id);
  if (pmIds.length) {
    if (isManager) {
      const { data: reps } = await service.from("pm_reports").select("id, mvp_note")
        .eq("location_id", args.locationId).in("id", pmIds).is("superseded_at", null);
      for (const r of (reps ?? []) as Array<{ id: string; mvp_note: string | null }>) {
        push(`pm:${r.id}`, "mvp_note", r.mvp_note);
      }
    }
    let evalQuery = service.from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
      .in("pm_report_id", pmIds).is("superseded_at", null);
    if (!isManager) evalQuery = evalQuery.eq("employee_id", args.viewer.userId); // own only
    const { data: evals } = await evalQuery;
    for (const e of (evals ?? []) as Array<{ pm_report_id: string; area_to_improve: string | null; note: string | null }>) {
      push(`pm:${e.pm_report_id}`, "area_to_improve", e.area_to_improve);
      if (isManager && showNotes) push(`pm:${e.pm_report_id}`, "pm_note", e.note);
    }
  }

  return corpus;
}
```

- [ ] **Step 3: Live gate-holds smoke** `scripts/smoke-corpus.ts` (wrap in `main()`):
```ts
import { listReports } from "@/lib/reports-hub";
import { buildSearchCorpus, searchReport } from "@/lib/reports-search";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { operationalNow } from "@/lib/midshift";
function assert(c: boolean, m: string) { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok: ${m}`); }
async function main() {
  const sb = getServiceRoleClient();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).order("code").limit(1).maybeSingle<{ id: string }>();
  if (!loc) { console.log("no loc"); return; }
  const to = operationalNow(new Date()).date;
  const from = operationalNow(new Date(Date.now() - 60 * 86400000)).date; // 60-day window for coverage

  // L5 (sees notes) vs L3 (cannot)
  const l5 = { userId: "smoke5", level: 5 };
  const l3 = { userId: "smoke3", level: 3 };
  const itemsL5 = await listReports(sb, { viewer: l5, locationId: loc.id, dateFrom: from, dateTo: to });
  const itemsL3 = await listReports(sb, { viewer: l3, locationId: loc.id, dateFrom: from, dateTo: to });

  const corpusL5 = await buildSearchCorpus(sb, { viewer: l5, locationId: loc.id, items: itemsL5 });
  const corpusL3 = await buildSearchCorpus(sb, { viewer: l3, locationId: loc.id, items: itemsL3 });

  // find a completion note that exists in L5 corpus
  let noteText: string | null = null;
  for (const e of corpusL5.values()) { const n = e.fields.find((f) => f.fieldKey === "note"); if (n) { noteText = n.text; break; } }
  if (noteText) {
    const word = noteText.split(/\s+/).find((w) => w.length >= 4) ?? noteText.slice(0, 4);
    // L5 can find it
    const anyL5 = [...corpusL5.values()].some((e) => searchReport({ submitterName: null, type: "closing" }, "Closing", e, word).snippet?.fieldKey === "note");
    assert(anyL5, "L5 finds the note via deep search (snippet)");
    // L3 corpus must NOT contain any note field at all (gate holds)
    const l3HasNotes = [...corpusL3.values()].some((e) => e.fields.some((f) => f.fieldKey === "note"));
    assert(!l3HasNotes, "L3 corpus contains ZERO note fields (notes gate holds)");
  } else {
    console.log("(no completion notes in window; note-gate sub-check skipped)");
    const l3HasNotes = [...corpusL3.values()].some((e) => e.fields.some((f) => f.fieldKey === "note"));
    assert(!l3HasNotes, "L3 corpus contains ZERO note fields");
  }
  // cash notes only in L5 corpus
  assert(![...corpusL3.values()].some((e) => e.fields.some((f) => f.fieldKey === "cash_note")), "L3 corpus has no cash_note");
  // item/station present for someone (structural, all viewers) — sanity
  assert([...corpusL5.values()].some((e) => e.fields.some((f) => f.fieldKey === "item")) || itemsL5.length === 0, "item labels present in corpus (when reports exist)");

  // IDOR: bogus location → empty corpus
  const bogus = await buildSearchCorpus(sb, { viewer: l5, locationId: "00000000-0000-0000-0000-000000000000", items: itemsL5 });
  assert(bogus.size === 0, "bogus location → empty corpus (no cross-location text)");

  console.log("ALL PASS");
}
main();
```
Note: the IDOR check passes `itemsL5` (real ids) with a bogus `locationId`; because every query binds `location_id = bogusLoc`, no rows return → empty corpus, proving the corpus can't be coerced to load another location's text.

- [ ] **Step 4:** Run → `ALL PASS`. **Step 5:** `tsc` clean. **Step 6:** delete smoke + commit:
```bash
rm scripts/smoke-corpus.ts
git add lib/reports-search.ts
git commit -m "feat(reports-search-p2): buildSearchCorpus — tier-gated authorized text, paginated, IDOR-bound

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: i18n `reports.search.snippet_field.*`

**Files:** Modify `lib/i18n/en.json` + `es.json`; parity smoke (throwaway).

- [ ] **Step 1: en.json** (near the other `reports.search.*` keys):
```json
  "reports.search.snippet_field.item": "Item",
  "reports.search.snippet_field.station": "Station",
  "reports.search.snippet_field.completer": "Done by",
  "reports.search.snippet_field.note": "Note",
  "reports.search.snippet_field.cash_note": "Cash note",
  "reports.search.snippet_field.area_to_improve": "Feedback",
  "reports.search.snippet_field.pm_note": "Note",
  "reports.search.snippet_field.mvp_note": "MVP note"
```
- [ ] **Step 2: es.json** (tú-form):
```json
  "reports.search.snippet_field.item": "Artículo",
  "reports.search.snippet_field.station": "Estación",
  "reports.search.snippet_field.completer": "Hecho por",
  "reports.search.snippet_field.note": "Nota",
  "reports.search.snippet_field.cash_note": "Nota de efectivo",
  "reports.search.snippet_field.area_to_improve": "Comentario",
  "reports.search.snippet_field.pm_note": "Nota",
  "reports.search.snippet_field.mvp_note": "Nota MVP"
```
- [ ] **Step 3: Parity smoke** (assert key parity + the 8 `snippet_field.*` keys present in both). Run → `ALL PASS`. **Step 4:** `tsc` clean. **Step 5:** delete smoke + commit:
```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(reports-search-p2): snippet_field.* i18n (en+es)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `ReportList` snippet rendering

**Files:** Modify `components/reports-hub/ReportList.tsx`.

- [ ] **Step 1:** Add a `snippets` prop and render a snippet line. Import the snippet type:
  - Add to imports: `import type { SearchSnippet } from "@/lib/reports-search";` and `type { TranslationKey }` (already imported).
  - In `ReportListProps` add: `snippets?: Map<string, SearchSnippet>;` (keyed `${type}:${id}`).
  - In the destructure add `snippets,`.
  - Inside the `items.map((item) => { ... })` body, after the row link element (still inside the `<li>`), look up `const snip = snippets?.get(\`${item.type}:${item.id}\`);` and render when present, beneath the row:
```tsx
                {snip ? (
                  <p className="mt-1 px-1 text-xs text-co-text-muted">
                    <span className="font-semibold text-co-text-dim">
                      {serverT(language, `reports.search.snippet_field.${snip.fieldKey}` as TranslationKey)}:
                    </span>{" "}
                    <span className="italic">“{snip.text}”</span>
                  </p>
                ) : null}
```
  Place the lookup at the top of the map callback (alongside the existing `href`/`dateLabel` consts) and the JSX inside the `<li>` after the closing `</a>` of the row link. (Read the current `<li>` structure and slot it in without disturbing the link.)

- [ ] **Step 2:** `npx tsc --noEmit` → clean (the page doesn't pass `snippets` yet; it's optional, so this compiles standalone). **Step 3:** commit:
```bash
git add components/reports-hub/ReportList.tsx
git commit -m "feat(reports-search-p2): render where-it-matched snippet under matching rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire `/reports` page + verify + PR

**Files:** Modify `app/(authed)/reports/page.tsx`.

- [ ] **Step 1:** Update imports: replace `import { matchesReportQuery } from "@/lib/reports-search";` with `import { buildSearchCorpus, searchReport, type SearchSnippet } from "@/lib/reports-search";`.

- [ ] **Step 2:** Replace the Phase-1 filter block (`const query = (qParam ?? "").trim(); const filteredItems = query ? items.filter((it) => matchesReportQuery(...)) : items;`) with the corpus-backed version:
```ts
  // Phase-2 deep search: when q is present, build the viewer-authorized corpus
  // for the listed reports and match q over name/type + authorized deep fields.
  // Corpus is redacted to the viewer BEFORE matching, so a match/snippet can
  // never disclose a field the viewer can't see. Built ONLY when q is non-empty.
  const query = (qParam ?? "").trim();
  let filteredItems = items;
  const snippets = new Map<string, SearchSnippet>();
  if (query) {
    const corpus = await buildSearchCorpus(sb, { viewer, locationId, items });
    filteredItems = items.filter((it) => {
      const typeLabel = serverT(lang, `reports.type.${it.type}` as TranslationKey);
      const res = searchReport(
        { submitterName: it.submitterName, type: it.type },
        typeLabel,
        corpus.get(`${it.type}:${it.id}`),
        query,
      );
      if (res.matched && res.snippet) snippets.set(`${it.type}:${it.id}`, res.snippet);
      return res.matched;
    });
  }
```
(`viewer`, `locationId`, `lang`, `sb` already in scope. `TranslationKey` already imported from the Phase-1 work.)

- [ ] **Step 3:** Pass `snippets` to `ReportList` (keep the `items={filteredItems}` + `searchQuery={qParam ?? ""}` already there):
```tsx
        <ReportList
          items={filteredItems}
          locationId={locationId}
          language={lang}
          viewerLevel={viewerLevel}
          searchQuery={qParam ?? ""}
          snippets={snippets}
        />
```

- [ ] **Step 4:** `npx tsc --noEmit` + `npm run build` → both clean. Confirm `/reports` still in the route list. (`matchesReportQuery` is now only used internally by `searchReport` — no dead export; leave it.)

- [ ] **Step 5:** Commit + push + PR:
```bash
git add "app/(authed)/reports/page.tsx"
git commit -m "feat(reports-search-p2): wire deep corpus search into /reports (filter + snippets)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin claude/reports-search-phase2
gh pr create --title "Reports Hub: deep authorized-content search (Phase 2)" --body "$(cat <<'BODY'
## What
Phase-2 deep search on `/reports`: `?q=` now matches text INSIDE reports — item labels/stations, completer names, completion notes, cash over/short notes, PM feedback — each **redacted to the viewer's tier BEFORE matching**, with where-it-matched **snippets** linking to the rich detail.

- `buildSearchCorpus` assembles a per-report authorized text blob applying the exact detail-loader gates (notes/cash-note L5+; PM evals own-for-employees/all-for-managers; labels/stations/completer-names all). Paginated (`selectAllRows`, now shared in `lib/supabase-paginate.ts`), location-bound, built ONLY when q is present.
- `searchReport` matches over name/type + corpus; deep match → snippet, name/type-only → plain row (Phase-1 fallback).
- Snippet line under matching rows; rows link to the existing rich detail.
- i18n `reports.search.snippet_field.*` EN+ES.

## Security / privacy
The corpus is the viewer-authorized projection (mirrors loadChecklistDetail/loadCashDetail/loadPmDetail gates) — matching only ever touches text the viewer could already open, so no match or snippet can leak a redacted field. Live smoke proves an L3 corpus contains ZERO note/cash_note fields. IDOR: corpus binds every query to the authorized location.

## NO migration. In-memory; zero cost on the default (unfiltered) list.

## Deferred
Maintenance-notes as a hub report type; unified cross-surface search; Postgres FTS.

## Test plan
- tsc + next build clean.
- Pure smoke (searchReport/makeSnippet): deep match → note snippet, name/type fallback no snippet, no-corpus deep term no match, snippet windowing.
- Live gate-holds smoke: L5 finds a completion note; L3 corpus has zero note + zero cash_note fields; bogus location → empty corpus.
- Manual (preview): search a word inside a note as SL+ → snippet result; as an employee → that note never matches; item-label search; AND with filters.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```
- [ ] **Step 6:** Report the preview URL (`co-ops-git-claude-reports-search-phase2-juan-co-devs-projects.vercel.app`).

---

## Self-review

**Spec coverage:** corpus per-field gates (T3 — mirrors loaders); redact-before-match invariant (T3 builds gated, T2 matches) ✓; snippet for deep / plain for name-type (T2 searchReport) ✓; snippet UI (T5) + link to rich detail (existing rows); composition AND with filters + subsumes Phase-1 (T6) ✓; bulk loader paginated + location-bound + q-gated (T3) ✓; selectAllRows shared (T1) ✓; i18n (T4); no migration ✓; deferred listed ✓.

**Placeholder scan:** complete code T1–T4, T6; structural-with-exact-JSX for T5. No TBD.

**Type consistency:** `SearchCorpusField`/`SearchCorpusEntry`/`SearchSnippet`/`SearchResult` defined T2, consumed T3 (`push` builds `fields`), T5 (`snippets: Map<string, SearchSnippet>`), T6 (`searchReport` → `res.snippet`); `searchReport(base, typeLabel, entry, q)` signature consistent T2↔T6; `buildSearchCorpus(service, {viewer, locationId, items})` consistent T3↔T6; key format `${type}:${id}` consistent across T3 (push keys), T5 (lookup), T6 (set/get). `selectAllRows` import path `@/lib/supabase-paginate` consistent T1↔T3.

**Flag:** the 60-day window in the corpus smoke is for *coverage* (find a real note); production search uses the hub's date filter (default 14d). Corpus built only when q non-empty, so the default list pays nothing.
