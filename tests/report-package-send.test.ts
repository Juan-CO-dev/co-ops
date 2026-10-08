/**
 * Scheduled package sends through the digest engine, against an in-memory send log that enforces
 * 0220's partial unique index the way Postgres does (a second claimed|sent row = 23505).
 */
import { describe, expect, it, vi } from "vitest";
import { runClosingDigestsWith, runDigestTickWith, type ClaimRow, type DigestAlert, type DigestIO } from "@/lib/report-digests-engine";
import { DEFAULT_DIGEST_SETTINGS, type DigestSettings, type SendLogRow } from "@/lib/report-digests-shared";
import type { PackageIO, PackageRecipientRow } from "@/lib/report-package-shared";

const A = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Shop A" };
const B = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Shop B" };
const DAY = "2026-10-07";
const ACCOUNTANT = "22222222-2222-4222-8222-222222222222";

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
  /** Package rows for business day DAY unless another day is named. */
  pkg(day: string | null = DAY) { return this.rows.filter((r) => r.kind.startsWith("package_") && (day === null || r.business_day === day)); }
}

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

interface Sent { to: string; subject: string; attachments: string[] }

function makeIO(opts: {
  now: string; store?: Store; settings?: Partial<DigestSettings>; finalized?: Record<string, string[]>;
  rows?: PackageRecipientRow[]; sendFails?: (subject: string) => boolean; composeThrows?: string;
}) {
  const store = opts.store ?? new Store();
  const sent: Sent[] = [];
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
  const io: DigestIO = {
    now: new Date(opts.now), baseUrl: "https://ops.example.com", previewTo: "operator@example.com",
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live", ...opts.settings }),
    directory: async () => ({
      dir: { users, memberships: [{ userId: "gm-a", locationId: A.id }], overrides: [], locationIds: [A.id, B.id] },
      locations: [A, B],
    }),
    sendLog: async (days) => store.rows.filter((r) => days.includes(r.business_day)).map((r) => ({ ...r })),
    finalizedClosings: async (days) => new Map(days.map((d) => [d, new Set(opts.finalized?.[d] ?? [])])),
    shopFacts: async (location, day) => ({ location, day, reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [] }),
    cateringFacts: async (today) => ({ today, leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] }),
    expireStaleClaims: async () => 0,
    store,
    sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string; attachments?: Array<{ filename: string }> }) => {
      if (opts.sendFails?.(m.subject)) return { error: "422 domain not verified" };
      sent.push({ to: m.to, subject: m.subject, attachments: (m.attachments ?? []).map((a) => a.filename) });
      return { id: `mail-${sent.length}` };
    }),
    sha: (c) => String(c.length),
    alert: async (a) => { alerts.push(a); return true; },
    packages,
    recordRun: async () => {},
  };
  return { io, store, sent, alerts, audits, composed };
}
/** Package mails for business day DAY (a tick also looks at the day before, whose fallback may be due). */
const packagesSent = (sent: Sent[], day = DAY) => sent.filter((m) => m.subject.startsWith("PACKAGE") && m.subject.includes(day));

describe("Pete gets CSV + PDF at close; the accountant row stays disabled", () => {
  it("the last shop's finalize sends Pete's daily package (every section as CSV + one PDF, every shop)", async () => {
    const { io, sent, store, composed, audits } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: { [DAY]: [A.id, B.id] } });
    await runClosingDigestsWith(io, B.id, DAY);
    const pkg = packagesSent(sent);
    expect(pkg).toHaveLength(1);
    expect(pkg[0]).toMatchObject({ to: "pete@example.com", subject: `PACKAGE daily_close ${DAY}` });
    expect(pkg[0]!.attachments).toEqual(["sales.csv", "cash.csv", "catering.csv", "purchases.csv", "waste.csv", "inventory.csv", "package.pdf"]);
    expect(composed[0]).toMatchObject({ ref: "user:own", locations: [A.id, B.id] });
    expect(store.pkg().filter((r) => r.outcome === "sent")).toMatchObject([{ kind: "package_daily", recipient_ref: "user:own", business_day: DAY, location_id: null }]);
    expect(audits).toEqual([{ kind: "package_daily", day: DAY, ref: "user:own", outcome: "sent" }]);
  });

  it("the accountant row with no email is a logged recipient_disabled skip — never a send, logged once a day", async () => {
    const store = new Store();
    const one = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    await runClosingDigestsWith(one.io, B.id, DAY);
    await runDigestTickWith(makeIO({ now: "2026-10-08T03:00:00Z", store, finalized: { [DAY]: [A.id, B.id] } }).io);
    const acct = store.pkg().filter((r) => r.recipient_ref === `ext:${ACCOUNTANT}`);
    expect(acct).toMatchObject([{ outcome: "skipped", skip_reason: "recipient_disabled", kind: "package_daily" }]);
    expect(one.sent.some((m) => m.to.includes("accountant"))).toBe(false);
  });

  it("once the email is plugged in and the row enabled, the accountant gets the same files", async () => {
    const { io, sent } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: { [DAY]: [A.id, B.id] }, rows: [{ ...accountantRow, active: true, email: "books@example.com" }] });
    await runClosingDigestsWith(io, B.id, DAY);
    expect(packagesSent(sent).map((m) => m.to)).toEqual(["books@example.com"]);
  });

  it("no package before the day is closed everywhere (waits for the unified decision)", async () => {
    const { io, sent, store } = makeIO({ now: "2026-10-08T02:00:00Z", finalized: { [DAY]: [A.id] } });
    await runClosingDigestsWith(io, A.id, DAY);
    expect(packagesSent(sent)).toEqual([]);
    expect(store.pkg()).toEqual([]);
  });

  it("at the 03:00 fallback the package goes out anyway, with the unified digest", async () => {
    const { io, sent } = makeIO({ now: "2026-10-08T07:05:00Z", finalized: { [DAY]: [A.id] } });
    await runDigestTickWith(io);
    expect(packagesSent(sent).map((m) => m.subject)).toEqual([`PACKAGE daily_close ${DAY}`]);
  });
});

