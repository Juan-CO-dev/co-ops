/**
 * Scheduled package sends through the digest engine's send-once path (PR1 r3): the claim, the
 * attempt recorded before the provider, the provider Idempotency-Key, provider_message_id before
 * finish, ambiguous same-key retries inside 23 h then failed_ambiguous. Packages must get exactly
 * the guarantees a digest gets — these tests prove they do not bypass any of them.
 *
 * The fake provider and store mirror tests/report-digests-send.test.ts (Resend's key semantics
 * including the 24 h expiry; 0220's partial unique index with guarded transitions); the provider
 * also records attachment names.
 */
import { describe, expect, it, vi } from "vitest";
import { digestIdempotencyKey, runClosingDigestsWith, runDigestTickWith, type ClaimRow, type DigestAlert, type DigestIO, type SendOutcome } from "@/lib/report-digests-engine";
import { DEFAULT_DIGEST_SETTINGS, type DigestSettings, type SendLogRow } from "@/lib/report-digests-shared";
import type { PackageIO, PackageRecipientRow } from "@/lib/report-package-shared";

class Provider {
  deliveries: Array<{ to: string; subject: string; key: string; at: string; attachments: string[] }> = [];
  calls: Array<{ key: string; at: string }> = [];
  private keys = new Map<string, { body: string; id: string; at: number }>();
  private lost = 0;
  private dropped = 0;
  lose(n = 1) { this.lost += n; return this; }
  drop(n = 1) { this.dropped += n; return this; }
  send(m: { to: string; subject: string; html: string; idempotencyKey: string; attachments?: Array<{ filename: string }> }, now: Date): { id: string } | { error: string; code?: string } {
    this.calls.push({ key: m.idempotencyKey, at: now.toISOString() });
    if (this.dropped > 0) { this.dropped--; return { error: "timeout" }; }
    const body = `${m.to}|${m.subject}|${m.html}`;
    const seen = this.keys.get(m.idempotencyKey);
    const live = seen && now.getTime() - seen.at < 24 * 3_600_000;
    if (seen && live) return seen.body === body ? { id: seen.id } : { error: "same key, different payload", code: "invalid_idempotent_request" };
    const id = `mail-${this.deliveries.length + 1}`;
    this.keys.set(m.idempotencyKey, { body, id, at: now.getTime() });
    this.deliveries.push({ to: m.to, subject: m.subject, key: m.idempotencyKey, at: now.toISOString(), attachments: (m.attachments ?? []).map((a) => a.filename) });
    if (this.lost > 0) { this.lost--; return { error: "socket hang up" }; }
    return { id };
  }
}

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
  async finish(id: string, from: SendOutcome[], patch: { outcome: string; error?: string | null }) {
    const row = this.rows.find((x) => x.id === id && (from as string[]).includes(x.outcome));
    if (!row) return false;
    Object.assign(row, { outcome: patch.outcome, error: patch.error ?? null });
    return true;
  }
  async skip(r: ClaimRow & { skip_reason: string }) {
    this.rows.push({ ...r, id: `row-${++this.seq}`, outcome: "skipped", attempted_at: this.now, error: null, first_attempt_at: null, provider_message_id: null, idempotency_key: null, sent_at: null });
  }
  /** Package rows for business day DAY unless another day is named (a tick also looks at earlier days). */
  pkg(day: string | null = DAY) { return this.rows.filter((r) => r.kind.startsWith("package_") && (day === null || r.business_day === day)); }
}

