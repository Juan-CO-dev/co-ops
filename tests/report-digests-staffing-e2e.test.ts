/**
 * Digest PR 2, packet F — the pieces TOGETHER: a literal 7shifts answer → the REAL reader (real client, real
 * bounded read, real `pageStep`, real check and normalizer) → the facts → the REAL composers → rendered HTML and
 * text (plan §11.1.6, §13.1.4, §15.1.3; addendum A2-3, A2-6 (i)).
 *
 * THE CLOSING RULE (plan §15.1.1):
 * > Nothing from 7shifts is used unless it is consistent with the request that was sent AND valid in its written form; anything else refuses that company and window and prints "not available".
 *
 * Every case is judged on what a PERSON reads: the subject, the hidden preheader, the HTML and the text of the shop
 * digest (a GM of Shop A, and an owner for Shop A and Shop B), the unified digest and the catering digest (an owner
 * whose delivery names both shops), in English and Spanish. Synthetic only: shops "Shop A" / "Shop B", people
 * "Person Q" / "Person R" / "Person Z" in the 7shifts mirror (distinct from the Toast-labor and stations fixtures'
 * "Person A", so a name found in an email can only have come from the schedule), made-up ids. No network, no email.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { digestAccessFor, type DigestDelivery } from "@/lib/report-digests-access-shared";
import { renderCateringDigest, renderShopDigest, renderUnifiedDigest, type CateringFacts, type ShopDayFacts } from "@/lib/report-digests-compose";
import type { LinkViewer } from "@/lib/report-digests-links";
import { createScheduleReader, SCHEDULE_PAGE_MAX_BYTES, type ServiceRoleClient } from "@/lib/report-digests-schedule";
import type { DayRoster, ShopSchedule } from "@/lib/report-digests-schedule-shared";
import { ok, type Loaded } from "@/lib/report-digests-v2-shared";
import type { SevenShiftsFetch } from "@/lib/sevenshifts/client";
import { A, B, BASE, cateringFacts, labor, lead, SHOP_A, SHOP_B, shopFacts } from "./fixtures/digest-staffing";
import {
  COMPANY, SHOP_A_7S, SHOP_B_7S, STAFFING_CASES, VALID_WHOAMI, shiftRow, validAnswerBody,
  type StaffingResponse,
} from "./fixtures/digest/staffing-cases";

const TOKEN = "tok_FAKE_do_not_leak";
const ENV = { SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "1" };
/** The window of CASE_REQUEST: ET days 2026-03-01 .. 2026-03-02. */
const D = "2026-03-01";
const D1 = "2026-03-02";
const C = "cccccccc-0000-4000-8000-000000000003";
const LANGS = ["en", "es"] as const;
const enc = new TextEncoder();
const str = (s: string) => JSON.stringify(s);

afterEach(() => {
  vi.restoreAllMocks();
});

// ── the fake mirror (the reader test's shape) ───────────────────────────────────────────────────

type Row = Record<string, unknown>;
interface Mirror { links?: Row[]; locations?: Row[]; users?: Row[]; roles?: Row[] }
const MIRROR: Required<Mirror> = {
  links: [{ location_id: A, sevenshifts_location_id: Number(SHOP_A_7S), active: true }, { location_id: B, sevenshifts_location_id: SHOP_B_7S, active: true }],
  locations: [{ id: Number(SHOP_A_7S), company_id: Number(COMPANY) }, { id: SHOP_B_7S, company_id: COMPANY }],
  users: [
    { id: 11, first_name: "Person Qfirst", preferred_first_name: "Person Q", last_name: "NEVER-SELECTED" },
    { id: "12", first_name: "Person R", preferred_first_name: null, last_name: "NEVER-SELECTED" },
    // A2-3: the person a `42.0000000000000001` would name if it were ever read as 42.
    { id: 42, first_name: "Person Z", preferred_first_name: null, last_name: "NEVER-SELECTED" },
  ],
  roles: [{ id: 21, name: "Cook" }],
};
/** Every name and role the mirror could put in an email. */
const MIRROR_WORDS = ["Person Q", "Person R", "Person Z", "Qfirst", "NEVER-SELECTED", "(Cook)"];

