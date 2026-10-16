import { catalogWriteError } from "@/lib/catalog/write-errors-shared";
/**
 * RECIPE SHOP VERSIONS — the gated writers and the reads (catalog Phase 3a, 0262). SERVER-ONLY,
 * service role. THE LIB IS THE AUTHORITY (spec §2): every writer decides role and shop HERE, before any
 * I/O (requireLocation) — the route is the outer layer, not the lock (writeParFromSuggestion's posture):
 *   · a GM (7) writes ONLY its own shops' versions; MoO (8)+ writes ANY active shop (2a's
 *     catalogShopAllowed — deliberately not lockLocationContext) and the global default;
 *   · a GM never edits the global recipe: its edit is its shop's version (global_requires_moo).
 * The version compare-and-set, the copy for restore / adopt / promote, and the per-shop cycle law live
 * in SQL (save_recipe_version, retire_recipe_version). Every write is audited with a closed AuditAction.
 *
 * READS ARE ORG-WIDE at level 6: recipes are the company's knowledge, and adopting another shop's
 * version (3b) means seeing it. Only WRITES are bound to a shop.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { AuditAction } from "@/lib/audit-actions";
import { assertInputLineIsValid, RecipeError } from "@/lib/recipes";
import { lineFromRow, type RecipeLineFields, type RecipeLineRow } from "@/lib/recipe-line-shared";
import { assertScopeToken, catalogShopAllowed, type VersionScope } from "@/lib/sku-versions-shared";
import {
  addedLinePositions, applyRecipeLineOp, diffRecipeLineSets, recipeLineTargetKey, recipeVersionReadAllowed, recipeVersionWriteGate,
  rpcRecipeLines, type LiveRecipeLine, type RecipeLineChange, type RecipeLineOp, type RecipeLineRefusal,
} from "@/lib/recipe-versions-shared";

export class RecipeVersionError extends Error {
  /** WHICH line and WHY, when a line is refused (lead decision (b)); the routes return it as `line`. */
  constructor(public status: number, public code: string, message?: string, public line?: RecipeLineRefusal) {
    super(message ?? code);
    this.name = "RecipeVersionError";
  }
}

/** THE BIND (a BIND_PRIMITIVES name): role + shop, decided before any I/O (the role rule refuses the social media manager). */
function requireLocation(actor: AuthContext, scope: VersionScope): void {
  const gate = recipeVersionWriteGate({
    role: actor.user.role, level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope),
  });
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
}

const RPC_STATUS: Record<string, number> = {
  version_changed: 409, not_live: 409, recipe_inactive: 409, dependencies_changed: 409, dependencies_busy: 409,
  global_cannot_retire: 400, invalid_lines: 400, invalid_payload: 400, invalid_source: 400, would_create_cycle: 400,
  product_line_invalid: 400, restore_source_out_of_scope: 404, truncate_refused: 400,
  recipe_not_found: 404, location_not_found: 404, not_found: 404,
};

/** The id-list chunk for `.in()` reads (the request-line budget; 2a's ID_CHUNK). */
const ID_CHUNK = 100;

/**
 * THE DEPENDENCY SNAPSHOT (0262 recipe_change_snapshot): an opaque JSON digest of everything a preview's
 * numbers are computed from. A preview takes it BEFORE computing; every writer hands it to SQL, which
 * re-takes it under the graph lock and refuses `dependencies_changed` on any difference (Astra 3a r1#3).
 */
export type RecipeChangeSnapshot = Record<string, unknown>;

/**
 * The SCOPED snapshot for one change (0262 recipe_change_snapshot; lead decision (a)): the recipe, the scope it is
 * written to (null = the global default) and the line set being written (the edit's result, or the source a
 * restore / adopt / promote copies; null for back to default). The writer re-derives the same closure from the
 * same three inputs under its locks.
 */
export async function loadRecipeChangeSnapshot(
  recipeId: string, scope: VersionScope, lines: readonly RecipeLineFields[] | null,
): Promise<RecipeChangeSnapshot> {
  const { data, error } = await getServiceRoleClient().rpc("recipe_change_snapshot", {
    p_recipe: recipeId, p_location: scope,
    p_lines: lines === null ? null : rpcRecipeLines(lines.map((fields) => ({ lineId: null, fields }))),
  });
  if (error) throw new Error(`loadRecipeChangeSnapshot: ${error.message}`);
  if (data == null || typeof data !== "object") throw new Error("loadRecipeChangeSnapshot: no snapshot");
  return data as RecipeChangeSnapshot;
}

