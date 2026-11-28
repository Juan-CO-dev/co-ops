/**
 * Digests round 3, PR 4, packet T: labor money END TO END. The REAL engine (lib/report-digests-engine.ts) runs the
 * REAL pre-load pieces (lib/business-labor-core.ts and the settings piece of lib/report-digests-labor.ts, through the
 * real `buildLaborMoneyIO`; its client factory is the only thing mocked, to hand it the fake labor database) and the
 * REAL composers write every email; the tests compare BYTES (subject, preheader, every section status, HTML, text).
 *
 * The properties: a recipient never sees labor money their business-report access does not hold; no recipient's
 * email changes by one byte because of a read or a line they cannot see or because of the order of recipients;
 * nothing is read at compose; unknown is never zero; with the switch off everything is byte-identical.
 *
 * Plan §3.10, §11.2.7, §11.3, §13.2.3, §15.2.5, §16.3; contract items by number where they are proved: L7 (§15.2.5),
 * N1, A4-1 (closes A-N4), A4-2, O-N6, O-N3, P2-B, Opus N4, §11.2.7 read counts.
 *
 * Harness: tests/fixtures/digest-labor-e2e.ts. Synthetic only ("Shop A", "Person A", example.com). Nothing is sent
 * or fetched; no database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-server")>();
  return {
    ...actual,
    getServiceRoleClient: () => { throw new Error("no database in unit tests"); },
    // The ONE seam: the pre-load's own client is the fake labor database of the run in progress.
    createServiceRoleClientWithFetch: vi.fn(() => (globalThis as { __laborE2eClient?: unknown }).__laborE2eClient),
  };
});

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { buildLaborMoneyIO } from "@/lib/report-digests-labor";
import { salesWindows } from "@/lib/sales-reports-shared";
import type { LaborMoneyIO } from "@/lib/report-digests-labor-shared";
import { GM_ALL_ON, gmOff } from "./helpers/business-report-fake";
import {
  A, B, D, DM1, LATEST, LAST_SAT, ON4, SALARY, WD, WP, e2e, handLaborIO, ref,
  type E2EOpts, type FakeClock, type Harness, type LaborDb, type Mail,
} from "./fixtures/digest-labor-e2e";

// ── harness wrappers ─────────────────────────────────────────────────────────────────────────────

/** The real factory over the fake client (the default of this file). */
const factoryIO = (db: LaborDb, clock: FakeClock): LaborMoneyIO => {
  (globalThis as { __laborE2eClient?: unknown }).__laborE2eClient = db.client;
  const io = buildLaborMoneyIO({ env: ON4, clock: clock.clock, timers: clock.timers });
  if (!io) throw new Error("the switch is on: the factory must build the IO");
  return io;
};
const RUNS: Harness[] = [];
async function run(o: E2EOpts): Promise<Harness> {
  const h = await e2e({ laborIO: factoryIO, ...o }).run();
  RUNS.push(h);
  return h;
}
const CLOSING = { kind: "closing" as const };
const BOTH = { [D]: [A, B] };
const ONLY_A = { [D]: [A] };

const bytes = (m: Mail) => ({ subject: m.subject, preheader: m.preheader, html: m.html, text: m.text });
const expectSame = (a: Mail, b: Mail, what: string) => expect(bytes(a), what).toEqual(bytes(b));
const key = (m: Mail) => `${m.kind}|${m.day}|${m.ref}|${m.location ?? "all"}`;
const byKey = (h: Harness) => new Map(h.mails.map((m) => [key(m), m]));

const T = (lang: Language, k: TranslationKey) => serverT(lang, k);
/** The money group words (as a line's label or inside an "and N more" fold). */
const GROUP = (lang: Language) => ({
  hourly: [T(lang, "digest.labor_money.latest_label_plain"), T(lang, "digest.labor_money.week_so_far_label_plain"), T(lang, "digest.labor_money.last_week_label_plain")],
  loaded: [T(lang, "reports.business.card.fully_loaded")],
  roles: [T(lang, "digest.labor_money.roles_label_plain")],
});
const MONEY_LABEL_KEYS: TranslationKey[] = ["digest.labor_money.label", "digest.labor_money.latest_label_plain", "digest.labor_money.week_so_far_label_plain",
  "digest.labor_money.last_week_label_plain", "reports.business.card.fully_loaded", "digest.labor_money.roles_label_plain"];
const hasAny = (body: string, words: string[]) => words.some((w) => body.includes(w));
const hasAll = (body: string, words: string[]) => words.every((w) => body.includes(w));
/** No labor-money word at all (any language). */
const noMoney = (body: string) => !(["en", "es"] as const).some((l) => hasAny(body, [...GROUP(l).hourly, ...GROUP(l).loaded, ...GROUP(l).roles, T(l, "digest.labor_money.not_available")]));

/** The text's sections by title line ("Labor — ✓ All good" → "Labor"). */
function sections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of text.split("\n\n")) {
    const title = chunk.split("\n")[0]!.split(" — ")[0]!;
    out.set(title, chunk);
  }
  return out;
}
/** The bullet lines (not the link lines) of a text section. */
const bullets = (chunk: string) => chunk.split("\n").slice(1).filter((l) => !l.startsWith("  ") && !l.startsWith("Open this in the app"));
const lineOf = (text: string, startsWith: string) => text.split("\n").find((l) => l.slice(2).startsWith(startsWith));

const gmSettings = (s: Record<string, boolean>) => ({ db: { visibility: [s] } });

// ── 1. L7, the exact case (§15.2.5) ──────────────────────────────────────────────────────────────

