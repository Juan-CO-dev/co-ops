/**
 * Astra's chunk E review (2026-10-16, 7 P2 + 1 P3), each finding pinned by a test that failed first:
 *  1. the FINAL closing completion — the one whose timestamp equals the 0230 `station_closed` release's
 *     effective_at — keeps its attribution; nothing else about interval ends changes (narrow and named);
 *  2. a position counts only when it AND its station are active: readiness, the matrix, new writes;
 *  3. the BOH dry run STARTS under plain node/tsx (no `server-only` import) and stays SELECT-only;
 *  4. a dirty skill editor stays mounted: its row and the enclosing sections lock open (D10);
 *  5. unplaced prep batches reach the manager view, en + es;
 *  6. the first shop-settings save serialises on a per-shop advisory lock BEFORE its read (0270);
 *  7. an overnight usual close (00:30) is graded against the NEXT ET day of the closing's business day;
 *  8. history and evidence dates are ET dates (etDisplayDate), never a UTC slice.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { emptySkillFacts, type SkillFacts } from "@/lib/people/facts-shared";
import { bohPositionsReport } from "@/lib/people/boh-positions-shared";
import { disclosureIsOpen, toggleDisclosure } from "@/lib/disclosure-lock-shared";
import { positionTimeline } from "@/lib/people/positions-shared";
import { closeOnTimeObservations, closingDeadlineIso, positionAt, skillFor } from "@/lib/people/skills-shared";
import { computeSkills, orderedPositions, positionUsable, toManagerSkillView } from "@/lib/people/skill-matrix-shared";
import { SKILL_TUNABLE_DEFAULTS as D } from "@/lib/people/tunables-shared";
import type { StationEvent } from "@/lib/assignments-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { SkillsSection } = await import("@/components/people/SkillsSection");

const SHOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GM = "99999999-9999-4999-8999-999999999999";
const ST = "51515151-5151-4151-8151-515151515151";
const ST_OFF = "52525252-5252-4252-8252-525252525252";
const P_WALK = "11111111-1111-4111-8111-111111111111";
const P_PREP = "22222222-2222-4222-8222-222222222222";
const render = (node: ReturnType<typeof createElement>, language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: node }));
const ev = (p: Partial<StationEvent> & Pick<StationEvent, "id" | "sequence" | "kind" | "at">): StationEvent => ({
  locationId: SHOP, businessDate: "2026-10-14", userId: EMP, stationId: null, positionId: null, actorId: null, actorName: null, source: null, ...p,
});

describe("1. the final closing completion keeps its attribution (0230 station_closed release)", () => {
  const CLOSED_AT = "2026-10-15T02:10:00Z";
  const events = (reason: StationEvent["releaseReason"]) => [
    ev({ id: "e1", sequence: "1", kind: "claim", at: "2026-10-14T20:00:00Z", stationId: ST, positionId: P_WALK, source: "claimed" }),
    ev({ id: "e2", sequence: "2", kind: "release", at: "2026-10-15T02:10:01Z", effectiveAt: CLOSED_AT, releaseReason: reason }),
  ];
  it("a completion AT the station_closed release instant is attributed to the interval that release ends", () => {
    const iv = positionTimeline(events("station_closed"));
    expect(positionAt(iv, EMP, CLOSED_AT)?.positionId).toBe(P_WALK);
  });
  it("narrow: the same instant after any OTHER release (clocked_out, on_break, a plain release) stays unattributed", () => {
    for (const reason of ["clocked_out", "on_break", undefined] as const) {
      expect(positionAt(positionTimeline(events(reason)), EMP, CLOSED_AT), String(reason)).toBeNull();
    }
    expect(positionAt(positionTimeline(events("station_closed")), EMP, "2026-10-15T02:10:00.001Z")).toBeNull();
  });
  it("through computeSkills: the lifecycle release no longer drops the on-time observation", () => {
    const f = emptySkillFacts();
    f.stations = [{ id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true, usually_closes_at: "22:00:00" }];
    f.positions = [{ id: P_WALK, station_id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true }];
    f.stationEvents = [
      { id: "e1", sequence: "1", locationId: SHOP, businessDate: "2026-10-14", userId: EMP, stationId: ST, positionId: P_WALK, kind: "claim", at: "2026-10-14T20:00:00Z", source: "claimed", effectiveAt: null, reasonCode: null },
      { id: "e2", sequence: "2", locationId: SHOP, businessDate: "2026-10-14", userId: EMP, stationId: null, positionId: null, kind: "release", at: "2026-10-15T02:10:01Z", source: null, effectiveAt: CLOSED_AT, reasonCode: "station_closed" },
    ];
    f.closingInstances = [{ id: "i1", date: "2026-10-14", template_id: "t1", shift_start_at: null, triggered_at: null }];
    f.closingItems = [{ id: "li1", template_id: "t1", station: "Walk-ins", active: true }];
    f.closingCompletions = [{ id: "c1", instance_id: "i1", template_item_id: "li1", completed_by: EMP, completed_at: CLOSED_AT }];
    const c = computeSkills({ locationId: SHOP, facts: f, members: [{ userId: EMP, name: "Eli", role: "employee" }], asOf: "2026-10-15", nowIso: "2026-10-15T20:00:00Z", tunables: D, actorNames: new Map() });
    const s = c.matrix.people[0]!.skills[0]!;
    expect(s.perKind.closeOnTime).not.toBeNull();
    expect(s.qualityDays).toBe(1);
  });
});

describe("2. a position counts only when it AND its station are active", () => {
  const stations = [
    { id: ST, name: "Prep", name_es: "Prep", sort: 1, active: true, usually_closes_at: null },
    { id: ST_OFF, name: "Old prep", name_es: "Prep viejo", sort: 2, active: false, usually_closes_at: null },
  ];
  const positions = [
    { id: P_WALK, station_id: ST, name: "Prep", name_es: "Prep", sort: 1, active: true },
    { id: P_PREP, station_id: ST_OFF, name: "Prep/Dishwasher", name_es: "Prep/Lavaplatos", sort: 1, active: true },
  ];
  it("positionUsable: active position under an inactive station is not usable", () => {
    expect(positionUsable(positions[0]!, stations)).toBe(true);
    expect(positionUsable(positions[1]!, stations)).toBe(false);
    expect(positionUsable({ ...positions[0]!, active: false }, stations)).toBe(false);
    expect(positionUsable({ ...positions[0]!, station_id: "missing" }, stations)).toBe(false);
  });
  it("the matrix (and every list built on it) leaves out positions of an inactive station", () => {
    expect(orderedPositions({ stations, positions }).map((p) => p.positionId)).toEqual([P_WALK]);
  });
  it("BOH readiness: both positions under an INACTIVE station are not ready", () => {
    const shops = [{ id: SHOP, name: "Shop", active: true }];
    const st = [{ id: ST_OFF, location_id: SHOP, name: "Old prep", active: false }];
    const pos = [
      { id: P_WALK, station_id: ST_OFF, location_id: SHOP, name: "Prep", name_es: "Prep", active: true },
      { id: P_PREP, station_id: ST_OFF, location_id: SHOP, name: "Prep/Dishwasher", name_es: null, active: true },
    ];
    const r = bohPositionsReport(shops, st, pos);
    expect(r.ready).toBe(false);
    expect(r.shops[0]!.findings.map((f) => f.state)).toEqual(["inactive", "inactive"]);
  });
  it("0270's position check (every new write: adjustments, ratings, the prep position, and 0271's grades) requires an active station", () => {
    const sql = readFileSync("supabase/migrations/0270_people_layer.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create function public.people_position_at_shop"), sql.indexOf("end $$;", sql.indexOf("create function public.people_position_at_shop")));
    expect(fn).toContain("join public.stations s on s.id = p.station_id");
    expect(fn).toContain("if not v_active then raise exception 'position_retired'; end if;");
    const harness = readFileSync("scripts/sql-harness-0270.mjs", "utf8");
    expect(harness).toContain("a position under an INACTIVE station is retired");
  });
});

describe("3. the BOH dry run starts under plain node/tsx and stays SELECT-only", () => {
  const src = readFileSync("scripts/check-boh-positions.ts", "utf8");
  it("never imports supabase-server (its server-only guard throws outside Next); a script-local client", () => {
    expect(src).not.toMatch(/(from\s+|import\(\s*)["'][^"']*supabase-server["']/);
    expect(src).toContain('from "@supabase/supabase-js"');
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
  it("STARTS with no database: no credentials → a named exit 2, never a server-only crash", () => {
    const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" };
    const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/check-boh-positions.ts"], { encoding: "utf8", env, timeout: 60_000 });
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/server-only|cannot be imported from a Client Component/i);
    expect(r.stderr).toContain("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    expect(r.status).toBe(2);
  }, 70_000);
});

describe("4. a dirty skill editor stays mounted: the row and the enclosing sections lock open (D10)", () => {
  it("the pure lock: a clean disclosure toggles; a dirty one stays open and a collapse is a no-op", () => {
    expect(toggleDisclosure(true, false)).toBe(false);
    expect(toggleDisclosure(false, false)).toBe(true);
    expect(toggleDisclosure(true, true)).toBe(true);
    expect(toggleDisclosure(false, true)).toBe(true);
    expect(disclosureIsOpen(false, true)).toBe(true);
    expect(disclosureIsOpen(false, false)).toBe(false);
  });
  const f = (): SkillFacts => {
    const x = emptySkillFacts();
    x.stations = [{ id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true, usually_closes_at: null }];
    x.positions = [
      { id: P_WALK, station_id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true },
      { id: P_PREP, station_id: ST, name: "Prep", name_es: "Prep", sort: 2, active: true },
    ];
    x.stationEvents = [
      { id: "e1", sequence: "1", locationId: SHOP, businessDate: "2026-10-14", userId: EMP, stationId: ST, positionId: P_WALK, kind: "claim", at: "2026-10-14T20:00:00Z", source: "claimed", effectiveAt: null, reasonCode: null },
      { id: "e2", sequence: "2", locationId: SHOP, businessDate: "2026-10-14", userId: EMP, stationId: null, positionId: null, kind: "release", at: "2026-10-15T02:30:00Z", source: null, effectiveAt: null, reasonCode: null },
    ];
    return x;
  };
  const view = () => toManagerSkillView({
    computed: computeSkills({ locationId: SHOP, facts: f(), members: [{ userId: EMP, name: "Eli", role: "employee" }], asOf: "2026-10-15", nowIso: "2026-10-15T20:00:00Z", tunables: D, actorNames: new Map() }),
    subjectId: EMP, facts: f(), actorNames: new Map(), canAdjust: true,
  });
  it("collapse path A — the section and the ROW: a dirty editor renders mounted though both start collapsed", () => {
    const html = render(createElement(SkillsSection, { view: view(), initiallyDirty: [P_WALK] }));
    expect(html).toContain("Save adjustment");
    expect(html).toContain(en["people.skills.unsaved"]);
  });
  it("collapse path B — the enclosing \"Other positions\" section: a dirty editor inside it holds it open", () => {
    const html = render(createElement(SkillsSection, { view: view(), initiallyDirty: [P_PREP] }));
    expect(html).toContain(en["people.skills.otherPositions"]);
    expect(html).toContain("Save adjustment");
  });
  it("clean: everything starts collapsed (D8), no editor mounted", () => {
    const html = render(createElement(SkillsSection, { view: view() }));
    expect(html).not.toContain("Save adjustment");
    expect(html).not.toContain(en["people.skills.unsaved"]);
  });
  it("the component routes every toggle through the lock (source pins)", () => {
    const src = readFileSync("components/people/SkillsSection.tsx", "utf8");
    expect(src.match(/toggleDisclosure\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("onDirtyChange");
  });
});

describe("5. unplaced prep batches reach the manager view", () => {
  it("a maker with no position interval and no shop prep position: counted on the view and shown en + es", () => {
    const x = emptySkillFacts();
    x.stations = [{ id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true, usually_closes_at: null }];
    x.positions = [{ id: P_WALK, station_id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true }];
    x.productions = [{ id: "pr1", itemId: "ham", producedAt: "2026-10-14T21:00:00Z", madeBy: EMP, batchesMade: 1, cameOutTo: 10, yieldAtTime: 10 }];
    const computed = computeSkills({ locationId: SHOP, facts: x, members: [{ userId: EMP, name: "Eli", role: "employee" }], asOf: "2026-10-15", nowIso: "2026-10-15T20:00:00Z", tunables: D, actorNames: new Map() });
    const v = toManagerSkillView({ computed, subjectId: EMP, facts: x, actorNames: new Map(), canAdjust: false });
    expect(v.unplacedBatches).toBe(1);
    const html = render(createElement(SkillsSection, { view: v, initiallyOpen: true }));
    expect(html).toContain(en["people.skills.unplaced"].replace("{count}", "1"));
    expect(render(createElement(SkillsSection, { view: v, initiallyOpen: true }), "es")).toContain(es["people.skills.unplaced"].replace("{count}", "1"));
    expect(es["people.skills.unplaced"]).toBeTruthy();
  });
});

describe("6. the first shop-settings save serialises on a per-shop lock before its read (0270)", () => {
  it("save_people_shop_settings takes pg_advisory_xact_lock on the shop BEFORE the select … for update", () => {
    const sql = readFileSync("supabase/migrations/0270_people_layer.sql", "utf8");
    const start = sql.indexOf("create function public.save_people_shop_settings");
    const fn = sql.slice(start, sql.indexOf("end $$;", start));
    const lock = fn.indexOf("perform pg_advisory_xact_lock(hashtextextended('people-shop-settings/' || p_location::text, 0));");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(fn.indexOf("select * into v_old from public.people_shop_settings"));
    expect(readFileSync("scripts/sql-harness-0270.mjs", "utf8")).toContain("P5 the shop-settings writer locks the shop before it reads");
  });
});

describe("7. an overnight usual close is graded on the NEXT ET day", () => {
  it("closingDeadlineIso: 00:30 after a closing that started 15:00 ET on the 15th is 00:30 ET on the 16th; 22:00 stays the 15th", () => {
    expect(closingDeadlineIso("2026-10-15", "00:30:00", "2026-10-15T19:00:00Z")).toBe("2026-10-16T04:30:00.000Z");
    expect(closingDeadlineIso("2026-10-15", "22:00:00", "2026-10-15T19:00:00Z")).toBe("2026-10-16T02:00:00.000Z");
    expect(closingDeadlineIso("2026-10-15", "00:30:00", null)).toBe("2026-10-16T04:30:00.000Z");
    expect(closingDeadlineIso("2026-10-31", "00:30:00", null)).toBe("2026-11-01T04:30:00.000Z");
    expect(closingDeadlineIso("2026-11-01", "00:30:00", null)).toBe("2026-11-02T05:30:00.000Z");
  });
  it("a completion at 00:20 ET on the 16th for the 15th's closing is ON TIME; 00:50 (past the 15-minute grace) is late", () => {
    const iv = [{ locationId: SHOP, businessDate: "2026-10-15", userId: EMP, stationId: ST, positionId: P_WALK, start: "2026-10-15T19:00:00Z", end: "2026-10-16T06:00:00Z", source: "claimed" as const }];
    const obs = (completedAt: string) => closeOnTimeObservations({
      completions: [{ id: "c", instanceId: "i", templateItemId: "li", completedBy: EMP, completedAt }],
      instanceDay: new Map([["i", "2026-10-15"]]), instanceStart: new Map([["i", "2026-10-15T19:00:00Z"]]),
      lineStation: new Map([["li", "Walk-ins"]]), stations: [{ id: ST, name: "Walk-ins", usuallyClosesAt: "00:30:00" }], closures: new Map(), intervals: iv,
    }, D);
    expect(obs("2026-10-16T04:20:00Z")[0]!.value).toBe(1);
    expect(obs("2026-10-16T04:50:00Z")[0]!.value).toBe(0);
  });
});

describe("8. history and evidence dates are ET dates", () => {
  it("an adjustment at 21:00 ET on Oct 15 (01:00Z on the 16th) is dated Oct 15 in its evidence line", () => {
    const s = skillFor({ positionId: P_WALK, asOf: "2026-10-16", worked: [], observations: [] }, null, 0.1, D, {
      adjustment: { delta: 0.1, actorName: "Alex", at: "2026-10-16T01:00:00Z", reasonCode: "observed_on_floor" },
      rating: null, noMakerBatches: 0,
    });
    expect(s.evidence.find((e) => e.key === "people.skills.evidence.adjustment")?.params?.date).toBe("2026-10-15");
  });
  it("the history list formats through etDisplayDate (source pin; no UTC slice left)", () => {
    const src = readFileSync("components/people/SkillsSection.tsx", "utf8");
    expect(src).not.toContain("h.at.slice(0, 10)");
    expect(src).toContain("formatDateLabel(etDisplayDate(h.at), language)");
    expect(readFileSync("lib/people/skills-shared.ts", "utf8")).not.toMatch(/\.at\.slice\(0, 10\)/);
  });
});
