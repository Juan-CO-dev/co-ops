/**
 * Nav PR 4 (plan r2, 7.8): Back office view models for the UI test and the 375 px browser harness. Built through the
 * real pure modules (backOfficeFor, the check functions), never by hand: a GM with an Issue and an Unavailable, an AGM
 * all clear, a MoO with every switch on, and the social media manager.
 */
import type { BackOfficeHubView } from "@/components/admin/back-office/BackOfficeHub";
import {
  inboxCheck, notReadyChecks, salesPullCheck, vendorMailCheck, type AttentionCheck, type NotReadyCounts, type Read,
} from "@/lib/admin/back-office-shared";
import type { CronHealth } from "@/lib/admin/ops-health";
import { NO_CRON_RUN_FAILURES } from "@/lib/admin/ops-health-shared";
import type { WeekCard } from "@/lib/admin/week-card-shared";
import type { Language } from "@/lib/i18n/types";
import { backOfficeFor } from "@/lib/nav/back-office";
import type { RoleCode } from "@/lib/roles";
import { getRoleLevel } from "@/lib/roles";

export const NOW = "2026-11-20T18:30:00.000Z";
const RAN_TODAY = "2026-11-20T11:02:00.000Z";
const cron = (over: Partial<CronHealth> = {}): CronHealth => ({
  hasRecentFailure: false, lastFailureAt: null, lastFailureError: null, lastSuccessAt: RAN_TODAY, lastRunDegraded: false,
  lastRunFailures: NO_CRON_RUN_FAILURES, ...over,
});
const QUIET_WEEK: WeekCard = { shops: [], overallPeople: 0 } as unknown as WeekCard;

function view(role: RoleCode, lang: Language, opts: {
  cron?: Read<CronHealth>; counts?: Read<NotReadyCounts>; vendorMail?: Read<number> | null; inbound?: Read<{ count: number; rows: [] }> | null;
  switches?: { demandSignals?: boolean; marketingScorecard?: boolean };
}): BackOfficeHubView {
  const office = backOfficeFor({ role, level: getRoleLevel(role), switches: opts.switches ?? { demandSignals: true, marketingScorecard: true } });
  const shown = new Set(office.groups.flatMap((g) => g.rows.map((r) => r.id)));
  const readiness = new Set((["skus", "recipes", "items"] as const).filter((s) => shown.has(s)));
  const cronRead = opts.cron ?? { state: "ok", value: cron() };
  const sales = salesPullCheck(cronRead);
  const checks: AttentionCheck[] = [sales];
  if (opts.inbound) checks.push(inboxCheck(opts.inbound));
  if (opts.vendorMail) checks.push(vendorMailCheck(opts.vendorMail));
  checks.push(...notReadyChecks(opts.counts ?? { state: "ok", value: { skus: 0, recipes: 0, items: 0, byScope: [] } }, readiness));
  return {
    lang, now: NOW, deniedKey: null, office, checks, sales, cron: cronRead,
    vendorMail: opts.vendorMail ?? null, inbound: opts.inbound ?? null, week: { state: "ok", value: QUIET_WEEK },
  };
}

export const FIXTURES: Record<string, (lang: Language) => BackOfficeHubView> = {
  /** A GM: recipes not ready at two scopes (Issue), vendor mail unreadable (Unavailable). */
  "gm-issue": (lang) => view("gm", lang, {
    counts: { state: "ok", value: { skus: 0, recipes: 3, items: 1, byScope: [
      { scope: null, scopeName: null, skus: 0, recipes: 1, items: 0 },
      { scope: "00000000-0000-4000-8000-000000000001", scopeName: "P Street", skus: 0, recipes: 2, items: 1 },
    ] } },
    vendorMail: { state: "failed" },
  }),
  /** An AGM with nothing wrong. */
  "agm-clear": (lang) => view("agm", lang, {}),
  /** A MoO, every switch on, a sales pull that failed last night. */
  "moo-all": (lang) => view("moo", lang, {
    cron: { state: "ok", value: cron({ hasRecentFailure: true, lastFailureAt: "2026-11-20T03:00:00.000Z", lastFailureError: "toast 503" }) },
    vendorMail: { state: "ok", value: 0 }, inbound: { state: "ok", value: { count: 0, rows: [] } },
  }),
  /** The social media manager: today's pages only, no jobs, no People group. */
  smm: (lang) => view("social_media_mgr", lang, {}),
};
