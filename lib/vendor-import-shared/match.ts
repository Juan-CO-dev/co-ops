import type { CatalogSku, Decision, ExportRow, Observation, PlanOp } from "./model";
import { packComparison, priceAtRoot, priceComparison } from "./reconcile";

export type BeforeState = Record<string, Record<string, unknown>>;
export const observationKey = (observation: Pick<Observation, "source_row" | "kind">): string => `${observation.source_row}:${observation.kind}`;
const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const evidenceDate = (row: ExportRow) => row.receipt_doc ? row.last_purchase_date : row.exported_at;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** vendorId is the server-validated adapter-family binding, not inferred from names. */
export function matchObservations(rows: readonly ExportRow[], catalog: readonly CatalogSku[], vendorId?: string): Observation[] {
  const observations = rows.flatMap((row, index) => {
    // Ordinal rather than physical line: compact receipt JSON can contain many lines on one source line.
    const source_row = index + 1;
    const scoped = catalog.filter(sku => sku.vendor_id === (vendorId ?? row.vendor));
    const numbered = row.item_no ? scoped.filter(sku => sku.item_number === row.item_no) : [];
    const matched = numbered.length ? numbered : scoped.filter(sku => norm(sku.name) !== "" && norm(sku.name) === norm(row.description));
    const match: Observation["match"] = { rule: matched.length > 1 ? "ambiguous" : matched.length === 0 ? "unmatched" : numbered.length ? "item_number" : "name_exact", sku_id: matched.length === 1 ? matched[0]!.id : null, candidates: matched.map(sku => sku.id).sort() };
    const result: Observation[] = [];
    const add = (kind: Observation["kind"], reason: string, proposed: Observation["proposed"] = null) => {
      // The ledger key permits only one row per kind. First blocking reason has priority.
      if (!result.some(o => o.kind === kind)) result.push({ source_row, row, match, kind, reason, proposed });
    };
    const sku = matched.length === 1 ? matched[0]! : null;
    if (!sku) { add("needs_person", numbered.length > 1 ? "duplicate_item_number" : matched.length > 1 ? "duplicate_name" : "no_match"); return result; }
    if (!sku.active) { add("needs_person", "inactive_sku"); return result; }
    if (row.item_no && sku.item_number != null && row.item_no !== sku.item_number) { add("needs_person", "item_number_conflict"); return result; }
    if (sku.item_number == null && row.item_no) add("item_number", "item_number_missing", { item_number: row.item_no });
    const date = evidenceDate(row);
    if (sku.latestPrice && date && date < sku.latestPrice.effective_date) {
      add("needs_person", "stale_price_evidence"); return result;
    }
    const noPrice = row.price_cents == null && row.price_per_lb_cents == null;
    const comparison = packComparison(row, sku.root, sku.price_basis);
    if (row.price_per_lb_cents != null && sku.root?.dimension !== "weight") add("needs_person", "per_lb_on_count_root");
    else if (comparison.dimensionMismatch) add("needs_person", "pack_dimension_mismatch");
    else if (!noPrice) {
      const price = priceComparison(row, sku.root, sku.price_basis, sku.latestPrice);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) add("needs_person", "price_date_missing");
      else if (sku.latestPrice && date < sku.latestPrice.effective_date) add("needs_person", "stale_price_evidence");
      else if (price.proposed == null) add("needs_person", "price_basis_unresolved");
      else if (price.same && comparison.proposedQuantity != null) add("price", "price_depends_on_pack", { unit_price: price.proposed, effective_date: date });
      else if (price.same) add("noop", "price_same");
      else if (sku.latestPrice && date === sku.latestPrice.effective_date) add("needs_person", "same_date_price_conflict");
      else add("price", "price_changed", { unit_price: price.proposed, effective_date: date });
    }
    if (comparison.proposedQuantity != null && sku.root) add("pack", "pack_changed", { root: { quantity: comparison.proposedQuantity, unit: sku.root.unit } });
    if (noPrice && result.length === 0) add("noop", "no_price_supplied");
    return result;
  });
  const bySku = new Map<string, Map<number, Observation>>();
  for (const observation of observations) if (observation.match.sku_id) {
    const group = bySku.get(observation.match.sku_id) ?? new Map<number, Observation>();
    group.set(observation.source_row, observation); bySku.set(observation.match.sku_id, group);
  }
  const held = new Map<number, string>();
  for (const group of bySku.values()) {
    const sources = [...group.values()];
    const newest = sources.map(o => evidenceDate(o.row) ?? "").sort().at(-1) ?? "";
    const current = sources.filter(o => evidenceDate(o.row) === newest);
    const signatures = new Set(current.map(({ row }) => JSON.stringify([row.pack_qty, row.pack_size, row.pack_unit,
      row.pack_inner_qty, row.pack_size_min, row.pack_size_max, row.pack_catch_weight, row.pack_unparsed,
      row.price_cents, row.price_per_lb_cents, row.price_basis, row.uom])));
    for (const source of sources) {
      if ((evidenceDate(source.row) ?? "") < newest) held.set(source.source_row, "stale_batch_evidence");
      else if (signatures.size > 1) held.set(source.source_row, "conflicting_batch_evidence");
    }
  }
  const emitted = new Set<number>();
  return observations.flatMap(observation => {
    const reason = held.get(observation.source_row);
    if (!reason || observation.kind === "item_number") return [observation];
    if (emitted.has(observation.source_row)) return [];
    emitted.add(observation.source_row);
    return [{ ...observation, kind: "needs_person" as const, reason, proposed: null }];
  });
}

