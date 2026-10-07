/**
 * Batch vs bottle PHASE B — yield stats + drift nudges. SERVER-ONLY, service-role.
 *
 * A computed READ over Phase A's capture (0215: live `productions` headers with batches_made > 0
 * carry came_out_to, yield_at_time and made_by) plus the human actions on a nudge (0218).
 * The math is pure in lib/yield-stats-shared.ts; this module loads, binds and writes.
 *
 * AUTHORITY (Juan 2026-10-07 + the plan S r4 §5 addendum + the retrain-assign GO):
 *   · read — level ≥ YIELD_STATS_READ_MIN (5, shift lead), VIEW-ONLY below GM. The read bind is
 *     the REPORT bind, `canReadReportLocation` (Astra r1 #4): a GM reads only their own shops,
 *     level 8 (MoO) reads every shop — the same grant every other report surface gives them;
 *   · Retrain (recipe nudge or a maker's item) — GM 7 ONLY for both scopes (Juan: "Retrain should
 *     be a GM option"), bound with the OPERATIONAL bind `lockLocationContext`. The GM may assign
 *     the retraining to an active KH+ at that shop whose level is ≤ the GM's; otherwise the GM
 *     owns it. It shows on the assignee's "My shift" until marked done;
 *   · Mark done — the assignee, or a GM bound to the shop, once (complete_yield_retrain);
 *   · Update recipe yield — GM 7 + the recipe-edit Tier-B step-up (asserted at the route under
 *     /api/admin so the unlock survives), operational bind, written through
 *     lib/recipes.ts updateRecipeOutputYield → update_recipe_output_yield (the serialised writer).
 *   Retrain and Update refuse 409 `no_active_nudge` unless the server's own recomputation shows a
 *   live nudge in that scope right now. Nothing here ever changes a recipe on its own.
 *
 * MISSING 0218 (Astra r1 note): if the notes table is not there, every entry point answers
 * `yield_unavailable` (503) — the view renders an explicit "unavailable" state with no actions.
 * Verdicts are NEVER computed against an empty note list, which would fabricate unsnoozed nudges.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel, isRoleCode } from "@/lib/roles";
import { canReadReportLocation, lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadBatchContextForItems } from "@/lib/batch-prep";
import { updateRecipeOutputYield } from "@/lib/recipes";
import {
  RETRAIN_ASSIGNEE_MIN,
  YIELD_ACTION_MIN,
  YIELD_STATS_READ_MIN,
  YIELD_STATS_WINDOW,
  canMarkRetrainDone,
  evaluateItem,
  isEligibleRetrainAssignee,
  isValidCardYield,
  normalizeRetrainNote,
  type ItemYieldVerdict,
  type RetrainNoteLite,
  type RetrainStatus,
  type YieldBatch,
  type YieldScope,
} from "@/lib/yield-stats-shared";

export { YIELD_ACTION_MIN, YIELD_STATS_READ_MIN };

/** How far back the loader reads batch headers. A maker's "last 10" older than a year is not a
 *  verdict about how they make it now; the bound also keeps the read constant-sized over years. */
export const YIELD_LOOKBACK_DAYS = 365;

export class YieldStatsError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "YieldStatsError";
  }
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}
function actorLevel(actor: AuthContext): number {
  return getRoleLevel(actor.user.role);
}
function requireLevel(actor: AuthContext, min: number): void {
  if (actorLevel(actor) < min) throw new YieldStatsError(403, "forbidden");
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sb = ReturnType<typeof getServiceRoleClient>;

/** True when a PostgREST / Postgres error says the 0218 table does not exist (yet). */
export function isMissingRetrainTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /recipe_yield_retrain_notes/.test(error.message ?? "") && /does not exist|could not find/i.test(error.message ?? "");
}

