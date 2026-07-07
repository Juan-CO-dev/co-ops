"use client";

/**
 * ItemQuestionsEditor — the per-item "Questions" sub-area inside an ItemRow's
 * edit panel (MoO+ only; the row already gates `canEdit = actorLevel >= 8`).
 * Lifted verbatim from the checklist admin's GlobalRegistryTab (Items Central
 * Page, 2026-07-07). Routes unchanged.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { roleLevelOptions } from "@/lib/roles";
import type { LineInputType } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ItemQuestionView } from "@/lib/admin/templates";
import { postJson, resolveErrorKey } from "@/components/admin/templates/shared";
import { Labeled } from "./Labeled";

export const INPUT_TYPE_OPTIONS: Array<{ value: LineInputType; key: TranslationKey }> = [
  { value: "on_hand", key: "admin.templates.section_shape.on_hand" },
  { value: "portioned", key: "admin.templates.section_shape.portioned" },
  { value: "line", key: "admin.templates.section_shape.line" },
  { value: "yes_no", key: "admin.templates.section_shape.yes_no" },
  { value: "free_text", key: "admin.templates.section_shape.free_text" },
];

export function ItemQuestionsEditor({
  itemId,
  itemQuestions,
}: {
  itemId: string;
  itemQuestions: ItemQuestionView[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [inputType, setInputType] = useState<LineInputType>("yes_no");
  const [includeNote, setIncludeNote] = useState(false);
  const [minRole, setMinRole] = useState("");
  const [required, setRequired] = useState(false);

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  const reset = () => {
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
      `/api/admin/checklist-templates/item-questions`,
      {
        itemId,
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

  return (
    <div className="rounded-lg border-2 border-co-border p-3">
      <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t("admin.templates.item_questions.heading")}
      </h3>

      {itemQuestions.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {itemQuestions.map((q) => (
            <ItemQuestionRow key={q.questionId} question={q} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-co-text-muted">{t("admin.templates.item_questions.empty")}</p>
      )}

      {open ? (
        <div className="mt-3 rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
          <h4 className="text-sm font-extrabold text-co-text">{t("admin.templates.item_questions.add")}</h4>
          <div className="mt-3 flex flex-col gap-3">
            <Labeled label={t("admin.templates.item_questions.add_label_en")}>
              <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Labeled>
            <Labeled label={t("admin.templates.item_questions.add_label_es")}>
              <input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
            </Labeled>
            <Labeled label={t("admin.templates.item_questions.add_input_type")}>
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
            <Labeled label={t("admin.templates.item_questions.add_min_role")}>
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
              {t("admin.templates.item_questions.add_required")}
            </label>
            {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => { reset(); setOpen(false); }}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
              >
                {t("admin.templates.item_questions.disable_cancel")}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submit()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
              >
                {t("admin.templates.item_questions.add_submit")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex min-h-[44px] items-center self-start rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
        >
          {t("admin.templates.item_questions.add")}
        </button>
      )}
    </div>
  );
}

function ItemQuestionRow({ question }: { question: ItemQuestionView }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const inputTypeKey =
    INPUT_TYPE_OPTIONS.find((o) => o.value === question.inputType)?.key ??
    ("admin.templates.section_shape.free_text" as TranslationKey);

  const disable = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/checklist-templates/item-questions/${question.questionId}`,
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
        <p className="min-w-0 text-sm font-bold text-co-text">
          {question.label}
          <span className="ml-2 rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-co-gold-deep">
            {t(inputTypeKey)}
          </span>
        </p>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setConfirmingDisable((v) => !v)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta hover:border-co-cta disabled:opacity-50"
        >
          {t("admin.templates.item_questions.disable")}
        </button>
      </div>

      {confirmingDisable ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">
            {t("admin.templates.item_questions.disable_confirm_title", { label: question.label })}
          </p>
          <p className="mt-2 text-xs text-co-text-muted">
            {t("admin.templates.item_questions.disable_confirm")}
          </p>
          {errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirmingDisable(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
            >
              {t("admin.templates.item_questions.disable_cancel")}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void disable()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-surface disabled:opacity-50"
            >
              {t("admin.templates.item_questions.disable")}
            </button>
          </div>
        </div>
      ) : (
        errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null
      )}
    </div>
  );
}
