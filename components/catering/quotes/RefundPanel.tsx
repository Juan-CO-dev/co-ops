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
 *
 * Part B1 (migration 0359), STORED STATE only (this component computes no money and makes no provider call): the
 * epoch line (refunds not open / being prepared / being stopped / unavailable: no Confirm form), per payment "Not
 * checked with Stripe yet", "On hold", the last verified time and the returned / pending / unexplained figures, each
 * request by its stored state (only `reserved_not_sent` says no create was sent), an explicit "I checked this charge in
 * Stripe" before an ordinary Release, and the order's open issues with the actions THIS viewer may take (the server
 * sends none to a viewer without authority). A disposition goes through the same Tier B password flow as Confirm.
 * A summary without the Part B1 fields renders exactly as before.
 */
import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import {
  EVIDENCE_REF_RE,
  EVIDENCE_REQUIRED_ACTIONS,
  REFUND_B1_ERROR_CODES,
  REFUND_TARGET_RE,
  TARGET_REQUIRED_ACTIONS,
  createRefusalFor,
  type RefundDispositionAction,
  type RefundIssueView,
  type StoredRequestState,
} from "@/lib/catering/refund-outcomes-shared";
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
  return ((REFUND_ERROR_CODES as readonly string[]).includes(code) || (REFUND_B1_ERROR_CODES as readonly string[]).includes(code)
    ? `catering.refunds.error.${code}`
    : "catering.refunds.error.generic") as TranslationKey;
}

/** A disposition answer that means "what you saw has moved": the panel offers a reload, it never re-sends. */
const STALE_DISPOSITION_CODES = new Set(["stale_generation", "issue_closed", "stale_evidence", "invalid_action"]);

