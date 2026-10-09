/**
 * A fake provider with Resend's idempotency semantics INCLUDING THE 24 h KEY EXPIRY (Astra r2: a
 * fake that keeps keys forever hides the late-retry double send). A live key with the SAME payload
 * returns the original id without a new email; with a DIFFERENT payload it is a 409
 * invalid_idempotent_request; an expired key is forgotten and sends again. `deliveries` holds only
 * emails that really went out. `lose(n)` makes the next n calls deliver but report a timeout (the
 * accepted-but-lost case); `drop(n)` makes them time out without delivering.
 */
export class Provider {
  deliveries: Array<{ to: string; subject: string; text: string; key: string; at: string }> = [];
  calls: Array<{ key: string; at: string }> = [];
  private keys = new Map<string, { body: string; id: string; at: number }>();
  private lost = 0;
  private dropped = 0;
  lose(n = 1) { this.lost += n; return this; }
  drop(n = 1) { this.dropped += n; return this; }
  send(m: { to: string; subject: string; html: string; text: string; idempotencyKey: string }, now: Date): { id: string } | { error: string; code?: string } {
    this.calls.push({ key: m.idempotencyKey, at: now.toISOString() });
    if (this.dropped > 0) { this.dropped--; return { error: "timeout" }; }
    const body = `${m.to}|${m.subject}|${m.html}`;
    const seen = this.keys.get(m.idempotencyKey);
    const live = seen && now.getTime() - seen.at < 24 * 3_600_000;
    if (seen && live) return seen.body === body ? { id: seen.id } : { error: "same key, different payload", code: "invalid_idempotent_request" };
    const id = `mail-${this.deliveries.length + 1}`;
    this.keys.set(m.idempotencyKey, { body, id, at: now.getTime() });
    this.deliveries.push({ to: m.to, subject: m.subject, text: m.text, key: m.idempotencyKey, at: now.toISOString() });
    if (this.lost > 0) { this.lost--; return { error: "socket hang up" }; }
    return { id };
  }
}

/**
 * The digest engine against an in-memory send log that enforces 0220's partial unique index the
 * way Postgres does (a second claimed|sent|ambiguous|failed_ambiguous row for the same key is a
 * "duplicate" = 23505), with the r3 attempt / accepted columns and guarded transitions.
 */
import { describe, expect, it, vi } from "vitest";
import { classifyProviderResult, runClosingDigestsWith, runDigestTickWith, type ClaimRow, type DigestAlert, type DigestIO, type FinishGuard, type SendOutcome } from "@/lib/report-digests-engine";
import { DEFAULT_DIGEST_SETTINGS, type DigestSettings, type RecipientOverride, type SendLogRow } from "@/lib/report-digests-shared";
import type { CateringFacts, ShopDayFacts } from "@/lib/report-digests-compose";

const A = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Shop A" };
const B = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Shop B" };
const DAY = "2026-10-07";
const HOLDS = new Set(["claimed", "sent", "ambiguous", "failed_ambiguous"]);