const A = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Shop A" };
const B = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Shop B" };
const DAY = "2026-10-07";
const ACCOUNTANT = "22222222-2222-4222-8222-222222222222";
const users = [
  { id: "gm-a", name: "Alex", email: "alex@example.com", role: "gm", language: "en", active: true },
  { id: "own", name: "Pete", email: "pete@example.com", role: "owner", language: "en", active: true },
];
const peteRow: PackageRecipientRow = {
  id: "11111111-1111-4111-8111-111111111111", kind: "internal", user_id: "own", email: null, display_name: "Pete", active: true,
  location_ids: null, packages: ["sales", "cash", "catering", "purchases", "waste", "inventory"], cadence: "daily_close", formats: ["csv", "pdf"],
};
const accountantRow: PackageRecipientRow = {
  id: ACCOUNTANT, kind: "external", user_id: null, email: null, display_name: "Accountant", active: false, location_ids: null,
  packages: ["sales", "cash", "catering", "purchases", "waste", "inventory"], cadence: "daily_close", formats: ["csv", "pdf"],
};

type SendFn = DigestIO["sendEmail"];

function makeIO(opts: {
  now: string; store?: Store; provider?: Provider; settings?: Partial<DigestSettings>; finalized?: Record<string, string[]>;
  rows?: PackageRecipientRow[]; sendFails?: (subject: string) => boolean; composeThrows?: string; previewRecipient?: string | null;
  /** Called before the provider for each package send (to make that one call lost / dropped). */
  beforePackage?: (p: Provider) => void;
}) {
  const store = opts.store ?? new Store();
  store.now = new Date(opts.now).toISOString();
  const provider = opts.provider ?? new Provider();
  const alerts: DigestAlert[] = [];
  const audits: Array<{ kind: string; day: string; ref: string; outcome: string }> = [];
  const composed: Array<{ ref: string; cadence: string; day: string; locations: string[] }> = [];
  const packages: PackageIO = {
    recipients: async () => opts.rows ?? [peteRow, accountantRow],
    compose: async (r, cadence, day, env) => {
      if (opts.composeThrows) throw new Error(opts.composeThrows);
      composed.push({ ref: r.ref, cadence, day, locations: r.locationIds });
      return {
        subject: `PACKAGE ${cadence} ${day}${env.previewFor ? " preview" : ""}`, html: "<p>files</p>", text: "files",
        attachments: [
          ...(r.formats.includes("csv") ? r.sections.map((s) => ({ filename: `${s}.csv`, content: Buffer.from("x"), contentType: "text/csv" })) : []),
          ...(r.formats.includes("pdf") ? [{ filename: "package.pdf", content: Buffer.from("%PDF-"), contentType: "application/pdf" }] : []),
        ],
      };
    },
    recordSend: async (e) => { audits.push(e); },
  };
  const sendEmail: SendFn = vi.fn(async (m) => {
    if (opts.sendFails?.(m.subject)) return { error: "422 domain not verified", code: "validation_error" };
    if (m.subject.startsWith("PACKAGE")) opts.beforePackage?.(provider);
    return provider.send(m, new Date(opts.now));
  });
  const io: DigestIO = {
    now: new Date(opts.now), baseUrl: "https://ops.example.com",
    previewRecipient: async () => (opts.previewRecipient === undefined ? "juan@example.com" : opts.previewRecipient),
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live", ...opts.settings }),
    directory: async () => ({
      dir: { users, memberships: [{ userId: "gm-a", locationId: A.id }], overrides: [], locationIds: [A.id, B.id] },
      locations: [A, B],
    }),
    sendLog: async (days) => store.rows.filter((r) => days.includes(r.business_day)).map((r) => ({ ...r })),
    finalizedClosings: async (days) => new Map(days.map((d) => [d, new Set(opts.finalized?.[d] ?? [])])),
    shopFacts: async (location, day) => ({ location, day, reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null }),
    cateringFacts: async (today) => ({ today, leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] }),
    store,
    sendEmail,
    sha: (c) => String(c.length),
    alert: async (a) => { alerts.push(a); return true; },
    packages,
    recordRun: async () => {},
  };
  return { io, store, provider, alerts, audits, composed };
}
const packageMail = (p: Provider, day = DAY) => p.deliveries.filter((m) => m.subject.startsWith("PACKAGE") && m.subject.includes(day));
const closed = { [DAY]: [A.id, B.id] };

