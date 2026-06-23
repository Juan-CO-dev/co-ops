"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { PREP_SECTIONS } from "@/lib/prep-sections";
import type { PrepSection } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

export function AddPrepItemForm({
  templateId,
  prepSubtype,
  defaultSection,
  onClose,
}: {
  templateId: string;
  prepSubtype: "am_prep" | "mid_day_prep";
  defaultSection: PrepSection;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [section, setSection] = useState<PrepSection>(defaultSection);
  const [label, setLabel] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [parValue, setParValue] = useState("");
  const [parUnit, setParUnit] = useState("");
  const [includeNote, setIncludeNote] = useState(false);
  const [createMirror, setCreateMirror] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fieldCls = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const submit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!label.trim()) { setErrorMsg(t("admin.templates.error.invalid_label")); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`/api/admin/checklist-templates/${templateId}/items`, {
      section,
      label: label.trim(),
      labelEs: labelEs.trim() || null,
      parValue: parValue.trim() === "" ? null : Number(parValue),
      parUnit: parUnit.trim() || null,
      minRoleLevel: 3,
      required: true,
      includeNote,
      createOpeningMirror: createMirror,
    }, "POST");
    setSubmitting(false);
    if (result.ok) { onClose(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{t("admin.templates.add_item_title")}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.section")}</span>
          <select className={fieldCls} value={section} onChange={(e) => setSection(e.target.value as PrepSection)}>
            {PREP_SECTIONS.map((s) => (
              <option key={s} value={s}>{t(`admin.templates.section.${s}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_en")}</span><input className={fieldCls} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_es")}</span><input className={fieldCls} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.par_value")}</span><input className={fieldCls} inputMode="decimal" value={parValue} onChange={(e) => setParValue(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.par_unit")}</span><input className={fieldCls} value={parUnit} onChange={(e) => setParUnit(e.target.value)} /></label>
        {section === "Misc" ? (
          <label className="flex items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={includeNote} onChange={(e) => setIncludeNote(e.target.checked)} />
            {t("admin.templates.field.include_note")}
          </label>
        ) : null}
        {prepSubtype === "am_prep" ? (
          <label className="flex items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={createMirror} onChange={(e) => setCreateMirror(e.target.checked)} />
            {t("admin.templates.field.create_opening_mirror")}
          </label>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={submitting} onClick={onClose} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">{t("admin.templates.cancel")}</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("admin.templates.save")}</button>
        </div>
      </div>
    </div>
  );
}
