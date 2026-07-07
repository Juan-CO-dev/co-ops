"use client";

/**
 * SectionsTab (Items Central Page, 2026-07-07) — the prep-report STRUCTURE
 * surface of the checklist-templates admin: first-class sections (rename /
 * reorder / disable / input-type) + non-inventory section questions. Item
 * DEFINITIONS moved to /admin/items; a pointer card at the top links there.
 *
 * Gating: sections + section-questions editing is MoO+ (actorLevel >= 8). Below
 * that, only the pointer card renders.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { orderedSectionSlugs, sectionLabelByLang } from "@/lib/prep-sections";
import { roleLevelOptions } from "@/lib/roles";
import type { PrepSectionShape, LineInputType } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import type { SectionQuestionView } from "@/lib/admin/templates";
import type { PrepSectionDefn } from "@/lib/types";
import { postJson, resolveErrorKey } from "./shared";

const INPUT_TYPE_OPTIONS: Array<{ value: LineInputType; key: TranslationKey }> = [
  { value: "on_hand", key: "admin.templates.section_shape.on_hand" },
  { value: "portioned", key: "admin.templates.section_shape.portioned" },
  { value: "line", key: "admin.templates.section_shape.line" },
  { value: "yes_no", key: "admin.templates.section_shape.yes_no" },
  { value: "free_text", key: "admin.templates.section_shape.free_text" },
];

export function SectionsTab({
  sections,
  sectionQuestions,
  actorLevel,
  registryNamesBySection,
}: {
  sections: PrepSectionDefn[];
  sectionQuestions: SectionQuestionView[];
  actorLevel: number;
  /** section slug → item names currently in it (for the disable-confirm blast list). */
  registryNamesBySection: Record<string, string[]>;
}) {
  const { t, language } = useTranslation();
  const canEditSections = actorLevel >= 8; // MoO+

  return (
    <div className="mt-4 flex flex-col gap-6">
      <p className="rounded-lg border-2 border-co-gold-deep bg-co-gold/15 px-3 py-2 text-xs font-bold text-co-text">
        {t("admin.templates.items_moved")}{" "}
        <Link href="/admin/items" className="underline decoration-2 underline-offset-2 hover:text-co-gold-deep">
          {t("admin.templates.items_moved_link")}
        </Link>
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
            {sections.map((s, i) => (
              <SectionRow
                key={s.slug}
                section={s}
                isFirst={i === 0}
                isLast={i === sections.length - 1}
                itemsInSection={registryNamesBySection[s.slug] ?? []}
              />
            ))}
          </div>
          <AddSectionForm />
        </section>
      ) : null}

      {canEditSections ? (
        <section className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
            {t("admin.templates.section_questions_panel.title")}
          </h2>
          <p className="mt-1 text-xs text-co-text-muted">
            {t("admin.templates.section_questions_panel.note")}
          </p>
          {sectionQuestions.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {sectionQuestions.map((q) => (
                <SectionQuestionRow
                  key={q.questionId}
                  question={q}
                  sections={sections}
                  language={language}
                />
              ))}
            </div>
          ) : null}
          <AddSectionQuestionForm sections={sections} />
        </section>
      ) : null}
    </div>
  );
}

