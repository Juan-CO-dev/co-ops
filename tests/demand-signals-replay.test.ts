// Item 4 PR 1: the point-in-time replay harness for the three baselines.
// Astra r2 P2 #1: a replay must reproduce EVERY input as of the decision, not only the forecast and a
// fingerprint. So a night's inputs are stored as content-addressed parts under a manifest, and the tests
// below change the live inputs afterwards and replay the earlier night from the store.
import { describe, expect, it } from "vitest";
import { computeParLedger } from "@/lib/dynamic-pars-engine-shared";
import { forecastDay, dayTypeFor, type SalesBaselineResult } from "@/lib/scheduling/demand-shared";
import { resolveLineDefinition, pickOverride, operationalDayOfWeek } from "@/lib/items";
import type { ChecklistTemplateItem } from "@/lib/types";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { addressOf } from "@/lib/demand-signals/hash";
import {
  LABOR_LEADS, NO_SIGNAL, PAR_LEADS, forecastLabor, forecastPars, forecastPrep, laborScoreRows, laborTargetFromDay, parCoverageOz,
  parDailyForecast, parScoreRows, parTargetFromInputs, prepScoreRows, realizedDayType, replayVerdict, restoreParInputs, snapshotLaborInputs,
  snapshotParInputs, snapshotPrepInputs, restoreLaborInputs, restorePrepInputs, evidenceOfReplay,
  type Blob, type CandidateSpec, type LaborInputs, type PrepInputs,
} from "@/lib/demand-signals/replay";
import { buildParInputs, FIX_LOC, FIX_RUN_DATE, sku } from "./helpers/par-engine-fixture";

const DECISION = addDaysEt(FIX_RUN_DATE, 1);
class Store {
  blobs = new Map<string, string>();
  put(bs: Blob[]) { for (const b of bs) if (!this.blobs.has(b.hash)) this.blobs.set(b.hash, b.text); }
  get = (hash: string) => this.blobs.get(hash);
}

