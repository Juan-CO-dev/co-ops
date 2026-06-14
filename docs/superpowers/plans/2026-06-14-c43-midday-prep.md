# C.43 Mid-day Prep — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a Mid-day Prep module — a two-phase (count → collaborative prep) "back-to-par after rush" workflow supporting multiple numbered instances per day, reusing the AM-prep count form (Phase 1) and the Opening Phase 2 collaborative engine (Phase 2).

**Architecture:** Discriminate AM vs Mid-day prep templates via a new `checklist_templates.prep_subtype` column; allow multiple mid-day instances/day via a denormalized `checklist_instances.allows_multiple_per_day` flag + a partial unique index. Reuse existing two-phase status lifecycle (`open → phase1_complete → phase2_complete`) and existing `triggered_at`/`triggered_by_user_id` columns (migration 0038).

**Tech Stack:** Next.js 16 / React 19 / TypeScript (strict + noUncheckedIndexedAccess), Supabase Postgres, custom JWT/RLS. Verification loop = `npx tsc --noEmit` → `npx next build` → smoke script (`scripts/*.ts` via `tsx`) → preview-URL manual check. **No unit-test framework — do not invent one.**

**Spec:** `docs/superpowers/specs/2026-06-13-c43-midday-prep-design.md`

---

## Slice map (this plan details Slice A; B–E are the forward roadmap)