describe("L7 (§15.2.5): a Toast change at T inside a stalled role step never reaches the GM's email", () => {
  /** The GM holds hourly cost and NOT cost by role; the flagged MoO (at the GM's shop) holds cost by role. */
  const HOURLY_ONLY = gmOff("person_cost");
  const l7 = (mooId: string, roles: "now" | "never") => run({
    run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a", "moo"], mooId }, ...gmSettings(HOURLY_ONLY),
    // T: the fake Toast source closes a shift of D's payroll week (its fingerprint moves, the facts would change).
    toastChangeAt: 1_000,
    before: (h) => { h.db.stallRoles = roles === "never"; },
  });

  it("the GM's email is byte-identical in both runs, in both ref orders; and again with NO holder of cost by role", async () => {
    const runs = { beforeNow: await l7("aa-moo", "now"), beforeNever: await l7("aa-moo", "never"), afterNow: await l7("zz-moo", "now"), afterNever: await l7("zz-moo", "never") };
    const gm = (h: Harness) => h.mail("gm_shop", "gm-a", A);
    // The refs really sort both ways round the GM's.
    expect(["user:aa-moo", "user:gm-a", "user:zz-moo"].sort()).toEqual(["user:aa-moo", "user:gm-a", "user:zz-moo"]);
    for (const [name, h] of Object.entries(runs)) {
      expect(h.mails.map((m) => m.ref).sort(), name).toEqual([ref("gm-a"), ref(name.startsWith("before") ? "aa-moo" : "zz-moo")].sort());
      expectSame(gm(h), gm(runs.beforeNow), name);
      // A role read was really made (a holder of cost by role was due).
      expect(h.db.named("business_report_labor_people").length, name).toBe(1);
    }
    // The run with an answering role read sealed before T; in the stalled run T fell INSIDE the role step (the
    // people read was sent before T and never answered), the cutoff ended it, and the GM was composed after T.
    const start = runs.beforeNow.db.sent[0]!.at;
    for (const h of [runs.beforeNow, runs.afterNow]) expect(Math.max(...h.db.sent.map((r) => r.at))).toBeLessThan(start + 1_000);
    for (const h of [runs.beforeNever, runs.afterNever]) {
      expect(h.db.named("business_report_labor_people")[0]!.at).toBeLessThan(start + 1_000);
      expect(h.log.first("toast:T")).toBeGreaterThan(-1);
      expect(h.log.first("toast:T")).toBeLessThan(h.log.first(`sendEmail(gm_shop, ${ref("gm-a")}`));
      // The role step's data stage (2 s) ended the stalled read; its closing checks ran; the GM went out after both.
      expect(gm(h).at).toBeGreaterThanOrEqual(start + 2_000);
      // The MoO (a holder) reads "Cost by role not available"; the GM's email never mentions cost by role.
      expect(h.mail("gm_shop", h.mails.find((m) => m.ref !== ref("gm-a"))!.ref, A).text).toContain(T("en", "digest.labor_money.roles_not_available"));
    }
    expect(gm(runs.beforeNow).text).not.toContain(T("en", "digest.labor_money.roles_label_plain"));
    expect(gm(runs.beforeNow).text).toContain(`${T("en", "digest.labor_money.latest_label_plain")} (`);

    // No holder of cost by role at all (no flagged MoO): no role read is made, and the GM gets the same bytes.
    const alone = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a"] }, ...gmSettings(HOURLY_ONLY), toastChangeAt: 1_000 });
    expect(alone.db.named("business_report_labor_people")).toHaveLength(0);
    expect(alone.db.named("sevenshifts_roles")).toHaveLength(0);
    expectSame(gm(alone), gm(runs.beforeNow), "no holder of cost by role");
  });

  it("a GM WITH cost by role: only the F5 line (and the counts it owns) differs; it reads \"Cost by role not available\" when the role read failed or never settled", async () => {
    const gmRun = (how: "now" | "never" | "fail") => run({
      run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a", "moo"], mooId: "aa-moo" }, toastChangeAt: 1_000,
      before: (h) => { h.db.stallRoles = how === "never"; h.db.failRoles = how === "fail"; },
    });
    const okRun = await gmRun("now");
    const okMail = okRun.mail("gm_shop", "gm-a", A);
    const rolesWord = T("en", "digest.labor_money.roles_label_plain");
    expect(okMail.text).toContain(`${rolesWord}, `); // F5 printed (folded or not) with its date
    for (const how of ["never", "fail"] as const) {
      const h = await gmRun(how);
      const m = h.mail("gm_shop", "gm-a", A);
      expect(lineOf(m.text, `${rolesWord}: `), how).toBe(`? ${rolesWord}: ${T("en", "digest.labor_money.roles_not_available")}`);
      // Every section but Labor is byte-identical; inside Labor every line that is not F5 (or the fold naming it) is too.
      const a = sections(okMail.text), b = sections(m.text);
      expect([...b.keys()], how).toEqual([...a.keys()]);
      for (const [title, chunk] of a) {
        if (title === "Labor") continue;
        expect(b.get(title), `${how} ${title}`).toBe(chunk);
      }
      const notF5 = (chunk: string) => bullets(chunk).filter((l) => !l.includes(rolesWord) && !l.slice(2).startsWith("and ")).sort();
      const okLabor = notF5(a.get("Labor")!), badLabor = notF5(b.get("Labor")!);
      // The F5 line printed in the failing run pushes exactly one routine line into the fold; every other line stands.
      for (const l of badLabor) expect(okLabor, `${how}: ${l}`).toContain(l);
      expect(okLabor.length - badLabor.length, how).toBeLessThanOrEqual(1);
    }
  });
});

// ── 2. N1: the digest's own pull moves the current week ──────────────────────────────────────────

