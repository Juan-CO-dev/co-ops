import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ReportGrain, ReportRange } from "@/lib/report-range";

const DEFAULT_RANGES = ["today", "yesterday", "last7", "last30", "this_month", "last_month", "custom"] as const;

/**
 * Shared range form. Sales passes its own presets (finished days, 90 days, 12 months), a grain
 * select and its own cap line; every other page keeps the defaults unchanged.
 */
export function ReportRangeControls({ range, locationId, language, action = "/reports", preserve = {}, shortened = false, ranges = DEFAULT_RANGES, grains, grain, capKey = "reports.hub.cap", shortenedKey = "reports.hub.range_shortened" }: {
  range: Pick<ReportRange, "range" | "from" | "to" | "compare">; locationId: string; language: Language; action?: string;
  preserve?: Record<string, string | undefined>; shortened?: boolean; ranges?: readonly string[];
  grains?: readonly ReportGrain[]; grain?: ReportGrain; capKey?: TranslationKey; shortenedKey?: TranslationKey;
}) {
  const control = "inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 bg-co-surface px-3 text-sm";
  const owned = ["location", "range", "from", "to", "compare", "cmp", "cursor", ...(grains ? ["g"] : [])];
  return <form action={action} className="mb-4 flex flex-wrap items-end gap-3">
    <input type="hidden" name="location" value={locationId} />
    {Object.entries(preserve).filter(([key,value]) => value && !key.startsWith("cursor_") && !owned.includes(key)).map(([key,value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <label className="grid gap-1 text-xs font-bold">{serverT(language, "reports.hub.range")}
      <select name="range" defaultValue={range.range} className={control}>
        {ranges.map((value) => <option key={value} value={value}>{serverT(language, `reports.hub.${value}` as TranslationKey)}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold">{serverT(language, "reports.hub.from")}<input className={control} type="date" aria-label={serverT(language, "reports.hub.from")} name="from" defaultValue={range.from} /></label>
    <label className="grid gap-1 text-xs font-bold">{serverT(language, "reports.hub.to")}<input className={control} type="date" aria-label={serverT(language, "reports.hub.to")} name="to" defaultValue={range.to} /></label>
    {grains ? <label className="grid gap-1 text-xs font-bold">{serverT(language, "reports.sales.grain.label")}
      <select name="g" defaultValue={grain ?? "day"} className={control}>
        {grains.map((value) => <option key={value} value={value}>{serverT(language, `reports.sales.grain.${value}` as TranslationKey)}</option>)}
      </select>
    </label> : null}
    <label className="inline-flex min-h-[44px] items-center gap-2 text-sm"><input className="h-5 w-5" type="checkbox" aria-label={serverT(language, "reports.hub.compare")} name="compare" value="true" defaultChecked={range.compare} />{serverT(language, "reports.hub.compare")}</label>
    <button className={control} type="submit">{serverT(language, "reports.hub.apply")}</button>
    <p className="w-full text-xs text-co-text-muted">{serverT(language, capKey)}</p>
    {shortened ? <p className="w-full text-xs text-co-text-muted">{serverT(language, shortenedKey)}</p> : null}
  </form>;
}