function fakeDb(m: Mirror = {}): ServiceRoleClient {
  const data = { ...MIRROR, ...m };
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
          if (table === "sevenshifts_location_links") rows = data.links.filter((r) => r.location_id === q.eq.location_id && r.active === q.eq.active);
          else if (table === "sevenshifts_locations") rows = data.locations.filter((r) => String(r.id) === String(q.eq.id));
          else if (table === "sevenshifts_users" || table === "sevenshifts_roles") {
            const want = new Set(q.in.map(String));
            const cols = q.select.split(",").map((c) => c.trim());
            rows = (table === "sevenshifts_users" ? data.users : data.roles).filter((r) => want.has(String(r.id))).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  } as unknown as ServiceRoleClient;
}

// ── the fake 7shifts: literal response TEXT (A2-3: written forms survive to the bounded read) ───

const respond = (r: StaffingResponse) => new Response(enc.encode(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
type Route = (url: URL) => Response | Promise<Response>;
function fakeNet(shifts: StaffingResponse | Route, whoami: StaffingResponse | Route = VALID_WHOAMI) {
  const urls: URL[] = [];
  const fetch: SevenShiftsFetch = async (url) => {
    const u = new URL(url);
    urls.push(u);
    if (u.pathname === "/v2/whoami") return typeof whoami === "function" ? whoami(u) : respond(whoami);
    if (/^\/v2\/company\/\d+\/shifts$/.test(u.pathname)) return typeof shifts === "function" ? shifts(u) : respond(shifts);
    throw new Error("unexpected url");
  };
  return { fetch, urls, shiftCalls: () => urls.filter((u) => u.pathname.endsWith("/shifts")).length };
}

// ── facts and rendering ─────────────────────────────────────────────────────────────────────────

type Sched = Record<string, Loaded<ShopSchedule>> | null;

/** One shop's day D with Toast labor present; `schedule` only when given (null = the key is absent). */
function shopDay(shop: { id: string; name: string }, sched: Loaded<ShopSchedule> | undefined): ShopDayFacts {
  return { ...shopFacts(shop, { labor: ok(labor()), lookahead: D1 }, sched), day: D };
}
/** Booked orders at BOTH shops on BOTH days of the window. */
function cateringDay(sched: Sched): CateringFacts {
  const leads = [lead("a1", A, D), lead("a2", A, D1), lead("b1", B, D), lead("b2", B, D1)];
  return cateringFacts(leads, sched ?? undefined, { today: D });
}

type DigestName = "shop_a" | "shop_b" | "unified" | "catering";
interface Rendered { who: string; digest: DigestName; language: Language; shops: string[]; subject: string; preheader: string; html: string; text: string }
interface Recipient { who: string; viewer: LinkViewer; shops: Partial<Record<DigestName, string[]>> }

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const OWNER: LinkViewer = { role: "owner", level: 9, locations: [] };
const SMM: LinkViewer = { role: "social_media_mgr", level: 6, locations: [A, B] };
const GM_C: LinkViewer = { role: "gm", level: 7, locations: [C] };

const PERMITTED: Recipient[] = [
  { who: "GM of Shop A", viewer: GM_A, shops: { shop_a: [A] } },
  { who: "owner", viewer: OWNER, shops: { shop_a: [A, B], shop_b: [A, B], unified: [A, B], catering: [A, B] } },
];
const REFUSED: Recipient[] = [
  { who: "social media manager", viewer: SMM, shops: { shop_a: [A], shop_b: [B], unified: [A, B], catering: [A, B] } },
  { who: "a viewer at another shop", viewer: GM_C, shops: { shop_a: [C], shop_b: [C], unified: [C], catering: [C] } },
];

const PREHEADER = /<div style="display:none;max-height:0;overflow:hidden;color:transparent;line-height:0;">([^<]*)<\/div>/;

/** Every digest each recipient gets, in en and es, from one set of schedule facts. */
function renderFacts(sched: Sched, recipients: Recipient[] = PERMITTED): Rendered[] {
  const out: Rendered[] = [];
  const kindOf: Record<DigestName, DigestDelivery["kind"]> = { shop_a: "gm_shop", shop_b: "gm_shop", unified: "unified", catering: "catering" };
  for (const r of recipients) {
    for (const [digest, shops] of Object.entries(r.shops) as Array<[DigestName, string[]]>) {
      for (const language of LANGS) {
        const env = { language, baseUrl: BASE, viewer: r.viewer, access: digestAccessFor(r.viewer, { kind: kindOf[digest], shops }) };
        const mail = digest === "shop_a" ? renderShopDigest(shopDay(SHOP_A, sched?.[A]), env)
          : digest === "shop_b" ? renderShopDigest(shopDay(SHOP_B, sched?.[B]), env)
            : digest === "unified" ? renderUnifiedDigest({ day: D, shops: [shopDay(SHOP_A, sched?.[A]), shopDay(SHOP_B, sched?.[B])], notFinalized: [] }, env)
              : renderCateringDigest(cateringDay(sched), { locations: [SHOP_A, SHOP_B], includeUnassigned: false }, env);
        out.push({
          who: r.who, digest, language, shops: digest === "shop_a" ? [A] : digest === "shop_b" ? [B] : [A, B],
          subject: mail.subject, preheader: PREHEADER.exec(mail.html)?.[1] ?? "<no preheader>", html: mail.html, text: mail.text,
        });
      }
    }
  }
  return out;
}

/** A NEW reader for one literal answer → A and B for the window → every permitted digest rendered. */
async function renderAll(shifts: StaffingResponse | Route, whoami: StaffingResponse | Route = VALID_WHOAMI, mirror: Mirror = {}) {
  const net = fakeNet(shifts, whoami);
  const counter = { requests: 0 };
  const reader = createScheduleReader(fakeDb(mirror), { env: ENV, fetch: net.fetch, counter });
  const a = await reader.shopWindow(A, D, D1);
  const b = await reader.shopWindow(B, D, D1);
  const sched = { [A]: a, [B]: b };
  return { a, b, sched, net, counter, out: renderFacts(sched) };
}

// ── what a person reads ─────────────────────────────────────────────────────────────────────────

const w = (language: Language) => ({
  label: serverT(language, "digest.staffing.label"),
  na: serverT(language, "digest.staffing.not_available"),
  none: serverT(language, "digest.staffing.none"),
  vs: serverT(language, "digest.staffing.vs_label"),
});
const NONE_ANY = [serverT("en", "digest.staffing.none"), serverT("es", "digest.staffing.none")];
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const span = (language: Language, s: string, e: string) => serverT(language, "digest.staffing.span", { start: formatTime(s, language), end: formatTime(e, language) });

/** Every (start, end) pair written in a body's rows that a careless reader could print, as spans. */
function bodySpans(body: string, language: Language): string[] {
  const out: string[] = [];
  for (const obj of body.match(/\{[^{}]*\}/g) ?? []) {
    const s = /"start":"([^"]*)"/.exec(obj)?.[1];
    const e = /"end":"([^"]*)"/.exec(obj)?.[1];
    if (s && e && Number.isFinite(Date.parse(s)) && Number.isFinite(Date.parse(e))) out.push(span(language, s, e));
  }
  return out;
}