describe("N1: the digest's own Toast pull (phase 0) changes an out_at of D's week → the current week is updating", () => {
  const n1 = (pullChanges: boolean) => run({
    run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a", "moo"] }, db: { laborCostRow: () => SALARY },
    before: (h) => h.shop.mode(A, D, { pullChanges }),
  });
  it("a pull that changes an out_at: F1 = last Saturday, F2 updating, the previous week stands; nothing of D's week is a number", async () => {
    const h = await n1(true);
    // The pull ended before the first labor read (phase 0 first).
    expect(h.log.first("shopFacts:start")).toBe(0);
    expect(h.db.toastChanged).toBe(true);
    for (const who of ["gm-a", "moo"]) {
      const m = h.mail("gm_shop", who, A);
      for (const lang of ["en"] as const) {
        expect(m.text).toContain(`${T(lang, "digest.labor_money.latest_label_plain")} (Sat, Oct 3): $`);
        expect(lineOf(m.text, T(lang, "digest.labor_money.week_so_far_label_plain"))).toBe(`? ${T(lang, "digest.labor_money.week_so_far_label_plain")}: ${T(lang, "digest.labor_money.week_updating")}`);
        expect(m.text).toContain(`${T(lang, "digest.labor_money.last_week_label_plain")} (Sun, Sep 27 to Sat, Oct 3)`);
      }
      // Nothing dated in D's week (Oct 4 … Oct 7) is printed as a money span.
      expect(m.html).not.toMatch(/reports\/business\?[^"]*from=2026-10-0[4-7]/);
      expect(m.text).not.toMatch(/Payroll week so far \(/);
      expect(m.text).not.toMatch(/Tue, Oct 6/);
    }
    // The MoO's F5 is the Saturday's cost by role.
    expect(h.mail("gm_shop", "moo", A).text).toContain(`${T("en", "digest.labor_money.roles_label_plain")}, Sat, Oct 3`);
  });
  it("the same fixture with a pull that changes nothing: the current week prints", async () => {
    const h = await n1(false);
    const m = h.mail("gm_shop", "gm-a", A);
    expect(m.text).toContain("Latest final day (Tue, Oct 6): $");
    expect(m.text).toContain("Payroll week so far (Sun, Oct 4 to Tue, Oct 6): ");
    expect(m.text).not.toContain(T("en", "digest.labor_money.week_updating"));
  });
});

// ── 3. Switch off = byte-identical ───────────────────────────────────────────────────────────────

describe("switch off: every email is PR 2's, zero labor requests, the facts load at compose", () => {
  const file = JSON.parse(readFileSync(path.join(__dirname, "fixtures/digest-labor-goldens/goldens.json"), "utf8")) as { cases: Record<string, { subject: string; preheader: string; html: string; text: string }> };
  for (const lang of ["en", "es"] as const) {
    it(`the GM's shop digest and the owner's unified digest equal the goldens rendered before PR 4 (${lang})`, async () => {
      const h = await run({ run: CLOSING, finalized: BOTH, switchOn: false, dir: { es: lang === "es" ? ["gm-a", "own"] : [] } });
      expect(h.io.laborMoney).toBeUndefined();
      expect(bytes(h.mail("gm_shop", "gm-a", A))).toEqual(file.cases[`shop-${lang}-permitted`]);
      expect(bytes(h.mail("unified", "own"))).toEqual(file.cases[`unified-${lang}-permitted`]);
      expect(h.db.sent).toHaveLength(0);
      // The first ordinary facts load is INSIDE the first compose (after the first claim), as before PR 4.
      expect(h.log.first("shopFacts:start")).toBeGreaterThan(h.log.first("claim("));
      expect(h.shop.calls.every((c) => c.args === 2)).toBe(true);
    });
  }
  it("a switch-off tick (two days, the catering digest too): zero labor requests, no labor-money word anywhere, the facts load at compose", async () => {
    const a = await run({ run: { kind: "tick" }, finalized: { [DM1]: [A, B], [D]: [A, B] }, switchOn: false, settings: { cateringTimeEt: "07:00" } });
    expect(a.db.sent).toHaveLength(0);
    expect(a.mails.length).toBeGreaterThan(8);
    expect(a.log.first("shopFacts:start")).toBeGreaterThan(a.log.first("claim("));
    for (const m of a.mails) expect(noMoney(m.text) && noMoney(m.html), key(m)).toBe(true);
  });
});

// ── 4. O-N6: switch on, nobody due who could hold labor money ────────────────────────────────────

describe("O-N6: switch on, only a flagged AGM's shop digest and the catering digest are due", () => {
  it("zero labor and zero settings requests, and every email byte-identical to the switch-off run", async () => {
    const o = (switchOn: boolean): E2EOpts => ({ run: { kind: "tick" }, finalized: ONLY_A, switchOn, dir: { who: ["agm", "cat"] }, settings: { cateringTimeEt: "07:00" } });
    const on = await run(o(true));
    const off = await run(o(false));
    expect(on.db.sent).toHaveLength(0);
    expect(on.mails.map(key).sort()).toEqual(off.mails.map(key).sort());
    expect(on.mails.map((m) => m.kind).sort()).toEqual(["catering", "gm_shop"]);
    const offBy = byKey(off);
    for (const m of on.mails) expectSame(m, offBy.get(key(m))!, key(m));
  });
});

// ── 5. Refused recipients inside a labor-money run ───────────────────────────────────────────────

describe("refused recipients inside a labor-money run: byte-identical to the switch-off run, whatever the facts", () => {
  type State = "ok" | "over_target" | "updating" | "unavailable";
  const STATES: State[] = ["ok", "over_target", "updating", "unavailable"];
  const facts = (s: State): Partial<E2EOpts> => ({
    db: { laborCostRow: (args) => ({ ...SALARY, ...(s === "over_target" && args.p_from === LATEST && args.p_to === LATEST ? { hourly_straight_cents: 25_000 } : {}) }) },
    before: (h) => { if (s === "updating") h.db.toastChanged = true; if (s === "unavailable") { h.db.stalled.add(A); h.db.stalled.add(B); } },
  });
  const GM_VARIANTS: Array<[string, Partial<E2EOpts>]> = [
    ["settings with report off", gmSettings(gmOff("report"))],
    ["a settings read that failed", { db: { visibility: ["error"] } }],
    ["report on, hourly cost off (a business access with no money group)", gmSettings(gmOff("hourly_cost"))],
  ];
  const base: E2EOpts = { run: { kind: "tick" }, finalized: BOTH, dir: { who: ["gm-a", "agm", "cat", "moo"] }, settings: { cateringTimeEt: "07:00" } };
  const refusedKeys = (h: Harness) => h.mails.filter((m) => [ref("agm"), ref("cat"), ref("gm-a")].includes(m.ref)).map(key).sort();

  it.each(GM_VARIANTS)("the flagged AGM, the catering manager and a GM with %s: every one of their emails, for every fact state", async (_n, gm) => {
    for (const s of STATES) {
      const f = facts(s);
      // The switch-off run of the SAME Toast state (a changed out_at changes D's ordinary facts for everyone).
      const off = await run({ ...base, switchOn: false, ...(f.before ? { before: f.before } : {}) });
      const offBy = byKey(off);
      const on = await run({ ...base, switchOn: true, ...f, db: { ...f.db, ...gm.db } });
      // The run really priced labor money (the MoO is a holder at Shop A).
      expect(on.db.laborRequests().length, s).toBeGreaterThan(0);
      expect(refusedKeys(on), s).toEqual(refusedKeys(off));
      expect(refusedKeys(on).length, s).toBe(4); // the AGM's and the GM's shop digests, the catering manager's and the GM's catering digests
      for (const k of refusedKeys(on)) expectSame(byKey(on).get(k)!, offBy.get(k)!, `${s} ${k}`);
      for (const k of refusedKeys(on)) expect(noMoney(byKey(on).get(k)!.text), `${s} ${k}`).toBe(true);
    }
  });

  it("a shop with no Toast labor and no schedule: the refused GM gets no Labor section, exactly as with the switch off", async () => {
    const bare: Partial<E2EOpts> = { before: (h) => h.shop.mode(A, D, { bare: true }) };
    const o: E2EOpts = { run: CLOSING, finalized: ONLY_A, dir: { who: ["gm-a", "moo"] }, ...bare };
    const off = await run({ ...o, switchOn: false });
    const on = await run({ ...o, switchOn: true, ...gmSettings(gmOff("hourly_cost")) });
    expect(sections(off.mail("gm_shop", "gm-a", A).text).has("Labor")).toBe(false);
    expectSame(on.mail("gm_shop", "gm-a", A), off.mail("gm_shop", "gm-a", A), "bare GM");
    // The holder's Labor section exists through its money lines alone (they do not depend on today's Toast state).
    expect(sections(on.mail("gm_shop", "moo", A).text).has("Labor")).toBe(true);
  });
});

// ── 6. The access matrix through the engine ──────────────────────────────────────────────────────

describe("the access matrix through the engine (rendered, en)", () => {
  const W = GROUP("en");
  it("owner / MoO / CGS: F1–F5 in the shop digest and for each shop of the unified digest", async () => {
    const h = await run({ run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["gm-a", "moo", "own", "cgs"] }, db: { laborCostRow: () => SALARY } });
    const moo = h.mail("gm_shop", "moo", A);
    for (const body of [moo.text, moo.html]) for (const words of Object.values(W)) expect(hasAll(body, words), words.join()).toBe(true);
    for (const who of ["moo", "own", "cgs"]) {
      const u = h.mail("unified", who);
      for (const w of [...W.hourly, ...W.loaded, ...W.roles]) expect(u.text.split(w).length - 1, `${who} ${w}`).toBe(2);
      for (const w of [...W.hourly, ...W.loaded, ...W.roles]) expect(u.html.includes(w), `${who} html ${w}`).toBe(true);
    }
  });
  const GM_CASES: Array<[string, Record<string, boolean> | null, { hourly: boolean; loaded: boolean; roles: boolean }]> = [
    // NOTE: the defaults hold people + person_cost (lib/business-access-shared.ts GM_VISIBILITY_DEFAULTS), so a default
    // GM holds cost by role: F1–F3 + F5, no F4.
    ["the defaults (no row saved)", null, { hourly: true, loaded: false, roles: true }],
    ["loaded on (every switch on)", GM_ALL_ON, { hourly: true, loaded: true, roles: true }],
    // gmOff = every switch on except these (and their children): loaded stays on.
    ["people off", gmOff("people"), { hourly: true, loaded: true, roles: false }],
    ["person_cost off", gmOff("person_cost"), { hourly: true, loaded: true, roles: false }],
    ["the defaults with people off", { ...GM_ALL_ON, loaded: false, person_salary: false, people: false, person_cost: false }, { hourly: true, loaded: false, roles: false }],
    ["loaded on, person_cost off", { ...GM_ALL_ON, person_cost: false }, { hourly: true, loaded: true, roles: false }],
    ["hourly cost off", gmOff("hourly_cost"), { hourly: false, loaded: false, roles: false }],
    ["report off", gmOff("report"), { hourly: false, loaded: false, roles: false }],
  ];
  it.each(GM_CASES)("a GM with %s: the groups that are on, and none that is off (HTML and text)", async (_n, settings, want) => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a"] }, db: { laborCostRow: () => SALARY, visibility: [settings] } });
    const m = h.mail("gm_shop", "gm-a", A);
    for (const body of [m.text, m.html]) {
      for (const g of ["hourly", "loaded", "roles"] as const) {
        expect(want[g] ? hasAll(body, W[g]) : !hasAny(body, W[g]), `${g}`).toBe(true);
      }
    }
    if (!want.hourly) expect(noMoney(m.text) && noMoney(m.html)).toBe(true);
  });
});

describe("capability isolation through the engine: what a GM cannot see never moves a byte", () => {
  it("a default GM (no fully loaded): byte-identical whether the salary is known (F4 priced) or not (F4 a dash, unknown)", async () => {
    const o = (salary: boolean): E2EOpts => ({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a", "moo"] }, db: salary ? { laborCostRow: () => SALARY } : {} });
    const known = await run(o(true)), unknown = await run(o(false));
    expectSame(known.mail("gm_shop", "gm-a", A), unknown.mail("gm_shop", "gm-a", A), "GM");
    // The MoO (a holder of fully loaded) does see the difference.
    expect(bytes(known.mail("gm_shop", "moo", A))).not.toEqual(bytes(unknown.mail("gm_shop", "moo", A)));
  });
});

// ── 7. P2-B rendered ─────────────────────────────────────────────────────────────────────────────

describe("P2-B: a closing run with the unified digest due and Shop B's labor reads stalled", () => {
  it("the unified email shows Shop A's figures and \"Labor cost not available\" for Shop B; Shop A's own digest is byte-identical", async () => {
    const o: E2EOpts = { run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["gm-a", "moo", "own"] }, db: { laborCostRow: () => SALARY } };
    const healthy = await run(o);
    const stalled = await run({ ...o, before: (h) => h.db.stalled.add(B) });
    const u = sections(stalled.mail("unified", "own").text);
    expect(u.get("Shop A · Labor")).toContain("Latest final day (Tue, Oct 6): $");
    const b = u.get("Shop B · Labor")!;
    expect(b).toContain(`? ${T("en", "digest.labor_money.latest_label_plain")}: ${T("en", "digest.labor_money.not_available")}`);
    expect(b).toContain(`? ${T("en", "reports.business.card.fully_loaded")}: ${T("en", "digest.labor_money.not_available")}`);
    expect(b).not.toMatch(/Latest final day \(|Payroll week so far \(/);
    // Shop A's sections of the unified digest are untouched too.
    expect(u.get("Shop A · Labor")).toBe(sections(healthy.mail("unified", "own").text).get("Shop A · Labor"));
    for (const who of ["gm-a", "moo"]) expectSame(stalled.mail("gm_shop", who, A), healthy.mail("gm_shop", who, A), who);
    // The stalled piece ran to its cap; the sends waited for the seal, nothing was read at compose.
    expect(stalled.requestsAtFirstSend).toBe(stalled.db.sent.length);
  });
});

// ── 8. Tick ──────────────────────────────────────────────────────────────────────────────────────

describe("tick: two shops, two business days, Shop B's labor reads stalled", () => {
  it("every email that does not show Shop B's labor money is byte-identical to the unstalled run", async () => {
    const o: E2EOpts = { run: { kind: "tick" }, finalized: { [DM1]: [A, B], [D]: [A, B] }, switchOn: true, dir: { who: ["gm-a", "gm-b", "moo", "own", "agm"] }, db: { laborCostRow: () => SALARY } };
    const healthy = await run(o);
    const stalled = await run({ ...o, before: (h) => h.db.stalled.add(B) });
    expect(stalled.mails.map(key).sort()).toEqual(healthy.mails.map(key).sort());
    const hb = byKey(healthy);
    let same = 0;
    for (const m of stalled.mails) {
      if (m.kind === "unified" || m.location === B) { expect(bytes(m)).not.toEqual(bytes(hb.get(key(m))!)); continue; }
      expectSame(m, hb.get(key(m))!, key(m));
      same++;
    }
    expect(same).toBeGreaterThanOrEqual(6); // GM-A, MoO, AGM × two days
    expect(stalled.log.last("shopFacts:start")).toBeLessThan(stalled.log.first("claim("));
    expect(stalled.shop.calls).toHaveLength(4);
    // Both days of Shop A really carry money (D − 1's latest final day is Mon, Oct 5).
    expect(stalled.mail("gm_shop", "gm-a", A, DM1).text).toContain("Latest final day (Mon, Oct 5): $");
    expect(stalled.mail("gm_shop", "gm-a", A, D).text).toContain("Latest final day (Tue, Oct 6): $");
  });
});

// ── 9. A4-1, the writer rule ─────────────────────────────────────────────────────────────────────

/** The one line a holder reads when the run certified nothing for that shop and day (the store has no entry). */
const NOT_AVAILABLE_LINE = `? ${T("en", "digest.labor_money.label")}: ${T("en", "digest.labor_money.not_available")}`;

// A4-1, the writer rule, UPDATED in the fix round (Astra R6): the settings piece certifies nothing, so it runs even
// with a Toast write pending; the GM's access is decided and, holding hourly cost, the GM reads "Labor cost not
// available" (A4-1's own words: "every labor-money line reads 'Labor cost not available'"). The old expectation here
// ("the GM's email carries no labor-money line") was the old behaviour.
describe("A4-1 (closes A-N4): a source promise (the Toast write) still pending at the phase-0 budget", () => {
  const o: E2EOpts = { run: CLOSING, finalized: BOTH, dir: { who: ["gm-a", "own"] }, before: (h) => h.shop.mode(A, D, { source: "never" }) };
  it("no labor request (ONE settings request, a GM being due); the owner and the GM (hourly cost on) read \"Labor cost not available\"", async () => {
    const on = await run({ ...o, switchOn: true });
    expect(on.db.laborRequests()).toHaveLength(0);
    expect(on.db.settingsRequests()).toHaveLength(1);
    const start = 1_000_000; // CLOCK_START
    expect(on.mails[0]!.at).toBeGreaterThanOrEqual(start + 45_000);
    const u = sections(on.mail("unified", "own").text);
    for (const s of ["Shop A · Labor", "Shop B · Labor"]) {
      expect(u.get(s), s).toContain(NOT_AVAILABLE_LINE);
      expect(u.get(s), s).not.toMatch(/Latest final day \(/);
    }
    const gm = on.mail("gm_shop", "gm-a", A);
    expect(sections(gm.text).get("Labor"), "the GM's Labor section").toContain(NOT_AVAILABLE_LINE);
    expect(gm.text).not.toMatch(/Latest final day \(|Payroll week so far \(|Last full payroll week \(/);
  });
  it("a GM whose settings have hourly cost off: byte-identical to the switch-off email", async () => {
    const on = await run({ ...o, switchOn: true, ...gmSettings(gmOff("hourly_cost")) });
    expect(on.db.laborRequests()).toHaveLength(0);
    const off = await run({ ...o, switchOn: false });
    expectSame(on.mail("gm_shop", "gm-a", A), off.mail("gm_shop", "gm-a", A), "GM (hourly cost off) vs switch off");
    expect(on.mail("unified", "own").text).toContain(NOT_AVAILABLE_LINE);
  });
  it("no GM due: no settings request either", async () => {
    const on = await run({ ...o, switchOn: true, dir: { who: ["own"] } });
    expect(on.db.sent).toHaveLength(0);
    expect(on.mail("unified", "own").text).toContain(NOT_AVAILABLE_LINE);
  });
});

// ── 9b. Astra R3: a write whose outcome is not known ─────────────────────────────────────────────

describe("Astra R3 (P1): a source whose Toast write's outcome is not known (FactsSource) → no labor money in the run", () => {
  const variants: Array<[string, Parameters<Harness["shop"]["mode"]>[2]]> = [
    ["{ writeUncertain: true } (a pull that failed or was cut)", { sourceResult: { writeUncertain: true } }],
    ["a source that rejects", { sourceRejects: true }],
    ["a source resolving undefined (fail closed)", { sourceResult: undefined }],
    ["a source resolving {} (fail closed)", { sourceResult: {} }],
  ];
  it.each(variants)("%s: zero labor requests; every holder reads \"Labor cost not available\" (rendered); every digest is still sent", async (_n, mode) => {
    const h = await run({ run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["gm-a", "moo", "own"] }, db: { laborCostRow: () => SALARY },
      before: (x) => x.shop.mode(A, D, mode) });
    expect(h.db.laborRequests()).toHaveLength(0);
    expect(h.db.settingsRequests()).toHaveLength(1);
    expect(h.mails.map(key).sort()).toEqual([`gm_shop|${D}|${ref("gm-a")}|${A}`, `gm_shop|${D}|${ref("moo")}|${A}`, `unified|${D}|${ref("moo")}|all`, `unified|${D}|${ref("own")}|all`].sort());
    for (const who of ["gm-a", "moo"]) {
      const m = h.mail("gm_shop", who, A);
      expect(sections(m.text).get("Labor"), who).toContain(NOT_AVAILABLE_LINE);
      expect(m.text, who).not.toMatch(/Latest final day \(|Payroll week so far \(|Last full payroll week \(/);
    }
    for (const who of ["moo", "own"]) {
      const u = sections(h.mail("unified", who).text);
      for (const s of ["Shop A · Labor", "Shop B · Labor"]) expect(u.get(s), `${who} ${s}`).toContain(NOT_AVAILABLE_LINE);
    }
  });
  it("the control: a source resolving exactly { writeUncertain: false } prints the figures", async () => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a"] }, before: (x) => x.shop.mode(A, D, { sourceResult: { writeUncertain: false } }) });
    expect(h.mail("gm_shop", "gm-a", A).text).toContain("Latest final day (Tue, Oct 6): $");
  });
});

// ── 9c. Astra R6: access decided once, kept after a later failure ─────────────────────────────────

describe("Astra R6 (P2): the access is decided ONCE and kept when a later failure seals the facts unavailable", () => {
  const throwing = (which: "roles" | "hourly") => (db: LaborDb, clock: FakeClock): LaborMoneyIO => {
    const io = factoryIO(db, clock);
    return which === "roles"
      ? { ...io, roles: () => { throw new Error("roles_factory_failed (synthetic)"); } }
      : { ...io, hourly: () => { throw new Error("hourly_factory_failed (synthetic)"); } };
  };
  it.each(["roles", "hourly"] as const)("lm.%s() throws while its phase's pieces are built: the GM (hourly on, no cost by role) and the MoO read \"Labor cost not available\" on F1–F3, not nothing", async (which) => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a", "moo"] }, ...gmSettings(gmOff("person_cost")), laborIO: throwing(which) });
    for (const who of ["gm-a", "moo"]) {
      const m = h.mail("gm_shop", who, A);
      expect(sections(m.text).get("Labor"), `${which} ${who}`).toContain(NOT_AVAILABLE_LINE);
      expect(m.text, `${which} ${who}`).not.toMatch(/Latest final day \(|Payroll week so far \(|Last full payroll week \(/);
    }
    // The GM never holds cost by role: nothing about it.
    expect(h.mail("gm_shop", "gm-a", A).text).not.toContain(T("en", "digest.labor_money.roles_label_plain"));
  });
});

// ── 9d. A4-3, the ruled OUTCOME (Astra R7 = Fable F5) ────────────────────────────────────────────

describe("A4-3 (Astra R7, Fable F5): overlapping modification-window answers → the NEWER clock-out is what bracket 1 reads", () => {
  const OLDER = "2026-10-06T22:00:00Z", NEWER = "2026-10-06T23:45:00Z";
  /** Each day's pull ALSO rewrites one shared time entry's out_at from its own answer; D − 1's pull is the slow one. */
  const tick = (detached: boolean) => run({
    run: { kind: "tick" }, finalized: { [DM1]: [A], [D]: [A] }, switchOn: true, dir: { who: ["gm-a"] },
    before: (h) => {
      h.shop.mode(A, DM1, { pull: { outAt: OLDER, delayMs: 5_000 }, detached });
      h.shop.mode(A, D, { pull: { outAt: NEWER, delayMs: 100 }, detached });
    },
  });
  it("chained (the engine's order): D's pull starts only after D − 1's source settled, so the stored value after phase 0 is the NEWER one, and every labor read is served against it", async () => {
    const h = await tick(false);
    expect(h.log.first(`shopFacts:start(${A}|${D})`)).toBeGreaterThan(h.log.first(`pull:write(${A}|${DM1}, ${OLDER})`));
    expect(h.log.first(`pull:write(${A}|${D}, ${NEWER})`)).toBeGreaterThan(h.log.first(`pull:write(${A}|${DM1}, ${OLDER})`));
    expect(h.db.entryOutAt).toBe(NEWER);
    const bracket1 = h.db.named("labor_week_coverage");
    expect(bracket1.length).toBeGreaterThan(0);
    expect(bracket1[0]!.outAt).toBe(NEWER);
    expect(new Set(h.db.laborRequests().map((r) => r.outAt))).toEqual(new Set([NEWER]));
  });
  it("the teeth: with the two pulls started together (the source no longer holds the pull), the OLDER value would win", async () => {
    const h = await tick(true);
    expect(h.log.first(`shopFacts:start(${A}|${D})`)).toBeLessThan(h.log.first(`pull:write(${A}|${DM1}, ${OLDER})`));
    expect(h.db.entryOutAt).toBe(OLDER);
    expect(h.db.named("labor_week_coverage")[0]!.outAt).toBe(OLDER);
  });
});

// ── 9e. F1 when no final day can be chosen (the other fixer's chooseLatestFinalDay change) ───────

describe("F1 when no final day can be chosen: \"updating\" unless every payroll week of the window was verified", () => {
  const F1 = T("en", "digest.labor_money.latest_label_plain");
  const f1Of = (h: Harness) => lineOf(h.mail("gm_shop", "moo", A).text, F1);
  it("both weeks STALE in bracket 1 (the fingerprints answer another value) → \"Labor figures are updating\", never \"No final labor day…\"", async () => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["moo"] }, db: {
      laborCostRow: () => SALARY,
      respond: (r) => (r.name === "fact_labor_week_fingerprint" ? { answer: { data: "e".repeat(32) } } : undefined),
    } });
    expect(f1Of(h)).toBe(`? ${F1}: ${T("en", "digest.labor_money.updating")}`);
    expect(h.mail("gm_shop", "moo", A).text).not.toContain(T("en", "digest.labor_money.no_final_day"));
  });
  it("both fingerprints UNANSWERED (never settle) → \"Labor figures are updating\"", async () => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["moo"] }, db: {
      laborCostRow: () => SALARY,
      respond: (r) => (r.name === "fact_labor_week_fingerprint" ? "hang" : undefined),
    } });
    expect(f1Of(h)).toBe(`? ${F1}: ${T("en", "digest.labor_money.updating")}`);
    expect(h.mail("gm_shop", "moo", A).text).not.toContain(T("en", "digest.labor_money.no_final_day"));
  });
  it("both weeks ready and no day final → \"No final labor day in the last 7 days\"", async () => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["moo"] }, db: { laborCostRow: () => ({ days_pending: 1 }) } });
    expect(f1Of(h)).toBe(`? ${F1}: ${T("en", "digest.labor_money.no_final_day")}`);
  });
});

