/**
 * The digest engine against an in-memory send log that enforces 0220's partial unique index the
 * way Postgres does (a second claimed|sent row for the same key is a "duplicate" = 23505).
 */
import { describe, expect, it, vi } from "vitest";
import { runClosingDigestsWith, runDigestTickWith, type ClaimRow, type DigestAlert, type DigestIO } from "@/lib/report-digests-engine";
import { DEFAULT_DIGEST_SETTINGS, type DigestSettings, type SendLogRow } from "@/lib/report-digests-shared";
import type { CateringFacts, ShopDayFacts } from "@/lib/report-digests-compose";

const A = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Shop A" };
const B = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Shop B" };
const DAY = "2026-10-07";

class Store {
  rows: Array<SendLogRow & { id: string; email_id: string | null; error: string | null }> = [];
  private seq = 0;
  private key(r: ClaimRow) { return [r.recipient_ref, r.kind, r.business_day, r.revision, r.mode, r.location_id ?? ""].join("|"); }
  async claim(r: ClaimRow) {
    if (this.rows.some((x) => (x.outcome === "claimed" || x.outcome === "sent") && this.key(x as ClaimRow) === this.key(r))) return "duplicate" as const;
    const id = `row-${++this.seq}`;
    this.rows.push({ ...r, id, outcome: "claimed", skip_reason: null, attempted_at: "2026-10-07T12:00:00Z", email_id: null, error: null });
    return { id };
  }
  async finish(id: string, patch: { outcome: "sent" | "failed"; email_id?: string | null; error?: string | null }) {
    const row = this.rows.find((x) => x.id === id && x.outcome === "claimed");
    if (!row) return false;
    Object.assign(row, { outcome: patch.outcome, email_id: patch.email_id ?? null, error: patch.error ?? null });
    return true;
  }
  async skip(r: ClaimRow & { skip_reason: string }) {
    this.rows.push({ ...r, id: `row-${++this.seq}`, outcome: "skipped", attempted_at: "2026-10-07T12:00:00Z", email_id: null, error: null });
  }
  of(outcome: string) { return this.rows.filter((r) => r.outcome === outcome); }
}

const users = [
  { id: "gm-a", name: "Alex", email: "alex@example.com", role: "gm", language: "en", active: true },
  { id: "gm-b", name: "John", email: "john@example.com", role: "gm", language: "es", active: true },
  { id: "moo", name: "Cristian", email: "cristian@example.com", role: "moo", language: "es", active: true },
  { id: "own", name: "Pete", email: "pete@example.com", role: "owner", language: "en", active: true },
  { id: "keith", name: "Keith", email: null, role: "catering_mgr", language: "en", active: true },
];

function shopFacts(location: { id: string; name: string }, day: string): ShopDayFacts {
  return { location, day, reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [] };
}
const noCatering = (today: string): CateringFacts => ({ today, leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] });

function makeIO(opts: {
  now: string; store?: Store; settings?: Partial<DigestSettings>;
  finalized?: Record<string, string[]>; sendFails?: (to: string, subject: string) => boolean;
}) {
  const store = opts.store ?? new Store();
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const alerts: DigestAlert[] = [];
  const claimedAlerts = new Set<string>();
  const runs: unknown[] = [];
  const io: DigestIO = {
    now: new Date(opts.now), baseUrl: "https://ops.example.com", previewTo: "operator@example.com",
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live", ...opts.settings }),
    directory: async () => ({
      dir: { users, memberships: [{ userId: "gm-a", locationId: A.id }, { userId: "gm-b", locationId: B.id }], overrides: [], locationIds: [A.id, B.id] },
      locations: [A, B],
    }),
    sendLog: async (days) => store.rows.filter((r) => days.includes(r.business_day)).map((r) => ({ ...r })),
    finalizedClosings: async (days) => new Map(days.map((d) => [d, new Set(opts.finalized?.[d] ?? [])])),
    shopFacts: async (l, d) => shopFacts(l, d),
    cateringFacts: async (today) => noCatering(today),
    expireStaleClaims: async () => 0,
    store,
    sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string }) => {
      if (opts.sendFails?.(m.to, m.subject)) return { error: "422 domain not verified" };
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return { id: `mail-${sent.length}` };
    }),
    sha: (c) => String(c.length),
    alert: async (a) => {
      alerts.push(a);
      const k = `${a.detector}:${a.kind}:${a.day}`;
      if (claimedAlerts.has(k)) return false;
      claimedAlerts.add(k);
      return true;
    },
    recordRun: async (s) => { runs.push(s); },
  };
  return { io, store, sent, alerts, runs };
}

describe("off by default", () => {
  it("mode off: nothing composed, sent, logged or alerted", async () => {
    const { io, store, sent, alerts } = makeIO({ now: "2026-10-08T12:00:00Z", settings: { mode: "off" }, finalized: { [DAY]: [A.id, B.id] } });
    expect(await runDigestTickWith(io)).toBeNull();
    expect([store.rows.length, sent.length, alerts.length]).toEqual([0, 0, 0]);
  });
});

