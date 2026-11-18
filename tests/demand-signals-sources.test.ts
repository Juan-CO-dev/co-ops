// Item 4 PR 2: the source register's pure rules, the DC source list (seed data), who may do what, the audit
// vocabulary, and "this layer sends nothing".
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canApproveSignalGoLive, canEnterDemandEvent, canMarkSource, demandEventShopAllowed } from "@/lib/demand-signals/access-shared";
import { NWS_DEFINITION, NWS_SOURCE } from "@/lib/demand-signals/nws-shared";
import {
  INGESTIBLE_GATES, SOURCE_CATEGORIES, SOURCE_GATES, collectDecision, currentStatuses, definitionAddress, definitionProblem, keepUsable, parseDemandEvent,
  parseSourceMark, usableNow, DEMAND_EVENT_CATEGORIES, type SourceDefinition, type SourceState,
} from "@/lib/demand-signals/sources-shared";
import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS, RESERVED_ACTIONS } from "@/lib/audit-actions";
import { SEED_FILE, parseSeedArgs, seedDefinitions } from "../scripts/seed-demand-sources";

const read = (p: string) => readFileSync(p, "utf8");
const M0343 = read("supabase/migrations/0343_demand_signal_sources.sql");
const file = JSON.parse(read(SEED_FILE)) as { checkedOn: string; sources: SourceDefinition[] };
const st = (sourceId: string, status: SourceState["status"], over: Partial<SourceState> = {}): SourceState =>
  ({ sourceId, definitionHash: "a".repeat(64), gate: "allow", adapter: null, status, ...over });

describe("a definition", () => {
  const ok = NWS_SOURCE;
  it("is named by its content: any change to an endpoint, the adapter version or the terms is another definition", () => {
    expect(definitionAddress(ok).hash).toBe(NWS_DEFINITION.hash);
    for (const changed of [{ ...ok, endpoints: [...ok.endpoints, "https://api.weather.gov/zones"] }, { ...ok, adapter: { key: "nws", version: 2 } },
      { ...ok, termsQuote: ok.termsQuote + " " }, { ...ok, gate: "allow" as const }]) {
      expect(definitionAddress(changed).hash).not.toBe(NWS_DEFINITION.hash);
    }
    expect(definitionAddress({ ...ok, conditions: [...ok.conditions] }).hash).toBe(NWS_DEFINITION.hash);
  });
  it.each([
    ["a paid source", { cost: "paid" }, "not_free"],
    ["an ingestible gate over terms nobody read", { termsStatus: "unverified" }, "ingestible_needs_verified_terms"],
    ["'verified' terms with no quote", { termsQuote: null }, "verified_terms_need_url_and_quote"],
    ["'verified' terms with no page", { termsUrl: null }, "verified_terms_need_url_and_quote"],
    ["an http terms page", { termsUrl: "http://x.test/terms" }, "terms_url"],
    ["an adapter on a source that may not be ingested", { gate: "named_only" }, "adapter_needs_ingestible_gate"],
    ["an http endpoint", { endpoints: ["http://api.weather.gov/x"] }, "endpoint"],
    ["an unknown gate", { gate: "maybe" }, "gate"],
    ["an unknown category", { category: "gossip" }, "category"],
    ["a bad id", { sourceId: "NWS api" }, "source_id"],
  ])("refuses %s", (_name, over, problem) => {
    expect(definitionProblem({ ...ok, ...over } as SourceDefinition)).toBe(problem);
  });
  it("the gate vocabulary, the categories and the event categories are the ones 0343 checks", () => {
    const list = (re: RegExp) => [...M0343.match(re)![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(list(/gate text not null check \(gate in \(([^)]*)\)/)).toEqual([...SOURCE_GATES]);
    expect(list(/category text not null check \(category in \(([^)]*?)\)\)/)).toEqual([...SOURCE_CATEGORIES]);
    expect(list(/category text not null check \(category in \('weather_alert'([^)]*?)\)\)/).length + 1).toBe(DEMAND_EVENT_CATEGORIES.length);
    for (const c of DEMAND_EVENT_CATEGORIES) expect(M0343.split(`'${c}'`).length).toBeGreaterThanOrEqual(3);   // the table check and the writer's
    expect(INGESTIBLE_GATES).toEqual(["allow", "allow_with_conditions"]);
    expect(M0343).toContain("if p_status = 'verified' and v_cur.gate not in ('allow', 'allow_with_conditions') then raise exception 'source_not_ingestible'");
  });
});

