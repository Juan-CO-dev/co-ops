/**
 * Batch vs bottle PHASE B — yield stats + drift nudges. SERVER-ONLY, service-role.
 *
 * A computed READ over Phase A's capture (0215: live `productions` headers with batches_made > 0
 * carry came_out_to, yield_at_time and made_by) plus the two human actions on a nudge (0218).
 * The math is pure in lib/yield-stats-shared.ts; this module loads, binds and writes.
 *
 * AUTHORITY (Juan 2026-10-07 + the plan S r4 §5 addendum):
 *   · read — level ≥ YIELD_STATS_READ_MIN (5, shift lead), bound to the shop with
 *     lockLocationContext (the same bind as lib/production.ts reads; level 9+ sees every shop,
 *     a GM only their own);
 *   · Retrain (recipe nudge or a maker's item) — level ≥ YIELD_ACTION_MIN (7, GM), bound;
 *   · Update recipe yield — GM 7 + the recipe-edit Tier-B step-up (asserted at the route, which
 *     lives under /api/admin so the unlock survives), bound, and written through
 *     lib/recipes.ts updateRecipeOutputYield → update_recipe_output_yield (the serialised writer).
 *   Both actions refuse 409 `no_active_nudge` unless the server's own recomputation shows a live
 *   nudge in that scope right now: the tap acts on what the system sees, not on what a stale page
 *   showed. Nothing here ever changes a recipe on its own.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadBatchContextForItems } from "@/lib/batch-prep";
import { updateRecipeOutputYield } from "@/lib/recipes";
import {
  YIELD_ACTION_MIN,
  YIELD_STATS_READ_MIN,
  YIELD_STATS_WINDOW,
  evaluateItem,
  isValidCardYield,
  normalizeRetrainNote,
  type ItemYieldVerdict,
  type RetrainNoteLite,
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
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new YieldStatsError(403, "forbidden");
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sb = ReturnType<typeof getServiceRoleClient>;

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

/** Retrain notes at ONE location (optionally ONE item). */
async function loadNotes(sb: Sb, locationId: string, itemId: string | null): Promise<RetrainNoteLite[]> {
  const rows = await selectAllRows<{ id: string; item_id: string; scope: YieldScope; maker_id: string | null; created_at: string; snooze_batches: number | string }>((from, to) => {
    let q = sb.from("recipe_yield_retrain_notes")
      .select("id, item_id, scope, maker_id, created_at, snooze_batches")
      .eq("location_id", locationId);
    if (itemId) q = q.eq("item_id", itemId);
    return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });
  return rows.map((r) => ({ id: r.id, itemId: r.item_id, scope: r.scope, makerId: r.maker_id, createdAt: r.created_at, snoozeBatches: num(r.snooze_batches) ?? YIELD_STATS_WINDOW }));
}

export interface YieldLineView {
  id: string;
  producedAt: string;
  makerId: string | null;
  makerName: string | null;
  batchesMade: number;
  cameOutTo: number;
  yieldAtTime: number;
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
  /** The recipe window's headers, newest first, for the "each batch's came_out_to" list. */
  lines: YieldLineView[];
  /** Per maker: their window's headers, newest first. */
  makerLines: Record<string, YieldLineView[]>;
  makerNames: Record<string, string>;
}

export interface YieldVarianceView {
  locationId: string;
  items: YieldItemView[];
  /** GM 7+: the Retrain and Update buttons render. */
  canAct: boolean;
  /** Counts for a hub's attention strip. */
  recipeNudges: number;
  makerItems: number;
}

/**
 * The variance view for one shop: per recipe and per maker, average vs card with the signed %
 * and direction, plus each batch's came_out_to. Level ≥ 5, location-bound.
 */
