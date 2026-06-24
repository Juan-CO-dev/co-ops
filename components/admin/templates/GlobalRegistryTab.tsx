"use client";

/**
 * GlobalRegistryTab (Item/Inventory Spine 2B′) — the company-wide registry pool.
 * Items grouped by section; each row shows name + recommended par + a default
 * badge/toggle. Editing here applies to every location (blast-radius banner).
 *
 * Gating (by actorLevel):
 *   - read-only rows: any reader who reached the page (≥6)
 *   - default toggle + edit definition (name EN/ES + recommended par/unit): MoO+ (≥8), Tier B
 *   - add new global item: GM+ (≥7), Tier B
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { PREP_SECTIONS, sectionLabelByLang } from "@/lib/prep-sections";
import type { PrepSection } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ChecklistRegistryItem } from "@/lib/admin/templates";
import type { PrepSectionDefn } from "@/lib/types";
import { postJson, resolveErrorKey } from "./shared";

export function GlobalRegistryTab({
  registry,
  sections,
  actorLevel,
}: {
  registry: ChecklistRegistryItem[];
  sections: PrepSectionDefn[];
  actorLevel: number;
}) {
  const { t, language } = useTranslation();
  const canAdd = actorLevel >= 7;
  const canEditSections = actorLevel >= 8; // MoO+

  // Group by section, standard sections first; null section → "—" bucket.
  const groups = new Map<string, ChecklistRegistryItem[]>();
  for (const r of registry) {
    const key = r.section ?? "—";
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const sectionKeys: string[] = [...PREP_SECTIONS];
  for (const k of groups.keys()) if (!sectionKeys.includes(k)) sectionKeys.push(k);

  return (
    <div className="mt-4 flex flex-col gap-6">
      <p className="rounded-lg border-2 border-co-gold-deep bg-co-gold/15 px-3 py-2 text-xs font-bold text-co-text">
        {t("admin.templates.global_blast_radius_note")}
      </p>

      {canEditSections && sections.length > 0 ? (
        <section className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
            {t("admin.templates.sections_panel.title")}
          </h2>
          <p className="mt-1 text-xs text-co-text-muted">
            {t("admin.templates.sections_panel.note")}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {sections.map((s) => (
              <SectionRow key={s.slug} section={s} />
            ))}
          </div>
        </section>
      ) : null}

      {canAdd ? <AddGlobalItem sections={sections} /> : null}

      {sectionKeys.map((section) => {
        const items = groups.get(section) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={section}>
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
              {t("admin.templates.section_label")}: {sectionLabelByLang(sections, section, language)}
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {items.map((r) => (
                <RegistryRow key={r.itemId} item={r} actorLevel={actorLevel} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SectionRow({ section }: { section: PrepSectionDefn }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [labelEn, setLabelEn] = useState(section.labelEn);
  const [labelEs, setLabelEs] = useState(section.labelEs ?? "");
  const [displayOrder, setDisplayOrder] = useState(section.displayOrder.toString());

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const save = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!labelEn.trim()) { setErrorMsg(t(resolveErrorKey("invalid_label"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/sections/${section.slug}`,
      {
        labelEn: labelEn.trim(),
        labelEs: labelEs.trim() || null,
        displayOrder: displayOrder.trim() === "" ? undefined : Number(displayOrder),
      },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <p className="text-xs text-co-text-muted">
        {t("admin.templates.sections_panel.slug_hint")}: <span className="font-mono">{section.slug}</span>
      </p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_en")}</span>
          <input className={field} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
        </label>
        <label className="block flex-1">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_es")}</span>
          <input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
        </label>
        <label className="block sm:w-24">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.display_order")}</span>
          <input
            className={field}
            inputMode="numeric"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </label>
      </div>
      {errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void save()}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
        >
          {t("admin.templates.save")}
        </button>
      </div>
    </div>
  );
}

function RegistryRow({ item, actorLevel }: { item: ChecklistRegistryItem; actorLevel: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canEdit = actorLevel >= 8; // MoO+

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [name, setName] = useState(item.name);
  const [nameEs, setNameEs] = useState(item.nameEs ?? "");
  const [par, setPar] = useState(item.recommendedPar?.toString() ?? "");
  const [parUnit, setParUnit] = useState(item.recommendedParUnit ?? "");

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
  const smallBtn =
    "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50";

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
      },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) { setOpen(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
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
            <span className="ml-2 rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-co-gold-deep">
              {t("admin.templates.default_badge")}
            </span>
          ) : null}
        </span>
        {canEdit ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className={smallBtn}>
            {t("admin.templates.edit")}
          </button>
        ) : null}
      </div>

      {open && canEdit ? (
        <div className="mt-3 flex flex-col gap-3">
          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}

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
            <Labeled label={t("admin.templates.field.par_unit")}>
              <input className={field} value={parUnit} onChange={(e) => setParUnit(e.target.value)} />
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

          <div className="rounded-lg border-2 border-co-border p-3">
            <p className="text-xs text-co-text-muted">{t("admin.templates.default_toggle_hint")}</p>
            <div className="mt-2">
              <button type="button" disabled={submitting} onClick={() => void toggleDefault()} className={smallBtn}>
                {item.isDefault ? t("admin.templates.default_remove") : t("admin.templates.default_add")}
              </button>
            </div>
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

function AddGlobalItem({ sections }: { sections: PrepSectionDefn[] }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [section, setSection] = useState<PrepSection>(PREP_SECTIONS[0]!);
  const [par, setPar] = useState("");
  const [parUnit, setParUnit] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const reset = () => {
    setName("");
    setNameEs("");
    setSection(PREP_SECTIONS[0]!);
    setPar("");
    setParUnit("");
    setIsDefault(false);
    setErrorMsg(null);
  };

  const submit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!name.trim()) { setErrorMsg(t(resolveErrorKey("invalid_label"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/registry`,
      {
        name: name.trim(),
        nameEs: nameEs.trim() || null,
        section,
        recommendedPar: par.trim() === "" ? null : Number(par),
        recommendedParUnit: parUnit.trim() || null,
        isDefault,
      },
      "POST",
    );
    setSubmitting(false);
    if (result.ok) { reset(); setOpen(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center self-start rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
      >
        {t("admin.templates.add_global_item")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{t("admin.templates.add_global_item_title")}</h3>
      <div className="mt-3 flex flex-col gap-3">
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
            {PREP_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {sectionLabelByLang(sections, s, language)}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={t("admin.templates.definition.recommendation")}>
          <input className={field} inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.templates.field.par_unit")}>
          <input className={field} value={parUnit} onChange={(e) => setParUnit(e.target.value)} />
        </Labeled>
        <label className="flex items-center gap-2 text-sm text-co-text">
          <input
            type="checkbox"
            className="h-5 w-5 accent-co-gold"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {t("admin.templates.add_global_is_default")}
        </label>
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
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

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}