const STATE_TONE: Record<StoredRequestState, string> = {
  reserved_not_sent: "text-co-warning-text",
  submission_unconfirmed: "text-co-warning-text",
  in_progress: "text-co-warning-text",
  submitted: "text-co-warning-text",
  succeeded: "text-co-confirm-text",
  failed: "text-co-cta-text",
  released: "text-co-text",
  held: "text-co-warning-text",
};

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
  const [releaseChecked, setReleaseChecked] = useState(false);
  // The open disposition form: the issue AS SHOWN (its generation is sent back), the action, and what was typed.
  const [disposing, setDisposing] = useState<{ issue: RefundIssueView; action: RefundDispositionAction } | null>(null);
  const [evidence, setEvidence] = useState("");
  const [target, setTarget] = useState("");
  const [dispBusy, setDispBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  // Which request the password modal re-sends after a step-up: the refund Confirm or the disposition.
  const [stepUpFor, setStepUpFor] = useState<"refund" | "disposition">("refund");
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
  if (totals.paidCents === 0 && totals.outsideAppCents === 0 && summary.requests.length === 0 && (summary.issues ?? []).length === 0) return null;

  // Part B1: the epoch admits a new refund only while live (the server says so too: canRefund is false otherwise).
  const epochRefusal = summary.epoch ? createRefusalFor(summary.epoch) : null;
  const canOffer = summary.installed && summary.canRefund && epochRefusal === null && totals.refundableCents > 0;
  const issues = summary.issues ?? [];
  const b1Payments = summary.payments.filter((p) => p.figures.eligible && (p.verified !== undefined || p.held !== undefined));
  const when = (iso: string) => `${formatDateLabel(etCalendarDate(iso), language)} ${formatTime(iso, language)}`;
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
      setStepUpFor("refund");
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
    setReleaseChecked(false);
    // An ordinary Release carries the person's explicit "I checked this charge in Stripe" (plan B1.1).
    const res = await postJson(`/api/catering/quotes/${quoteId}/refunds/${requestId}/retry`, release ? { release: true, staffVerified: true } : {}, "POST");
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

  const closeDisposition = () => {
    setDisposing(null);
    setEvidence("");
    setTarget("");
  };
  const needsEvidence = (action: RefundDispositionAction) => EVIDENCE_REQUIRED_ACTIONS.includes(action);
  const needsTarget = (action: RefundDispositionAction) => TARGET_REQUIRED_ACTIONS.includes(action);
  const evidenceOk = (action: RefundDispositionAction) => !needsEvidence(action) || EVIDENCE_REF_RE.test(evidence.trim());
  const targetOk = (action: RefundDispositionAction) => !needsTarget(action) || REFUND_TARGET_RE.test(target.trim());

  /** ONE disposition request (after a password prompt the modal re-sends the same one). No follow-up request. */
  const sendDisposition = async () => {
    if (!disposing || disposing.issue.generation == null) return false;
    const { issue, action } = disposing;
    if (!evidenceOk(action) || !targetOk(action)) return false;
    setDispBusy(true);
    setErrKey(null);
    setFlash(null);
    setNeedsReload(false);
    const res = await postJson(
      `/api/catering/quotes/${quoteId}/refunds/disposition`,
      {
        issueId: issue.id,
        expectedGeneration: issue.generation,
        action,
        evidenceRef: needsEvidence(action) ? evidence.trim() : null,
        target: needsTarget(action) ? target.trim() : null,
      },
      "POST",
    );
    setDispBusy(false);
    if (res.ok) {
      setStepUpOpen(false);
      // The figures come from the response. Without them the change still stands: the panel says its figures need a
      // reload (the Try again row) instead of sending a second request on its own.
      if (res.data.summary) setSummary(res.data.summary as RefundSummary);
      else setLoadFailed(true);
      setFlash({ key: "catering.refunds.result.disposition_done" });
      closeDisposition();
      onChanged();
      return true;
    }
    if (isStepUpCode(res.code)) {
      setStepUpFor("disposition");
      setStepUpOpen(true);
      return false;
    }
    setErrKey(errorKey(res.code));
    if (STALE_DISPOSITION_CODES.has(res.code)) {
      closeDisposition();
      setNeedsReload(true);
    }
    return false;
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
      {summary.stripeUnchecked && (
        <p className="text-xs font-semibold text-co-warning-text" role="status">
          {t(summary.epoch ? "catering.refunds.unchecked" : "catering.refunds.stripe_unchecked")}
        </p>
      )}
      {summary.installed && epochRefusal && (
        <p className="text-sm font-semibold text-co-warning-text" role="status" data-testid="refund-epoch">
          {t(`catering.refunds.epoch.${epochRefusal.code}` as TranslationKey)}
        </p>
      )}

      {b1Payments.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-co-border pt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("catering.refunds.payments_heading")}</h4>
          {b1Payments.map((p) => (
            <div key={p.id} className="flex flex-col gap-1 text-sm" data-testid="refund-payment">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-co-text">{t(`catering.refunds.payment.kind.${p.kind}` as TranslationKey)}</span>
                <span className="tabular-nums text-co-text-muted">{money(p.figures.capturedCents)}</span>
              </div>
              <span className="text-xs text-co-text">{t("catering.refunds.payment.refundable", { amount: money(p.figures.refundableCents) })}</span>
              {p.held === true && <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.payment.held")}</span>}
              {p.verified === false && <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.payment.unverified")}</span>}
              {p.lastVerifiedAt && <span className="text-xs text-co-text-dim">{t("catering.refunds.payment.last_verified", { date: when(p.lastVerifiedAt) })}</span>}
              {(p.returnedCents ?? 0) > 0 && <span className="text-xs text-co-text-muted">{t("catering.refunds.payment.returned", { amount: money(p.returnedCents ?? 0) })}</span>}
              {(p.reservedCents ?? 0) > 0 && <span className="text-xs text-co-text-muted">{t("catering.refunds.payment.reserved", { amount: money(p.reservedCents ?? 0) })}</span>}
              {(p.floorCents ?? 0) > 0 && <span className="text-xs text-co-warning-text">{t("catering.refunds.payment.floor", { amount: money(p.floorCents ?? 0) })}</span>}
              {p.cleanupOwed === true && <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.payment.cleanup_owed")}</span>}
            </div>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-co-border pt-3" data-testid="refund-issues">
          <h4 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("catering.refunds.issues_heading")}</h4>
          {issues.map((issue) => (
            <div key={issue.id} className="flex flex-col gap-1 text-sm" data-testid="refund-issue">
              <span className="font-semibold text-co-text">{t(`catering.refunds.issue.${issue.code}` as TranslationKey)}</span>
              {issue.code === "awaiting_identity" && typeof issue.detail.event_cumulative_cents === "number" && (
                <span className="text-xs text-co-text" data-testid="refund-issue-floor">
                  {t("catering.refunds.issue.floor_detail", {
                    event: issue.eventId ?? "",
                    cumulative: money(issue.detail.event_cumulative_cents),
                    explained: money(typeof issue.detail.explained_cents === "number" ? issue.detail.explained_cents : 0),
                    remainder: money(typeof issue.detail.remainder_cents === "number" ? issue.detail.remainder_cents : issue.detail.event_cumulative_cents),
                  })}
                </span>
              )}
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className={issue.blocking ? "font-semibold text-co-warning-text" : "text-co-text-muted"}>
                  {t(issue.blocking ? "catering.refunds.issue_blocking" : "catering.refunds.issue_not_blocking")}
                </span>
                {issue.state === "held" && <span className="text-co-text-muted">{t("catering.refunds.issue_held")}</span>}
                {issue.aged && <span className="font-semibold text-co-cta-text">{t("catering.refunds.issue_aged")}</span>}
                <span className="text-co-text-dim">{when(issue.openedAt)}</span>
              </span>
              {issue.actions.length > 0 && issue.generation != null && disposing?.issue.id !== issue.id && (
                <div className="flex flex-wrap gap-2">
                  {issue.actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={dispBusy}
                      onClick={() => {
                        setEvidence("");
                        setTarget("");
                        setDisposing({ issue, action });
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50"
                    >
                      {t(`catering.refunds.action.${action}` as TranslationKey)}
                    </button>
                  ))}
                </div>
              )}
              {disposing?.issue.id === issue.id && (
                <div className="flex flex-col gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-3" data-testid="refund-disposition">
                  <span className="text-sm font-bold text-co-text">{t(`catering.refunds.action.${disposing.action}` as TranslationKey)}</span>
                  {needsTarget(disposing.action) && (
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
                      {t("catering.refunds.target_label")}
                      <input
                        aria-label={t("catering.refunds.target_label")}
                        value={target}
                        maxLength={255}
                        onChange={(e) => setTarget(e.target.value)}
                        className="min-h-[44px] w-full max-w-[20rem] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-semibold normal-case tracking-normal text-co-text"
                      />
                      {target.trim() !== "" && !targetOk(disposing.action) && (
                        <span className="text-xs font-semibold normal-case tracking-normal text-co-cta-text">{t("catering.refunds.target_invalid")}</span>
                      )}
                    </label>
                  )}
                  {needsEvidence(disposing.action) && (
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
                      {t("catering.refunds.evidence_label")}
                      <input
                        aria-label={t("catering.refunds.evidence_label")}
                        value={evidence}
                        maxLength={120}
                        onChange={(e) => setEvidence(e.target.value)}
                        className="min-h-[44px] w-full max-w-[20rem] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-semibold normal-case tracking-normal text-co-text"
                      />
                      {evidence.trim() !== "" && !evidenceOk(disposing.action) && (
                        <span className="text-xs font-semibold normal-case tracking-normal text-co-cta-text">{t("catering.refunds.evidence_invalid")}</span>
                      )}
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={dispBusy || !evidenceOk(disposing.action) || !targetOk(disposing.action)}
                      onClick={() => void sendDisposition()}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold text-co-cta-text disabled:opacity-50"
                    >
                      {dispBusy ? t("catering.refunds.working") : t("catering.refunds.disposition_submit")}
                    </button>
                    <button
                      type="button"
                      disabled={dispBusy}
                      onClick={closeDisposition}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-semibold text-co-text disabled:opacity-50"
                    >
                      {t("catering.refunds.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
      {needsReload && !loadFailed && (
        <div>
          <button
            type="button"
            onClick={() => {
              setNeedsReload(false);
              void load();
            }}
            className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text"
          >
            {t("catering.refunds.reload")}
          </button>
        </div>
      )}
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
                  {r.state ? (
                    <span className={`font-semibold ${STATE_TONE[r.state]}`} data-testid="refund-state">{t(`catering.refunds.state.${r.state}` as TranslationKey)}</span>
                  ) : (
                    <span className={`font-semibold ${statusTone[r.status] ?? "text-co-text"}`}>{t(`catering.refunds.status.${r.status}` as TranslationKey)}</span>
                  )}
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
              {r.state === "submission_unconfirmed" && (
                <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.state.submission_unconfirmed_detail")}</span>
              )}
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
                      onClick={() => {
                        setReleaseChecked(false);
                        setReleasing(r.id);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold text-co-cta-text disabled:opacity-50"
                    >
                      {t("catering.refunds.release")}
                    </button>
                  ) : (
                    <span className="flex flex-col gap-2">
                      <span className="text-xs text-co-text">{t("catering.refunds.release_confirm")}</span>
                      <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-co-text">
                        <input
                          type="checkbox"
                          aria-label={t("catering.refunds.release_staff_verified")}
                          checked={releaseChecked}
                          onChange={(e) => setReleaseChecked(e.target.checked)}
                          className="h-5 w-5"
                        />
                        {t("catering.refunds.release_staff_verified")}
                      </label>
                      <span className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={rowBusy !== null || !releaseChecked}
                          onClick={() => void retry(r.id, true)}
                          className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold text-co-cta-text disabled:opacity-50"
                        >
                          {t("catering.refunds.release_yes")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReleasing(null);
                            setReleaseChecked(false);
                          }}
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
          if (stepUpFor === "disposition") await sendDisposition();
          else await send();
        }}
        onCancel={() => setStepUpOpen(false)}
      />
    </div>
  );
}