/** The text of one shop's part of a digest; a two-shop digest is split at Shop B's first section ("Shop B · …"). */
function shopPart(text: string, shop: string, shops: readonly string[] = [A, B]): string {
  if (shops.length === 1) return shops[0] === shop ? text : "";
  const at = text.search(/\nShop B · /);
  if (at < 0) return shop === A ? text : "";
  return shop === A ? text.slice(0, at) : text.slice(at);
}

/** A REFUSED answer, read by a person: nothing from 7shifts, ONE "not available" per shop per digest. */
function expectRefused(out: Rendered[], body: string, label: string): void {
  for (const r of out) {
    const x = w(r.language);
    const tag = `${label} · ${r.who} · ${r.digest} · ${r.language}`;
    const spans = bodySpans(body, r.language);
    for (const doc of [r.html, r.text, r.subject, r.preheader]) {
      for (const word of MIRROR_WORDS) expect(doc, `${tag}: ${word}`).not.toContain(word);
      for (const s of spans) expect(doc, `${tag}: span ${s}`).not.toContain(s);
      for (const n of NONE_ANY) expect(doc, `${tag}: "${n}"`).not.toContain(n);
      expect(doc, `${tag}: vs line`).not.toContain(x.vs);
    }
    expect(count(r.text, `${x.label}: ${x.na}`), `${tag}: text "not available" lines`).toBe(r.shops.length);
    expect(count(r.html, `<strong>${x.label}</strong>: ${x.na}`), `${tag}: html "not available" lines`).toBe(r.shops.length);
    for (const shop of r.shops) expect(count(shopPart(r.text, shop, r.shops), `${x.label}: ${x.na}`), `${tag}: one per shop`).toBe(1);
    // Nothing else of the staffing kind: every "Staff scheduled" line is the not-available one.
    expect(count(r.text, `${x.label}: `), `${tag}: staffing lines`).toBe(r.shops.length);
  }
}

