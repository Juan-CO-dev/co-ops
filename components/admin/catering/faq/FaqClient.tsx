"use client";

/**
 * FaqClient — the FAQ list editor (/admin/catering/faq).
 *
 * Lists all FAQs (active first, ordered by display_order). AGM+ / catering_mgr+
 * (≥6) can add (Tier B), edit text (Tier A), and deactivate/reactivate (Tier B).
 * Authority (actorLevel >= MIN=6) is re-checked here and matches the route+lib floors.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import type { FaqView } from "@/lib/admin/catering/faq";
import { FaqForm, type FaqFormLocationOption, type FaqFormValues } from "./FaqForm";

const MIN = 6;

export function FaqClient({
  faqs,
  locations,
  actorLevel,
}: {
  faqs: FaqView[];
  locations: FaqFormLocationOption[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const canManage = actorLevel >= MIN;

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const create = async (values: FaqFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/catering/faq", values);
    setBusy(false);
    if (result.ok) {
      setAdding(false);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const saveEdit = async (id: string, values: FaqFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    // Text edit only — strip locationId (not editable after creation).
    const payload = {
      questionEn: values.questionEn,
      questionEs: values.questionEs,
      answerEn: values.answerEn,
      answerEs: values.answerEs,
    };
    const result = await postJson(`/api/admin/catering/faq/${id}`, payload, "PATCH");
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const toggleActive = async (faq: FaqView) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/faq/${faq.id}`,
      { active: !faq.active },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      setConfirmDeactivateId(null);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div className="mt-5">
      {/* Add button */}
      {canManage && !adding ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setErrorMsg(null);
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            aria-label={t("admin.catering.faq.add_faq" as TranslationKey)}
          >
            {t("admin.catering.faq.add_faq" as TranslationKey)}
          </button>
        </div>
      ) : null}

      {adding ? (
        <div className="mt-4">
          <FaqForm
            locations={locations}
            busy={busy}
            errorMsg={errorMsg}
            submitLabel={t("admin.catering.faq.save" as TranslationKey)}
            onSubmit={(values) => void create(values)}
            onCancel={() => {
              setAdding(false);
              setErrorMsg(null);
            }}
          />
        </div>
      ) : null}

      {faqs.length === 0 ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.catering.faq.empty" as TranslationKey)}
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {faqs.map((faq) => (
            <li
              key={faq.id}
              className={"rounded-lg border-2 border-co-border bg-co-surface p-3 " + (faq.active ? "" : "opacity-60")}
            >
              {editingId === faq.id ? (
                <FaqForm
                  initial={faq}
                  locations={locations}
                  busy={busy}
                  errorMsg={errorMsg}
                  submitLabel={t("admin.catering.faq.save" as TranslationKey)}
                  onSubmit={(values) => void saveEdit(faq.id, values)}
                  onCancel={() => {
                    setEditingId(null);
                    setErrorMsg(null);
                  }}
                />
              ) : (
                <FaqRow
                  faq={faq}
                  canManage={canManage}
                  confirming={confirmDeactivateId === faq.id}
                  busy={busy}
                  onEdit={() => {
                    setEditingId(faq.id);
                    setErrorMsg(null);
                  }}
                  onAskDeactivate={() => setConfirmDeactivateId(faq.id)}
                  onCancelDeactivate={() => setConfirmDeactivateId(null)}
                  onConfirmDeactivate={() => void toggleActive(faq)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {errorMsg && editingId === null && !adding ? (
        <p className="mt-2 text-sm text-co-cta">{errorMsg}</p>
      ) : null}
    </div>
  );
}

/** Read row: question (EN) · slug · location badge + action buttons */
function FaqRow({
  faq,
  canManage,
  confirming,
  busy,
  onEdit,
  onAskDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
}: {
  faq: FaqView;
  canManage: boolean;
  confirming: boolean;
  busy: boolean;
  onEdit: () => void;
  onAskDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 text-sm text-co-text">
        <div className="flex flex-wrap items-center gap-2 font-bold">
          <span className="truncate">{faq.questionEn}</span>
          {!faq.active ? (
            <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.catering.faq.status.inactive" as TranslationKey)}
            </span>
          ) : null}
          {faq.locationId === null ? (
            <span className="inline-flex items-center rounded-full bg-co-gold/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text">
              {t("admin.catering.faq.location_global" as TranslationKey)}
            </span>
          ) : null}
        </div>
        {faq.questionEs ? (
          <div className="mt-0.5 text-xs text-co-text-muted">{faq.questionEs}</div>
        ) : null}
        <div className="mt-1 text-co-text-muted">{faq.answerEn}</div>
        {faq.answerEs ? (
          <div className="mt-0.5 text-xs text-co-text-muted">{faq.answerEs}</div>
        ) : null}
        <div className="mt-1 text-[11px] text-co-text-muted">
          {t("admin.catering.faq.slug_label" as TranslationKey)}: <code>{faq.slug}</code>
          {" · "}
          {t("admin.catering.faq.order_label" as TranslationKey)}: {faq.displayOrder}
        </div>
      </div>

      {canManage ? (
        <div className="flex shrink-0 gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onCancelDeactivate}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
              >
                {t("admin.catering.faq.cancel" as TranslationKey)}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirmDeactivate}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
              >
                {faq.active
                  ? t("admin.catering.faq.deactivate" as TranslationKey)
                  : t("admin.catering.faq.reactivate" as TranslationKey)}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                aria-label={t("admin.catering.faq.edit_aria" as TranslationKey)}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {t("admin.catering.faq.edit" as TranslationKey)}
              </button>
              <button
                type="button"
                onClick={onAskDeactivate}
                aria-label={
                  faq.active
                    ? t("admin.catering.faq.deactivate_aria" as TranslationKey)
                    : t("admin.catering.faq.reactivate_aria" as TranslationKey)
                }
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {faq.active
                  ? t("admin.catering.faq.deactivate" as TranslationKey)
                  : t("admin.catering.faq.reactivate" as TranslationKey)}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
