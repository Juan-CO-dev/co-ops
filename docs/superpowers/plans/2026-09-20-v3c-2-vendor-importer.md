# Vendor Ordering V3-C-2 — the vendor export importer (v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GM uploads a vendor export (PFG CustomerFirst CSV, US Foods MOXē CSV, or a receipts JSON) on the vendor's admin page, sees a dry-run report of what would change against the live catalog, decides row by row, and applies the approved rows in ONE database transaction that is idempotent under retry — with every write audited and nothing ever deleted.

**Architecture:** Three layers. (1) Pure adapters + parsers + matcher move from `scripts/vendor-exports/` into `lib/vendor-import-shared/` (zero I/O; scripts re-export from there so the offline reports keep working). (2) `lib/vendor-import.ts` (server) stages a batch: parse → match against the live catalog → diff → write `vendor_import_batches` + `vendor_import_observations` (migration 0211) → return the report. (3) `apply_vendor_import` RPC (0211, SECURITY DEFINER, service-role only) claims `(batch_id, plan_digest)`, re-checks before-state, appends prices, sets item numbers, versions pack chains, writes the apply result — one transaction, replay-safe. Guide linkage and SKU creation are NOT in v1: staged candidates are listed with a link to the existing Order Guide panel / SKU editor (spec §4 "requires a person").

**Tech Stack:** Next.js 16 App Router route handlers (multipart `req.formData()` like `app/api/photos/route.ts`), Supabase service-role client, Postgres 17 plpgsql RPC, vitest pure tests + route tests (mock session/csrf like `tests/scan-routes.test.ts`), i18n `lib/i18n/en.json` + `es.json`, house UI grammar (admin-form; Disclosure doctrine D1–D10).