/** The days each digest prints a roster for: the shop digest's Tomorrow (D+1); catering Today and Tomorrow. */
const rosterDays = (digest: DigestName) => (digest === "catering" ? [D, D1] : [D1]);

/** An ACCEPTED answer: every shop's roster prints (names and times as read), and never "not available". */
function expectAccepted(out: Rendered[], sched: Record<string, Loaded<ShopSchedule>>, label: string): void {
  for (const r of out) {
    const x = w(r.language);
    const tag = `${label} · ${r.who} · ${r.digest} · ${r.language}`;
    for (const doc of [r.html, r.text]) expect(doc, `${tag}: not available`).not.toContain(x.na);
    expect(count(r.text, `${x.label}: `), `${tag}: one roster line per shop per printed day`).toBe(r.shops.length * rosterDays(r.digest).length);
    // Day D's comparison in the Labor section, once per shop, in the shop and unified digests.
    if (r.digest !== "catering") expect(count(r.text, `${x.vs}: `), `${tag}: vs line`).toBe(r.shops.length);
    for (const shop of r.shops) {
      const s = sched[shop]!;
      expect(s.kind, tag).toBe("ok");
      if (s.kind !== "ok") continue;
      const part = shopPart(r.text, shop, r.shops);
      for (const day of rosterDays(r.digest)) {
        const roster: DayRoster = s.value.days.find((d) => d.day === day)!;
        if (roster.people.length === 0) expect(part, `${tag}: ${shop} ${day} none`).toContain(x.none);
        // At most five names print, then "+N" (capItems); the first five are the ones a reader sees.
        for (const p of roster.people.slice(0, 5)) {
          const name = p.firstName ?? serverT(r.language, "digest.staffing.unnamed");
          expect(part, `${tag}: ${shop} ${day} ${name}`).toContain(`${name} ${span(r.language, p.startAt, p.endAt)}`);
          expect(r.html, `${tag}: html ${name}`).toContain(name);
        }
      }
    }
  }
}

// ── 1. every case of STAFFING_CASES, all four layers (A2-6 i) ──────────────────────────────────

describe("A2-6 (i): every case of STAFFING_CASES, all four layers, through the reader and the renderer", () => {
  for (const c of STAFFING_CASES) {
    it(`${c.layer}: ${c.name} → ${c.expect}`, async () => {
      let shifts = c.shifts;
      // The table's oversized case is sized for a 64 KiB ceiling; the reader's page ceiling is 2 MiB, so the same
      // case is re-padded past the real ceiling (as the reader test does).
      if (c.layer === "transport" && c.field === "bytes" && c.name.includes("byte ceiling")) {
        shifts = { status: 200, body: validAnswerBody({ rows: [shiftRow("A", { note_pad: str("x".repeat(SCHEDULE_PAGE_MAX_BYTES + 1)) }), shiftRow("B")] }) };
      }
      const { a, b, sched, out } = await renderAll(shifts, c.whoami ?? VALID_WHOAMI);
      if (c.expect === "refused") {
        expect([a.kind, b.kind], c.name).not.toContain("ok");
        expectRefused(out, shifts.body, c.name);
      } else {
        expectAccepted(out, sched, c.name);
      }
    }, 30_000);
  }
});