/** Live batch headers at ONE location (optionally ONE item), inside the lookback. */
async function loadBatches(sb: Sb, locationId: string, itemId: string | null, now: Date): Promise<YieldBatch[]> {
  const since = new Date(now.getTime() - YIELD_LOOKBACK_DAYS * 86_400_000).toISOString();
  const rows = await selectAllRows<{ id: string; output_item_id: string; produced_at: string; made_by: string | null; batches_made: number | string | null; came_out_to: number | string | null; yield_at_time: number | string | null }>((from, to) => {
    let q = sb.from("productions")
      .select("id, output_item_id, produced_at, made_by, batches_made, came_out_to, yield_at_time")
      .eq("location_id", locationId)
      .is("superseded_at", null).is("revoked_at", null)
      .gt("batches_made", 0)
      .not("came_out_to", "is", null).not("yield_at_time", "is", null)
      .gte("produced_at", since);
    if (itemId) q = q.eq("output_item_id", itemId);
    return q.order("produced_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });
  const out: YieldBatch[] = [];
  for (const r of rows) {
    const batchesMade = num(r.batches_made);
    const cameOutTo = num(r.came_out_to);
    const yieldAtTime = num(r.yield_at_time);
    if (batchesMade === null || cameOutTo === null || yieldAtTime === null) continue;
    out.push({ id: r.id, itemId: r.output_item_id, producedAt: r.produced_at, madeBy: r.made_by, batchesMade, cameOutTo, yieldAtTime });
  }
  return out;
}

interface NoteRow {
  id: string; item_id: string; recipe_id: string; scope: YieldScope; maker_id: string | null; created_at: string;
  snooze_batches: number | string; status: RetrainStatus; assigned_to: string; done_at: string | null;
  done_by: string | null; done_note: string | null; created_by: string; note: string | null; outlier_user_ids: string[] | null;
}
const NOTE_COLUMNS = "id, item_id, recipe_id, scope, maker_id, created_at, snooze_batches, status, assigned_to, done_at, done_by, done_note, created_by, note, outlier_user_ids";

/**
 * Retrain notes at ONE location (optionally ONE item). Paginated by hand so the error CODE
 * survives: a missing table is `yield_unavailable`, never an empty list.
 */
async function loadNoteRows(sb: Sb, locationId: string, itemId: string | null): Promise<NoteRow[]> {
  const out: NoteRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from("recipe_yield_retrain_notes").select(NOTE_COLUMNS).eq("location_id", locationId);
    if (itemId) q = q.eq("item_id", itemId);
    const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 999);
    if (error) {
      if (isMissingRetrainTable(error)) throw new YieldStatsError(503, "yield_unavailable");
      throw new Error(`loadNoteRows: ${error.message}`);
    }
    const rows = (data ?? []) as NoteRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
function liteOf(r: NoteRow): RetrainNoteLite {
  return {
    id: r.id, itemId: r.item_id, scope: r.scope, makerId: r.maker_id, createdAt: r.created_at,
    snoozeBatches: num(r.snooze_batches) ?? YIELD_STATS_WINDOW, status: r.status === "done" ? "done" : "open",
    assignedTo: r.assigned_to ?? null, doneAt: r.done_at, doneBy: r.done_by,
  };
}

async function loadNames(sb: Sb, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  for (let i = 0; i < uniq.length; i += 100) {
    const { data, error } = await sb.from("users").select("id, name").in("id", uniq.slice(i, i + 100)).returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`yield-stats names: ${error.message}`);
    for (const u of data ?? []) out.set(u.id, u.name);
  }
  return out;
}

export interface YieldLineView {
  id: string;
  producedAt: string;
  makerId: string | null;
  makerName: string | null;
  batchesMade: number;
  cameOutTo: number;
  yieldAtTime: number;
  /** The fraction of this entry the window holds (1 except at the boundary). */
  weight: number;
}

export interface RetrainNoteView {
  id: string;
  scope: YieldScope;
  status: RetrainStatus;
  createdAt: string;
  createdByName: string | null;
  assignedToName: string | null;
  doneAt: string | null;
  doneByName: string | null;
}

export interface YieldItemView {
  itemId: string;
  itemName: string;
  itemNameEs: string | null;
  unit: string | null;
  /** The producing recipe today (first-wins, lib/batch-prep.ts); null when it was retired. */
  recipeId: string | null;
  recipeName: string | null;
  recipeNameEs: string | null;
  /** The card's yield TODAY (recipe_outputs.yield); the verdict compares each batch with its own yield_at_time. */
  cardNow: number | null;
  /** The recipe is still a batch recipe, so Update recipe yield can be offered. */
  updatable: boolean;
  verdict: ItemYieldVerdict;
  /** The recipe window's entries, newest first, for the "each batch's came_out_to" list. */
  lines: YieldLineView[];
  /** Per maker: their window's entries, newest first. */
  makerLines: Record<string, YieldLineView[]>;
  makerNames: Record<string, string>;
  /** Every note a verdict on this item references (hold or latest), by id. */
  notes: Record<string, RetrainNoteView>;
}

export interface RetrainAssigneeOption { id: string; name: string; level: number }

export interface YieldVarianceView {
  locationId: string;
  /** 0218 is not applied: an explicit unavailable state, no verdicts, no actions. */
  unavailable: boolean;
  items: YieldItemView[];
  /** GM 7+ bound to this shop: the Retrain and Update buttons render. */
  canAct: boolean;
  /** The Retrain form's "Who will retrain them?" options (canAct only). */
  assignees: RetrainAssigneeOption[];
  /** Counts for a hub's attention strip. */
  recipeNudges: number;
  makerItems: number;
}

/**
 * Active KH+ with an ACTIVE MEMBERSHIP at the shop, level ≤ the actor's (the picker floor). CC r2:
 * memberships only — the acting user is never added unconditionally, so a level-9 owner with no
 * membership row stays out. Self-retraining is the separate default path ("Me"), not a picker row.
 */
async function loadAssigneeOptions(sb: Sb, actor: AuthContext, locationId: string): Promise<RetrainAssigneeOption[]> {
  const { data: members, error: mErr } = await sb.from("user_locations").select("user_id")
    .eq("location_id", locationId).eq("active", true).returns<Array<{ user_id: string }>>();
  if (mErr) throw new Error(`loadAssigneeOptions members: ${mErr.message}`);
  const atShop = new Set((members ?? []).map((m) => m.user_id));
  const ids = [...atShop];
  if (ids.length === 0) return [];
  const users: Array<{ id: string; name: string; role: string; active: boolean }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("users").select("id, name, role, active").in("id", ids.slice(i, i + 100))
      .returns<Array<{ id: string; name: string; role: string; active: boolean }>>();
    if (error) throw new Error(`loadAssigneeOptions users: ${error.message}`);
    users.push(...(data ?? []));
  }
  const level = actorLevel(actor);
  return users
    .filter((u) => isRoleCode(u.role) && isEligibleRetrainAssignee({ level: getRoleLevel(u.role), active: u.active, atShop: atShop.has(u.id) }, level))
    .map((u) => ({ id: u.id, name: u.name, level: getRoleLevel(u.role as Parameters<typeof getRoleLevel>[0]) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The variance view for one shop: per recipe and per maker, average vs card with the signed %
 * and direction, plus each batch's came_out_to. Level ≥ 5, REPORT-bound (level 8 reads all).
 */
export async function loadYieldVariance(actor: AuthContext, locationId: string, now: Date = new Date()): Promise<YieldVarianceView> {
  requireLevel(actor, YIELD_STATS_READ_MIN);
  if (!canReadReportLocation(actorLoc(actor), locationId)) throw new YieldStatsError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const canAct = actorLevel(actor) >= YIELD_ACTION_MIN && lockLocationContext(actorLoc(actor), locationId);
  let noteRows: NoteRow[];
  try {
    noteRows = await loadNoteRows(sb, locationId, null);
  } catch (e) {
    if (e instanceof YieldStatsError && e.code === "yield_unavailable") {
      return { locationId, unavailable: true, items: [], canAct: false, assignees: [], recipeNudges: 0, makerItems: 0 };
    }
    throw e;
  }
  const notes = noteRows.map(liteOf);
  const batches = await loadBatches(sb, locationId, null, now);
  const assignees = canAct ? await loadAssigneeOptions(sb, actor, locationId) : [];
  if (batches.length === 0) return { locationId, unavailable: false, items: [], canAct, assignees, recipeNudges: 0, makerItems: 0 };

  const itemIds = [...new Set(batches.map((b) => b.itemId))];
  const [ctx, itemsRes] = await Promise.all([
    loadBatchContextForItems(itemIds),
    sb.from("items").select("id, name, name_es, default_par_unit").in("id", itemIds)
      .returns<Array<{ id: string; name: string; name_es: string | null; default_par_unit: string | null }>>(),
  ]);
  if (itemsRes.error) throw new Error(`loadYieldVariance items: ${itemsRes.error.message}`);
  const nameById = await loadNames(sb, [
    ...batches.map((b) => b.madeBy ?? ""),
    ...noteRows.flatMap((n) => [n.created_by, n.assigned_to, n.done_by ?? ""]),
  ]);
  const recipeIds = [...new Set([...ctx.values()].map((c) => c.recipeId))];
  const recipeEs = new Map<string, string | null>();
  if (recipeIds.length) {
    const { data, error } = await sb.from("recipes").select("id, name_es").in("id", recipeIds).returns<Array<{ id: string; name_es: string | null }>>();
    if (error) throw new Error(`loadYieldVariance recipes: ${error.message}`);
    for (const r of data ?? []) recipeEs.set(r.id, r.name_es);
  }
  const itemById = new Map((itemsRes.data ?? []).map((i) => [i.id, i]));
  const noteById = new Map(noteRows.map((n) => [n.id, n]));
  const lineOf = (b: YieldBatch & { weight: number }): YieldLineView => ({
    id: b.id, producedAt: b.producedAt, makerId: b.madeBy, makerName: b.madeBy ? (nameById.get(b.madeBy) ?? null) : null,
    batchesMade: b.batchesMade, cameOutTo: b.cameOutTo, yieldAtTime: b.yieldAtTime, weight: b.weight,
  });
  const noteView = (id: string): RetrainNoteView | null => {
    const n = noteById.get(id);
    if (!n) return null;
    return {
      id: n.id, scope: n.scope, status: n.status === "done" ? "done" : "open", createdAt: n.created_at,
      createdByName: nameById.get(n.created_by) ?? null, assignedToName: nameById.get(n.assigned_to) ?? null,
      doneAt: n.done_at, doneByName: n.done_by ? (nameById.get(n.done_by) ?? null) : null,
    };
  };

  const items: YieldItemView[] = itemIds.map((itemId) => {
    const verdict = evaluateItem(itemId, batches, notes);
    const c = ctx.get(itemId) ?? null;
    const it = itemById.get(itemId);
    const makerNames: Record<string, string> = {};
    const makerLines: Record<string, YieldLineView[]> = {};
    const referenced = new Set<string>();
    for (const s of [verdict.recipe, ...verdict.makers]) {
      if (s.hold) referenced.add(s.hold.noteId);
      if (s.latestNoteId) referenced.add(s.latestNoteId);
    }
    for (const m of verdict.makers) {
      makerNames[m.makerId] = nameById.get(m.makerId) ?? "—";
      makerLines[m.makerId] = m.window.map(lineOf);
    }
    const notesOut: Record<string, RetrainNoteView> = {};
    for (const id of referenced) { const v = noteView(id); if (v) notesOut[id] = v; }
    return {
      itemId,
      itemName: it?.name ?? "(item)",
      itemNameEs: it?.name_es ?? null,
      unit: it?.default_par_unit ?? null,
      recipeId: c?.recipeId ?? null,
      recipeName: c?.recipeName ?? null,
      recipeNameEs: c ? (recipeEs.get(c.recipeId) ?? null) : null,
      cardNow: c?.yieldPerBatch ?? null,
      updatable: !!c && c.isBatch,
      verdict,
      lines: verdict.recipe.window.map(lineOf),
      makerLines,
      makerNames,
      notes: notesOut,
    };
  });
  // Nudges first, then by name — the attention order the page renders.
  items.sort((a, b) => Number(b.verdict.recipe.nudge) - Number(a.verdict.recipe.nudge) || (a.recipeName ?? a.itemName).localeCompare(b.recipeName ?? b.itemName));
  const recipeNudges = items.filter((i) => i.verdict.recipe.nudge).length;
  const makerItems = items.reduce((n, i) => n + i.verdict.makers.filter((m) => m.nudge).length, 0);
  return { locationId, unavailable: false, items, canAct, assignees, recipeNudges, makerItems };
}

/** One item's verdict, recomputed server-side from the live rows (the actions' ground truth). */
async function currentVerdict(sb: Sb, locationId: string, itemId: string, now: Date): Promise<ItemYieldVerdict> {
  const notes = (await loadNoteRows(sb, locationId, itemId)).map(liteOf);
  const batches = await loadBatches(sb, locationId, itemId, now);
  return evaluateItem(itemId, batches, notes);
}

export interface RetrainInput {
  locationId: string;
  itemId: string;
  scope: YieldScope;
  /** Required for scope "maker". */
  makerId?: string | null;
  note?: unknown;
  /** Optional KH+ at the shop (level ≤ the GM's) who will do the retraining; default the GM. */
  assignedTo?: string | null;
}

/** The chosen assignee must pass the picker's own floor, re-checked server-side. */
async function assertAssignable(sb: Sb, actor: AuthContext, locationId: string, userId: string): Promise<void> {
  if (userId === actor.user.id) return;
  if (!UUID_RE.test(userId)) throw new YieldStatsError(400, "invalid_payload");
  const options = await loadAssigneeOptions(sb, actor, locationId);
  if (!options.some((o) => o.id === userId)) throw new YieldStatsError(400, "invalid_assignee");
}

/**
 * Retrain (GM 7, both scopes): records a note naming the outlier makers (recipe scope) or the one
 * maker (maker scope) and so holds that scope's nudge — and, for a recipe note, the recipe's maker
 * items — for its next YIELD_STATS_WINDOW batches. Assigned to a KH+ other than the GM: an OPEN task
 * (My shift) that also holds the nudge until marked done. No assignee / the GM: done at once.
 * Bound to the shop BEFORE any I/O. Changes no recipe.
 */
export async function recordYieldRetrain(actor: AuthContext, input: RetrainInput, now: Date = new Date()): Promise<{ id: string }> {
  requireLevel(actor, YIELD_ACTION_MIN);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new YieldStatsError(404, "not_found", "Location not found");
  if (!UUID_RE.test(input.itemId)) throw new YieldStatsError(400, "invalid_payload");
  if (input.scope !== "recipe" && input.scope !== "maker") throw new YieldStatsError(400, "invalid_payload");
  const makerId = input.scope === "maker" ? (input.makerId ?? null) : null;
  if (input.scope === "maker" && (typeof makerId !== "string" || !UUID_RE.test(makerId))) throw new YieldStatsError(400, "invalid_payload");
  const note = normalizeRetrainNote(input.note);
  if (note === "invalid") throw new YieldStatsError(400, "invalid_note");
  if (input.assignedTo !== undefined && input.assignedTo !== null && typeof input.assignedTo !== "string") throw new YieldStatsError(400, "invalid_payload");

  const sb = getServiceRoleClient();
  const assignedTo = input.assignedTo || actor.user.id;
  // CC r2: a SELF-retrain (no assignee, or the GM picked himself) is recorded DONE at once, by the
  // GM, now — no My shift task, and the nudge returns after the 10-batch snooze. Only a KH+ OTHER
  // than the GM opens a task that holds the nudge until it is marked done.
  const selfRetrain = assignedTo === actor.user.id;
  if (!selfRetrain) await assertAssignable(sb, actor, input.locationId, assignedTo);
  const verdict = await currentVerdict(sb, input.locationId, input.itemId, now);
  const scopeVerdict = input.scope === "recipe" ? verdict.recipe : verdict.makers.find((m) => m.makerId === makerId);
  if (!scopeVerdict || !scopeVerdict.nudge || !scopeVerdict.summary) throw new YieldStatsError(409, "no_active_nudge");
  const ctx = (await loadBatchContextForItems([input.itemId])).get(input.itemId);
  if (!ctx) throw new YieldStatsError(404, "recipe_not_found");

  const outliers = input.scope === "recipe" ? verdict.recipe.outlierMakerIds : [makerId as string];
  const { data, error } = await sb.from("recipe_yield_retrain_notes").insert({
    location_id: input.locationId,
    recipe_id: ctx.recipeId,
    item_id: input.itemId,
    scope: input.scope,
    maker_id: makerId,
    outlier_user_ids: outliers,
    note,
    signed_drift: scopeVerdict.summary.signedDrift,
    batches_in_window: Math.max(1, Math.round(scopeVerdict.summary.batches)),
    snooze_batches: YIELD_STATS_WINDOW,
    created_by: actor.user.id,
    assigned_to: assignedTo,
    ...(selfRetrain
      ? { status: "done", done_at: now.toISOString(), done_by: actor.user.id }
      : { status: "open" }),
  }).select("id").maybeSingle<{ id: string }>();
  if (error) {
    if (isMissingRetrainTable(error)) throw new YieldStatsError(503, "yield_unavailable");
    throw new Error(`recordYieldRetrain: ${error.message}`);
  }
  if (!data) throw new Error("recordYieldRetrain returned no row");
  const meta = { location_id: input.locationId, recipe_id: ctx.recipeId, item_id: input.itemId, scope: input.scope, maker_id: makerId, outlier_user_ids: outliers, assigned_to: assignedTo, self_retrain: selfRetrain };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "yield.retrain_noted",
    resourceTable: "recipe_yield_retrain_notes", resourceId: data.id,
    metadata: { ...meta, signed_drift: scopeVerdict.summary.signedDrift, batches_in_window: scopeVerdict.summary.batches, snooze_batches: YIELD_STATS_WINDOW, has_note: note !== null },
    ipAddress: null, userAgent: null,
  });
  if (!selfRetrain) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role, action: "yield.retrain_assigned",
      resourceTable: "recipe_yield_retrain_notes", resourceId: data.id, metadata: meta,
      ipAddress: null, userAgent: null,
    });
  }
  return { id: data.id };
}