describe("the register decides every use, from its CURRENT status", () => {
  it("a source the register does not list is unverified", () => {
    expect(currentStatuses([st("nws", "verified")], ["wmata_api", "nws", "nws"])).toEqual([{ sourceId: "nws", status: "verified" }, { sourceId: "wmata_api", status: "unverified" }]);
    expect(usableNow([], ["nws"], "compute")).toEqual({ ok: false, code: "source_unverified", sourceId: "nws" });
    expect(usableNow([], [], "accept")).toEqual({ ok: true });
  });
  it("collect: verified AND the register's definition is the one the adapter was built for AND the gate is ingestible", () => {
    const h = NWS_DEFINITION.hash;
    expect(collectDecision([st("nws", "verified", { definitionHash: h })], "nws", h)).toEqual({ ok: true });
    expect(collectDecision([st("nws", "unverified", { definitionHash: h })], "nws", h)).toMatchObject({ ok: false, code: "source_unverified" });
    expect(collectDecision([st("nws", "revoked", { definitionHash: h })], "nws", h)).toMatchObject({ ok: false, code: "source_revoked" });
    expect(collectDecision([st("nws", "verified")], "nws", h)).toMatchObject({ ok: false, code: "source_unverified" });
    expect(collectDecision([st("nws", "verified", { definitionHash: h, gate: "refuse" })], "nws", h)).toMatchObject({ ok: false, code: "source_unverified" });
    expect(collectDecision([], "nws", h)).toMatchObject({ ok: false, code: "source_unverified" });
  });
  it("compute / render: rows of a revoked or unverified source are dropped; a row with no source is kept", () => {
    const rows = [{ sourceId: "nws", v: 1 }, { sourceId: "opm_operating_status", v: 2 }, { sourceId: null, v: 3 }, { sourceId: "gone", v: 4 }];
    const states = [st("nws", "verified"), st("opm_operating_status", "unverified"), st("gone", "revoked")];
    expect(keepUsable(rows, states, "render").map((r) => r.v)).toEqual([1, 3]);
    expect(keepUsable(rows, [st("nws", "revoked")], "compute").map((r) => r.v)).toEqual([3]);
  });
});

describe("who may do what (trusted role)", () => {
  it("MoO+ marks a source and approves a go-live; GM+ enters events; level 6 does neither", () => {
    for (const role of ["moo", "owner", "cgs"]) { expect(canMarkSource(role)).toBe(true); expect(canApproveSignalGoLive(role)).toBe(true); expect(canEnterDemandEvent(role)).toBe(true); }
    expect(canMarkSource("gm")).toBe(false);
    expect(canApproveSignalGoLive("gm")).toBe(false);
    expect(canEnterDemandEvent("gm")).toBe(true);
    for (const role of ["agm", "prep_mgr", "catering_mgr", "social_media_mgr", "shift_lead", "employee", ""]) {
      expect(canMarkSource(role)).toBe(false); expect(canEnterDemandEvent(role)).toBe(false); expect(canApproveSignalGoLive(role)).toBe(false);
    }
  });
  it("a GM enters events for their own shop only; MoO+ for any shop or all shops", () => {
    expect(demandEventShopAllowed("gm", ["a"], "a")).toBe(true);
    expect(demandEventShopAllowed("gm", ["a"], "b")).toBe(false);
    expect(demandEventShopAllowed("gm", ["a"], null)).toBe(false);
    expect(demandEventShopAllowed("moo", [], "b")).toBe(true);
    expect(demandEventShopAllowed("owner", [], null)).toBe(true);
    expect(demandEventShopAllowed("agm", ["a"], "a")).toBe(false);
  });
  it("0343's writers name the same roles", () => {
    expect(M0343).toContain("u.role in ('owner', 'cgs', 'moo') for share");
    expect(M0343).toContain("u.role in ('gm', 'moo', 'owner', 'cgs') for share");
  });
});

