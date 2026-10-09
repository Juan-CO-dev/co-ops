/**
 * Small shared pieces of the Sales pages (Reports hub piece 4). Server components only: every
 * string is translated here or by the caller, every number arrives as a DTO from
 * lib/sales-reports.ts (no service import, no client state).
 */
import Link from "next/link";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { SALES_CHANNELS, SALES_VIEWS, serverRef, type CoverageStatus, type SalesView } from "@/lib/sales-reports-shared";

export const salesCard = "min-w-0 max-w-full break-words rounded-xl border border-co-border bg-co-surface p-4";
export const salesLink = "inline-flex min-h-[44px] items-center underline underline-offset-2";
export const salesPill = "inline-flex min-h-[44px] items-center rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition";

export function tFor(language: Language) {
  return (key: TranslationKey, values?: Record<string, string | number>) => serverT(language, key, values);
}

/** Absent money is a dash with a reason, never "$0.00". */
export function Money({ cents, language }: { cents: number | null | undefined; language: Language }) {
  if (cents === null || cents === undefined) return <span aria-label={serverT(language, "reports.sales.amount_unavailable")}>—</span>;
  return <>{formatCents(cents, language)}</>;
}

export function channelLabel(language: Language, channel: string | null | undefined): string {
  const c = channel && (SALES_CHANNELS as readonly string[]).includes(channel) ? channel : "unknown";
  return serverT(language, `reports.sales.channel.${c}` as TranslationKey);
}

/** Provider names are tenant vocabulary from the reviewed map; an absent one says so. */
export function providerLabel(language: Language, provider: string | null | undefined): string {
  return provider && provider.trim() ? provider : serverT(language, "reports.sales.provider.none");
}

/** The order's server by Toast FIRST name; no name = "not mapped" + a 4-character reference. */
export function serverLabel(language: Language, key: string, name: string | null | undefined): string {
  if (!key) return serverT(language, "reports.sales.server.none");
  return name && name.trim() ? name : serverT(language, "reports.sales.server.unmapped", { ref: serverRef(key) });
}

export function discountLabel(language: Language, name: string | null | undefined): string {
  return name && name.trim() ? name : serverT(language, "reports.sales.discount.unnamed");
}

export function CoverageBadge({ status, covered, expected, language }: { status: CoverageStatus; covered: number; expected: number; language: Language }) {
  const tone = status === "complete" ? "border-co-success bg-co-success-surface text-co-confirm-text"
    : status === "partial" ? "border-co-warning bg-co-warning-surface text-co-warning-text" : "border-co-danger bg-co-danger-surface text-co-cta-text";
  return <span className={`inline-flex min-h-[28px] items-center rounded-full border px-2 text-xs font-bold ${tone}`}>
    {serverT(language, `reports.sales.coverage.${status}` as TranslationKey, { covered, expected })}
  </span>;
}

export function SalesViewTabs({ view, hrefFor, language }: { view: SalesView; hrefFor: (view: SalesView) => string; language: Language }) {
  return <nav className="mb-4 flex flex-wrap gap-2" aria-label={serverT(language, "reports.sales.views_aria")}>
    {SALES_VIEWS.map((v) => <Link key={v} href={hrefFor(v)} aria-current={v === view ? "page" : undefined}
      className={`${salesPill} ${v === view ? "border-co-text bg-co-gold text-co-text" : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text"}`}>
      {serverT(language, `reports.sales.view.${v}` as TranslationKey)}
    </Link>)}
  </nav>;
}

export function RangeCaption({ from, to, language, todaySoFar, capturedAt }: { from: string; to: string; language: Language; todaySoFar?: boolean; capturedAt?: string | null }) {
  const t = tFor(language);
  return <p className="mb-3 text-sm text-co-text-muted">
    {from === to ? formatDateLabel(from, language) : t("reports.export.header.range", { from: formatDateLabel(from, language), to: formatDateLabel(to, language) })}
    {" · "}{t("reports.sales.basis")}
    {todaySoFar ? <> · {capturedAt ? t("reports.sales.today_so_far", { time: formatTime(capturedAt, language) }) : t("reports.sales.today_none")}</> : null}
  </p>;
}

/** The page says WHY a section has no numbers: 0232 not applied, a refused scope, or a failed read. */
export function SalesUnavailable({ code, language }: { code: string; language: Language }) {
  const key = code === "sales_reads_not_installed" ? "reports.sales.not_installed" : "reports.sales.read_failed";
  return <p className={`${salesCard} text-sm text-co-text-muted`} role="status">{serverT(language, key)}</p>;
}
