"use client";

/**
 * ItemRow — one global item on /admin/items: header (name, par, Default badge,
 * readiness badge, producing-recipe link) + the MoO+ (≥8) edit panel
 * (definition / sold-directly / default toggle / opening-verify / questions).
 * Lifted from the checklist admin's GlobalRegistryTab RegistryRow (Items
 * Central Page, 2026-07-07). All API routes unchanged. The recipe link is now
 * PER-ITEM (the pipeline made navigable: item → its producing recipe).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { orderedSectionSlugs, sectionLabelByLang, isPrepSectionName } from "@/lib/prep-sections";
import { roleLevelOptions } from "@/lib/roles";
import type { PrepSection, PrepSectionDefn } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ChecklistRegistryItem, ItemQuestionView } from "@/lib/admin/templates";
import type { Readiness } from "@/lib/readiness";
import { StatusBadge, ReadinessReasons } from "@/components/admin/StatusBadge";
import { postJson, resolveErrorKey } from "@/components/admin/templates/shared";
import { UnitSelect } from "@/components/admin/UnitSelect";
import { ItemQuestionsEditor } from "./ItemQuestions";
import { Labeled } from "./Labeled";

export function ItemRow({
  item,
  actorLevel,
  sections,
  units,
  language,
  itemQuestions,
  readiness,
  producingRecipeId,
}: {
  item: ChecklistRegistryItem;
  actorLevel: number;
  sections: PrepSectionDefn[];
  units: Array<{ label: string }>;
  language: string;
  itemQuestions: ItemQuestionView[];
  readiness: Readiness | null;
  producingRecipeId: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canEdit = actorLevel >= 8; // MoO+ — item-definition editor

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [name, setName] = useState(item.name);
  const [nameEs, setNameEs] = useState(item.nameEs ?? "");
  const [par, setPar] = useState(item.recommendedPar?.toString() ?? "");
  const [parUnit, setParUnit] = useState(item.recommendedParUnit ?? "");
  const [specialInstruction, setSpecialInstruction] = useState(item.specialInstruction ?? "");
  const [specialInstructionEs, setSpecialInstructionEs] = useState(item.specialInstructionEs ?? "");
  const [required, setRequired] = useState(item.required);
  const [minRole, setMinRole] = useState(item.minRoleLevel?.toString() ?? "");
  const [trackingType, setTrackingType] = useState(item.trackingType);
  const [batchYield, setBatchYield] = useState(item.batchYield.toString());
  const [ozPerParUnit, setOzPerParUnit] = useState(item.ozPerParUnit != null ? String(item.ozPerParUnit) : "");

  // Sold-directly subsection state
  const [soldDirectly, setSoldDirectly] = useState(item.soldDirectly);
  const [sellPortion, setSellPortion] = useState(item.sellPortion != null ? String(item.sellPortion) : "");
  const [sellPortionUnit, setSellPortionUnit] = useState(item.sellPortionUnit ?? "");
  const [menuPrice, setMenuPrice] = useState(item.menuPrice != null ? String(item.menuPrice) : "");
  const [savingSoldDirect, setSavingSoldDirect] = useState(false);
  const [soldDirectError, setSoldDirectError] = useState<string | null>(null);
  const slugs = orderedSectionSlugs(sections);
  const activeSlugs = new Set(slugs);
  const initialSection: PrepSection = isPrepSectionName(item.section, activeSlugs)
    ? item.section
    : (slugs[0] ?? "");
  const [section, setSection] = useState<PrepSection>(initialSection);

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
  const smallBtn =
    "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50";

  const saveSoldDirect = async () => {
    if (savingSoldDirect) return;
    setSoldDirectError(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSavingSoldDirect(true);
    const result = await postJson(
      `/api/admin/items/${item.itemId}/sold-directly`,
      {
        soldDirectly,
        sellPortion: sellPortion.trim() === "" ? null : Number(sellPortion),
        sellPortionUnit: sellPortionUnit || null,
        menuPrice: menuPrice.trim() === "" ? null : Number(menuPrice),
      },
      "PATCH",
    );
    setSavingSoldDirect(false);
    if (result.ok) router.refresh();
    else setSoldDirectError(t(resolveErrorKey(result.code)));
  };

  const toggleDefault = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/registry/${item.itemId}/default`,
      { isDefault: !item.isDefault },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const toggleOpeningVerify = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/registry/${item.itemId}/opening-verify`,
      { openingVerify: !item.openingVerify },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveDefinition = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!name.trim()) { setErrorMsg(t(resolveErrorKey("invalid_label"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/registry/${item.itemId}`,
      {
        name: name.trim(),
        nameEs: nameEs.trim() || null,
        recommendedPar: par.trim() === "" ? null : Number(par),
        recommendedParUnit: parUnit.trim() || null,
        specialInstruction: specialInstruction.trim() || null,
        specialInstructionEs: specialInstructionEs.trim() || null,
        required,
        ...(minRole.trim() === "" ? {} : { minRoleLevel: Number(minRole) }),
        section,
        trackingType,
        ...(batchYield.trim() === "" ? {} : { batchYield: Number(batchYield) }),
        ozPerParUnit: ozPerParUnit.trim() === "" ? null : Number(ozPerParUnit),
      },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) { setOpen(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="co-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-co-text">
          {item.name}
          {item.recommendedPar != null ? (
            <span className="ml-2 text-co-text-muted">
              {t("admin.templates.field.par_value")}: {item.recommendedPar}
              {item.recommendedParUnit ? ` ${item.recommendedParUnit}` : ""}
            </span>
          ) : null}
          {item.isDefault ? (
            <span className="ml-2 rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-co-gold-text">
              {t("admin.templates.default_badge")}
            </span>
          ) : null}
          {readiness ? (
            <span className="ml-2">
              <StatusBadge status={readiness.status as "incomplete" | "upstream_gaps"} />
            </span>
          ) : null}
        </span>
        <div className="flex gap-2">
          {producingRecipeId ? (
            <Link href={`/admin/recipes/${producingRecipeId}`} className={smallBtn}>
              {t("recipes.item_link.production_recipe" as TranslationKey)}
            </Link>
          ) : null}
          {canEdit ? (
            <button type="button" onClick={() => setOpen((v) => !v)} className={smallBtn}>
              {t("admin.templates.edit")}
            </button>
          ) : null}
        </div>
      </div>

      {open && canEdit ? (
        <div className="mt-3 flex flex-col gap-3">
          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
          {readiness ? <ReadinessReasons reasons={readiness.reasons} /> : null}

          <section className="rounded-lg border-2 border-co-border p-3">
            <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
              {t("admin.templates.definition.title")}
            </h3>
            <Labeled label={t("admin.templates.field.label_en")}>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
            </Labeled>
            <Labeled label={t("admin.templates.field.label_es")}>
              <input className={field} value={nameEs} onChange={(e) => setNameEs(e.target.value)} />
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
            <label className="mt-2 flex items-center gap-2 text-sm font-bold text-co-text">
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
            <p className="mt-1 text-xs text-co-text-muted">{t("admin.templates.min_role.hint")}</p>
            <Labeled label={t("admin.templates.field.tracking_type")}>
              <select className={field} value={trackingType} onChange={(e) => setTrackingType(e.target.value as typeof trackingType)}>
                <option value="on_hand">{t("admin.templates.tracking_type.on_hand")}</option>
                <option value="portioned">{t("admin.templates.tracking_type.portioned")}</option>
                <option value="line">{t("admin.templates.tracking_type.line")}</option>
              </select>
            </Labeled>
            <Labeled label={t("admin.templates.field.batch_yield")}>
              <input className={field} type="number" min={0} step="any" inputMode="decimal" value={batchYield} onChange={(e) => setBatchYield(e.target.value)} />
              <span className="mt-1 block text-xs text-co-text-muted">{t("admin.templates.batch_yield_hint")}</span>
            </Labeled>
            <Labeled label={t("admin.templates.field.oz_per_par_unit")}>
              <input className={field} type="number" min={0} step="any" inputMode="decimal" value={ozPerParUnit} onChange={(e) => setOzPerParUnit(e.target.value)} />
              <span className="mt-1 block text-xs text-co-text-muted">{t("admin.templates.oz_per_par_unit_hint")}</span>
            </Labeled>
            <p className="mt-2 text-xs text-co-text-muted">{t("admin.templates.definition.blast_radius_note")}</p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void saveDefinition()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
              >
                {t("admin.templates.save")}
              </button>
            </div>
          </section>

          <section className="rounded-lg border-2 border-co-border p-3">
            <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
              {t("admin.templates.sold_directly.title" as TranslationKey)}
            </h3>
            <label className="mt-2 flex items-center gap-2 text-sm font-bold text-co-text">
              <input
                type="checkbox"
                className="h-5 w-5 accent-co-gold"
                checked={soldDirectly}
                onChange={(e) => setSoldDirectly(e.target.checked)}
              />
              {t("admin.templates.sold_directly.checkbox" as TranslationKey)}
            </label>
            {soldDirectly ? (
              <div className="mt-3 flex flex-col gap-3">
                <Labeled label={t("admin.templates.sold_directly.sell_portion" as TranslationKey)}>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={sellPortion}
                    onChange={(e) => setSellPortion(e.target.value)}
                  />
                </Labeled>
                <UnitSelect
                  label={t("admin.templates.sold_directly.sell_portion_unit" as TranslationKey)}
                  value={sellPortionUnit}
                  onChange={setSellPortionUnit}
                  units={units}
                  actorLevel={actorLevel}
                />
                <Labeled label={t("admin.templates.sold_directly.menu_price" as TranslationKey)}>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={menuPrice}
                    onChange={(e) => setMenuPrice(e.target.value)}
                  />
                </Labeled>
              </div>
            ) : (
              <div className="mt-3">
                <Labeled label={t("admin.templates.sold_directly.menu_price" as TranslationKey)}>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={menuPrice}
                    onChange={(e) => setMenuPrice(e.target.value)}
                  />
                </Labeled>
              </div>
            )}
            {soldDirectError ? <p className="mt-2 text-sm text-co-cta">{soldDirectError}</p> : null}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={savingSoldDirect}
                onClick={() => void saveSoldDirect()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
              >
                {t("admin.templates.save")}
              </button>
            </div>
          </section>

          <div className="rounded-lg border-2 border-co-border p-3">
            <p className="text-xs text-co-text-muted">{t("admin.templates.default_toggle_hint")}</p>
            <div className="mt-2">
              <button type="button" disabled={submitting} onClick={() => void toggleDefault()} className={smallBtn}>
                {item.isDefault ? t("admin.templates.default_remove") : t("admin.templates.default_add")}
              </button>
            </div>
          </div>

          <div className="rounded-lg border-2 border-co-border p-3">
            <p className="text-xs text-co-text-muted">{t("admin.templates.opening_verify_hint")}</p>
            <div className="mt-2 flex items-center gap-2">
              {item.openingVerify ? (
                <span className="rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-co-gold-text">
                  {t("admin.templates.opening_verify_on")}
                </span>
              ) : null}
              <button type="button" disabled={submitting} onClick={() => void toggleOpeningVerify()} className={smallBtn}>
                {item.openingVerify ? t("admin.templates.opening_verify_remove") : t("admin.templates.opening_verify_add")}
              </button>
            </div>
          </div>

          <ItemQuestionsEditor itemId={item.itemId} itemQuestions={itemQuestions} />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text"
            >
              {t("admin.templates.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