export async function loadYieldVariance(actor: AuthContext, locationId: string, now: Date = new Date()): Promise<YieldVarianceView> {
  requireLevel(actor, YIELD_STATS_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new YieldStatsError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const [batches, notes] = await Promise.all([loadBatches(sb, locationId, null, now), loadNotes(sb, locationId, null)]);
  const canAct = getRoleLevel(actor.user.role) >= YIELD_ACTION_MIN;
  if (batches.length === 0) return { locationId, items: [], canAct, recipeNudges: 0, makerItems: 0 };

  const itemIds = [...new Set(batches.map((b) => b.itemId))];
  const makerIds = [...new Set(batches.map((b) => b.madeBy).filter((v): v is string => !!v))];
  const [ctx, itemsRes, usersRes] = await Promise.all([
    loadBatchContextForItems(itemIds),
    sb.from("items").select("id, name, name_es, default_par_unit").in("id", itemIds)
      .returns<Array<{ id: string; name: string; name_es: string | null; default_par_unit: string | null }>>(),
    makerIds.length
      ? sb.from("users").select("id, name").in("id", makerIds).returns<Array<{ id: string; name: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
  ]);
  if (itemsRes.error) throw new Error(`loadYieldVariance items: ${itemsRes.error.message}`);
  if (usersRes.error) throw new Error(`loadYieldVariance makers: ${usersRes.error.message}`);
  const recipeIds = [...new Set([...ctx.values()].map((c) => c.recipeId))];
  const recipeEs = new Map<string, string | null>();
  if (recipeIds.length) {
    const { data, error } = await sb.from("recipes").select("id, name_es").in("id", recipeIds).returns<Array<{ id: string; name_es: string | null }>>();
    if (error) throw new Error(`loadYieldVariance recipes: ${error.message}`);
    for (const r of data ?? []) recipeEs.set(r.id, r.name_es);
  }
  const itemById = new Map((itemsRes.data ?? []).map((i) => [i.id, i]));
  const nameById = new Map((usersRes.data ?? []).map((u) => [u.id, u.name]));
  const lineOf = (b: YieldBatch): YieldLineView => ({
    id: b.id, producedAt: b.producedAt, makerId: b.madeBy, makerName: b.madeBy ? (nameById.get(b.madeBy) ?? null) : null,
    batchesMade: b.batchesMade, cameOutTo: b.cameOutTo, yieldAtTime: b.yieldAtTime,
  });

  const items: YieldItemView[] = itemIds.map((itemId) => {
    const verdict = evaluateItem(itemId, batches, notes);
    const c = ctx.get(itemId) ?? null;
    const it = itemById.get(itemId);
    const makerNames: Record<string, string> = {};
    const makerLines: Record<string, YieldLineView[]> = {};
    for (const m of verdict.makers) {
      makerNames[m.makerId] = nameById.get(m.makerId) ?? "—";
      makerLines[m.makerId] = m.window.map(lineOf);
    }
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
    };
  });
  // Nudges first, then by name — the attention order the page renders.
  items.sort((a, b) => Number(b.verdict.recipe.nudge) - Number(a.verdict.recipe.nudge) || (a.recipeName ?? a.itemName).localeCompare(b.recipeName ?? b.itemName));
  const recipeNudges = items.filter((i) => i.verdict.recipe.nudge).length;
  const makerItems = items.reduce((n, i) => n + i.verdict.makers.filter((m) => m.nudge).length, 0);
  return { locationId, items, canAct, recipeNudges, makerItems };
}

/** One item's verdict, recomputed server-side from the live rows (the actions' ground truth). */
async function currentVerdict(sb: Sb, locationId: string, itemId: string, now: Date): Promise<ItemYieldVerdict> {
  const [batches, notes] = await Promise.all([loadBatches(sb, locationId, itemId, now), loadNotes(sb, locationId, itemId)]);
  return evaluateItem(itemId, batches, notes);
}

export interface RetrainInput {
  locationId: string;
  itemId: string;
  scope: YieldScope;
  /** Required for scope "maker". */
  makerId?: string | null;
  note?: unknown;
}

/**
 * Retrain: records a note naming the outlier makers (recipe scope) or the one maker (maker scope)
 * and so snoozes that scope's nudge for its next YIELD_STATS_WINDOW batches. GM 7+, bound to the
 * shop BEFORE any I/O. Changes no recipe.
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

  const sb = getServiceRoleClient();
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
    batches_in_window: scopeVerdict.summary.count,
    snooze_batches: YIELD_STATS_WINDOW,
    created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`recordYieldRetrain: ${error.message}`);
  if (!data) throw new Error("recordYieldRetrain returned no row");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "yield.retrain_noted",
    resourceTable: "recipe_yield_retrain_notes", resourceId: data.id,
    metadata: { location_id: input.locationId, recipe_id: ctx.recipeId, item_id: input.itemId, scope: input.scope, maker_id: makerId, outlier_user_ids: outliers, signed_drift: scopeVerdict.summary.signedDrift, batches_in_window: scopeVerdict.summary.count, snooze_batches: YIELD_STATS_WINDOW, has_note: note !== null },
    ipAddress: null, userAgent: null,
  });
  return { id: data.id };
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
    context: { locationId: input.locationId, source: "yield_nudge", observedSignedDrift: verdict.recipe.summary.signedDrift, batchesInWindow: verdict.recipe.summary.count },
  });
}
