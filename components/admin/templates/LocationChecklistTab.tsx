"use client";

/**
 * LocationChecklistTab (Item/Inventory Spine 2B′) — the per-location checklist
 * for one location + subtype. Shows the items this location runs, each with the
 * ParGrid (AGM+, Tier A) + a disable button (AGM+, Tier B). Below the list: an
 * enable-from-registry picker (global items this location doesn't run yet) and
 * an add-local-item affordance (AddPrepItemForm). Item NAMES are read-only with
 * an "edit in Global" hint — name/recommended-par edits happen on the Global tab.
 *
 * Gating: everything here is AGM+ (the page gate is ≥6, so reaching this tab
 * implies AGM+). Disable + add-local + enable are all AGM+; the server routes
 * re-gate + step-up. The ONE exception is the per-line input-type conversion,
 * whose route requires ≥7 (MoO-adjacent structural edit) — the control is hidden
 * below 7 so L6 admins don't hit a naked 403 on a button they can see.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { isQuestionShapedLine } from "@/lib/items";
import { orderedSectionSlugs, sectionLabelByLang, shapeFromColumns } from "@/lib/prep-sections";
import type { ChecklistTemplateItem, LineInputType, PrepSection, PrepSectionDefn } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ChecklistLocationView, ChecklistRegistryItem, PrepSubtype } from "@/lib/admin/templates";
import { ParGrid } from "./ParGrid";
import { AddPrepItemForm } from "./AddPrepItemForm";
import { postJson, resolveErrorKey } from "./shared";

/** The five per-line input types offered by the input-type toggle. */
const LINE_INPUT_TYPE_OPTIONS: Array<{ value: LineInputType; key: TranslationKey }> = [
  { value: "on_hand", key: "admin.templates.section_shape.on_hand" },
  { value: "portioned", key: "admin.templates.section_shape.portioned" },
  { value: "line", key: "admin.templates.section_shape.line" },
  { value: "yes_no", key: "admin.templates.section_shape.yes_no" },
  { value: "free_text", key: "admin.templates.section_shape.free_text" },
];