type StoreRow = SendLogRow & { id: string; error: string | null; idempotency_key: string | null; sent_at: string | null };
class Store {
  rows: StoreRow[] = [];
  now = "2026-10-07T12:00:00Z";
  private seq = 0;
  private key(r: ClaimRow) { return [r.recipient_ref, r.kind, r.business_day, r.revision, r.mode, r.location_id ?? ""].join("|"); }
  async claim(r: ClaimRow) {
    if (this.rows.some((x) => HOLDS.has(x.outcome) && this.key(x as ClaimRow) === this.key(r))) return "duplicate" as const;
    const id = `row-${++this.seq}`;
    this.rows.push({ ...r, id, outcome: "claimed", skip_reason: null, attempted_at: this.now, error: null, first_attempt_at: null, provider_message_id: null, idempotency_key: null, sent_at: null });
    return { id };
  }
  async markAttempt(id: string, patch: { first_attempt_at: string; idempotency_key: string }) {
    const row = this.rows.find((x) => x.id === id && x.outcome === "claimed" && !x.first_attempt_at);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  }
  async recordAccepted(id: string, patch: { provider_message_id: string; sent_at: string }) {
    const row = this.rows.find((x) => x.id === id && (x.outcome === "claimed" || x.outcome === "ambiguous"));
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  }
  reclaims = 0;
  async reclaim(id: string, patch: { attempted_at: string }, observed: { attempted_at: string }) {
    const row = this.rows.find((x) => x.id === id && x.outcome === "ambiguous" && !x.provider_message_id && x.attempted_at === observed.attempted_at);
    if (!row) return false;
    this.reclaims++;
    Object.assign(row, { ...patch, outcome: "claimed" });
    return true;
  }
  async finish(id: string, from: SendOutcome[], patch: { outcome: string; error?: string | null }, guard?: FinishGuard) {
    const row = this.rows.find((x) => x.id === id && (from as string[]).includes(x.outcome) &&
      (!guard?.noMessageId || !x.provider_message_id) && (!guard?.neverAttempted || !x.first_attempt_at) &&
      (!guard?.observedAttemptedAt || x.attempted_at === guard.observedAttemptedAt) &&
      (!guard?.staleBefore || Date.parse(x.attempted_at) < Date.parse(guard.staleBefore)));
    if (!row) return false;
    Object.assign(row, { outcome: patch.outcome, error: patch.error ?? null });
    return true;
  }
  async skip(r: ClaimRow & { skip_reason: string }) {
    this.rows.push({ ...r, id: `row-${++this.seq}`, outcome: "skipped", attempted_at: this.now, error: null, first_attempt_at: null, provider_message_id: null, idempotency_key: null, sent_at: null });
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
  return { location, day, reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null };
}
const noCatering = (today: string): CateringFacts => ({ today, leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] });