// ── 2. S8 ───────────────────────────────────────────────────────────────────────────────────────

describe("S8 (plan §13.1.4): the normal published pass, un-publish, and the contract-breaking answer", () => {
  const OLD = { start: "2026-03-01T14:00:00Z", end: "2026-03-01T22:00:00Z" };
  const NEW = { start: "2026-03-01T15:00:00Z", end: "2026-03-01T23:00:00Z" };
  const cateringOf = (out: Rendered[], language: Language) => out.find((r) => r.digest === "catering" && r.language === language)!;

  it("publish → the roster shows the shift; the next answer no longer holds it → not shown", async () => {
    const r1 = await renderAll({ status: 200, body: validAnswerBody() });
    expectAccepted(r1.out, r1.sched, "published");
    for (const language of LANGS) {
      const cat = cateringOf(r1.out, language);
      expect(shopPart(cat.text, A)).toContain(`Person Q ${span(language, OLD.start, OLD.end)}`);
    }
    const r2 = await renderAll({ status: 200, body: validAnswerBody({ rows: [shiftRow("B"), shiftRow("OPEN")] }) });
    expectAccepted(r2.out, r2.sched, "un-published");
    for (const r of r2.out) {
      expect(r.text).not.toContain("Person Q");
      expect(r.html).not.toContain("Person Q");
      expect(r.text).not.toContain(span(r.language, OLD.start, OLD.end));
    }
    // Shop B's roster is unchanged by A's un-publish.
    for (const language of LANGS) expect(shopPart(cateringOf(r2.out, language).text, B)).toContain(`Person R ${span(language, "2026-03-02T15:00:00-05:00", "2026-03-02T23:30:00-05:00")}`);
  });

  for (const [naming, loc] of [["naming B", SHOP_B_7S], ["naming A", SHOP_A_7S]] as const) {
    it(`a shift of A returned as location_id ${loc} (${naming}), draft: true, publish_status "published" → NEITHER shop prints a roster; both "not available"`, async () => {
      const body = validAnswerBody({ rows: [shiftRow("A", { location_id: loc, draft: "true", start: str(NEW.start), end: str(NEW.end) }), shiftRow("B"), shiftRow("OPEN")] });
      const r = await renderAll({ status: 200, body });
      expect(r.a.kind).not.toBe("ok");
      expect(r.b.kind).not.toBe("ok");
      expectRefused(r.out, body, `contract-breaking ${naming}`);
      // Neither the old nor the edited time.
      for (const x of r.out) for (const t of [span(x.language, OLD.start, OLD.end), span(x.language, NEW.start, NEW.end)]) expect(x.text).not.toContain(t);
    });
  }

  it("then published again (draft: false) at B → the roster shows the NEW time, at B, and never the old one", async () => {
    const body = validAnswerBody({ rows: [shiftRow("A", { location_id: SHOP_B_7S, start: str(NEW.start), end: str(NEW.end) }), shiftRow("B"), shiftRow("OPEN")] });
    const r = await renderAll({ status: 200, body });
    expectAccepted(r.out, r.sched, "republished");
    for (const language of LANGS) {
      const cat = cateringOf(r.out, language);
      expect(shopPart(cat.text, B)).toContain(`Person Q ${span(language, NEW.start, NEW.end)}`);
      expect(shopPart(cat.text, A)).not.toContain("Person Q");
      expect(cat.text).not.toContain(span(language, OLD.start, OLD.end));
    }
  });
});

// ── 3–5. single rendered instances of the closing rule ──────────────────────────────────────────

