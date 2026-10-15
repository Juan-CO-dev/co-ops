/**
 * Shop versions of a RECIPE's lines — THE ONE RESOLVER, PURE (catalog Phase 3a, migration 0262;
 * spec 2026-10-15 §3). Client-safe: no I/O, no server imports.
 *
 * THE MODEL. `recipe_inputs` stays the GLOBAL DEFAULT's live lines, so every existing reader and
 * Phase 1's line RPCs keep their meaning. Every version — the global default's history AND every
 * shop's version — is an effective-dated `recipe_versions` row owning a full line set in
 * `recipe_version_lines`. The global LIVE version ("the head") is the journal of recipe_inputs,
 * written in the same transaction as every change (0262 recipe_global_journal).
 *
 * THE RULE, ONE PLACE. A graph for scope S (null = global) at instant T (null = now) answers each
 * recipe's lines with S's version in force at T if S has one, else the global version in force at T —
 * and when that is the LIVE head, `recipe_inputs` itself (same rows, same order: byte-identical to
 * today). lib/prep-consumption.ts loadRecipeLineOverlay reads the rows and asks HERE; no consumer
 * ever picks a recipe version itself (AGENTS.md "RESOLUTION HAPPENS ONCE").
 *
 * WHAT A VERSION COVERS: the LINES (what goes in, how much). Outputs, yields, batch mode, shelf life,
 * name and directions stay global (lib/recipes.ts) in Phase 3.
 */
import {
  diffRecipeLine, normalizeRecipeLine, parseRecipeLinePatch, parseRecipeLineSnapshot, recipeLineKind,
  type RecipeLineFields,
} from "@/lib/recipe-line-shared";
import type { RoleCode } from "@/lib/roles";
import { GLOBAL_VERSION_WRITE_MIN, catalogWriteRoleAllowed, type VersionScope } from "@/lib/sku-versions-shared";

/** The version history / snapshot read: level 6 OPERATIONAL managers and up (2a's role rule). */
export const RECIPE_VERSION_READ_MIN = 6;
/** A GM (7) writes ITS OWN shops' recipe versions (spec §2: recipes are shop-level GM work). */
export const RECIPE_SHOP_WRITE_MIN = 7;
/** MoO (8)+ writes the global default and ANY active shop's version. */
export const RECIPE_GLOBAL_WRITE_MIN = GLOBAL_VERSION_WRITE_MIN;
/** The "since forever" start of every recipe's first global version (0262). */
export const RECIPE_BASELINE_FROM = "2000-01-01T00:00:00.000Z";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface RecipeVersionRow {
  id: string;
  recipe_id: string;
  location_id: string | null;
  valid_from: string;
  valid_to: string | null;
  active?: boolean | null;
}

export interface RecipeVersionLineRow {
  id: string;
  version_id: string;
  recipe_id: string;
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number | string;
  unit: string | null;
  each_container_label: string | null;
  portioned: boolean | null;
  display_order: number | null;
}

function isLive(v: RecipeVersionRow): boolean {
  return v.valid_to == null && v.active !== false;
}

/** The LIVE global head — its lines are recipe_inputs, so the graph never needs its journal copy. */
export function isLiveGlobalHead(v: RecipeVersionRow): boolean {
  return v.location_id === null && isLive(v);
}

// ── Live and as-of picks ──────────────────────────────────────────────────────

/** recipe → this shop's LIVE version (empty for the global scope: recipe_inputs is the live global). */
export function pickLiveShopRecipeVersions(versions: readonly RecipeVersionRow[], scope: VersionScope): Map<string, RecipeVersionRow> {
  const out = new Map<string, RecipeVersionRow>();
  if (scope === null) return out;
  for (const v of versions) if (v.location_id === scope && isLive(v)) out.set(v.recipe_id, v);
  return out;
}

function inForceAt(v: RecipeVersionRow, at: number): boolean {
  return Date.parse(v.valid_from) <= at && (v.valid_to == null || at < Date.parse(v.valid_to));
}

/**
 * recipe → the version IN FORCE at `asOf`: this shop's (if one was in force then) beats the global
 * one. A retired shop version answers only inside its own dates — "back to default", seen from the past.
 */