function SectionRow({
  section,
  isFirst,
  isLast,
  itemsInSection,
}: {
  section: PrepSectionDefn;
  isFirst: boolean;
  isLast: boolean;
  itemsInSection: string[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [confirmingShape, setConfirmingShape] = useState(false);

  const [labelEn, setLabelEn] = useState(section.labelEn);
  const [labelEs, setLabelEs] = useState(section.labelEs ?? "");
  const [displayOrder, setDisplayOrder] = useState(section.displayOrder.toString());
  const [shape, setShape] = useState<PrepSectionShape>(section.shape);
  const [includeNote, setIncludeNote] = useState(section.columns.includes("free_text"));

  const isMisc = section.slug === "Misc";
  const shapeChanged = shape !== section.shape;

  const shapeOptions: Array<{ value: PrepSectionShape; key: TranslationKey }> = [
    { value: "on_hand", key: "admin.templates.section_shape.on_hand" },
    { value: "portioned", key: "admin.templates.section_shape.portioned" },
    { value: "line", key: "admin.templates.section_shape.line" },
    { value: "yes_no", key: "admin.templates.section_shape.yes_no" },
  ];

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
  const iconBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border-2 border-co-border bg-co-surface text-sm font-bold text-co-text hover:border-co-text disabled:opacity-50";

  const reorder = async (direction: "up" | "down") => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/sections/${section.slug}/reorder`,
      { direction },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const disable = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/sections/${section.slug}/disable`,
      {},
      "POST",
    );
    setSubmitting(false);
    if (result.ok) { setConfirmingDisable(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const applyShape = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/sections/${section.slug}/shape`,
      { shape, includeNote: shape === "yes_no" ? includeNote : undefined },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) { setConfirmingShape(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

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
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-co-text-muted">
          {t("admin.templates.sections_panel.slug_hint")}: <span className="font-mono">{section.slug}</span>
        </p>
        <div className="flex items-center gap-1">
          {!isFirst ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void reorder("up")}
              aria-label={t("admin.templates.sections_panel.move_up")}
              className={iconBtn}
            >
              ↑
            </button>
          ) : null}
          {!isLast ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void reorder("down")}
              aria-label={t("admin.templates.sections_panel.move_down")}
              className={iconBtn}
            >
              ↓
            </button>
          ) : null}
          {!isMisc ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirmingDisable((v) => !v)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta hover:border-co-cta disabled:opacity-50"
            >
              {t("admin.templates.sections_panel.disable")}
            </button>
          ) : null}
        </div>
      </div>

      {confirmingDisable && !isMisc ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">
            {t("admin.templates.sections_panel.disable_confirm_title")
              .replace("{section}", section.labelEn)
              .replace("{count}", itemsInSection.length.toString())}
          </p>
          {itemsInSection.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-co-text">
              {itemsInSection.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-co-text-muted">{t("admin.templates.sections_panel.disable_empty")}</p>
          )}
          <p className="mt-2 text-xs text-co-text-muted">{t("admin.templates.sections_panel.disable_warning")}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirmingDisable(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
            >
              {t("admin.templates.sections_panel.disable_cancel")}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void disable()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-surface disabled:opacity-50"
            >
              {t("admin.templates.sections_panel.disable_confirm")}
            </button>
          </div>
        </div>
      ) : null}

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

      {/* Input type (shape) — changing it re-derives the column set on every
          line in the section, so it's gated behind a confirm when changed. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="text-sm font-bold text-co-text">{t("admin.templates.sections_panel.input_type")}</span>
          <select
            className={field}
            value={shape}
            onChange={(e) => { setShape(e.target.value as PrepSectionShape); setConfirmingShape(false); }}
          >
            {shapeOptions.map((o) => (
              <option key={o.value} value={o.value}>{t(o.key)}</option>
            ))}
          </select>
        </label>
        {shape === "yes_no" ? (
          <label className="flex items-center gap-2 text-sm font-bold text-co-text sm:pb-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-co-gold"
              checked={includeNote}
              onChange={(e) => setIncludeNote(e.target.checked)}
            />
            {t("admin.templates.sections_panel.add_include_note")}
          </label>
        ) : null}
        {shapeChanged ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => setConfirmingShape((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50 sm:w-auto"
          >
            {t("admin.templates.sections_panel.change_input_type")}
          </button>
        ) : null}
      </div>

      {confirmingShape && shapeChanged ? (
        <div className="mt-3 rounded-lg border-2 border-co-gold-deep bg-co-gold/10 p-3">
          <p className="text-sm font-bold text-co-text">
            {t("admin.templates.sections_panel.change_input_type_confirm_title")
              .replace("{count}", itemsInSection.length.toString())
              .replace("{type}", t(shapeOptions.find((o) => o.value === shape)!.key))}
          </p>
          <p className="mt-2 text-xs text-co-text-muted">{t("admin.templates.sections_panel.change_input_type_warning")}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => { setConfirmingShape(false); setShape(section.shape); setIncludeNote(section.columns.includes("free_text")); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
            >
              {t("admin.templates.sections_panel.disable_cancel")}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void applyShape()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
            >
              {t("admin.templates.sections_panel.change_input_type_confirm")}
            </button>
          </div>
        </div>
      ) : null}

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

function AddSectionForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [labelEn, setLabelEn] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [shape, setShape] = useState<PrepSectionShape>("on_hand");
  const [includeNote, setIncludeNote] = useState(false);

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const shapeOptions: Array<{ value: PrepSectionShape; key: TranslationKey }> = [
    { value: "on_hand", key: "admin.templates.section_shape.on_hand" },
    { value: "portioned", key: "admin.templates.section_shape.portioned" },
    { value: "line", key: "admin.templates.section_shape.line" },
    { value: "yes_no", key: "admin.templates.section_shape.yes_no" },
  ];

  const submit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!labelEn.trim()) { setErrorMsg(t(resolveErrorKey("invalid_label"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/sections`,
      {
        labelEn: labelEn.trim(),
        labelEs: labelEs.trim() || null,
        shape,
        includeNote: shape === "yes_no" ? includeNote : undefined,
      },
      "POST",
    );
    setSubmitting(false);
    if (result.ok) {
      setLabelEn("");
      setLabelEs("");
      setShape("on_hand");
      setIncludeNote(false);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div className="mt-3 rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{t("admin.templates.sections_panel.add_title")}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <Labeled label={t("admin.templates.sections_panel.add_label_en")}>
          <input className={field} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.templates.sections_panel.add_label_es")}>
          <input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.templates.sections_panel.add_shape")}>
          <select
            className={field}
            value={shape}
            onChange={(e) => setShape(e.target.value as PrepSectionShape)}
          >
            {shapeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.key)}
              </option>
            ))}
          </select>
        </Labeled>
        {shape === "yes_no" ? (
          <label className="flex items-center gap-2 text-sm font-bold text-co-text">
            <input
              type="checkbox"
              className="h-5 w-5 accent-co-gold"
              checked={includeNote}
              onChange={(e) => setIncludeNote(e.target.checked)}
            />
            {t("admin.templates.sections_panel.add_include_note")}
          </label>
        ) : null}
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
          >
            {t("admin.templates.sections_panel.add_submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionQuestionRow({
  question,
  sections,
  language,
}: {
  question: SectionQuestionView;
  sections: PrepSectionDefn[];
  language: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const sectionLabel = sectionLabelByLang(sections, question.sectionSlug, language);
  const inputTypeKey =
    INPUT_TYPE_OPTIONS.find((o) => o.value === question.inputType)?.key ??
    ("admin.templates.section_shape.free_text" as TranslationKey);

  const disable = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/section-questions/${question.questionId}`,
      {},
      "DELETE",
    );
    setSubmitting(false);
    if (result.ok) { setConfirmingDisable(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-co-text-muted">{sectionLabel}</p>
          <p className="text-sm font-bold text-co-text">
            {question.label}
            <span className="ml-2 rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-co-gold-deep">
              {t(inputTypeKey)}
            </span>
          </p>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setConfirmingDisable((v) => !v)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta hover:border-co-cta disabled:opacity-50"
        >
          {t("admin.templates.section_questions_panel.disable")}
        </button>
      </div>

      {confirmingDisable ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">
            {t("admin.templates.section_questions_panel.disable_confirm_title", { section: sectionLabel })}
          </p>
          <p className="mt-2 text-xs text-co-text-muted">
            {t("admin.templates.section_questions_panel.disable_confirm")}
          </p>
          {errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirmingDisable(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
            >
              {t("admin.templates.section_questions_panel.disable_cancel")}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void disable()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-surface disabled:opacity-50"
            >
              {t("admin.templates.section_questions_panel.disable")}
            </button>
          </div>
        </div>
      ) : (
        errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null
      )}
    </div>
  );
}

function AddSectionQuestionForm({ sections }: { sections: PrepSectionDefn[] }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const slugs = orderedSectionSlugs(sections);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [sectionSlug, setSectionSlug] = useState<string>(slugs[0] ?? "");
  const [label, setLabel] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [inputType, setInputType] = useState<LineInputType>("yes_no");
  const [includeNote, setIncludeNote] = useState(false);
  const [minRole, setMinRole] = useState("");
  const [required, setRequired] = useState(false);

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const reset = () => {
    setSectionSlug(slugs[0] ?? "");
    setLabel("");
    setLabelEs("");
    setInputType("yes_no");
    setIncludeNote(false);
    setMinRole("");
    setRequired(false);
    setErrorMsg(null);
  };

  const submit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!label.trim()) { setErrorMsg(t(resolveErrorKey("invalid_label"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/section-questions`,
      {
        sectionSlug,
        label: label.trim(),
        labelEs: labelEs.trim() || null,
        inputType,
        includeNote: inputType === "yes_no" ? includeNote : undefined,
        minRoleLevel: minRole.trim() === "" ? null : Number(minRole),
        required,
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
        {t("admin.templates.section_questions_panel.add_title")}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{t("admin.templates.section_questions_panel.add_title")}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <Labeled label={t("admin.templates.section_questions_panel.add_section")}>
          <select className={field} value={sectionSlug} onChange={(e) => setSectionSlug(e.target.value)}>
            {slugs.map((s) => (
              <option key={s} value={s}>
                {sectionLabelByLang(sections, s, language)}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={t("admin.templates.section_questions_panel.add_label_en")}>
          <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.templates.section_questions_panel.add_label_es")}>
          <input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.templates.section_questions_panel.add_input_type")}>
          <select
            className={field}
            value={inputType}
            onChange={(e) => setInputType(e.target.value as LineInputType)}
          >
            {INPUT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.key)}
              </option>
            ))}
          </select>
        </Labeled>
        {inputType === "yes_no" ? (
          <label className="flex items-center gap-2 text-sm font-bold text-co-text">
            <input
              type="checkbox"
              className="h-5 w-5 accent-co-gold"
              checked={includeNote}
              onChange={(e) => setIncludeNote(e.target.checked)}
            />
            {t("admin.templates.sections_panel.add_include_note")}
          </label>
        ) : null}
        <Labeled label={t("admin.templates.section_questions_panel.add_min_role")}>
          <select className={field} value={minRole} onChange={(e) => setMinRole(e.target.value)}>
            <option value="">—</option>
            {roleLevelOptions().map((o) => (
              <option key={o.level} value={o.level}>{o.label} ({o.level})</option>
            ))}
          </select>
        </Labeled>
        <p className="-mt-1 text-xs text-co-text-muted">{t("admin.templates.min_role.hint")}</p>
        <label className="flex items-center gap-2 text-sm font-bold text-co-text">
          <input
            type="checkbox"
            className="h-5 w-5 accent-co-gold"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          {t("admin.templates.section_questions_panel.add_required")}
        </label>
        {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => { reset(); setOpen(false); }}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
          >
            {t("admin.templates.section_questions_panel.disable_cancel")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
          >
            {t("admin.templates.section_questions_panel.add_submit")}
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
