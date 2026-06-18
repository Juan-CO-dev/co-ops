import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { TrendGranularity } from "@/lib/reports-trends";

/**
 * Day/Week/Month + compare controls. Server-rendered Links (no useSearchParams
 * → no Suspense/prerender constraint). Each control rebuilds the URL from the
 * known current state passed in as props.
 */
export function TrendControls({
  locationId,
  granularity,
  compare,
  language,
}: {
  locationId: string;
  granularity: TrendGranularity;
  compare: boolean;
  language: Language;
}) {
  const href = (g: TrendGranularity, c: boolean) =>
    `/reports/trends?location=${locationId}&g=${g}${c ? "&cmp=1" : ""}`;

  const grans: { g: TrendGranularity; key: TranslationKey }[] = [
    { g: "day", key: "reports.trends.gran_day" },
    { g: "week", key: "reports.trends.gran_week" },
    { g: "month", key: "reports.trends.gran_month" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1.5" role="group" aria-label={serverT(language, "reports.trends.gran_aria")}>
        {grans.map(({ g, key }) => {
          const on = g === granularity;
          return (
            <Link
              key={g}
              href={href(g, compare)}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={[
                "inline-flex min-h-[40px] items-center rounded-full px-4 py-1.5",
                "text-xs font-bold uppercase tracking-[0.1em] transition",
                on
                  ? "border-2 border-co-text bg-co-gold text-co-text"
                  : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text",
              ].join(" ")}
            >
              {serverT(language, key)}
            </Link>
          );
        })}
      </div>
      <Link
        href={href(granularity, !compare)}
        scroll={false}
        className={[
          "inline-flex min-h-[40px] items-center rounded-full px-4 py-1.5",
          "text-xs font-bold uppercase tracking-[0.1em] transition",
          compare
            ? "border-2 border-co-text bg-co-gold text-co-text"
            : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text",
        ].join(" ")}
      >
        {serverT(language, "reports.trends.compare_toggle")}
      </Link>
    </div>
  );
}