// ── 10. Settings ─────────────────────────────────────────────────────────────────────────────────

describe("phase A, the GM settings", () => {
  it("a settings read that never answers ends at 3 s: the GM gets no labor money, the MoO's lines are intact; ONE settings request", async () => {
    const o: E2EOpts = { run: CLOSING, finalized: ONLY_A, dir: { who: ["gm-a", "moo"] }, db: { laborCostRow: () => SALARY } };
    const h = await run({ ...o, switchOn: true, before: (x) => { x.db.stallSettings = true; } });
    expect(h.db.settingsRequests()).toHaveLength(1);
    const settingsAt = h.db.settingsRequests()[0]!.at;
    const firstLabor = h.db.laborRequests()[0]!.at;
    expect(firstLabor - settingsAt).toBe(3_000);
    const off = await run({ ...o, switchOn: false });
    expectSame(h.mail("gm_shop", "gm-a", A), off.mail("gm_shop", "gm-a", A), "GM");
    const healthy = await run({ ...o, switchOn: true, dir: { who: ["moo"] } });
    expectSame(h.mail("gm_shop", "moo", A), healthy.mail("gm_shop", "moo", A), "MoO");
    expect(h.mail("gm_shop", "moo", A).text).toContain("Latest final day (Tue, Oct 6): $");
  });
  it("one settings request per run even with GMs of both shops on two days; none when no GM is due", async () => {
    const tick = await run({ run: { kind: "tick" }, finalized: { [DM1]: [A, B], [D]: [A, B] }, switchOn: true, dir: { who: ["gm-a", "gm-b", "own"] } });
    expect(tick.db.settingsRequests()).toHaveLength(1);
    const noGm = await run({ run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["moo", "own"] } });
    expect(noGm.db.settingsRequests()).toHaveLength(0);
    expect(noGm.db.laborRequests().length).toBeGreaterThan(0);
  });
});