/**
 * Mark an open retrain done: its assignee, or a GM — both bound to the note's shop with the
 * operational bind before the write. One time only (complete_yield_retrain refuses a second).
 */
export async function completeYieldRetrain(actor: AuthContext, input: { noteId: string; doneNote?: unknown }): Promise<{ id: string }> {
  if (!UUID_RE.test(input.noteId)) throw new YieldStatsError(400, "invalid_payload");
  const doneNote = normalizeRetrainNote(input.doneNote);
  if (doneNote === "invalid") throw new YieldStatsError(400, "invalid_note");
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb.from("recipe_yield_retrain_notes")
    .select("id, location_id, assigned_to, status").eq("id", input.noteId)
    .maybeSingle<{ id: string; location_id: string; assigned_to: string; status: RetrainStatus }>();
  if (error) {
    if (isMissingRetrainTable(error)) throw new YieldStatsError(503, "yield_unavailable");
    throw new Error(`completeYieldRetrain read: ${error.message}`);
  }
  if (!row || !lockLocationContext(actorLoc(actor), row.location_id)) throw new YieldStatsError(404, "not_found");
  if (row.status !== "open") throw new YieldStatsError(409, "retrain_already_done");
  if (!canMarkRetrainDone({ userId: actor.user.id, level: actorLevel(actor) }, { assignedTo: row.assigned_to, status: row.status })) {
    throw new YieldStatsError(403, "forbidden");
  }
  const { error: rpcErr } = await sb.rpc("complete_yield_retrain", {
    p_note_id: row.id, p_location_id: row.location_id, p_actor: actor.user.id, p_done_note: doneNote,
  });
  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    if (/\bretrain_already_done\b/.test(msg)) throw new YieldStatsError(409, "retrain_already_done");
    if (/\bretrain_not_found\b/.test(msg)) throw new YieldStatsError(404, "not_found");
    throw new Error(`completeYieldRetrain: ${msg}`);
  }
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "yield.retrain_done",
    resourceTable: "recipe_yield_retrain_notes", resourceId: row.id,
    metadata: { location_id: row.location_id, assigned_to: row.assigned_to, by_assignee: row.assigned_to === actor.user.id, has_note: doneNote !== null },
    ipAddress: null, userAgent: null,
  });
  return { id: row.id };
}

