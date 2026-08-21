"use client";

/**
 * AddPrepItemForm — the add-a-local-prep-line form (prep structural editor).
 *
 * INPUT-TYPE PICKER (Phase-3 UX pair, Juan-approved 2026-08-19; report-A bug 4).
 * The form now names the shape the line will be born with instead of leaving it
 * implicit. It PRE-SELECTS the section's own shape, so the default create is
 * byte-for-byte today's payload; choosing anything else is a DIVERGENT create.
 *
 * THE AUTHORITY SPLIT: creating a line whose shape diverges from its section is
 * structurally the per-line CONVERT operation (≥7, MoO-adjacent) performed one
 * step earlier, so the divergent options are unselectable below 7 with a hint
 * saying why — mirroring the #254 gate on LocationChecklistTab's convert control.
 * Same-as-section stays the ≥6 door it has always been. The server re-decides in
 * addPrepItem against the same pure predicate (lib/prep-sections), so the offered
 * options and the accepted options cannot drift.
 */

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import {
  orderedSectionSlugs,
  sectionLabelByLang,
  isDivergentLineShape,
  canCreateLineWithShape,
  DIVERGENT_LINE_MIN_LEVEL,
} from "@/lib/prep-sections";
import type { LineInputType, PrepSection, PrepSectionDefn, PrepSectionShape } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

/** The five per-line input types, in the order the proposal names them. */
const INPUT_TYPE_OPTIONS: Array<{ value: LineInputType; key: TranslationKey }> = [
  { value: "on_hand", key: "admin.templates.prep.input_type.on_hand" },
  { value: "portioned", key: "admin.templates.prep.input_type.portioned" },
  { value: "line", key: "admin.templates.prep.input_type.line" },
  { value: "yes_no", key: "admin.templates.prep.input_type.yes_no" },
  { value: "free_text", key: "admin.templates.prep.input_type.free_text" },
];

/** The section's own shape — the picker's pre-selection and the ≥6 default. */
function shapeOf(sections: PrepSectionDefn[], slug: PrepSection): PrepSectionShape {
  return sections.find((s) => s.slug === slug)?.shape ?? "on_hand";
}

export function AddPrepItemForm({
  templateId,
  prepSubtype,
  defaultSection,
  sections,
  units,
  actorLevel,
  onClose,
}: {
  templateId: string;
  prepSubtype: "am_prep" | "mid_day_prep";
  defaultSection: PrepSection;
  sections: PrepSectionDefn[];
  units: Array<{ label: string }>;
  actorLevel: number;
  onClose: () => void;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const hintId = useId();

  const [section, setSection] = useState<PrepSection>(defaultSection);
  const [label, setLabel] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [parValue, setParValue] = useState("");
  const [parUnit, setParUnit] = useState("");
  const [includeNote, setIncludeNote] = useState(false);
  const [createMirror, setCreateMirror] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sectionShape = shapeOf(sections, section);
  const [inputType, setInputType] = useState<LineInputType>(sectionShape);

  // Moving the section re-homes the picker to the NEW section's shape. The picker
  // states what the line will be, and after a section move the honest default is
  // that section's own shape — silently carrying a divergent pick across the move
  // would smuggle the ≥7 choice onto a section the operator never inspected.
  const changeSection = (next: PrepSection) => {
    setSection(next);
    setInputType(shapeOf(sections, next));
  };

  const divergent = isDivergentLineShape(sectionShape, inputType);
  const mayDiverge = actorLevel >= DIVERGENT_LINE_MIN_LEVEL;

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
      // The note column only exists on a yes_no line (shapeToColumns ignores it
      // elsewhere) — don't send a stale tick from a shape the operator left.
      includeNote: inputType === "yes_no" ? includeNote : false,
      inputType,
      createOpeningMirror: createMirror,
    }, "POST");
    setSubmitting(false);
    if (result.ok) { onClose(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const fieldCls = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  return (
    <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{t("admin.templates.add_item_title")}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.section")}</span>
          <select className={fieldCls} value={section} onChange={(e) => changeSection(e.target.value as PrepSection)}>
            {orderedSectionSlugs(sections).map((s) => (
              <option key={s} value={s}>{sectionLabelByLang(sections, s, language)}</option>
            ))}
          </select>
        </label>

        {/* Input type — one field, pre-selected to the section's shape. Divergent
            options are unselectable below 7 (the convert authority) with the hint
            below saying so; the server re-checks the same predicate. */}
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.input_type")}</span>
          <select
            className={fieldCls}
            value={inputType}
            aria-describedby={hintId}
            onChange={(e) => setInputType(e.target.value as LineInputType)}
          >
            {INPUT_TYPE_OPTIONS.map((o) => (
              <option
                key={o.value}
                value={o.value}
                disabled={!canCreateLineWithShape(actorLevel, sectionShape, o.value)}
              >
                {t(o.key)}
              </option>
            ))}
          </select>
        </label>
        <p id={hintId} className="-mt-1 text-xs text-co-text-muted">
          {mayDiverge
            ? divergent
              ? t("admin.templates.field.input_type_divergent_hint")
              : t("admin.templates.field.input_type_hint")
            : t("admin.templates.field.input_type_locked_hint")}
        </p>

        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_en")}</span><input className={fieldCls} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.label_es")}</span><input className={fieldCls} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-bold text-co-text">{t("admin.templates.field.par_value")}</span><input className={fieldCls} inputMode="decimal" value={parValue} onChange={(e) => setParValue(e.target.value)} /></label>
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.field.par_unit")}</span>
          <select className={fieldCls} value={parUnit} onChange={(e) => setParUnit(e.target.value)}>
            <option value="">{t("admin.templates.unit_blank_option")}</option>
            {parUnit.trim() !== "" && !units.some((u) => u.label === parUnit) ? (
              <option value={parUnit}>{parUnit}</option>
            ) : null}
            {units.map((u) => (
              <option key={u.label} value={u.label}>{u.label}</option>
            ))}
          </select>
        </label>
        {/* The note column belongs to the yes_no SHAPE, not to a section slug.
            Misc's seeded shape IS yes_no (0086), so the old `section === "Misc"`
            condition is a subset of this one — same reach, honest predicate. */}
        {inputType === "yes_no" ? (
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={includeNote} onChange={(e) => setIncludeNote(e.target.checked)} />
            {t("admin.templates.field.include_note")}
          </label>
        ) : null}
        {prepSubtype === "am_prep" ? (
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">
            <input type="checkbox" className="h-5 w-5 accent-co-gold" checked={createMirror} onChange={(e) => setCreateMirror(e.target.checked)} />
            {t("admin.templates.field.create_opening_mirror")}
          </label>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={submitting} onClick={onClose} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">{t("admin.templates.cancel")}</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("admin.templates.save")}</button>
        </div>
      </div>
    </div>
  );
}