describe("what a person sends", () => {
  it("a mark names the source, the definition read, the status and a note", () => {
    const body = { sourceId: "nws", definitionHash: "b".repeat(64), status: "revoked", note: "  terms changed  " };
    expect(parseSourceMark(body)).toEqual({ ...body, note: "terms changed" });
    for (const bad of [{ ...body, status: "unverified" }, { ...body, note: "x" }, { ...body, definitionHash: "B".repeat(64) }, { ...body, sourceId: "" }, "nws", null]) expect(parseSourceMark(bad)).toBeNull();
  });
  it("a manual event: one day by default, at most 60 days, a known category, a short title", () => {
    const loc = "1c000000-0000-4000-8000-000000000002";
    expect(parseDemandEvent({ locationId: loc, category: "race", validFrom: "2026-11-20", title: " 5K ", startLocal: "07:30", endLocal: "10:00" })).toEqual({
      locationId: loc, category: "race", validFrom: "2026-11-20", validTo: "2026-11-20", startLocal: "07:30", endLocal: "10:00", title: "5K", impact: "unknown",
      note: null, supersedesId: null, retract: false });
    expect(parseDemandEvent({ category: "government_closure", validFrom: "2026-10-01", validTo: "2026-11-12", title: "Shutdown", impact: "down" })).toMatchObject({ locationId: null, validTo: "2026-11-12" });
    for (const bad of [{ category: "party", validFrom: "2026-11-20", title: "X party" }, { category: "race", validFrom: "2026-02-30", title: "5K" },
      { category: "race", validFrom: "2026-11-20", validTo: "2026-11-19", title: "5K" }, { category: "race", validFrom: "2026-01-01", validTo: "2026-06-01", title: "5K" },
      { category: "race", validFrom: "2026-11-20", title: "5" }, { category: "race", validFrom: "2026-11-20", title: "5K", impact: "huge" },
      { category: "race", validFrom: "2026-11-20", title: "5K", startLocal: "25:00" }, { category: "race", validFrom: "2026-11-20", title: "5K", startLocal: "10:00", endLocal: "09:00" },
      { category: "race", validFrom: "2026-11-20", title: "5K", locationId: "not-a-uuid" }, { retract: true }]) expect(parseDemandEvent(bad)).toBeNull();
    expect(parseDemandEvent({ retract: true, supersedesId: loc })).toMatchObject({ retract: true, supersedesId: loc });
  });
});

