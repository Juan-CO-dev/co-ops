# ezCater Lifecycle Tributary (Catering Inbox A1.1 + A1.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ezCater order becomes a pipeline lead the moment it is submitted and follows the order automatically — confirmed when accepted in ezManage, refreshed when modified, lost when cancelled or rejected — assigned to the catering manager.

**Architecture:** A pure decision module (`lib/ezcater/lifecycle-shared.ts`) maps an ezCater event key plus the lead's current stage to exactly one action, guarded by the pipeline's own `canTransition`. The intake processor (`lib/catering/ezcater-intake.ts`) keeps its ledger-first, never-throw contract and executes that action with a system stage move (guarded UPDATE + append-only event + audit with `actor_context:'ezcater_webhook'`, no operator actor). The setup script subscribes the full key set.

**Tech Stack:** Next.js 16 route (unchanged), Supabase service-role client, vitest. No migration: `catering_pipeline.assigned_to`, `external_ref`, `catering_pipeline_events`, `ezcater_events` all exist.

**Spec:** `docs/superpowers/specs/2026-09-01-catering-inbox-design.md` § Amendment A1 (A1.1, A1.3, A1.4).

**Ground rules**
- Branch `feat/ezcater-lifecycle` off `origin/main`. Commit per task with the two attribution lines. Never push to main; PR at the end.
- `npm test -- <file>`, `npm run typecheck`, `npx eslint <files>`.
- Laws that bind this plan: ledger-first (every delivery appends to `ezcater_events` BEFORE processing, invalid signatures included); the route always answers 200 once the ledger row exists (ezCater retries on non-2xx); **confirmation is human, forever** — `confirmed` is reached only by the `accepted` event, which is the ezManage acceptance click; a stage move `canTransition` refuses is ledgered `illegal_transition` and left alone; append-only everywhere (no deletes, no edits to event rows); audit vocabulary is closed — reuse `catering.pipeline.create` / `catering.pipeline.edit` / `catering.pipeline.stage_move` with `metadata.actor_context = "ezcater_webhook"` and `actorId: null` (no new action names).
- ezCater leads carry NO quote in v1 (quote synthesis is 2c-b), so `reservePrepDemand` would early-return anyway — the system stage move does NOT call the prep-demand functions (they require an operator actor). Document that in code.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/ezcater/lifecycle-shared.ts` (create) | Pure: `EZCATER_ORDER_EVENT_KEYS`, `planEzcaterEvent(key, existingStage)` → one `EzcaterAction`. |
| `tests/ezcater-lifecycle.test.ts` (create) | Pins the event → action table and the transition guard. |
| `lib/catering/ezcater-intake.ts` (modify) | Executes the plan: create (inquiry or confirmed), system stage move, refresh in place, notes; assignee resolution; extended result vocabulary. |
| `scripts/ezcater-setup.ts` (modify) | `--subscribe` uses `EZCATER_ORDER_EVENT_KEYS`. |
| `docs/superpowers/specs/2026-09-01-catering-inbox-design.md` | Untouched (A1 already written). |

---

### Task 1: Pure lifecycle decision module

**Files:**
- Create: `lib/ezcater/lifecycle-shared.ts`
- Test: `tests/ezcater-lifecycle.test.ts`

- [ ] **Step 1: Branch**

```bash
cd ~/co-ops && git fetch origin && git checkout -q -b feat/ezcater-lifecycle origin/main && git log --oneline -1
```

- [ ] **Step 2: Write the failing tests** — create `tests/ezcater-lifecycle.test.ts`:

```ts
// ezCater lifecycle — pure decision table (lib/ezcater/lifecycle-shared.ts).
// Spec: catering-inbox design, Amendment A1.1. Juan (2026-09-04): capture from `submitted`
// and move the lead along automatically through every stage we can observe; confirmation
// stays human (the ezManage acceptance IS the human act); `lost` is terminal.
import { describe, expect, it } from "vitest";
import { EZCATER_ORDER_EVENT_KEYS, planEzcaterEvent } from "@/lib/ezcater/lifecycle-shared";