export function pickRecipeVersionsAsOf(versions: readonly RecipeVersionRow[], scope: VersionScope, asOf: string): Map<string, RecipeVersionRow> {
  const at = Date.parse(asOf);
  const shop = new Map<string, RecipeVersionRow>();
  const global = new Map<string, RecipeVersionRow>();
  for (const v of versions) {
    if (!inForceAt(v, at)) continue;
    const bucket = v.location_id === null ? global : scope !== null && v.location_id === scope ? shop : null;
    if (!bucket) continue;
    const prior = bucket.get(v.recipe_id);
    if (!prior || Date.parse(v.valid_from) > Date.parse(prior.valid_from)) bucket.set(v.recipe_id, v);
  }
  const out = new Map<string, RecipeVersionRow>(global);
  for (const [r, v] of shop) out.set(r, v);
  return out;
}

/** The versions whose journal lines must be read: every pick except the live global head. */
export function versionIdsNeedingLines(picked: ReadonlyMap<string, RecipeVersionRow>): string[] {
  return [...new Set([...picked.values()].filter((v) => !isLiveGlobalHead(v)).map((v) => v.id))];
}

/**
 * recipe → the lines that REPLACE its recipe_inputs in this graph, in line order (display_order, id).
 * The live global head is never a replacement. A picked version with no lines replaces with [] — the
 * honest answer for a version that held none.
 */