- **Slice A — Schema + lib foundation** (THIS PLAN, buildable now, unblocked)
- **Slice B — Phase 1 lite count form** (reuse AmPrepForm; own plan)
- **Slice C — Phase 2 collaborative prep + RPC** (reuse OpeningPrepEntry + submit_phase2 pattern; own plan)
- **Slice D — Dashboard Mid-day Prep tile + trigger** (own plan)
- **Slice E — Seed the mid-day template** (BLOCKED on Juan's par values; own plan)

Each slice is independently buildable + verifiable. Slice A produces: a migrated schema + a discriminator-correct AM loader + a mid-day loader that allows multiple instances/day.

---

## Slice A — Schema + lib foundation

### Task A1: Migration 0059 — discriminator + conditional uniqueness

**Files:**
- Create: `supabase/migrations/0059_c43_midday_prep_discriminator.sql` (repo capture, per AGENTS.md convention)
- Apply: via Supabase MCP `apply_migration` (⚠ PROD — requires Juan's explicit go)

- [ ] **Step 1: Write the migration SQL** (column → backfill → CHECK ordering is load-bearing: adding the CHECK before backfill would fail on existing NULL prep rows)

```sql
-- Migration 0059_c43_midday_prep_discriminator
-- Applied via Supabase MCP apply_migration on 2026-06-14.
-- Canonical reference: lib/prep.ts loadAmPrepState / loadMidDayPrepState;
--   docs/superpowers/specs/2026-06-13-c43-midday-prep-design.md §3.
-- C.43: distinguish AM vs Mid-day prep templates + allow multiple mid-day
--   instances per day. triggered_at / triggered_by_user_id already exist (0038).

-- 1. Template discriminator (nullable column first — no constraint yet).
alter table public.checklist_templates add column prep_subtype text;

-- 2. Backfill existing prep templates to am_prep (only prep subtype pre-C.43).
update public.checklist_templates set prep_subtype = 'am_prep' where type = 'prep';

-- 3. NOW add the CHECK (existing rows already satisfy it).
alter table public.checklist_templates
  add constraint checklist_templates_prep_subtype_check
  check (
    (type <> 'prep' and prep_subtype is null)
    or (type = 'prep' and prep_subtype in ('am_prep', 'mid_day_prep'))
  );

-- 4. Instance-level multi-per-day flag (denormalized from template prep_subtype).
alter table public.checklist_instances
  add column allows_multiple_per_day boolean not null default false;

-- 5. Conditional single-per-day: drop blanket UNIQUE, replace with partial index.
--    (Partial index keys off the instance column because a unique index predicate
--     cannot subquery the template's prep_subtype.)
alter table public.checklist_instances
  drop constraint checklist_instances_template_id_location_id_date_key;

create unique index checklist_instances_single_per_day_key
  on public.checklist_instances (template_id, location_id, date)
  where not allows_multiple_per_day;
```

- [ ] **Step 2: STOP — get Juan's explicit go before applying to prod.** This drops a constraint + adds columns on the live DB. Do not apply without confirmation.

- [ ] **Step 3: Apply via Supabase MCP** `apply_migration` (name `0059_c43_midday_prep_discriminator`, project `bgcvurheqzylyfehqgzh`).

- [ ] **Step 4: Verify in DB** (run via `execute_sql`):

```sql
-- expect: every type='prep' row has prep_subtype='am_prep'; non-prep null.
select type, prep_subtype, count(*) from public.checklist_templates group by 1,2 order by 1,2;
-- expect: partial unique index present; blanket constraint gone.
select indexname from pg_indexes where tablename='checklist_instances' and indexname like '%single_per_day%';
select conname from pg_constraint where conname='checklist_instances_template_id_location_id_date_key'; -- expect 0 rows
```

- [ ] **Step 5: Commit the captured migration file** (docs/code → PR through CI per framework).

```bash
git add supabase/migrations/0059_c43_midday_prep_discriminator.sql
git commit -m "feat(db): C.43 migration 0059 — prep_subtype discriminator + conditional single-per-day"
```

---

### Task A2: AM-prep loader discriminator filter

**Files:**
- Modify: `lib/prep.ts` — `loadAmPrepState` template query (lines ~625-633) and the stale C.43 comment (~621-624)

- [ ] **Step 1: Add the `prep_subtype` filter + the create-path flag.** Replace the template query's filter and the instance insert.

Template query — add `.eq("prep_subtype", "am_prep")`:
```ts
  const { data: tmplRow, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id, name")
    .eq("location_id", args.locationId)
    .eq("type", "prep")
    .eq("prep_subtype", "am_prep")   // C.43: AM prep only (mid-day is a separate subtype)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
```

Replace the stale comment block at ~621-624 with:
```ts
  // C.43: AM Prep and Mid-day Prep are both type='prep', disambiguated by
  // prep_subtype (migration 0059). This loader is AM-prep-only; mid-day uses
  // loadMidDayPrepState. AM prep stays single-per-day (allows_multiple_per_day
  // defaults false), so the existing get-or-create + 23505 race path is unchanged.
```

- [ ] **Step 2: Verify typecheck.** Run: `npx tsc --noEmit 2>&1 | grep -E '^(app|components|lib)/'` — Expected: no output (app code clean).

- [ ] **Step 3: Commit.**

```bash
git add lib/prep.ts
git commit -m "fix(prep): C.43 — scope loadAmPrepState to prep_subtype='am_prep'"
```

---

### Task A3: Mid-day loader (`loadMidDayPrepState`)

**Files:**
- Modify: `lib/prep.ts` — add `loadMidDayPrepState` after `loadAmPrepState`

- [ ] **Step 1: Add the loader.** Mirrors `loadAmPrepState` but (a) filters `prep_subtype='mid_day_prep'`, (b) does NOT get-or-create by date — instead loads a SPECIFIC instance by id (the trigger creates instances explicitly; see Task A4), and (c) is multi-instance aware.

```ts
/**
 * loadMidDayPrepState — load one mid-day prep instance (by id) + its template
 * items + completions + authors. Unlike loadAmPrepState, mid-day is multi-
 * instance per day (C.43) — instances are created explicitly via
 * createMidDayPrepInstance (the "+ New mid-day prep" trigger), not get-or-
 * created by date. This loader reads an already-resolved instance id.
 */
export async function loadMidDayPrepState(
  service: SupabaseClient,
  args: { instanceId: string },
): Promise<{
  template: { id: string; name: string };
  templateItems: ChecklistTemplateItem[];
  instance: ChecklistInstance;
  completions: ChecklistCompletion[];
  authors: Record<string, string>;
} | null> {
  const { data: instanceRow, error: instErr } = await service
    .from("checklist_instances")
    .select(INSTANCE_COLUMNS)
    .eq("id", args.instanceId)
    .maybeSingle<InstanceRow>();
  if (instErr) throw new Error(`loadMidDayPrepState: read instance: ${instErr.message}`);
  if (!instanceRow) return null;

  const { data: tmplRow, error: tmplErr } = await service
    .from("checklist_templates")
    .select("id, name")
    .eq("id", instanceRow.template_id)
    .eq("type", "prep")
    .eq("prep_subtype", "mid_day_prep")
    .maybeSingle<{ id: string; name: string }>();
  if (tmplErr) throw new Error(`loadMidDayPrepState: load template: ${tmplErr.message}`);
  if (!tmplRow) return null; // instance's template is not a mid-day prep template

  const { data: itemsRows, error: itemsErr } = await service
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("template_id", tmplRow.id)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (itemsErr) throw new Error(`loadMidDayPrepState: load items: ${itemsErr.message}`);
  const templateItems = ((itemsRows ?? []) as TemplateItemRow[])
    .map(rowToTemplateItem)
    .map(narrowPrepTemplateItem);

  const { data: compRows, error: compErr } = await service
    .from("checklist_completions")
    .select(COMPLETION_COLUMNS)
    .eq("instance_id", instanceRow.id)
    .is("superseded_at", null)
    .is("revoked_at", null);
  if (compErr) throw new Error(`loadMidDayPrepState: load completions: ${compErr.message}`);
  const completions = ((compRows ?? []) as CompletionRow[]).map(rowToCompletion);

  const authorIds = new Set<string>();
  for (const c of completions) authorIds.add(c.completedBy);
  if (instanceRow.triggered_by_user_id) authorIds.add(instanceRow.triggered_by_user_id);
  const authors: Record<string, string> = {};
  if (authorIds.size > 0) {
    const { data: userRows, error: userErr } = await service
      .from("users").select("id, name").in("id", Array.from(authorIds));
    if (userErr) throw new Error(`loadMidDayPrepState: load authors: ${userErr.message}`);
    for (const u of (userRows ?? []) as Array<{ id: string; name: string }>) authors[u.id] = u.name;
  }

  return { template: tmplRow, templateItems, instance: rowToInstance(instanceRow), completions, authors };
}
```

> NOTE: confirm `COMPLETION_COLUMNS`, `rowToCompletion`, `rowToInstance`, `INSTANCE_COLUMNS`, `TEMPLATE_ITEM_COLUMNS` are all in module scope in `lib/prep.ts` (they are used by `loadAmPrepState`). If any live only in `lib/opening.ts`, import or lift to `lib/template-items.ts`.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit 2>&1 | grep -E '^(app|components|lib)/'` — Expected: no output.

- [ ] **Step 3: Commit.**

```bash
git add lib/prep.ts
git commit -m "feat(prep): C.43 — loadMidDayPrepState (multi-instance, by id)"
```

---

### Task A4: Mid-day instance trigger (`createMidDayPrepInstance`)

**Files:**
- Modify: `lib/prep.ts` — add `createMidDayPrepInstance`

- [ ] **Step 1: Add the create function.** Sets `allows_multiple_per_day = true` so the partial unique index permits multiple/day; records `triggered_at` + `triggered_by_user_id` (C.18). L3+ gate enforced at the route layer (Slice D) + RLS.

```ts
/**
 * createMidDayPrepInstance — explicit "+ New mid-day prep" trigger (C.43).
 * Always inserts a NEW instance (allows_multiple_per_day = true bypasses the
 * single-per-day partial unique index), stamped with triggered_at /
 * triggered_by_user_id. Returns the new instance id. L3+ authorization is
 * enforced by the calling route + RLS, not here.
 */
export async function createMidDayPrepInstance(
  service: SupabaseClient,
  args: { templateId: string; locationId: string; date: string; actor: PrepActor },
): Promise<string> {
  const triggerTimestamp = new Date().toISOString();
  const { data: inserted, error: insertErr } = await service
    .from("checklist_instances")
    .insert({
      template_id: args.templateId,
      location_id: args.locationId,
      date: args.date,
      shift_start_at: triggerTimestamp,
      status: "open",
      triggered_by_user_id: args.actor.userId,
      triggered_at: triggerTimestamp,
      allows_multiple_per_day: true,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insertErr) throw new Error(`createMidDayPrepInstance: insert: ${insertErr.message}`);
  if (!inserted) throw new Error(`createMidDayPrepInstance: insert returned no row`);

  void audit({
    actorId: args.actor.userId,
    actorRole: args.actor.role,
    action: "checklist_instance.create",
    resourceTable: "checklist_instances",
    resourceId: inserted.id,
    metadata: {
      template_id: args.templateId,
      location_id: args.locationId,
      date: args.date,
      template_type: "prep",
      prep_subtype: "mid_day_prep",
      trigger: "manual_mid_day",
    },
    ipAddress: null,
    userAgent: null,
  });
  return inserted.id;
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit 2>&1 | grep -E '^(app|components|lib)/'` — Expected: no output.

- [ ] **Step 3: Build gate.** Run: `npx next build` — Expected: compiles + type-checks green (no app errors).

- [ ] **Step 4: Smoke script** (mirrors the project's smoke-script practice; gitignore it per launch-purge convention). Create `scripts/c43-smoke.ts` (local, untracked): seed a throwaway mid-day template at a test location, call `createMidDayPrepInstance` twice for the same date, assert two distinct instance ids exist (proves the partial unique index allows multiple/day), then `loadMidDayPrepState` each. Run: `npx tsx --env-file=.env.local scripts/c43-smoke.ts`.

- [ ] **Step 5: Commit.**

```bash
git add lib/prep.ts
git commit -m "feat(prep): C.43 — createMidDayPrepInstance (multi-instance trigger)"
```

---

## Slice A done-condition

- Migration 0059 applied + verified (backfill correct, partial index present, blanket constraint gone).
- `loadAmPrepState` scoped to `am_prep`; `loadMidDayPrepState` + `createMidDayPrepInstance` exist and typecheck.
- `next build` green; smoke proves multiple mid-day instances/day are allowed and loadable.

## Forward roadmap (own plans, after Slice A)

- **B — Phase 1 lite count form:** reuse `AmPrepForm` with the mid-day item universe; single submit → `phase1_complete`. Verify which submit path (the AM-prep RPC `submit_am_prep_atomic` vs a thin variant).
- **C — Phase 2 collaborative prep:** reuse `OpeningPrepEntry` engine + a `save_phase2`-style per-item RPC scoped to the mid-day instance; `phase2_complete` on finalize.
- **D — Dashboard tile + trigger route:** numbered-instance list (by `triggered_at`) + "+ New mid-day prep" (L3+ gate, RLS) calling `createMidDayPrepInstance`.
- **E — Seed mid-day template:** ⚠ BLOCKED on Juan's par values/units for the perishables (§6 of spec). Items: pickles, sweet/hot peppers, mozzarella (shredded/fresh), basil + the 8 sauces. Cranberry deferred (seasonal).