// ── 11. Read counts (§11.2.7) ────────────────────────────────────────────────────────────────────

describe("read counts (§11.2.7), per shop and day with a permitted recipient", () => {
  const SALES = salesWindows(WP, D).length;
  /** One shop and day, a holder of hourly cost AND of cost by role. */
  const PER_SHOP_DAY: Record<string, number> = {
    // bracket 1: 2 coverage, 2 fingerprints; bracket 2: 2 coverage, 2 fingerprints; the role step: 2 coverage, 1 fingerprint
    labor_week_coverage: 6, fact_labor_week_fingerprint: 5,
    sales_report_daily: SALES, schedule_structures: 1,
    // 7 day costs + up to 2 span costs (the week so far and the last full week)
    fact_labor_cost: 9,
    business_report_labor_people: 1, sevenshifts_roles: 1,
  };
  const counts = (h: Harness) => {
    const out: Record<string, number> = {};
    for (const r of h.db.laborRequests()) out[r.name] = (out[r.name] ?? 0) + 1;
    return out;
  };
  const times = (o: Record<string, number>, n: number) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * n]));

  it("one GM (defaults: hourly + cost by role) at one shop: exactly the bracket / role-step reads, one settings read", async () => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a"] } });
    expect(SALES).toBeGreaterThanOrEqual(1);
    expect(counts(h)).toEqual(PER_SHOP_DAY);
    expect(h.db.settingsRequests()).toHaveLength(1);
    // Per shop: every shop-bearing read is Shop A's.
    expect(h.db.laborRequests().filter((r) => r.shop !== null && r.shop !== A)).toHaveLength(0);
    // Every request carried a stage signal and .retry(false) (O-N4).
    for (const r of h.db.sent) { expect(r.retry, r.name).toBe(false); expect(r.signal, r.name).toBeInstanceOf(AbortSignal); }
  });
  it("a second recipient (the flagged MoO) adds NO request; the unified digest adds none for the same shop and day", async () => {
    const two = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a", "moo"] } });
    expect(counts(two)).toEqual(PER_SHOP_DAY);
    const uni = await run({ run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["gm-a", "gm-b", "moo", "own", "cgs"] } });
    expect(counts(uni)).toEqual(times(PER_SHOP_DAY, 2));
    for (const shop of [A, B]) {
      const mine = uni.db.laborRequests().filter((r) => r.shop === shop);
      const single = two.db.laborRequests().filter((r) => r.shop === A);
      expect(mine.map((r) => r.name).sort(), shop).toEqual(single.map((r) => r.name).sort());
    }
    expect(uni.db.settingsRequests()).toHaveLength(1);
  });
  it("no request after the seal: the counter at the first send equals the counter after the last send, and stays so", async () => {
    const h = await run({ run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["gm-a", "moo", "own"] }, before: (x) => { x.db.stallRoles = true; } });
    expect(h.requestsAtFirstSend).toBe(h.db.sent.length);
    // Nothing is read at compose: every ordinary facts load started before the first claim (phase 0), once per shop-day.
    expect(h.log.last("shopFacts:start")).toBeLessThan(h.log.first("claim("));
    expect(h.shop.calls.map((c) => c.key).sort()).toEqual([`${A}|${D}`, `${B}|${D}`]);
    const n = h.db.sent.length;
    await h.clock.advance(120_000);
    expect(h.db.sent.length).toBe(n);
  });
  it("no role step without a holder of cost by role: hourly reads only", async () => {
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["gm-a"] }, ...gmSettings(gmOff("person_cost")) });
    const hourly = Object.fromEntries(Object.entries(PER_SHOP_DAY).filter(([k]) => k !== "business_report_labor_people" && k !== "sevenshifts_roles"));
    expect(counts(h)).toEqual({ ...hourly, labor_week_coverage: 4, fact_labor_week_fingerprint: 4 });
  });
});