describe("the DC source list (seed data, registered unverified)", () => {
  it("lists many free sources, each registrable, with unique ids, none paid, none carrying an adapter", () => {
    expect(file.sources.length).toBeGreaterThanOrEqual(50);
    expect(file.sources.map((s) => [s.sourceId, definitionProblem(s)]).filter(([, p]) => p !== null)).toEqual([]);
    expect(new Set(file.sources.map((s) => s.sourceId)).size).toBe(file.sources.length);
    expect(file.sources.every((s) => s.cost === "free" && s.adapter === null && s.termsCheckedOn === file.checkedOn)).toBe(true);
    expect(file.sources.some((s) => s.sourceId === "nws")).toBe(false);
  });
  it("covers every kind Juan named", () => {
    const ids = new Set(file.sources.map((s) => s.sourceId));
    for (const id of ["opm_operating_status", "opm_federal_holidays", "wmata_api", "dc_open_data_tops", "mpd_traffic_advisories", "hsema_msetg_calendar", "dcps_calendar",
      "mlb_statsapi", "nhl_api_web", "capital_one_arena", "events_dc", "runsignup_api", "major_annual_races", "gdelt", "alertdc", "ncei_observed", "ticketmaster_discovery"]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(new Set(file.sources.map((s) => s.category)).size).toBeGreaterThanOrEqual(10);
  });
  it("a 'verified' terms claim carries the official page and a quote; an ingestible gate only over verified terms", () => {
    for (const s of file.sources) {
      if (s.termsStatus === "verified") { expect(s.termsUrl, s.sourceId).toMatch(/^https:\/\//); expect(s.termsQuote!.length, s.sourceId).toBeGreaterThan(20); }
      if (INGESTIBLE_GATES.includes(s.gate)) expect(s.termsStatus, s.sourceId).toBe("verified");
      if (s.gate === "pending_terms") expect(s.termsStatus, s.sourceId).toBe("unverified");
    }
    const by = (g: string) => file.sources.filter((s) => s.gate === g).length;
    expect(by("allow") + by("allow_with_conditions")).toBeGreaterThanOrEqual(8);
    expect(by("refuse")).toBeGreaterThanOrEqual(8);
    expect(by("named_only")).toBeGreaterThanOrEqual(15);
  });
  it("the seed is the file plus the NWS definition from code; the only adapter is NWS", () => {
    const all = seedDefinitions();
    expect(all).toHaveLength(file.sources.length + 1);
    expect(all.filter((d) => d.adapter !== null).map((d) => d.sourceId)).toEqual(["nws"]);
    expect(all.find((d) => d.sourceId === "nws")).toEqual(NWS_SOURCE);
  });
  it("the script is a dry run unless --apply, and registers through 0343's function only (never a status, never a table)", () => {
    expect(parseSeedArgs([])).toEqual({ apply: false });
    expect(parseSeedArgs(["--apply"])).toEqual({ apply: true });
    expect(parseSeedArgs(["--verify"])).toHaveProperty("error");
    const src = read("scripts/seed-demand-sources.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect([...src.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]).sort()).toEqual(["demand_source_register", "demand_source_states"]);
    expect(src).not.toMatch(/demand_source_mark|\.from\(|\.insert\(|\.update\(|supabase-server/);
    expect(src).toContain("pathToFileURL(process.argv[1])");
  });
  it("no migration seeds a source: the register is tenant data", () => {
    expect(M0343).toContain("raise exception '0343: the register must ship empty'");
    for (const id of ["nws", "wmata_api", "opm_operating_status"]) expect(M0343.replace(/^--.*$/gm, "")).not.toContain(`'${id}'`);
  });
});

describe("the documents say what the data says", () => {
  const doc = read("docs/demand-signal-sources.md");
  it("every registered source is in the readable list under its gate, and the list has nothing else", () => {
    const all = seedDefinitions();
    for (const d of all) expect(doc, d.sourceId).toContain("(`" + d.sourceId + "`)");
    expect([...doc.matchAll(/\(`([a-z0-9_]+)`\) \|/g)].map((m) => m[1]).sort()).toEqual(all.map((d) => d.sourceId).sort());
    expect(doc).toContain(all.length + " sources in all");
    for (const d of all.filter((x) => x.termsStatus === "verified")) expect(doc, d.sourceId).toContain(d.termsUrl!);
  });
  it("paid services are a list for the owner, never a registered source", () => {
    const paid = doc.slice(doc.indexOf("## Paid services"));
    for (const name of ["PredictHQ", "Placer.ai", "BestTime.app", "OpenWeather", "SportsDataIO", "NewsAPI.org"]) expect(paid, name).toContain(name);
    expect(paid).toMatch(/nothing is bought, nothing is built/);
    expect(JSON.stringify(seedDefinitions())).not.toMatch(/PredictHQ|Placer\.ai|BestTime/);
  });
  it("the notes record that a signal moves one day's order and that standing pars are a separate later PR", () => {
    const notes = read("docs/superpowers/plans/2026-11-18-demand-signals-pr2-notes.md");
    expect(notes).toContain("demand signals never change a standing par");
    expect(notes).toContain("its own later PR");
    expect(read("AGENTS.md")).toContain("A SIGNAL ADJUSTS THAT DAY'S ORDER ONLY. It never changes a standing par.");
    expect(read("docs/runbooks/demand-signals-sources.md")).toContain("170e841ae33f33e666ca30b71bd61bea");
    expect(M0343).toContain("170e841ae33f33e666ca30b71bd61bea");
  });
});

describe("audit vocabulary (all four are written by 0343 itself)", () => {
  it("a mark and a correction are destructive and reserved; a registration and a new event are not destructive", () => {
    for (const a of ["demand_source.mark", "demand_event.correct"]) {
      expect((DESTRUCTIVE_ACTIONS as readonly string[]).includes(a), a).toBe(true);
      expect((RESERVED_ACTIONS as readonly string[]).includes(a), a).toBe(true);
    }
    for (const a of ["demand_source.register", "demand_event.record"]) expect((NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes(a), a).toBe(true);
    const literal = (action: string) => M0343.slice(M0343.indexOf(`'${action}'`)).match(/[\s,](true|false)\);/)![1];
    expect(literal("demand_source.mark")).toBe("true");
    expect(literal("demand_source.register")).toBe("false");
    expect(M0343).toContain("case when p_supersedes is null then 'demand_event.record' else 'demand_event.correct' end");
  });
});

describe("this layer sends nothing", () => {
  it("no notification, email, SMS or push module is imported by the layer, the cron or the mark route", () => {
    const files = [...readdirSync("lib/demand-signals").map((n) => `lib/demand-signals/${n}`), "app/api/cron/demand-signals/route.ts",
      "app/api/admin/demand-signals/sources/mark/route.ts", "scripts/seed-demand-sources.ts"];
    for (const f of files) {
      expect(existsSync(f), f).toBe(true);
      const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/resend|twilio|nodemailer|web-push|@\/lib\/(email|notifications?|sms|push|digest)|hermes send|whatsapp/i);
    }
  });
});