describe("idempotency through the send log", () => {
  it("a retry or a double cron fire sends the package once", async () => {
    const store = new Store();
    const first = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    const second = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    await Promise.all([runClosingDigestsWith(first.io, B.id, DAY), runDigestTickWith(second.io)]);
    await runDigestTickWith(makeIO({ now: "2026-10-08T02:40:00Z", store, finalized: { [DAY]: [A.id, B.id] } }).io);
    expect([...packagesSent(first.sent), ...packagesSent(second.sent)]).toHaveLength(1);
    expect(store.pkg().filter((r) => r.recipient_ref === "user:own" && r.outcome === "sent")).toHaveLength(1);
  });
});

describe("a failed send is never swallowed", () => {
  it("logged failed + alerted, and the next tick retries and sends", async () => {
    const store = new Store();
    const failing = makeIO({ now: "2026-10-08T02:30:00Z", store, finalized: { [DAY]: [A.id, B.id] }, sendFails: (s) => s.startsWith("PACKAGE") });
    await runClosingDigestsWith(failing.io, B.id, DAY);
    expect(store.pkg().filter((r) => r.outcome === "failed")).toMatchObject([{ kind: "package_daily", recipient_ref: "user:own", error: "422 domain not verified" }]);
    expect(failing.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "package_daily", detector: "digest-send", ref: "user:own" })]));
    expect(failing.audits).toEqual([{ kind: "package_daily", day: DAY, ref: "user:own", outcome: "failed" }]);
    const retry = makeIO({ now: "2026-10-08T02:40:00Z", store, finalized: { [DAY]: [A.id, B.id] } });
    await runDigestTickWith(retry.io);
    expect(packagesSent(retry.sent).map((m) => m.to)).toEqual(["pete@example.com"]);
  });

  it("a compose failure (e.g. too_large) is a failed row + an alert too", async () => {
    const { io, store, alerts } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: { [DAY]: [A.id, B.id] }, composeThrows: "too_large: 12000000 bytes of attachments" });
    await runClosingDigestsWith(io, B.id, DAY);
    expect(store.pkg().find((r) => r.outcome === "failed")?.error).toMatch(/^too_large/);
    expect(alerts.some((a) => a.kind === "package_daily" && a.detector === "digest-send")).toBe(true);
  });
});

describe("cadences and the switch", () => {
  const weekly = { ...peteRow, cadence: "weekly_mon" };
  const monthly = { ...peteRow, id: "33333333-3333-4333-8333-333333333333", cadence: "monthly_1st" };

  it("weekly goes out Monday from 06:00 ET (period = the prior week), never on other days", async () => {
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

  it("OFF sends nothing; PREVIEW delivers Pete's package to the operator only", async () => {
    const off = makeIO({ now: "2026-10-08T02:30:00Z", settings: { mode: "off" }, finalized: { [DAY]: [A.id, B.id] } });
    await runClosingDigestsWith(off.io, B.id, DAY);
    expect([off.sent.length, off.store.rows.length]).toEqual([0, 0]);
    const preview = makeIO({ now: "2026-10-08T02:30:00Z", settings: { mode: "preview" }, finalized: { [DAY]: [A.id, B.id] } });
    await runClosingDigestsWith(preview.io, B.id, DAY);
    expect(packagesSent(preview.sent)).toMatchObject([{ to: "operator@example.com", subject: `PACKAGE daily_close ${DAY} preview` }]);
    expect(preview.store.pkg().find((r) => r.outcome === "sent")).toMatchObject({ mode: "preview" });
  });

  it("an IO without packages (PR1 shape) runs the digests unchanged", async () => {
    const { io, sent } = makeIO({ now: "2026-10-08T02:30:00Z", finalized: { [DAY]: [A.id, B.id] } });
    delete (io as { packages?: unknown }).packages;
    await runClosingDigestsWith(io, B.id, DAY);
    expect(packagesSent(sent)).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);
  });
});
