"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { ChecklistTemplateItem, PrepSection } from "@/lib/types";
import { PREP_SECTIONS } from "@/lib/prep-sections";
import { PrepItemEditPanel } from "./PrepItemEditPanel";
import { AddPrepItemForm } from "./AddPrepItemForm";
import type { PrepLineParContext } from "@/lib/admin/templates";

export function PrepTemplateEditor({
  templateId,
  prepSubtype,
  items,
  actorLevel,
  locationId,
  parContext,
}: {
  templateId: string;
  prepSubtype: "am_prep" | "mid_day_prep";
  items: ChecklistTemplateItem[];
  actorLevel: number;
  locationId: string;
  parContext: Record<string, PrepLineParContext>;
}) {
  const { t } = useTranslation();
  const [addingIn, setAddingIn] = useState<PrepSection | null>(null);

  const groups = new Map<string, ChecklistTemplateItem[]>();
  for (const it of items) {
    const key = it.station ?? "—";
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  const sectionKeys: string[] = [...PREP_SECTIONS];
  for (const k of groups.keys()) if (!sectionKeys.includes(k)) sectionKeys.push(k);

  return (
    <div className="mt-5 flex flex-col gap-6">
      {sectionKeys.map((section) => {
        const sectionItems = groups.get(section) ?? [];
        const isStandard = (PREP_SECTIONS as readonly string[]).includes(section);
        return (
          <section key={section}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
                {t("admin.templates.section_label")}: {section}
              </h2>
              {isStandard ? (
                <button type="button" onClick={() => setAddingIn(section as PrepSection)}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">
                  {t("admin.templates.add_item")}
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {addingIn === section ? (
                <AddPrepItemForm templateId={templateId} prepSubtype={prepSubtype} defaultSection={section as PrepSection} onClose={() => setAddingIn(null)} />
              ) : null}
              {sectionItems.map((it) => (
                <PrepItemEditPanel
                  key={it.id}
                  templateId={templateId}
                  item={it}
                  actorLevel={actorLevel}
                  locationId={locationId}
                  parCtx={parContext[it.id] ?? { itemId: null, itemGlobal: false, recommendedPar: null, recommendedParUnit: null, overrides: [] }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