// ── 12. Over target ──────────────────────────────────────────────────────────────────────────────

describe("over target: an issue for a holder, nothing for a non-holder", () => {
  const over = { laborCostRow: (args: Record<string, unknown>) => ({ ...SALARY, ...(args.p_from === LATEST && args.p_to === LATEST ? { hourly_straight_cents: 25_000 } : {}) }) };
  const o = (db: E2EOpts["db"], switchOn = true): E2EOpts => ({ run: CLOSING, finalized: ONLY_A, switchOn, dir: { who: ["gm-a", "moo", "agm"] }, ...{ db: { ...db, visibility: [gmOff("hourly_cost")] } } });
  const issues = (preheader: string) => Number(/(\d+) lines? needs? a look/.exec(preheader)?.[1] ?? 0);
  it("the MoO: the Labor status, the preheader count and the section's '!'", async () => {
    const h = await run(o(over));
    const base = await run(o({ laborCostRow: () => SALARY }));
    const m = h.mail("gm_shop", "moo", A), b = base.mail("gm_shop", "moo", A);
    const labor = sections(m.text).get("Labor")!;
    expect(labor.split("\n")[0]).toMatch(/^Labor — ! /);
    expect(sections(b.text).get("Labor")!.split("\n")[0]).not.toMatch(/^Labor — ! /);
    expect(lineOf(m.text, "Latest final day (Tue, Oct 6)")).toMatch(/^! /);
    expect(issues(m.preheader)).toBe(issues(b.preheader) + 1);
  });
  it("the AGM and a GM without hourly cost: byte-identical to the run without it, and to the switch off", async () => {
    const h = await run(o(over));
    const base = await run(o({ laborCostRow: () => SALARY }));
    const off = await run(o(over, false));
    for (const who of ["agm", "gm-a"]) {
      expectSame(h.mail("gm_shop", who, A), base.mail("gm_shop", who, A), `${who} vs not over`);
      expectSame(h.mail("gm_shop", who, A), off.mail("gm_shop", who, A), `${who} vs off`);
    }
  });
});

