/**
 * Digest PR 2, packet F — the ENGINE with the REAL schedule reader behind `io.shopFacts` / `io.cateringFacts`
 * (plan §11.1.6 S6, §13.1.4 S10; the lead's review finding "a slow first shop blanks the second"). One reader per
 * run, as `buildIO` (lib/report-digests.ts) makes it; a fake `fetch` answering literal text; the in-memory send
 * store; recipients resolved by `resolveDigestRecipients` inside the engine. No network, no email: the "sender"
 * records what it was handed.
 *
 * Synthetic only: shops "Shop A" / "Shop B", 7shifts people "Person Q" / "Person R" in the mirror, made-up ids.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { ShopDayFacts } from "@/lib/report-digests-compose";
import { runDigestTickWith, type ClaimRow, type DigestIO } from "@/lib/report-digests-engine";
import { createScheduleReader, SCHEDULE_WINDOW_MS, type ServiceRoleClient } from "@/lib/report-digests-schedule";
import type { ScheduleReader, ShopSchedule } from "@/lib/report-digests-schedule-shared";
import { DEFAULT_DIGEST_SETTINGS, type DigestDirectory, type DigestSettings, type RecipientOverride } from "@/lib/report-digests-shared";
import { ok, salesDetailTotals, type Loaded, type SalesDetailFacts } from "@/lib/report-digests-v2-shared";
import type { SevenShiftsFetch } from "@/lib/sevenshifts/client";
import type { DailyRaw } from "@/lib/sales-reports-shared";
import { A, B, BASE, cateringFacts, labor, lead, SHOP_A, SHOP_B, shopFacts } from "./fixtures/digest-staffing";
import { COMPANY, SHOP_A_7S, SHOP_B_7S, VALID_WHOAMI, shiftRow, validAnswerBody, type StaffingResponse } from "./fixtures/digest/staffing-cases";

const ENV = { SEVENSHIFTS_ACCESS_TOKEN: "tok_FAKE_do_not_leak", SEVENSHIFTS_SYNC: "1" };
const D = "2026-03-01";
const D1 = "2026-03-02";
const D2 = "2026-03-03";
/** The evening of D in ET (EST, UTC−5): 23:30 ET. Both closings of D are finalized; the catering digest of D is due. */
const EVENING_OF_D = "2026-03-02T04:30:00Z";
/** 03:30 ET on D+1: the 03:00 fallback of D has passed. */
const FALLBACK_OF_D = "2026-03-02T08:30:00Z";
/** start[gte] of the window [D, D+1] (CASE_REQUEST). */
const GTE_D = "2026-03-01T05:00:00Z";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const nextDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
};

