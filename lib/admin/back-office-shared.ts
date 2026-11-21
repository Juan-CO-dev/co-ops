/**
 * The Back office's "Needs attention" line (nav spec r5, 5.1.2; nav PR 4 plan r2, 1.3 with amendment A1). Pure:
 * no server import (type-only imports of the two health shapes), no clock (the caller passes "now").
 *
 * Today's four health reads become checks. Each state is exactly one of four words: Issue, Healthy, Unavailable,
 * Not enabled. A read that FAILED is "Unavailable" and never a zero or "Healthy"; a check the viewer may not see is
 * simply absent (the page never reads it). The line says "All systems OK" only when no check is Issue or Unavailable.
 */
import type { CronHealth, InboundHealth } from "@/lib/admin/ops-health";
import { readinessWhereEntries, type ReadinessByScope, type ReadinessWhereEntry } from "@/lib/admin/readiness-scope-shared";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import { byId } from "@/lib/nav/destinations";
import { etCalendarDate, etDisplayDate } from "@/lib/operational-day";

export type CheckState = "issue" | "healthy" | "unavailable" | "not_enabled";
export type CheckId = "sales_pull" | "inbox" | "vendor_mail" | "not_ready_skus" | "not_ready_recipes" | "not_ready_items";
/** A read's outcome. A rejected loader is `failed`, a value of its own, so it can never be mistaken for zero. */
export type Read<T> = { state: "ok"; value: T } | { state: "failed" };

/** The exact state words (Issue, Healthy, Unavailable, Not enabled). */
export const STATE_KEYS: Readonly<Record<CheckState, TranslationKey>> = {
  issue: "admin.backoffice.state.issue",
  healthy: "admin.backoffice.state.healthy",
  unavailable: "admin.backoffice.state.unavailable",
  not_enabled: "admin.backoffice.state.not_enabled",
};

export interface AttentionCheck {
  id: CheckId;
  state: CheckState;
  nameKey: TranslationKey;
  /** The fix: a page, or `#system-status` (the panel holding the error text and the retry buttons). */
  href: string;
  /** not_ready_*: the per-shop entries ("1 in the default · 2 at P Street"), only when there is an Issue. */
  where?: ReadinessWhereEntry[];
  /** The count behind an Issue or a Healthy (the matching row's badge). Never set on an Unavailable check. */
  count?: number;
  /** sales_pull, failed in the window: when (ISO). */
  failedAt?: string | null;
  /** sales_pull: the last run swallowed failures. */
  degraded?: boolean;
}

/** Amendment A1: a healthy sales check carries its timestamp, so the all-clear line reads it from the check alone. */
export type SalesPullCheck = AttentionCheck & { id: "sales_pull"; lastSuccessAt: string | null };

export const SYSTEM_STATUS_HASH = "#system-status";
const VENDOR_MAIL_FIX = "/operations/vendor-mail?stale=1";

/** Sales pull. Issue: failed in the last 48 h, or the last run ran with failures. Not enabled: the read worked and no
 *  run was ever recorded (the dormant shape: "no false alarm before Toast creds land"). */
export function salesPullCheck(r: Read<CronHealth>): SalesPullCheck {
  const base = { id: "sales_pull" as const, nameKey: "admin.backoffice.check.sales_pull" as const, href: SYSTEM_STATUS_HASH };
  if (r.state === "failed") return { ...base, state: "unavailable", lastSuccessAt: null };
  const h = r.value;
  if (h.hasRecentFailure) return { ...base, state: "issue", failedAt: h.lastFailureAt, lastSuccessAt: null };
  if (h.lastSuccessAt && h.lastRunDegraded) return { ...base, state: "issue", degraded: true, lastSuccessAt: null };
  if (h.lastSuccessAt) return { ...base, state: "healthy", lastSuccessAt: h.lastSuccessAt };
  return { ...base, state: "not_enabled", lastSuccessAt: null };
}

/** Inbound mail (MoO+): messages that need a retry. */
export function inboxCheck(r: Read<InboundHealth>): AttentionCheck {
  const base = { id: "inbox" as const, nameKey: "admin.backoffice.check.inbox" as const, href: SYSTEM_STATUS_HASH };
  if (r.state === "failed") return { ...base, state: "unavailable" };
  return { ...base, state: r.value.count > 0 ? "issue" : "healthy", count: r.value.count };
}

/** Vendor mail (GM, MoO+): stale vendor emails. */
export function vendorMailCheck(r: Read<number>): AttentionCheck {
  const base = { id: "vendor_mail" as const, nameKey: byId("vendor-mail").nameKey, href: VENDOR_MAIL_FIX };
  if (r.state === "failed") return { ...base, state: "unavailable" };
  return { ...base, state: r.value > 0 ? "issue" : "healthy", count: r.value };
}

