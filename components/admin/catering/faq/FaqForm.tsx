"use client";

/**
 * FaqForm — reusable add/edit form for a catering FAQ.
 *
 * initial present = edit mode; undefined = add mode.
 * Bilingual: question_en/question_es and answer_en/answer_es are paired textareas
 * saved atomically. The parent owns the POST/PATCH + step-up + router.refresh;
 * this component calls back with the assembled payload via onSubmit. Authority is
 * gated by the parent (it only renders the form for AGM+ / catering_mgr+, ≥6).
 */

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { FaqView } from "@/lib/admin/catering/faq";

export interface FaqFormLocationOption {
  id: string;
  name: string;
}

export interface FaqFormValues {
  locationId: string | null;
  questionEn: string;
  questionEs: string | null;
  answerEn: string;
  answerEs: string | null;
}

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

const textareaCls =
  "mt-1 w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}

export function FaqForm({
  initial,
  locations,
  busy,
  errorMsg,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Existing FAQ when editing; undefined when adding. */
  initial?: FaqView;
  /** Active locations for the optional location picker. */
  locations: FaqFormLocationOption[];
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  onSubmit: (values: FaqFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  // Location: "" sentinel = Global → null.
  const [locationId, setLocationId] = useState<string>(initial?.locationId ?? "");
  const [questionEn, setQuestionEn] = useState(initial?.questionEn ?? "");
  const [questionEs, setQuestionEs] = useState(initial?.questionEs ?? "");
  const [answerEn, setAnswerEn] = useState(initial?.answerEn ?? "");
  const [answerEs, setAnswerEs] = useState(initial?.answerEs ?? "");

  const canSubmit = questionEn.trim() !== "" && answerEn.trim() !== "" && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      locationId: locationId || null,
      questionEn: questionEn.trim(),
      questionEs: questionEs.trim() || null,
      answerEn: answerEn.trim(),
      answerEs: answerEs.trim() || null,
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-co-border p-3">
      {/* Location picker — only visible in add mode (locationId is fixed on existing rows) */}
      {!initial ? (
        <Labeled label={t("admin.catering.faq.field.location" as TranslationKey)}>
          <select
            className={fieldCls}
            value={locationId}
            disabled={busy}
            onChange={(e) => setLocationId(e.target.value)}
            aria-label={t("admin.catering.faq.field.location" as TranslationKey)}
          >
            <option value="">{t("admin.catering.faq.location_global" as TranslationKey)}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Labeled>
      ) : null}

      {/* Question — bilingual pair */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-co-text">
          {t("admin.catering.faq.field.question" as TranslationKey)}
        </p>
        <Labeled label={t("admin.catering.faq.field.question_en" as TranslationKey)}>
          <textarea
            className={textareaCls}
            rows={2}
            value={questionEn}
            disabled={busy}
            onChange={(e) => setQuestionEn(e.target.value)}
            aria-label={t("admin.catering.faq.field.question_en" as TranslationKey)}
          />
        </Labeled>
        <Labeled label={t("admin.catering.faq.field.question_es" as TranslationKey)}>
          <textarea
            className={textareaCls}
            rows={2}
            value={questionEs}
            disabled={busy}
            onChange={(e) => setQuestionEs(e.target.value)}
            aria-label={t("admin.catering.faq.field.question_es" as TranslationKey)}
          />
        </Labeled>
      </div>

      {/* Answer — bilingual pair */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-co-text">
          {t("admin.catering.faq.field.answer" as TranslationKey)}
        </p>
        <Labeled label={t("admin.catering.faq.field.answer_en" as TranslationKey)}>
          <textarea
            className={textareaCls}
            rows={4}
            value={answerEn}
            disabled={busy}
            onChange={(e) => setAnswerEn(e.target.value)}
            aria-label={t("admin.catering.faq.field.answer_en" as TranslationKey)}
          />
        </Labeled>
        <Labeled label={t("admin.catering.faq.field.answer_es" as TranslationKey)}>
          <textarea
            className={textareaCls}
            rows={4}
            value={answerEs}
            disabled={busy}
            onChange={(e) => setAnswerEs(e.target.value)}
            aria-label={t("admin.catering.faq.field.answer_es" as TranslationKey)}
          />
        </Labeled>
      </div>

      {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.catering.faq.cancel" as TranslationKey)}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