describe("GM digest at closing finalize + unified after the last shop", () => {
  it("the closing hook sends the shop's GM digest; the unified waits for the last shop", async () => {
    const { io, sent } = makeIO({ now: "2026-10-08T02:00:00Z", finalized: { [DAY]: [A.id] } });
    const s = await runClosingDigestsWith(io, A.id, DAY);
    expect(sent.map((m) => m.to)).toEqual(["alex@example.com"]);
    expect(s?.counts.unified.sent).toBe(0);
  });

  it("the last shop's finalize sends its GM digest AND the unified digest to every level 8+", async () => {
    const store = new Store();
    await runClosingDigestsWith(makeIO({ now: "2026-10-08T02:00:00Z", store, finalized: { [DAY]: [A.id] } }).io, A.id, DAY);
    const second = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    await runClosingDigestsWith(second.io, B.id, DAY);
    expect(second.sent.map((m) => m.to).sort()).toEqual(["cristian@example.com", "john@example.com", "pete@example.com"]);
    expect(second.sent.find((m) => m.to === "john@example.com")?.subject).toContain("Resumen de cierre de Shop B");
  });
});

describe("idempotency", () => {
  it("a re-run (retry / re-finalize) sends nothing twice and logs nothing new", async () => {
    const store = new Store();
    const one = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    await runClosingDigestsWith(one.io, B.id, DAY);
    await runDigestTickWith(one.io);
    const rowsAfter = store.rows.length;
    const two = makeIO({ now: "2026-10-08T02:40:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    await runDigestTickWith(two.io);
    await runClosingDigestsWith(two.io, B.id, DAY);
    expect(two.sent).toEqual([]);
    expect(store.rows.length).toBe(rowsAfter);
    expect(store.of("sent").filter((r) => r.kind !== "catering" && r.business_day === DAY).map((r) => `${r.kind}:${r.recipient_ref}`).sort()).toEqual([
      "gm_shop:user:gm-a", "gm_shop:user:gm-b", "unified:user:moo", "unified:user:own",
    ]);
  });

  it("a DOUBLE cron fire (two ticks racing on a stale read) sends exactly one per recipient; the loser logs already_sent", async () => {
    const store = new Store();
    const a = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    const b = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    // b reads the (empty) log BEFORE a writes anything — the race the unique index exists for.
    const frozen: SendLogRow[] = [];
    b.io.sendLog = async () => frozen;
    await Promise.all([runDigestTickWith(a.io), runDigestTickWith(b.io)]);
    const pairs = [...a.sent, ...b.sent].map((m) => `${m.to}|${m.subject}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(store.of("sent").length).toBe(pairs.length);
    expect(store.of("sent").filter((r) => r.kind !== "catering" && r.business_day === DAY).map((r) => r.recipient_ref).sort())
      .toEqual(["user:gm-a", "user:gm-b", "user:moo", "user:own"]);
    // every send the loser tried was refused by the index and logged
    expect(store.of("skipped").filter((r) => r.skip_reason === "already_sent")).toHaveLength(pairs.length);
  });
});

describe("03:00 ET fallback", () => {
  it("before 03:00 the unified waits; at 03:00 it goes out listing each unfinalized shop, and that shop's GM gets a logged skip", async () => {
    const store = new Store();
    const early = makeIO({ now: "2026-10-08T06:50:00Z", store, finalized: { [DAY]: [A.id] } });
    await runDigestTickWith(early.io);
    expect(early.sent.map((m) => m.to)).toEqual(["alex@example.com"]);
    const late = makeIO({ now: "2026-10-08T07:00:00Z", store, finalized: { [DAY]: [A.id] } });
    await runDigestTickWith(late.io);
    expect(late.sent.map((m) => m.to).sort()).toEqual(["cristian@example.com", "pete@example.com"]);
    expect(late.sent.find((m) => m.to === "pete@example.com")?.text).toContain("! Closing: Closing not finalized: Shop B");
    expect(store.of("skipped").map((r) => [r.recipient_ref, r.location_id, r.skip_reason])).toEqual([["user:gm-b", B.id, "shop_not_finalized"]]);
  });
});

describe("catering morning digest", () => {
  it("goes out at the setting to Keith (no email → logged skip), each GM for their shop, and level 8+", async () => {
    const before = makeIO({ now: "2026-10-07T10:59:00Z" });
    await runDigestTickWith(before.io);
    expect(before.sent.filter((m) => m.subject.startsWith("Catering"))).toEqual([]);
    const at = makeIO({ now: "2026-10-07T11:00:00Z" });
    await runDigestTickWith(at.io);
    const catering = at.sent.filter((m) => /Catering/.test(m.subject));
    expect(catering.map((m) => m.to).sort()).toEqual(["alex@example.com", "cristian@example.com", "john@example.com", "pete@example.com"]);
    expect(catering.find((m) => m.to === "alex@example.com")?.text).toContain("Shop A · Today");
    expect(catering.find((m) => m.to === "alex@example.com")?.text).not.toContain("Shop B");
    expect(catering.find((m) => m.to === "cristian@example.com")?.text).toContain("Nada reservado para hoy");
    expect(at.store.of("skipped").filter((r) => r.kind === "catering").map((r) => [r.kind, r.recipient_ref, r.skip_reason])).toEqual([["catering", "user:keith", "no_email"]]);
  });

  it("the skip is logged once, not on every tick", async () => {
    const store = new Store();
    await runDigestTickWith(makeIO({ now: "2026-10-07T11:00:00Z", store }).io);
    await runDigestTickWith(makeIO({ now: "2026-10-07T11:10:00Z", store }).io);
    expect(store.of("skipped").filter((r) => r.kind === "catering")).toHaveLength(1);
  });
});

describe("failures are never silent", () => {
  it("a failed send is logged failed with the error, alerts at once, does not hold the key, and the next tick retries", async () => {
    const store = new Store();
    const failing = makeIO({ now: "2026-10-07T11:00:00Z", store, sendFails: (to, subject) => to === "pete@example.com" && subject.startsWith("Catering") });
    const s = await runDigestTickWith(failing.io);
    const failed = store.of("failed").filter((r) => r.kind === "catering");
    expect(failed.map((r) => [r.kind, r.recipient_ref, r.error])).toEqual([["catering", "user:own", "422 domain not verified"]]);
    expect(failing.alerts.filter((a) => a.kind === "catering")).toEqual([expect.objectContaining({ detector: "digest-send", kind: "catering", ref: "user:own", error: "422 domain not verified" })]);
    expect(s?.counts.catering.failed).toBe(1);
    expect(failing.runs).toHaveLength(1);

    const retry = makeIO({ now: "2026-10-07T11:10:00Z", store });
    await runDigestTickWith(retry.io);
    expect(retry.sent.filter((m) => m.subject.startsWith("Catering")).map((m) => m.to)).toEqual(["pete@example.com"]);
  });

  it("digest-watch alerts when an expected recipient has no sent/skipped row after time + grace", async () => {
    const store = new Store();
    const failing = makeIO({ now: "2026-10-07T12:00:00Z", store, sendFails: (to, subject) => to === "john@example.com" && subject.startsWith("Catering") });
    await runDigestTickWith(failing.io);
    const catering = failing.alerts.filter((a) => a.kind === "catering");
    expect(catering.map((a) => a.detector)).toEqual(["digest-send", "digest-watch"]);
    expect(catering[1]).toMatchObject({ kind: "catering", day: DAY, missing: ["user:gm-b"] });
  });

  it("digest-watch stays quiet before the deadline and when everything went out", async () => {
    const quiet = makeIO({ now: "2026-10-07T11:00:00Z", sendFails: () => true });
    await runDigestTickWith(quiet.io);
    expect(quiet.alerts.filter((a) => a.detector === "digest-watch" && a.kind === "catering")).toEqual([]);
    const ok = makeIO({ now: "2026-10-07T12:00:00Z", finalized: { "2026-10-06": [A.id, B.id] } });
    await runDigestTickWith(ok.io);
    expect(ok.alerts).toEqual([]);
  });

  it("watches the closing digests for yesterday after the fallback + grace", async () => {
    const io = makeIO({ now: "2026-10-08T08:00:00Z", finalized: { [DAY]: [A.id, B.id] }, sendFails: (to) => to === "alex@example.com" });
    await runDigestTickWith(io.io);
    expect(io.alerts.filter((a) => a.detector === "digest-watch")).toEqual([
      expect.objectContaining({ kind: "gm_shop", day: DAY, missing: [`user:gm-a@${A.id}`] }),
    ]);
  });
});

describe("preview mode", () => {
  it("every digest goes to the operator only, labelled with its real recipient, logged as preview", async () => {
    const p = makeIO({ now: "2026-10-07T11:00:00Z", settings: { mode: "preview" } });
    await runDigestTickWith(p.io);
    expect(new Set(p.sent.map((m) => m.to))).toEqual(new Set(["operator@example.com"]));
    expect(p.sent.every((m) => m.subject.startsWith("[Preview]") || m.subject.startsWith("[Vista previa]"))).toBe(true);
    expect(p.store.rows.every((r) => r.mode === "preview")).toBe(true);
    // switching to live the same day still sends the real digests (mode is part of the key)
    const live = makeIO({ now: "2026-10-07T11:10:00Z", store: p.store });
    await runDigestTickWith(live.io);
    expect(live.sent.map((m) => m.to)).toContain("pete@example.com");
  });
});