describe("Pete gets CSV + PDF at close; the accountant row stays disabled", () => {
  it("the last shop's finalize sends Pete's daily package (every section as CSV + one PDF, every shop)", async () => {
    const { io, provider, store, composed, audits } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: closed });
    await runClosingDigestsWith(io, B.id, DAY);
    const pkg = packageMail(provider);
    expect(pkg).toHaveLength(1);
    expect(pkg[0]).toMatchObject({ to: "pete@example.com", subject: `PACKAGE daily_close ${DAY}` });
    expect(pkg[0]!.attachments).toEqual(["sales.csv", "cash.csv", "catering.csv", "purchases.csv", "waste.csv", "inventory.csv", "package.pdf"]);
    expect(composed[0]).toMatchObject({ ref: "user:own", locations: [A.id, B.id] });
    expect(store.pkg().filter((r) => r.outcome === "sent")).toMatchObject([{ kind: "package_daily", recipient_ref: "user:own", location_id: null }]);
    expect(store.pkg().find((r) => r.outcome === "sent")?.provider_message_id).toBeTruthy();
    expect(audits).toEqual([{ kind: "package_daily", day: DAY, ref: "user:own", outcome: "sent" }]);
  });

  it("the package uses the engine's provider Idempotency-Key, recorded on the row BEFORE the provider call", async () => {
    const { io, provider, store } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: closed });
    await runClosingDigestsWith(io, B.id, DAY);
    const row = store.pkg().find((r) => r.outcome === "sent")!;
    const key = digestIdempotencyKey({ kind: "package_daily", business_day: DAY, recipient_ref: "user:own", location_id: null, revision: 1, mode: "live" });
    expect(row).toMatchObject({ idempotency_key: key });
    expect(row.first_attempt_at).toBeTruthy();
    expect(packageMail(provider)[0]!.key).toBe(key);
  });

  it("the accountant row with no email is a logged recipient_disabled skip — never a send, logged once a day", async () => {
    const store = new Store();
    const one = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: closed });
    await runClosingDigestsWith(one.io, B.id, DAY);
    await runDigestTickWith(makeIO({ now: "2026-10-08T03:00:00Z", store, finalized: closed }).io);
    expect(store.pkg().filter((r) => r.recipient_ref === `ext:${ACCOUNTANT}`)).toMatchObject([{ outcome: "skipped", skip_reason: "recipient_disabled", kind: "package_daily" }]);
  });

  it("once the email is plugged in and the row enabled, the accountant gets the same files", async () => {
    const { io, provider } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: closed, rows: [{ ...accountantRow, active: true, email: "books@example.com" }] });
    await runClosingDigestsWith(io, B.id, DAY);
    expect(packageMail(provider).map((m) => m.to)).toEqual(["books@example.com"]);
  });

  it("no package before the day is closed everywhere; at the 03:00 fallback it goes out anyway", async () => {
    const early = makeIO({ now: "2026-10-08T02:00:00Z", finalized: { [DAY]: [A.id] } });
    await runClosingDigestsWith(early.io, A.id, DAY);
    expect([packageMail(early.provider).length, early.store.pkg().length]).toEqual([0, 0]);
    const fallback = makeIO({ now: "2026-10-08T07:05:00Z", finalized: { [DAY]: [A.id] } });
    await runDigestTickWith(fallback.io);
    expect(packageMail(fallback.provider).map((m) => m.subject)).toEqual([`PACKAGE daily_close ${DAY}`]);
  });
});

