import Link from "next/link";
import type { ReactNode } from "react";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ReportRelations } from "@/lib/report-related";

export function ReportReference({ href, children }: { href?: string; children: ReactNode }) {
  return href ? <Link href={href} className="inline-flex min-h-[44px] items-center text-co-text underline underline-offset-2">{children}</Link> : <span>{children}</span>;
}

export function RelatedReports({ relations, language }: { relations: ReportRelations; language: Language }) {
  const t = (key: TranslationKey) => serverT(language, key);
  return <nav aria-label={t("reports.related.same_day")} className="mb-4 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm">
    <h2 className="text-xs font-bold tracking-wide text-co-text-muted">{t("reports.related.same_day")}</h2>
    <div className="flex flex-wrap gap-x-4">
      {relations.sameDay.length ? relations.sameDay.map(report => <ReportReference key={`${report.type}/${report.id}`} href={report.href}>{t(`reports.type.${report.type}` as TranslationKey)}</ReportReference>) : <span className="py-2 text-co-text-muted">{t("reports.related.none")}</span>}
    </div>
    <div className="flex flex-wrap justify-between gap-x-4 text-co-text-muted">
      {(["previous", "next"] as const).map(direction => <div key={direction} className="flex min-h-[44px] items-center gap-3">
        {relations[direction].length ? relations[direction].map(report => <ReportReference key={report.id} href={report.href}>{t(direction === "previous" ? "reports.related.previous_day" : "reports.related.next_day")}</ReportReference>) : <span>{t(direction === "previous" ? "reports.related.previous_day" : "reports.related.next_day")}</span>}
      </div>)}
    </div>
  </nav>;
}