**Spec:** `docs/superpowers/specs/2026-09-18-vendor-ordering-v3c-import-design.md` §§2–8 + §0 ruling + §9a answers. **CC rulings for v1 (2026-09-20, on auto):**
- R1. v1 write set = `sku.price_supersede` (append), `sku.item_number_set` (null→value only), `sku.pack_level_supersede` (whole active chain versioned via the contract `replaceSkuPackChain` uses). Guide writes and SKU creation stay human (existing panels); the report lists them as `needs_person` rows with deep links.
- R2. Audit: reuse the seed-38 actions (`sku.price_supersede`, `sku.item_number_set`, `sku.pack_level_supersede`, all destructive) for row writes; add `vendor.import_staged` (non-destructive) and `vendor.import_applied` (destructive) for the batch; `actor_context: "vendor_import"`. The spec's `vendor_item.update` / `sku.pack_chain_update` names do NOT exist and are not created.
- R3. Levels: stage at `ORDER_GUIDE_EDIT_MIN` (7). **Apply at 9** (owner/tech lead): both shops share the vendor accounts (§9a.5), so an applied price is a two-shop effect and a shop-scoped GM cannot approve it (spec §5.3). Apply also needs step-up Tier A (`assertStepUp(ctx, "A")`).
- R4. Identity = exact `(vendor_id, item_number)`; then exact normalized name within the vendor; anything else = `unmatched` (a person decides). Duplicate item numbers within a vendor = `ambiguous`, never auto-applied.
- R5. Missing price never blanks a price (US Foods rows produce pack/identity observations only). `/lb` prices apply only to SKUs whose active root is weight-denominated; otherwise `needs_person`.
- R6. Pack changes apply only when the vendor pack's dimension equals the active root's dimension (oz↔oz, each↔each); fl oz vs oz is `needs_person` (the eight cases seed 38 listed).
- R7. Batches are global (location_id NULL) in v1; the account id is recorded as evidence.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/vendor-import-shared/model.ts` | `ExportRow`, `Adapter`, `Basis`, `MatchRule`, `Observation`, `Decision`, `PlanOp` types (moved from `scripts/vendor-exports/model.ts`, extended) |
| `lib/vendor-import-shared/parsers.ts` | `parsePack`, `parsePrice`, `parseDate`, `parsePurchase`, `parseCsv` (moved verbatim) |
| `lib/vendor-import-shared/adapters/{pfg,usfoods,receipts}.ts` + `index.ts` | the three adapters + `detectAdapter(text, hint?)` registry (moved; `receipts` accepts the CC JSON shape) |
| `lib/vendor-import-shared/match.ts` | pure `matchObservations(rows, catalog) → Observation[]` (R4) and `planFromDecisions(observations, decisions) → PlanOp[]` + `planDigest(ops, beforeState)` |
| `lib/vendor-import-shared/reconcile.ts` | pure `reconcileBasis`, `packComparison`, `priceComparison` (lifted from `scripts/seed/38-manifest.ts` + `scripts/vendor-exports/diff-core.ts`, generalized) |
| `lib/vendor-import.ts` | server: `stageVendorImport(actor, vendorId, file)`, `loadImportBatch(actor, batchId)`, `applyVendorImport(actor, batchId, decisions, expectedDigest)`; `VendorImportError(status, code)` |
| `supabase/migrations/0211_vendor_import.sql` | tables `vendor_import_batches`, `vendor_import_observations`, `vendor_import_applies`; RPC `apply_vendor_import`; deny-all RLS; grants |
| `app/api/admin/vendors/[id]/import/route.ts` | POST multipart → stage; returns the batch report |
| `app/api/admin/vendors/[id]/import/[batchId]/route.ts` | GET batch (report + observations + decisions) |
| `app/api/admin/vendors/[id]/import/[batchId]/apply/route.ts` | POST `{ decisions, expectedDigest }` → apply (level 9 + step-up A) |
| `components/admin/vendors/VendorImportPanel.tsx` | upload → report → decisions → apply; sibling of `OrderGuidePanel` on `app/admin/vendors/[id]/page.tsx` |
| `scripts/vendor-exports/{model,parsers,adapters/*}.ts` | become re-exports of the lib modules (offline reports unchanged) |
| `lib/i18n/en.json`, `es.json` | `admin.vendor_import.*` keys |
| `lib/audit-actions.ts`, `lib/destructive-actions.ts` | `vendor.import_staged` (non-destructive), `vendor.import_applied` (destructive) |
| tests | `tests/vendor-import-parsers.test.ts` (moved), `tests/vendor-import-match.test.ts`, `tests/vendor-import-reconcile.test.ts`, `tests/vendor-import-routes.test.ts`, `tests/vendor-import-i18n.test.ts` |

---

### Task 1: Move the pure export code into `lib/vendor-import-shared/` (no behaviour change)

**Files:** create `lib/vendor-import-shared/{model,parsers}.ts`, `lib/vendor-import-shared/adapters/{pfg,usfoods,receipts,index}.ts`; modify `scripts/vendor-exports/model.ts`, `parsers.ts`, `adapters/*.ts` to `export * from "@/lib/vendor-import-shared/..."`; move `tests/vendor-exports-parsers.test.ts` → `tests/vendor-import-parsers.test.ts` (imports updated).

- [ ] Step 1: `git mv` the four files and the adapters into `lib/vendor-import-shared/`; fix relative imports to `@/lib/vendor-import-shared/...`. The lib copy must import NOTHING from `scripts/` or from any server module (`*-shared` law: zero I/O).
- [ ] Step 2: Recreate `scripts/vendor-exports/model.ts`, `parsers.ts`, `adapters/{pfg,usfoods,receipts}.ts` as one-line re-exports (`export * from "@/lib/vendor-import-shared/parsers";`). Keep `adapters/index.ts`'s registry in the lib; export `ADAPTERS` and `detectAdapter(text: string): Adapter | null` (detects by header signature; receipts by JSON shape `{ receipts: [...] }`).
- [ ] Step 3: Run `npx vitest run tests/vendor-import-parsers.test.ts tests/vendor-exports-diff.test.ts tests/vendor-exports-waves-diff.test.ts tests/seed38-manifest.test.ts` → all green (the seed and reports still import through the re-exports). Run `node --import tsx scripts/vendor-exports/diff.ts` → regeneration byte-identical (compare `sha256sum` of `docs/seed/source/vendor-exports/reports/*.md` before/after).
- [ ] Step 4: Commit `refactor(vendor-import): pure adapters and parsers move to lib/vendor-import-shared; scripts re-export`.

### Task 2: Pure matcher + planner (`match.ts`) with tests

**Files:** create `lib/vendor-import-shared/match.ts`, `tests/vendor-import-match.test.ts`.

Types (add to `model.ts`):
```ts
export type MatchRule = "item_number" | "name_exact" | "ambiguous" | "unmatched";
export interface CatalogSku { id: string; vendor_id: string; name: string; item_number: string | null; active: boolean;
  root: { levelId: string; label: string; quantity: number; unit: string; dimension: "weight" | "volume" | "count" } | null;
  latestPrice: { id: string; unit_price: number; effective_date: string } | null; price_basis: Basis | null }
export type ObservationKind = "price" | "item_number" | "pack" | "needs_person" | "noop";
export interface Observation { source_row: number; row: ExportRow; match: { rule: MatchRule; sku_id: string | null; candidates: string[] };
  kind: ObservationKind; reason: string;            // machine-readable: "price_changed" | "price_same" | "no_price_supplied" | "pack_changed" | "pack_dimension_mismatch" | "per_lb_on_count_root" | "duplicate_item_number" | "no_match" | "item_number_missing"
  proposed: { unit_price?: number; effective_date?: string; item_number?: string; root?: { quantity: number; unit: string } } | null }
export type Decision = "accept" | "skip";
export interface PlanOp { action: "sku.price_supersede" | "sku.item_number_set" | "sku.pack_level_supersede"; sku_id: string; source_row: number;
  before: Record<string, unknown>; after: Record<string, unknown> }
```
Rules (R4–R6): match by exact `(vendor_id, item_number)` → `item_number`; else exact normalized name (`norm()` = lowercase, collapse spaces, strip punctuation) → `name_exact`; two+ SKUs on one item number → `ambiguous` (kind `needs_person`, reason `duplicate_item_number`); none → `unmatched` (kind `needs_person`, reason `no_match`). For a match: if `row.price_cents` is null and `row.price_per_lb_cents` is null → kind `noop`/`no_price_supplied` unless the SKU lacks an item number and the row has one (then kind `item_number`). Price: compute `proposed.unit_price` at the SKU's purchase root using `reconcile.ts` (R5); equal to latest (±$0.005) → `noop`/`price_same`; else kind `price`. Pack: vendor contents vs root (R6): same dimension and different quantity → kind `pack` (a second observation for the same row is allowed: emit one observation per kind, source_row shared). `planFromDecisions` keeps only `accept`ed observations of kinds price/item_number/pack and turns each into a `PlanOp` with `before` = the catalog values it read. `planDigest` = sha256 over canonical JSON of ops + `before` (stable key order).

- [ ] Step 1: Write the tests first: (a) item-number wins over name; (b) duplicate item number → ambiguous; (c) US Foods row with no price → noop unless it fills a missing item number; (d) `/lb` price on a count root → needs_person `per_lb_on_count_root`; (e) fl oz vendor pack vs oz root → needs_person `pack_dimension_mismatch`; (f) same price → noop; (g) plan digest is stable across key order and changes when `before` changes; (h) `skip` decisions produce no op. Run → fails (module missing).
- [ ] Step 2: Implement `match.ts` (pure; import only from `./model`, `./parsers`, `./reconcile`). Run → green.
- [ ] Step 3: Commit `feat(vendor-import): pure matcher and planner with digest`.

### Task 3: `reconcile.ts` (pure) with tests

**Files:** create `lib/vendor-import-shared/reconcile.ts`, `tests/vendor-import-reconcile.test.ts`.

Lift from `scripts/seed/38-manifest.ts` (`vendorContents`, `reconcileBasis`, `purchaseRootOz` logic) and `scripts/vendor-exports/diff-core.ts` (pack/price comparison): `vendorContents(row) → { quantity, unit, dimension } | null`, `priceAtRoot(row, root, basis) → number | null` (cents→dollars at the root; `/lb` × root pounds only when `root.dimension === "weight"`), `packComparison(row, root) → { same: boolean; dimensionMismatch: boolean; proposedQuantity?: number }`. Pin: Butter 36/1 LB $80.30 with root "case = 16 oz" → $2.23 per_each root; Ovengold $6.29/lb with root 8 lb → $50.32; Duke's 4/1 GA $73.99 with root 128 oz (volume vs volume ok) → $18.50; `#10` cans keep "can" units; `12/12 CT` → 144 each.

- [ ] Step 1: tests → fail. Step 2: implement → green. Step 3: commit `feat(vendor-import): pure reconciliation (basis, price at root, pack comparison)`.

### Task 4: Migration 0211 — batch ledger + `apply_vendor_import` RPC

**Files:** create `supabase/migrations/0211_vendor_import.sql`. Provenance header like 0210. Applied to sim by CC before Task 6's rehearsal; prod on Juan's word.

```sql
create table public.vendor_import_batches (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  location_id uuid null references public.locations(id),          -- v1: always null (global; both shops share accounts)
  account_id text null,
  adapter text not null, adapter_version text not null,
  source_name text not null, source_sha256 text not null, exported_at date null,
  row_count int not null, report jsonb not null,                    -- the dry-run report (counts by kind/reason + needs_person list)
  status text not null default 'staged' check (status in ('staged','applied','superseded')),
  created_by uuid not null references public.users(id), created_at timestamptz not null default now(),
  unique (vendor_id, source_sha256, adapter_version)                -- same file twice = same batch (return it)
);
create table public.vendor_import_observations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vendor_import_batches(id),
  source_row int not null, kind text not null, reason text not null,
  match_rule text not null, sku_id uuid null references public.vendor_items(id), candidates jsonb not null default '[]',
  payload jsonb not null,                                           -- the normalized ExportRow
  proposed jsonb null, decision text null check (decision in ('accept','skip')),
  unique (batch_id, source_row, kind)
);
create table public.vendor_import_applies (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vendor_import_batches(id),
  plan_digest text not null, applied_by uuid not null references public.users(id),
  applied_at timestamptz not null default clock_timestamp(),
  result jsonb not null,                                            -- per-op outcome + new row ids
  unique (batch_id, plan_digest)                                    -- the idempotency claim
);
-- RLS: deny-all triads on all three (service-role only), the house pattern (see 0206 sku_barcodes).
create or replace function public.apply_vendor_import(p_batch_id uuid, p_plan_digest text, p_actor uuid, p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
-- 1. insert into vendor_import_applies (batch_id, plan_digest, applied_by, result) values (..., '{}') ;
--    on unique_violation → return the existing row's result (replay-safe; NO second write).
-- 2. lock the batch (for update); require status = 'staged'; lock every affected vendor_items row in stable id order.
-- 3. for each op (ordered by sku_id, action): re-check `before` against the live row (price: latest vendor_price_history
--    id + unit_price; item_number: current value must equal before.item_number (null); pack: the active root level id +
--    contains_qty). Any mismatch → raise exception 'stale_before_state:<sku_id>' (aborts the whole apply; the claim row
--    is rolled back too, so a fresh dry-run can re-apply).
-- 4. writes: price → insert vendor_price_history(vendor_item_id, unit_price, effective_date, recorded_by=p_actor, source='vendor_import', source_note=batch id);
--    item_number → update vendor_items set item_number = after.item_number where id = sku_id and item_number is null (check rowcount = 1);
--    pack → update sku_pack_levels set active=false where id = before.level_id and active (rowcount 1); insert the successor level
--    (label, contains_qty = after.quantity, contains_level_id, contains_measure_unit, display_ordinal, active=true);
--    then update vendor_items mirror columns (units_per_pack / each_size / each_measure) the way lib/admin/pack-chain.ts's writer does — read that file and copy its derivation into SQL, or refuse pack ops in the RPC and do them via replaceSkuPackChain in a follow-up (Astra decides; state which).
-- 5. update vendor_import_batches set status='applied'; update the apply row's result jsonb; return it.
$$;
revoke all on function public.apply_vendor_import(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_vendor_import(uuid, text, uuid, jsonb) to service_role;
```
- [ ] Step 1: Write the SQL. Step 2: CC applies it to the sim (not the worker). Step 3: commit `feat(vendor-import): 0211 batch ledger + apply_vendor_import RPC`.

### Task 5: Server library `lib/vendor-import.ts`

**Files:** create `lib/vendor-import.ts`; modify `lib/audit-actions.ts` + `lib/destructive-actions.ts` (add `vendor.import_staged` non-destructive, `vendor.import_applied` destructive).

```ts
import "server-only";
export class VendorImportError extends Error { constructor(public status: number, public code: string, message?: string) { super(message ?? code); } }
export const VENDOR_IMPORT_STAGE_MIN = ORDER_GUIDE_EDIT_MIN;   // 7
export const VENDOR_IMPORT_APPLY_MIN = 9;                        // R3
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export async function stageVendorImport(actor: AuthContext, vendorId: string, file: { name: string; text: string }): Promise<ImportBatchView>
export async function loadImportBatch(actor: AuthContext, vendorId: string, batchId: string): Promise<ImportBatchView>
export async function applyVendorImport(actor: AuthContext, vendorId: string, batchId: string, decisions: Record<string, Decision>, expectedDigest: string): Promise<ImportApplyResult>
```
`stageVendorImport`: role floor; vendor must exist and be active; `detectAdapter` (400 `unknown_adapter`); adapter's own vendor must equal the target vendor's adapter family (a PFG file cannot be staged on US Foods: 400 `adapter_vendor_mismatch`); load `CatalogSku[]` for the vendor with the service client (vendor_items + latest price via `loadCurrentSkuPrices` contract + active root via the pack-chain loader contract); `matchObservations`; write batch (if `(vendor_id, sha256, adapter_version)` exists → return the existing batch, no new rows) + observations; audit `vendor.import_staged` (metadata: counts, sha, adapter); return the view. `applyVendorImport`: level 9; step-up is the ROUTE's job; reload the batch + observations; recompute the plan from the stored observations + decisions; digest must equal `expectedDigest` (409 `plan_changed`); call the RPC; map `stale_before_state` → 409 `stale_before_state`; audit `vendor.import_applied` (metadata: batch, digest, op counts, new ids); return.

- [ ] Step 1: Write route-independent tests for the pure parts already covered; the lib is DB-coupled and is exercised by CC's sim rehearsal (Task 8), not by vitest. Step 2: implement. Step 3: `npx tsc --noEmit` clean. Step 4: commit `feat(vendor-import): server library — stage, load, apply through the 0211 RPC`.

### Task 6: Routes

**Files:** create the three route files listed above; `tests/vendor-import-routes.test.ts` (mock `@/lib/session`, `@/lib/portal/csrf`, `@/lib/vendor-import`, `@/lib/admin/step-up` like `tests/scan-routes.test.ts` + `tests/order-guide-route.test.ts`).

Order in every POST: `assertSameOrigin` FIRST → `parseJsonBody`/`formData` → `requireSession` → level floor → (apply only) `assertStepUp(ctx, "A")` → lib. Stage: `formData()`; field `file` must be a `File` ≤ `MAX_IMPORT_BYTES`, text decoded as UTF-8 (BOM stripped by the adapter); 413 `too_large`, 400 `invalid_payload`. Errors: `VendorImportError` → `jsonError(e.status, e.code)`. Tests pin: cross-site → 403 before session (all three); level 6 refused on stage; level 7 allowed on stage, refused on apply (403 `forbidden`); level 9 without step-up → 403 `step_up_required`; a 409 `plan_changed` passes through; the stage handler rejects a 3 MB file with 413 before touching the lib.

- [ ] Step 1: tests → fail. Step 2: routes → green. Step 3: commit `feat(vendor-import): admin routes — stage (multipart), load, apply`.

### Task 7: UI `VendorImportPanel` + i18n

**Files:** create `components/admin/vendors/VendorImportPanel.tsx`; modify `app/admin/vendors/[id]/page.tsx` (mount after `OrderGuidePanel`, `canStage={level >= 7}`, `canApply={level >= 9}`); `lib/i18n/en.json` + `es.json` (`admin.vendor_import.*`: title, upload label, help line naming the three formats, staging/applying states, counts by kind, reason labels for every `reason` string in Task 2, decision labels accept/skip, needs-person hint with the two deep links (Order guide panel anchor, SKU editor), apply button, digest-changed error, step-up error, success line with counts); `tests/vendor-import-i18n.test.ts` pins every key exists in both files.

Shape (Disclosure doctrine): a `.co-card` titled by `t("admin.vendor_import.title")`; summary row = last batch (adapter · exported date · row count · counts by kind) with a default-collapsed table; upload control (file input, admin-form grammar, 44 px); after staging, the table: one row per observation, columns Item (item number + description), Match (rule chip), Current (price/pack from catalog), Proposed, Reason, Decision (`accept`/`skip` select, default `accept` for kinds price/item_number/pack; `needs_person` rows have no select and show the hint + link). Apply button visible only when `canApply`, disabled until at least one accept; on 409 `plan_changed` show the digest-changed message and re-stage. Spanish operational tú-form. No brand/location literals. useState only for disclosure state; prop-driven reset via the prev-compare pattern.

- [ ] Step 1: i18n test → fail. Step 2: keys en+es. Step 3: component + mount. Step 4: `npm run build` locally (`next build` catches Suspense/`useSearchParams` gates). Step 5: commit `feat(vendor-import): admin panel + i18n`.

### Task 8: Sim rehearsal (CC) + sim claim

**Files:** `scripts/sim/launch-readiness/claims.json` (+1 claim `admin.vendor_import.stage-review-apply`), `scripts/sim/launch-readiness/journeys/` (extend the ordering journey: as the GM (level 7) stage the real `list-izzy-main-2026-09-18.csv` on PFG, assert the report counts; as level 9 apply two accepted price rows; assert the ledger has two new rows and a re-apply with the same digest returns the same result and writes nothing).

- [ ] CC applies 0211 to the sim, runs the journey, records the run id in the PR.

### Task 9: Docs

- [ ] Spec §0: add "V3-C-2 v1 shipped scope" (R1–R7). `docs/ROADMAP.md`: NOW row. `docs/guides/manager.md` (or wherever the guides live): one paragraph "Importing a vendor export". Commit `docs(vendor-import): v1 scope, roadmap, manager guide`.

---

## Self-review

- Spec coverage: §2 adapters (T1), §3 identity + idempotency (T2 digest, T4 unique claim), §4 auto-vs-human (T2 kinds + R1), §5 dry-run protocol (T5 stage + digest + T4 before-state re-check), §6 guide writes (explicitly deferred, R1), §7 audit (R2), §8 verification (T2/T3/T6 tests + T8 rehearsal). Gaps: guide RPC in the same transaction (deferred to v2, stated); OCR receipts (out of scope).
- Types: `Observation.kind` values used in T2, T5, T7 match; `Decision` = accept|skip everywhere; `PlanOp.action` names = registered audit actions.
