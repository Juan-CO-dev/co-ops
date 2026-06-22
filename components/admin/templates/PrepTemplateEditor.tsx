"use client";

import { useTranslation } from "@/lib/i18n/provider";
import type { ChecklistTemplateItem } from "@/lib/types";
import { PrepItemEditPanel } from "./PrepItemEditPanel";

export function PrepTemplateEditor({ templateId, items }: { templateId: string; items: ChecklistTemplateItem[] }) {
  const { t } = useTranslation();
  const groups = new Map<string, ChecklistTemplateItem[]>();
  for (const it of items) {
    const key = it.station ?? "—";
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  return (
    <div className="mt-5 flex flex-col gap-6">
      {[...groups.entries()].map(([section, sectionItems]) => (
        <section key={section}>
          <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
            {t("admin.templates.section_label")}: {section}
          </h2>
          <div className="mt-2 flex flex-col gap-2">
            {sectionItems.map((it) => (
              <PrepItemEditPanel key={it.id} templateId={templateId} item={it} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
