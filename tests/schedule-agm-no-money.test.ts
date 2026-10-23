/**
 * Scheduling Phase 2, chunk G (CC's answer 2, 2026-10-16) — the AGM labor card is OK only if NO figure the AGM receives
 * can reconstruct a dollar amount or a wage. This audits the SERIALIZED payloads the AGM's pages receive, through the
 * real loaders over the in-memory PostgREST fake (tests/fixtures/schedule/lib-store), with the shop's wage estimates SET:
 *  - the board (`loadBoard`), with `agm_access` read AND edit, after a GM built the week;
 *  - the settings page (`loadScheduleSettings`), read AND edit.
 * No key that carries money or a wage, no exact labor-card spread / demand share / max hours (with a sales figure those
 * give the blended wage), and no number equal to a wage or a salaried cost on file.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const lib = await import("@/lib/scheduling/schedules");
const { loadBoard } = await import("@/lib/scheduling/board");
const { loadScheduleSettings } = await import("@/lib/scheduling/settings-view");
import type { PeopleActor } from "@/lib/people/access-shared";
import { A, AGM, GM, scheduleStore, shopTables } from "./fixtures/schedule/lib-store";

const NOW = new Date("2026-10-21T16:00:00Z");
const WEEK = "2026-10-26";
const actor = (userId: string, role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId, role, level, locations });
const gm = actor(GM, "gm", 7, [A]);
const agm = actor(AGM, "agm", 6, [A]);
const HOURLY = 1800;
const SALARIED = 120000;

function shop(access: "read" | "edit") {
  const t = shopTables();
  t.schedule_shop_settings![0]!.agm_access = access;
  t.schedule_shop_settings![0]!.estimated_hourly_cents = HOURLY;
  t.schedule_shop_settings![0]!.estimated_salaried_weekly_cents = SALARIED;
  const s = scheduleStore(t);
  return { ...s, deps: { service: s.client, now: NOW, newId: s.newId } };
}

/** Keys that carry money, a wage, or an exact labor-card figure that would derive one. */
const MONEY_KEY = /"([^"]*(?:[Cc]ents|[Ww]age|[Ss]alaried(?:Weekly|Day|Fixed)|spreadHeads|demandShare|maxHours|hourlyCost|[Pp]ct|money|budgetCost))"\s*:/g;
/** A policy percentage (the labor target, e.g. 28) is not money. */
const ALLOWED = new Set(["targetPct"]);

function moneyKeys(payload: unknown): string[] {
  const json = JSON.stringify(payload);
  return [...json.matchAll(MONEY_KEY)].map((m) => m[1]!).filter((k) => !ALLOWED.has(k));
}
function numbers(payload: unknown, out: number[] = []): number[] {
  if (typeof payload === "number") out.push(payload);
  else if (Array.isArray(payload)) for (const x of payload) numbers(x, out);
  else if (payload && typeof payload === "object") for (const v of Object.values(payload)) numbers(v, out);
  return out;
}

describe("the AGM's board view-model over a week WITH a sales forecast (the labor card computes)", () => {
  it("boardView for a viewer without money: the card's windows carry heads only", async () => {
    const { boardView } = await import("@/lib/scheduling/board-view-shared");
    const { boardSource } = await import("./fixtures/schedule/board-source");
    const src = boardSource({ perms: { canSeeMoney: false, canApprove: false, canEditStructure: false, canBudget: false } });
    const view = boardView(src);
    expect(view.days.some((d) => d.labor?.state === "ok" && d.labor.windows.length > 0)).toBe(true);
    expect(moneyKeys(view)).toEqual([]);
    const wages = new Set(Object.values(src.wageCentsByUser).filter((w): w is number => typeof w === "number"));
    for (const n of numbers(view)) expect(wages.has(n) && n > 100, `wage ${n} in the AGM view`).toBe(false);
  });
});

