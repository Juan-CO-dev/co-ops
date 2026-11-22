/**
 * The numbers strip's labor cell (nav PR 8, plan r2 2.4; lead rulings r1 A8, Q1, Q2). Server component.
 *
 * The ONLY strip file under the business figure census (tests/business-report-figure-census.test.ts), with its rules
 * unchanged: it receives labor VIEWS (figures), never raw amounts, and draws every number through the report's own figure
 * formatter, with its qualifications. Fully loaded first, pure hourly beneath (Q1); the day is the newest of the window
 * whose fully loaded figure is comparable, labelled with its own day (Q2); one legend for the cell's scope.
 */
import Link from "next/link";
import { FigureView, LegendNotes, legendFor } from "@/components/reports-business/BusinessParts";
import type { LaborView } from "@/lib/business-view-shared";
import { newestLaborDay, stripLinks } from "@/lib/dashboard-blocks-shared";
import { formatWeekday } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

export function StripLaborCell({ days, shopId, shopLabel, language }: {
  /** The window's days (ascending), or "failed" (the read failed or timed out). */
  days: ReadonlyArray<{ date: string; view: LaborView }> | "failed";
  shopId: string;
  shopLabel: string;
  language: Language;
}) {
  const pick = days === "failed" ? null : newestLaborDay(days);
  const href = stripLinks(shopId, pick?.date ?? null).labor;
  const name = serverT(language, "reports.business.title");
  const loaded = pick?.view.loadedPct;
  const pure = pick?.view.purePct;
  const legend = legendFor(language, [loaded, pure]);
  return (
    <Link
      href={href}
      data-strip-cell="labor"
      aria-label={serverT(language, "dashboard.strip.link_aria", { name, shop: shopLabel })}
      className="flex min-h-[44px] min-w-0 items-center rounded-lg border border-co-border bg-co-surface-inset p-3 text-co-text hover:border-co-text"
    >
      <span className="flex min-w-0 flex-col gap-1">
        {pick === null ? (
          <span className="text-sm text-co-text-muted">{serverT(language, "dashboard.tile.unavailable")}</span>
        ) : (
          <>
            <span className="text-xs font-bold uppercase tracking-wide text-co-text-muted" data-labor-day={pick.date}>
              {serverT(language, "dashboard.strip.labor_day", { day: formatWeekday(pick.date, language) })}
            </span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm" data-labor="loaded">
              <span className="text-co-text-muted">{serverT(language, "dashboard.strip.labor_loaded")}</span>
              {loaded ? <FigureView f={loaded} language={language} legend={legend} className="text-lg font-bold" /> : null}
            </span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm" data-labor="pure">
              <span className="text-co-text-muted">{serverT(language, "dashboard.strip.labor_pure")}</span>
              {pure ? <FigureView f={pure} language={language} legend={legend} className="font-semibold" /> : null}
            </span>
            <LegendNotes entries={legend.entries} language={language} />
          </>
        )}
      </span>
    </Link>
  );
}
