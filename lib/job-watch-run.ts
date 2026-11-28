import "server-only";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail, teamFrom } from "@/lib/email";
import { DEFAULT_OPS_ALERT_EMAIL, JOBS_REGISTRY, type JobName, type RegisteredJob } from "@/lib/jobs-registry";
import { decideJobWatch, easternBoundary, easternDay } from "@/lib/job-watch";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import { cateringRefundsOn } from "@/lib/catering/refunds-shared";

const auditBase = {
  actorId: null, actorRole: null, resourceTable: "cron", resourceId: null,
  ipAddress: null, userAgent: null,
} as const;

export async function runJobWatch(opts: { self?: JobName; now?: Date }): Promise<{ alerted: number; checked: number }> {
  const sb = getServiceRoleClient();
  const now = opts.now ?? new Date();
  const day = easternDay(now);
  let alerted = 0;
  let checked = 0;
  for (const job of JOBS_REGISTRY as readonly RegisteredJob[]) {
    if (job.job === opts.self) continue;
    if (job.job === "toast-order-capture" && (process.env.TOAST_ORDER_CAPTURE !== "1" || process.env.TOAST_FIXTURES === "1")) continue;
    if (job.job === "toast-labor-pull" && (process.env.TOAST_LABOR_PULL !== "1" || process.env.TOAST_FIXTURES === "1")) continue;
    // Catering refunds B1 (plan "(r5) Watch"): OFF skips BEFORE any epoch lookup; ON is watched only while the epoch
    // admits work, and its aged-work alert is independent of the heartbeat.
    const refund = job.job === REFUND_SWEEP_JOB;
    let refundWatchFrom: string | null = null;
    if (refund) {
      if (!cateringRefundsOn(process.env)) continue;
      const watch = await loadRefundWatch(sb);
      if (!watch) continue;
      if (watch.aged && await alertAgedRefundWork(sb, now, watch.aged)) alerted++;
      refundWatchFrom = watch.openedAt;
    }
    checked++;
    const failureQuery = sb.from("audit_log").select("occurred_at").eq("action", "cron.failure")
      .eq("metadata->>job", job.job).eq("metadata->>detector", "job-watch");
    const [success, failure] = await Promise.all([
      sb.from("audit_log").select("occurred_at").eq("action", "cron.success")
        .eq("metadata->>job", job.job).order("occurred_at", { ascending: false })
        .limit(1).maybeSingle<{ occurred_at: string }>(),
      // The sweep's aged-work alerts share its job name: only a MISSING-RUN alert dedupes a missing run.
      (refund ? failureQuery.eq("metadata->>reason", "missing_run") : failureQuery)
        .order("occurred_at", { ascending: false }).limit(1).maybeSingle<{ occurred_at: string }>(),
    ]);
    if (success.error || failure.error) throw new Error("Heartbeat lookup failed");
    const lastSuccessAt = success.data?.occurred_at ?? null;
    // A sweep that could not have run yet is not late: the epoch's opening is its earliest expectation.
    const decision = decideJobWatch(job, now, refund ? latestInstant(lastSuccessAt, refundWatchFrom) : lastSuccessAt, failure.data?.occurred_at ?? null);
    if (!decision.shouldAlert) continue;

    // Existing atomic RPC (0131/0132), used directly to FAIL CLOSED on errors.
    // The usual checkAndRecord wrapper fails open, which would permit duplicate alerts.
    // Claim before side effects: retries/concurrent invocations get at most one attempt per ET day.
    const claim = await sb.rpc("portal_rate_limit_hit", {
      p_bucket_key: `job-watch:${job.job}:${day}`,
      p_window_start: easternBoundary(day, 0).toISOString(),
      p_max: 1,
    });
    if (claim.error) throw new Error("Alert claim failed");
    if (claim.data !== true) continue;

    // One bilingual email for the operator; no separate Spanish send.
    const messages = (["en", "es"] as const).map((language) => {
      const time = lastSuccessAt
        ? `${formatDateLabel(easternDay(new Date(lastSuccessAt)), language)} ${formatTime(lastSuccessAt, language)} ET`
        : serverT(language, "jobWatch.never");
      return {
        subject: serverT(language, "jobWatch.subject", { job: job.job, time }),
        body: serverT(language, "jobWatch.body", { job: job.job, time }) + " " +
          serverT(language, job.source === "pinger" ? "jobWatch.check_pinger" : "jobWatch.check_vercel"),
      };
    });
    const emailError = await sendOperatorAlert(messages);
    // Append exactly one row after the email attempt so its failure belongs to THIS row.
    // audit() derives destructive=false from the existing closed cron.failure vocabulary.
    await audit({ ...auditBase, action: "cron.failure", metadata: {
      job: job.job, last_success_at: lastSuccessAt, expected_by: decision.expectedBy,
      detector: "job-watch", ...(refund ? { reason: "missing_run" } : {}), email_error: emailError,
    } });
    alerted++;
  }
  return { alerted, checked };
}

