/**
 * Scheduling Phase 1, Task 22 — the PM v2 criteria: the confirmed seed DATA, the seed plan and script, the
 * Tier E editor's lib and its UI.
 *
 * - docs/seed/pm-criteria-2026-10-15.json IS the plan's "Confirmed by Juan 2026-10-15" table, verbatim (parsed
 *   from the plan here), incl. the Walk-ins guest line FIRST on both Walk-ins rows and "Helps walk-ins when
 *   there are no 3rd-party orders" LAST on 3rd Party Station; nothing in the code holds a criterion;
 * - the seed plan matches positions by EXACT name to usable positions, prints every match, refuses on any
 *   missing / ambiguous / retired name (no inserts at all), and is idempotent;
 * - the seed script STARTS with no database (no server-only import), is a dry run unless --apply, and --apply
 *   needs --shop and --actor; it was never run against a database;
 * - the editor lib: GM own shop / MoO+ (refused before any I/O), a usable position of THIS shop, labels en +
 *   es, rename / deactivate / reorder audited before/after, never a delete;
 * - the editor UI: "Every position" first, English and Spanish side by side, a dirty draft holds its section
 *   open (D10), 44 px controls, en + es keys.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import seed from "../docs/seed/pm-criteria-2026-10-15.json";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { audit } = await import("@/lib/audit");
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { PmCriteriaEditor } = await import("@/components/pm-report-v2/PmCriteriaEditor");
const lib = await import("@/lib/pm-criteria");
const { planPmCriteriaSeed, seedFileProblem, pmCriterionLabelProblem, criteriaEditorGroups } = await import("@/lib/pm-criteria-shared");
const { parseSeedArgs } = await import("../scripts/seed-pm-criteria");

// ─── the confirmed table, parsed from the plan ───────────────────────────────
function confirmedTable(): Map<string, Array<{ en: string; es: string }>> {
  const plan = readFileSync("docs/superpowers/plans/2026-10-15-scheduling-phase1-BUILD.md", "utf8");
  const start = plan.indexOf("## PM criteria per position — Confirmed by Juan 2026-10-15");
  const section = plan.slice(start, plan.indexOf("\n---", start));
  const out = new Map<string, Array<{ en: string; es: string }>>();
  for (const line of section.split("\n")) {
    const m = /^\| \*\*(.+?)\*\* \| (.+) \|$/.exec(line);
    if (!m) continue;
    const items = m[2]!.split(" · ").map((pair) => {
      const clean = pair.replace(/\*\*/g, "");
      const i = clean.lastIndexOf(" / ");
      return { en: clean.slice(0, i).trim(), es: clean.slice(i + 3).trim() };
    });
    out.set(m[1]!, items);
  }
  return out;
}

describe("the seed DATA is the confirmed table, verbatim", () => {
  it("every position and every criterion, in order, en and es", () => {
    const table = confirmedTable();
    expect(table.size).toBe(9);
    expect(seed.shared).toEqual(table.get("Every position (shared)"));
    for (const p of seed.positions) expect(p.criteria, p.position).toEqual(table.get(p.position));
    expect(seed.positions.map((p) => p.position).sort()).toEqual([...table.keys()].filter((k) => k !== "Every position (shared)").sort());
    expect(seedFileProblem(seed)).toBeNull();
  });
  it("Juan's edits: the guest line FIRST on both Walk-ins rows; helps walk-ins LAST on 3rd Party; none guest-facing on Expeditor or 3rd Party", () => {
    const by = (name: string) => seed.positions.find((p) => p.position === name)!.criteria.map((c) => c.en);
    const guest = "Greets guests promptly and takes the order in a welcoming way";
    expect(by("Walk-ins")[0]).toBe(guest);
    expect(by("Walk-ins / Online")[0]).toBe(guest);
    expect(by("3rd Party Station").at(-1)).toBe("Helps walk-ins when there are no 3rd-party orders");
    for (const p of ["Expeditor", "3rd Party Station"]) expect(by(p).some((c) => /greet/i.test(c)), p).toBe(false);
  });
  it("criteria are DATA: no label of the seed appears in app or lib code", () => {
    const code = ["lib/pm-report-v2.ts", "lib/pm-report-v2-shared.ts", "lib/pm-criteria.ts", "lib/pm-criteria-shared.ts", "components/pm-report-v2/PmCopyForm.tsx", "components/pm-report-v2/PmCriteriaEditor.tsx"]
      .map((f) => readFileSync(f, "utf8")).join("\n");
    for (const label of ["Ticket accuracy", "Greets guests promptly", "Arrived ready", "Dishes kept up"]) expect(code).not.toContain(label);
  });
});

