"use client";

/**
 * RefundPanel — the in-app refund step for a catering order (migration 0357; lib/catering/refunds.ts). Rendered ONLY
 * when the server switch CATERING_REFUNDS is on (the page passes it down); off = this component never mounts and makes
 * no request.
 *
 * What it shows: what the customer paid through the app, what is already refunded, what is in progress, and what can
 * still be refunded (all SERVER figures — this component does no money math beyond reading a typed amount), plus the
 * refund history with a Retry / Check status button per row. What it does: Full or Partial, a reason (a note for
 * "Other"), a Review step, then ONE explicit confirm tap. The confirm carries a token minted when the form opened, so a
 * double tap, a re-send after the password prompt, or a browser retry is the same request (0357 replays it).
 * The server asks for a fresh password (Tier B, like Send): on `step_up_required` / `step_up_stale` the password modal
 * opens and its confirm re-sends the SAME request.
 */
import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import {
  REFUND_ERROR_CODES,
  REFUND_REASON_CODES,
  refundDollarsToCents,
  type RefundReasonCode,
  type RefundSummary,
  type RefundTrigger,
} from "@/lib/catering/refunds-shared";
import { postJson, isStepUpCode } from "./shared";

const DEFAULT_REASON: Record<RefundTrigger, RefundReasonCode> = {
  panel: "customer_cancelled",
  declined: "quote_declined",
  lost: "event_lost",
};

function errorKey(code: string): TranslationKey {
  return ((REFUND_ERROR_CODES as readonly string[]).includes(code) ? `catering.refunds.error.${code}` : "catering.refunds.error.generic") as TranslationKey;
}