/** One bilingual email to the operator (en then es in one body); the send error, if any, for the audit row. */
async function sendOperatorAlert(messages: ReadonlyArray<{ subject: string; body: string }>): Promise<string | null> {
  const text = messages.map((m) => m.body).join("\n\n");
  let emailError: string | null = null;
  try {
    const sent = await sendEmail({
      to: process.env.OPS_ALERT_EMAIL?.trim() || DEFAULT_OPS_ALERT_EMAIL,
      from: teamFrom(), subject: messages[0]!.subject, text,
      html: `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n\n", "</p><p>")}</p>`,
    });
    if ("error" in sent) emailError = sent.error.slice(0, 500);
  } catch (error) {
    emailError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  }
  return emailError;
}

// -- Catering refunds B1: the conditional sweep watch ------------------------------------------------------
const REFUND_SWEEP_JOB = "catering-refund-sweep" satisfies JobName;
type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/**
 * The aged-work claim window. It never rolls over (unlike a missing run's ET-day bucket), so one obligation with one
 * evidence fingerprint alerts ONCE across ET days; new evidence is a new fingerprint and alerts again.
 */
export const REFUND_AGED_ALERT_WINDOW_START = new Date(0).toISOString();

export interface RefundAgedWork { kind: "event" | "payment"; dueAt: string; fingerprint: string }
export interface RefundWatch { openedAt: string | null; aged: RefundAgedWork | null }

function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function latestInstant(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * 0359 `catering_refund_watch_state` -> what the watch acts on, or null = not watched (an incompatible caller, or an
 * epoch that admits no work). A malformed aged obligation THROWS: an alert input is never guessed.
 */
export function parseRefundWatch(raw: unknown): RefundWatch | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const epoch = (r.epoch && typeof r.epoch === "object" ? r.epoch : {}) as Record<string, unknown>;
  if (epoch.caller_ok !== true) return null;
  if (epoch.state !== "recovering" && epoch.state !== "live" && epoch.state !== "draining") return null;
  const openedAt = instant(epoch.opened_at);
  if (r.aged === null || r.aged === undefined) return { openedAt, aged: null };
  const a = (typeof r.aged === "object" ? r.aged : {}) as Record<string, unknown>;
  const dueAt = instant(a.due_at);
  if ((a.kind !== "event" && a.kind !== "payment") || !dueAt || typeof a.fingerprint !== "string" || !/^[0-9a-f]{32}$/.test(a.fingerprint)) {
    throw new Error("Refund watch state malformed");
  }
  return { openedAt, aged: { kind: a.kind, dueAt, fingerprint: a.fingerprint } };
}

/** ONE refund read per watch run, through the contract-versioned caller. Missing / incompatible = not watched. */
async function loadRefundWatch(sb: ServiceClient): Promise<RefundWatch | null> {
  // Loaded only while ON, so an OFF watch run's module graph and calls stay main's.
  const { refundRpc, RefundReconcileError } = await import("@/lib/catering/refund-reconcile");
  let raw: unknown;
  try {
    raw = await refundRpc<unknown>(sb, "catering_refund_watch_state", {});
  } catch (error) {
    if (error instanceof RefundReconcileError && error.code === "refunds_unavailable") return null;
    throw new Error("Refund watch lookup failed");
  }
  return parseRefundWatch(raw);
}

/**
 * The aged-work alert: the oldest due, actionable obligation without progress for 24 h (0359 decides which), even
 * with fresh heartbeats. Claimed before the email (fail closed), keyed by the evidence fingerprint. The mail names the
 * kind and the age only: no shop, payment, customer or person. True when this run claimed (and so attempted) it.
 */
async function alertAgedRefundWork(sb: ServiceClient, now: Date, aged: RefundAgedWork): Promise<boolean> {
  const claim = await sb.rpc("portal_rate_limit_hit", {
    p_bucket_key: `job-watch:${REFUND_SWEEP_JOB}:aged:${aged.fingerprint}`,
    p_window_start: REFUND_AGED_ALERT_WINDOW_START,
    p_max: 1,
  });
  if (claim.error) throw new Error("Alert claim failed");
  if (claim.data !== true) return false;
  const hours = String(Math.max(0, Math.floor((now.getTime() - Date.parse(aged.dueAt)) / 3_600_000)));
  const messages = (["en", "es"] as const).map((language) => {
    const kind = serverT(language, aged.kind === "event" ? "jobWatch.aged_kind_event" : "jobWatch.aged_kind_payment");
    return {
      subject: serverT(language, "jobWatch.aged_subject", { job: REFUND_SWEEP_JOB, hours }),
      body: serverT(language, "jobWatch.aged_body", { job: REFUND_SWEEP_JOB, kind, hours }) + " " + serverT(language, "jobWatch.aged_check"),
    };
  });
  const emailError = await sendOperatorAlert(messages);
  await audit({ ...auditBase, action: "cron.failure", metadata: {
    job: REFUND_SWEEP_JOB, detector: "job-watch", reason: "aged_work", fingerprint: aged.fingerprint,
    kind: aged.kind, due_at: aged.dueAt, email_error: emailError,
  } });
  return true;
}

/** Called only AFTER the caller has awaited its own heartbeat. */
export async function watchSiblings(self: JobName): Promise<void> {
  try {
    await runJobWatch({ self });
  } catch {
    // Monitoring must never fail the job that gave it a chance to run.
  }
}
