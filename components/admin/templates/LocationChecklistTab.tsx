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
 * re-gate + step-up.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { PREP_SECTIONS, sectionLabelByLang } from "@/lib/prep-sections";
import type { ChecklistTemplateItem, PrepSection, PrepSectionDefn } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ChecklistLocationView, ChecklistRegistryItem, PrepSubtype } from "@/lib/admin/templates";
import { ParGrid } from "./ParGrid";
import { AddPrepItemForm } from "./AddPrepItemForm";
import { postJson, resolveErrorKey } from "./shared";

export function LocationChecklistTab({
  view,
  subtype,
  registry,
  sections,
}: {
  view: ChecklistLocationView;
  subtype: PrepSubtype;
  registry: ChecklistRegistryItem[];
  sections: PrepSectionDefn[];
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
  const sectionKeys: string[] = [...PREP_SECTIONS];
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
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
              {t("admin.templates.section_label")}: {sectionLabelByLang(sections, section, language)}
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {sectionItems.map((it) => (
                <LocationItemRow
                  key={it.id}
                  templateId={templateId}
                  item={it}
                  locationId={view.locationId}
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

      <AddLocalItem templateId={templateId} subtype={subtype} sections={sections} />
    </div>
  );
}

function LocationItemRow({
  templateId,
  item,
  locationId,
  parCtx,
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  locationId: string;
  parCtx: Parameters<typeof ParGrid>[0]["parCtx"];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Display the resolved item NAME (global definition), not the stale line label.
  const displayName = parCtx.itemName ?? item.label;
  const baseRow = parCtx.overrides.find((o) => o.dayOfWeek === null);
  const headerPar = baseRow && baseRow.parMode === "manual" ? baseRow.parValue : parCtx.recommendedPar;
  const headerParUnit = baseRow?.parUnit ?? parCtx.recommendedParUnit;

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

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-co-text">
          {displayName}
          {headerPar != null ? (
            <span className="ml-2 text-co-text-muted">
              {t("admin.templates.field.par_value")}: {headerPar}
              {headerParUnit ? ` ${headerParUnit}` : ""}
            </span>
          ) : null}
          {parCtx.itemGlobal ? (
            <span className="ml-2 rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-co-gold-deep">
              {t("admin.templates.global_badge")}
            </span>
          ) : null}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className={smallBtn}>
          {t("admin.templates.edit")}
        </button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
          <p className="text-xs text-co-text-muted">{t("admin.templates.edit_in_global_hint")}</p>

          <ParGrid templateId={templateId} lineId={item.id} locationId={locationId} parCtx={parCtx} />

          <div className="rounded-lg border-2 border-co-border p-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void disableItem()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-surface px-3 text-xs font-bold text-co-cta hover:bg-co-cta hover:text-co-surface disabled:opacity-50"
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
        <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
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
          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
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

function AddLocalItem({ templateId, subtype, sections }: { templateId: string; subtype: PrepSubtype; sections: PrepSectionDefn[] }) {
  const { t, language } = useTranslation();
  const [section, setSection] = useState<PrepSection | null>(null);

  return (
    <section className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
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
            {PREP_SECTIONS.map((s) => (
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
            onClose={() => setSection(null)}
          />
        </div>
      ) : null}
    </section>
  );
}
