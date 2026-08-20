"use client";

/**
 * WrittenReportForm — the phone-first add/edit form for a written report.
 *
 * initial present = edit mode; undefined = add mode. The parent owns the
 * POST/PATCH + router.refresh; this component assembles the draft and calls
 * onSubmit. Phone-first: 44px targets, base text, gold focus ring. Every
 * visible string + every ARIA label is i18n'd (en + es).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  WRITTEN_REPORT_CATEGORIES,
  WRITTEN_REPORT_LIMITS,
  WRITTEN_REPORT_DEFAULT_VISIBILITY,
  visibilityFloorOptions,
  type WrittenReportCategory,
} from "@/lib/written-reports-shared";
import type { RoleCode } from "@/lib/roles";

export interface WrittenReportFormValues {
  title: string | null;
  body: string;
  category: WrittenReportCategory | null;
  visibilityMinLevel: number;
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

export function WrittenReportForm({
  initial,
  busy,
  errorMsg,
  submitLabel,
  translateRole,
  onSubmit,
  onCancel,
  viewerLevel,
}: {
  initial?: WrittenReportFormValues;
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  /** Maps a RoleCode → its localized label, for the visibility-floor picker. */
  translateRole: (role: RoleCode) => string;
  onSubmit: (values: WrittenReportFormValues) => void;
  onCancel: () => void;
  /** Author's role level — clamps the offered visibility floors (MED-1). */
  viewerLevel: number;
}) {
  const { t } = useTranslation();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [category, setCategory] = useState<string>(initial?.category ?? "");
  const [visibility, setVisibility] = useState<number>(
    initial?.visibilityMinLevel ?? WRITTEN_REPORT_DEFAULT_VISIBILITY,
  );

  const floors = visibilityFloorOptions(viewerLevel);
  const canSubmit = body.trim() !== "" && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim() || null,
      body: body.trim(),
      category: (category || null) as WrittenReportCategory | null,
      visibilityMinLevel: visibility,
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-co-border p-3">
      <Labeled label={t("written_reports.field.title")}>
        <input
          type="text"
          className={fieldCls}
          value={title}
          disabled={busy}
          maxLength={WRITTEN_REPORT_LIMITS.titleMax}
          placeholder={t("written_reports.field.title_placeholder")}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={t("written_reports.field.title")}
        />
      </Labeled>

      <Labeled label={t("written_reports.field.body")}>
        <textarea
          className={textareaCls}
          rows={6}
          value={body}
          disabled={busy}
          maxLength={WRITTEN_REPORT_LIMITS.bodyMax}
          placeholder={t("written_reports.field.body_placeholder")}
          onChange={(e) => setBody(e.target.value)}
          aria-label={t("written_reports.field.body")}
        />
      </Labeled>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Labeled label={t("written_reports.field.category")}>
          <select
            className={fieldCls}
            value={category}
            disabled={busy}
            onChange={(e) => setCategory(e.target.value)}
            aria-label={t("written_reports.field.category")}
          >
            <option value="">{t("written_reports.category.none")}</option>
            {WRITTEN_REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`written_reports.category.${c}` as TranslationKey)}
              </option>
            ))}
          </select>
        </Labeled>

        <Labeled label={t("written_reports.field.visibility")}>
          <select
            className={fieldCls}
            value={String(visibility)}
            disabled={busy}
            onChange={(e) => setVisibility(Number(e.target.value))}
            aria-label={t("written_reports.field.visibility")}
          >
            {floors.map((f) => (
              <option key={f.level} value={String(f.level)}>
                {f.level === WRITTEN_REPORT_DEFAULT_VISIBILITY
                  ? t("written_reports.visibility.all_staff")
                  : t("written_reports.visibility.and_above", { role: translateRole(f.role) })}
              </option>
            ))}
          </select>
        </Labeled>
      </div>

      {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("written_reports.cancel")}
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