// ─── the seed plan ───────────────────────────────────────────────────────────
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function shopFixture(loc: string, opts: { withoutPrep?: boolean; duplicateExpo?: boolean; retiredStationFor?: string } = {}) {
  const stations = [{ id: `${loc}-st`, location_id: loc, name: "Line", active: true }, { id: `${loc}-off`, location_id: loc, name: "Old line", active: false }];
  const names = seed.positions.map((p) => p.position).filter((n) => !(opts.withoutPrep && n === "Prep"));
  const positions = names.map((name, i) => ({ id: `${loc}-p${i}`, station_id: opts.retiredStationFor === name ? `${loc}-off` : `${loc}-st`, location_id: loc, name, active: true }));
  if (opts.duplicateExpo) positions.push({ id: `${loc}-dup`, station_id: `${loc}-st`, location_id: loc, name: "Expeditor", active: true });
  return { stations, positions };
}
describe("the seed plan", () => {
  const total = seed.shared.length + seed.positions.reduce((s, p) => s + p.criteria.length, 0);
  it("a complete shop is READY: every match printed, shared + every position's criteria in the confirmed order", () => {
    const a = shopFixture(A);
    const plan = planPmCriteriaSeed(seed, [{ id: A, name: "Capitol Hill", active: true }], a.stations, a.positions, []);
    expect(plan.ready).toBe(true);
    expect(plan.shops[0]!.matches.every((m) => m.state === "ok" && m.station === "Line")).toBe(true);
    expect(plan.shops[0]!.inserts).toHaveLength(total);
    expect(total).toBe(35);
    const walk = plan.shops[0]!.inserts.filter((r) => r.position_id === `${A}-p2`);
    expect(walk.map((r) => [r.sort, r.label])[0]).toEqual([10, "Greets guests promptly and takes the order in a welcoming way"]);
    expect(plan.shops[0]!.inserts.filter((r) => r.position_id === null).map((r) => r.label)).toEqual(["Arrived ready (on time, in uniform)", "Teamwork and attitude"]);
  });
  it("REFUSES on a missing, an ambiguous or a retired-station name: NOT READY and nothing to insert — never a guess", () => {
    for (const [opts, state] of [[{ withoutPrep: true }, "missing"], [{ duplicateExpo: true }, "ambiguous"], [{ retiredStationFor: "Prep/Dishwasher" }, "inactive"]] as const) {
      const a = shopFixture(A, opts);
      const plan = planPmCriteriaSeed(seed, [{ id: A, name: "Capitol Hill", active: true }], a.stations, a.positions, []);
      expect(plan.ready, state).toBe(false);
      expect(plan.shops[0]!.inserts, state).toEqual([]);
      expect(plan.shops[0]!.matches.some((m) => m.state === state), state).toBe(true);
    }
  });
  it("one shop not ready makes the whole plan not ready (the other shop is still printed)", () => {
    const a = shopFixture(A), b = shopFixture(B, { withoutPrep: true });
    const plan = planPmCriteriaSeed(seed, [{ id: A, name: "Capitol Hill", active: true }, { id: B, name: "P Street", active: true }], [...a.stations, ...b.stations], [...a.positions, ...b.positions], []);
    expect(plan.ready).toBe(false);
    expect(plan.shops.map((s) => s.ready)).toEqual([true, false]);
  });
  it("idempotent: re-running over the seeded rows inserts nothing", () => {
    const a = shopFixture(A);
    const first = planPmCriteriaSeed(seed, [{ id: A, name: "Capitol Hill", active: true }], a.stations, a.positions, []);
    const existing = first.shops[0]!.inserts.map((r) => ({ location_id: r.location_id, position_id: r.position_id, label: r.label, active: true }));
    const again = planPmCriteriaSeed(seed, [{ id: A, name: "Capitol Hill", active: true }], a.stations, a.positions, existing);
    expect(again.shops[0]!.inserts).toEqual([]);
    expect(again.shops[0]!.skipped).toBe(35);
  });
});