export function recipeLineReplacements(
  picked: ReadonlyMap<string, RecipeVersionRow>,
  lines: readonly RecipeVersionLineRow[],
): Map<string, RecipeVersionLineRow[]> {
  const byVersion = new Map<string, RecipeVersionLineRow[]>();
  for (const l of lines) {
    const list = byVersion.get(l.version_id) ?? [];
    list.push(l);
    byVersion.set(l.version_id, list);
  }
  const out = new Map<string, RecipeVersionLineRow[]>();
  for (const [recipe, v] of picked) {
    if (isLiveGlobalHead(v)) continue;
    const rows = [...(byVersion.get(v.id) ?? [])].sort((a, b) =>
      (a.display_order ?? 0) - (b.display_order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.set(recipe, rows);
  }
  return out;
}

// ── Line ops (the edit a person makes) ────────────────────────────────────────

/** One line of the set a person sees: `lineId` = its id in that set (null = a new line). */
export interface LiveRecipeLine {
  lineId: string | null;
  fields: RecipeLineFields;
}

export type RecipeLineOp =
  | { kind: "add"; line: RecipeLineFields }
  | { kind: "update"; lineId: string; line: RecipeLineFields; expected: RecipeLineFields }
  | { kind: "remove"; lineId: string; expected: RecipeLineFields };

export type LineOpResult =
  | { ok: true; lines: LiveRecipeLine[]; changed: boolean }
  | { ok: false; status: 400 | 404 | 409; code: "edge_not_found" | "line_changed" | "empty_recipe" };

/**
 * Apply ONE edit to the set the person saw. The line must still be what they saw (normalized), else
 * 409 line_changed — the version compare-and-set in SQL is the real guard; this is the friendly one.
 */
export function applyRecipeLineOp(lines: readonly LiveRecipeLine[], op: RecipeLineOp): LineOpResult {
  if (op.kind === "add") {
    return { ok: true, lines: [...lines, { lineId: null, fields: normalizeRecipeLine(op.line) }], changed: true };
  }
  const idx = lines.findIndex((l) => l.lineId === op.lineId);
  if (idx < 0) return { ok: false, status: 404, code: "edge_not_found" };
  const cur = lines[idx]!;
  if (diffRecipeLine(normalizeRecipeLine(op.expected), normalizeRecipeLine(cur.fields)).length > 0) {
    return { ok: false, status: 409, code: "line_changed" };
  }
  if (op.kind === "remove") {
    if (lines.length === 1) return { ok: false, status: 400, code: "empty_recipe" };
    return { ok: true, lines: lines.filter((_, i) => i !== idx), changed: true };
  }
  const next = normalizeRecipeLine(op.line);
  if (diffRecipeLine(normalizeRecipeLine(cur.fields), next).length === 0) return { ok: true, lines: [...lines], changed: false };
  return { ok: true, lines: lines.map((l, i) => (i === idx ? { lineId: l.lineId, fields: next } : l)), changed: true };
}

/** The save_recipe_version payload (0262): one object per line, the kept line's id as keep_id. */
export function rpcRecipeLines(lines: readonly LiveRecipeLine[]): Array<Record<string, unknown>> {
  return lines.map((l) => ({
    keep_id: l.lineId,
    component_sku_id: l.fields.componentSkuId,
    component_item_id: l.fields.componentItemId,
    component_product_id: l.fields.componentProductId,
    quantity: l.fields.quantity,
    unit: l.fields.unit,
    each_container_label: l.fields.eachContainerLabel,
    portioned: l.fields.portioned,
  }));
}

export type RecipeLineOpParse =
  | { ok: true; op: RecipeLineOp }
  | { ok: false; code: "invalid_payload" | "invalid_component" | "invalid_quantity" | "product_line_needs_measure_unit" };

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
function idsAreUuids(l: RecipeLineFields): boolean {
  return [l.componentSkuId, l.componentItemId, l.componentProductId].every((id) => id === null || isUuid(id));
}

/** The route's one parser: the kind, uuid ids, Phase 1's line rules (parseRecipeLinePatch / snapshot). */
export function parseRecipeLineOp(raw: unknown): RecipeLineOpParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  if (b.kind === "add") {
    const line = parseRecipeLinePatch(b.line);
    if (!line.ok) return line;
    return idsAreUuids(line.line) ? { ok: true, op: { kind: "add", line: line.line } } : { ok: false, code: "invalid_payload" };
  }
  if (b.kind !== "update" && b.kind !== "remove") return { ok: false, code: "invalid_payload" };
  if (!isUuid(b.lineId)) return { ok: false, code: "invalid_payload" };
  const expected = parseRecipeLineSnapshot(b.expected);
  if (!expected || !idsAreUuids(expected)) return { ok: false, code: "invalid_payload" };
  if (b.kind === "remove") return { ok: true, op: { kind: "remove", lineId: b.lineId, expected } };
  const line = parseRecipeLinePatch(b.line);
  if (!line.ok) return line;
  if (!idsAreUuids(line.line)) return { ok: false, code: "invalid_payload" };
  return { ok: true, op: { kind: "update", lineId: b.lineId, line: line.line, expected } };
}

// ── What changed (for the preview, the history and the Shop changes list) ─────

export function recipeLineTargetKey(l: Pick<RecipeLineFields, "componentSkuId" | "componentItemId" | "componentProductId">): string {
  const kind = recipeLineKind(l);
  return `${kind}:${kind === "sku" ? l.componentSkuId : kind === "item" ? l.componentItemId : l.componentProductId}`;
}

export interface RecipeLineChange {
  kind: "added" | "removed" | "changed";
  key: string;
  before: RecipeLineFields | null;
  after: RecipeLineFields | null;
}

/** Matched by ingredient, in order of appearance (a recipe may name an ingredient twice). */
export function diffRecipeLineSets(before: readonly RecipeLineFields[], after: readonly RecipeLineFields[]): RecipeLineChange[] {
  const pool = new Map<string, RecipeLineFields[]>();
  for (const b of before) {
    const key = recipeLineTargetKey(b);
    pool.set(key, [...(pool.get(key) ?? []), b]);
  }
  const out: RecipeLineChange[] = [];
  for (const a of after) {
    const key = recipeLineTargetKey(a);
    const b = pool.get(key)?.shift();
    if (!b) out.push({ kind: "added", key, before: null, after: a });
    else if (diffRecipeLine(normalizeRecipeLine(b), normalizeRecipeLine(a)).length > 0) out.push({ kind: "changed", key, before: b, after: a });
  }
  for (const [key, rest] of pool) for (const b of rest) out.push({ kind: "removed", key, before: b, after: null });
  return out;
}

// ── Named refusals (0262 'recipe_version:<code>' + the line ops / gate) ───────

/**
 * EVERY named refusal a recipe-version write can return, each with its OWN en + es message at
 * `catalog.error.<code>` (pinned by tests/catalog-item-i18n.test.ts). `product_line_invalid` carries the
 * 1-based line position in SQL ('recipe_version:product_line_invalid:<n>'): the message takes `{line}`.
 */
export const RECIPE_VERSION_ERROR_CODES = [
  "invalid_payload", "recipe_not_found", "recipe_inactive", "location_not_found", "invalid_source",
  "restore_source_out_of_scope", "invalid_lines", "dependencies_changed", "dependencies_busy", "version_changed",
  "product_line_invalid", "would_create_cycle", "readback_failed", "not_found", "global_cannot_retire", "not_live",
  "edge_not_found", "line_changed", "empty_recipe", "forbidden", "global_requires_moo", "invalid_component",
  "invalid_quantity", "product_line_needs_measure_unit", "truncate_refused", "invalid_component_product",
] as const;
export type RecipeVersionErrorCode = (typeof RECIPE_VERSION_ERROR_CODES)[number];

/** 'recipe_version:<code>[:<n>]' (a P0001 message from 0262) → the code and, for a named line, its position. */
export function parseRecipeVersionRefusal(message: string): { code: RecipeVersionErrorCode; line: number | null } | null {
  const m = /recipe_version:([a-z_]+)(?::(\d+))?/.exec(message);
  if (!m) return null;
  const code = (RECIPE_VERSION_ERROR_CODES as readonly string[]).includes(m[1]!) ? (m[1] as RecipeVersionErrorCode) : null;
  if (!code) return null;
  return { code, line: m[2] !== undefined ? Number(m[2]) : null };
}

// ── The write gate (spec §2) ──────────────────────────────────────────────────

export type RecipeWriteRefusal = { ok: false; status: 403 | 404; code: "forbidden" | "not_found" | "global_requires_moo" };

/**
 * May this role read recipe versions (history, the snapshot a preview binds to)? LEVEL 6 IS NOT ONE
 * THING (AGENTS.md, 2a lead decision): at level 6 only the operational managers — the social media
 * manager is refused the catalog's version reads as well as its writes. A ROLE check, never level-only.
 */
export function recipeVersionReadAllowed(role: RoleCode, level: number): boolean {
  return level >= RECIPE_VERSION_READ_MIN && catalogWriteRoleAllowed(role, level);
}

/**
 * Decided from the actor and the scope alone, before any I/O. `scopeAllowed` is the caller's
 * catalogShopAllowed(actor, scope) (2a: level ≥ 8 or a membership). A GM never edits the global
 * recipe: their edit is their shop's version (global_requires_moo names the reason). The role rule
 * (catalogWriteRoleAllowed) runs too, so the gate never depends on the level floor alone to keep the
 * social media manager out.
 */
export function recipeVersionWriteGate(input: {
  role: RoleCode; level: number; scope: VersionScope; scopeAllowed: boolean;
}): { ok: true } | RecipeWriteRefusal {
  if (!catalogWriteRoleAllowed(input.role, input.level)) return { ok: false, status: 403, code: "forbidden" };
  if (input.scope !== null) {
    if (input.level < RECIPE_SHOP_WRITE_MIN) return { ok: false, status: 403, code: "forbidden" };
    if (!input.scopeAllowed) return { ok: false, status: 404, code: "not_found" };
    return { ok: true };
  }
  if (input.level >= RECIPE_GLOBAL_WRITE_MIN) return { ok: true };
  if (input.level >= RECIPE_SHOP_WRITE_MIN) return { ok: false, status: 403, code: "global_requires_moo" };
  return { ok: false, status: 403, code: "forbidden" };
}

// ── The cycle mirror (0262 recipe_scope_item_edges + recipe_lines_would_cycle) ─

export interface ScopedItemEdge { recipe_id: string; component_item_id: string }

/**
 * The item edges scope S's graph resolves: the global item lines of every recipe S has no live
 * version of, plus the item lines of S's live versions. `shopLiveVersions` = recipe → S's live
 * version id (empty for the global scope).
 */
export function scopedItemEdges(
  globalInputs: ReadonlyArray<{ recipe_id: string; component_item_id: string | null }>,
  shopLiveVersions: ReadonlyMap<string, string>,
  shopLines: ReadonlyArray<{ version_id: string; recipe_id: string; component_item_id: string | null }>,
): ScopedItemEdge[] {
  const live = new Set(shopLiveVersions.values());
  const out: ScopedItemEdge[] = [];
  for (const i of globalInputs) {
    if (i.component_item_id === null || shopLiveVersions.has(i.recipe_id)) continue;
    out.push({ recipe_id: i.recipe_id, component_item_id: i.component_item_id });
  }
  for (const l of shopLines) {
    if (l.component_item_id === null || !live.has(l.version_id)) continue;
    out.push({ recipe_id: l.recipe_id, component_item_id: l.component_item_id });
  }
  return out;
}

/**
 * Would recipe R holding these item lines close a loop in this graph? R's own old edges are replaced
 * by `lineItemIds`; the walk starts at `startItemIds` and follows every producer's lines; a cycle iff
 * it reaches an item R outputs. The 0258 rule, per scope.
 */
export function recipeLinesWouldCycle(
  args: { recipeId: string; lineItemIds: readonly string[]; startItemIds: readonly string[] },
  outputs: ReadonlyArray<{ recipe_id: string; output_item_id: string | null }>,
  edges: readonly ScopedItemEdge[],
): boolean {
  const all = [
    ...edges.filter((e) => e.recipe_id !== args.recipeId),
    ...args.lineItemIds.map((item) => ({ recipe_id: args.recipeId, component_item_id: item })),
  ];
  const targets = new Set(outputs.filter((o) => o.recipe_id === args.recipeId && o.output_item_id !== null).map((o) => o.output_item_id as string));
  const reach = new Set<string>(args.startItemIds);
  const queue = [...args.startItemIds];
  while (queue.length > 0) {
    const item = queue.shift() as string;
    if (targets.has(item)) return true;
    const producers = new Set(outputs.filter((o) => o.output_item_id === item).map((o) => o.recipe_id));
    for (const e of all) {
      if (!producers.has(e.recipe_id) || reach.has(e.component_item_id)) continue;
      reach.add(e.component_item_id);
      queue.push(e.component_item_id);
    }
  }
  return false;
}

/** One resolved recipe line in recipe_inputs' row shape (id = the recipe_inputs id, or the version line's id). */
export interface ResolvedRecipeInput {
  id: string;
  recipe_id: string;
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number | string;
  unit: string | null;
}

/**
 * The lines a scope resolves: every base row of a recipe with no replacement, then the replacement
 * lines of each replaced recipe (catalog Phase 3a). With no replacements this is `base` itself, in order.
 */
export function mergeResolvedInputs(
  base: readonly ResolvedRecipeInput[],
  replacements: ReadonlyMap<string, readonly RecipeVersionLineRow[]>,
): ResolvedRecipeInput[] {
  if (replacements.size === 0) return [...base];
  const out = base.filter((r) => !replacements.has(r.recipe_id));
  for (const [recipeId, lines] of replacements) {
    for (const l of lines) {
      out.push({
        id: l.id, recipe_id: recipeId, component_sku_id: l.component_sku_id, component_item_id: l.component_item_id,
        component_product_id: l.component_product_id, quantity: l.quantity, unit: l.unit,
      });
    }
  }
  return out;
}

// ── Lead decision (b): judge what a save ADDS; flag what it carries; name every refusal ─────────────

/** WHICH line was refused and WHY (1-based position in the set written; reason = the error code). */
export interface RecipeLineRefusal { position: number; name: string; reason: string }

const carriedKey = (f: RecipeLineFields) =>
  JSON.stringify([f.componentSkuId, f.componentItemId, f.componentProductId, f.quantity, f.unit?.trim() || null]);

/**
 * The 1-based positions of every line in `next` that is NOT carried unchanged from `current` (multiset match on
 * component, quantity and unit — 0262's SQL rule) — what a save ADDS or CREATES, and so what must pass the line
 * rules. A carried line stays even if it no longer would (it is flagged instead).
 */
export function addedLinePositions(current: readonly RecipeLineFields[], next: readonly RecipeLineFields[]): number[] {
  const pool = new Map<string, number>();
  for (const f of current) pool.set(carriedKey(f), (pool.get(carriedKey(f)) ?? 0) + 1);
  const out: number[] = [];
  next.forEach((f, i) => {
    const k = carriedKey(f);
    const n = pool.get(k) ?? 0;
    if (n > 0) pool.set(k, n - 1);
    else out.push(i + 1);
  });
  return out;
}

/** Why a saved line would not pass an add today (the product rule) — a FLAG on the page, never a refusal of a carried line. */
export function recipeLineProblem(
  f: RecipeLineFields,
  ctx: { activeProductIds: ReadonlySet<string>; activeMeasureLabels: ReadonlySet<string> },
): "invalid_component_product" | "product_line_needs_measure_unit" | null {
  if (f.componentProductId === null) return null;
  if (!ctx.activeProductIds.has(f.componentProductId)) return "invalid_component_product";
  const unit = f.unit?.trim() ?? "";
  return unit !== "" && ctx.activeMeasureLabels.has(unit) ? null : "product_line_needs_measure_unit";
}