describe("rendered instances of the closing rule", () => {
  it("S2: the only assigned shift of shop A has no user_id and no open → not available at both shops, never \"No one scheduled\"", async () => {
    const body = validAnswerBody({ rows: [shiftRow("A", { user_id: null, open: null }), shiftRow("B")] });
    const r = await renderAll({ status: 200, body });
    expectRefused(r.out, body, "S2");
  });

  it("S11: a row starting on D+2 → both shops not available", async () => {
    const body = validAnswerBody({ rows: [shiftRow("A", { start: str("2026-03-03T14:00:00Z"), end: str("2026-03-03T22:00:00Z") }), shiftRow("B")] });
    const r = await renderAll({ status: 200, body });
    expectRefused(r.out, body, "S11");
  });

  it("S12: start on 2026-02-30 in a window that holds 2 March → the row is NOT on 2 March; both shops not available", async () => {
    const body = validAnswerBody({ rows: [shiftRow("A", { start: str("2026-02-30T14:00:00Z"), end: str("2026-03-02T22:00:00Z") }), shiftRow("B")] });
    const r = await renderAll({ status: 200, body });
    expectRefused(r.out, body, "S12");
    // What V8 would have made of it: 2 March 9:00 AM ET. It must not be anywhere.
    for (const x of r.out) expect(x.text).not.toContain(span(x.language, "2026-03-02T14:00:00Z", "2026-03-02T22:00:00Z"));
  });

  it("A2-3 on literal bytes: \"user_id\":42.0000000000000001 → user 42's person is never named; not available", async () => {
    const body = validAnswerBody({ rows: [shiftRow("A", { user_id: "42.0000000000000001" }), shiftRow("B"), shiftRow("OPEN")] });
    expect(body).toContain(`"user_id":42.0000000000000001`);
    const r = await renderAll({ status: 200, body });
    expectRefused(r.out, body, "A2-3");
    for (const x of r.out) for (const doc of [x.text, x.html]) expect(doc).not.toContain("Person Z");
  });
});

// ── plan §15.1.3 S11: both DST days (23 h and 25 h windows), rendered ─────────────────────────

describe("S11: both DST days, the window's first and last instants, rendered in the catering digest", () => {
  const cases = [
    // Spring forward on 8 March 2026: [8 Mar 00:00 EST, 9 Mar 23:59 EDT].
    { name: "spring (23 h day)", from: "2026-03-08", to: "2026-03-09", first: "2026-03-08T00:00:00-05:00", last: "2026-03-09T23:59:00-04:00", after: "2026-03-10T00:00:00-04:00" },
    // Fall back on 1 November 2026: [31 Oct 00:00 EDT, 1 Nov 23:59 EST].
    { name: "fall (25 h day)", from: "2026-10-31", to: "2026-11-01", first: "2026-10-31T00:00:00-04:00", last: "2026-11-01T23:59:00-05:00", after: "2026-11-02T00:00:00-05:00" },
  ];
  const plus = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();
  for (const c of cases) {
    it(`${c.name}: a shift at the first minute (A) and one at the last minute (B) print on their own ET days; one minute later refuses`, async () => {
      const rows = [shiftRow("A", { start: str(c.first), end: str(plus(c.first, 6)) }), shiftRow("B", { start: str(c.last), end: str(plus(c.last, 4)) })];
      const read = async (rs: string[]) => {
        const net = fakeNet({ status: 200, body: validAnswerBody({ rows: rs }) });
        const reader = createScheduleReader(fakeDb(), { env: ENV, fetch: net.fetch });
        return { [A]: await reader.shopWindow(A, c.from, c.to), [B]: await reader.shopWindow(B, c.from, c.to) };
      };
      const sched = await read(rows);
      expect(sched[A]!.kind).toBe("ok");
      expect(sched[B]!.kind).toBe("ok");
      const leads = [lead("a1", A, c.from), lead("a2", A, c.to), lead("b1", B, c.from), lead("b2", B, c.to)];
      for (const language of LANGS) {
        const mail = renderCateringDigest(cateringFacts(leads, sched, { today: c.from }), { locations: [SHOP_A, SHOP_B], includeUnassigned: false },
          { language, baseUrl: BASE, viewer: OWNER, access: digestAccessFor(OWNER, { kind: "catering", shops: [A, B] }) });
        const a = shopPart(mail.text, A);
        const b = shopPart(mail.text, B);
        expect(a).toContain(`Person Q ${span(language, c.first, plus(c.first, 6))}`);
        expect(b).toContain(`Person R ${span(language, c.last, plus(c.last, 4))}`);
        // B's shift is on the window's LAST day: Today says no one, Tomorrow names Person R.
        const tomorrowTitle = `Shop B · ${serverT(language, "digest.catering.tomorrow", { date: formatDateLabel(c.to, language) })}`;
        expect(b.indexOf(tomorrowTitle), tomorrowTitle).toBeGreaterThan(0);
        expect(b.slice(0, b.indexOf(tomorrowTitle))).not.toContain("Person R");
        expect(b.slice(b.indexOf(tomorrowTitle))).toContain("Person R");
        expect(mail.text).not.toContain(w(language).na);
      }
      const late = await read([shiftRow("A", { start: str(c.after), end: str(plus(c.after, 4)) }), shiftRow("B")]);
      expect(late[A]!.kind).not.toBe("ok");
      expect(late[B]!.kind).not.toBe("ok");
    });
  }
});