describe("send-once: packages get the digest engine's guarantees, not a copy of them", () => {
  it("a double cron fire sends the package once (the loser logs already_sent)", async () => {
    const store = new Store();
    const provider = new Provider();
    const first = makeIO({ now: "2026-10-08T02:30:00Z", store, provider, finalized: closed });
    const second = makeIO({ now: "2026-10-08T02:30:00Z", store, provider, finalized: closed });
    await Promise.all([runClosingDigestsWith(first.io, B.id, DAY), runDigestTickWith(second.io)]);
    await runDigestTickWith(makeIO({ now: "2026-10-08T02:40:00Z", store, provider, finalized: closed }).io);
    expect(packageMail(provider)).toHaveLength(1);
    expect(store.pkg().filter((r) => r.recipient_ref === "user:own" && r.outcome === "sent")).toHaveLength(1);
  });

  it("accepted-but-lost (timeout after delivery): AMBIGUOUS, retried with the SAME key, provider dedupes — one email", async () => {
    const store = new Store();
    const provider = new Provider();
    let lostOnce = false;
    const first = makeIO({
      now: "2026-10-08T02:30:00Z", store, provider, finalized: closed, rows: [peteRow],
      beforePackage: (p) => { if (!lostOnce) { lostOnce = true; p.lose(1); } },
    });
    await runClosingDigestsWith(first.io, B.id, DAY);
    expect(store.pkg()).toMatchObject([{ outcome: "ambiguous", recipient_ref: "user:own" }]);
    expect(first.alerts.some((a) => a.kind === "package_daily" && a.detector === "digest-send" && /ambiguous/.test(a.error ?? ""))).toBe(true);
    expect(first.audits).toEqual([{ kind: "package_daily", day: DAY, ref: "user:own", outcome: "ambiguous" }]);
    await runDigestTickWith(makeIO({ now: "2026-10-08T02:40:00Z", store, provider, finalized: closed, rows: [peteRow] }).io);
    const keys = provider.calls.filter((c) => c.key.includes("package_daily") && c.key.includes(DAY)).map((c) => c.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(packageMail(provider)).toHaveLength(1);
    expect(store.pkg().filter((r) => r.recipient_ref === "user:own").map((r) => r.outcome)).toEqual(["sent"]);
  });

  it("an ambiguous package past 23 h is frozen failed_ambiguous and NEVER resent, even after the provider forgot the key", async () => {
    const store = new Store();
    const provider = new Provider();
    let droppedOnce = false;
    const first = makeIO({
      now: "2026-10-08T02:30:00Z", store, provider, finalized: closed, rows: [peteRow],
      beforePackage: (p) => { if (!droppedOnce) { droppedOnce = true; p.drop(1); } },
    });
    await runClosingDigestsWith(first.io, B.id, DAY);
    expect(store.pkg()[0]).toMatchObject({ outcome: "ambiguous" });
    const late = makeIO({ now: "2026-10-09T02:00:00Z", store, provider, finalized: closed, rows: [peteRow] });
    await runDigestTickWith(late.io);
    expect(store.pkg()[0]).toMatchObject({ outcome: "failed_ambiguous" });
    expect(late.alerts.some((a) => a.kind === "package_daily" && a.detector === "digest-watch")).toBe(true);
    await runDigestTickWith(makeIO({ now: "2026-10-09T10:00:00Z", store, provider, finalized: closed, rows: [peteRow] }).io);
    expect(packageMail(provider)).toHaveLength(0);
  });

  it("a definitive refusal is failed + alerted + audited, releases the key, and the next tick sends", async () => {
    const store = new Store();
    const provider = new Provider();
    const failing = makeIO({ now: "2026-10-08T02:30:00Z", store, provider, finalized: closed, sendFails: (s) => s.startsWith("PACKAGE") });
    await runClosingDigestsWith(failing.io, B.id, DAY);
    expect(store.pkg().filter((r) => r.outcome === "failed")).toMatchObject([{ kind: "package_daily", recipient_ref: "user:own", error: "422 domain not verified" }]);
    expect(failing.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "package_daily", detector: "digest-send", ref: "user:own" })]));
    expect(failing.audits).toEqual([{ kind: "package_daily", day: DAY, ref: "user:own", outcome: "failed" }]);
    await runDigestTickWith(makeIO({ now: "2026-10-08T02:40:00Z", store, provider, finalized: closed }).io);
    expect(packageMail(provider).map((m) => m.to)).toEqual(["pete@example.com"]);
  });

  it("a compose failure (e.g. too_large) is a failed row + alert and never reaches the provider", async () => {
    const { io, store, alerts, provider } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: closed, composeThrows: "too_large: 12000000 bytes of attachments" });
    await runClosingDigestsWith(io, B.id, DAY);
    expect(store.pkg().find((r) => r.outcome === "failed")?.error).toMatch(/too_large/);
    expect(provider.calls.some((c) => c.key.includes("package_"))).toBe(false);
    expect(alerts.some((a) => a.kind === "package_daily" && a.detector === "digest-send")).toBe(true);
  });
});