describe("the seed script — dry run by default, never run against a database", () => {
  it("arguments: --apply needs --shop and --actor; unknown or malformed arguments are refused", () => {
    expect(parseSeedArgs([])).toEqual({ apply: false, shop: null, actor: null });
    expect(parseSeedArgs(["--apply"])).toEqual({ error: "--apply needs --shop <location id> and --actor <user id>" });
    expect(parseSeedArgs(["--shop", "x"])).toEqual({ error: "--shop needs a uuid" });
    expect(parseSeedArgs(["--force"])).toEqual({ error: "unknown argument --force" });
    expect(parseSeedArgs(["--shop", A, "--actor", B, "--apply"])).toEqual({ apply: true, shop: A, actor: B });
  });
  it("STARTS with no database (no server-only import): no credentials → exit 2, nothing read", () => {
    const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" };
    const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-pm-criteria.ts"], { encoding: "utf8", env, timeout: 60_000 });
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/server-only|cannot be imported from a Client Component/i);
    expect(r.stderr).toContain("must be set");
    expect(r.status).toBe(2);
  }, 70_000);
  it("source: pathToFileURL guard, no supabase-server, writes only pm_criteria + audit_log inserts, actor_context seed_pm_criteria, no shop codes", () => {
    const src = readFileSync("scripts/seed-pm-criteria.ts", "utf8");
    expect(src).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    expect(src).not.toMatch(/(from\s+|import\(\s*)["'][^"']*supabase-server["']/);
    expect(src).not.toMatch(/\.(update|upsert|delete|rpc)\(/);
    expect([...src.matchAll(/\.from\("([a-z_]+)"\)\.insert/g)].map((m) => m[1]).sort()).toEqual(["audit_log", "pm_criteria"]);
    expect(src).toContain('actor_context: "seed_pm_criteria"');
    expect(src).not.toMatch(/["'](EM|MEP)["']/);
  });
});

// ─── the editor lib ──────────────────────────────────────────────────────────
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GM = id(1), AGM = id(2), SMM = id(3), MOO = id(4), GM_B = id(5);
const ST = id(11), ST_OFF = id(12), P_EXPO = id(21), P_OFF = id(22), P_B = id(23), C1 = id(31), C2 = id(32), C3 = id(33);
const actor = (userId: string, role: "gm" | "agm" | "social_media_mgr" | "moo", level: number, locations = [A]) => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7), agm = actor(AGM, "agm", 6), smm = actor(SMM, "social_media_mgr", 6), moo = actor(MOO, "moo", 8, []), gmB = actor(GM_B, "gm", 7, [B]);
function tables(): Tables {
  return {
    stations: [{ id: ST, location_id: A, active: true, sort: 1 }, { id: ST_OFF, location_id: A, active: false, sort: 2 }, { id: "stb", location_id: B, active: true, sort: 1 }],
    station_positions: [
      { id: P_EXPO, station_id: ST, location_id: A, name: "Expeditor", name_es: "Expedidor", sort: 1, active: true },
      { id: P_OFF, station_id: ST_OFF, location_id: A, name: "Prep", name_es: "Prep", sort: 1, active: true },
      { id: P_B, station_id: "stb", location_id: B, name: "Expeditor", name_es: null, sort: 1, active: true },
    ],
    pm_criteria: [
      { id: C1, location_id: A, position_id: null, label: "Arrived ready", label_es: "Llegó listo", sort: 10, active: true },
      { id: C2, location_id: A, position_id: P_EXPO, label: "Ticket accuracy", label_es: null, sort: 10, active: true },
      { id: C3, location_id: A, position_id: P_EXPO, label: "Pace", label_es: "Ritmo", sort: 20, active: true },
    ],
  };
}
let db: ReturnType<typeof createFakeDb>;
const service = () => db.client as never;
beforeEach(() => { db = createFakeDb(tables()); vi.mocked(audit).mockClear(); });

describe("the editor lib", () => {
  it("GM own shop / MoO any; the AGM, the SMM and another shop's GM are refused BEFORE any I/O", async () => {
    for (const a of [agm, smm, gmB]) {
      await expect(lib.loadCriteriaEditor(service(), { actor: a, locationId: A })).rejects.toMatchObject({ status: 403, code: "forbidden" });
      await expect(lib.createCriterion(service(), { actor: a, locationId: A, positionId: null, label: "x", labelEs: null })).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(db.log).toHaveLength(0);
    expect((await lib.loadCriteriaEditor(service(), { actor: moo, locationId: A })).groups.length).toBeGreaterThan(0);
  });
  it("the editor view: \"Every position\" first, then each USABLE position (a position on a deactivated station is not offered)", async () => {
    const v = await lib.loadCriteriaEditor(service(), { actor: gm, locationId: A });
    expect(v.groups.map((g) => g.positionId)).toEqual([null, P_EXPO]);
    expect(v.groups[1]!.criteria.map((c) => c.label)).toEqual(["Ticket accuracy", "Pace"]);
  });
  it("create: labels 1..80, a usable position of THIS shop, sort = last + 10, audited", async () => {
    await expect(lib.createCriterion(service(), { actor: gm, locationId: A, positionId: P_EXPO, label: "  ", labelEs: null })).rejects.toMatchObject({ code: "invalid_label" });
    await expect(lib.createCriterion(service(), { actor: gm, locationId: A, positionId: P_EXPO, label: "x".repeat(81), labelEs: null })).rejects.toMatchObject({ code: "invalid_label" });
    await expect(lib.createCriterion(service(), { actor: gm, locationId: A, positionId: P_B, label: "Speed", labelEs: null })).rejects.toMatchObject({ code: "position_not_at_shop" });
    await expect(lib.createCriterion(service(), { actor: gm, locationId: A, positionId: P_OFF, label: "Speed", labelEs: null })).rejects.toMatchObject({ code: "position_retired" });
    await lib.createCriterion(service(), { actor: gm, locationId: A, positionId: P_EXPO, label: " Bags checked ", labelEs: " Bolsas " });
    expect(db.writes.find((w) => w.table === "pm_criteria")!.rows[0]).toMatchObject({ location_id: A, position_id: P_EXPO, label: "Bags checked", label_es: "Bolsas", sort: 30, created_by: GM });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "pm_criteria.create", metadata: { location_id: A, before: null, after: { label: "Bags checked", sort: 30 } } });
  });
  it("rename (en + es) and deactivate: audited before/after; another shop's criterion is not found; never a delete", async () => {
    await lib.updateCriterion(service(), { actor: gm, locationId: A, criterionId: C2, label: "Ticket accuracy (right items)", labelEs: "Precisión de tickets" });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "pm_criteria.update", metadata: { before: { label: "Ticket accuracy", label_es: null }, after: { label: "Ticket accuracy (right items)", label_es: "Precisión de tickets" } } });
    await lib.updateCriterion(service(), { actor: gm, locationId: A, criterionId: C3, active: false });
    expect(db.writes.filter((w) => w.table === "pm_criteria").at(-1)!.rows[0]).toMatchObject({ id: C3, active: false, updated_by: GM });
    expect(vi.mocked(audit).mock.calls[1]![0]).toMatchObject({ metadata: { before: { active: true }, after: { active: false } } });
    await expect(lib.updateCriterion(service(), { actor: gmB, locationId: B, criterionId: C3, active: false })).rejects.toMatchObject({ code: "not_found" });
    expect(readFileSync("lib/pm-criteria.ts", "utf8")).not.toMatch(/\.delete\(/);
  });
  it("move: swaps the sort with the neighbour (both audited); the first cannot move up", async () => {
    await lib.moveCriterion(service(), { actor: gm, locationId: A, criterionId: C3, direction: "up" });
    const updates = db.writes.filter((w) => w.table === "pm_criteria").map((w) => w.rows[0]);
    expect(updates.map((r) => [r!.id, r!.sort])).toEqual([[C3, 10], [C2, 20]]);
    expect(vi.mocked(audit)).toHaveBeenCalledTimes(2);
    vi.mocked(audit).mockClear();
    db = createFakeDb(tables());
    await lib.moveCriterion(service(), { actor: gm, locationId: A, criterionId: C2, direction: "up" });
    expect(audit).not.toHaveBeenCalled();
  });
  it("the label rule twins the 0271 CHECK", () => {
    expect(pmCriterionLabelProblem("ok", null)).toBeNull();
    expect(pmCriterionLabelProblem("x".repeat(80), "y".repeat(80))).toBeNull();
    expect(pmCriterionLabelProblem("x".repeat(81), null)).toBe("invalid_label");
    expect(pmCriterionLabelProblem("ok", "y".repeat(81))).toBe("invalid_label");
    const sql = readFileSync("supabase/migrations/0271_pm_reports_v2.sql", "utf8");
    expect(sql).toContain("check (char_length(btrim(label)) between 1 and 80)");
  });
});

