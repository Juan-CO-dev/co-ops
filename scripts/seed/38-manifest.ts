/** Seed 38's pure manifest. No environment, filesystem, network or import-time work. */
import type { AuditAction } from "../../lib/audit-actions";
import { parseCsv } from "../vendor-exports/parsers";
import type { ExportRow } from "../vendor-exports/model";
import { buildPackChain, validateChainStructure } from "../../lib/pack-chain-shared";

export type Row = Record<string, unknown>;
export const TABLES = ["vendors", "vendor_items", "sku_pack_levels", "vendor_price_history", "measure_units", "vendor_order_guides", "order_guide_sections", "order_guide_lines"] as const;
export type Table = typeof TABLES[number];
export type Snapshot = Record<Table, Row[]>;
export type Basis = "per_case" | "per_each" | "per_lb" | "per_dozen" | "per_bundle";
export interface Evidence extends ExportRow { citation: string }
export interface Review { row_id: string; kind: string; vendor: string; sku_id: string; sku_name: string; item_number: string; current: string; proposed: string; evidence: string; note: string }
export interface Mutation { table: Table; before: Row | null; after: Row }
export interface Operation { action: AuditAction; key: string; status: "ready" | "already"; evidence: string[]; mutations: Mutation[]; detail: string }
export interface Plan { operations: Operation[]; basis: { sku: string; basis: Basis | null; arithmetic: string[] }[]; held: string[]; reports: string[] }
export const THOMPSON_ID = "38000000-0000-5000-a000-000000000001";
export const MINI_ID = "38000000-0000-5000-a000-000000000002";
export const THOMPSON_NOTES = "Authorized Utz distributor; DSD, cash on delivery; cust C001190454; route 994599";
export const PURVEYOR_NOTE = "purveyor: Delmar Deli Provisions, Gaithersburg MD, BHDelmar@aol.com, 301-740-3956, Net 7";
export const JUAN = "seed38-rulings.md: Juan 2026-09-18: Thompson 12.5 oz Ripples, Box 9, $4.37/bag; Mini Chips 1 oz, Box 60, $0.39/bag; Country Snacks singles $1.80/bag";
export const REVIEW_COUNTS = { dedupe_level: 55, price_conflict: 8, price_basis: 92, item_number: 68, vendor_merge: 29, guide_absent: 41 } as const;
const str = (x: unknown) => String(x ?? "");
const number = (x: unknown): number => { const n = Number(x); if (x == null || !Number.isFinite(n)) throw new Error("Missing/nonfinite quantity"); return n; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function one(rows: Row[], context: string): Row { if (rows.length !== 1) throw new Error(`${context}: expected exactly one row, got ${rows.length}`); return rows[0]!; }
export function parseReview(csv: string): Review[] {
  const records = parseCsv(csv), header = records.shift()?.cells;
  if (!header || header[0] !== "row_id") throw new Error("Invalid review header");
  const rows = records.map(r => Object.fromEntries(header.map((key, i) => [key, r.cells[i] ?? ""])) as unknown as Review);
  if (rows.length !== 293 || new Set(rows.map(r => r.row_id)).size !== 293) throw new Error("Review manifest: expected 293 unique rows");
  for (const [kind, count] of Object.entries(REVIEW_COUNTS)) if (rows.filter(r => r.kind === kind).length !== count) throw new Error(`Review manifest count: ${kind} != ${count}`);
  return rows;
}

/** Exact units only. Volume is never silently converted into weight. */
export function vendorContents(e: ExportRow): { quantity: number; unit: "oz" | "each" | "fl oz" } | null {
  if (typeof e.pack_size !== "number" || e.pack_qty == null || e.pack_unparsed) return null;
  const conversion: Record<string, [number, "oz" | "each" | "fl oz"]> = { LB: [16, "oz"], OZ: [1, "oz"], GR: [1 / 28.349523125, "oz"], EA: [1, "each"], CT: [1, "each"], DZ: [12, "each"], GA: [128, "fl oz"], QT: [32, "fl oz"], LT: [33.8140227, "fl oz"] };
  const c = conversion[e.pack_unit ?? ""];
  return c ? { quantity: e.pack_qty * (e.pack_inner_qty ?? 1) * e.pack_size * c[0], unit: c[1] } : null;
}
export function reconcileBasis(price: number, e: ExportRow, purchaseRootLb?: number): { basis: Basis | null; arithmetic: string[] } {
  const contents = vendorContents(e), each = e.pack_qty == null ? null : e.pack_qty * (e.pack_inner_qty ?? 1);
  const billed = e.billed_price_cents ?? e.price_cents ?? e.price_per_lb_cents;
  // Catch-weight receipts bill a pound, while the ledger prices an internal piece.
  // Normalize that piece only when the weight and printed /lb denomination are proven.
  const billedPerLb = e.price_per_lb_cents != null;
  const factors: [Basis, number | null][] = [["per_case", billedPerLb ? null : 1], ["per_each", billedPerLb ? null : each], ["per_lb", billedPerLb ? purchaseRootLb && purchaseRootLb > 0 ? 1 / purchaseRootLb : null : contents?.unit === "oz" ? contents.quantity / 16 : null], ["per_dozen", contents?.unit === "each" ? contents.quantity / 12 : null], ["per_bundle", e.uom === "BD" ? 1 : null]];
  const arithmetic: string[] = [];
  let basis: Basis | null = null;
  for (const [candidate, factor] of factors) {
    if (factor == null || billed == null || billed <= 0) { arithmetic.push(`${candidate}: unavailable`); continue; }
    const total = price * factor, error = Math.abs(total - billed / 100) / (billed / 100);
    arithmetic.push(`${candidate}: ${price} x ${factor} = ${total}; billed ${billed / 100}; error ${(error * 100).toFixed(4)}%`);
    if (basis == null && error <= 0.03 + Number.EPSILON) basis = candidate;
  }
  return { basis, arithmetic };
}

/** Mirrors effective_date DESC, recorded_at DESC (NULLS FIRST), id DESC. */
export function latestPrice(rows: Row[], skuId: string): Row | undefined {
  const timestamp = (x: unknown) => BigInt(Date.parse(str(x))) * BigInt(1000) + BigInt((/\.(\d+)/.exec(str(x))?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  return rows.filter(r => r.vendor_item_id === skuId).sort((a, b) => {
    const date = str(b.effective_date).localeCompare(str(a.effective_date));
    if (date) return date;
    if (a.recorded_at == null || b.recorded_at == null) return a.recorded_at == null ? b.recorded_at == null ? str(b.id).localeCompare(str(a.id)) : -1 : 1;
    const x = timestamp(a.recorded_at), y = timestamp(b.recorded_at);
    return x === y ? str(b.id).localeCompare(str(a.id)) : x > y ? -1 : 1;
  })[0];
}
function citedEvidence(review: Review, evidence: Evidence[]): Evidence | undefined {
  const cited = evidence.filter(e => review.evidence.split("; ").includes(e.citation));
  const signatures = new Set(cited.map(e => JSON.stringify([e.vendor, e.item_no, e.pack, e.price_cents, e.price_per_lb_cents])));
  if (signatures.size > 1) throw new Error(`${review.row_id}: conflicting cited vendor evidence`);
  return cited[0];
}
export function rootContents(t: Snapshot, skuId: string): { root: Row; quantity: number; unit: string; childQuantity: number } | null {
  const levels = t.sku_pack_levels.filter(l => l.sku_id === skuId && l.active === true);
  if (!levels.length) return null;
  if (new Set(levels.map(l => l.label)).size !== levels.length || new Set(levels.map(l => l.display_ordinal)).size !== levels.length
    || levels.some(l => number(l.contains_qty) <= 0 || (l.contains_level_id == null) === (l.contains_measure_unit == null))) throw new Error(`${skuId}: invalid active level set`);
  const measures = new Map(t.measure_units.filter(m => m.active === true).map(m => [str(m.label), { dimension: str(m.dimension) as "weight" | "volume" | "count", toBaseFactor: number(m.to_base_factor) }]));
  const chain = buildPackChain(levels.map(l => ({ id: str(l.id), label: str(l.label), containsQty: number(l.contains_qty), containsLevelId: l.contains_level_id == null ? null : str(l.contains_level_id), containsMeasureUnit: l.contains_measure_unit == null ? null : str(l.contains_measure_unit), displayOrdinal: number(l.display_ordinal) })));
  if (!validateChainStructure(chain, measures).ok) throw new Error(`${skuId}: invalid active chain`);
  const children = new Set(levels.map(l => l.contains_level_id));
  const root = one(levels.filter(l => !children.has(l.id)), `${skuId} root`);
  let leaf = root, quantity = number(root.contains_qty);
  while (leaf.contains_level_id != null) { leaf = one(levels.filter(l => l.id === leaf.contains_level_id), "chain child"); quantity *= number(leaf.contains_qty); }
  const unit = str(leaf.contains_measure_unit), measure = measures.get(unit);
  if (!measure) throw new Error(`${skuId}: unknown measure ${unit}`);
  const baseUnit = measure.dimension === "weight" ? "oz" : measure.dimension === "count" ? "each" : "fl oz";
  quantity *= measure.toBaseFactor;
  return { root, quantity, unit: baseUnit, childQuantity: quantity / number(root.contains_qty) };
}

export function purchaseRootOz(t: Snapshot, sku: Row): number {
  const chain = rootContents(t, str(sku.id));
  if (chain) {
    if (chain.unit !== "oz") throw new Error(`${str(sku.name)}: purchase root is not proven weight`);
    return chain.quantity;
  }
  const unit = one(t.measure_units.filter(m => m.label === sku.each_measure && m.active === true), "purchase measure");
  if (unit.dimension !== "weight") throw new Error("Unproven weight conversion");
  return number(sku.units_per_pack) * number(sku.each_size) * number(unit.to_base_factor);
}

/** The independent classes; remaining identity/denomination rulings are added explicitly. */
export function buildWritePlan(csv: string, baseline: Snapshot, live: Snapshot, evidence: Evidence[], vendorsHaveNotes = true): Plan {
  const review = parseReview(csv);
  if (baseline.vendor_items.length !== 229 || baseline.sku_pack_levels.length !== 186 || baseline.vendor_price_history.length !== 103 || baseline.vendors.length !== 21) throw new Error("Baseline literal counts changed");
  const plan: Plan = { operations: [], basis: [], held: ["PC-001 Ever Roast Chicken: held, no vendor evidence"], reports: ["dedupe_level withdrawn; guide_absent: no writes"] };
  const state = structuredClone(live);
  for (const original of baseline.vendor_items) {
    const current = one(state.vendor_items.filter(s => s.id === original.id), `Reviewed SKU ${str(original.id)}`);
    for (const field of ["name", "active", "sku_class", "pack_format", "units_per_pack", "each_size", "each_measure", "product_id"]) {
      if (!same(current[field] ?? null, original[field] ?? null)) {
        if (original.name === "Utz Ripples") throw new Error("sku_identity_split_needed: Ripples identity changed");
        throw new Error(`Reviewed SKU identity drift: ${str(original.name)}.${field}`);
      }
    }
    if (original.item_number != null && current.item_number !== original.item_number) throw new Error(`Reviewed item number changed: ${str(original.name)}`);
  }
  const add = (action: AuditAction, key: string, mutations: Mutation[], sources: string[], detail = "", semanticChange = false) => {
    const changed = mutations.filter(m => m.before == null || Object.entries(m.after).some(([k, v]) => !same(m.before?.[k] ?? null, v)));
    plan.operations.push({ action, key, status: changed.length || semanticChange ? "ready" : "already", mutations: changed, evidence: sources, detail });
    for (const m of changed) { if (m.before) Object.assign(one(state[m.table].filter(r => r.id === m.before!.id), "planned update"), m.after); else state[m.table].push(structuredClone(m.after)); }
  };
  const update = (table: Table, before: Row, after: Row): Mutation => ({ table, before: structuredClone(before), after: { id: before.id, ...after } });
  const vendor = (name: string) => one(state.vendors.filter(v => v.name === name), name);
  const delmar = vendor("Delmar Provisions"), survivor = vendor("Boar's Head");
  if (state.vendor_items.filter(s => s.vendor_id === delmar.id).length !== 0) throw new Error("Delmar Provisions must have literally 0 SKUs (including inactive)");
  if (survivor.active !== true) throw new Error("Boar's Head survivor must be active");
  const thompsons = state.vendors.filter(v => str(v.name).toLowerCase() === "thompson delivers");
  if (thompsons.length > 1) throw new Error("Duplicate Thompson vendor");
  const thompson = thompsons[0];
  if (thompson && (thompson.name !== "Thompson Delivers" || thompson.active !== true || vendorsHaveNotes && thompson.notes !== THOMPSON_NOTES)) throw new Error("Existing Thompson vendor differs from manifest");
  if (!thompson && state.vendors.some(v => v.id === THOMPSON_ID)) throw new Error("Thompson ID collision");
  add("vendor.create", "Thompson Delivers", thompson ? [] : [{ table: "vendors", before: null, after: { id: THOMPSON_ID, name: "Thompson Delivers", active: true, ...(vendorsHaveNotes ? { notes: THOMPSON_NOTES } : {}) } }], [JUAN]);
  const merging = delmar.active === true;
  add("vendor.deactivate", "Delmar Provisions", [update("vendors", delmar, { active: false })], ["seed38-rulings.md: VM: Delmar 0 SKUs; Boar's Head survives"]);
  const notes = str(survivor.notes);
  add("vendor.merge", "Delmar -> Boar's Head", vendorsHaveNotes ? [update("vendors", survivor, { notes: notes.includes(PURVEYOR_NOTE) ? notes : [notes, PURVEYOR_NOTE].filter(Boolean).join("\n") })] : [], ["seed38-rulings.md: VM"], `loser=${str(delmar.id)} survivor=${str(survivor.id)}; 0 SKUs moved`, merging);
  if (!vendorsHaveNotes) plan.reports.push("vendors.notes absent in information_schema.columns: purveyor note skipped");
  const rippleReview = review.find(r => r.row_id === "IN-045")!;
  const ripples = one(state.vendor_items.filter(s => s.id === rippleReview.sku_id && s.name === "Utz Ripples" && s.active === true), "Ripples SKU missing/ambiguous");
  if (number(ripples.units_per_pack) !== 9 || number(ripples.each_size) !== 12.5 || ripples.each_measure !== "oz") throw new Error("sku_identity_split_needed: Ripples is not Box 9 x 12.5 oz");
  const thompsonId = vendor("Thompson Delivers").id;
  const rippleChain = rootContents(state, str(ripples.id));
  if (!rippleChain || rippleChain.unit !== "oz" || rippleChain.quantity !== 112.5 || rippleChain.root.label !== "Box" || number(rippleChain.root.contains_qty) !== 9) throw new Error("sku_identity_split_needed: Ripples active chain is not Box 9 x Bag 12.5 oz");
  if (ripples.vendor_id !== vendor("Country Snacks").id && ripples.vendor_id !== thompsonId) throw new Error("Ripples unexpected vendor");
  add("sku.vendor_repoint", str(ripples.id), [update("vendor_items", ripples, { vendor_id: thompsonId })], [JUAN, rippleReview.evidence]);
  const minis = state.vendor_items.filter(s => s.name === "Utz Mini Chips (1 oz)");
  if (minis.length > 1) throw new Error("Ambiguous Mini Chips");
  const mini = minis[0];
  if (mini && (mini.vendor_id !== thompsonId || mini.active !== true || number(mini.units_per_pack) !== 60 || number(mini.each_size) !== 1 || mini.each_measure !== "oz" || mini.item_number != null || mini.sku_class !== ripples.sku_class)) throw new Error("Mini Chips identity differs from manifest");
  if (!mini && state.vendor_items.some(s => s.id === MINI_ID)) throw new Error("Mini SKU ID collision");
  const miniId = mini?.id ?? MINI_ID;
  add("vendor_item.create", str(miniId), mini ? [] : [
    { table: "vendor_items", before: null, after: { id: miniId, vendor_id: thompsonId, name: "Utz Mini Chips (1 oz)", sku_class: ripples.sku_class, active: true, item_number: null, pack_format: "Box", units_per_pack: 60, each_size: 1, each_measure: "oz", each_container_label: "Bag" } },
    { table: "sku_pack_levels", before: null, after: { id: "38000000-0000-5000-a000-000000000003", sku_id: miniId, label: "Bag", contains_qty: 1, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 1, active: true } },
    { table: "sku_pack_levels", before: null, after: { id: "38000000-0000-5000-a000-000000000004", sku_id: miniId, label: "Box", contains_qty: 60, contains_level_id: "38000000-0000-5000-a000-000000000003", contains_measure_unit: null, display_ordinal: 0, active: true } },
  ], [JUAN], "sku_create: Juan's 2026-09-18 note overrides ticket 00602; item number stays NULL");
  const miniChain = rootContents(state, str(miniId));
  const miniLevels = state.sku_pack_levels.filter(l => l.sku_id === miniId && l.active === true);
  if (!miniChain || miniChain.quantity !== 60 || miniChain.unit !== "oz" || miniChain.root.label !== "Box" || number(miniChain.root.contains_qty) !== 60 || miniLevels.length !== 2 || !miniLevels.some(l => l.label === "Bag" && l.contains_measure_unit === "oz" && number(l.contains_qty) === 1)) throw new Error("Mini Chips active chain differs from manifest");
  for (const r of review.filter(r => r.kind === "item_number" && r.row_id !== "IN-068")) {
    const proposed = r.row_id === "IN-045" ? "27149" : r.row_id === "IN-021" ? "" : r.proposed;
    if (!proposed) continue;
    const sku = one(state.vendor_items.filter(s => s.id === r.sku_id && s.name === r.sku_name), `${r.row_id} SKU`);
    if (sku.vendor_id !== (r.row_id === "IN-045" ? thompsonId : vendor(r.vendor).id)) throw new Error(`${r.row_id}: SKU vendor drift`);
    if (sku.item_number != null && sku.item_number !== proposed) throw new Error(`${r.row_id}: different non-null item number`);
    if (state.vendor_items.some(s => s.id !== sku.id && s.vendor_id === sku.vendor_id && s.item_number === proposed)) throw new Error(`${r.row_id}: item-number collision`);
    add("sku.item_number_set", r.row_id, [update("vendor_items", sku, { item_number: proposed })], [r.evidence, `seed38-rulings.md ${r.row_id}`]);
  }
  for (const r of review.filter(r => r.kind === "price_basis")) {
    const sku = one(state.vendor_items.filter(s => s.id === r.sku_id && s.name === r.sku_name), `${r.row_id} SKU`);
    const reviewedPrice = JSON.parse(r.current) as Row;
    const currentPrice = latestPrice(live.vendor_price_history, r.sku_id);
    if (!currentPrice || (!str(currentPrice.id).startsWith("38000002-") && currentPrice.id !== reviewedPrice.latest_price_id)) throw new Error(`${r.row_id}: latest price changed since review`);
    if (currentPrice.id === reviewedPrice.latest_price_id && number(currentPrice.unit_price) !== number(reviewedPrice.unit_price)) throw new Error(`${r.row_id}: reviewed price value changed`);
    const e = citedEvidence(r, evidence), price = number(reviewedPrice.unit_price);
    let rootLb: number | undefined;
    if (e?.price_per_lb_cents != null) rootLb = purchaseRootOz(baseline, one(baseline.vendor_items.filter(s => s.id === r.sku_id), "basis baseline SKU")) / 16;
    const result = e ? reconcileBasis(price, e, rootLb) : { basis: null, arithmetic: ["No vendor evidence"] };
    plan.basis.push({ sku: r.sku_name, ...result });
    if (result.basis == null) {
      if (sku.price_basis != null) throw new Error(`${r.row_id}: unresolved basis unexpectedly non-null`);
      plan.reports.push(`basis_unresolved: ${r.row_id} ${r.sku_name}`); continue;
    }
    if (sku.price_basis != null && sku.price_basis !== result.basis) throw new Error(`${r.row_id}: different non-null price_basis`);
    add("sku.price_basis_set", r.row_id, [update("vendor_items", sku, { price_basis: result.basis })], [r.evidence], result.arithmetic.join("; "));
  }
  const eggReview = review.find(r => r.row_id === "IN-068")!;
  const eggCurrent = JSON.parse(eggReview.current) as Row;
  // NATURAL KEY, not the prod UUID: seed 37 mints guide-line ids per target (the sim's differ from prod's), and the
  // line's identity is (PFG guide, label "Eggs", unlinked, the old or new egg number). The reviewed id, when present,
  // must agree — a different row under the same key is drift, not a match.
  const pfgGuideIds = new Set(state.vendor_order_guides.filter(g => g.vendor_id === vendor("PFG").id).map(g => g.id));
  const pfgSectionIds = new Set(state.order_guide_sections.filter(s => pfgGuideIds.has(s.guide_id)).map(s => s.id));
  const eggLine = one(state.order_guide_lines.filter(l => pfgSectionIds.has(l.section_id) && l.label === "Eggs" && l.sku_id == null && ["439686", "517842"].includes(str(l.item_number))), "IN-068 guide line");
  if (state.order_guide_lines.some(l => l.id === eggCurrent.guide_line_id) && eggLine.id !== eggCurrent.guide_line_id) throw new Error("IN-068 guide identity drift");
  const eggSection = one(state.order_guide_sections.filter(s => s.id === eggLine.section_id), "Eggs section");
  const eggGuide = one(state.vendor_order_guides.filter(g => g.id === eggSection.guide_id), "Eggs guide");
  const eggNote = "tentative — confirm at the door";
  add("sku.item_number_set", "IN-068", [update("order_guide_lines", eggLine, { item_number: "517842", note: str(eggLine.note).includes(eggNote) ? eggLine.note : [str(eggLine.note), eggNote].filter(Boolean).join("\n") })], [eggReview.evidence, "seed38-rulings.md IN-068"], `Unlinked Eggs guide line only; guide=${str(eggGuide.id)}; SKU numbers unchanged`);
  // Use the pre-seed catalog's exact number, not a number just attached above.
  for (const original of baseline.vendor_items.filter(s => s.item_number != null)) {
    const vendorName = one(baseline.vendors.filter(v => v.id === original.vendor_id), "baseline vendor").name;
    const matches = evidence.filter(e => e.item_no === original.item_number && e.vendor.toLowerCase() === str(vendorName).toLowerCase());
    if (!matches.length) continue;
    const packs = new Set(matches.map(e => e.pack).filter(Boolean));
    if (packs.size > 1) throw new Error(`${str(original.name)}: conflicting exact-match vendor packs`);
    const e = matches.find(e => e.pack)!;
    if (!e) continue;
    const desired = vendorContents(e), old = rootContents(baseline, str(original.id));
    if (!desired || !old) continue;
    if (desired.unit !== old.unit) { plan.reports.push(`pack_unresolved: ${str(original.name)}: vendor ${desired.unit} vs root ${old.unit}; no cross-dimension guess`); continue; }
    if (Math.abs(desired.quantity - old.quantity) < 0.001) continue;
    const current = rootContents(state, str(original.id));
    if (!current) throw new Error(`${str(original.name)}: missing active root (partial seed)`);
    if (current.unit !== old.unit || Math.abs(current.childQuantity - old.childQuantity) > 0.001) throw new Error(`${str(original.name)}: chain changed since review`);
    const quantity = desired.quantity / current.childQuantity;
    if (Math.abs(current.quantity - desired.quantity) < 0.001) { add("sku.pack_level_supersede", str(original.id), [], [e.citation]); continue; }
    if (current.root.id !== old.root.id || Math.abs(current.quantity - old.quantity) > 0.001) throw new Error(`${str(original.name)}: active pack drift`);
    // A deterministic successor supports provenance checks and collision refusal on retry.
    const id = str(old.root.id).replace(/^.{8}/, "38000001");
    if (state.sku_pack_levels.some(l => l.id === id)) throw new Error("Pack successor ID collision/partial seed");
    const after = { id, sku_id: original.id, label: old.root.label, contains_qty: quantity, contains_level_id: old.root.contains_level_id, contains_measure_unit: old.root.contains_measure_unit, display_ordinal: old.root.display_ordinal, active: true };
    add("sku.pack_level_supersede", str(original.id), [update("sku_pack_levels", current.root, { active: false }), { table: "sku_pack_levels", before: null, after }], [e.citation, `${e.source_file}:${e.source_line}`], `${str(original.name)}: ${old.quantity} ${old.unit} -> ${desired.quantity} ${desired.unit}; ${e.pack}`);
    rootContents(state, str(original.id));
  }
  for (const r of review.filter(r => r.kind === "price_conflict" && r.row_id !== "PC-001")) {
    const sku = one(state.vendor_items.filter(s => s.id === r.sku_id && s.name === r.sku_name), `${r.row_id} price SKU`);
    // CC expressly selects 288533 for PC-008, overriding the sheet's 1715 line.
    const e = r.row_id === "PC-008" ? evidence.find(e => e.vendor === "pfg" && e.item_no === "288533" && e.price_cents === 8189) : citedEvidence(r, evidence);
    if (!e) throw new Error(`${r.row_id}: missing vendor price evidence`);
    const rootOz = purchaseRootOz(state, sku), contents = vendorContents(e);
    const expectedRate: Record<string, number> = { "PC-002": 499, "PC-003": 1927, "PC-004": 5352, "PC-005": 4045, "PC-006": 272.63, "PC-007": 5527, "PC-008": 8189 };
    const rate = e.price_per_lb_cents ?? e.price_cents;
    if (rate !== expectedRate[r.row_id]) throw new Error(`${r.row_id}: vendor rate differs from ruling`);
    const value = e.price_per_lb_cents != null ? e.price_per_lb_cents / 100 * rootOz / 16
      : contents?.unit === "oz" ? number(e.price_cents) / 100 * rootOz / contents.quantity : NaN;
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${r.row_id}: cannot express price at purchase root`);
    const unitPrice = Math.round(value * 1000000) / 1000000;
    const date = e.receipt_doc ? e.last_purchase_date : e.exported_at;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Missing evidence date");
    const current = latestPrice(state.vendor_price_history, str(sku.id));
    if (r.row_id === "PC-004") {
      if (!current || Math.abs(number(current.unit_price) - unitPrice) > 0.000001) throw new Error("PC-004 Black peppercorn is no longer already current");
      add("sku.price_supersede", r.row_id, [], [r.evidence], "Black peppercorn already current");
      continue;
    }
    const id = `38000002-0000-5000-a000-${r.row_id.slice(3).padStart(12, "0")}`;
    const previous = state.vendor_price_history.find(p => p.id === id);
    if (previous && (previous.vendor_item_id !== sku.id || number(previous.unit_price) !== unitPrice || previous.effective_date !== date)) throw new Error(`${r.row_id}: superseding price ID collision`);
    if (current && str(current.effective_date) > date) throw new Error(`${r.row_id}: evidence date cannot supersede a newer price`);
    if (previous && current?.id !== previous.id) throw new Error(`${r.row_id}: seed price is no longer latest`);
    add("sku.price_supersede", r.row_id, previous ? [] : [{ table: "vendor_price_history", before: null, after: { id, vendor_item_id: sku.id, unit_price: unitPrice, effective_date: date, recorded_by: null, source: "seed_38", source_note: `${e.citation}; ${rate / 100} vendor rate -> ${unitPrice}/purchase root (${rootOz} oz); ${date}` } }], [r.evidence, e.citation, `${e.source_file}:${e.source_line}`, "seed38-rulings.md PC"], `${r.sku_name}: ${rate / 100} vendor rate -> ${unitPrice}/purchase root (${rootOz} oz), ${date}`);
  }
  const singles = state.vendor_items.filter(s => s.vendor_id === vendor("Country Snacks").id && s.active === true && str(s.name).startsWith("Utz "));
  if (singles.length !== 5 || singles.some(s => number(s.units_per_pack) !== 1 || number(s.each_size) !== 2.75 || s.each_measure !== "oz")) throw new Error("Country Snacks single-bag identity drift: expected five 2.75 oz bag SKUs");
  const utz = [{ sku: ripples, bagPrice: 4.37, count: 9, date: "2026-09-17" }, { sku: one(state.vendor_items.filter(s => s.id === miniId), "Mini price SKU"), bagPrice: 0.39, count: 60, date: "2026-09-17" }, ...singles.sort((a, b) => str(a.id).localeCompare(str(b.id))).map(sku => ({ sku, bagPrice: 1.8, count: 1, date: "2026-09-08" }))];
  for (const [i, u] of utz.entries()) {
    const id = `38000003-0000-5000-a000-${String(i + 1).padStart(12, "0")}`;
    const unitPrice = Math.round(u.bagPrice * u.count * 100) / 100;
    const existing = state.vendor_price_history.find(p => p.id === id), current = latestPrice(state.vendor_price_history, str(u.sku.id));
    if (existing && (existing.vendor_item_id !== u.sku.id || number(existing.unit_price) !== unitPrice || existing.effective_date !== u.date)) throw new Error("Utz price ID collision");
    if (current && str(current.effective_date) > u.date) throw new Error(`${str(u.sku.name)}: evidence date cannot supersede newer price`);
    if (existing && existing.id !== current?.id) throw new Error("Utz seed price no longer latest");
    if (u.sku.price_basis != null && u.sku.price_basis !== "per_each") throw new Error("Utz price_basis drift");
    add("sku.price_basis_set", `Utz:${str(u.sku.id)}`, [update("vendor_items", u.sku, { price_basis: "per_each" })], [JUAN], `Explicit ruling: ${u.bagPrice}/bag; purchase root contains ${u.count} bags`);
    add("sku.price_supersede", `Utz:${str(u.sku.id)}`, existing ? [] : [{ table: "vendor_price_history", before: null, after: { id, vendor_item_id: u.sku.id, unit_price: unitPrice, effective_date: u.date, recorded_by: null, source: "seed_38", source_note: `${JUAN}; ${u.bagPrice}/bag x ${u.count} bags/root = ${unitPrice}/root` } }], [JUAN], `${str(u.sku.name)}: ${u.bagPrice}/bag x ${u.count} bags/root = ${unitPrice}/root`);
  }
  // Literal reviewed logical operation counts (PC-004 is included as an already).
  const expected = { "vendor.create": 1, "vendor.deactivate": 1, "vendor.merge": 1, "sku.vendor_repoint": 1, "vendor_item.create": 1, "sku.item_number_set": 17, "sku.price_basis_set": 53, "sku.pack_level_supersede": 15, "sku.price_supersede": 14 };
  for (const [action, count] of Object.entries(expected)) if (plan.operations.filter(o => o.action === action).length !== count) throw new Error(`Literal manifest count mismatch: ${action} expected ${count}`);
  return plan;
}
