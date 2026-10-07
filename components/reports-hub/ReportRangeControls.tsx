import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ReportRange } from "@/lib/report-range";

export function ReportRangeControls({ range, locationId, language, action = "/reports", preserve = {} }: { range: ReportRange; locationId: string; language: Language; action?: string; preserve?: Record<string, string | undefined> }) {
  const control = "inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 bg-co-surface px-3 text-sm";
  return <form action={action} className="mb-4 flex flex-wrap items-end gap-3">
    <input type="hidden" name="location" value={locationId} />
    {Object.entries(preserve).filter(([key,value]) => value && !["location","range","from","to","compare","cmp","cursor"].includes(key)).map(([key,value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <label className="grid gap-1 text-xs font-bold">{serverT(language, "reports.hub.range")}
      <select name="range" defaultValue={range.range} className={control}>
        {["today", "yesterday", "last7", "last30", "this_month", "last_month", "custom"].map((value) => <option key={value} value={value}>{serverT(language, `reports.hub.${value}` as TranslationKey)}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold">{serverT(language, "reports.hub.from")}<input className={control} type="date" aria-label={serverT(language, "reports.hub.from")} name="from" defaultValue={range.from} /></label>
    <label className="grid gap-1 text-xs font-bold">{serverT(language, "reports.hub.to")}<input className={control} type="date" aria-label={serverT(language, "reports.hub.to")} name="to" defaultValue={range.to} /></label>
    <label className="inline-flex min-h-[44px] items-center gap-2 text-sm"><input className="h-5 w-5" type="checkbox" aria-label={serverT(language, "reports.hub.compare")} name="compare" value="true" defaultChecked={range.compare} />{serverT(language, "reports.hub.compare")}</label>
    <button className={control} type="submit">{serverT(language, "reports.hub.apply")}</button>
    <p className="w-full text-xs text-co-text-muted">{serverT(language, "reports.hub.cap")}</p>
  </form>;
}
