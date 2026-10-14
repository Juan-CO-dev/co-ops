/**
 * One shop's worth of Counts read-path data for the B9 equivalence + budget tests.
 *
 * Deliberately awkward: count anchors with and without a previous count, a dimension
 * flip, product-allocated (C-mode) lines and a measured zero, an inactive SKU on the
 * census, two par walks + a draft walk, existing inferred baselines at two instants plus
 * SKUs that need a fresh one, a backdated (retro-edit) delivery, null-oz and level-less
 * receipt lines, superseded / revoked / other-shop productions, a production exactly on
 * the 28-day cutoff instant, a sales-coverage gap, and timestamps in mixed spellings
 * ("Z", "+00:00", microseconds) so instant comparisons are exercised the way Postgres does.
 *
 * `scale` adds extra anchor GROUPS (par walks, count sessions, inferred instants) so the
 * budget test can prove extra groups cost zero extra round trips.
 */
type Row = Record<string, unknown>;

export const LOC = "loc-1";
export const OTHER = "loc-2";
export const NOW_ISO = "2026-10-14T16:00:00.000Z"; // 12:00 ET
export const NOW = Date.parse(NOW_ISO);

export interface FixtureScale { parWalks?: number; countSessions?: number; baselineInstants?: number }

export function buildCountsFixture(scale: FixtureScale = {}): Record<string, Row[]> {
  const sku = (id: string, name: string, extra: Row = {}): Row => ({
    id, name, pack_format: null, vendor_id: "v-a", product_id: null, active: true, avg_oz_per_each: null,
    pending_review: false, location_id: null, units_per_pack: null, each_size: null, each_measure: null,
    each_container_label: null, ...extra,
  });
  const vendor_items: Row[] = [
    sku("s-turkey", "Turkey", { pack_format: "case" }),
    sku("s-cheese", "Cheese", { vendor_id: "v-b" }),
    sku("s-ham-a", "Ham", { product_id: "p-ham" }),
    sku("s-ham-b", "Ham", { product_id: "p-ham", vendor_id: "v-b" }),
    sku("s-ham-c", "Ham", { product_id: "p-ham", vendor_id: "v-b", active: false }),
    sku("s-bags", "Deli bags"),
    sku("s-cups", "Cups", { vendor_id: null }),
    sku("s-lettuce", "Lettuce", { vendor_id: "v-b" }),
    sku("s-tomato", "Tomato", { vendor_id: "v-b" }),
    sku("s-pickle", "Pickle"),
    sku("s-onion", "Onion"),
    sku("s-pepper", "Pepper"),
    sku("s-mayo", "Mayo"),
    sku("s-salt", "Salt"),
    sku("s-old", "Old sauce", { active: false }),
    sku("s-twin-x", "Bread", { product_id: "p-bread" }),
    sku("s-twin-y", "Bread", { product_id: "p-bread", vendor_id: "v-b" }),
    sku("s-relish", "Relish", { product_id: "p-retired" }),
    sku("s-store-ham", "Ham", { product_id: "p-ham", vendor_id: "v-store", location_id: LOC }),
  ];
  const vendors: Row[] = [
    { id: "v-a", name: "Sysco", source_kind: "vendor", active: true },
    { id: "v-b", name: "Baldor", source_kind: "vendor", active: true },
    { id: "v-store", name: "Corner store", source_kind: "store", active: true },
    { id: "v-unused", name: "Nobody", source_kind: "vendor", active: false },
  ];
  const measure_units: Row[] = [
    { label: "oz", dimension: "weight", to_base_factor: 1, active: true },
    { label: "lb", dimension: "weight", to_base_factor: "16", active: true },
    { label: "each", dimension: "count", to_base_factor: 1, active: true },
    { label: "gal", dimension: "volume", to_base_factor: 128, active: false },
  ];
  const lvl = (id: string, sku_id: string, label: string, contains_qty: number | string, next: string | null, unit: string | null, display_ordinal: number, active = true): Row =>
    ({ id, sku_id, label, contains_qty, contains_level_id: next, contains_measure_unit: unit, display_ordinal, active });
  const sku_pack_levels: Row[] = [
    lvl("pl-t-bag", "s-turkey", "bag", 80, null, "oz", 2),
    lvl("pl-t-case", "s-turkey", "case", 4, "pl-t-bag", null, 1),
    lvl("pl-b-case", "s-bags", "case", 10, "pl-b-sleeve", null, 1),
    lvl("pl-b-sleeve", "s-bags", "sleeve", "50", null, "each", 2),
    lvl("pl-c-sleeve", "s-cups", "sleeve", 100, null, "each", 1),
    lvl("pl-c-old", "s-cups", "box", 5, "pl-c-sleeve", null, 0, false),
    lvl("pl-h-pack", "s-ham-a", "pack", 32, null, "oz", 1),
    lvl("pl-hb-pack", "s-ham-b", "pack", 2, null, "lb", 1),
    lvl("pl-x-loaf", "s-twin-x", "loaf", 20, null, "oz", 1),
  ];
  const products: Row[] = [
    { id: "p-ham", name: "Ham", unit_oz: null, active: true },
    { id: "p-bread", name: "Bread", unit_oz: "16", active: true },
    { id: "p-retired", name: "Relish", unit_oz: 8, active: false },
  ];
  const product_primaries: Row[] = [
    { id: "pp-1", product_id: "p-ham", location_id: null, primary_sku_id: "s-ham-a", note: null },
    { id: "pp-2", product_id: "p-bread", location_id: LOC, primary_sku_id: "s-twin-y", note: null },
    { id: "pp-3", product_id: "p-bread", location_id: OTHER, primary_sku_id: "s-twin-x", note: null },
  ];
  const location_sku_settings: Row[] = [
    { sku_id: "s-ham-c", location_id: LOC, active_override: true },
    { sku_id: "s-twin-x", location_id: OTHER, active_override: false },
  ];

  // ── counts ──
  const sku_count_events: Row[] = [
    { id: "e0", location_id: LOC, counted_at: "2026-09-20T12:00:00+00:00", active: true },
    { id: "e1", location_id: LOC, counted_at: "2026-10-01T14:00:00.123456+00:00", active: true },
    { id: "e2", location_id: LOC, counted_at: "2026-10-08T13:30:00+00:00", active: true },
    { id: "e3", location_id: LOC, counted_at: "2026-10-10T15:00:00.5+00:00", active: true },
    { id: "e-off", location_id: LOC, counted_at: "2026-10-11T15:00:00+00:00", active: false },
    { id: "e-other", location_id: OTHER, counted_at: "2026-10-09T15:00:00+00:00", active: true },
  ];
  let lineSeq = 0;
  const line = (count_event_id: string, sku_id: string, dim: "weight" | "count" | null, oz: number | string | null, units: number | string | null, extra: Row = {}): Row =>
    ({ id: `cl-${String(++lineSeq).padStart(3, "0")}`, count_event_id, sku_id, anchor_dimension: dim, resolved_oz: oz, resolved_units: units,
      is_loose: false, partial_fraction: null, level_label: "x", qty: 1, allocated_from_product_id: null, ...extra });
  const sku_count_lines: Row[] = [
    line("e0", "s-ham-a", "weight", 200, null),
    line("e0", "s-cheese", null, "80", null),
    line("e0", "s-cups", "weight", 12, null),
    line("e1", "s-turkey", "weight", 320, null, { is_loose: true }),
    line("e1", "s-turkey", "weight", "320", null),
    line("e1", "s-bags", "count", null, 500),
    line("e2", "s-turkey", "weight", 500, null, { partial_fraction: "0.5" }),
    line("e2", "s-cheese", "weight", "96.5", null),
    line("e2", "s-bags", "count", null, "420"),
    line("e2", "s-cups", "count", null, 1000),
    line("e2", "s-old", "weight", 32, null),
    line("e3", "s-ham-a", "weight", 120, null, { allocated_from_product_id: "p-ham" }),
    line("e3", "s-ham-b", "weight", 0, null, { allocated_from_product_id: "p-ham" }),
    line("e-off", "s-salt", "weight", 5, null),
    line("e-other", "s-turkey", "weight", 9999, null),
  ];

  // ── par walks ──
  const par_pass_events: Row[] = [
    { id: "pe1", location_id: LOC, status: "submitted" },
    { id: "pe2", location_id: LOC, status: "submitted" },
    { id: "pe-draft", location_id: LOC, status: "draft" },
    { id: "pe-other", location_id: OTHER, status: "submitted" },
  ];
  let parSeq = 0;
  const pl = (event_id: string, sku_id: string, implied: number | string | null, created_at: string): Row =>
    ({ id: `ppl-${String(++parSeq).padStart(3, "0")}`, event_id, sku_id, implied_on_hand_oz: implied, created_at });
  const PE1 = "2026-10-05T11:00:00+00:00";
  const PE2 = "2026-10-12T10:15:00.25+00:00";
  const par_pass_lines: Row[] = [
    pl("pe1", "s-lettuce", 48, PE1),
    pl("pe1", "s-ham-b", 30, PE1), // census-anchored → never a par estimate
    pl("pe1", "s-pickle", "15", PE1),
    pl("pe1", "s-tomato", null, PE1),
    pl("pe2", "s-tomato", 64, PE2),
    pl("pe2", "s-lettuce", 50, PE2),
    pl("pe2", "s-twin-x", 20, PE2),
    pl("pe-draft", "s-onion", 999, "2026-10-13T10:00:00Z"),
    pl("pe-other", "s-mayo", 999, "2026-10-13T10:00:00Z"),
  ];

  // ── inferred baselines ──
  const sku_inferred_baselines: Row[] = [
    { location_id: LOC, sku_id: "s-onion", inferred_oz: 70, computed_at: "2026-09-25T09:00:00+00:00", basis: {} },
    { location_id: LOC, sku_id: "s-mayo", inferred_oz: "33.25", computed_at: "2026-10-03T08:00:00.000001+00:00", basis: {} },
    { location_id: LOC, sku_id: "s-turkey", inferred_oz: 1, computed_at: "2026-09-01T00:00:00+00:00", basis: {} },
    { location_id: OTHER, sku_id: "s-pepper", inferred_oz: 1, computed_at: "2026-09-01T00:00:00+00:00", basis: {} },
  ];

  // ── receiving ──
  const vendor_deliveries: Row[] = [
    { id: "d1", location_id: LOC, vendor_id: "v-a", created_at: "2026-10-03T15:00:00.000123+00:00", delivery_date: "2026-10-03" },
    { id: "d2", location_id: LOC, vendor_id: "v-b", created_at: "2026-10-09T12:00:00Z", delivery_date: "2026-10-07" }, // backdated vs e2
    { id: "d3", location_id: LOC, vendor_id: "v-a", created_at: "2026-10-13T14:00:00+00:00", delivery_date: "2026-10-13" },
    { id: "d4", location_id: OTHER, vendor_id: "v-a", created_at: "2026-10-10T10:00:00+00:00", delivery_date: "2026-10-10" },
    { id: "d5", location_id: LOC, vendor_id: "v-a", created_at: "2026-09-01T10:00:00+00:00", delivery_date: "2026-09-01" },
    { id: "d6", location_id: LOC, vendor_id: "v-store", created_at: "2026-10-11T18:00:00+00:00", delivery_date: "2026-10-11" },
  ];
  let itemSeq = 0;
  const di = (delivery_id: string, vendor_item_id: string, resolved_oz: number | string | null, created_at: string, level: string | null = null, qty: number | string | null = null): Row =>
    ({ id: `di-${String(++itemSeq).padStart(3, "0")}`, delivery_id, vendor_item_id, resolved_oz, created_at, received_level_label: level, received_qty_at_level: qty });
  const vendor_delivery_items: Row[] = [
    di("d1", "s-turkey", 320, "2026-10-03T15:00:01+00:00", "case", 1),
    di("d1", "s-bags", null, "2026-10-03T15:00:01+00:00", "case", 2),
    di("d1", "s-ham-a", 100, "2026-10-03T15:00:01+00:00"),
    di("d2", "s-turkey", "160.25", "2026-10-09T12:00:01Z", "bag", 2),
    di("d2", "s-cheese", null, "2026-10-09T12:00:01Z"),
    di("d2", "s-cheese", 40, "2026-10-08T13:00:00Z"), // item older than its header
    di("d3", "s-lettuce", 24, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-tomato", 32, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-onion", 10, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-pepper", 12, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-cups", null, "2026-10-13T14:00:02+00:00", null, 3),
    di("d3", "s-bags", null, "2026-10-13T14:00:02+00:00", " sleeve ", "4"),
    di("d3", "s-ham-a", 40, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-ham-b", 20, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-twin-x", 50, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-twin-y", 30, "2026-10-13T14:00:02+00:00"),
    di("d3", "s-mayo", 0, "2026-10-13T14:00:02+00:00"),
    di("d4", "s-turkey", 999, "2026-10-10T10:00:01+00:00"),
    di("d5", "s-turkey", 777, "2026-09-01T10:00:01+00:00"),
    di("d6", "s-store-ham", 16, "2026-10-11T18:00:01+00:00"),
  ];

  // ── production ──
  const productions: Row[] = [
    { id: "pr1", location_id: LOC, produced_at: "2026-10-02T12:00:00+00:00", superseded_at: null, revoked_at: null, output_item_id: "it-club" },
    { id: "pr2", location_id: LOC, produced_at: "2026-10-09T13:00:00.75+00:00", superseded_at: null, revoked_at: null, output_item_id: "it-sauce" },
    { id: "pr3", location_id: LOC, produced_at: "2026-10-11T13:00:00Z", superseded_at: "2026-10-11T14:00:00Z", revoked_at: null, output_item_id: "it-club" },
    { id: "pr4", location_id: LOC, produced_at: "2026-10-12T09:00:00+00:00", superseded_at: null, revoked_at: "2026-10-12T10:00:00Z", output_item_id: "it-club" },
    { id: "pr5", location_id: OTHER, produced_at: "2026-10-10T09:00:00+00:00", superseded_at: null, revoked_at: null, output_item_id: "it-club" },
    { id: "pr6", location_id: LOC, produced_at: "2026-09-16T16:00:00+00:00", superseded_at: null, revoked_at: null, output_item_id: "it-sauce" }, // exactly the 28-day cutoff
    { id: "pr7", location_id: LOC, produced_at: "2026-09-16T15:59:59.999999+00:00", superseded_at: null, revoked_at: null, output_item_id: "it-sauce" },
    { id: "pr8", location_id: LOC, produced_at: "2026-10-13T20:00:00Z", superseded_at: null, revoked_at: null, output_item_id: "it-slaw" },
  ];
  let inSeq = 0;
  const pi = (production_id: string, input_sku_id: string, input_oz: number | string | null): Row =>
    ({ id: `pi-${String(++inSeq).padStart(3, "0")}`, production_id, input_sku_id, input_oz });
  const production_inputs: Row[] = [
    pi("pr1", "s-turkey", 50),
    pi("pr2", "s-turkey", "40"), pi("pr2", "s-cheese", 10), pi("pr2", "s-onion", 5), pi("pr2", "s-pepper", 30), pi("pr2", "s-mayo", 4),
    pi("pr3", "s-turkey", 999),
    pi("pr4", "s-turkey", 999),
    pi("pr5", "s-turkey", 999),
    pi("pr6", "s-pepper", 7),
    pi("pr7", "s-pepper", 1000),
    pi("pr8", "s-twin-y", 6), pi("pr8", "s-relish", 9), pi("pr8", "s-lettuce", 3), pi("pr8", "s-tomato", 2), pi("pr8", "s-ham-a", 5),
  ];

  // ── sales: legacy ledger + the capture tables ──
  const dates: string[] = [];
  for (let t = Date.parse("2026-09-12T12:00:00Z"); t <= Date.parse("2026-10-13T12:00:00Z"); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
  const GAP = "2026-09-28";
  const DEGRADED = "2026-10-04";
  const MISMATCH = "2026-10-11";
  const salesPerDay: Array<[string, number | string]> = [
    ["s-turkey", 10], ["s-cheese", 2], ["s-lettuce", "1.5"], ["s-pepper", 3], ["s-twin-y", 1], ["s-relish", 0.5], ["s-onion", 0.25], ["s-tomato", 0.1],
  ];
  const toast_daily_depletion: Row[] = [];
  const toast_capture_daily_depletion: Row[] = [];
  const toast_sales_events: Row[] = [];
  const toast_capture_runs: Row[] = [];
  const toast_depletion_day_coverage: Row[] = [];
  const toast_depletion_item_attribution: Row[] = [];
  let tdd = 0;
  for (const d of dates) {
    toast_sales_events.push({ id: `tse-${d}`, location_id: LOC, business_date: d });
    if (d === GAP) continue;
    const dayIdx = dates.indexOf(d);
    for (const [skuId, oz] of salesPerDay) {
      const row = { location_id: LOC, business_date: d, sku_id: skuId, direct_oz: typeof oz === "number" ? oz + dayIdx / 100 : oz, flattened_oz: 1 };
      toast_daily_depletion.push({ id: `tdd-${String(++tdd).padStart(4, "0")}`, ...row });
      toast_capture_daily_depletion.push({ id: `tcd-${String(tdd).padStart(4, "0")}`, ...row });
    }
    toast_capture_runs.push({ id: `run-${d}`, location_id: LOC, business_date: d, status: "completed", finished_at: `${d}T23:59:00+00:00`, orders: 0 });
    const aggregateCount = salesPerDay.length + (d === MISMATCH ? 1 : 0);
    toast_depletion_day_coverage.push({ location_id: LOC, business_date: d, run_id: `run-${d}`, status: d === DEGRADED ? "degraded" : "success",
      computed_at: `${d}T23:59:30+00:00`, aggregate_count: aggregateCount, attribution_count: d === "2026-10-09" ? 1 : 0,
      suspect_check_count: 0, suspect_qty: 0, counted_qty: 0 });
    if (d === "2026-10-09") toast_depletion_item_attribution.push({ location_id: LOC, business_date: d, item_id: "it-sauce", item_path: ["it-sauce"], sku_id: "s-pepper", sales_oz: 6 });
  }
  toast_sales_events.push({ id: "tse-today", location_id: LOC, business_date: "2026-10-14" });
  toast_sales_events.push({ id: "tse-other", location_id: OTHER, business_date: "2026-10-01" });
  toast_daily_depletion.push({ id: "tdd-9999", location_id: OTHER, business_date: "2026-10-02", sku_id: "s-turkey", direct_oz: 500, flattened_oz: 0 });

  const prep_batch_sessions: Row[] = [
    { location_id: LOC, template_item_id: "ti-1", item_id: "it-sauce", business_date: "2026-10-12", source: "opening_p2", tossed_qty: "2", tossed_par_unit: "qt", tossed_at: "2026-10-12T15:00:00+00:00", tossed_by: "u-1" },
    { location_id: LOC, template_item_id: "ti-2", item_id: "it-slaw", business_date: "2026-10-13", source: "mid_day_p2", tossed_qty: 0, tossed_par_unit: "qt", tossed_at: "2026-10-13T15:00:00+00:00", tossed_by: null },
    { location_id: LOC, template_item_id: "ti-3", item_id: "it-slaw", business_date: "2026-10-13", source: "mid_day_p2", tossed_qty: 1, tossed_par_unit: null, tossed_at: "2026-10-13T16:00:00+00:00", tossed_by: null },
  ];
  const items: Row[] = [{ id: "it-sauce", name: "House sauce" }, { id: "it-slaw", name: "Slaw" }];
  const users: Row[] = [{ id: "u-1", name: "Alex" }];

  // ── scale: extra anchor GROUPS (each a distinct instant) ──
  for (let i = 0; i < (scale.parWalks ?? 0); i++) {
    const at = `2026-10-${String(6 + (i % 6)).padStart(2, "0")}T0${i % 10}:1${i % 10}:00+00:00`;
    const id = `pe-x${i}`;
    par_pass_events.push({ id, location_id: LOC, status: "submitted" });
    const sid = `s-xpar-${i}`;
    vendor_items.push(sku(sid, `Extra par ${i}`));
    par_pass_lines.push(pl(id, sid, 10 + i, at));
    vendor_delivery_items.push(di("d3", sid, 5, "2026-10-13T14:00:02+00:00"));
  }
  for (let i = 0; i < (scale.countSessions ?? 0); i++) {
    const id = `e-x${i}`;
    sku_count_events.push({ id, location_id: LOC, counted_at: `2026-10-0${2 + (i % 7)}T1${i % 10}:0${i % 10}:00+00:00`, active: true });
    const sid = `s-xcount-${i}`;
    vendor_items.push(sku(sid, `Extra count ${i}`));
    sku_count_lines.push(line(id, sid, i % 2 === 0 ? "weight" : "count", i % 2 === 0 ? 40 + i : null, i % 2 === 0 ? null : 7 + i));
    sku_pack_levels.push(lvl(`pl-xc-${i}`, sid, "each", 1, null, "each", 1));
    vendor_delivery_items.push(di("d3", sid, 5, "2026-10-13T14:00:02+00:00", "each", 2));
  }
  for (let i = 0; i < (scale.baselineInstants ?? 0); i++) {
    const sid = `s-xinf-${i}`;
    vendor_items.push(sku(sid, `Extra inferred ${i}`));
    sku_inferred_baselines.push({ location_id: LOC, sku_id: sid, inferred_oz: 3 + i, computed_at: `2026-09-${String(20 + i).padStart(2, "0")}T07:00:00+00:00`, basis: {} });
  }

  return {
    vendor_items, vendors, measure_units, sku_pack_levels, products, product_primaries, location_sku_settings,
    sku_count_events, sku_count_lines, par_pass_events, par_pass_lines, sku_inferred_baselines,
    vendor_deliveries, vendor_delivery_items, productions, production_inputs,
    toast_daily_depletion, toast_capture_daily_depletion, toast_sales_events, toast_capture_runs,
    toast_depletion_day_coverage, toast_depletion_item_attribution,
    prep_batch_sessions, items, users, locations: [{ id: LOC, active: true, toast_restaurant_guid: "g1" }],
  };
}

/** The ezCater-reconciled source, modelled per business day (the real loader derives each day independently). */
export interface ReconciledDay { status: "success" | "degraded"; rows: Array<{ sku_id: string; direct_oz: number; flattened_oz: number }> }
export function buildReconciledModel(): { days: Map<string, ReconciledDay>; unresolved: Set<string> } {
  const days = new Map<string, ReconciledDay>();
  for (let t = Date.parse("2026-09-10T12:00:00Z"); t <= Date.parse("2026-10-13T12:00:00Z"); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d === "2026-09-30") continue; // no capture → a missing day
    const i = (t - Date.parse("2026-09-10T12:00:00Z")) / 86_400_000;
    days.set(d, {
      status: d === "2026-10-02" ? "degraded" : "success",
      rows: [
        { sku_id: "s-turkey", direct_oz: 9 + i / 7, flattened_oz: 2 },
        { sku_id: "s-lettuce", direct_oz: 1.25, flattened_oz: 0 },
        { sku_id: "s-pepper", direct_oz: 2 + i / 3, flattened_oz: 0 },
        { sku_id: "s-twin-y", direct_oz: 0.7, flattened_oz: 0 },
        { sku_id: "s-onion", direct_oz: 0.3, flattened_oz: 0 },
        { sku_id: "s-tomato", direct_oz: 0.2, flattened_oz: 0 },
        ...(i % 3 === 0 ? [{ sku_id: "s-cheese", direct_oz: 1.1, flattened_oz: 0 }] : []),
      ],
    });
  }
  return { days, unresolved: new Set(["2026-10-07", "2026-09-30"]) };
}
