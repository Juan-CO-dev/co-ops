"use client";

/**
 * AddItemForm — GM+ (≥7) "add global item" on /admin/items. Lifted verbatim
 * from the checklist admin's AddGlobalItem (Items Central Page, 2026-07-07).
 * POSTs to the existing registry route (which also propagates a default line
 * to every location's prep template when isDefault — behavior unchanged).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { orderedSectionSlugs, sectionLabelByLang } from "@/lib/prep-sections";
import { roleLevelOptions } from "@/lib/roles";
import type { PrepSection, PrepSectionDefn } from "@/lib/types";
import { postJson, resolveErrorKey } from "@/components/admin/templates/shared";
import { UnitSelect } from "@/components/admin/UnitSelect";
import { Labeled } from "./Labeled";

export function AddItemForm({
  sections,
  units,
  actorLevel,
  shops,
  initialScope,
}: {
  sections: PrepSectionDefn[];
  units: Array<{ label: string }>;
  actorLevel: number;
  shops: Array<{ id: string; name: string }>;
  initialScope: string | null;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const defaultScope = initialScope ?? (actorLevel >= 8 ? "global" : shops.length === 1 ? shops[0]!.id : "");
  const [scope, setScope] = useState(defaultScope);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const slugs = orderedSectionSlugs(sections);
  const [name, setName] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [section, setSection] = useState<PrepSection>(slugs[0] ?? "");
  const [par, setPar] = useState("");
  const [parUnit, setParUnit] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [specialInstruction, setSpecialInstruction] = useState("");
  const [specialInstructionEs, setSpecialInstructionEs] = useState("");
  const [required, setRequired] = useState(false);
  const [minRole, setMinRole] = useState("");

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const reset = () => {
    setScope(defaultScope);
    setName("");
    setNameEs("");
    setSection(slugs[0] ?? "");
    setPar("");
    setParUnit("");
    setIsDefault(false);
    setSpecialInstruction("");
    setSpecialInstructionEs("");
    setRequired(false);
    setMinRole("");
    setErrorMsg(null);
  };

  const submit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!scope) { setErrorMsg(t("admin.items.choose_shop")); return; }
    if (!name.trim()) { setErrorMsg(t(resolveErrorKey("invalid_label"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/registry`,
      {
        locationId: scope === "global" ? null : scope,
        name: name.trim(),
        nameEs: nameEs.trim() || null,
        section,
        recommendedPar: par.trim() === "" ? null : Number(par),
        recommendedParUnit: parUnit.trim() || null,
        isDefault: scope === "global" && isDefault,
        specialInstruction: specialInstruction.trim() || null,
        specialInstructionEs: specialInstructionEs.trim() || null,
        required,
        ...(minRole.trim() === "" ? {} : { minRoleLevel: Number(minRole) }),
      },
      "POST",
    );
    setSubmitting(false);
    if (result.ok) { reset(); setOpen(false); router.push(`/admin/items?view=registry&location=${encodeURIComponent(scope)}`); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center self-start rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
      >
        {t("admin.items.add_item")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{t("admin.items.add_item")}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <Labeled label={t("admin.items.scope")}>
          <select className={field} value={scope} onChange={e => { setScope(e.target.value); setIsDefault(false); }}>
            <option value="" disabled>{t("admin.items.choose_shop")}</option>
            {actorLevel >= 8 ? <option value="global">{t("readiness.scope.default")}</option> : null}
            {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
        </Labeled>
        <Labeled label={t("admin.templates.field.label_en")}>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.templates.field.label_es")}>
          <input className={field} value={nameEs} onChange={(e) => setNameEs(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.templates.field.section")}>
          <select
            className={field}
            value={section}
            onChange={(e) => setSection(e.target.value as PrepSection)}
          >
            {slugs.map((s) => (
              <option key={s} value={s}>
                {sectionLabelByLang(sections, s, language)}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={t("admin.templates.definition.recommendation")}>
          <input className={field} inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} />
        </Labeled>
        <UnitSelect
          label={t("admin.templates.field.par_unit")}
          value={parUnit}
          onChange={setParUnit}
          units={units}
          actorLevel={actorLevel}
        />
        <Labeled label={t("admin.templates.field.special_instruction")}>
          <textarea
            className={`${field} min-h-[88px] py-2`}
            value={specialInstruction}
            onChange={(e) => setSpecialInstruction(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("admin.templates.field.special_instruction_es")}>
          <textarea
            className={`${field} min-h-[88px] py-2`}
            value={specialInstructionEs}
            onChange={(e) => setSpecialInstructionEs(e.target.value)}
          />
        </Labeled>
        <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm font-bold text-co-text">
          <input
            type="checkbox"
            className="h-5 w-5 accent-co-gold"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          {t("admin.templates.field.required")}
        </label>
        <Labeled label={t("admin.templates.field.min_role_level")}>
          <select className={field} value={minRole} onChange={(e) => setMinRole(e.target.value)}>
            <option value="">—</option>
            {roleLevelOptions().map((o) => (
              <option key={o.level} value={o.level}>{o.label} ({o.level})</option>
            ))}
          </select>
        </Labeled>
        <p className="-mt-1 text-xs text-co-text-muted">{t("admin.templates.min_role.hint")}</p>
        {scope === "global" ? <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">
          <input
            type="checkbox"
            className="h-5 w-5 accent-co-gold"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {t("admin.templates.add_global_is_default")}
        </label> : null}
        <p className="text-xs text-co-text-muted">{t(scope === "global" ? "admin.templates.global_blast_radius_note" : "admin.items.shop_definition_note")}</p>
        {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => { reset(); setOpen(false); }}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
          >
            {t("admin.templates.cancel")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
          >
            {t("admin.templates.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
