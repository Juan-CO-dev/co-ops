"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { ChecklistTemplateItem, PrepSection } from "@/lib/types";
import { PREP_SECTIONS } from "@/lib/prep-sections";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

export function PrepItemEditPanel({ templateId, item }: { templateId: string; item: ChecklistTemplateItem }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const es = item.translations?.es ?? {};
  const [labelEn, setLabelEn] = useState(item.label);
  const [labelEs, setLabelEs] = useState(es.label ?? "");
  const [parValue, setParValue] = useState(item.prepMeta?.parValue?.toString() ?? "");
  const [parUnit, setParUnit] = useState(item.prepMeta?.parUnit ?? "");
  const [siEn, setSiEn] = useState(item.prepMeta?.specialInstruction ?? "");
  const [siEs, setSiEs] = useState(es.specialInstruction ?? "");
  const [required, setRequired] = useState(item.required);
  const [minRole, setMinRole] = useState(item.minRoleLevel.toString());
  const [section, setSection] = useState(item.station ?? "");

  const base = `/api/admin/checklist-templates/${templateId}/items/${item.id}`;

  const saveContent = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(base, {
      label: labelEn.trim(),
      labelEs: labelEs.trim() || null,
      parValue: parValue.trim() === "" ? null : Number(parValue),
      parUnit: parUnit.trim() || null,
      specialInstruction: siEn.trim() || null,
      specialInstructionEs: siEs.trim() || null,
      required,
    }, "PATCH");
    setSubmitting(false);
    if (result.ok) { setOpen(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveMinRole = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`${base}/min-role`, { minRoleLevel: Number(minRole) }, "PATCH");
    setSubmitting(false);
    if (result.ok) { router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveSection = async () => {
    if (submitting || !section || section === item.station) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`${base}/section`, { section }, "PATCH");
    setSubmitting(false);
    if (result.ok) { router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const removeItem = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!window.confirm(t("admin.templates.remove_confirm"))) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(base, {}, "DELETE");
    setSubmitting(false);
    if (result.ok) { router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-co-text">
          {item.label}
          {item.prepMeta?.parValue != null ? (
            <span className="ml-2 text-co-text-muted">
              {t("admin.templates.field.par_value")}: {item.prepMeta.parValue}{item.prepMeta.parUnit ? ` ${item.prepMeta.parUnit}` : ""}
            </span>
          ) : null}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">
          {t("admin.templates.edit")}
        </button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <Labeled label={t("admin.templates.field.par_value")}><input className={field} inputMode="decimal" value={parValue} onChange={(e) => setParValue(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.par_unit")}><input className={field} value={parUnit} onChange={(e) => setParUnit(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.special_instruction")}><textarea className={field} value={siEn} onChange={(e) => setSiEn(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.special_instruction_es")}><textarea className={field} value={siEs} onChange={(e) => setSiEs(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.label_en")}><input className={field} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} /></Labeled>
          <Labeled label={t("admin.templates.field.label_es")}><input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} /></Labeled>
          <p className="text-xs text-co-text-muted">{t("admin.templates.item_scope_note")}</p>
          <label className="flex items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            {t("admin.templates.field.required")}
          </label>

          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" disabled={submitting} onClick={() => setOpen(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">
              {t("admin.templates.cancel")}
            </button>
            <button type="button" disabled={submitting} onClick={() => void saveContent()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
              {t("admin.templates.save")}
            </button>
          </div>

          <div className="mt-2 border-t-2 border-co-border pt-3">
            <p className="text-xs text-co-text-muted">{t("admin.templates.min_role.hint")}</p>
            <div className="mt-2 flex items-end gap-2">
              <Labeled label={t("admin.templates.field.min_role_level")}>
                <input className={field} inputMode="numeric" value={minRole} onChange={(e) => setMinRole(e.target.value)} />
              </Labeled>
              <button type="button" disabled={submitting} onClick={() => void saveMinRole()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50">
                {t("admin.templates.min_role.change")}
              </button>
            </div>
          </div>

          <div className="mt-2 border-t-2 border-co-border pt-3">
            <Labeled label={t("admin.templates.field.section")}>
              <div className="flex items-end gap-2">
                <select className={field} value={section} onChange={(e) => setSection(e.target.value)}>
                  {PREP_SECTIONS.map((s) => (
                    <option key={s} value={s}>{t(`admin.templates.section.${s}` as TranslationKey)}</option>
                  ))}
                </select>
                <button type="button" disabled={submitting} onClick={() => void saveSection()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50">
                  {t("admin.templates.change_section")}
                </button>
              </div>
            </Labeled>
          </div>

          <div className="mt-2 border-t-2 border-co-border pt-3">
            <button type="button" disabled={submitting} onClick={() => void removeItem()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-surface px-3 text-xs font-bold text-co-cta hover:bg-co-cta hover:text-co-surface disabled:opacity-50">
              {t("admin.templates.remove")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}
