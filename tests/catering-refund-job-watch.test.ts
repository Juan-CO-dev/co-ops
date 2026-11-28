// Catering refunds B1 plan "(r5) Watch": the sweep is watched CONDITIONALLY. OFF = no refund read at all; ON = one
// `catering_refund_watch_state` read; watched only while the epoch is recovering / live / draining, expected no
// earlier than the epoch opened; aged work alerts independently, deduplicated by obligation + evidence fingerprint.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runJobWatch, watchSiblings, parseRefundWatch, REFUND_AGED_ALERT_WINDOW_START } from "@/lib/job-watch-run";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { audit } from "@/lib/audit";

const S = vi.hoisted(() => ({
  now: new Date(0),
  rows: [] as Array<{ action: string; metadata: Record<string, unknown>; occurred_at: string }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (row: { action: string; metadata: Record<string, unknown> }) => {
    S.rows.push({ action: row.action, metadata: row.metadata, occurred_at: S.now.toISOString() });
  }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "mail" })), teamFrom: () => "team@example.test" }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const JOB = "catering-refund-sweep";
const OPENED = "2026-11-20T15:00:00.000Z";
const F1 = "0123456789abcdef0123456789abcdef";
const F2 = "fedcba9876543210fedcba9876543210";
const LOC = "00000000-0000-4000-8000-00000000aaaa";

let watch: { data: unknown; error: unknown };
let heartbeatAt: string | null;
let buckets: Map<string, number>;
let queriedJobs: string[];
let fromCalls: number;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;

const live = (state = "live", aged: unknown = null, extra: Record<string, unknown> = {}) => ({
  data: { epoch: { state, epoch_id: "00000000-0000-4000-8000-000000000001", generation: 1, opened_at: "2026-11-20T15:00:00+00:00", caller_ok: true, ...extra }, aged },
  error: null,
});
const agedRow = (fingerprint: string, dueAt: string, kind = "payment") => ({ kind, due_at: dueAt, location_id: LOC, fingerprint });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOAST_ORDER_CAPTURE", "");
  vi.stubEnv("TOAST_LABOR_PULL", "");
  vi.stubEnv("TOAST_FIXTURES", "0");
  vi.stubEnv("CATERING_REFUNDS", "1");
  S.rows.length = 0;
  watch = live();
  heartbeatAt = null;
  buckets = new Map();
  queriedJobs = [];
  fromCalls = 0;
  rpcCalls = [];
  const from = () => {
    fromCalls++;
    const f: Record<string, string> = {};
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { f[key] = value; if (key === "metadata->>job") queriedJobs.push(value); return query; },
      order: () => query, limit: () => query,
      maybeSingle: async () => {
        if (f.action === "cron.success") {
          if (f["metadata->>job"] !== JOB) return { data: { occurred_at: new Date(S.now.getTime() - 60_000).toISOString() }, error: null };
          return { data: heartbeatAt ? { occurred_at: heartbeatAt } : null, error: null };
        }
        const hit = S.rows.filter((r) => r.action === f.action
          && Object.entries(f).every(([k, v]) => !k.startsWith("metadata->>") || r.metadata[k.slice(11)] === v))
          .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
        return { data: hit ? { occurred_at: hit.occurred_at } : null, error: null };
      },
    };
    return query;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "portal_rate_limit_hit") {
      const key = `${String(args.p_bucket_key)}|${String(args.p_window_start)}`;
      const n = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, n);
      return { data: n <= Number(args.p_max), error: null };
    }
    if (fn === "catering_refund_watch_state") return watch;
    throw new Error(`unexpected rpc ${fn}`);
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.unstubAllEnvs());

async function runAt(iso: string) {
  S.now = new Date(iso);
  return runJobWatch({ self: "job-watch", now: S.now });
}
const refundMails = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]).filter((m) => m.subject.includes(JOB));
const refundRows = (reason?: string) => S.rows.filter((r) => r.metadata.job === JOB && (!reason || r.metadata.reason === reason));
const watchReads = () => rpcCalls.filter((c) => c.fn === "catering_refund_watch_state");

