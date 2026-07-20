# Catering Pipeline Search — Design

**Date:** 2026-07-20
**Status:** Design approved (Juan), pre-implementation
**Source:** note ③ from the 2026-07-19 field-notes triage ([[project_coops_catering_wiring_ideas_backlog]])

## 1. Context & goal

The catering team needs to **look up a pipeline lead/order by any identity field** — email, phone, contact person name, company name — not just scroll the stage-grouped kanban board. This is a staff-facing **read surface** (fits "read surfaces over workflows"), buildable now with zero external deps, and **dormant on data** (0 leads in prod today; the rails are useful the moment leads exist).

It mirrors the proven `lib/admin/users.ts listUsers` search pattern (PostgREST `.or()` + `.ilike` with filter-injection defense) and integrates into the existing board at `/catering/pipeline`. **No new route, no new table, no migration.**

## 2. Scope

**In scope:**
- A `searchPipeline(actor, { query })` lib fn — a federated `ilike` search across the lead's own text fields + the customer's email/phone/name + the company name, location-scoped, injection-safe, enriched with each result's email + current-quote status.
- A **search box on the existing board** (`/catering/pipeline`) that swaps the kanban for a flat **inline result-card list** via a `?q=` param.
- i18n (EN + ES) + a seeded smoke.

**Out of scope (deferred):**
- A per-lead **detail page** (`/catering/pipeline/[id]`) — results are self-contained cards; the detail page (which would also home W4a's deferred per-lead prep-demand breakdown) is a separate future effort.
- Any **edit** from search (search is read-only; editing stays on the board).
- Full-text search / ranking beyond `ilike` substring (YAGNI; matches the codebase precedent).
- Fuzzy/typo-tolerant matching.

## 3. The search lib — `searchPipeline`

New export in `lib/catering/pipeline.ts` (next to `loadPipelineBoard`), `requireLevel ≥ PIPELINE_READ_MIN (5)`, service-role client, reusing `readScopeOr(actor)` for location scoping.

```
searchPipeline(actor, { query }) → PipelineSearchResult[]
```

1. **Sanitize** exactly like `listUsers` (the A-WB4-01 filter-injection defense): `const raw = query.trim().replace(/[,()\\"]/g, "")`. If `!raw` → return `[]` (empty/all-stripped term = no search). (`%`/`_` remain as harmless ILIKE wildcards.) `const term = \`%${raw}%\``.
2. **Resolve identity matches** (fields NOT on the lead — email is on the customer, company name on the company):
   - `catering_customers` where `email.ilike.term OR phone.ilike.term OR name.ilike.term` → their `id`s;
   - `catering_companies` where `name.ilike.term` → `id`s → `catering_customers` where `company_id.in.(companyIds)` → their `id`s;
   - union → `matchedCustomerIds` (deduped).
3. **Search leads:** `catering_pipeline.select(LEAD_COLS)` + `readScopeOr` scope, then
   `.or("contact_name.ilike.<term>,company.ilike.<term>,contact_phone.ilike.<term>,event_name.ilike.<term>" + (matchedCustomerIds.length ? ",customer_id.in.(<ids>)" : ""))`,
   `.order("created_at", { ascending: false })`. Map to `PipelineLead[]` (existing `mapLead`).
4. **Enrich** (one batch query each, over the result lead-ids):
   - **email:** `catering_customers.select("id, email").in("id", customerIds)` → map by `customer_id`;
   - **current quote:** `catering_quotes.select("pipeline_id, status, total_cents, created_at").in("pipeline_id", leadIds).is("superseded_at", null)` → pick the latest (`created_at desc`) per `pipeline_id` → `{ quoteStatus, quoteTotalCents }`.
5. Return `PipelineSearchResult[]` = `PipelineLead & { email: string | null; quoteStatus: string | null; quoteTotalCents: number | null }`.

`term` is interpolated into `.ilike.` values within a `.or()` string — the strip in step 1 removes the structural chars that would break the OR group, matching the established defense. The customer/company sub-queries use `.ilike()` (method form, not the `.or()` string) so they're injection-safe by construction, but the same `raw` term is used.

## 4. The surface

Integrated into the existing pipeline board (`app/(authed)/catering/pipeline/page.tsx` + its `PipelineClient`), via a `?q=` search param:

- The board client gains a **search box at the top** (always visible). Submit → `router.push('/catering/pipeline?q=<term>')`; clear → `router.push('/catering/pipeline')`. (Mirrors the prep-demand `router.push` pattern.)
- The **server page branches on `?q=`** (read from `searchParams`, a Promise in Next 16): present + non-empty → `searchPipeline(auth, { query })` → render a flat **"N results for '<q>'" card list**; absent → the existing `loadPipelineBoard` + `loadFollowUps` board renders unchanged. Only one path loads per render.
- Same route, same `PIPELINE_READ_MIN` gate, same location scope.

## 5. Result card + edge cases

- **Card (read-only):** contact name (bold) + company + a stage badge + event date + phone + resolved email + the current quote's status & total (`formatCents`). Location label shown when the actor spans multiple locations. No edit affordances.
- **Edge cases:** empty/whitespace/all-stripped term → board, no search; no matches → "No leads match '<q>'"; results location-scoped exactly like the board; the sanitizer neutralizes filter-injection.
- **Authz:** `level ≥ PIPELINE_READ_MIN (5)`, service-role lib + RLS defense-in-depth. Enrichment (email, quotes) is only for the already-scoped result leads.
- **Dormant-safe:** 0 leads → empty results; no errors.
- **i18n:** EN + ES (tú-form) for the search box placeholder, results header (`{n}`, `{q}`), empty state, and card labels/ARIA.

## 6. Testing

`scripts/pipeline-search-smoke.ts` (mirror the seeded-smoke pattern — service-role, seed → drive REAL lib → assert → hard-delete, zero residue):
- Seed a `catering_companies` row + a `catering_customers` (email `smoke@acme-test.com`, phone, `company_id`) + 3 `catering_pipeline` leads at a real location: (A) `contact_name` matches a name term; (B) `customer_id` = the seeded customer (matches by email-via-customer); (C) `company` text OR company-name-via-companies matches a company term; + a `catering_quotes` (non-superseded, a status + total) on lead B.
- Assert `searchPipeline` by: the name term → returns A; the email term → returns B + `email` enriched + the quote status/total enriched; the company term → returns C (and/or B if same company); a term with `,()` injection chars → no error, returns sensibly (stripped).
- Assert location scope (a lead at a non-actor location isn't returned for a location-scoped actor — or note cgs/level-9 sees all).
- Hard-delete everything (quotes, leads, customer, company), verify zero residue, print PASS. Plus `build`/`typecheck`/`eslint`.

## 7. Confirm-before-authoring — VERIFIED against live DB + code (2026-07-20)

- `catering_pipeline`: `contact_name (NOT NULL), company, contact_phone, event_name, delivery_address, customer_id → catering_customers(id), location_id, stage, event_date, ...`. `LEAD_COLS` + `PipelineLead` view + `loadPipelineBoard(actor)` + `readScopeOr(actor)` + `mapLead` all exist in `lib/catering/pipeline.ts`; `PIPELINE_READ_MIN=5`.
- `catering_customers`: `id, name (NOT NULL), company, contact_person, email (UNIQUE active, migration 0122), phone, company_id → catering_companies(id) (0122), primary_location_id, active, ...`.
- `catering_companies`: `id, name (NOT NULL), active, ...` (RLS read `level ≥ 5`). `catering_company_domains` (domain→company) exists but is NOT needed for search (we match company `name`, not domain).
- `catering_quotes`: `pipeline_id → catering_pipeline(id), status, total_cents, superseded_at, created_at, root_id, version`. `loadQuotesForLead(actor, pipelineId)` exists (per-lead; the smoke/lib use a batch `.in("pipeline_id", ...)` for enrichment).
- Search precedent: `lib/admin/users.ts listUsers` — `query.trim().replace(/[,()\\"]/g, "")` then `.or("name.ilike.%t%,email.ilike.%t%")`. `escapeLike` in `lib/catering/companies.ts`.
- Board UI: `app/(authed)/catering/pipeline/page.tsx` (gate `getRoleLevel < PIPELINE_READ_MIN → redirect`; `Promise.all([loadPipelineBoard, loadFollowUps])`; renders `<PipelineClient leads followUps locations actorLevel writeMin />`). Route `/catering/pipeline`. **No per-lead detail page.**
- **NO migration** — pure read + UI.

## 8. Deferred

- **Per-lead detail page** (`/catering/pipeline/[id]`) — would home W4a's deferred per-lead prep-demand breakdown too; separate effort.
- Full-text/fuzzy search, saved searches, search over `notes`/`dietary_notes` (identity fields only for now).