export function LocationChecklistTab({
  view,
  subtype,
  registry,
  sections,
  units,
  actorLevel,
}: {
  view: ChecklistLocationView;
  subtype: PrepSubtype;
  registry: ChecklistRegistryItem[];
  sections: PrepSectionDefn[];
  units: Array<{ label: string }>;
  actorLevel: number;
}) {
  const { t, language } = useTranslation();

  // No active template for this subtype at this location.
  if (!view.templateId) {
    return (
      <div className="mt-4 rounded-xl border-2 border-co-border bg-co-surface p-4">
        <p className="text-sm text-co-text-muted">{t("admin.templates.no_template")}</p>
      </div>
    );
  }
  const templateId = view.templateId;

  // Group items by section, standard sections first.
  const groups = new Map<string, ChecklistTemplateItem[]>();
  for (const it of view.items) {
    const key = it.station ?? "—";
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  const sectionKeys: string[] = orderedSectionSlugs(sections);
  for (const k of groups.keys()) if (!sectionKeys.includes(k)) sectionKeys.push(k);

  // Registry items this location doesn't run yet (enable-from-registry pool).
  const enabledSet = new Set(view.enabledItemIds);
  const enableable = registry.filter((r) => !enabledSet.has(r.itemId));

  return (
    <div className="mt-4 flex flex-col gap-6">
      <p className="rounded-lg border-2 border-co-border bg-co-bg/40 px-3 py-2 text-xs text-co-text-muted">
        {t("admin.templates.location_scope_note").replace("{location}", view.name)}
      </p>

      {sectionKeys.map((section) => {
        const sectionItems = groups.get(section) ?? [];
        if (sectionItems.length === 0) return null;
        return (
          <section key={section}>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">
              {t("admin.templates.section_label")}: {sectionLabelByLang(sections, section, language)}
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {sectionItems.map((it, idx) => (
                <LocationItemRow
                  key={it.id}
                  templateId={templateId}
                  item={it}
                  locationId={view.locationId}
                  actorLevel={actorLevel}
                  prevItem={idx > 0 ? sectionItems[idx - 1] ?? null : null}
                  nextItem={idx < sectionItems.length - 1 ? sectionItems[idx + 1] ?? null : null}
                  parCtx={
                    view.parContext[it.id] ?? {
                      itemId: null,
                      itemGlobal: false,
                      itemName: null,
                      itemNameEs: null,
                      recommendedPar: null,
                      recommendedParUnit: null,
                      overrides: [],
                    }
                  }
                />
              ))}
            </div>
          </section>
        );
      })}

      <EnableFromRegistry
        locationId={view.locationId}
        subtype={subtype}
        enableable={enableable}
        sections={sections}
      />

      <AddLocalItem templateId={templateId} subtype={subtype} sections={sections} units={units} />
    </div>
  );
}

function LocationItemRow({
  templateId,
  item,
  locationId,
  actorLevel,
  prevItem,
  nextItem,
  parCtx,
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  locationId: string;
  actorLevel: number;
  prevItem: ChecklistTemplateItem | null;
  nextItem: ChecklistTemplateItem | null;
  parCtx: Parameters<typeof ParGrid>[0]["parCtx"];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Per-line input-type conversion is a structural edit: the route requires ≥7
  // (app/api/admin/checklist-templates/[id]/items/[itemId]/input-type/route.ts).
  // Mirror it here so L6 admins aren't offered a control that 403s.
  const canConvertInputType = actorLevel >= 7; // MoO-adjacent, matches the route

  const isQuestion = isQuestionShapedLine(item);
  // A line whose label is edited on the LINE (question-shaped or unlinked) shows
  // editable en/es inputs; a linked inventory line's name is the GLOBAL
  // definition — read-only here with the "edit in Global" hint (write law).
  const labelEditsLine = isQuestion || !parCtx.itemId;

  // Content field state (prefilled from the line/registry/prep_meta).
  const [labelEn, setLabelEn] = useState(item.label);
  const [labelEs, setLabelEs] = useState(item.translations?.es?.label ?? "");
  const [descriptionEn, setDescriptionEn] = useState(item.description ?? "");
  const [descriptionEs, setDescriptionEs] = useState(item.translations?.es?.description ?? "");
  const [specialInstruction, setSpecialInstruction] = useState(item.prepMeta?.specialInstruction ?? "");
  const [specialInstructionEs, setSpecialInstructionEs] = useState(item.translations?.es?.specialInstruction ?? "");

  // Input-type state (current value derived from the line's columns).
  const currentInputType = shapeFromColumns(item.prepMeta?.columns ?? []);
  const [inputType, setInputType] = useState<LineInputType>(currentInputType);
  const [includeNote, setIncludeNote] = useState((item.prepMeta?.columns ?? []).includes("free_text"));

  // Display the resolved item NAME (global definition), not the stale line label —
  // EXCEPT question-shaped lines, whose label IS the question and must never be
  // replaced by the registry name (same law as resolveLineDefinition).
  const displayName = isQuestion ? item.label : (parCtx.itemName ?? item.label);
  const baseRow = parCtx.overrides.find((o) => o.dayOfWeek === null);
  const headerPar = baseRow && baseRow.parMode === "manual" ? baseRow.parValue : parCtx.recommendedPar;
  const headerParUnit = baseRow?.parUnit ?? parCtx.recommendedParUnit;

  const patchContent = async (body: Record<string, unknown>) => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/${templateId}/items/${item.id}`,
      body,
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveContent = () => {
    if (labelEditsLine && !labelEn.trim()) {
      setErrorMsg(t(resolveErrorKey("invalid_label")));
      return;
    }
    const body: Record<string, unknown> = {
      description: descriptionEn.trim() || null,
      descriptionEs: descriptionEs.trim() || null,
      specialInstruction: specialInstruction.trim() || null,
      specialInstructionEs: specialInstructionEs.trim() || null,
    };
    // Label only travels when it lands on the LINE — a linked inventory name is
    // edited on the Global tab (the route 403s a label edit for it anyway).
    if (labelEditsLine) {
      body.label = labelEn.trim();
      body.labelEs = labelEs.trim() || null;
    }
    void patchContent(body);
  };

  // Reorder: swap displayOrder with the adjacent line in the SAME section via two
  // sequential content PATCHes, then refresh. No new API — the existing
  // displayOrder field carries it.
  const reorder = async (neighbor: ChecklistTemplateItem | null) => {
    if (submitting || !neighbor) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    const first = await postJson(
      `/api/admin/checklist-templates/${templateId}/items/${item.id}`,
      { displayOrder: neighbor.displayOrder },
      "PATCH",
    );
    if (!first.ok) {
      setSubmitting(false);
      setErrorMsg(t(resolveErrorKey(first.code)));
      return;
    }
    const second = await postJson(
      `/api/admin/checklist-templates/${templateId}/items/${neighbor.id}`,
      { displayOrder: item.displayOrder },
      "PATCH",
    );
    setSubmitting(false);
    if (second.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(second.code)));
  };

  const changeInputType = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/${templateId}/items/${item.id}/input-type`,
      { inputType, includeNote: inputType === "yes_no" ? includeNote : undefined },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const unlink = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!window.confirm(t("admin.templates.unlink_confirm"))) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/${templateId}/items/${item.id}/unlink`,
      {},
      "POST",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const disableItem = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!window.confirm(t("admin.templates.remove_confirm"))) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/${templateId}/items/${item.id}`,
      {},
      "DELETE",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const smallBtn =
    "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50";
  const iconBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border-2 border-co-border bg-co-surface text-sm font-bold text-co-text hover:border-co-text disabled:opacity-40";
  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-co-text">
          {displayName}
          {headerPar != null && !isQuestion ? (
            <span className="ml-2 text-co-text-muted">
              {t("admin.templates.field.par_value")}: {headerPar}
              {headerParUnit ? ` ${headerParUnit}` : ""}
            </span>
          ) : null}
          {parCtx.itemGlobal ? (
            <span className="ml-2 rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-co-gold-text">
              {t("admin.templates.global_badge")}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={submitting || prevItem === null}
            onClick={() => void reorder(prevItem)}
            aria-label={t("admin.templates.line_reorder.move_up")}
            className={iconBtn}
          >
            ▲
          </button>
          <button
            type="button"
            disabled={submitting || nextItem === null}
            onClick={() => void reorder(nextItem)}
            aria-label={t("admin.templates.line_reorder.move_down")}
            className={iconBtn}
          >
            ▼
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)} className={smallBtn}>
            {t("admin.templates.edit")}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}

          {/* Label / question — editable on the line, or read-only w/ Global hint. */}
          {labelEditsLine ? (
            <>
              <label className="block">
                <span className="text-sm font-bold text-co-text">
                  {isQuestion ? t("admin.templates.line_edit.question_en") : t("admin.templates.field.label_en")}
                </span>
                <input className={field} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-co-text">
                  {isQuestion ? t("admin.templates.line_edit.question_es") : t("admin.templates.field.label_es")}
                </span>
                <input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
              </label>
            </>
          ) : (
            <p className="text-xs text-co-text-muted">{t("admin.templates.edit_in_global_hint")}</p>
          )}

          {/* Description (en + es) + special instruction (en + es) — line fields. */}
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.templates.field.description_en")}</span>
            <input className={field} value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.templates.field.description_es")}</span>
            <input className={field} value={descriptionEs} onChange={(e) => setDescriptionEs(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.templates.field.special_instruction")}</span>
            <input className={field} value={specialInstruction} onChange={(e) => setSpecialInstruction(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.templates.field.special_instruction_es")}</span>
            <input className={field} value={specialInstructionEs} onChange={(e) => setSpecialInstructionEs(e.target.value)} />
          </label>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={saveContent}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
            >
              {t("admin.templates.save")}
            </button>
          </div>

          {/* Par grid — only inventory (non-question) lines carry par. */}
          {isQuestion ? null : (
            <ParGrid templateId={templateId} lineId={item.id} locationId={locationId} parCtx={parCtx} />
          )}

          {/* Input type — deliberate per-line conversion (Tier B, ≥7). */}
          {canConvertInputType ? (
            <div className="rounded-lg border-2 border-co-border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block flex-1">
                  <span className="text-sm font-bold text-co-text">{t("admin.templates.line_edit.input_type")}</span>
                  <select className={field} value={inputType} onChange={(e) => setInputType(e.target.value as LineInputType)}>
                    {LINE_INPUT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{t(o.key)}</option>
                    ))}
                  </select>
                </label>
                {inputType === "yes_no" ? (
                  <label className="flex items-center gap-2 text-sm font-bold text-co-text sm:pb-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-co-gold"
                      checked={includeNote}
                      onChange={(e) => setIncludeNote(e.target.checked)}
                    />
                    {t("admin.templates.field.include_note")}
                  </label>
                ) : null}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void changeInputType()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50 sm:w-auto"
                >
                  {t("admin.templates.line_edit.change_input_type")}
                </button>
              </div>
            </div>
          ) : null}

          {/* Unlink — only when linked to a registry item (Tier B, danger). */}
          {parCtx.itemId ? (
            <div className="rounded-lg border-2 border-co-border p-3">
              <p className="mb-2 text-xs text-co-text-muted">{t("admin.templates.line_edit.unlink_hint")}</p>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void unlink()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:bg-co-cta hover:text-co-text disabled:opacity-50"
              >
                {t("admin.templates.line_edit.unlink")}
              </button>
            </div>
          ) : null}

          <div className="rounded-lg border-2 border-co-border p-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void disableItem()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:bg-co-cta hover:text-co-text disabled:opacity-50"
            >
              {t("admin.templates.disable_item")}
            </button>
          </div>

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

function EnableFromRegistry({
  locationId,
  subtype,
  enableable,
  sections,
}: {
  locationId: string;
  subtype: PrepSubtype;
  enableable: ChecklistRegistryItem[];
  sections: PrepSectionDefn[];
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (enableable.length === 0) return null;

  const enable = async (itemId: string) => {
    if (busyId) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusyId(itemId);
    const result = await postJson(
      `/api/admin/checklist-templates/enable`,
      { locationId, subtype, itemId },
      "POST",
    );
    setBusyId(null);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <section className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">
          {t("admin.templates.enable_from_registry")}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
        >
          {open ? t("admin.templates.cancel") : t("admin.templates.enable_from_registry_open")}
        </button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}
          {enableable.map((r) => (
            <div
              key={r.itemId}
              className="flex items-center justify-between gap-2 rounded-lg border-2 border-co-border p-3"
            >
              <span className="text-sm font-bold text-co-text">
                {r.name}
                {r.recommendedPar != null ? (
                  <span className="ml-2 text-co-text-muted">
                    {t("admin.templates.field.par_value")}: {r.recommendedPar}
                    {r.recommendedParUnit ? ` ${r.recommendedParUnit}` : ""}
                  </span>
                ) : null}
                {r.section ? (
                  <span className="ml-2 text-xs text-co-text-muted">
                    {t("admin.templates.section_label")}: {r.section ? sectionLabelByLang(sections, r.section, language) : ""}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => void enable(r.itemId)}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
              >
                {t("admin.templates.enable")}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AddLocalItem({ templateId, subtype, sections, units }: { templateId: string; subtype: PrepSubtype; sections: PrepSectionDefn[]; units: Array<{ label: string }> }) {
  const { t, language } = useTranslation();
  const [section, setSection] = useState<PrepSection | null>(null);

  return (
    <section className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">
          {t("admin.templates.add_local_item")}
        </h2>
        {section === null ? (
          <select
            className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-bold text-co-text"
            value=""
            onChange={(e) => {
              if (e.target.value) setSection(e.target.value as PrepSection);
            }}
          >
            <option value="">{t("admin.templates.add_item")}</option>
            {orderedSectionSlugs(sections).map((s) => (
              <option key={s} value={s}>
                {sectionLabelByLang(sections, s, language)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {section !== null ? (
        <div className="mt-3">
          <AddPrepItemForm
            templateId={templateId}
            prepSubtype={subtype}
            defaultSection={section}
            sections={sections}
            units={units}
            onClose={() => setSection(null)}
          />
        </div>
      ) : null}
    </section>
  );
}