describe("the conditional refund-sweep watch", () => {
  it("watch_off_silent_live_two_misses_alert: OFF silent with zero refund reads; no epoch silent; fresh silent; two misses ONE alert per ET day", async () => {
    // OFF: no epoch lookup, no refund heartbeat lookup, no alert; every query belongs to another job.
    vi.stubEnv("CATERING_REFUNDS", "");
    const off = await runAt("2026-11-20T18:00:00Z");
    expect(watchReads()).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(queriedJobs).not.toContain(JOB);
    expect(fromCalls).toBe(2 * off.checked);
    expect(off).toEqual({ alerted: 0, checked: 8 });
    expect(refundMails()).toHaveLength(0);
    expect(refundRows()).toHaveLength(0);

    // ON, no open epoch (and sealed): one watch read, nothing watched, nothing sent.
    vi.stubEnv("CATERING_REFUNDS", "1");
    for (const state of ["none", "sealed"]) {
      rpcCalls = []; queriedJobs = [];
      watch = { data: { epoch: { state, epoch_id: null, caller_ok: true }, aged: null }, error: null };
      expect(await runAt("2026-11-20T18:00:00Z")).toEqual({ alerted: 0, checked: 8 });
      expect(watchReads()).toHaveLength(1);
      expect(watchReads()[0]!.args).toEqual({ p_caller: "b1-1" });
      expect(queriedJobs).not.toContain(JOB);
    }
    expect(refundMails()).toHaveLength(0);

    // ON live with a fresh heartbeat: watched, silent.
    watch = live();
    heartbeatAt = "2026-11-20T17:50:00Z";
    queriedJobs = [];
    expect(await runAt("2026-11-20T18:00:00Z")).toEqual({ alerted: 0, checked: 9 });
    expect(queriedJobs).toContain(JOB);
    expect(refundMails()).toHaveLength(0);

    // Two missed 15-minute intervals since the last heartbeat: ONE alert, the existing ET-day claim.
    expect((await runAt("2026-11-20T18:21:00Z")).alerted).toBe(1);
    expect(refundMails()).toHaveLength(1);
    expect(rpcCalls).toContainEqual({ fn: "portal_rate_limit_hit", args: {
      p_bucket_key: `job-watch:${JOB}:2026-11-20`, p_window_start: "2026-11-20T05:00:00.000Z", p_max: 1 } });
    expect(refundRows("missing_run")).toHaveLength(1);
    expect(refundRows("missing_run")[0]!.metadata).toMatchObject({ detector: "job-watch", last_success_at: "2026-11-20T17:50:00Z", expected_by: "2026-11-20T18:20:00.000Z" });
    expect(refundRows("aged_work")).toHaveLength(0);

    // A second run the same ET day: no second alert.
    expect((await runAt("2026-11-20T23:30:00Z")).alerted).toBe(0);
    expect(refundMails()).toHaveLength(1);
  });

  it("the epoch's opening is the earliest expectation: a heartbeat from before it does not make the sweep late", async () => {
    heartbeatAt = "2026-11-17T12:00:00Z"; // a previous epoch
    expect((await runAt("2026-11-20T15:20:00Z")).alerted).toBe(0);
    expect((await runAt("2026-11-20T15:31:00Z")).alerted).toBe(1);
    expect(refundRows("missing_run")[0]!.metadata).toMatchObject({ last_success_at: "2026-11-17T12:00:00Z", expected_by: "2026-11-20T15:30:00.000Z" });
  });

  it("dead scheduler: no heartbeat ever since opened_at + 2 intervals alerts, naming no heartbeat recorded (en + es)", async () => {
    expect((await runAt("2026-11-20T15:29:00Z")).alerted).toBe(0); // could not have been late yet
    expect((await runAt("2026-11-20T15:31:00Z")).alerted).toBe(1);
    const mail = refundMails()[0]!;
    expect(mail.text).toContain("no heartbeat recorded");
    expect(mail.text).toContain("ninguna señal registrada");
    expect(mail.text).toContain("Check Vercel crons for this job.");
    expect(refundRows("missing_run")[0]!.metadata).toMatchObject({ last_success_at: null, expected_by: "2026-11-20T15:30:00.000Z" });
  });

  it.each(["draining", "recovering"])("a %s epoch is still watched", async (state) => {
    watch = live(state);
    heartbeatAt = "2026-11-20T17:00:00Z";
    expect((await runAt("2026-11-20T17:40:00Z")).alerted).toBe(1);
    expect(refundRows("missing_run")).toHaveLength(1);
  });

  it("fresh_heartbeat_old_obligation_alerts: once per fingerprint across ET days; new evidence alerts again", async () => {
    heartbeatAt = "2026-11-21T17:55:00Z";
    watch = live("live", agedRow(F1, "2026-11-20T12:00:00+00:00"));
    expect((await runAt("2026-11-21T18:00:00Z")).alerted).toBe(1);
    expect(rpcCalls).toContainEqual({ fn: "portal_rate_limit_hit", args: {
      p_bucket_key: `job-watch:${JOB}:aged:${F1}`, p_window_start: REFUND_AGED_ALERT_WINDOW_START, p_max: 1 } });
    expect(REFUND_AGED_ALERT_WINDOW_START).toBe("1970-01-01T00:00:00.000Z");
    const mails = refundMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe(`CO-OPS: ${JOB} has refund work waiting 30 hours`);
    expect(mails[0]!.text).toContain("a payment's refund check");
    expect(mails[0]!.text).toContain("la revisión de reembolsos de un pago");
    expect(mails[0]!.text).toContain("30 horas");
    expect(JSON.stringify(mails[0])).not.toContain(LOC);
    const aged = refundRows("aged_work");
    expect(aged).toHaveLength(1);
    expect(aged[0]!.metadata).toEqual({ job: JOB, detector: "job-watch", reason: "aged_work", fingerprint: F1, kind: "payment",
      due_at: "2026-11-20T12:00:00.000Z", email_error: null });
    expect(refundRows("missing_run")).toHaveLength(0);

    // The NEXT ET day, the same obligation and evidence: no re-alert.
    heartbeatAt = "2026-11-22T17:55:00Z";
    expect((await runAt("2026-11-22T18:00:00Z")).alerted).toBe(0);
    expect(refundMails()).toHaveLength(1);

    // New evidence (a new fingerprint): alerts again.
    watch = live("live", agedRow(F2, "2026-11-20T12:00:00Z", "event"));
    expect((await runAt("2026-11-22T18:05:00Z")).alerted).toBe(1);
    expect(refundMails()).toHaveLength(2);
    expect(refundMails()[1]!.text).toContain("a refund event");
    expect(refundRows("aged_work").map((r) => r.metadata.fingerprint)).toEqual([F1, F2]);
  });

  it("fresh but stalled worker: a fresh heartbeat with aged work raises the aged alert ONLY", async () => {
    heartbeatAt = "2026-11-21T17:59:00Z";
    watch = live("live", agedRow(F1, "2026-11-20T10:00:00Z"));
    await runAt("2026-11-21T18:00:00Z");
    expect(refundRows("aged_work")).toHaveLength(1);
    expect(refundRows("missing_run")).toHaveLength(0);
    expect(refundMails()).toHaveLength(1);
  });

  it("the reasons stay separate: an aged alert the same day does not suppress a missing-run alert", async () => {
    heartbeatAt = "2026-11-21T17:00:00Z";
    watch = live("live", agedRow(F1, "2026-11-20T10:00:00Z"));
    expect((await runAt("2026-11-21T17:10:00Z")).alerted).toBe(1); // aged only
    expect((await runAt("2026-11-21T17:40:00Z")).alerted).toBe(1); // now the missing run too
    expect(refundRows("aged_work")).toHaveLength(1);
    expect(refundRows("missing_run")).toHaveLength(1);
  });

  it("healthy_pending_and_dispositioned_work_do_not_realert: aged null across days = no alert", async () => {
    // The SQL already excludes healthy polls, parked PIs, quarantined hints, manual follow-ups and dispositioned
    // restricted payments: what reaches the watch is `aged: null`.
    watch = live("live", null);
    for (const day of ["2026-11-21", "2026-11-22", "2026-11-23"]) {
      heartbeatAt = `${day}T17:55:00Z`;
      expect((await runAt(`${day}T18:00:00Z`)).alerted).toBe(0);
    }
    expect(refundMails()).toHaveLength(0);
    expect(refundRows()).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.fn === "portal_rate_limit_hit")).toHaveLength(0);
  });

  it("a missing function or an incompatible caller is not watched (and never throws)", async () => {
    watch = { data: null, error: { code: "PGRST202", message: "Could not find the function public.catering_refund_watch_state" } };
    expect(await runAt("2026-11-21T18:00:00Z")).toEqual({ alerted: 0, checked: 8 });
    watch = live("live", agedRow(F1, "2026-11-20T10:00:00Z"), { caller_ok: false });
    expect(await runAt("2026-11-21T18:00:00Z")).toEqual({ alerted: 0, checked: 8 });
    expect(queriedJobs).not.toContain(JOB);
    expect(refundMails()).toHaveLength(0);
  });

  it("a malformed aged obligation or a failed read fails closed (runJobWatch throws; watchSiblings swallows)", async () => {
    watch = live("live", { kind: "payment", due_at: "2026-11-20T10:00:00Z", fingerprint: "not-a-hash" });
    await expect(runAt("2026-11-21T18:00:00Z")).rejects.toThrow("Refund watch state malformed");
    watch = { data: null, error: { code: "XX000", message: "connection reset" } };
    await expect(runAt("2026-11-21T18:00:00Z")).rejects.toThrow("Refund watch lookup failed");
    await expect(watchSiblings("toast-sales-today")).resolves.toBeUndefined();
    expect(refundMails()).toHaveLength(0);
    expect(vi.mocked(audit).mock.calls.filter((c) => c[0].metadata?.job === JOB)).toHaveLength(0);
  });

  it("the sweep's own watchSiblings skips its own watch (self) before any refund read", async () => {
    S.now = new Date("2026-11-21T18:00:00Z");
    await runJobWatch({ self: JOB, now: S.now });
    expect(watchReads()).toHaveLength(0);
    expect(queriedJobs).not.toContain(JOB);
  });

  it("parseRefundWatch keeps only what the watch acts on", () => {
    expect(parseRefundWatch(null)).toBeNull();
    expect(parseRefundWatch({ epoch: { state: "live", caller_ok: "true" }, aged: null })).toBeNull();
    expect(parseRefundWatch({ epoch: { state: "closed", caller_ok: true }, aged: null })).toBeNull();
    expect(parseRefundWatch(live("draining", agedRow(F1, "2026-11-20T10:00:00+00:00")).data)).toEqual({
      openedAt: OPENED, aged: { kind: "payment", dueAt: "2026-11-20T10:00:00.000Z", fingerprint: F1 },
    });
  });
});