// ── 6. refused recipients stay byte-identical end to end ───────────────────────────────────────

describe("refused recipients: byte-identical for a valid answer, a refused answer, and no schedule at all", () => {
  it("social media manager and a viewer at another shop: subject, preheader, HTML and text of all three digests", async () => {
    const valid = await renderAll({ status: 200, body: validAnswerBody() });
    const refused = await renderAll({ status: 200, body: validAnswerBody({ rows: [shiftRow("A", { draft: "true" }), shiftRow("B")] }) });
    expect(valid.a.kind).toBe("ok");
    expect(refused.a.kind).not.toBe("ok");
    const base = renderFacts(null, REFUSED);
    const withValid = renderFacts(valid.sched, REFUSED);
    const withRefused = renderFacts(refused.sched, REFUSED);
    expect(base.length).toBe(2 * 4 * 2);
    for (let i = 0; i < base.length; i++) {
      const tag = `${base[i]!.who} · ${base[i]!.digest} · ${base[i]!.language}`;
      for (const other of [withValid[i]!, withRefused[i]!]) {
        expect(other.subject, tag).toBe(base[i]!.subject);
        expect(other.preheader, tag).toBe(base[i]!.preheader);
        expect(other.html, tag).toBe(base[i]!.html);
        expect(other.text, tag).toBe(base[i]!.text);
      }
      for (const word of MIRROR_WORDS) expect(withValid[i]!.text, tag).not.toContain(word);
    }
    // Not vacuous: the same answers DO move a permitted recipient.
    const p0 = renderFacts(null);
    const p1 = renderFacts(valid.sched);
    const p2 = renderFacts(refused.sched);
    for (let i = 0; i < p0.length; i++) {
      expect(p1[i]!.text).not.toBe(p0[i]!.text);
      expect(p2[i]!.text).not.toBe(p0[i]!.text);
    }
  });
});

// ── 7. the token ────────────────────────────────────────────────────────────────────────────────

describe("the token", () => {
  it(`"${TOKEN}" appears in no rendered output, no fact and no console call`, async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const seen: unknown[] = [];
    const runs: Array<[StaffingResponse | Route, StaffingResponse | Route]> = [
      [{ status: 200, body: validAnswerBody() }, VALID_WHOAMI],
      [{ status: 200, body: validAnswerBody() }, { status: 500, body: `{"error":"${TOKEN}"}` }],
      [{ status: 401, body: `{"error":"${TOKEN}"}` }, VALID_WHOAMI],
      [{ status: 200, body: `{"data":[{"id":"${TOKEN}"` }, VALID_WHOAMI],
      [() => { throw new Error(TOKEN); }, VALID_WHOAMI],
      [{ status: 200, body: validAnswerBody({ rows: [shiftRow("A", { note: str(TOKEN) }), shiftRow("B")] }) }, VALID_WHOAMI],
    ];
    for (const [shifts, who] of runs) {
      const r = await renderAll(shifts, who);
      seen.push(r.a, r.b, ...r.out.flatMap((x) => [x.subject, x.preheader, x.html, x.text]));
      seen.push(shopDay(SHOP_A, r.a), cateringDay(r.sched));
    }
    expect(JSON.stringify(seen)).not.toContain(TOKEN);
    for (const s of spies) expect(JSON.stringify(s.mock.calls), "console").not.toContain(TOKEN);
    // The runs did log (fixed codes only), so the console assertion is not vacuous.
    expect(spies.some((s) => s.mock.calls.length > 0)).toBe(true);
  }, 30_000);
});