/** Map recipe-version and catalog ownership refusals, plus missing-component FKs, to the route error class. Unknown failures remain 500s. */
export function recipeVersionErrorFromRpc(message: string, dbCode?: string): never {
  const code = /recipe_version:([a-z_]+)/.exec(message)?.[1];
  if (code && RPC_STATUS[code]) throw new RecipeVersionError(RPC_STATUS[code]!, code);
  throw catalogWriteError({ message, code: dbCode }, RecipeVersionError, "recipe-version rpc failed");
}

/** A line's display name for a refusal: the SKU's, item's or product's name; the target key if it has none. */
async function lineName(f: RecipeLineFields): Promise<string> {
  const [table, id] = f.componentSkuId ? ["vendor_items", f.componentSkuId] as const
    : f.componentItemId ? ["items", f.componentItemId] as const
    : ["products", f.componentProductId] as const;
  if (!id) return recipeLineTargetKey(f);
  const { data } = await getServiceRoleClient().from(table).select("name").eq("id", id).maybeSingle<{ name: string }>();
  return data?.name ?? recipeLineTargetKey(f);
}

/** An RPC refusal that names a line (`recipe_version:<code>:<position>`, 0262) keeps WHICH line it was. */
async function recipeVersionRpcRefusal(message: string, lines: readonly RecipeLineFields[], dbCode?: string): Promise<never> {
  const m = /recipe_version:([a-z_]+):(\d+)/.exec(message);
  const code = m?.[1];
  const line = m ? lines[Number(m[2]) - 1] : undefined;
  if (code && RPC_STATUS[code] && line) {
    throw new RecipeVersionError(RPC_STATUS[code]!, code, undefined, { position: Number(m![2]), name: await lineName(line), reason: code });
  }
  return recipeVersionErrorFromRpc(message, dbCode);
}

// ── The set a person sees ─────────────────────────────────────────────────────

export interface RecipeLiveSet {
  recipeId: string;
  recipeName: string;
  recipeActive: boolean;
  scope: VersionScope;
  /** This scope's own live version: the shop's (null = it rides the default) or, for global, the head. */
  scopeVersionId: string | null;
  globalVersionId: string | null;
  ridesDefault: boolean;
  lines: LiveRecipeLine[];
}

type LineRowWithId = RecipeLineRow & { id: string; display_order: number | null };
const LINE_COLUMNS = "id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order";