export interface RetrainTaskView {
  noteId: string;
  scope: YieldScope;
  recipeName: string;
  recipeNameEs: string | null;
  /** Who to retrain: the maker (maker scope) or the outlier makers the note named (recipe scope). */
  traineeNames: string[];
  fromName: string | null;
  createdAt: string;
  note: string | null;
}

/**
 * "My shift": the OPEN retrains assigned to the actor at this shop, newest first. Operational
 * bind; anyone the GM could assign (KH+) may hold one, and only they see it here. They persist
 * until marked done — they are not daily report_assignments. A missing 0218 reads as no tasks
 * (a dashboard widget must not fail the dashboard; the yield page itself says "unavailable").
 */
export async function loadMyRetrainTasks(actor: AuthContext, locationId: string): Promise<RetrainTaskView[]> {
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new YieldStatsError(404, "not_found");
  if (actorLevel(actor) < RETRAIN_ASSIGNEE_MIN) return [];
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("recipe_yield_retrain_notes").select(NOTE_COLUMNS)
    .eq("location_id", locationId).eq("assigned_to", actor.user.id).eq("status", "open")
    .order("created_at", { ascending: false }).range(0, 199);
  if (error) {
    if (isMissingRetrainTable(error)) return [];
    throw new Error(`loadMyRetrainTasks: ${error.message}`);
  }
  const rows = (data ?? []) as NoteRow[];
  if (rows.length === 0) return [];
  const recipeIds = [...new Set(rows.map((r) => r.recipe_id))];
  const { data: recipes, error: rErr } = await sb.from("recipes").select("id, name, name_es").in("id", recipeIds)
    .returns<Array<{ id: string; name: string; name_es: string | null }>>();
  if (rErr) throw new Error(`loadMyRetrainTasks recipes: ${rErr.message}`);
  const recipeById = new Map((recipes ?? []).map((r) => [r.id, r]));
  const names = await loadNames(sb, rows.flatMap((r) => [r.created_by, ...(r.scope === "maker" && r.maker_id ? [r.maker_id] : (r.outlier_user_ids ?? []))]));
  return rows.map((r) => ({
    noteId: r.id,
    scope: r.scope,
    recipeName: recipeById.get(r.recipe_id)?.name ?? "—",
    recipeNameEs: recipeById.get(r.recipe_id)?.name_es ?? null,
    traineeNames: (r.scope === "maker" && r.maker_id ? [r.maker_id] : (r.outlier_user_ids ?? [])).map((id) => names.get(id) ?? "—"),
    fromName: names.get(r.created_by) ?? null,
    createdAt: r.created_at,
    note: r.note,
  }));
}