/** Persist this companion map with the report; observations keep their locked UI contract. */
export function snapshotBeforeState(observations: readonly Observation[], catalog: readonly CatalogSku[]): BeforeState {
  const before: BeforeState = {};
  for (const observation of observations) {
    const sku = catalog.find(s => s.id === observation.match.sku_id);
    if (!sku) continue;
    const value = observation.kind === "price" ? { id: sku.latestPrice?.id ?? null, unit_price: sku.latestPrice?.unit_price ?? null, effective_date: sku.latestPrice?.effective_date ?? null, price_basis: sku.price_basis, root: sku.root }
      : observation.kind === "pack" && sku.root ? { level_id: sku.root.levelId, quantity: sku.root.quantity, unit: sku.root.unit, price_basis: sku.price_basis, latest_price: sku.latestPrice }
      : observation.kind === "item_number" ? { item_number: sku.item_number } : null;
    if (value) {
      const snapshot: Record<string, unknown> = structuredClone(value);
      const pack = observations.find(o => o.source_row === observation.source_row && o.kind === "pack" && o.match.sku_id === sku.id);
      if (observation.kind === "price" && pack?.proposed?.root && sku.root) {
        const amount = priceAtRoot(observation.row, { ...sku.root, ...pack.proposed.root }, sku.price_basis);
        if (amount != null) snapshot.price_with_pack = { unit_price: amount, effective_date: observation.proposed?.effective_date };
      }
      before[observationKey(observation)] = snapshot;
    }
  }
  return before;
}

export function planFromDecisions(observations: readonly Observation[], decisions: Record<string, Decision>, beforeState: BeforeState = {}): PlanOp[] {
  const ops: PlanOp[] = [];
  for (const observation of observations) {
    if (decisions[observationKey(observation)] !== "accept" || !observation.match.sku_id || !observation.proposed) continue;
    const action = ({ price: "sku.price_supersede", item_number: "sku.item_number_set", pack: "sku.pack_level_supersede" } as const)[observation.kind as "price" | "item_number" | "pack"];
    if (!action) continue;
    const before = beforeState[observationKey(observation)];
    if (!before) throw new Error("missing_before_state");
    if (ops.some(op => op.sku_id === observation.match.sku_id && op.action === action)) throw new Error("duplicate_sku_operation");
    const after = structuredClone(observation.proposed);
    ops.push({ action, sku_id: observation.match.sku_id, source_row: observation.source_row, before: structuredClone(before), after });
  }
  for (const pack of ops.filter(op => op.action === "sku.pack_level_supersede")) {
    const price = ops.find(op => op.sku_id === pack.sku_id && op.action === "sku.price_supersede");
    if (!price) continue;
    const alternate = price.before.price_with_pack;
    if (price.source_row !== pack.source_row || !alternate || typeof alternate !== "object" || Array.isArray(alternate)) throw new Error("conflicting_pack_price");
    price.after = structuredClone(alternate as Record<string, unknown>);
  }
  return ops.filter(op => op.action !== "sku.price_supersede" || op.before.unit_price == null
    || Math.abs(Number(op.after.unit_price) - Number(op.before.unit_price)) > 0.005 + Number.EPSILON)
    .sort((a, b) => compare(a.sku_id, b.sku_id) || compare(a.action, b.action) || a.source_row - b.source_row);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

/** Web Crypto works in the UI and Node without importing a server module. */
export async function planDigest(ops: readonly PlanOp[], beforeState: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical({ ops, before: beforeState })));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
