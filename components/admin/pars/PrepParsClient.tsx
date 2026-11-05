"use client";

import type { ChecklistLocationView } from "@/lib/admin/templates";
import { isQuestionShapedLine, pickOverride } from "@/lib/items";
import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ParGrid } from "@/components/admin/templates/ParGrid";

export type PrepParsView = ChecklistLocationView & { subtype: "am_prep" | "mid_day_prep" };

const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function PrepParsClient({ views, canEdit }: { views: PrepParsView[]; canEdit: boolean }) {
  const { t, language } = useTranslation();
  const number = (value: number | null) => value == null ? t("admin.pars.not_set") : new Intl.NumberFormat(language).format(value);
  const grouped = new Map<string, { view: PrepParsView; item: PrepParsView["items"][number]; subtypes: Set<PrepParsView["subtype"]> }>();
  for (const view of views) for (const item of view.items) {
    if (isQuestionShapedLine(item)) continue;
    const ctx = view.parContext[item.id];
    const key = ctx?.itemId ? `item:${ctx.itemId}` : `line:${view.templateId}:${item.id}`;
    const existing = grouped.get(key);
    if (existing) existing.subtypes.add(view.subtype);
    else grouped.set(key, { view, item, subtypes: new Set([view.subtype]) });
  }
  const lines = [...grouped.values()];
  return <div className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere] [&_button_span]:min-w-0 [&_label]:min-w-0 [&_label]:max-w-full [&_input]:min-w-0">
    {!lines.length && <p>{t("admin.pars.prep_empty")}</p>}
    {lines.map(({ view, item, subtypes }) => {
      const ctx = view.parContext[item.id];
      if (!ctx) return null;
      const name = ctx.itemId
        ? (language === "es" ? ctx.itemNameEs : null) ?? ctx.itemName ?? item.label
        : (language === "es" ? item.translations?.es?.label : null) ?? item.label;
      const recommended = ctx.itemId ? ctx.recommendedPar : item.prepMeta?.parValue ?? null;
      const unit = ctx.itemId ? ctx.recommendedParUnit : item.prepMeta?.parUnit ?? null;
      const base = ctx.overrides.find((o) => o.dayOfWeek === null);
      const baseValue = base?.parMode === "manual" ? base.parValue : recommended;
      return <div key={item.id} className="co-card min-w-0 p-3">
        <div className="mb-2 flex flex-wrap gap-1">{[...subtypes].map((subtype) =>
          <span key={subtype} className="rounded bg-co-surface-2 px-2 py-1 text-xs">{t(`admin.templates.subtype.${subtype}`)}</span>)}</div>
        <CollapsibleSection idBase={`prep-par-${item.id}`} title={name} count={`${t("admin.templates.par_grid.all_days")}: ${number(baseValue)} ${unit ?? ""} / ${days.map((day, index) => {
          const override = pickOverride(ctx.overrides, index);
          return `${t(`admin.templates.par_grid.day.${day}`)} ${number(override?.parMode === "manual" ? override.parValue : recommended)}`;
        }).join(" / ")}`}>

          <dl className="grid min-w-0 grid-cols-2 gap-2 text-sm">
            {days.map((day, index) => {
              const override = pickOverride(ctx.overrides, index);
              return <div key={day}><dt>{t(`admin.templates.par_grid.day.${day}`)}</dt>
                <dd>{number(override?.parMode === "manual" ? override.parValue : recommended)} {unit}</dd></div>;
            })}
          </dl>
          {canEdit && ctx.itemId && view.templateId && <ParGrid key={JSON.stringify(ctx)} templateId={view.templateId} lineId={item.id} locationId={view.locationId} parCtx={ctx} />}
        </CollapsibleSection>
      </div>;
    })}
  </div>;
}