describe("pars: a night is stored whole and replays whole", () => {
  it("the stored inputs run the engine to the same rows, byte for byte", () => {
    const inputs = buildParInputs();
    const snap = snapshotParInputs(inputs);
    const store = new Store(); store.put([snap.manifest, ...snap.parts]);
    const restored = restoreParInputs(snap.manifest.hash, store.get);
    expect(JSON.stringify(computeParLedger(restored, "shadow"))).toBe(JSON.stringify(computeParLedger(inputs, "shadow")));
    expect(snapshotParInputs(restored).manifest.hash).toBe(snap.manifest.hash);
  });
  it("one part per window day, a catalog, a guard state: 23 parts and a manifest", () => {
    const snap = snapshotParInputs(buildParInputs());
    expect(snap.parts.map((p) => p.kind).sort()).toEqual([...Array<string>(21).fill("par_day"), "par_catalog", "par_guard"].sort());
    expect(snap.manifest.kind).toBe("manifest");
  });
  it("ORDER CORRECTED AFTER THE DECISION: the replay returns the earlier value", () => {
    const store = new Store();
    const before = buildParInputs();
    const snap = snapshotParInputs(before);
    store.put([snap.manifest, ...snap.parts]);
    const recorded = forecastPars(before, DECISION);
    // Two days later the same window reads differently (orders corrected): every day part has other content.
    const after = buildParInputs({ scale: 1.6 });
    const snapAfter = snapshotParInputs(after);
    store.put([snapAfter.manifest, ...snapAfter.parts]);
    expect(snapAfter.manifest.hash).not.toBe(snap.manifest.hash);
    expect(addressOf(forecastPars(after, DECISION)).hash).not.toBe(addressOf(recorded).hash);
    const replayed = forecastPars(restoreParInputs(snap.manifest.hash, store.get), DECISION);
    expect(addressOf(replayed).hash).toBe(addressOf(recorded).hash);
    expect(replayVerdict({ surface: "pars", manifestHash: snap.manifest.hash, forecastHash: addressOf(recorded).hash, decisionDate: DECISION, engine: recorded.engine }, store.get)).toBe("reproduced");
  });
  it("CONFIG CHANGED AFTER THE DECISION (a par, a pin, a rhythm, a pack, the guard state): the replay is unmoved", () => {
    const store = new Store();
    const before = buildParInputs();
    const snap = snapshotParInputs(before);
    store.put([snap.manifest, ...snap.parts]);
    const recorded = addressOf(forecastPars(before, DECISION)).hash;
    const after = buildParInputs();
    after.skus[0] = { ...after.skus[0]!, globalWeekdayPar: 99, perOrderUnitOz: 12, cushionClass: "frozen" };
    after.overlayBySku.set(sku(2), { weekdayPar: 5, weekendPar: null, activeOverride: null, pinnedWeekdayAt: "2026-10-16T00:00:00.000Z", pinnedWeekendAt: null });
    after.rhythmByVendor.clear();
    after.priorBySlot.clear();
    after.budgetSpentBySlot.add(`${sku(1)}:weekday`);
    after.recipeEditedAt = FIX_RUN_DATE;
    const snapAfter = snapshotParInputs(after);
    store.put([snapAfter.manifest, ...snapAfter.parts]);
    expect(addressOf(forecastPars(after, DECISION)).hash).not.toBe(recorded);
    expect(addressOf(forecastPars(restoreParInputs(snap.manifest.hash, store.get), DECISION)).hash).toBe(recorded);
    // The day parts did not change, so they were not stored twice.
    expect(snapAfter.parts.filter((p) => p.kind === "par_day").every((p) => snap.parts.some((x) => x.hash === p.hash))).toBe(true);
  });
  it("an unchanged day is ONE blob across nights", () => {
    const n1 = snapshotParInputs(buildParInputs());
    const again = snapshotParInputs(buildParInputs());
    expect(again.parts.map((p) => p.hash)).toEqual(n1.parts.map((p) => p.hash));
  });
  it("a missing or altered part is refused by name, never papered over", () => {
    const snap = snapshotParInputs(buildParInputs());
    const store = new Store(); store.put([snap.manifest, ...snap.parts]);
    const day = snap.parts.find((p) => p.kind === "par_day")!;
    const without = (h: string) => (h === day.hash ? undefined : store.get(h));
    expect(() => restoreParInputs(snap.manifest.hash, without)).toThrow("snapshot_part_missing");
    const tampered = (h: string) => (h === day.hash ? day.text.replace(/"salesObserved":(true|false)/, (_m, v: string) => `"salesObserved":${v === "true" ? "false" : "true"}`) : store.get(h));
    expect(() => restoreParInputs(snap.manifest.hash, tampered)).toThrow("snapshot_hash_mismatch");
    const ref = { surface: "pars" as const, manifestHash: snap.manifest.hash, forecastHash: "0".repeat(64), decisionDate: DECISION, engine: forecastPars(buildParInputs(), DECISION).engine };
    expect(replayVerdict(ref, without)).toBe("unresolved");
    expect(replayVerdict(ref, store.get)).toBe("diverged");
    expect(replayVerdict({ ...ref, engine: "pars-v0" }, store.get)).toBe("engine_changed");
  });
  it("only a replay whose inputs are intact supports E2", () => {
    const facts = { featureKnownAtDecision: true, targetFrozen: true };
    expect(evidenceOfReplay("reproduced", facts)).toBe("E2");
    expect(evidenceOfReplay("engine_changed", facts)).toBe("E2");
    expect(evidenceOfReplay("diverged", facts)).toBe("E1");
    expect(evidenceOfReplay("unresolved", facts)).toBe("E1");
    expect(evidenceOfReplay("reproduced", { ...facts, targetFrozen: false })).toBe("E1");
    expect(evidenceOfReplay("reproduced", { ...facts, featureKnownAtDecision: false })).toBe("E0");
  });
});

