import "server-only";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail, teamFrom } from "@/lib/email";
import { DEFAULT_OPS_ALERT_EMAIL, JOBS_REGISTRY, type JobName } from "@/lib/jobs-registry";
import { decideJobWatch, easternBoundary, easternDay } from "@/lib/job-watch";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";

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
  for (const job of JOBS_REGISTRY) {
    if (job.job === opts.self) continue;
    checked++;
    const [success, failure] = await Promise.all([
      sb.from("audit_log").select("occurred_at").eq("action", "cron.success")
        .eq("metadata->>job", job.job).order("occurred_at", { ascending: false })
        .limit(1).maybeSingle<{ occurred_at: string }>(),
      sb.from("audit_log").select("occurred_at").eq("action", "cron.failure")
        .eq("metadata->>job", job.job).eq("metadata->>detector", "job-watch")
        .order("occurred_at", { ascending: false }).limit(1).maybeSingle<{ occurred_at: string }>(),
    ]);
    if (success.error || failure.error) throw new Error("Heartbeat lookup failed");
    const lastSuccessAt = success.data?.occurred_at ?? null;
    const decision = decideJobWatch(job, now, lastSuccessAt, failure.data?.occurred_at ?? null);
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
    // Append exactly one row after the email attempt so its failure belongs to THIS row.
    // audit() derives destructive=false from the existing closed cron.failure vocabulary.
    await audit({ ...auditBase, action: "cron.failure", metadata: {
      job: job.job, last_success_at: lastSuccessAt, expected_by: decision.expectedBy,
      detector: "job-watch", email_error: emailError,
    } });
    alerted++;
  }
  return { alerted, checked };
}

/** Called only AFTER the caller has awaited its own heartbeat. */
export async function watchSiblings(self: JobName): Promise<void> {
  try {
    await runJobWatch({ self });
  } catch {
    // Monitoring must never fail the job that gave it a chance to run.
  }
}