// ── the real factory and the hand-built IO agree ─────────────────────────────────────────────────

describe("the hand-built LaborMoneyIO (the samples' IO) and the real buildLaborMoneyIO write the same emails", () => {
  it("a closing run with every recipient", async () => {
    const o: E2EOpts = { run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["gm-a", "gm-b", "moo", "own", "agm", "cat"] }, db: { laborCostRow: () => SALARY } };
    const real = await run(o);
    const hand = await run({ ...o, laborIO: handLaborIO });
    expect(hand.mails.map(key)).toEqual(real.mails.map(key));
    const rb = byKey(real);
    for (const m of hand.mails) expectSame(m, rb.get(key(m))!, key(m));
    expect(hand.db.sent.map((r) => r.name)).toEqual(real.db.sent.map((r) => r.name));
  });
});

// ── 13. Unknown is never zero (across every run above) ───────────────────────────────────────────

describe("unknown is never zero", () => {
  it("a final-day-less week (every day pending): F1 \"No final labor day in the last 7 days\", F2 \"No final day this week yet\"", async () => {
    // No Toast labor and no schedule for D: the Labor section is the five money lines (nothing folds).
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["moo"], es: ["moo"] }, db: { laborCostRow: () => ({ days_pending: 1 }) },
      before: (x) => x.shop.mode(A, D, { bare: true }) });
    const m = h.mail("gm_shop", "moo", A);
    expect(m.text).toContain(T("es", "digest.labor_money.no_final_day"));
    expect(m.text).toContain(T("es", "digest.labor_money.no_final_day_this_week"));
  });
  it("a generation that moves between the brackets: F1 and F4's day part \"Labor figures are updating\", F3 stands", async () => {
    let coverage = 0;
    const moved = { week_start: WD, ot_scope: "per_shop", builder_version: "labor-v3", built_at: "2026-10-07T23:00:00.000Z", source_fingerprint: "f".repeat(32) };
    const h = await run({ run: CLOSING, finalized: ONLY_A, switchOn: true, dir: { who: ["moo"] }, db: {
      laborCostRow: () => SALARY,
      respond: (r) => (r.name === "labor_week_coverage" && ++coverage >= 3 ? { rows: [{ ...moved, week_start: WP, built_at: "2026-10-07T05:00:00.000Z" }, moved] } : undefined),
    } });
    const m = h.mail("gm_shop", "moo", A);
    expect(lineOf(m.text, T("en", "digest.labor_money.latest_label_plain"))).toBe(`? ${T("en", "digest.labor_money.latest_label_plain")}: ${T("en", "digest.labor_money.updating")}`);
    expect(m.text).toContain("Last full payroll week (Sun, Sep 27 to Sat, Oct 3)");
  });
  it("no labor-money line of any email of this file prints $0.00, 0% or 0 h for a part that is unavailable / updating / none", () => {
    const UNKNOWN_KEYS: TranslationKey[] = ["digest.labor_money.not_available", "digest.labor_money.roles_not_available", "digest.labor_money.updating",
      "digest.labor_money.week_updating", "digest.labor_money.no_final_day"];
    const seen = new Set<string>();
    let parts = 0;
    for (const h of RUNS) {
      for (const m of h.mails) {
        for (const lang of ["en", "es"] as const) {
          const labels = MONEY_LABEL_KEYS.map((k) => T(lang, k));
          const sentences = UNKNOWN_KEYS.map((k) => T(lang, k));
          for (const line of m.text.split("\n")) {
            const body = line.slice(2);
            if (!labels.some((l) => body.startsWith(l))) continue;
            for (const seg of body.split(" · ")) {
              const s = sentences.find((x) => seg.includes(x));
              if (!s) continue;
              parts++;
              seen.add(s);
              expect(seg, `${key(m)}: ${line}`).not.toMatch(/\$0\.00|(^|[^\d.,])0 ?%|(^|[^\d.,])0 h\b/);
            }
          }
        }
      }
    }
    expect(parts).toBeGreaterThan(20);
    for (const k of UNKNOWN_KEYS) expect(seen.has(T("en", k)) || seen.has(T("es", k)), k).toBe(true);
  });
  it("the WD / WP constants are the payroll weeks the fixture builds", () => {
    expect([WP, WD, LAST_SAT]).toEqual(["2026-09-27", "2026-10-04", "2026-10-03"]);
  });
});

// ── fix round 2 (CC addendum 2026-11-28): D-1 and D-4 through the real engine, pieces and composers ──