/** The lines `scope` resolves NOW for one recipe, with the version ids an edit must name. No actor: callers gate. */
export async function loadRecipeLiveSet(recipeId: string, scope: VersionScope): Promise<RecipeLiveSet> {
  const sb = getServiceRoleClient();
  const versionsBase = sb.from("recipe_versions").select("id, location_id").eq("recipe_id", recipeId).eq("active", true);
  const [recipeRes, versionsRes] = await Promise.all([
    sb.from("recipes").select("id, name, active").eq("id", recipeId).maybeSingle<{ id: string; name: string; active: boolean | null }>(),
    (scope === null ? versionsBase.is("location_id", null) : versionsBase.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`))
      .returns<Array<{ id: string; location_id: string | null }>>(),
  ]);
  if (recipeRes.error) throw new Error(`loadRecipeLiveSet recipe: ${recipeRes.error.message}`);
  if (versionsRes.error) throw new Error(`loadRecipeLiveSet versions: ${versionsRes.error.message}`);
  if (!recipeRes.data) throw new RecipeVersionError(404, "recipe_not_found");
  const versions = versionsRes.data ?? [];
  const globalVersionId = versions.find((v) => v.location_id === null)?.id ?? null;
  const shopVersionId = scope === null ? null : (versions.find((v) => v.location_id === scope)?.id ?? null);
  // PAGED like every version line-set read (Astra 3a r1#6) — a set is capped at 200 lines in SQL today, but a
  // truncated read here would silently drop lines from the set an edit is computed against.
  const rows: LineRowWithId[] = shopVersionId
    ? await selectAllRows<LineRowWithId>(async (from, to) => {
        const { data, error } = await sb.from("recipe_version_lines").select(LINE_COLUMNS).eq("version_id", shopVersionId)
          .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<LineRowWithId[]>();
        if (error) throw new Error(`loadRecipeLiveSet version lines: ${error.message}`);
        return { data };
      })
    : await selectAllRows<LineRowWithId>(async (from, to) => {
        const { data, error } = await sb.from("recipe_inputs").select(LINE_COLUMNS).eq("recipe_id", recipeId)
          .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<LineRowWithId[]>();
        if (error) throw new Error(`loadRecipeLiveSet inputs: ${error.message}`);
        return { data };
      });
  return {
    recipeId, recipeName: recipeRes.data.name, recipeActive: recipeRes.data.active !== false, scope,
    scopeVersionId: scope === null ? globalVersionId : shopVersionId,
    globalVersionId, ridesDefault: scope !== null && shopVersionId === null,
    lines: rows.map((r) => ({ lineId: r.id, fields: lineFromRow(r) })),
  };
}

// ── The one writer ────────────────────────────────────────────────────────────

export interface WriteRecipeVersionInput {
  recipeId: string;
  scope: VersionScope;
  /** This scope's live version the person saw (the shop's, null = riding the default; or the global head). */
  expectedVersionId: string | null;
  /** The global head the person saw when forking the default (shop scope riding the default). */
  basedOnVersionId: string | null;
  /** The full new set; null = the source version's lines (restore / adopt / promote copy in SQL). */
  lines: LiveRecipeLine[] | null;
  note?: string | null;
  restoredFromVersionId?: string | null;
  adoptedFromVersionId?: string | null;
  promotedFromVersionId?: string | null;
  /** What the person did, for the audit row: "add" | "update" | "remove" | "restore" | "adopt" | "promote". */
  op: string;
  changes?: RecipeLineChange[] | null;
  /** The dependency snapshot the person's numbers were computed from (a 3b preview's, or the request's own). */
  snapshot: RecipeChangeSnapshot;
}

export interface WriteRecipeVersionResult {
  versionId: string;
  retiredVersionId: string | null;
  changedShops: string[];
  /** PROMOTE: the source shop, now back on the default (lead decision 5); else null. */
  returnedShop: string | null;
}

/** The lines of one version, paged — what a restore / adopt / promote is about to copy. */
async function loadVersionLineFields(versionId: string): Promise<RecipeLineFields[]> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<LineRowWithId>(async (from, to) => {
    const { data, error } = await sb.from("recipe_version_lines").select(LINE_COLUMNS).eq("version_id", versionId)
      .order("display_order", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<LineRowWithId[]>();
    if (error) throw new Error(`loadVersionLineFields: ${error.message}`);
    return { data };
  });
  return rows.map((r) => lineFromRow(r));
}

/**
 * THE ONE RECIPE-VERSION WRITE: bind, then save_recipe_version (graph lock, recipe row lock, version
 * compare-and-set, per-shop cycle law), then the audit row. Every 3a/3b recipe write goes through here.
 */
export async function writeRecipeVersion(actor: AuthContext, input: WriteRecipeVersionInput): Promise<WriteRecipeVersionResult> {
  requireLocation(actor, input.scope);
  // THE SAME LINE RULES AS AN ADD / UPDATE (Astra 3a r1#5) — for every line this save ADDS or CREATES (lead
  // decision (b)): the sent set, or the source a restore / adopt / promote copies, against the set this scope
  // resolves NOW. A line already there, unchanged, may stay even if it no longer passes (it is flagged on the page),
  // so a recipe with two broken lines is repaired one line at a time. The refusal names WHICH line and WHY.
  // 0262 re-checks the product rule in SQL under the locks, with the same "carried" rule and the line's position.
  const sourceId = input.restoredFromVersionId ?? input.adoptedFromVersionId ?? input.promotedFromVersionId ?? null;
  const next = input.lines ? input.lines.map((l) => l.fields) : sourceId ? await loadVersionLineFields(sourceId) : [];
  const current = (await loadRecipeLiveSet(input.recipeId, input.scope)).lines.map((l) => l.fields);
  // A COPIED set carries nothing (Astra 3a r3#3; accepted ruling): every line a restore / adopt / promote copies is
  // an addition and must pass, even one identical to a broken line already here. Only an EDIT carries lines,
  // counted with multiplicity (addedLinePositions; 0262 counts the same way).
  const positions = input.lines ? addedLinePositions(current, next) : next.map((_, i) => i + 1);
  for (const position of positions) await validateLine(next[position - 1]!, position);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("save_recipe_version", {
    p_recipe: input.recipeId, p_location: input.scope, p_lines: input.lines ? rpcRecipeLines(input.lines) : null,
    p_expected: input.expectedVersionId, p_based_on: input.basedOnVersionId, p_note: input.note ?? null, p_actor: actor.user.id,
    p_restored_from: input.restoredFromVersionId ?? null, p_adopted_from: input.adoptedFromVersionId ?? null,
    p_promoted_from: input.promotedFromVersionId ?? null, p_snapshot: input.snapshot,
  });
  if (error) await recipeVersionRpcRefusal(error.message, next, error.code);
  const r = data as {
    version_id: string; retired_version_id: string | null; changed_shops: string[] | null;
    returned_shop?: string | null; returned_version_id?: string | null;
  };
  const action: AuditAction = input.promotedFromVersionId ? "recipe_version.promote"
    : input.adoptedFromVersionId ? "recipe_version.adopt" : "recipe_version.save";
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action, resourceTable: "recipe_versions", resourceId: r.version_id,
    metadata: {
      recipe_id: input.recipeId, location_id: input.scope, scope: input.scope === null ? "global" : "shop", op: input.op,
      retired_version_id: r.retired_version_id, based_on_version_id: input.basedOnVersionId,
      restored_from_version_id: input.restoredFromVersionId ?? null, adopted_from_version_id: input.adoptedFromVersionId ?? null,
      promoted_from_version_id: input.promotedFromVersionId ?? null, changes: input.changes ?? null,
      changed_shops: r.changed_shops ?? [], note: input.note ?? null,
      // PROMOTE: the source shop's version was retired in the same transaction (lead decision 5).
      returned_shop: r.returned_shop ?? null, returned_version_id: r.returned_version_id ?? null,
    },
    ipAddress: null, userAgent: null,
  });
  return {
    versionId: r.version_id, retiredVersionId: r.retired_version_id, changedShops: r.changed_shops ?? [],
    returnedShop: r.returned_shop ?? null,
  };
}

/** Phase 1's validator for ONE line; a refusal keeps its code and names the line (1-based position, name, reason). */
async function validateLine(line: RecipeLineFields, position: number): Promise<void> {
  try {
    await assertInputLineIsValid(getServiceRoleClient(), line);
  } catch (e) {
    if (e instanceof RecipeError) {
      throw new RecipeVersionError(e.status, e.code, e.message, { position, name: await lineName(line), reason: e.code });
    }
    throw e;
  }
}

export interface SaveRecipeLinesInput {
  recipeId: string;
  scope: VersionScope;
  expectedVersionId: string | null;
  basedOnVersionId: string | null;
  op: RecipeLineOp;
  note?: string | null;
  /** A 3b preview's dependency snapshot; absent = taken now, before this request's own reads. */
  snapshot?: RecipeChangeSnapshot;
}

/** ONE line edit (add / update / remove) to the set this scope resolves; a no-op writes nothing. */
export async function saveRecipeLines(
  actor: AuthContext,
  input: SaveRecipeLinesInput,
): Promise<{ versionId: string | null; retiredVersionId: string | null; changed: boolean }> {
  requireLocation(actor, input.scope);
  const live = await loadRecipeLiveSet(input.recipeId, input.scope);
  if (!live.recipeActive) throw new RecipeVersionError(409, "recipe_inactive");
  if (live.scopeVersionId !== input.expectedVersionId) throw new RecipeVersionError(409, "version_changed");
  if (live.ridesDefault && live.globalVersionId !== input.basedOnVersionId) throw new RecipeVersionError(409, "version_changed");
  const applied = applyRecipeLineOp(live.lines, input.op);
  if (!applied.ok) throw new RecipeVersionError(applied.status, applied.code);
  if (!applied.changed) return { versionId: live.scopeVersionId, retiredVersionId: null, changed: false };
  // A 3b preview hands its snapshot in; a direct call takes it now, over the set it is about to write.
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.scope, applied.lines.map((l) => l.fields));
  // writeRecipeVersion validates every line the edit adds or changes (lead decision (b)).
  const r = await writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: input.scope, expectedVersionId: input.expectedVersionId,
    basedOnVersionId: live.ridesDefault ? live.globalVersionId : null, lines: applied.lines, note: input.note ?? null,
    op: input.op.kind, changes: diffRecipeLineSets(live.lines.map((l) => l.fields), applied.lines.map((l) => l.fields)),
    snapshot,
  });
  return { versionId: r.versionId, retiredVersionId: r.retiredVersionId, changed: true };
}

/**
 * Restore = a NEW version holding an old version's lines (copied in SQL), never a revive. The source
 * must be this recipe's global history or this shop's own history (another shop's version is ADOPT).
 */
export async function restoreRecipeVersion(
  actor: AuthContext,
  input: {
    recipeId: string; scope: VersionScope; fromVersionId: string; expectedVersionId: string | null; basedOnVersionId: string | null;
    snapshot?: RecipeChangeSnapshot;
  },
): Promise<WriteRecipeVersionResult> {
  requireLocation(actor, input.scope);
  const { data: from, error } = await getServiceRoleClient().from("recipe_versions").select("id, recipe_id, location_id")
    .eq("id", input.fromVersionId).maybeSingle<{ id: string; recipe_id: string; location_id: string | null }>();
  if (error) throw new Error(`restoreRecipeVersion source: ${error.message}`);
  if (!from || from.recipe_id !== input.recipeId || (from.location_id !== null && from.location_id !== input.scope)) {
    throw new RecipeVersionError(404, "not_found");
  }
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.scope, await loadVersionLineFields(input.fromVersionId));
  return writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: input.scope, expectedVersionId: input.expectedVersionId,
    basedOnVersionId: input.basedOnVersionId, lines: null, restoredFromVersionId: input.fromVersionId, op: "restore",
    snapshot,
  });
}

/** A shop goes BACK TO DEFAULT: its live version is retired (valid_to stamped), never deleted. */
export async function retireShopRecipeVersion(
  actor: AuthContext,
  input: { recipeId: string; versionId: string; locationId: string; snapshot?: RecipeChangeSnapshot },
): Promise<void> {
  requireLocation(actor, input.locationId);
  // Back to default writes the DEFAULT's lines into this shop's graph: they are this change's line set (0262 does the same).
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.locationId,
    (await loadRecipeLiveSet(input.recipeId, null)).lines.map((l) => l.fields));
  const sb = getServiceRoleClient();
  const { data: v, error: vErr } = await sb.from("recipe_versions").select("id, recipe_id, location_id")
    .eq("id", input.versionId).maybeSingle<{ id: string; recipe_id: string; location_id: string | null }>();
  if (vErr) throw new Error(`retireShopRecipeVersion read: ${vErr.message}`);
  if (!v || v.recipe_id !== input.recipeId || v.location_id !== input.locationId) throw new RecipeVersionError(404, "not_found");
  const { error } = await sb.rpc("retire_recipe_version", {
    p_version: input.versionId, p_location: input.locationId, p_actor: actor.user.id, p_snapshot: snapshot,
  });
  if (error) recipeVersionErrorFromRpc(error.message, error.code);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "recipe_version.retire", resourceTable: "recipe_versions", resourceId: input.versionId,
    metadata: { recipe_id: input.recipeId, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

// ── History ───────────────────────────────────────────────────────────────────

export interface RecipeVersionHistoryRow {
  id: string;
  locationId: string | null;
  active: boolean;
  validFrom: string;
  validTo: string | null;
  basedOnVersionId: string | null;
  adoptedFromVersionId: string | null;
  promotedFromVersionId: string | null;
  /** The version whose adoption link this row ENDED (0262 records it; History reads it, never infers). */
  adoptionEndedFromVersionId: string | null;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  lines: RecipeLineFields[];
}

/**
 * Every version of a recipe visible to a scope (global + that shop; or every shop when `allShops`),
 * newest first, with its lines and who made it. Read floor 6, org-wide.
 */
export async function loadRecipeVersionHistory(
  actor: AuthContext,
  recipeId: string,
  scope: VersionScope,
  opts: { allShops?: boolean } = {},
): Promise<RecipeVersionHistoryRow[]> {
  // The read floor AND the role rule (2a: the social media manager is refused the version history read too).
  if (!recipeVersionReadAllowed(actor.user.role, actor.level)) throw new RecipeVersionError(403, "forbidden");
  const sb = getServiceRoleClient();
  type VersionRow = { id: string; location_id: string | null; active: boolean; valid_from: string; valid_to: string | null; based_on_version_id: string | null; adopted_from_version_id: string | null; promoted_from_version_id: string | null; adoption_ended_from_version_id: string | null; note: string | null; created_by: string | null };
  // EVERY READ PAGED AND ID-CHUNKED (Astra 3a r1#6): 51 versions of a 20-line recipe already pass the
  // PostgREST 1000-row cap, and a truncated line read would show an incomplete version and a false diff.
  const versions = await selectAllRows<VersionRow>(async (from, to) => {
    const base = sb.from("recipe_versions")
      .select("id, location_id, active, valid_from, valid_to, based_on_version_id, adopted_from_version_id, promoted_from_version_id, adoption_ended_from_version_id, note, created_by")
      .eq("recipe_id", recipeId);
    const scoped = opts.allShops ? base : scope === null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
    const { data, error } = await scoped.order("valid_from", { ascending: false }).order("id", { ascending: false })
      .range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`loadRecipeVersionHistory: ${error.message}`);
    return { data };
  });
  const ids = versions.map((v) => v.id);
  const userIds = [...new Set(versions.map((v) => v.created_by).filter((u): u is string => u !== null))];
  const lines: Array<LineRowWithId & { version_id: string }> = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    lines.push(...await selectAllRows<LineRowWithId & { version_id: string }>(async (from, to) => {
      const { data, error } = await sb.from("recipe_version_lines").select(`version_id, ${LINE_COLUMNS}`).in("version_id", chunk)
        .order("version_id", { ascending: true }).order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<Array<LineRowWithId & { version_id: string }>>();
      if (error) throw new Error(`loadRecipeVersionHistory lines: ${error.message}`);
      return { data };
    }));
  }
  const users: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const chunk = userIds.slice(i, i + ID_CHUNK);
    const { data, error } = await sb.from("users").select("id, name").in("id", chunk).returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`loadRecipeVersionHistory users: ${error.message}`);
    users.push(...(data ?? []));
  }
  const linesBy = new Map<string, RecipeLineFields[]>();
  for (const l of lines) linesBy.set(l.version_id, [...(linesBy.get(l.version_id) ?? []), lineFromRow(l)]);
  const nameBy = new Map(users.map((u) => [u.id, u.name]));
  return versions.map((v) => ({
    id: v.id, locationId: v.location_id, active: v.active, validFrom: v.valid_from, validTo: v.valid_to,
    basedOnVersionId: v.based_on_version_id, adoptedFromVersionId: v.adopted_from_version_id, promotedFromVersionId: v.promoted_from_version_id,
    adoptionEndedFromVersionId: v.adoption_ended_from_version_id ?? null,
    note: v.note, createdBy: v.created_by, createdByName: v.created_by ? (nameBy.get(v.created_by) ?? null) : null,
    lines: linesBy.get(v.id) ?? [],
  }));
}

// ── Adopt, promote, the notice answer (catalog Phase 3b) ──────────────────────

/**
 * The version a copy is taken from: ANOTHER shop's (`notShop` for an adopt) LIVE version of THIS recipe. A friendly,
 * named refusal before the write; 0262 re-checks the same rule under its locks (`invalid_source`).
 */
async function requireShopSourceVersion(recipeId: string, sourceVersionId: string, notShop: string | null): Promise<void> {
  const { data, error } = await getServiceRoleClient().from("recipe_versions").select("id, recipe_id, location_id, active")
    .eq("id", sourceVersionId).maybeSingle<{ id: string; recipe_id: string; location_id: string | null; active: boolean | null }>();
  if (error) throw new Error(`recipe version source read: ${error.message}`);
  if (!data) throw new RecipeVersionError(404, "not_found");
  if (data.recipe_id !== recipeId || data.location_id === null || data.location_id === notShop || data.active === false) {
    throw new RecipeVersionError(400, "invalid_source");
  }
}

/**
 * ADOPT: this shop takes another shop's LIVE version as-is — a new version of THIS shop based on it
 * (adopted_from recorded), its lines copied IN SQL (every copied line validated like an addition). A copy,
 * never a live link: when the source changes later, this shop's GM is asked (computeRecipeNotices), and
 * nothing changes without their yes. PROVENANCE FOLLOWS THE CONTENT (lead decision): editing the copy keeps
 * the link (the notice adds "You've changed your copy since adopting it."); restoring pre-adoption history or
 * going back to the default ends it (0262 records adoption_ended_from_version_id).
 */
export async function adoptRecipeVersion(
  actor: AuthContext,
  input: {
    recipeId: string; locationId: string; sourceVersionId: string;
    /** This shop's live version the person saw (null = it rode the default). */
    expectedVersionId: string | null;
    /** Kept for the change model's symmetry; 0262 makes an adopt's based_on the source itself. */
    basedOnVersionId?: string | null;
    /** The preview's dependency snapshot; absent = taken now (a direct call). */
    snapshot?: RecipeChangeSnapshot;
  },
): Promise<WriteRecipeVersionResult> {
  requireLocation(actor, input.locationId);
  await requireShopSourceVersion(input.recipeId, input.sourceVersionId, input.locationId);
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, input.locationId, await loadVersionLineFields(input.sourceVersionId));
  return writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: input.locationId, expectedVersionId: input.expectedVersionId,
    basedOnVersionId: input.basedOnVersionId ?? null, lines: null, adoptedFromVersionId: input.sourceVersionId, op: "adopt", snapshot,
  });
}

/**
 * PROMOTE (MoO+): a shop's live version becomes the new GLOBAL default (promoted_from recorded), its
 * lines copied IN SQL into recipe_inputs and journaled — and, in the SAME transaction, the source shop
 * RETURNS TO THE DEFAULT (lead decision 5): its version is retired (history kept), so later global edits
 * reach it again; its food does not change today (the new default IS its lines). Every other shop riding
 * the default changes; every other shop with its own version is untouched.
 */
export async function promoteRecipeVersion(
  actor: AuthContext,
  input: { recipeId: string; sourceVersionId: string; expectedGlobalVersionId: string | null; snapshot?: RecipeChangeSnapshot },
): Promise<WriteRecipeVersionResult> {
  // The GLOBAL gate (scope null): MoO+ passes; a GM is global_requires_moo; the social media manager forbidden.
  requireLocation(actor, null);
  await requireShopSourceVersion(input.recipeId, input.sourceVersionId, null);
  const snapshot = input.snapshot ?? await loadRecipeChangeSnapshot(input.recipeId, null, await loadVersionLineFields(input.sourceVersionId));
  return writeRecipeVersion(actor, {
    recipeId: input.recipeId, scope: null, expectedVersionId: input.expectedGlobalVersionId,
    basedOnVersionId: null, lines: null, promotedFromVersionId: input.sourceVersionId, op: "promote", snapshot,
  });
}

export const RECIPE_NOTICE_DISMISS_KINDS = ["source_changed", "source_retired", "new_default"] as const;
export type RecipeNoticeDismissKind = (typeof RECIPE_NOTICE_DISMISS_KINDS)[number];

/**
 * A GM's "Keep mine" / "Got it" on a read-time notice: one row for the version SEEN in the STATE seen
 * (`source_changed` live, `source_retired` retired, `new_default`), idempotent on the 0262 unique index,
 * so a later change — a new version id, or the same version's retirement — raises the notice again.
 * Changes no food: the session, the GM floor, the role rule and the shop bind (requireLocation), no password.
 */
export async function dismissRecipeNotice(
  actor: AuthContext,
  input: { locationId: string; recipeId: string; kind: RecipeNoticeDismissKind; seenVersionId: string },
): Promise<void> {
  requireLocation(actor, input.locationId);
  if (!(RECIPE_NOTICE_DISMISS_KINDS as readonly string[]).includes(input.kind)) throw new RecipeVersionError(400, "invalid_payload");
  const sb = getServiceRoleClient();
  const { data: seen, error: sErr } = await sb.from("recipe_versions").select("id, recipe_id")
    .eq("id", input.seenVersionId).maybeSingle<{ id: string; recipe_id: string }>();
  if (sErr) throw new Error(`dismissRecipeNotice read: ${sErr.message}`);
  if (!seen || seen.recipe_id !== input.recipeId) throw new RecipeVersionError(404, "not_found");
  const { error } = await sb.from("recipe_notice_dismissals").upsert(
    [{ location_id: input.locationId, recipe_id: input.recipeId, kind: input.kind, seen_version_id: input.seenVersionId, created_by: actor.user.id }],
    { onConflict: "location_id,recipe_id,kind,seen_version_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`dismissRecipeNotice: ${error.message}`);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "recipe_version.notice_dismiss", resourceTable: "recipe_notice_dismissals", resourceId: input.seenVersionId,
    metadata: { location_id: input.locationId, recipe_id: input.recipeId, kind: input.kind }, ipAddress: null, userAgent: null,
  });
}