/**
 * Update recipe yield from a live recipe-level nudge. GM 7+ (the route adds Tier-B step-up),
 * bound to the shop whose batches raised the nudge, and written ONLY through the serialised
 * output writer (lib/recipes.ts updateRecipeOutputYield → update_recipe_output_yield). The new
 * yield is the GM's number — the page pre-fills the observed average; nothing is auto-applied.
 */
export async function updateRecipeYieldFromNudge(actor: AuthContext, input: { locationId: string; itemId: string; yield: unknown }, now: Date = new Date()): Promise<{ outputId: string; before: number | null; after: number }> {
  requireLevel(actor, YIELD_ACTION_MIN);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new YieldStatsError(404, "not_found", "Location not found");
  if (!UUID_RE.test(input.itemId)) throw new YieldStatsError(400, "invalid_payload");
  if (!isValidCardYield(input.yield)) throw new YieldStatsError(400, "invalid_yield");

  const sb = getServiceRoleClient();
  const verdict = await currentVerdict(sb, input.locationId, input.itemId, now);
  if (!verdict.recipe.nudge || !verdict.recipe.summary) throw new YieldStatsError(409, "no_active_nudge");
  const ctx = (await loadBatchContextForItems([input.itemId])).get(input.itemId);
  if (!ctx || !ctx.isBatch) throw new YieldStatsError(409, "not_batch_recipe");

  return updateRecipeOutputYield(actor, {
    recipeId: ctx.recipeId,
    outputItemId: input.itemId,
    yield: input.yield,
    context: { locationId: input.locationId, source: "yield_nudge", observedSignedDrift: verdict.recipe.summary.signedDrift, batchesInWindow: verdict.recipe.summary.batches },
  });
}