describe("pars: the forecast, and the candidate arm that differs only by the signal", () => {
  const inputs = buildParInputs({ scale: 1.6, seed: 99 });
  const f = forecastPars(inputs, addDaysEt(inputs.runDateEt, 1));
  it("forecasts each product once (twins share a grain) for leads 0..6", () => {
    expect(PAR_LEADS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const day = parDailyForecast(f, addDaysEt(inputs.runDateEt, 1), []);
    expect(Object.keys(day).length).toBeGreaterThan(5);
    expect(Object.keys(day)).not.toContain(sku(16)); // the twin's demand is the product's, forecast once
    expect(Object.keys(f.silent).sort()).toEqual(expect.arrayContaining(["inventory_only", "no_weight_basis", "product_retired", "thin_history"]));
  });
  it("NO SIGNAL = BYTE-IDENTICAL: the candidate daily ounces and the covered ounces are the engine's own", () => {
    const rows = computeParLedger(inputs, "shadow");
    for (const lead of PAR_LEADS) {
      const date = addDaysEt(f.decisionDate, lead);
      expect(JSON.stringify(parDailyForecast(f, date, [1]))).toBe(JSON.stringify(parDailyForecast(f, date, [])));
    }
    expect(f.coverage.length).toBeGreaterThan(8);
    for (const unit of f.coverage) {
      const row = rows.find((r) => r.sku_id === unit.skuId && r.day_class === unit.dayClass)!;
      expect(parCoverageOz(unit, () => [])).toBe((row.detail as { covered_oz: number }).covered_oz);
      expect(unit.coveredOz).toBe((row.detail as { covered_oz: number }).covered_oz);
    }
  });
  it("a signal moves the demand inside the bounds and never takes the cover under the peak floor", () => {
    let floored = 0;
    for (const unit of f.coverage) {
      const down = parCoverageOz(unit, () => [0.5]);
      const up = parCoverageOz(unit, () => [3]);
      expect(up).toBeGreaterThanOrEqual(unit.coveredOz);
      expect(down).toBeLessThanOrEqual(unit.coveredOz);
      if (unit.peakFloorOz != null) { expect(down).toBeGreaterThanOrEqual(unit.peakFloorOz); floored += 1; }
      // signals x velocity stays inside today's envelope (read without the floor, which is not a signal)
      const unfloored = parCoverageOz({ ...unit, peakFloorOz: null }, () => [3]);
      expect(unfloored).toBeLessThanOrEqual(unit.demandOz * (1 + unit.cushionPct) * (1.25 / unit.velocityRatio) + 1e-4);
    }
    expect(floored).toBeGreaterThan(0);
  });
  it("scores against the frozen target: a covered day with no movement is a true zero, an uncovered day is excluded and counted", () => {
    const later = buildParInputs({ runDate: addDaysEt(inputs.runDateEt, 7), scale: 1.6, seed: 5 });
    const targets = (validDate: string) => {
      const t = parTargetFromInputs(later, validDate);
      if (t === null) return undefined;
      if (t.coverage !== "covered") return "not_covered" as const;
      // one covered day on which nothing moved: every forecast product is a TRUE ZERO that day
      return validDate === addDaysEt(f.decisionDate, 2) ? { ...t.payload!, oz: {}, skuOz: {} } : t.payload!;
    };
    const rows = parScoreRows("shop", f, targets, NO_SIGNAL);
    expect(new Set(rows.map((r) => r.leadDays))).toEqual(new Set(PAR_LEADS));
    expect(rows.every((r) => r.baseline === r.candidate && r.episodeId === null && r.target === "par_product_day_oz")).toBe(true);
    const gapDate = later.window.find((d) => !d.salesObserved && !d.productionObserved && d.dateEt >= f.decisionDate)?.dateEt;
    expect(gapDate).toBeDefined();
    expect(rows.filter((r) => r.validDate === gapDate).every((r) => r.actual === null)).toBe(true);
    expect(rows.some((r) => r.actual === 0)).toBe(true);
    expect(parTargetFromInputs(later, addDaysEt(later.runDateEt, 1))).toBeNull(); // outside the window: not frozen, not zero
    const cand: CandidateSpec = { signalsFor: () => [1.1], episodeFor: (d) => `trend_up:${d}` };
    const moved = parScoreRows("shop", f, targets, cand);
    expect(moved.every((r) => r.episodeId !== null)).toBe(true);
    expect(moved.some((r) => r.candidate !== null && r.baseline !== null && r.candidate > r.baseline)).toBe(true);
  });
  it("a SKU deactivated between the forecast and D+4 keeps its usage in the target (review r1 #1)", () => {
    // The freeze reads a LATER night. Its par'd universe has lost a SKU the forecast spoke for; the lanes still hold what it used.
    const later = buildParInputs({ runDate: addDaysEt(inputs.runDateEt, 7), seed: 5 });
    const lookup = (night: typeof later) => (validDate: string) => {
      const t = parTargetFromInputs(night, validDate);
      return t === null ? undefined : t.coverage === "covered" ? t.payload! : "not_covered" as const;
    };
    const full = parScoreRows("shop", f, lookup(later), NO_SIGNAL);
    let moved = 0;
    for (const grainKey of Object.keys(f.terms)) {
      const gone = f.terms[grainKey]!.skuId;
      const deactivated = { ...later, skus: later.skus.filter((s) => s.grainKey !== grainKey) };
      expect(deactivated.skus.some((s) => s.skuId === gone)).toBe(false);
      const want = full.filter((r) => r.unitKey === grainKey);
      const got = parScoreRows("shop", f, lookup(deactivated), NO_SIGNAL).filter((r) => r.unitKey === grainKey);
      expect(got.map((r) => r.actual)).toEqual(want.map((r) => r.actual));
      for (const r of got) {
        if (r.actual === null) continue;
        const used = (later.directOzByDate.get(r.validDate)?.get(gone) ?? 0) + (later.productionOzByDate.get(r.validDate)?.get(gone) ?? 0);
        expect(r.actual).toBeCloseTo(used, 6);
        if (used > 0) moved += 1;
      }
    }
    expect(moved).toBeGreaterThan(20);
    // The frozen payload itself does not depend on tonight's par'd universe for what a SKU used.
    const day = addDaysEt(f.decisionDate, 1);
    const none = parTargetFromInputs({ ...later, skus: [] }, day)!;
    expect(none.payload!.skuOz).toEqual(parTargetFromInputs(later, day)!.payload!.skuOz);
    expect(Object.keys(none.payload!.skuOz).length).toBeGreaterThan(10);
  });
});

describe("labor: forecastDay + dayTypeFor, replayed", () => {
  const AS_OF = "2026-10-15";
  const hours = [] as Array<{ dow: number; hour: number; cents: number }>;
  const capturedDays: string[] = [];
  for (let i = 1; i <= 28; i += 1) {
    const d = addDaysEt(AS_OF, -i);
    if (i === 9) continue;
    capturedDays.push(d);
    const dow = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    for (const hour of [11, 12, 13, 18]) hours.push({ dow, hour, cents: 60_000 + dow * 9_000 + hour * 500 + i * 37 });
  }
  const baseline: SalesBaselineResult = { kind: "ok", raw: { hours, capturedDays } };
  const inputs: LaborInputs = { v: 1, locationId: FIX_LOC, asOf: AS_OF, baseline, structureId: "s1",
    dayTypes: { slowBelowCents: 400_000, busyAboveCents: 480_000, weekendIsoDows: [6, 7] },
    overrides: [{ id: "o1", date: "2026-10-16", dayType: "busy" }, { id: "o2", date: "2026-10-19", dayType: "auto" }] };

  it("is the scheduler's own forecast and day type for every lead 0..11", () => {
    expect(LABOR_LEADS).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const f = forecastLabor(inputs, NO_SIGNAL);
    expect(f.days.map((d) => d.leadDays)).toEqual([...LABOR_LEADS]);
    for (const day of f.days) {
      const direct = forecastDay(baseline, day.date, AS_OF);
      const type = dayTypeFor(day.date, { override: inputs.overrides.find((o) => o.date === day.date) ?? null, structure: { dayTypes: inputs.dayTypes }, forecast: direct });
      expect(day.kind).toBe(direct.kind);
      if (direct.kind === "ok") { expect(day.hourlyCents).toEqual(direct.hourlyCents); expect(day.dayCents).toBe(direct.dayCents); }
      expect(day.dayType).toBe(type.dayType);
      expect(day.dayTypeSource).toBe(type.source);
    }
    expect(f.days.find((d) => d.date === "2026-10-16")!.dayTypeSource).toBe("override");
    expect(f.days.find((d) => d.date === "2026-10-17")!.dayType).toBe("weekend");
  });
  it("stores and restores to the same forecast; a later baseline does not move the stored night", () => {
    const blob = snapshotLaborInputs(inputs);
    const get = (h: string) => (h === blob.hash ? blob.text : undefined);
    expect(addressOf(forecastLabor(restoreLaborInputs(blob.hash, get), NO_SIGNAL)).hash).toBe(addressOf(forecastLabor(inputs, NO_SIGNAL)).hash);
    const revised: LaborInputs = { ...inputs, baseline: { kind: "ok", raw: { hours: hours.map((h) => ({ ...h, cents: h.cents + 5_000 })), capturedDays } } };
    expect(snapshotLaborInputs(revised).hash).not.toBe(blob.hash);
    expect(replayVerdict({ surface: "labor", manifestHash: blob.hash, forecastHash: addressOf(forecastLabor(inputs, NO_SIGNAL)).hash, decisionDate: AS_OF, engine: forecastLabor(inputs, NO_SIGNAL).engine }, get)).toBe("reproduced");
  });
  it("an unavailable baseline is recorded as unavailable and scores nothing (never a flat curve, never zero)", () => {
    const f = forecastLabor({ ...inputs, baseline: { kind: "unavailable", cause: "timeout" } }, NO_SIGNAL);
    expect(f.days.every((d) => d.kind === "unavailable" && d.dayCents === null)).toBe(true);
    const rows = laborScoreRows("shop", f, inputs, () => ({ v: 1, target: "labor_sales_day", locationId: FIX_LOC, validDate: "x", hourlyCents: new Array<number>(24).fill(10), dayCents: 240, unknownCents: 0 }), NO_SIGNAL);
    expect(rows.day.every((r) => r.baseline === null)).toBe(true);
  });
  it("the candidate multiplies the hourly dollars; the manager's override still wins the day type", () => {
    const cand: CandidateSpec = { signalsFor: () => [1.15], episodeFor: (d) => `holiday:${d}` };
    const base = forecastLabor(inputs, NO_SIGNAL), up = forecastLabor(inputs, cand);
    const b = base.days.find((d) => d.date === "2026-10-20")!, u = up.days.find((d) => d.date === "2026-10-20")!;
    expect(u.hourlyCents).toEqual(b.hourlyCents!.map((c) => Math.round(c * 1.15)));
    expect(u.dayCents).toBe(u.hourlyCents!.reduce((x, y) => x + y, 0));
    expect(up.days.find((d) => d.date === "2026-10-16")!.dayType).toBe("busy");
    expect(JSON.stringify(forecastLabor(inputs, { signalsFor: () => [], episodeFor: () => null }))).toBe(JSON.stringify(base));
  });
  it("scores day dollars, service-hour dollars and the class call; an uncaptured day is excluded", () => {
    const f = forecastLabor(inputs, NO_SIGNAL);
    const target = (validDate: string) => {
      if (validDate === "2026-10-18") return "not_covered" as const;
      if (validDate > "2026-10-21") return undefined;
      const cells = [11, 12, 13, 18].map((hour) => ({ dow: 0, hour, cents: 100_000 }));
      return laborTargetFromDay(FIX_LOC, validDate, cells.map((c) => ({ ...c, dow: ((new Date(`${validDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1 })), [validDate]).payload!;
    };
    const rows = laborScoreRows("shop", f, inputs, target, NO_SIGNAL);
    expect(rows.day.map((r) => r.validDate)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(rows.day.find((r) => r.validDate === "2026-10-18")!.actual).toBeNull();
    expect(rows.day.find((r) => r.validDate === "2026-10-19")!.actual).toBe(400_000);
    expect(rows.hour.filter((r) => r.validDate === "2026-10-19").length).toBe(24);
    expect(rows.classCalls.find((c) => c.validDate === "2026-10-17")).toMatchObject({ forecast: "weekend", actual: "weekend" });
    expect(realizedDayType("2026-10-19", inputs.dayTypes, 400_000)).toBe("normal");
    expect(realizedDayType("2026-10-19", inputs.dayTypes, 399_999)).toBe("slow");
    expect(laborTargetFromDay(FIX_LOC, "2026-10-19", [], []).coverage).toBe("not_covered");
  });
});

describe("prep: the static par, replayed (baseline score only)", () => {
  const inputs: PrepInputs = { v: 1, locationId: FIX_LOC, items: [
    { itemId: "item-b", defaultPar: 6, defaultParUnit: "qt", active: true, parRows: [{ dayOfWeek: null, parValue: 8, parUnit: null, parMode: "manual" }, { dayOfWeek: 5, parValue: 12, parUnit: null, parMode: "manual" }] },
    { itemId: "item-a", defaultPar: 4, defaultParUnit: "each", active: true, parRows: [] },
    { itemId: "item-c", defaultPar: 9, defaultParUnit: "qt", active: false, parRows: [] },
    { itemId: "item-d", defaultPar: null, defaultParUnit: null, active: true, parRows: [] },
  ] };
  it("is the checklist's own number: the manual override for the day, else the default par", () => {
    const f = forecastPrep(inputs, "2026-10-15");
    expect(f.days.length).toBe(7);
    const fri = f.days.find((d) => d.date === "2026-10-16")!;
    expect(fri.par).toEqual({ "item-a": 4, "item-b": 12 });
    expect(f.days.find((d) => d.date === "2026-10-15")!.par).toEqual({ "item-a": 4, "item-b": 8 });
    const line = { id: "l", label: "x", itemId: "item-b", prepMeta: null, translations: null } as unknown as ChecklistTemplateItem;
    for (const day of f.days) {
      const item = inputs.items[0]!;
      const viaChecklist = resolveLineDefinition(line, { name: "x", nameEs: null, defaultPar: item.defaultPar, defaultParUnit: item.defaultParUnit, active: true }, pickOverride(item.parRows, operationalDayOfWeek(day.date)));
      expect(day.par["item-b"]).toBe(viaChecklist.par);
    }
  });
  it("round-trips through the store and scores as a baseline only", () => {
    const blob = snapshotPrepInputs(inputs);
    const restored = restorePrepInputs(blob.hash, (h) => (h === blob.hash ? blob.text : undefined));
    expect(addressOf(forecastPrep(restored, "2026-10-15")).hash).toBe(addressOf(forecastPrep(inputs, "2026-10-15")).hash);
    const rows = prepScoreRows("shop", forecastPrep(inputs, "2026-10-15"), (d) => (d === "2026-10-15" ? { v: 1, target: "prep_item_day_units", locationId: FIX_LOC, validDate: d, units: { "item-a": 5 } } : d === "2026-10-16" ? "not_covered" : undefined));
    expect(rows.map((r) => [r.validDate, r.unitKey, r.baseline, r.candidate, r.actual])).toEqual([
      ["2026-10-15", "item-a", 4, 4, 5], ["2026-10-15", "item-b", 8, 8, null], ["2026-10-16", "item-a", 4, 4, null], ["2026-10-16", "item-b", 12, 12, null]]);
  });
});
