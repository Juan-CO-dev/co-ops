# Catering Pipeline Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let catering staff look up a pipeline lead by email / phone / contact name / company — a server-side federated `ilike` search integrated into the existing board via `?q=`, rendering inline result cards (with email + current-quote enrichment).

**Architecture:** A `searchPipeline` lib fn (federated `ilike` over leads + the customer's email/phone/name + company name, injection-sanitized like `listUsers`, location-scoped via `readScopeOr`, enriched). The board page branches on `?q=` to render results instead of the kanban; the board client gets a search box. No new route, table, or migration.

**Tech Stack:** Next.js 16 (App Router, `searchParams` is a Promise), React 19, Tailwind v4, TS strict + `noUncheckedIndexedAccess`, Supabase (service-role + RLS), integer-cents money. Tests = `tsx` seeded smoke. Branch: `claude/catering-pipeline-search`.

**Model tiering:** CC authors T1 (lib) inline + reviews all; Sonnet 4.6 on T2 (UI); Fable 5 on T3 (smoke). CC is SOLE reviewer + owns all git.

---

## Confirm-before-authoring — VERIFIED against live DB + code (2026-07-20)

- `lib/catering/pipeline.ts` (verbatim-read): `PipelineLead` view + `DbLeadRow` + `LEAD_COLS` + `mapLead(r)` + `readScopeOr(actor) → string|null` + `loadPipelineBoard(actor)` + `requireLevel` + `PIPELINE_READ_MIN=5`; imports `getServiceRoleClient`, `isPipelineStage`, `AuthContext`, `isAllLocationsAccess`/`locActor`. **`.in.(...)` inside a `.or()` string is already proven here** (`readScopeOr` → `location_id.in.(...)`). `catering_pipeline` searchable text: `contact_name`, `company`, `contact_phone`, `event_name`; FK `customer_id → catering_customers`.
- `catering_customers`: `id, name, email, phone, company_id → catering_companies(id)` (migration 0122). `catering_companies`: `id, name`. `catering_quotes`: `pipeline_id, status, total_cents, superseded_at, created_at`.
- Search precedent `lib/admin/users.ts:103-112`: `query.trim().replace(/[,()\\"]/g, "")` → `.or("name.ilike.%t%,email.ilike.%t%")`.
- Board UI `app/(authed)/catering/pipeline/page.tsx` (verbatim-read): gate `getRoleLevel < PIPELINE_READ_MIN → redirect("/dashboard")`; `Promise.all([loadPipelineBoard(auth), loadFollowUps(auth, today)])`; loads `locations`; renders `<PipelineClient leads followUps locations actorLevel={level} writeMin={PIPELINE_WRITE_MIN} />`. Route `/catering/pipeline`. `PipelineClient` (verbatim-read): props `{leads, followUps, locations, actorLevel, writeMin}`, uses `useRouter`, `useTranslation`, `formatCents`, groups leads by stage; **no per-lead detail page**.
- **NO migration.**

## File Structure

- **Modify** `lib/catering/pipeline.ts` — add `PipelineSearchResult` + `searchPipeline`.
- **Modify** `app/(authed)/catering/pipeline/page.tsx` — branch on `?q=`: search → results; else board.
- **Modify** `components/catering/pipeline/PipelineClient.tsx` — a search box (always) + a results-card view when `results` are passed.
- **Modify** `lib/i18n/en.json` + `lib/i18n/es.json` — `catering.pipeline.search.*` keys.
- **Create** `scripts/pipeline-search-smoke.ts` — seeded federated-search smoke.

---

## Task 1: `searchPipeline` lib (CC)

**Files:** Modify `lib/catering/pipeline.ts` (add the type + fn; place after `loadPipelineBoard`).

**Context:** Federated `ilike` search. Sanitize the term like `listUsers`; resolve customer ids (email/phone/name) + company-name → customers; search leads by own fields OR matched customer ids, location-scoped; enrich with email + current quote. Reuses `LEAD_COLS`/`mapLead`/`readScopeOr`/`requireLevel`/`getServiceRoleClient`/`DbLeadRow` already in the file.

- [ ] **Step 1: Add the type + fn**
```ts
export interface PipelineSearchResult extends PipelineLead {
  email: string | null;
  quoteStatus: string | null;
  quoteTotalCents: number | null;
}

/**
 * Federated ilike search over leads + their customer (email/phone/name) + company name.
 * Location-scoped (readScopeOr) + injection-sanitized (mirrors lib/admin/users.ts listUsers).
 * Enriches each result with the customer email + the current (latest non-superseded) quote.
 */
export async function searchPipeline(actor: AuthContext, args: { query: string }): Promise<PipelineSearchResult[]> {
  requireLevel(actor, PIPELINE_READ_MIN);
  // A-WB4-01 filter-injection defense: strip PostgREST structural chars from the .or() term.
  const raw = args.query.trim().replace(/[,()\\"]/g, "");
  if (!raw) return [];
  const sb = getServiceRoleClient();
  const term = `%${raw}%`;

  // 1. Customer ids matching email/phone/name, plus customers of companies whose name matches.
  const matchedCustomerIds = new Set<string>();
  const { data: custRows, error: cErr } = await sb
    .from("catering_customers")
    .select("id")
    .or(`email.ilike.${term},phone.ilike.${term},name.ilike.${term}`)
    .returns<Array<{ id: string }>>();
  if (cErr) throw new Error(`searchPipeline customers: ${cErr.message}`);
  for (const c of custRows ?? []) matchedCustomerIds.add(c.id);

  const { data: compRows, error: coErr } = await sb
    .from("catering_companies")
    .select("id")
    .ilike("name", term)
    .returns<Array<{ id: string }>>();
  if (coErr) throw new Error(`searchPipeline companies: ${coErr.message}`);
  const companyIds = (compRows ?? []).map((c) => c.id);
  if (companyIds.length) {
    const { data: compCust, error: ccErr } = await sb
      .from("catering_customers")
      .select("id")
      .in("company_id", companyIds)
      .returns<Array<{ id: string }>>();
    if (ccErr) throw new Error(`searchPipeline company customers: ${ccErr.message}`);
    for (const c of compCust ?? []) matchedCustomerIds.add(c.id);
  }

  // 2. Search leads: own text fields OR matched customer ids, location-scoped.
  const orParts = [`contact_name.ilike.${term}`, `company.ilike.${term}`, `contact_phone.ilike.${term}`, `event_name.ilike.${term}`];
  if (matchedCustomerIds.size) orParts.push(`customer_id.in.(${[...matchedCustomerIds].join(",")})`);
  let q = sb.from("catering_pipeline").select(LEAD_COLS);
  const scope = readScopeOr(actor);
  if (scope) q = q.or(scope); // AND-ed with the identity OR-group below (two .or() calls = AND of groups)
  q = q.or(orParts.join(","));
  const { data: leadRows, error } = await q.order("created_at", { ascending: false }).returns<DbLeadRow[]>();
  if (error) throw new Error(`searchPipeline leads: ${error.message}`);
  const leads = (leadRows ?? []).map(mapLead);
  if (leads.length === 0) return [];

  // 3. Enrich: email (per customer) + current quote (latest non-superseded per lead).
  const custIds = [...new Set(leads.map((l) => l.customerId).filter((x): x is string => !!x))];
  const emailByCustomer = new Map<string, string | null>();
  if (custIds.length) {
    const { data } = await sb.from("catering_customers").select("id, email").in("id", custIds).returns<Array<{ id: string; email: string | null }>>();
    for (const c of data ?? []) emailByCustomer.set(c.id, c.email);
  }
  const leadIds = leads.map((l) => l.id);
  const quoteByLead = new Map<string, { status: string; total_cents: number }>();
  const { data: qRows } = await sb
    .from("catering_quotes")
    .select("pipeline_id, status, total_cents, created_at")
    .in("pipeline_id", leadIds)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .returns<Array<{ pipeline_id: string; status: string; total_cents: number; created_at: string }>>();
  for (const qr of qRows ?? []) if (!quoteByLead.has(qr.pipeline_id)) quoteByLead.set(qr.pipeline_id, { status: qr.status, total_cents: qr.total_cents }); // first seen = latest (desc order)

  return leads.map((l) => {
    const quote = quoteByLead.get(l.id);
    return {
      ...l,
      email: l.customerId ? (emailByCustomer.get(l.customerId) ?? null) : null,
      quoteStatus: quote?.status ?? null,
      quoteTotalCents: quote?.total_cents ?? null,
    };
  });
}
```

- [ ] **Step 2: Typecheck + commit**
```bash
npm run typecheck
git add lib/catering/pipeline.ts
git commit -m "feat(pipeline-search): searchPipeline — federated ilike (lead + customer email/phone + company) + enrichment"
```

---

## Task 2: UI — board search box + `?q=` results view (Sonnet)

**Files:** Modify `app/(authed)/catering/pipeline/page.tsx`; Modify `components/catering/pipeline/PipelineClient.tsx`; Modify `lib/i18n/en.json` + `lib/i18n/es.json`.

**Context (read first):** the board `page.tsx` (gate + `Promise.all([loadPipelineBoard, loadFollowUps])` + `<PipelineClient>`); `PipelineClient.tsx` (props `{leads, followUps, locations, actorLevel, writeMin}`, `useRouter`, `useTranslation`, `formatCents`, groups by stage, `stageKey(s)` for stage labels). Contracts:
- `searchPipeline(auth, { query }) → PipelineSearchResult[]` = `PipelineLead & { email, quoteStatus, quoteTotalCents }` (from `lib/catering/pipeline.ts`). `PIPELINE_READ_MIN` already imported in the page.

- [ ] **Step 1:** `page.tsx` — accept `searchParams: Promise<Record<string, string | string[] | undefined>>`, `await` it. Read `const q = typeof sp.q === "string" ? sp.q : ""`. When `q.trim()` is non-empty: `const results = await searchPipeline(auth, { query: q })` and render `<PipelineClient ... searchQuery={q} results={results} />` (still pass `leads`/`followUps` as empty arrays `[]` in search mode to avoid the board load, OR load them anyway — prefer: skip the board load in search mode). When empty: the existing `Promise.all` board path, passing `searchQuery=""` + `results={null}`. Import `searchPipeline` + `type PipelineSearchResult`.
- [ ] **Step 2:** `PipelineClient.tsx` — add props `searchQuery: string` + `results: PipelineSearchResult[] | null`. Add a **search box** at the top (always visible): a `<form>` with an input (default value `searchQuery`) that on submit does `router.push(\`/catering/pipeline?q=\${encodeURIComponent(value)}\`)`; a clear/"×" affordance → `router.push("/catering/pipeline")`. When `results != null` (search mode): render a **"N results for '{q}'"** header + a flat list of **result cards** (contact name bold + company + a stage badge via `stageKey` + event date + phone + `email` + the quote: `quoteStatus` + `formatCents(quoteTotalCents)` when non-null), and an **empty state** ("No leads match '{q}'") when `results.length === 0`; do NOT render the kanban/follow-ups in search mode. When `results == null`: the existing board renders unchanged.
- [ ] **Step 3:** i18n — add `catering.pipeline.search.*` keys to BOTH `lib/i18n/en.json` and `lib/i18n/es.json` (EN + ES tú-form): `placeholder`, `submit`, `clear`, `results_header` (`{n}` `{q}`), `empty` (`{q}`), `email_label`, `phone_label`, `quote_label`, `no_quote`, ARIA labels. One key per string. Match the `catering.pipeline.*` key style.
- [ ] **Step 4: Build gate + commit**
```bash
npm run build
git add "app/(authed)/catering/pipeline/page.tsx" components/catering/pipeline/PipelineClient.tsx lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(pipeline-search): board search box + ?q= results view + i18n"
```

---

## Task 3: Seeded smoke (Fable)

**Files:** Create `scripts/pipeline-search-smoke.ts`.

**Context:** Mirror `scripts/w4b-smoke.ts` / `scripts/w4a-smoke.ts` structure (service-role, seed → drive REAL lib → assert → hard-delete in `finally`, zero residue, `pipeline-search-smoke: PASS`, plain `main().catch()`). Run: `npx tsx --env-file=.env.local scripts/pipeline-search-smoke.ts`. Minimal actor: a real cgs user cast `{ user:{id,role}, locations:[] } as unknown as AuthContext` — NOTE cgs is level 10 (all-locations), so `readScopeOr` returns null → the actor sees all locations (assert INCLUSION; location-exclusion needs a lower-level actor and is covered by the board's existing scoping — don't try to assert exclusion here).

- [ ] **Step 1: Seed** at a real active location (capture every id): a `catering_companies` (`name` = "W4 SMOKE Acme Corp"); a `catering_customers` (`name`, `email`="pssmoke@acme-test.example", `phone`="5551234999", `company_id` = the company, `primary_location_id` = location, active); 3 `catering_pipeline` leads (`contact_name` NOT NULL, `location_id` = location, `stage`='inquiry'): **A** contact_name "PSSMOKE Alice Nomatch" (matches a NAME term "Alice Nomatch"); **B** contact_name "PSSMOKE Bob", `customer_id` = the seeded customer (matches by EMAIL/company-via-customer); **C** contact_name "PSSMOKE Carol", `company` (text) = "W4 SMOKE Acme Corp" (matches the COMPANY term directly). A `catering_quotes` on **B** (`pipeline_id`=B, `status`='accepted', `total_cents`=12345, superseded_at null, version 1, event_date, location_id). Check NOT NULL cols before inserting (mirror w4a-smoke's quote/customer seed shapes).
- [ ] **Step 2: Assert `searchPipeline`:**
  - by name term "Alice Nomatch" → results include A (and only leads matching that unique term).
  - by email term "pssmoke@acme-test.example" → includes B; assert the B result's `email` = the seeded email + `quoteStatus`="accepted" + `quoteTotalCents`=12345 (the enrichment).
  - by phone term "5551234999" → includes B (via customer phone).
  - by company term "W4 SMOKE Acme Corp" → includes C (direct `company` text) AND B (via `company_id`) — assert both are present.
  - by an injection-laced term like `"Acme),("` → does NOT throw; returns sensibly (the `,()` stripped → matches "Acme").
  - by a gibberish term "zzznomatchzzz" → returns `[]`.
- [ ] **Step 3: Cleanup** — hard-delete in FK-safe order (catering_quotes by pipeline_id/id → catering_pipeline leads → catering_customers → catering_companies). Verify zero residue (re-select by seeded names/ids). Print `pipeline-search-smoke: PASS`.
- [ ] **Step 4: Commit**
```bash
git add scripts/pipeline-search-smoke.ts
git commit -m "test(pipeline-search): seeded federated-search smoke (PASS, zero residue)"
```

---

## Task 4: Final gates + PR

- [ ] **Step 1:** `npm run build` → PASS. `npm run typecheck` → PASS. `npx eslint` new/changed files → clean.
- [ ] **Step 2:** `npx tsx --env-file=.env.local scripts/pipeline-search-smoke.ts` → PASS, zero residue.
- [ ] **Step 3:** CC recurring-bug-class checklist: read-only + level≥5 gate; filter-injection sanitize present (the `.replace`); location-scoped via `readScopeOr` (no cross-location leak); `.in.(...)`-in-`.or()` proven pattern; `searchParams` awaited (Next 16); enrichment only over scoped result leads; no migration.
- [ ] **Step 4:** Open the PR (verify `gh pr view --json state`; don't chain branch-delete). Title: `feat(pipeline-search): catering pipeline search`. Body: federated search (lead + customer email/phone + company), board-integrated `?q=` inline cards, dormant-until-data, deferred (per-lead detail page; full-text/fuzzy).

---

## Self-Review (against the spec)

**Spec coverage:** §3 searchPipeline (sanitize + federation + scope + enrichment) → T1. §4 surface (page `?q=` branch + board search box) → T2. §5 result card + edge + authz + i18n → T2 (cards + empty state) + T1 (gate/sanitize). §6 testing → T3. §7 confirm-before-authoring → top + T1.

**Placeholder scan:** T2 (UI) gives contracts + the real files to read (page + PipelineClient) not verbatim JSX — deliberate (matches prior UI tasks). T1 has complete code.

**Type consistency:** `PipelineSearchResult` (T1) consumed in T2/T3; `searchPipeline(actor, {query})` signature consistent; reuses `PipelineLead`/`LEAD_COLS`/`mapLead`/`readScopeOr`/`PIPELINE_READ_MIN`/`DbLeadRow` (verified in `lib/catering/pipeline.ts`). Enrichment fields (`email`/`quoteStatus`/`quoteTotalCents`) match between T1 return + T2 card + T3 assertions.