describe("D-1 (P1), Astra's case end to end: the first day's pull is UNCERTAIN → the second day's pull never runs in this run", () => {
  const OLDER = "2026-10-06T22:00:00Z", NEWER = "2026-10-06T23:45:00Z";
  /** Each day's pull rewrites one shared time entry's out_at from its own answer (the A4-3 fixture); D − 1's is the slow one. */
  const tick = (firstDay: Parameters<Harness["shop"]["mode"]>[2]) => run({
    run: { kind: "tick" }, finalized: { [DM1]: [A], [D]: [A] }, switchOn: true, dir: { who: ["gm-a"] },
    before: (h) => {
      h.shop.mode(A, DM1, { pull: { outAt: OLDER, delayMs: 5_000 }, ...firstDay });
      h.shop.mode(A, D, { pull: { outAt: NEWER, delayMs: 100 } });
    },
  });

  it("D − 1's pull ends uncertain: D's facts are never asked for, so D's pull writes NOTHING; no labor request; D − 1's digest is sent and D's is held for the next tick", async () => {
    const h = await tick({ sourceResult: { writeUncertain: true } });
    expect(h.log.first(`shopFacts:start(${A}|${D})`)).toBe(-1);
    expect(h.log.first(`pull:write(${A}|${D}, ${NEWER})`)).toBe(-1);
    // The one write of the run is the uncertain day's own: there is no newer value for a late commit to land over.
    expect(h.db.entryOutAt).toBe(OLDER);
    expect(h.db.laborRequests()).toHaveLength(0);
    expect(h.mails.map(key)).toEqual([`gm_shop|${DM1}|${ref("gm-a")}|${A}`]);
    const held = h.store.rows.filter((r) => r.kind === "gm_shop" && r.business_day === D);
    expect(held.map((r) => r.outcome)).toEqual(["failed"]);
    expect(held[0]!.error ?? "").toContain("ordinary_facts_pull_uncertain");
  });

  it("the control: a healthy D − 1 → D's pull runs after it, the newer value stands and both digests are sent", async () => {
    const h = await tick({});
    expect(h.log.first(`pull:write(${A}|${D}, ${NEWER})`)).toBeGreaterThan(h.log.first(`pull:write(${A}|${DM1}, ${OLDER})`));
    expect(h.db.entryOutAt).toBe(NEWER);
    expect(h.mails.map(key).sort()).toEqual([`gm_shop|${DM1}|${ref("gm-a")}|${A}`, `gm_shop|${D}|${ref("gm-a")}|${A}`].sort());
  });
});

describe("D-4 (P2) end to end: Shop B has no Toast connection", () => {
  /** As the real loader reports it: the labor area `labor_not_connected`, the source `{ writeUncertain: false, notConnected: true }`. */
  const NOT_CONNECTED = { notConnected: true };
  const o: E2EOpts = { run: CLOSING, finalized: BOTH, switchOn: true, dir: { who: ["gm-a", "moo", "own"] }, db: { laborCostRow: () => SALARY } };

  for (const language of ["en", "es"] as const) {
    it(`Shop A's labor money is printed exactly as on a healthy night; Shop B's ONE line says it is not connected; no labor request is made for Shop B (${language})`, async () => {
      const dir = { who: ["gm-a", "moo", "own"] as const, es: language === "es" ? (["gm-a", "moo", "own"] as const) : [] };
      const healthy = await run({ ...o, dir });
      const h = await run({ ...o, dir, before: (x) => x.shop.mode(B, D, NOT_CONNECTED) });
      const said = T(language, "digest.labor_money.not_connected");
      const label = T(language, "digest.labor_money.label");
      for (const who of ["moo", "own"]) {
        const text = h.mail("unified", who).text;
        const u = sections(text);
        const titles = [...u.keys()];
        const aTitle = titles.find((t) => t.startsWith("Shop A · ") && u.get(t)!.includes(T(language, "digest.labor_money.latest_label_plain")))!;
        expect(aTitle, who).toBeDefined();
        // Shop A's Labor section is byte-identical to the night on which both shops are connected.
        expect(u.get(aTitle), who).toBe(sections(healthy.mail("unified", who).text).get(aTitle));
        expect(u.get(aTitle), who).toContain("$");
        const b = u.get(aTitle.replace("Shop A", "Shop B"))!;
        expect(b, who).toBeDefined();
        expect(bullets(b).filter((l) => l.includes(said)), who).toHaveLength(1);
        expect(b, who).toContain(`${label}: ${said}`);
        // Not an unknown ("? …") and not an issue ("! …"): nothing failed.
        expect(b, who).not.toContain(`? ${label}`);
        expect(b, who).not.toContain(`! ${label}`);
        for (const w of [T(language, "digest.labor_money.not_available"), T(language, "digest.labor_money.roles_not_available"), ...GROUP(language).hourly, ...GROUP(language).loaded, ...GROUP(language).roles]) {
          expect(b, `${who}: ${w}`).not.toContain(w);
        }
        // Said once in the whole email.
        expect(text.split(said).length - 1, who).toBe(1);
      }
      // Shop A's own digests do not show Shop B at all: byte-identical.
      for (const who of ["gm-a", "moo"]) expectSame(h.mail("gm_shop", who, A), healthy.mail("gm_shop", who, A), who);
      // Every labor request of the run is Shop A's (or names no shop); the healthy night asks for Shop B too.
      expect(h.db.laborRequests().filter((r) => r.shop === B)).toHaveLength(0);
      expect(healthy.db.laborRequests().filter((r) => r.shop === B).length).toBeGreaterThan(0);
      expect(h.db.laborRequests().filter((r) => r.shop === A).length).toBe(healthy.db.laborRequests().filter((r) => r.shop === A).length);
      // Composing read nothing.
      expect(h.requestsAtFirstSend).toBe(h.db.sent.length);
    });
  }

  it("a GM of the unconnected shop reads that one line in its own shop digest; an AGM's email is the switch-off email", async () => {
    const base: E2EOpts = { run: { kind: "closing", locationId: B }, finalized: BOTH, dir: { who: ["gm-b", "own"] }, db: { laborCostRow: () => SALARY } };
    const h = await run({ ...base, switchOn: true, before: (x) => x.shop.mode(B, D, NOT_CONNECTED) });
    const labor = sections(h.mail("gm_shop", "gm-b", B).text).get("Labor")!;
    expect(labor).toContain(`${T("en", "digest.labor_money.label")}: ${T("en", "digest.labor_money.not_connected")}`);
    expect(labor).not.toContain(T("en", "digest.labor_money.not_available"));
    const withAgm: E2EOpts = { run: CLOSING, finalized: BOTH, dir: { who: ["agm", "own"] }, db: { laborCostRow: () => SALARY } };
    const on = await run({ ...withAgm, switchOn: true, before: (x) => x.shop.mode(A, D, NOT_CONNECTED) });
    const off = await run({ ...withAgm, switchOn: false, before: (x) => x.shop.mode(A, D, NOT_CONNECTED) });
    expectSame(on.mail("gm_shop", "agm", A), off.mail("gm_shop", "agm", A), "agm");
    expect(on.mail("gm_shop", "agm", A).text).not.toContain(T("en", "digest.labor_money.not_connected"));
  });
});