describe("cadences and the switch", () => {
  const weekly = { ...peteRow, cadence: "weekly_mon" };
  const monthly = { ...peteRow, id: "33333333-3333-4333-8333-333333333333", cadence: "monthly_1st" };

  it("weekly goes out Monday from 06:00 ET, never earlier or on other days", async () => {
    const monday = makeIO({ now: "2026-10-12T10:30:00Z", rows: [weekly] });
    await runDigestTickWith(monday.io);
    expect(monday.composed).toEqual([{ ref: "user:own", cadence: "weekly_mon", day: "2026-10-12", locations: [A.id, B.id] }]);
    expect(monday.store.pkg(null)).toMatchObject([{ kind: "package_weekly", business_day: "2026-10-12", outcome: "sent" }]);
    const early = makeIO({ now: "2026-10-12T09:50:00Z", rows: [weekly] });
    await runDigestTickWith(early.io);
    expect(early.composed).toEqual([]);
    const tuesday = makeIO({ now: "2026-10-13T14:00:00Z", rows: [weekly] });
    await runDigestTickWith(tuesday.io);
    expect(tuesday.composed).toEqual([]);
  });

  it("monthly goes out on the 1st from 06:00 ET", async () => {
    const first = makeIO({ now: "2026-11-01T12:00:00Z", rows: [monthly] });
    await runDigestTickWith(first.io);
    expect(first.store.pkg(null)).toMatchObject([{ kind: "package_monthly", business_day: "2026-11-01", outcome: "sent" }]);
  });

  it("OFF sends nothing; PREVIEW sends Pete's package to Juan's own account only; preview with no operator fails closed", async () => {
    const off = makeIO({ now: "2026-10-08T02:30:00Z", settings: { mode: "off" }, finalized: closed });
    await runClosingDigestsWith(off.io, B.id, DAY);
    expect([off.provider.deliveries.length, off.store.rows.length]).toEqual([0, 0]);
    const preview = makeIO({ now: "2026-10-08T02:30:00Z", settings: { mode: "preview" }, finalized: closed });
    await runClosingDigestsWith(preview.io, B.id, DAY);
    expect(packageMail(preview.provider)).toMatchObject([{ to: "juan@example.com", subject: `PACKAGE daily_close ${DAY} preview` }]);
    expect(preview.store.pkg().find((r) => r.outcome === "sent")).toMatchObject({ mode: "preview" });
    const failClosed = makeIO({ now: "2026-10-08T02:30:00Z", settings: { mode: "preview" }, finalized: closed, previewRecipient: null });
    await runClosingDigestsWith(failClosed.io, B.id, DAY);
    expect([failClosed.provider.deliveries.length, failClosed.composed.length]).toEqual([0, 0]);
  });

  it("an IO without packages (PR1 shape) runs the digests unchanged", async () => {
    const { io, provider } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: closed });
    delete (io as { packages?: unknown }).packages;
    await runClosingDigestsWith(io, B.id, DAY);
    expect(packageMail(provider)).toEqual([]);
    expect(provider.deliveries.length).toBeGreaterThan(0);
  });
});
