"use client";

import type { ChecklistLocationView } from "@/lib/admin/templates";
import { isQuestionShapedLine, pickOverride } from "@/lib/items";
import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ParGrid } from "@/components/admin/templates/ParGrid";

const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function PrepParsClient({ views, canEdit }: { views: ChecklistLocationView[]; canEdit: boolean }) {
  const { t, language } = useTranslation();
  const number = (value: number | null) => value == null ? t("admin.pars.not_set") : new Intl.NumberFormat(language).format(value);
  const lines = views.flatMap((view) => view.items.filter((item) => !isQuestionShapedLine(item)).map((item) => ({ view, item })));
  return <div className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere] [&_button_span]:min-w-0 [&_label]:min-w-0 [&_label]:max-w-full [&_input]:min-w-0">
    {!lines.length && <p>{t("admin.pars.prep_empty")}</p>}
    {lines.map(({ view, item }) => {
      const ctx = view.parContext[item.id];
      if (!ctx) return null;
      const name = (language === "es" ? ctx.itemNameEs : null) ?? ctx.itemName ?? item.label;
      const base = ctx.overrides.find((o) => o.dayOfWeek === null);
      const baseValue = base?.parMode === "manual" ? base.parValue : ctx.recommendedPar;
      return <div key={item.id} className="co-card min-w-0 p-3">
        <CollapsibleSection idBase={`prep-par-${item.id}`} title={name} count={`${t("admin.templates.par_grid.all_days")}: ${number(baseValue)} ${ctx.recommendedParUnit ?? ""} / ${days.map((day, index) => {
          const override = pickOverride(ctx.overrides, index);
          return `${t(`admin.templates.par_grid.day.${day}`)} ${number(override?.parMode === "manual" ? override.parValue : ctx.recommendedPar)}`;
        }).join(" / ")}`}>

          <dl className="grid min-w-0 grid-cols-2 gap-2 text-sm">
            {days.map((day, index) => {
              const override = pickOverride(ctx.overrides, index);
              return <div key={day}><dt>{t(`admin.templates.par_grid.day.${day}`)}</dt>
                <dd>{number(override?.parMode === "manual" ? override.parValue : ctx.recommendedPar)} {ctx.recommendedParUnit}</dd></div>;
            })}
          </dl>
          {canEdit && ctx.itemId && view.templateId && <ParGrid key={JSON.stringify(ctx)} templateId={view.templateId} lineId={item.id} locationId={view.locationId} parCtx={ctx} />}
        </CollapsibleSection>
      </div>;
    })}
  </div>;
}
