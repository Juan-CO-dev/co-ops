import { formatDateLabel } from "@/lib/i18n/format";
import { reportRangeParams } from "@/lib/report-range";
import { bucketStart, addDays, type TrendRange } from "@/lib/reports-trends";
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
  range,
  locationId,
  granularity,
  compare,
  language,
  basePath = "/reports/trends/ops",
}: {
  range?: TrendRange;
  locationId: string;
  granularity: TrendGranularity;
  compare: boolean;
  language: Language;
  basePath?: string;
}) {
  const href = (g: TrendGranularity, c: boolean) => {
    const query = range ? reportRangeParams(range) : new URLSearchParams();
    query.set("location", locationId); query.set("g", g); query.set("compare", c ? "1" : "0");
    return `${basePath}?${query}`;
  };

  const partialLabels = (from: string, to: string) => {
    if (granularity === "day") return [];
    const labels = new Set<string>();
    if (bucketStart(from, granularity) !== from) labels.add(bucketStart(from, granularity));
    if (bucketStart(addDays(to, 1), granularity) === bucketStart(to, granularity)) labels.add(bucketStart(to, granularity));
    return [...labels].map(day => `${formatDateLabel(day, language)} (${serverT(language, "reports.trends.partial")})`);
  };
  const grans: { g: TrendGranularity; key: TranslationKey }[] = [
    { g: "day", key: "reports.trends.gran_day" },
    { g: "week", key: "reports.trends.gran_week" },
    { g: "month", key: "reports.trends.gran_month" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {range ? <form action={basePath} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="location" value={locationId} />
        <input type="hidden" name="g" value={granularity} />
        <input type="hidden" name="compare" value={compare ? "1" : "0"} />
        <input type="hidden" name="range" value="custom" />
        <label className="inline-flex min-h-[44px] items-center gap-1">{serverT(language, "reports.trends.range_from")}<input className="min-h-[44px] border border-co-border rounded-lg px-2" type="date" name="from" defaultValue={range.from} required /></label>
        <label className="inline-flex min-h-[44px] items-center gap-1">{serverT(language, "reports.trends.range_to")}<input className="min-h-[44px] border border-co-border rounded-lg px-2" type="date" name="to" defaultValue={range.to} required /></label>
        <button className="inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 px-3">{serverT(language, "reports.trends.range_apply")}</button>
        {compare ? <p className="w-full text-xs text-co-text-muted">{serverT(language, "reports.trends.legend_previous")}: {formatDateLabel(range.previous.from, language)} – {formatDateLabel(range.previous.to, language)}</p> : null}
        {granularity !== "day" ? <p className="w-full text-xs text-co-text-muted">{serverT(language, "reports.trends.partial_buckets")} {partialLabels(range.from, range.to).join(", ")} {compare ? `${serverT(language, "reports.trends.legend_previous")}: ${partialLabels(range.previous.from, range.previous.to).join(", ")}` : ""}</p> : null}
      </form> : null}
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
                "inline-flex min-h-[44px] items-center rounded-full px-4 py-1.5",
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
          "inline-flex min-h-[44px] items-center rounded-full px-4 py-1.5",
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