describe("the AGM's payloads carry nothing money-derivable", () => {
  for (const access of ["read", "edit"] as const) {
    it(`the board (agm_access = ${access}): no money key, no exact labor figure, no wage or salaried number`, async () => {
      const s = shop(access);
      await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
      const v = await loadBoard(s.deps, { actor: agm, locationId: A, weekStart: WEEK });
      expect(v.state).toBe("ready");
      expect(moneyKeys(v)).toEqual([]);
      const nums = numbers(v);
      expect(nums).not.toContain(HOURLY);
      expect(nums).not.toContain(SALARIED);
      // The GM's view of the same week DOES carry money (the audit is not vacuous).
      const g = await loadBoard(s.deps, { actor: gm, locationId: A, weekStart: WEEK });
      expect(moneyKeys(g).length).toBeGreaterThan(0);
    });

    it(`the settings page (agm_access = ${access}): no money key, no wage or salaried number`, async () => {
      const s = shop(access);
      const v = await loadScheduleSettings(s.deps, { actor: agm, locationId: A });
      expect(moneyKeys(v)).toEqual([]);
      const nums = numbers(v);
      expect(nums).not.toContain(HOURLY);
      expect(nums).not.toContain(SALARIED);
    });
  }
});

describe("Astra chunk F P2-1: an ALLOWLIST over the actual serialized AGM board — an unknown field fails", () => {
  const AGM_PERMS = { canSeeMoney: false, canApprove: false, canEditStructure: false, canBudget: false, canEdit: false, canManageSwitch: false };
  function keyPaths(v: unknown, p: string, out: Set<string>): Set<string> {
    if (Array.isArray(v)) { for (const x of v) keyPaths(x, `${p}[]`, out); return out; }
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) keyPaths(x, `${p}.${p === ".names" || p === ".positions" || p.endsWith(".byDate") ? "*" : k}`, out); return out; }
    out.add(p);
    return out;
  }
  /** The labor window an AGM may receive: the displayed headcounts and status, nothing else (CC's P2-1 ruling). */
  const WINDOW_KEYS = ["amberReasons", "floorHeads", "fromQ", "key", "on", "optimal", "toQ", "tone"];
  /** The labor lines an AGM may receive, with exactly their displayed params. */
  const LINE_PARAMS: Record<string, string[]> = {
    "schedule.labor.window": ["max", "min", "on", "window"], "schedule.labor.window_exact": ["on", "optimal", "window"],
    "schedule.labor.window_under_floor": ["floor", "hours", "window"], "schedule.labor.window_over_target": ["hours", "max", "window"],
    "schedule.labor.minimums_over_target": ["targetPct"], "schedule.labor.minimums_over_target_hours": ["minHours"],
  };

  it("every generator fixture: each path of the AGM view is in the reviewed list; every labor window carries ONLY the displayed fields", async () => {
    const { boardView } = await import("@/lib/scheduling/board-view-shared");
    const { boardSource } = await import("./fixtures/schedule/board-source");
    const { FIXTURES } = await import("./fixtures/schedule/fixtures");
    const { AGM_BOARD_PATHS } = await import("./fixtures/schedule/agm-board-paths");
    const allowed = new Set(AGM_BOARD_PATHS);
    let windows = 0;
    for (const f of Object.keys(FIXTURES)) {
      const view = JSON.parse(JSON.stringify(boardView(boardSource({ perms: AGM_PERMS }, f))));
      for (const p of keyPaths(view, "", new Set())) expect(allowed.has(p), `${f}: ${p}`).toBe(true);
      for (const d of view.days) {
        if (d.labor?.state !== "ok") continue;
        for (const w of d.labor.windows) { windows++; expect(Object.keys(w).sort(), f).toEqual(WINDOW_KEYS); }
        for (const l of d.labor.lines) expect(Object.keys(l.params ?? {}).sort(), `${f}: ${l.key}`).toEqual(LINE_PARAMS[l.key]);
      }
    }
    expect(windows).toBeGreaterThan(0);
  }, 120000);

  it("the REAL loader's AGM payload (loadBoard over the fake, agm_access read and edit) stays inside the list", async () => {
    const { AGM_BOARD_PATHS } = await import("./fixtures/schedule/agm-board-paths");
    const allowed = new Set(AGM_BOARD_PATHS);
    for (const access of ["read", "edit"] as const) {
      const s = shop(access);
      await lib.generateWeek(s.deps, { actor: gm, locationId: A, weekStart: WEEK, expectedHead: null });
      const v = JSON.parse(JSON.stringify(await loadBoard(s.deps, { actor: agm, locationId: A, weekStart: WEEK })));
      for (const p of keyPaths(v, "", new Set())) expect(allowed.has(p), `${access}: ${p}`).toBe(true);
    }
  });
});