describe("EZCATER_ORDER_EVENT_KEYS", () => {
  it("is the live enum introspected 2026-09-03 (subscribe to all of them)", () => {
    expect([...EZCATER_ORDER_EVENT_KEYS].sort()).toEqual([
      "accepted", "cancelled", "failed", "modified", "rejected", "relish_finalized",
      "submitted", "succeeded", "succeeded_with_warnings", "uncancelled", "updated",
    ].sort());
  });
});

describe("planEzcaterEvent — no lead yet", () => {
  it("submitted creates at inquiry", () => {
    expect(planEzcaterEvent("submitted", null)).toEqual({ action: "create", stage: "inquiry" });
  });
  it("accepted without a lead (submitted missed) creates straight at confirmed", () => {
    expect(planEzcaterEvent("accepted", null)).toEqual({ action: "create", stage: "confirmed" });
  });
  it("modified/updated without a lead create at inquiry (the order exists, we just never saw it)", () => {
    expect(planEzcaterEvent("modified", null)).toEqual({ action: "create", stage: "inquiry" });
    expect(planEzcaterEvent("updated", null)).toEqual({ action: "create", stage: "inquiry" });
  });
  it("terminal or advisory events without a lead are unmatched (ledger only)", () => {
    for (const k of ["cancelled", "rejected", "failed", "uncancelled", "succeeded", "succeeded_with_warnings", "relish_finalized"]) {
      expect(planEzcaterEvent(k, null)).toEqual({ action: "unmatched" });
    }
  });
});