function newToken(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function RefundPanel({
  quoteId,
  openTrigger,
  onTriggerHandled,
  onChanged,
}: {
  quoteId: string;
  /** Set by the caller to open the form: a decline just now, or the pipeline's "lost" deep link. */
  openTrigger: "declined" | "lost" | null;
  onTriggerHandled: () => void;
  /** The payments panel above re-reads after a refund (its statuses move when the webhook lands). */
  onChanged: () => void;
}) {
  const { t, language } = useTranslation();
  const money = (c: number) => formatCents(c, language);
  const [summary, setSummary] = useState<RefundSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState<RefundReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [token, setToken] = useState<string>(() => newToken());
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [errKey, setErrKey] = useState<TranslationKey | null>(null);
  const [flash, setFlash] = useState<{ key: TranslationKey; params?: Record<string, string> } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/catering/quotes/${quoteId}/refunds`, { redirect: "manual" });
      if (!r.ok) {
        setLoadFailed(true);
        return;
      }
      const body = (await r.json()) as { summary: RefundSummary };
      setSummary(body.summary);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [quoteId]);

  // The first read, in the subscribe-then-set shape (state is set only in the promise callbacks).
  useEffect(() => {
    let alive = true;
    void fetch(`/api/catering/quotes/${quoteId}/refunds`, { redirect: "manual" })
      .then((r) => (r.ok ? (r.json() as Promise<{ summary: RefundSummary }>) : null))
      .then((body) => {
        if (!alive) return;
        if (body) setSummary(body.summary);
        setLoadFailed(!body);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [quoteId]);

  // A failed read is NOT "nothing to refund" (review r4): say so, keep a way to try again.
  if (loadFailed && !summary) {
    return (
      <div className="co-card flex flex-col gap-2 p-4" data-testid="refund-panel-unavailable" role="status">
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.refunds.heading")}</h3>
        <p className="text-sm font-semibold text-co-warning-text">{t("catering.refunds.unavailable")}</p>
        <div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text"
          >
            {t("catering.refunds.try_again")}
          </button>
        </div>
      </div>
    );
  }
  if (!summary) return null;
  const { totals } = summary;
  // Nothing was ever paid through the app and nothing by hand: there is no refund story to tell.
  if (totals.paidCents === 0 && totals.outsideAppCents === 0 && summary.requests.length === 0) return null;

  const canOffer = summary.installed && summary.canRefund && totals.refundableCents > 0;
  const trigger: RefundTrigger = openTrigger ?? "panel";
  const showForm = canOffer && (formOpen || openTrigger !== null);
  const chosenReason = reason ?? DEFAULT_REASON[trigger];
  const partialCents = mode === "partial" ? refundDollarsToCents(amountText) : null;
  const amountCents = mode === "full" ? totals.refundableCents : partialCents;
  const amountOk = amountCents !== null && amountCents > 0 && amountCents <= totals.refundableCents;
  const noteOk = chosenReason !== "other" || note.trim().length > 0;

  const closeForm = () => {
    setFormOpen(false);
    setReviewing(false);
    setMode("full");
    setAmountText("");
    setReason(null);
    setNote("");
    setToken(newToken());
    onTriggerHandled();
  };

  const send = async () => {
    if (!amountOk || !noteOk || amountCents === null) return false;
    setBusy(true);
    setErrKey(null);
    setFlash(null);
    const res = await postJson(
      `/api/catering/quotes/${quoteId}/refunds`,
      {
        clientToken: token,
        // The number on the confirm button, "Full" included: the server refunds exactly what was confirmed.
        amountCents,
        reasonCode: chosenReason,
        reasonNote: note.trim() || null,
        trigger,
      },
      "POST",
    );
    setBusy(false);
    if (res.ok) {
      setStepUpOpen(false);
      const results = (res.data.results ?? []) as Array<{ status: string; errorCode: string | null }>;
      if (res.data.summary) setSummary(res.data.summary as RefundSummary);
      else void load();
      const failed = results.find((r) => r.status === "failed");
      if (failed) setFlash({ key: "catering.refunds.result.failed", params: { code: failed.errorCode ?? "" } });
      else if (results.some((r) => r.status === "pending")) setFlash({ key: "catering.refunds.result.pending" });
      else setFlash({ key: "catering.refunds.result.sent" });
      closeForm();
      onChanged();
      return true;
    }
    if (isStepUpCode(res.code)) {
      setStepUpOpen(true);
      return false;
    }
    setErrKey(errorKey(res.code));
    if (res.code === "over_refundable" || res.code === "nothing_refundable" || res.code === "token_reused") {
      setReviewing(false);
      setToken(newToken());
      void load();
    }
    return false;
  };

  const retry = async (requestId: string, release = false) => {
    setRowBusy(requestId);
    setErrKey(null);
    setFlash(null);
    setReleasing(null);
    const res = await postJson(`/api/catering/quotes/${quoteId}/refunds/${requestId}/retry`, release ? { release: true } : {}, "POST");
    setRowBusy(null);
    if (res.ok) {
      if (res.data.summary) setSummary(res.data.summary as RefundSummary);
      else void load();
      const r = res.data.result as { status: string; errorCode: string | null } | undefined;
      setFlash(
        r?.errorCode === "released_no_refund"
          ? { key: "catering.refunds.result.released" }
          : r?.errorCode === "needs_reconcile"
            ? { key: "catering.refunds.result.still_unconfirmed" }
            : r?.status === "failed"
          ? { key: "catering.refunds.result.failed", params: { code: r.errorCode ?? "" } }
          : r?.status === "pending"
            ? { key: "catering.refunds.result.pending" }
            : { key: "catering.refunds.result.updated" },
      );
      onChanged();
    } else {
      setErrKey(errorKey(res.code));
    }
  };

  const statusTone: Record<string, string> = {
    pending: "text-co-warning-text",
    submitted: "text-co-warning-text",
    succeeded: "text-co-confirm-text",
    failed: "text-co-cta-text",
  };

  return (
    <div className="co-card flex flex-col gap-3 p-4" data-testid="refund-panel">
      <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.refunds.heading")}</h3>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-co-text-muted">{t("catering.refunds.paid")}</dt>
        <dd className="text-right tabular-nums text-co-text">{money(totals.paidCents)}</dd>
        <dt className="text-co-text-muted">{t("catering.refunds.refunded")}</dt>
        <dd className="text-right tabular-nums text-co-text">{money(totals.refundedCents)}</dd>
        {totals.inFlightCents > 0 && (
          <>
            <dt className="text-co-text-muted">{t("catering.refunds.in_flight")}</dt>
            <dd className="text-right tabular-nums text-co-warning-text">{money(totals.inFlightCents)}</dd>
          </>
        )}
        <dt className="font-semibold text-co-text">{t("catering.refunds.refundable")}</dt>
        <dd className="text-right font-semibold tabular-nums text-co-text">{money(totals.refundableCents)}</dd>
      </dl>
      {totals.outsideAppCents > 0 && (
        <p className="text-xs text-co-text-muted">{t("catering.refunds.outside_app", { amount: money(totals.outsideAppCents) })}</p>
      )}
      {!summary.installed && <p className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.not_installed")}</p>}

      {openTrigger === "declined" && canOffer && !formOpen && (
        <p className="text-sm font-semibold text-co-text">{t("catering.refunds.prompt.declined", { amount: money(totals.refundableCents) })}</p>
      )}
      {openTrigger === "lost" && canOffer && !formOpen && (
        <p className="text-sm font-semibold text-co-text">{t("catering.refunds.prompt.lost", { amount: money(totals.refundableCents) })}</p>
      )}

      {canOffer && !showForm && (
        <div>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-cta-text bg-co-surface px-5 py-2.5 text-sm font-bold text-co-cta-text disabled:opacity-50"
          >
            {t("catering.refunds.start")}
          </button>
        </div>
      )}

      {showForm && !reviewing && (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-co-border bg-co-surface-inset p-3" data-testid="refund-form">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catering.refunds.how_much")}</legend>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">
              <input type="radio" name={`refund-mode-${quoteId}`} aria-label={t("catering.refunds.choice.full", { amount: money(totals.refundableCents) })} checked={mode === "full"} onChange={() => setMode("full")} className="h-5 w-5" />
              {t("catering.refunds.choice.full", { amount: money(totals.refundableCents) })}
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-co-text">
              <input type="radio" name={`refund-mode-${quoteId}`} aria-label={t("catering.refunds.choice.partial")} checked={mode === "partial"} onChange={() => setMode("partial")} className="h-5 w-5" />
              {t("catering.refunds.choice.partial")}
            </label>
            {mode === "partial" && (
              <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
                {t("catering.refunds.amount_label")}
                <input
                  inputMode="decimal"
                  aria-label={t("catering.refunds.amount_label")}
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  placeholder="0.00"
                  className="min-h-[44px] w-full max-w-[12rem] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-semibold normal-case tracking-normal text-co-text"
                />
                {amountText.trim() !== "" && !amountOk && (
                  <span className="text-xs font-semibold normal-case tracking-normal text-co-cta-text">
                    {t("catering.refunds.amount_invalid", { max: money(totals.refundableCents) })}
                  </span>
                )}
              </label>
            )}
          </fieldset>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {t("catering.refunds.reason_label")}
            <select
              aria-label={t("catering.refunds.reason_label")}
              value={chosenReason}
              onChange={(e) => setReason(e.target.value as RefundReasonCode)}
              className="min-h-[44px] w-full max-w-[20rem] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-semibold normal-case tracking-normal text-co-text"
            >
              {REFUND_REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {t(`catering.refunds.reason.${c}` as TranslationKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {chosenReason === "other" ? t("catering.refunds.note_label_required") : t("catering.refunds.note_label")}
            <textarea
              aria-label={chosenReason === "other" ? t("catering.refunds.note_label_required") : t("catering.refunds.note_label")}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm normal-case tracking-normal text-co-text"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!amountOk || !noteOk}
              onClick={() => setReviewing(true)}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-co-text px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-co-cta shadow-sm transition hover:bg-co-text/90 disabled:opacity-50"
            >
              {t("catering.refunds.review")}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-border-2 bg-co-surface px-5 py-2.5 text-sm font-semibold text-co-text transition hover:border-co-text"
            >
              {t("catering.refunds.cancel")}
            </button>
          </div>
        </div>
      )}

      {showForm && reviewing && amountCents !== null && (
        <div role="group" data-testid="refund-confirm" className="flex flex-col gap-2 rounded-lg border-2 border-co-cta-text bg-co-surface p-3">
          <p className="text-sm font-bold text-co-text">{t("catering.refunds.confirm_title", { amount: money(amountCents) })}</p>
          <p className="text-xs text-co-text-muted">
            {t(`catering.refunds.reason.${chosenReason}` as TranslationKey)}
            {note.trim() ? ` · ${note.trim()}` : ""}
          </p>
          <p className="text-xs text-co-text">{t("catering.refunds.confirm_body")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send()}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-cta-text bg-co-surface px-5 py-2.5 text-sm font-bold text-co-cta-text disabled:opacity-50"
            >
              {busy ? t("catering.refunds.working") : t("catering.refunds.confirm_button", { amount: money(amountCents) })}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setReviewing(false)}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-border-2 bg-co-surface px-5 py-2.5 text-sm font-semibold text-co-text transition hover:border-co-text disabled:opacity-50"
            >
              {t("catering.refunds.back")}
            </button>
          </div>
        </div>
      )}

      {flash && (
        <p className="rounded-lg border-2 border-co-success/40 bg-co-success/10 px-3 py-2 text-sm font-semibold text-co-confirm-text">{t(flash.key, flash.params)}</p>
      )}
      {errKey && <p className="text-sm font-semibold text-co-cta-text">{t(errKey)}</p>}
      {loadFailed && (
        <div className="flex flex-wrap items-center gap-2" role="status" data-testid="refund-panel-stale">
          <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.unavailable")}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text"
          >
            {t("catering.refunds.try_again")}
          </button>
        </div>
      )}

      {summary.requests.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-co-border pt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("catering.refunds.history")}</h4>
          {summary.requests.map((r) => (
            <div key={r.id} className="flex flex-col gap-1 text-sm" data-testid="refund-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-co-text">
                  <span className={`font-semibold ${statusTone[r.status] ?? "text-co-text"}`}>{t(`catering.refunds.status.${r.status}` as TranslationKey)}</span>
                  <span className="text-co-text-dim"> · </span>
                  {t(`catering.refunds.reason.${r.reasonCode}` as TranslationKey)}
                </span>
                <span className="tabular-nums text-co-text-muted">{money(r.amountCents)}</span>
              </div>
              <span className="text-xs text-co-text-dim">
                {t("catering.refunds.by", {
                  name: r.requestedByName ?? t("catering.refunds.someone"),
                  date: `${formatDateLabel(etCalendarDate(r.requestedAt), language)} ${formatTime(r.requestedAt, language)}`,
                })}
                {r.reasonNote ? ` · ${r.reasonNote}` : ""}
              </span>
              {r.lastErrorCode && r.status !== "succeeded" && (
                <span className="text-xs text-co-text-muted">{t("catering.refunds.last_answer", { code: r.lastErrorCode })}</span>
              )}
              {r.needsReconcile && <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.needs_reconcile")}</span>}
              {r.needsReconcile && summary.canRefund && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={rowBusy !== null}
                    onClick={() => void retry(r.id)}
                    className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50"
                  >
                    {rowBusy === r.id ? t("catering.refunds.working") : t("catering.refunds.check_stripe")}
                  </button>
                  {releasing !== r.id ? (
                    <button
                      type="button"
                      disabled={rowBusy !== null}
                      onClick={() => setReleasing(r.id)}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold text-co-cta-text disabled:opacity-50"
                    >
                      {t("catering.refunds.release")}
                    </button>
                  ) : (
                    <span className="flex flex-col gap-2">
                      <span className="text-xs text-co-text">{t("catering.refunds.release_confirm")}</span>
                      <span className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={rowBusy !== null}
                          onClick={() => void retry(r.id, true)}
                          className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold text-co-cta-text disabled:opacity-50"
                        >
                          {t("catering.refunds.release_yes")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReleasing(null)}
                          className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-semibold text-co-text"
                        >
                          {t("catering.refunds.cancel")}
                        </button>
                      </span>
                    </span>
                  )}
                </div>
              )}
              {r.retryable && summary.canRefund && (
                <div>
                  <button
                    type="button"
                    disabled={rowBusy !== null}
                    onClick={() => void retry(r.id)}
                    className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50"
                  >
                    {rowBusy === r.id ? t("catering.refunds.working") : r.status === "submitted" ? t("catering.refunds.refresh") : t("catering.refunds.retry")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <PasswordModal
        open={stepUpOpen}
        onConfirm={async () => {
          await send();
        }}
        onCancel={() => setStepUpOpen(false)}
      />
    </div>
  );
}