// ─── the editor UI ───────────────────────────────────────────────────────────
describe("the editor UI", () => {
  const view = {
    locationId: A,
    groups: criteriaEditorGroups([{ positionId: P_EXPO, name: "Expeditor", nameEs: "Expedidor" }], [
      { id: C1, position_id: null, label: "Arrived ready", label_es: "Llegó listo", sort: 10, active: true },
      { id: C2, position_id: P_EXPO, label: "Ticket accuracy", label_es: null, sort: 10, active: true },
      { id: C3, position_id: P_EXPO, label: "Old line", label_es: null, sort: 5, active: false },
    ]),
  };
  const render = (node: ReturnType<typeof createElement>, language: "en" | "es" = "en") => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language,
    children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, children: node }) }));
  it("\"Every position\" first; English and Spanish side by side; deactivated listed last and marked", () => {
    const html = render(createElement(PmCriteriaEditor, { view, initiallyOpen: true }));
    expect(html.indexOf(en["pmCriteria.everyPosition"])).toBeLessThan(html.indexOf("Expeditor"));
    expect(html).toContain(en["pmCriteria.labelEn"]);
    expect(html).toContain(en["pmCriteria.labelEs"]);
    expect(html.indexOf("Ticket accuracy")).toBeLessThan(html.indexOf("Old line"));
    expect(html).toContain(en["pmCriteria.inactive"]);
    expect(html).toContain(en["pmCriteria.reactivate"]);
    expect(render(createElement(PmCriteriaEditor, { view, initiallyOpen: true }), "es")).toContain("Todos los puestos");
  });
  it("collapsed by default (D8); a dirty draft holds its section open with Unsaved changes (D10)", () => {
    const clean = render(createElement(PmCriteriaEditor, { view }));
    expect(clean).not.toContain("Ticket accuracy");
    const dirty = render(createElement(PmCriteriaEditor, { view, initiallyDirty: [P_EXPO] }));
    expect(dirty).toContain("Ticket accuracy");
    expect(dirty).toContain(en["pmCriteria.unsaved"]);
  });
  it("44 px buttons with items-center; en + es parity for pmCriteria.*; the hub card and the Tier E pins", async () => {
    const html = render(createElement(PmCriteriaEditor, { view, initiallyOpen: true }));
    for (const b of html.match(/<button[^>]*>/g) ?? []) { expect(b).toContain("min-h-[44px]"); expect(b).toContain("items-center"); }
    expect(Object.keys(es).filter((k) => k.startsWith("pmCriteria.")).sort()).toEqual(Object.keys(en).filter((k) => k.startsWith("pmCriteria.")).sort());
    const { adminSectionsFor } = await import("@/lib/admin/sections");
    expect(adminSectionsFor(7, "gm").some((s) => s.id === "pm-criteria" && s.href === "/admin/pm-criteria")).toBe(true);
    expect(adminSectionsFor(6, "agm").some((s) => s.id === "pm-criteria")).toBe(false);
    expect(adminSectionsFor(6, "social_media_mgr").some((s) => s.id === "pm-criteria")).toBe(false);
    expect(readFileSync("app/api/pm-criteria/route.ts", "utf8")).toContain('assertStepUp(ctx, "E")');
    expect(readFileSync("components/pm-report-v2/PmCriteriaEditor.tsx", "utf8")).toContain('requestStepUp("E")');
  });
});