// ── the fake mirror and the fake 7shifts ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const MIRROR = {
  links: [{ location_id: A, sevenshifts_location_id: Number(SHOP_A_7S), active: true }, { location_id: B, sevenshifts_location_id: SHOP_B_7S, active: true }] as Row[],
  locations: [{ id: Number(SHOP_A_7S), company_id: Number(COMPANY) }, { id: SHOP_B_7S, company_id: COMPANY }] as Row[],
  users: [{ id: 11, first_name: "Person Q", preferred_first_name: null }, { id: 12, first_name: "Person R", preferred_first_name: null }] as Row[],
  roles: [{ id: 21, name: "Cook" }] as Row[],
};
function fakeDb(): ServiceRoleClient {
  return {
    from(table: string) {
      const q = { select: "", eq: {} as Record<string, unknown>, in: [] as unknown[] };
      const b: Record<string, unknown> = {
        select: (c: string) => { q.select = c; return b; },
        eq: (c: string, v: unknown) => { q.eq[c] = v; return b; },
        in: (_c: string, v: unknown[]) => { q.in = v; return b; },
        order: () => b,
        abortSignal: () => b,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          let rows: Row[] = [];
          if (table === "sevenshifts_location_links") rows = MIRROR.links.filter((r) => r.location_id === q.eq.location_id && r.active === q.eq.active);
          else if (table === "sevenshifts_locations") rows = MIRROR.locations.filter((r) => String(r.id) === String(q.eq.id));
          else {
            const want = new Set(q.in.map(String));
            const cols = q.select.split(",").map((c) => c.trim());
            rows = (table === "sevenshifts_users" ? MIRROR.users : MIRROR.roles).filter((r) => want.has(String(r.id))).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  } as unknown as ServiceRoleClient;
}

const enc = new TextEncoder();
const respond = (r: StaffingResponse) => new Response(enc.encode(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });

/** Window [D, D+1]: Person Q at Shop A on D and on D+1, Person R at Shop B on D+1, one open shift at A on D+1. */
const PAGE_D: StaffingResponse = {
  status: 200,
  body: validAnswerBody({ rows: [shiftRow("A"), shiftRow("A", { id: "1002", start: `"2026-03-02T14:00:00Z"`, end: `"2026-03-02T22:00:00Z"` }), shiftRow("B"), shiftRow("OPEN")] }),
};
/** Window [D+1, D+2]: only rows that start inside it. */
const PAGE_D1: StaffingResponse = {
  status: 200,
  body: validAnswerBody({ rows: [shiftRow("A", { id: "1002", start: `"2026-03-02T14:00:00Z"`, end: `"2026-03-02T22:00:00Z"` }), shiftRow("B"), shiftRow("OPEN")] }),
};

interface Net { fetch: SevenShiftsFetch; whoami: () => number; pages: () => number; all: () => number }
function fakeNet(opts: { pageQueue?: StaffingResponse[]; dead?: boolean } = {}): Net {
  const urls: URL[] = [];
  const queue = opts.pageQueue ? [...opts.pageQueue] : null;
  const fetch: SevenShiftsFetch = async (url) => {
    const u = new URL(url);
    urls.push(u);
    if (opts.dead) return new Promise<Response>(() => {});
    if (u.pathname === "/v2/whoami") return respond(VALID_WHOAMI);
    if (queue && queue.length > 0) return respond(queue.shift()!);
    return respond(u.searchParams.get("start[gte]") === GTE_D ? PAGE_D : PAGE_D1);
  };
  return {
    fetch,
    whoami: () => urls.filter((u) => u.pathname === "/v2/whoami").length,
    pages: () => urls.filter((u) => u.pathname.endsWith("/shifts")).length,
    all: () => urls.length,
  };
}

// ── the directory (the recipients test's shape, this test's shops) ─────────────────────────────

const ov = (userId: string, over: Partial<RecipientOverride>): RecipientOverride =>
  ({ id: `o-${userId}`, kind: "internal", userId, email: null, displayName: userId, active: true, cateringDigest: false, shopDigest: false, locationIds: null, ...over });
const DIR: DigestDirectory = {
  users: [
    { id: "agm-u", name: "U1", email: "agm-u@example.com", role: "agm", language: "en", active: true },
    { id: "agm-f", name: "U2", email: "agm-f@example.com", role: "agm", language: "en", active: true },
    { id: "cat-x", name: "U5", email: "cat-x@example.com", role: "catering_mgr", language: "es", active: true },
    { id: "gm-a", name: "U8", email: "gm-a@example.com", role: "gm", language: "es", active: true },
    { id: "gm-b", name: "U12", email: "gm-b@example.com", role: "gm", language: "en", active: true },
    { id: "moo", name: "U9", email: "moo@example.com", role: "moo", language: "en", active: true },
    { id: "smm", name: "U10", email: "smm@example.com", role: "social_media_mgr", language: "en", active: true },
  ],
  memberships: [
    { userId: "agm-u", locationId: A }, { userId: "agm-f", locationId: A }, { userId: "gm-a", locationId: A },
    { userId: "gm-b", locationId: B }, { userId: "smm", locationId: A },
  ],
  overrides: [ov("agm-f", { shopDigest: true, cateringDigest: true }), ov("smm", { shopDigest: true, cateringDigest: true })],
  locationIds: [A, B],
};
/** Who may read the published schedule in what they are sent; the rest must not be able to tell it exists. */
const REFUSED_TO = ["cat-x@example.com", "smm@example.com"];

function dailyRaw(day: string): DailyRaw {
  return {
    classes: [{ business_date: day, sale_class: "sale", checks: 40, amount_cents: 600000, tax_cents: 64200, amount_missing: 0, tax_missing: 0,
      gross_cents: 665500, discounts_comps_cents: 31000, voids_cents: 4500, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [{ business_date: day, tip_cents: 61200, tip_missing: 0 }],
    discounts: [{ business_date: day, count: 5, cents: 31000, amount_missing: 0 }],
    refunds: [{ business_date: day, count: 3, refund_cents: 12000, refund_tip_cents: 0, sales_refund_cents: 12000, sales_refund_missing: 0 }],
    captured_days: [day],
    ezcater: [],
  };
}
const salesDetail = (day: string): SalesDetailFacts => ({ totals: ok(salesDetailTotals(dailyRaw(day), day)), channels: ok([]), hours: ok([]), servers: ok([]) });

// ── the run ─────────────────────────────────────────────────────────────────────────────────────

interface Mail { to: string; subject: string; html: string; text: string }
interface Ask { location: string; from: string; to: string; startedAt: number; endedAt: number; kind: string }

interface RunOpts {
  now: string;
  net: Net;
  settings?: Partial<DigestSettings>;
  finalized?: Readonly<Record<string, readonly string[]>>;
  /** Called inside io.shopFacts after the shop's schedule ask, before the facts are returned. */
  afterShopAsk?: (locationId: string) => Promise<void>;
  onShopFactsStart?: (locationId: string) => void;
}

async function runTick(o: RunOpts) {
  const sent: Mail[] = [];
  let seq = 0;
  const held = new Set<string>();
  const store = {
    claim: async (row: ClaimRow) => {
      const key = [row.recipient_ref, row.kind, row.business_day, row.location_id ?? ""].join("|");
      if (held.has(key)) return "duplicate" as const;
      held.add(key);
      return { id: `row-${++seq}` };
    },
    reclaim: async () => false, markAttempt: async () => true, recordAccepted: async () => true, finish: async () => true, skip: async () => {},
  };
  const counter = { requests: 0 };
  // ONE reader for the run, as buildIO makes it. Every ask is recorded with the time it took on the run's clock.
  const real = createScheduleReader(fakeDb(), { env: ENV, fetch: o.net.fetch, counter });
  const asks: Ask[] = [];
  const reader: ScheduleReader = {
    async shopWindow(location, from, to) {
      const startedAt = Date.now();
      const r = await real.shopWindow(location, from, to);
      asks.push({ location, from, to, startedAt, endedAt: Date.now(), kind: r.kind });
      return r;
    },
  };
  const factsSeen: unknown[] = [];
  const io: DigestIO = {
    now: new Date(o.now), baseUrl: BASE,
    previewRecipient: async () => null,
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live", ...o.settings }),
    directory: async () => ({ dir: DIR, locations: [SHOP_A, SHOP_B] }),
    sendLog: async () => [],
    finalizedClosings: async (days) => new Map(days.map((d) => [d, new Set(o.finalized?.[d] ?? [])])),
    shopFacts: async (l, day): Promise<ShopDayFacts> => {
      o.onShopFactsStart?.(l.id);
      const schedule: Loaded<ShopSchedule> = await reader.shopWindow(l.id, day, nextDay(day));
      await o.afterShopAsk?.(l.id);
      const f = { ...shopFacts(l, { labor: ok(labor()), salesDetail: salesDetail(day), lookahead: nextDay(day) }, schedule), day };
      factsSeen.push(f);
      return f;
    },
    cateringFacts: async (today) => {
      const tomorrow = nextDay(today);
      const schedule = Object.fromEntries(await Promise.all([A, B].map(async (id) => [id, await reader.shopWindow(id, today, tomorrow)] as const)));
      const f = cateringFacts([lead("a1", A, today), lead("a2", A, tomorrow), lead("b1", B, today), lead("b2", B, tomorrow)], schedule, { today });
      factsSeen.push(f);
      return f;
    },
    store,
    sendEmail: async (m) => { sent.push({ to: m.to, subject: m.subject, html: m.html, text: m.text }); return { id: `mail-${sent.length}` }; },
    sha: (c) => String(c.length),
    alert: async () => false,
    recordRun: async () => {},
  };
  const summary = await runDigestTickWith(io);
  return { sent, summary, counter, asks, factsSeen };
}

/** Drive a tick under fake timers until it settles (each step lets the fake clock move 500 ms). */
async function settle<T>(p: Promise<T>, maxMs = 120_000): Promise<T> {
  let done = false;
  let out: T | undefined;
  let err: unknown;
  void p.then((v) => { done = true; out = v; }, (e) => { done = true; err = e; });
  for (let t = 0; !done && t < maxMs; t += 500) await vi.advanceTimersByTimeAsync(500);
  if (!done) throw new Error("the tick did not settle");
  if (err) throw err;
  return out!;
}

const kindOf = (m: Mail) => m.subject.startsWith("Catering") ? "catering" : /^(All shops|Resumen de todas)/.test(m.subject) ? "unified"
  : m.subject.includes("Shop A") ? "shop_a" : m.subject.includes("Shop B") ? "shop_b" : "other";
const languageOf = (to: string): Language => DIR.users.find((u) => u.email === to)!.language as Language;
const label = (l: Language) => serverT(l, "digest.staffing.label");
const na = (l: Language) => serverT(l, "digest.staffing.not_available");

/** Settings for the evening of D: the fallback of D−1 is not yet due, so the tick asks ONE window. */
const EVENING = { now: EVENING_OF_D, settings: { unifiedFallbackTimeEt: "23:59" }, finalized: { [D]: [A, B] } } as const;

// ── 1. one read per run (S6) ────────────────────────────────────────────────────────────────────

describe("S6: one read per run, however many recipients and digests", () => {
  it("the evening of D: shop digests of D at A and B, the unified digest, the catering digest of D → 1 whoami + 1 page", async () => {
    const net = fakeNet();
    const r = await runTick({ ...EVENING, net });
    const kinds = new Set(r.sent.map(kindOf));
    expect([...kinds].sort()).toEqual(["catering", "shop_a", "shop_b", "unified"]);
    expect(new Set(r.sent.map((m) => m.to)).size).toBeGreaterThanOrEqual(4);
    // Every ask was the same window.
    expect(new Set(r.asks.map((a) => `${a.from}|${a.to}`))).toEqual(new Set([`${D}|${D1}`]));
    expect(r.asks.length).toBeGreaterThanOrEqual(4);
    expect(net.whoami()).toBe(1);
    expect(net.pages()).toBe(1);
    expect(r.counter.requests).toBe(2);
    expect(net.all()).toBe(2);
  });

  it("the same tick with one 429 on the page → 3 HTTP requests", async () => {
    const net = fakeNet({ pageQueue: [{ status: 429, headers: { "retry-after": "0" }, body: `{"error":"rate"}` }] });
    const r = await runTick({ ...EVENING, net });
    expect(r.asks.every((a) => a.kind === "ok")).toBe(true);
    expect(net.whoami()).toBe(1);
    expect(net.pages()).toBe(2);
    expect(r.counter.requests).toBe(3);
  });
});

// ── 2. two windows ──────────────────────────────────────────────────────────────────────────────

describe("the 03:00 fallback tick asks two windows", () => {
  it("shop digests of D ([D, D+1]) and the catering digest of D+1 ([D+1, D+2]) → 1 whoami, 2 pages", async () => {
    const net = fakeNet();
    const r = await runTick({ now: FALLBACK_OF_D, net, settings: { unifiedFallbackTimeEt: "03:00", cateringTimeEt: "03:00" }, finalized: { [D]: [A] } });
    expect(new Set(r.asks.map((a) => `${a.from}|${a.to}`))).toEqual(new Set([`${D}|${D1}`, `${D1}|${D2}`]));
    expect(r.sent.some((m) => kindOf(m) === "catering")).toBe(true);
    expect(r.sent.some((m) => kindOf(m) === "unified")).toBe(true);
    expect(r.asks.every((a) => a.kind === "ok")).toBe(true);
    expect(net.whoami()).toBe(1);
    expect(net.pages()).toBe(2);
    expect(r.counter.requests).toBe(3);
  });
});

// ── 3. a slow first shop does not blank the second (lead review regression) ────────────────────

describe("a slow first shop does not blank the second", () => {
  it("shop A's facts take 30 s after its ask; shop B then asks the SAME window → ok, its roster prints, NO new HTTP request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T04:30:00Z"));
    const net = fakeNet();
    let requestsWhenBAsked = -1;
    let bAskedAt = -1;
    let aDoneAt = -1;
    const p = runTick({
      ...EVENING, net,
      onShopFactsStart: (id) => { if (id === B && requestsWhenBAsked < 0) { requestsWhenBAsked = net.all(); bAskedAt = Date.now(); } },
      // Shop A's other facts (a Toast pull, say) take 30 s after its schedule ask settled.
      afterShopAsk: async (id) => { if (id === A && aDoneAt < 0) { await vi.advanceTimersByTimeAsync(30_000); aDoneAt = Date.now(); } },
    });
    const r = await settle(p);
    expect(bAskedAt - aDoneAt).toBeGreaterThanOrEqual(0);
    // B asks well past the 6 s of A's ask (the window's first ask): only an ask-owned deadline can serve it.
    const firstA = r.asks.find((a) => a.location === A && a.from === D)!;
    expect(bAskedAt - firstA.startedAt).toBeGreaterThanOrEqual(30_000);
    const bAsks = r.asks.filter((a) => a.location === B && a.from === D);
    expect(bAsks.length).toBeGreaterThan(0);
    expect(bAsks.every((a) => a.kind === "ok"), JSON.stringify(r.asks)).toBe(true);
    // No new HTTP request for B: the page and whoami of A's ask were reused.
    expect(requestsWhenBAsked).toBe(2);
    expect(net.all()).toBe(2);
    // Shop B's GM reads Person R on D+1.
    const gmB = r.sent.filter((m) => m.to === "gm-b@example.com" && kindOf(m) === "shop_b");
    expect(gmB).toHaveLength(1);
    expect(gmB[0]!.text).toContain("Person R");
    expect(gmB[0]!.text).not.toContain(na("en"));
  });
});

// ── 4. a dead 7shifts ───────────────────────────────────────────────────────────────────────────

describe("a dead 7shifts does not hold or change the digest", () => {
  it("fetch never answers → every digest is still sent, permitted recipients read \"not available\", refused recipients' emails are byte-identical; ≤ 6 s per ask", async () => {
    const healthy = await runTick({ ...EVENING, net: fakeNet() });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T04:30:00Z"));
    const deadNet = fakeNet({ dead: true });
    const dead = await settle(runTick({ ...EVENING, net: deadNet }));
    const key = (m: Mail) => `${m.to}|${m.subject}`;
    // The same emails went out, to the same people.
    expect(dead.sent.map(key).sort()).toEqual(healthy.sent.map(key).sort());
    expect(dead.sent.length).toBeGreaterThanOrEqual(4);
    // Bounded: no ask spent more than 6 s of the run's clock.
    expect(dead.asks.length).toBeGreaterThan(0);
    for (const a of dead.asks) {
      expect(a.kind).not.toBe("ok");
      expect(a.endedAt - a.startedAt, JSON.stringify(a)).toBeLessThanOrEqual(SCHEDULE_WINDOW_MS);
    }
    // whoami was asked once (and failed for the run); no page was asked.
    expect(deadNet.whoami()).toBe(1);
    expect(deadNet.pages()).toBe(0);
    for (const m of dead.sent) {
      const lang = languageOf(m.to);
      const twin = healthy.sent.find((h) => key(h) === key(m))!;
      if (REFUSED_TO.includes(m.to)) {
        expect(m.html, key(m)).toBe(twin.html);
        expect(m.text, key(m)).toBe(twin.text);
        expect(m.text).not.toContain(label(lang));
      } else {
        expect(m.text, key(m)).toContain(`${label(lang)}: ${na(lang)}`);
        expect(m.text).not.toContain("Person Q");
        expect(m.text).not.toContain("Person R");
      }
    }
  });
});

// ── 5. through recipient resolution ─────────────────────────────────────────────────────────────

describe("through recipient resolution, in the same tick", () => {
  it("flagged AGM: roster + sales detail; unflagged AGM: nothing; catering manager with no membership: no staffing line; level 8: every shop's roster", async () => {
    const r = await runTick({ ...EVENING, net: fakeNet() });
    const of = (to: string, kind: string) => r.sent.filter((m) => m.to === to && kindOf(m) === kind);
    // The flagged AGM's shop digest of Shop A: the roster (Person Q on D+1) and PR 3's sales detail.
    const agm = of("agm-f@example.com", "shop_a");
    expect(agm).toHaveLength(1);
    for (const body of [agm[0]!.text, agm[0]!.html]) {
      expect(body).toContain("Staff scheduled");
      expect(body).toContain("Person Q");
      expect(body).toContain("Scheduled vs worked");
      expect(body).toContain("Toast net");
      expect(body).not.toContain("Person R");
    }
    // The unflagged AGM gets no email at all.
    expect(r.sent.filter((m) => m.to === "agm-u@example.com")).toEqual([]);
    // The catering manager with no membership: a catering digest, no staffing line, the stations suffix kept.
    const cat = of("cat-x@example.com", "catering");
    expect(cat).toHaveLength(1);
    for (const body of [cat[0]!.text, cat[0]!.html]) {
      expect(body).not.toContain(label("es"));
      expect(body).not.toContain("Person Q");
      expect(body).not.toContain("Person R");
      expect(body).toContain(serverT("es", "digest.catering.schedule_not_connected"));
    }
    // Level 8: the unified digest names every shop's D+1 roster.
    const uni = of("moo@example.com", "unified");
    expect(uni).toHaveLength(1);
    for (const body of [uni[0]!.text, uni[0]!.html]) {
      expect(body.match(/Staff scheduled/g)?.length).toBe(2);
      expect(body).toContain("Person Q");
      expect(body).toContain("Person R");
      expect(body).not.toContain(na("en"));
    }
    // The social media manager: none of it.
    for (const m of r.sent.filter((x) => x.to === "smm@example.com")) for (const w of ["Staff scheduled", "Person Q", "Person R", "Toast net"]) expect(m.text).not.toContain(w);
  });
});