export type ReadinessSection = "skus" | "recipes" | "items";
export const READINESS_SECTIONS: readonly ReadinessSection[] = ["skus", "recipes", "items"];
export interface NotReadyCounts { skus: number; recipes: number; items: number; byScope: ReadinessByScope[] }

/** SKUs, recipes and prep items not ready, one check per section the viewer has as a row (in that order). One
 *  failed read makes all three Unavailable. */
export function notReadyChecks(r: Read<NotReadyCounts>, visible: ReadonlySet<ReadinessSection>): AttentionCheck[] {
  return READINESS_SECTIONS.filter((s) => visible.has(s)).map((s): AttentionCheck => {
    const d = byId(s);
    const base = { id: `not_ready_${s}` as const, nameKey: d.nameKey, href: d.route };
    if (r.state === "failed") return { ...base, state: "unavailable" };
    const count = r.value[s];
    if (count === 0) return { ...base, state: "healthy", count };
    return { ...base, state: "issue", count, where: readinessWhereEntries(s, d.route, r.value.byScope) };
  });
}

/** Which check is the worst, first to last. Issues first (a failed sales pull, inbound mail, a sales pull that ran with
 *  failures, vendor mail, then not-ready SKUs, recipes, prep items), then every Unavailable in check order. */
export const WORST_ORDER: readonly string[] = [
  "issue:sales_pull:failed", "issue:inbox", "issue:sales_pull:degraded", "issue:vendor_mail",
  "issue:not_ready_skus", "issue:not_ready_recipes", "issue:not_ready_items",
  "unavailable:sales_pull", "unavailable:inbox", "unavailable:vendor_mail",
  "unavailable:not_ready_skus", "unavailable:not_ready_recipes", "unavailable:not_ready_items",
];

function rankKey(c: AttentionCheck): string | null {
  if (c.state === "unavailable") return `unavailable:${c.id}`;
  if (c.state !== "issue") return null;
  if (c.id === "sales_pull") return c.degraded ? "issue:sales_pull:degraded" : "issue:sales_pull:failed";
  return `issue:${c.id}`;
}

export const needsAttention = (c: AttentionCheck): boolean => c.state === "issue" || c.state === "unavailable";

export type AttentionSummary =
  | { kind: "attention"; n: number; worst: AttentionCheck }
  | { kind: "ok"; lastSalesPullAt: string | null };

/** The line's verdict. `n` counts Issue and Unavailable (lead decision 5). The all-clear time comes ONLY from the
 *  sales check, and only when it is Healthy (A1). */
export function summarize(checks: readonly AttentionCheck[], sales: SalesPullCheck | null): AttentionSummary {
  const bad = checks.filter(needsAttention);
  if (bad.length > 0) {
    const worst = [...bad].sort((a, b) => WORST_ORDER.indexOf(rankKey(a)!) - WORST_ORDER.indexOf(rankKey(b)!))[0]!;
    return { kind: "attention", n: bad.length, worst };
  }
  return { kind: "ok", lastSalesPullAt: sales?.state === "healthy" ? sales.lastSuccessAt : null };
}

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

/** The one sentence a check says when it needs attention (Issue or Unavailable); null otherwise. */
export function checkSentence(c: AttentionCheck, lang: Language, t: Translate): string | null {
  if (c.state === "unavailable") return t("admin.backoffice.attention.unavailable", { name: t(c.nameKey) });
  if (c.state !== "issue") return null;
  const n = c.count ?? 0;
  switch (c.id) {
    case "sales_pull":
      return c.degraded
        ? t("admin.backoffice.attention.sales_degraded")
        : t("admin.backoffice.attention.sales_failed", { date: c.failedAt ? formatDateLabel(etDisplayDate(c.failedAt), lang) : "" });
    case "inbox":
      return t(n === 1 ? "admin.backoffice.attention.inbox_one" : "admin.backoffice.attention.inbox_other", { n });
    case "vendor_mail":
      return t(n === 1 ? "admin.backoffice.attention.vendor_mail_one" : "admin.backoffice.attention.vendor_mail_other", { n });
    default:
      return t("admin.backoffice.attention.not_ready", { name: t(c.nameKey), count: n });
  }
}

/** The whole line: "Needs attention: 3. {worst}", or the all-clear with the last sales pull's time (today in ET) or
 *  date and time (older), or plain "All systems OK." when the sales pull is Not enabled. */
export function attentionLine(s: AttentionSummary, now: string, lang: Language, t: Translate): string {
  if (s.kind === "attention") return t("admin.backoffice.attention.summary", { n: s.n, worst: checkSentence(s.worst, lang, t) ?? "" });
  const at = s.lastSalesPullAt;
  if (!at) return t("admin.backoffice.attention.ok");
  const time = formatTime(at, lang);
  if (etDisplayDate(at) === etCalendarDate(now)) return t("admin.backoffice.attention.ok_sales_today", { time });
  return t("admin.backoffice.attention.ok_sales_date", { date: formatDateLabel(etDisplayDate(at), lang), time });
}