describe("planEzcaterEvent — lead exists", () => {
  it("accepted moves inquiry → confirmed; a repeat accepted is a duplicate", () => {
    expect(planEzcaterEvent("accepted", "inquiry")).toEqual({ action: "move", stage: "confirmed" });
    expect(planEzcaterEvent("accepted", "quote_sent")).toEqual({ action: "move", stage: "confirmed" });
    expect(planEzcaterEvent("accepted", "confirmed")).toEqual({ action: "duplicate" });
  });
  it("submitted on an existing lead is a duplicate delivery", () => {
    expect(planEzcaterEvent("submitted", "inquiry")).toEqual({ action: "duplicate" });
    expect(planEzcaterEvent("submitted", "confirmed")).toEqual({ action: "duplicate" });
  });
  it("modified/updated refresh in place, no stage change", () => {
    expect(planEzcaterEvent("modified", "inquiry")).toEqual({ action: "refresh" });
    expect(planEzcaterEvent("updated", "confirmed")).toEqual({ action: "refresh" });
  });
  it("cancelled/rejected/failed move to lost from any open stage", () => {
    for (const k of ["cancelled", "rejected", "failed"]) {
      expect(planEzcaterEvent(k, "inquiry")).toEqual({ action: "move", stage: "lost" });
      expect(planEzcaterEvent(k, "confirmed")).toEqual({ action: "move", stage: "lost" });
      expect(planEzcaterEvent(k, "out")).toEqual({ action: "move", stage: "lost" });
    }
  });
  it("a move the pipeline forbids is refused, not forced (lost and completed are terminal)", () => {
    expect(planEzcaterEvent("accepted", "lost")).toEqual({ action: "illegal_transition", stage: "confirmed" });
    expect(planEzcaterEvent("cancelled", "completed")).toEqual({ action: "illegal_transition", stage: "lost" });
    expect(planEzcaterEvent("cancelled", "lost")).toEqual({ action: "duplicate" });
  });
  it("uncancelled only notes — reopening is human (lost is terminal)", () => {
    expect(planEzcaterEvent("uncancelled", "lost")).toEqual({ action: "note" });
    expect(planEzcaterEvent("uncancelled", "confirmed")).toEqual({ action: "note" });
  });
  it("succeeded / succeeded_with_warnings / relish_finalized are advisory notes in v1", () => {
    for (const k of ["succeeded", "succeeded_with_warnings", "relish_finalized"]) {
      expect(planEzcaterEvent(k, "confirmed")).toEqual({ action: "note" });
    }
  });
  it("an unknown key is ignored", () => {
    expect(planEzcaterEvent("something_new", "inquiry")).toEqual({ action: "ignore" });
    expect(planEzcaterEvent("something_new", null)).toEqual({ action: "ignore" });
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npm test -- tests/ezcater-lifecycle.test.ts` → FAIL, module not found.

- [ ] **Step 4: Implement** — create `lib/ezcater/lifecycle-shared.ts`:

```ts
/**
 * ezCater order lifecycle — PURE decision table (zero I/O). Spec: catering-inbox design,
 * Amendment A1.1 (Juan, 2026-09-04): capture from `submitted`, move the lead along
 * automatically through every stage we can observe. The pipeline's own transition law
 * (`canTransition`) is the only authority on whether a move is allowed; this module never
 * forces one. `confirmed` is reached ONLY by `accepted` — the ezManage acceptance click, a
 * human act in a third-party tool — so the confirmation-is-human law holds.
 *
 * Event keys = the live Order `EventKey` enum introspected on api.ezcater.com 2026-09-03.
 */
import { canTransition, type PipelineStage } from "@/lib/catering/pipeline-shared";

export const EZCATER_ORDER_EVENT_KEYS = [
  "submitted", "accepted", "modified", "updated",
  "cancelled", "uncancelled", "rejected", "failed",
  "succeeded", "succeeded_with_warnings", "relish_finalized",
] as const;
export type EzcaterEventKey = (typeof EZCATER_ORDER_EVENT_KEYS)[number];

export type EzcaterAction =
  | { action: "create"; stage: "inquiry" | "confirmed" }
  | { action: "move"; stage: PipelineStage }
  | { action: "illegal_transition"; stage: PipelineStage }
  | { action: "refresh" }
  | { action: "note" }
  | { action: "duplicate" }
  | { action: "unmatched" }
  | { action: "ignore" };

const CREATE_STAGE: Partial<Record<EzcaterEventKey, "inquiry" | "confirmed">> = {
  submitted: "inquiry",
  modified: "inquiry",
  updated: "inquiry",
  accepted: "confirmed",
};
const LOST_KEYS: ReadonlySet<string> = new Set(["cancelled", "rejected", "failed"]);
const NOTE_KEYS: ReadonlySet<string> = new Set(["uncancelled", "succeeded", "succeeded_with_warnings", "relish_finalized"]);

function isKnown(key: string): key is EzcaterEventKey {
  return (EZCATER_ORDER_EVENT_KEYS as readonly string[]).includes(key);
}

/** One event + the lead's current stage (null = no lead yet) → exactly one action. */
export function planEzcaterEvent(key: string, existingStage: PipelineStage | null): EzcaterAction {
  if (!isKnown(key)) return { action: "ignore" };
  if (existingStage === null) {
    const stage = CREATE_STAGE[key];
    return stage ? { action: "create", stage } : { action: "unmatched" };
  }
  if (key === "submitted") return { action: "duplicate" };
  if (key === "modified" || key === "updated") return { action: "refresh" };
  if (NOTE_KEYS.has(key)) return { action: "note" };
  const target: PipelineStage = key === "accepted" ? "confirmed" : "lost";
  if (!LOST_KEYS.has(key) && key !== "accepted") return { action: "ignore" };
  if (existingStage === target) return { action: "duplicate" };
  return canTransition(existingStage, target) ? { action: "move", stage: target } : { action: "illegal_transition", stage: target };
}
```

- [ ] **Step 5: Run to verify it passes** — `npm test -- tests/ezcater-lifecycle.test.ts` → PASS (12 tests). Also `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add lib/ezcater/lifecycle-shared.ts tests/ezcater-lifecycle.test.ts
git commit -m "feat(ezcater): pure lifecycle decision table (submitted→inquiry, accepted→confirmed, cancelled→lost)"
```

---

### Task 2: Intake processor executes the plan

**Files:**
- Modify: `lib/catering/ezcater-intake.ts` (rewrite the processing half; keep `appendEvent`, `leadNotes`, the parse/signature/ledger preamble byte-for-byte)

Read the current file in full first. Keep: the header doc (update the paragraph that says "accepted → … cancelled → flag" to describe the A1.1 table), `EzcaterProcessingResult` (extend), `appendEvent`, `leadNotes`, and everything in `processEzcaterDelivery` up to and including the `bad_notification_shape` branch.

- [ ] **Step 1: Extend the result vocabulary**

```ts
export type EzcaterProcessingResult =
  | "created_lead"            // submitted (or modified/updated with no lead) → inquiry
  | "created_lead_confirmed"  // accepted with no prior lead → confirmed
  | "stage_moved"             // accepted → confirmed · cancelled/rejected/failed → lost
  | "refreshed"               // modified/updated → fields refreshed in place
  | "noted"                   // uncancelled / succeeded* / relish_finalized → note only
  | "duplicate"
  | "unmatched"               // terminal/advisory event for an order we never saw
  | "illegal_transition"      // canTransition refused; left for the human
  | "unmapped_location"
  | "invalid_signature"
  | "ignored_event"
  | `error:${string}`;
```

- [ ] **Step 2: Add the assignee resolver** (module-private, above `processEzcaterDelivery`)

```ts
/** A1.3: the active catering manager scoped to the lead's location, else any active one, else null. */
async function resolveCateringManager(sb: ReturnType<typeof getServiceRoleClient>, locationId: string): Promise<string | null> {
  const { data: scoped } = await sb.from("user_locations")
    .select("user_id, users!inner(id, role, active)")
    .eq("location_id", locationId).eq("active", true)
    .eq("users.role", "catering_mgr").eq("users.active", true)
    .limit(1).returns<Array<{ user_id: string }>>();
  if (scoped && scoped.length > 0 && scoped[0]) return scoped[0].user_id;
  const { data: any } = await sb.from("users").select("id").eq("role", "catering_mgr").eq("active", true)
    .order("created_at", { ascending: true }).limit(1).returns<Array<{ id: string }>>();
  return any && any.length > 0 && any[0] ? any[0].id : null;
}
```

(Service-role embed with `!inner` is legitimate here — no RLS in play, one FK between the tables. If PostgREST reports `PGRST201` because more than one FK joins `user_locations` → `users` (there are two: `user_id` and `assigned_by`), disambiguate as `users!user_locations_user_id_fkey!inner(...)` after confirming the constraint name with `select conname from pg_constraint where conrelid='user_locations'::regclass`. If the embed proves fragile, fall back to two queries: user ids for the location, then `users.in("id", ids)`.)

- [ ] **Step 3: Add the system stage move + refresh helpers**

```ts
/** System stage move — mirrors moveStage's guarded UPDATE + append-only event + audit, with NO
 *  operator actor (actor_id null, actor_context 'ezcater_webhook'). Does NOT touch prep demand:
 *  an ezCater lead carries no quote in v1 (2c-b), so reserve/consume/release would early-return. */
async function systemMoveStage(sb: ReturnType<typeof getServiceRoleClient>, lead: { id: string; stage: string }, toStage: PipelineStage, note: string): Promise<boolean> {
  const { error, count } = await sb.from("catering_pipeline")
    .update({ stage: toStage, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", lead.id).eq("stage", lead.stage);
  if (error || count === 0) return false; // moved since read → the retry delivery re-plans
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: toStage, note, actor_id: null });
  if (evErr) return false;
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.stage_move", resourceTable: "catering_pipeline", resourceId: lead.id, metadata: { actor_context: "ezcater_webhook", from_stage: lead.stage, to_stage: toStage }, ipAddress: null, userAgent: null });
  return true;
}

/** A1.1 modified/updated: refresh the order-derived fields in place; the lead identity, stage, assignee and human edits to other fields are untouched. */
async function refreshLead(sb: ReturnType<typeof getServiceRoleClient>, leadId: string, order: EzcaterOrder, note: string): Promise<boolean> {
  const { error } = await sb.from("catering_pipeline").update({
    headcount: order.headcount,
    event_date: order.eventTimestamp ? order.eventTimestamp.slice(0, 10) : null,
    time_window: order.handoffTime,
    estimated_revenue_cents: order.totalDueCents,
    notes: leadNotes(order),
    updated_at: new Date().toISOString(),
  }).eq("id", leadId);
  if (error) return false;
  await sb.from("catering_pipeline_events").insert({ pipeline_id: leadId, from_stage: null, to_stage: null, note, actor_id: null });
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.edit", resourceTable: "catering_pipeline", resourceId: leadId, metadata: { actor_context: "ezcater_webhook", reason: "ezcater_order_modified" }, ipAddress: null, userAgent: null });
  return true;
}

async function noteLead(sb: ReturnType<typeof getServiceRoleClient>, leadId: string, note: string): Promise<void> {
  await sb.from("catering_pipeline_events").insert({ pipeline_id: leadId, from_stage: null, to_stage: null, note, actor_id: null });
}
```

Check `catering_pipeline_events.to_stage` nullability before relying on a null `to_stage` for note-only rows: `select is_nullable from information_schema.columns where table_name='catering_pipeline_events' and column_name in ('from_stage','to_stage')`. If `to_stage` is NOT NULL, write note rows as `from_stage = to_stage = <current stage>` instead (a same-stage row is a note, not a transition — `canTransition(s, s)` is false by design and this insert bypasses it deliberately; say so in a comment).

- [ ] **Step 4: Replace the processing half of `processEzcaterDelivery`** (everything after the `bad_notification_shape` branch) with:

```ts
  if (notification.entityType !== "Order") {
    await appendEvent({ notification, raw, signatureValid, result: "ignored_event" });
    return { result: "ignored_event" };
  }

  const sb = getServiceRoleClient();
  const { data: existing, error: exErr } = await sb.from("catering_pipeline")
    .select("id, stage").eq("external_ref", notification.entityId)
    .maybeSingle<{ id: string; stage: string }>();
  if (exErr) {
    await appendEvent({ notification, raw, signatureValid, result: "error:lookup_failed" });
    return { result: "error:lookup_failed" };
  }
  const existingStage: PipelineStage | null = existing && isPipelineStage(existing.stage) ? existing.stage : null;
  const plan = planEzcaterEvent(notification.key, existing ? existingStage : null);
  const label = `EZCater ${notification.key} (webhook)`;

  switch (plan.action) {
    case "ignore": { await appendEvent({ notification, raw, signatureValid, result: "ignored_event", leadId: existing?.id ?? null }); return { result: "ignored_event" }; }
    case "duplicate": { await appendEvent({ notification, raw, signatureValid, result: "duplicate", leadId: existing?.id ?? null }); return { result: "duplicate" }; }
    case "unmatched": { await appendEvent({ notification, raw, signatureValid, result: "unmatched" }); return { result: "unmatched" }; }
    case "note": {
      if (existing) await noteLead(sb, existing.id, label);
      await appendEvent({ notification, raw, signatureValid, result: "noted", leadId: existing?.id ?? null });
      return { result: "noted" };
    }
    case "illegal_transition": {
      if (existing) await noteLead(sb, existing.id, `${label} — not applied: ${existing.stage} → ${plan.stage} is not a legal move; needs a human`);
      await appendEvent({ notification, raw, signatureValid, result: "illegal_transition", leadId: existing?.id ?? null });
      return { result: "illegal_transition" };
    }
    case "move": {
      if (!existing) { await appendEvent({ notification, raw, signatureValid, result: "error:missing_lead" }); return { result: "error:missing_lead" }; }
      const ok = await systemMoveStage(sb, existing, plan.stage, label);
      await appendEvent({ notification, raw, signatureValid, result: ok ? "stage_moved" : "error:stage_move", leadId: existing.id });
      return { result: ok ? "stage_moved" : "error:stage_move" };
    }
    case "refresh": {
      if (!existing) { await appendEvent({ notification, raw, signatureValid, result: "error:missing_lead" }); return { result: "error:missing_lead" }; }
      let order: EzcaterOrder;
      try { order = await fetchEzcaterOrder(notification.entityId); }
      catch (e) { const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "order_fetch"; await appendEvent({ notification, raw, signatureValid, result: `error:${code}`, leadId: existing.id }); return { result: `error:${code}` }; }
      const ok = await refreshLead(sb, existing.id, order, label);
      await appendEvent({ notification, raw, signatureValid, result: ok ? "refreshed" : "error:refresh", leadId: existing.id });
      return { result: ok ? "refreshed" : "error:refresh" };
    }
    case "create": {
      // fall through to the create path below
    }
  }

  // create — at inquiry (submitted / first sight) or confirmed (accepted, submitted missed)
  const { data: loc, error: locErr } = await sb.from("locations")
    .select("id").eq("ezcater_caterer_uuid", notification.parentId).eq("active", true)
    .maybeSingle<{ id: string }>();
  if (locErr || !loc) {
    await appendEvent({ notification, raw, signatureValid, result: locErr ? "error:location_lookup" : "unmapped_location" });
    return { result: locErr ? "error:location_lookup" : "unmapped_location" };
  }
  let order: EzcaterOrder;
  try { order = await fetchEzcaterOrder(notification.entityId); }
  catch (e) { const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "order_fetch"; await appendEvent({ notification, raw, signatureValid, result: `error:${code}` }); return { result: `error:${code}` }; }

  const assignedTo = await resolveCateringManager(sb, loc.id);
  const stage = plan.stage; // "inquiry" | "confirmed"
  const { data: inserted, error: insErr } = await sb.from("catering_pipeline").insert({
    contact_name: `EZCater order ${order.orderNumber}`,
    stage,
    lead_source: "ezcater",
    external_ref: notification.entityId,
    location_id: loc.id,
    headcount: order.headcount,
    event_date: order.eventTimestamp ? order.eventTimestamp.slice(0, 10) : null,
    time_window: order.handoffTime,
    estimated_revenue_cents: order.totalDueCents,
    notes: leadNotes(order),
    assigned_to: assignedTo,
    created_by: null,
  }).select("id").maybeSingle<{ id: string }>();
  if (insErr || !inserted) {
    const dup = insErr?.code === "23505";
    await appendEvent({ notification, raw, signatureValid, result: dup ? "duplicate" : "error:lead_insert" });
    return { result: dup ? "duplicate" : "error:lead_insert" };
  }
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: inserted.id, from_stage: null, to_stage: stage, note: `EZCater ${order.orderNumber} ${notification.key} (webhook)`, actor_id: null });
  if (evErr) { await appendEvent({ notification, raw, signatureValid, result: "error:pipeline_event", leadId: inserted.id }); return { result: "error:pipeline_event" }; }
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.create", resourceTable: "catering_pipeline", resourceId: inserted.id, metadata: { actor_context: "ezcater_webhook", lead_source: "ezcater", external_ref: notification.entityId, order_number: order.orderNumber, location_id: loc.id, stage, assigned_to: assignedTo, event_key: notification.key }, ipAddress: null, userAgent: null });
  const result: EzcaterProcessingResult = stage === "confirmed" ? "created_lead_confirmed" : "created_lead";
  await appendEvent({ notification, raw, signatureValid, result, leadId: inserted.id });
  return { result };
```

Add the imports: `import { planEzcaterEvent } from "@/lib/ezcater/lifecycle-shared";` and `import { isPipelineStage, type PipelineStage } from "@/lib/catering/pipeline-shared";` (confirm `isPipelineStage` is exported from `pipeline-shared.ts`; if it lives only in `pipeline.ts`, add a one-line re-export in `pipeline-shared.ts` or reimplement as `PIPELINE_STAGES.includes(s)`).

- [ ] **Step 5: Update the header doc** of `ezcater-intake.ts` to the A1.1 table (one paragraph), and delete the "v1 scope honesty: NO auto-advance to confirmed" paragraph — replace with: "`confirmed` is reached only by `accepted` (the ezManage acceptance = the human act). Prep demand is not touched by the system move: ezCater leads carry no quote until 2c-b."

- [ ] **Step 6: Verify** — `npm run typecheck`, `npx eslint lib/catering/ezcater-intake.ts lib/ezcater/lifecycle-shared.ts`, `npm test` (full). Expected: clean; suite green (2262 + 12).

- [ ] **Step 7: Commit**

```bash
git add lib/catering/ezcater-intake.ts
git commit -m "feat(ezcater): lead follows the order — submitted→inquiry, accepted→confirmed, modified→refresh, cancelled→lost; catering manager auto-assigned"
```

---

### Task 3: Setup script subscribes the full key set

**Files:**
- Modify: `scripts/ezcater-setup.ts`

- [ ] **Step 1:** Import `EZCATER_ORDER_EVENT_KEYS` from `@/lib/ezcater/lifecycle-shared` and change `for (const eventKey of ["accepted", "cancelled"])` to `for (const eventKey of EZCATER_ORDER_EVENT_KEYS)`. Update the header comment: "`--subscribe` creates one Order subscription per event key in `EZCATER_ORDER_EVENT_KEYS` for each caterer; re-running for an already-subscribed pair is reported as FAILED by ezCater and is harmless."

- [ ] **Step 2:** `npm run typecheck && npx eslint scripts/ezcater-setup.ts` → clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/ezcater-setup.ts
git commit -m "feat(ezcater): setup script subscribes every Order event key"
```

---

### Task 4: PR + operations

- [ ] **Step 1:** Push and open the PR:

```bash
git push -u origin feat/ezcater-lifecycle
gh pr create --title "feat(ezcater): lead follows the order — submitted→inquiry, accepted→confirmed, modified→refresh, cancelled→lost" --body-file - <<'EOF'
## What
Catering inbox Amendment A1.1 + A1.3 (Juan, 2026-09-04). An ezCater order becomes a lead at `submitted` and follows the order: `accepted` → confirmed (the ezManage acceptance is the human act), `modified`/`updated` → refreshed in place, `cancelled`/`rejected`/`failed` → lost, `uncancelled` and `succeeded*` → note only. Moves go through the pipeline's `canTransition`; a refused move is ledgered `illegal_transition` and left for a human. The catering manager for the location is auto-assigned. Pure decision table in `lib/ezcater/lifecycle-shared.ts` (+12 tests). No migration.

## Not in this PR
Toast catering scan (A1.2, separate PR); quote synthesis (2c-b); assignee notification (inbox arc escalation).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 2 (after merge, CC):** subscribe the new keys for both caterers with the merged script: `npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-setup.ts --subscribe ce86eeb7-3b05-4e9c-8577-81bf224be7d6 d1be3096-fc70-4790-aeaf-7cc447f4977b c0996af5-7a3f-45d7-a407-e51c45411c92` — expect the two already-subscribed keys per caterer to report FAILED (already exists) and the other nine `ok`.

- [ ] **Step 3 (Juan errand):** create Keith's account as **Catering Manager** at both locations in `/admin/users`; until it exists, `resolveCateringManager` returns null and leads land unassigned.

- [ ] **Step 4 (first real order):** confirm in `ezcater_events` that a `submitted` delivery produced `created_lead` and the later `accepted` produced `stage_moved`; confirm `orderByID` succeeded pre-acceptance (if it is refused before acceptance, the `create` path will ledger `error:...` — then the fix is to create from the notification alone and refresh on `accepted`).

---

## Self-review
- Spec coverage: A1.1 table → Task 1 (decision) + Task 2 (execution); A1.3 assignment → Task 2 resolver; subscriptions → Task 3 + Task 4 step 2; laws (ledger-first, human confirmation, terminal lost, no forced moves, closed audit vocabulary) → stated in ground rules and encoded in tests.
- Placeholders: none. Every step has code or an exact command.
- Type consistency: `EzcaterAction` variants match every `case` in Task 2; `planEzcaterEvent(key, existingStage)` signature is the same in tests, module, and processor; result strings in Task 2 are all members of the extended `EzcaterProcessingResult`.