function makeIO(opts: {
  now: string; store?: Store; settings?: Partial<DigestSettings>;
  finalized?: Record<string, string[]>; sendFails?: (to: string, subject: string) => boolean;
  provider?: Provider; previewRecipient?: string | null; overrides?: RecipientOverride[];
  memberships?: Array<{ userId: string; locationId: string }>;
}) {
  const store = opts.store ?? new Store();
  store.now = new Date(opts.now).toISOString();
  const provider = opts.provider ?? new Provider();
  const sent = provider.deliveries;
  const alerts: DigestAlert[] = [];
  const claimedAlerts = new Set<string>();
  const runs: unknown[] = [];
  const io: DigestIO = {
    now: new Date(opts.now), baseUrl: "https://ops.example.com",
    previewRecipient: async () => (opts.previewRecipient === undefined ? "operator@example.com" : opts.previewRecipient),
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live", ...opts.settings }),
    directory: async () => ({
      dir: { users, memberships: opts.memberships ?? [{ userId: "gm-a", locationId: A.id }, { userId: "gm-b", locationId: B.id }], overrides: opts.overrides ?? [], locationIds: [A.id, B.id] },
      locations: [A, B],
    }),
    sendLog: async (days) => store.rows.filter((r) => days.includes(r.business_day)).map((r) => ({ ...r })),
    finalizedClosings: async (days) => new Map(days.map((d) => [d, new Set(opts.finalized?.[d] ?? [])])),
    shopFacts: async (l, d) => shopFacts(l, d),
    cateringFacts: async (today) => noCatering(today),
    store,
    sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) => {
      if (opts.sendFails?.(m.to, m.subject)) return { error: "422 domain not verified", code: "validation_error" };
      return provider.send(m, new Date(opts.now));
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
  return { io, store, sent, alerts, runs, provider };
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
    expect(late.sent.find((m) => m.to === "pete@example.com")?.text).toContain("! Closing not finalized: Shop B");
    expect(store.of("skipped").map((r) => [r.recipient_ref, r.location_id, r.skip_reason])).toEqual([["user:gm-b", B.id, "shop_not_finalized"]]);
  });

  it.each([
    ["2026-03-08", "2026-03-07", "2026-03-08T07:00:00Z"],
    ["2026-11-01", "2026-10-31", "2026-11-01T08:00:00Z"],
  ])("hourly ticks at the %s fallback send once across repeated runs", async (_date, businessDay, at) => {
    const store = new Store();
    const first = makeIO({ now: at, store, finalized: { [businessDay]: [A.id] } });
    await runDigestTickWith(first.io);
    expect(first.sent.filter((m) => m.to === "pete@example.com" && m.text.includes("Closing not finalized: Shop B"))).toHaveLength(1);
    const afterFirst = store.rows.length;
    for (const hours of [1, 2]) {
      const later = makeIO({ now: new Date(Date.parse(at) + hours * 3_600_000).toISOString(), store, finalized: { [businessDay]: [A.id] } });
      await runDigestTickWith(later.io);
      expect(later.sent).toEqual([]);
      expect(store.rows.length).toBe(afterFirst);
    }
    expect(store.of("sent").filter((r) => r.kind === "unified" && r.business_day === businessDay)).toHaveLength(2);
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
  it("a refused send is logged (ambiguous, key held — the provider WAS reached), alerts at once, and the next tick retries the same row", async () => {
    const store = new Store();
    const failing = makeIO({ now: "2026-10-07T11:00:00Z", store, sendFails: (to, subject) => to === "pete@example.com" && subject.startsWith("Catering") });
    const s = await runDigestTickWith(failing.io);
    const held = store.of("ambiguous").filter((r) => r.kind === "catering");
    expect(held.map((r) => [r.kind, r.recipient_ref, r.error])).toEqual([["catering", "user:own", "refused: 422 domain not verified"]]);
    expect(store.of("failed").filter((r) => r.kind === "catering")).toEqual([]);
    expect(failing.alerts.filter((a) => a.kind === "catering")).toEqual([expect.objectContaining({ detector: "digest-send", kind: "catering", ref: "user:own", error: "refused: 422 domain not verified" })]);
    expect(s?.counts.catering.failed).toBe(1);
    expect(failing.runs).toHaveLength(1);

    const retry = makeIO({ now: "2026-10-07T11:10:00Z", store });
    await runDigestTickWith(retry.io);
    expect(retry.sent.filter((m) => m.subject.startsWith("Catering")).map((m) => m.to)).toEqual(["pete@example.com"]);
    expect(store.rows.filter((r) => r.kind === "catering" && r.recipient_ref === "user:own").map((r) => [r.outcome, r.first_attempt_at]))
      .toEqual([["sent", "2026-10-07T11:00:00.000Z"]]); // the same row, its original first attempt
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

describe("P1 (Astra r2): send-once survives the provider's 24 h key window", () => {
  const cateringTo = (p: Provider, to: string) => p.deliveries.filter((m) => m.to === to && m.subject.startsWith("Catering — Wed, Oct 7"));

  it("the fake provider really forgets keys after 24 h (so the tests below are not toothless)", () => {
    const p = new Provider();
    const m = { to: "a@x.co", subject: "s", html: "h", text: "t", idempotencyKey: "k" };
    p.send(m, new Date("2026-10-07T11:00:00Z"));
    p.send(m, new Date("2026-10-08T10:59:00Z"));
    expect(p.deliveries).toHaveLength(1);
    p.send(m, new Date("2026-10-08T11:00:00Z"));
    expect(p.deliveries).toHaveLength(2);
  });

  it("accepted + finish fails + retry at 25 h = ONE send (the message id was persisted before finish)", async () => {
    const store = new Store();
    const provider = new Provider();
    const first = makeIO({ now: "2026-10-07T11:00:00Z", store, provider });
    const realFinish = store.finish.bind(store);
    store.finish = async () => { throw new Error("connection reset"); };
    await runDigestTickWith(first.io);
    expect(cateringTo(provider, "pete@example.com")).toHaveLength(1);
    const pete = store.rows.find((r) => r.kind === "catering" && r.recipient_ref === "user:own")!;
    expect(pete).toMatchObject({ outcome: "claimed", provider_message_id: expect.stringMatching(/^mail-/), sent_at: "2026-10-07T11:00:00.000Z" });
    expect(first.alerts.some((a) => a.detector === "digest-send" && a.error?.startsWith("finish_unrecorded:sent"))).toBe(true);

    store.finish = realFinish;
    // 25 h later: the provider has FORGOTTEN the key; only the log can stop a second email.
    const late = makeIO({ now: "2026-10-08T12:00:00Z", store, provider });
    const s = await runDigestTickWith(late.io);
    expect(cateringTo(provider, "pete@example.com")).toHaveLength(1);
    expect(pete.outcome).toBe("sent");
    expect(store.rows.filter((r) => r.kind === "catering" && r.business_day === DAY && r.outcome !== "skipped").map((r) => r.outcome)).toEqual(["sent", "sent", "sent", "sent"]);
    expect(s?.reconciled).toBeGreaterThanOrEqual(4);
    // A closing hook for that old day does not resend either.
    expect(provider.calls.filter((c) => c.key === "co-digest/live/catering/2026-10-07/r1/user:own/all")).toHaveLength(1);
  });

  it("ambiguous (delivered, answer lost) + retry at 2 h = the SAME key, still one send", async () => {
    const store = new Store();
    const provider = new Provider();
    const first = makeIO({ now: "2026-10-07T11:00:00Z", store, provider });
    provider.lose(6); // every send this tick (2 unified fallbacks + 4 catering) goes out, answer lost
    await runDigestTickWith(first.io);
    const amb = store.of("ambiguous").filter((r) => r.kind === "catering");
    expect(amb).toHaveLength(4);
    expect(amb.every((r) => r.first_attempt_at === "2026-10-07T11:00:00.000Z")).toBe(true);
    expect(first.alerts.some((a) => a.detector === "digest-send" && a.error?.startsWith("ambiguous:"))).toBe(true);

    const retry = makeIO({ now: "2026-10-07T13:00:00Z", store, provider });
    await runDigestTickWith(retry.io);
    const key = "co-digest/live/catering/2026-10-07/r1/user:own/all";
    expect(provider.calls.filter((c) => c.key === key)).toHaveLength(2); // retried, with the same key
    expect(cateringTo(provider, "pete@example.com")).toHaveLength(1);   // and delivered once
    expect(store.of("sent").filter((r) => r.kind === "catering")).toHaveLength(4);
    expect(store.of("sent").every((r) => r.first_attempt_at === "2026-10-07T11:00:00.000Z" || r.kind !== "catering")).toBe(true);
  });

  it("P1 (Astra r2): a recipient disabled after an ambiguous attempt is never retried; the row is kept for expiry", async () => {
    const store = new Store();
    const provider = new Provider();
    const first = makeIO({ now: "2026-10-07T11:00:00Z", store, provider });
    provider.lose(6);
    await runDigestTickWith(first.io);
    const key = "co-digest/live/catering/2026-10-07/r1/user:own/all";
    expect(provider.calls.filter((c) => c.key === key)).toHaveLength(1);

    const peteOff: RecipientOverride = { id: "ov-pete", kind: "internal", userId: "own", email: null, displayName: "Pete", active: false, cateringDigest: true, shopDigest: false, locationIds: null };
    const retry = makeIO({ now: "2026-10-07T13:00:00Z", store, provider, overrides: [peteOff] });
    await runDigestTickWith(retry.io);
    expect(provider.calls.filter((c) => c.key === key)).toHaveLength(1); // no second provider call
    const pete = store.rows.filter((r) => r.recipient_ref === "user:own" && r.kind === "catering");
    expect(pete.map((r) => r.outcome)).toEqual(["ambiguous"]);             // preserved, not skipped over
    expect(store.of("sent").filter((r) => r.kind === "catering" && r.recipient_ref !== "user:own").length).toBeGreaterThan(0);

    const late = makeIO({ now: "2026-10-08T11:00:00Z", store, provider, overrides: [peteOff] });
    await runDigestTickWith(late.io);
    expect(provider.calls.filter((c) => c.key === key)).toHaveLength(1);
    expect(store.rows.find((r) => r.recipient_ref === "user:own" && r.kind === "catering" && r.business_day === "2026-10-07")?.outcome).toBe("failed_ambiguous");
  });

  it("ambiguous at 25 h = NO send, frozen failed_ambiguous, and an alert for a human", async () => {
    const store = new Store();
    const provider = new Provider();
    // The closing hook on Oct 7 22:00 ET; Alex's GM digest times out without an answer.
    const hook = makeIO({ now: "2026-10-08T02:00:00Z", store, provider, finalized: { [DAY]: [A.id] } });
    provider.drop(1);
    await runClosingDigestsWith(hook.io, A.id, DAY);
    const alex = store.rows.find((r) => r.kind === "gm_shop" && r.recipient_ref === "user:gm-a")!;
    expect(alex.outcome).toBe("ambiguous");

    // 25 h later (Oct 8 23:00 ET) Oct 7 is still "yesterday" for the tick — and must NOT be resent.
    const late = makeIO({ now: "2026-10-09T03:00:00Z", store, provider, finalized: { [DAY]: [A.id, B.id] } });
    const s = await runDigestTickWith(late.io);
    expect(alex.outcome).toBe("failed_ambiguous");
    expect(provider.calls.filter((c) => c.key === `co-digest/live/gm_shop/${DAY}/r1/user:gm-a/${A.id}`)).toHaveLength(1);
    expect(provider.deliveries.some((m) => m.to === "alex@example.com" && m.key.includes(DAY))).toBe(false);
    expect(late.alerts).toContainEqual(expect.objectContaining({ detector: "digest-watch", kind: "gm_shop", day: DAY, ref: "user:gm-a", error: expect.stringContaining("failed_ambiguous") }));
    expect(s?.ambiguousExpired).toBe(1);
    // and it stays frozen on every later tick
    await runDigestTickWith(makeIO({ now: "2026-10-09T03:10:00Z", store, provider, finalized: { [DAY]: [A.id, B.id] } }).io);
    expect(provider.calls.filter((c) => c.key === `co-digest/live/gm_shop/${DAY}/r1/user:gm-a/${A.id}`)).toHaveLength(1);
  });

  it("only a claim that never reached the provider is released by the stale sweep", async () => {
    const store = new Store();
    const provider = new Provider();
    const first = makeIO({ now: "2026-10-07T11:00:00Z", store, provider });
    store.markAttempt = async () => false; // the attempt could not be recorded → nothing is sent
    await runDigestTickWith(first.io);
    expect(provider.calls).toHaveLength(0);
    expect(store.of("claimed").filter((r) => r.kind === "catering").every((r) => r.first_attempt_at === null)).toBe(true);
    delete (store as { markAttempt?: unknown }).markAttempt;
    const later = makeIO({ now: "2026-10-07T11:20:00Z", store, provider });
    const s = await runDigestTickWith(later.io);
    expect(s?.staleClaims).toBeGreaterThanOrEqual(4);
    expect(cateringTo(provider, "pete@example.com")).toHaveLength(1);
  });

  it("a retry whose content changed is reconciled as sent from the provider's 409, never re-sent", async () => {
    const store = new Store();
    const provider = new Provider();
    const first = makeIO({ now: "2026-10-07T11:00:00Z", store, provider });
    // Neither the provider id nor the finish reaches the log: only the attempt is on the row.
    store.recordAccepted = async () => false;
    store.finish = async () => false;
    await runDigestTickWith(first.io);
    const before = provider.deliveries.length;
    delete (store as { recordAccepted?: unknown }).recordAccepted;
    delete (store as { finish?: unknown }).finish;
    const retry = makeIO({ now: "2026-10-07T11:20:00Z", store, provider });
    retry.io.cateringFacts = async (today) => ({ ...noCatering(today), openQuotes: [{ id: "q", locationId: A.id }] });
    await runDigestTickWith(retry.io);
    expect(provider.deliveries.length).toBe(before);
    const sent = store.of("sent").filter((r) => r.kind === "catering");
    expect(sent).toHaveLength(4);
    // Shop A content changed (409 → reconciled); Shop B content did not (same id back, no new email).
    expect(sent.filter((r) => r.error?.startsWith("reconciled:")).map((r) => r.recipient_ref).sort()).toEqual(["user:gm-a", "user:moo", "user:own"]);
  });

  it("every send carries a stable provider idempotency key (recipient × kind × day × revision)", async () => {
    const { io, provider } = makeIO({ now: "2026-10-07T11:00:00Z" });
    await runDigestTickWith(io);
    expect(provider.deliveries.find((m) => m.to === "pete@example.com" && m.subject.startsWith("Catering"))?.key)
      .toBe("co-digest/live/catering/2026-10-07/r1/user:own/all");
  });
});

describe("P1 (Astra): an override never discloses another shop", () => {
  it("a GM of A with an override naming B gets neither B's closing nor B's catering digest", async () => {
    const override: RecipientOverride = { id: "ov", kind: "internal", userId: "gm-a", email: null, displayName: "Alex", active: true, cateringDigest: true, shopDigest: true, locationIds: [B.id] };
    const store = new Store();
    const run = makeIO({ now: "2026-10-08T11:00:00Z", store, overrides: [override], finalized: { [DAY]: [A.id, B.id] } });
    await runDigestTickWith(run.io);
    const toAlex = run.sent.filter((m) => m.to === "alex@example.com");
    expect(toAlex.some((m) => m.text.includes("Shop B"))).toBe(false);
    expect(store.rows.filter((r) => r.recipient_ref === "user:gm-a" && r.kind === "catering").map((r) => [r.outcome, r.skip_reason]))
      .toEqual([["skipped", "out_of_scope"]]);
    expect(store.rows.some((r) => r.recipient_ref === "user:gm-a" && r.location_id === B.id)).toBe(false);
  });
});

describe("P2 (Astra): preview goes to the operator's own account or nowhere", () => {
  it("no resolvable CGS account → fail closed: nothing sent, one alert", async () => {
    const p = makeIO({ now: "2026-10-07T11:00:00Z", settings: { mode: "preview" }, previewRecipient: null });
    const s = await runDigestTickWith(p.io);
    expect(p.sent).toEqual([]);
    expect(p.store.rows).toEqual([]);
    expect(p.alerts).toEqual([expect.objectContaining({ detector: "digest-preview", error: "preview_recipient_unresolved" })]);
    expect(s?.alerts).toBe(1);
  });
});

describe("provider outcome classification", () => {
  it("accepted / reconcile / refused / ambiguous", () => {
    expect(classifyProviderResult({ id: "m" })).toBe("accepted");
    expect(classifyProviderResult({ id: "" })).toBe("ambiguous");
    expect(classifyProviderResult({ error: "x", code: "invalid_idempotent_request" })).toBe("reconcile");
    expect(classifyProviderResult({ error: "x", code: "validation_error" })).toBe("refused");
    expect(classifyProviderResult({ error: "x", code: "rate_limit_exceeded" })).toBe("refused");
    for (const code of ["concurrent_idempotent_requests", "application_error", "internal_server_error", undefined]) {
      expect(classifyProviderResult({ error: "timeout", ...(code ? { code } : {}) })).toBe("ambiguous");
    }
  });
});

describe("P1/P2 (Astra r3): the r4 state machine — after an attempt, only sent or failed_ambiguous", () => {
  const KEY = "co-digest/live/catering/2026-10-07/r1/user:own/all";
  const toPete = (p: Provider) => p.deliveries.filter((m) => m.key === KEY);

  it("accept-lost + retry REFUSED at 2 h + tick at 25 h = still ONE delivery, frozen and alerted, no second send", async () => {
    const store = new Store();
    const provider = new Provider();
    const first = makeIO({ now: "2026-10-07T11:00:00Z", store, provider });
    provider.lose(6); // delivered, answers lost
    await runDigestTickWith(first.io);
    const pete = store.rows.find((r) => r.kind === "catering" && r.recipient_ref === "user:own")!;
    expect(pete.outcome).toBe("ambiguous");

    // 2 h later the retry is REFUSED (rate limit) — that proves nothing about the first call.
    const refused = makeIO({ now: "2026-10-07T13:00:00Z", store, provider, sendFails: (to, subject) => subject.startsWith("Catering") });
    refused.io.sendEmail = vi.fn(async () => ({ error: "too many requests", code: "rate_limit_exceeded" }));
    await runDigestTickWith(refused.io);
    expect(pete).toMatchObject({ outcome: "ambiguous", first_attempt_at: "2026-10-07T11:00:00.000Z" });
    expect(store.of("failed").filter((r) => r.kind === "catering")).toEqual([]);

    // 25 h after the first attempt the provider has forgotten the key — and nothing is resent.
    const late = makeIO({ now: "2026-10-08T12:00:00Z", store, provider });
    const s = await runDigestTickWith(late.io);
    expect(toPete(provider)).toHaveLength(1);
    expect(pete.outcome).toBe("failed_ambiguous");
    expect(store.rows.filter((r) => r.kind === "catering" && r.business_day === DAY && r.recipient_ref === "user:own")).toHaveLength(1);
    expect(late.alerts).toContainEqual(expect.objectContaining({ detector: "digest-watch", kind: "catering", day: DAY, ref: "user:own", error: expect.stringContaining("failed_ambiguous") }));
    expect(s?.ambiguousExpired).toBeGreaterThanOrEqual(1);
  });

  it("an ambiguous row with a persisted provider id is reconciled to sent with ZERO provider calls (before retry or expiry)", async () => {
    for (const at of ["2026-10-07T13:00:00Z", "2026-10-08T12:00:00Z"]) { // inside the window, and past it
      const store = new Store();
      const provider = new Provider();
      await runDigestTickWith(makeIO({ now: "2026-10-07T11:00:00Z", store, provider }).io);
      const pete = store.rows.find((r) => r.kind === "catering" && r.recipient_ref === "user:own")!;
      // The r3 hole: an accepted retry persisted its id, then its finish failed → still ambiguous.
      Object.assign(pete, { outcome: "ambiguous", provider_message_id: "mail-x", sent_at: "2026-10-07T12:00:00.000Z" });
      const callsBefore = provider.calls.length;
      const later = makeIO({ now: at, store, provider });
      await runDigestTickWith(later.io);
      expect(pete.outcome).toBe("sent");
      expect(provider.calls.filter((c) => c.key === KEY).length).toBe(1);
      expect(provider.calls.length - callsBefore).toBe(provider.calls.filter((c) => c.at === new Date(at).toISOString()).length);
      expect(provider.calls.some((c) => c.key === KEY && c.at === new Date(at).toISOString())).toBe(false);
    }
  });

  it("two concurrent ticks retrying the same ambiguous row make ONE provider call (same lock as fresh sends)", async () => {
    const store = new Store();
    const provider = new Provider();
    provider.drop(6); // first tick: nothing delivered, every answer lost
    await runDigestTickWith(makeIO({ now: "2026-10-07T11:00:00Z", store, provider }).io);
    expect(store.of("ambiguous").filter((r) => r.kind === "catering")).toHaveLength(4);
    const a = makeIO({ now: "2026-10-07T13:00:00Z", store, provider });
    const b = makeIO({ now: "2026-10-07T13:00:00Z", store, provider });
    await Promise.all([runDigestTickWith(a.io), runDigestTickWith(b.io)]);
    expect(provider.calls.filter((c) => c.key === KEY && c.at === "2026-10-07T13:00:00.000Z")).toHaveLength(1);
    expect(toPete(provider)).toHaveLength(1);
    expect(store.rows.filter((r) => r.kind === "catering" && r.recipient_ref === "user:own").map((r) => r.outcome)).toEqual(["sent"]);
  });

  it("`failed` (key released) only ever comes from a claim that never reached the provider", async () => {
    const store = new Store();
    const provider = new Provider();
    const io = makeIO({ now: "2026-10-07T11:00:00Z", store, provider, sendFails: () => true });
    await runDigestTickWith(io.io);
    expect(store.of("failed").every((r) => !r.first_attempt_at)).toBe(true);
    expect(store.rows.filter((r) => r.first_attempt_at).every((r) => r.outcome === "ambiguous" || r.outcome === "sent")).toBe(true);
  });
});

describe("P2 (Astra r4): stale recovery is a compare-and-set on the observed row version", () => {
  it("A sweeps + reclaims + is in flight; B's stale-snapshot sweep is a no-op; ONE provider call", async () => {
    const KEY = "co-digest/live/catering/2026-10-07/r1/user:own/all";
    const store = new Store();
    const provider = new Provider();
    // A claim whose attempt was recorded and whose process died: stale `claimed` at 11:00.
    const first = makeIO({ now: "2026-10-07T11:00:00Z", store, provider });
    store.finish = async () => false; // the first tick dies after the attempt: rows stay `claimed`
    provider.drop(6); // 2 unified fallbacks + 4 catering: none delivered
    await runDigestTickWith(first.io);
    delete (store as { finish?: unknown }).finish;
    const pete = store.rows.find((r) => r.kind === "catering" && r.recipient_ref === "user:own")!;
    expect(pete).toMatchObject({ outcome: "claimed", first_attempt_at: "2026-10-07T11:00:00.000Z", attempted_at: "2026-10-07T11:00:00.000Z" });

    // Both ticks read the SAME stale snapshot at 11:20.
    const snapshot = store.rows.map((r) => ({ ...r }));
    const a = makeIO({ now: "2026-10-07T11:20:00Z", store, provider });
    const b = makeIO({ now: "2026-10-07T11:20:30Z", store, provider });
    b.io.sendLog = async (days) => snapshot.filter((r) => days.includes(r.business_day)).map((r) => ({ ...r }));

    // A's provider call hangs until B has fully run.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const real = a.io.sendEmail;
    let aInFlight!: () => void;
    const inFlight = new Promise<void>((resolve) => { aInFlight = resolve; });
    a.io.sendEmail = vi.fn(async (m) => {
      if (m.idempotencyKey === KEY) { aInFlight(); await gate; }
      return real(m);
    });
    const aRun = runDigestTickWith(a.io);
    await inFlight;
    expect(pete).toMatchObject({ outcome: "claimed", attempted_at: "2026-10-07T11:20:00.000Z" }); // A holds it

    await runDigestTickWith(b.io); // B sweeps its stale snapshot: compare-and-set fails, row untouched
    expect(pete).toMatchObject({ outcome: "claimed", attempted_at: "2026-10-07T11:20:00.000Z" });
    release();
    await aRun;

    const callsFor = (ra: string) => provider.calls.filter((c) => c.key === KEY && c.at === ra);
    expect(callsFor("2026-10-07T11:20:30.000Z")).toHaveLength(0); // B never called the provider
    expect(callsFor("2026-10-07T11:20:00.000Z")).toHaveLength(1); // A did, once
    expect(provider.deliveries.filter((m) => m.key === KEY)).toHaveLength(1);
    expect(pete.outcome).toBe("sent");
  });
});
