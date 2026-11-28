"use client";

/**
 * RefundPanel — the in-app refund step for a catering order (Part B1 v2: migration 0359, lib/catering/refunds.ts).
 * Rendered ONLY when the server switch CATERING_REFUNDS is on (the page passes it down); off = this component never
 * mounts and makes no request.
 *
 * Stripe is the truth, kept as a mirror (plan 4.3 + section 15). Every figure here is the SERVER's (F7 through
 * `refundSummaryFromRpc`); this component computes no refundable amount. A payment shows figures only when it is
 * `known`; `never_read` / `dirty` / `paused` show NO figure at all (not 0, not a dash): a line saying why, and (refund
 * roles, not paused) "Check Stripe now". The Refund form is offered only when `refundFormOffered` says so, and its
 * ONE confirm sends `seenRefundableCents` = the total it showed. After a press every row says what happened to it.
 *
 * TIER B, AND NOTHING IN BETWEEN (plan 4.1, lib/session.ts): the password unlock is cleared by any other route. So from
 * the first POST of a Tier B action (refund, release, attach) until its answer after the password, the action is HELD
 * (`held`), and while it is held this panel makes no other request by construction: `load` and `check` return at once
 * (they read the ref, never a stale closure), and every other control is disabled. There is no background refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import {
  REFUND_ERROR_CODES,
  REFUND_REASON_CODES,
  refundDollarsToCents,
  refundFormOffered,
  refundIdempotencyKey,
  type RefundAccountSlot,
  type RefundFinding,
  type RefundPaymentView,
  type RefundReasonCode,
  type RefundRequestView,
  type RefundStripeRefundView,
  type RefundSummary,
  type RefundTrigger,
} from "@/lib/catering/refunds-shared";
// Type-only: erased at build, so the server module never reaches the client bundle.
import type { RefundPressResult, RefundRowOutcome } from "@/lib/catering/refunds";
import { isStepUpCode } from "./shared";

const DEFAULT_REASON: Record<RefundTrigger, RefundReasonCode> = {
  panel: "customer_cancelled",
  declined: "quote_declined",
  lost: "event_lost",
};

/** The findings, in the order the person reads them. NOTHING is pre-selected. */
const FINDINGS: readonly RefundFinding[] = ["request_succeeded", "no_request", "request_failed", "unclear"];
const SLOTS: readonly RefundAccountSlot[] = ["location", "default"];
const STRIPE_STATUSES = ["pending", "succeeded", "failed", "canceled", "requires_action"] as const;
/** A 409 that re-draws the figures from the summary in the error body (plan 3.4 step 4). */
const REDRAW_CODES = new Set(["figures_changed", "stripe_unchecked", "figures_stale", "over_refundable", "nothing_refundable", "token_reused"]);

function errorKey(code: string): TranslationKey {
  return ((REFUND_ERROR_CODES as readonly string[]).includes(code) ? `catering.refunds.error.${code}` : "catering.refunds.error.generic") as TranslationKey;
}

function newToken(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));
}

function isSummary(v: unknown): v is RefundSummary {
  return !!v && typeof v === "object" && Array.isArray((v as { payments?: unknown }).payments) && Array.isArray((v as { requests?: unknown }).requests);
}

type Answer = { ok: boolean; code: string; data: Record<string, unknown> };

/** One POST; the whole body is kept on an error too (the 409s carry a fresh summary). Never throws. */
async function post(url: string, body: unknown): Promise<Answer> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = await res.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      /* no body */
    }
    if (res.ok) return { ok: true, code: "", data };
    return { ok: false, code: typeof data.code === "string" ? data.code : "generic", data };
  } catch {
    return { ok: false, code: "generic", data: {} };
  }
}

/** A Tier B action, held from its first POST until its answer after the password. */
type TierB =
  | { kind: "refund"; url: string; body: Record<string, unknown> }
  | { kind: "release"; requestId: string; url: string; body: Record<string, unknown> }
  | { kind: "attach"; requestId: string; url: string; body: Record<string, unknown> };

interface ResolveState {
  finding: RefundFinding | null;
  refundId: string | null;
  slot: RefundAccountSlot | null;
  live: boolean | null;
  note: string;
}
const EMPTY_RESOLVE: ResolveState = { finding: null, refundId: null, slot: null, live: null, note: "" };

const BTN_PRIMARY = "inline-flex min-h-[48px] items-center justify-center rounded-xl bg-co-text px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-co-cta shadow-sm transition hover:bg-co-text/90 disabled:opacity-50";
const BTN_DANGER = "inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-cta-text bg-co-surface px-5 py-2.5 text-sm font-bold text-co-cta-text disabled:opacity-50";
const BTN_SECONDARY = "inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-border-2 bg-co-surface px-5 py-2.5 text-sm font-semibold text-co-text transition hover:border-co-text disabled:opacity-50";
const BTN_SMALL = "inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50";
const FIELD_LABEL = "flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
const RADIO_ROW = "flex min-h-[44px] items-center gap-2 text-sm text-co-text";

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
  const when = (iso: string) => `${formatDateLabel(etCalendarDate(iso), language)} ${formatTime(iso, language)}`;

  const [summary, setSummary] = useState<RefundSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState<RefundReasonCode | null>(null);
  const [note, setNote] = useState("");
  /** The confirm step: the amount and the refundable total it SHOWED (sent as `seenRefundableCents`). */
  const [review, setReview] = useState<{ amountCents: number; seenCents: number } | null>(null);
  const [token, setToken] = useState<string>(() => newToken());
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [held, setHeld] = useState<TierB | null>(null);
  const heldRef = useRef<TierB | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<TranslationKey | null>(null);
  const [press, setPress] = useState<RefundPressResult | null>(null);
  const [resolve, setResolve] = useState<Record<string, ResolveState>>({});
  /** Requests the server answered `credential_changed` for [T5]: no form any more, the CC line. */
  const [credentialChanged, setCredentialChanged] = useState<ReadonlySet<string>>(() => new Set());

  const hold = (a: TierB | null) => {
    heldRef.current = a;
    setHeld(a);
  };

  const load = useCallback(async () => {
    // Nothing between a password unlock and the action it was typed for.
    if (heldRef.current) return;
    try {
      const r = await fetch(`/api/catering/quotes/${quoteId}/refunds`, { redirect: "manual" });
      if (!r.ok) {
        setLoadFailed(true);
        return;
      }
      const body = (await r.json()) as { summary?: unknown };
      if (!isSummary(body.summary)) {
        setLoadFailed(true);
        return;
      }
      setSummary(body.summary);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [quoteId]);

  // The first read, in the subscribe-then-set shape (state is set only in the promise callbacks). Nothing is held yet.
  useEffect(() => {
    let alive = true;
    void fetch(`/api/catering/quotes/${quoteId}/refunds`, { redirect: "manual" })
      .then((r) => (r.ok ? (r.json() as Promise<{ summary?: unknown }>) : null))
      .then((body) => {
        if (!alive) return;
        const ok = !!body && isSummary(body.summary);
        if (ok) setSummary(body.summary as RefundSummary);
        setLoadFailed(!ok);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [quoteId]);

  // "Check Stripe now": GETs only at Stripe, never sends; no step-up. Never while a Tier B action is held.
  const check = async () => {
    if (heldRef.current || checking) return;
    setChecking(true);
    setError(null);
    setNotice(null);
    const res = await post(`/api/catering/quotes/${quoteId}/refunds/check`, {});
    setChecking(false);
    if (isSummary(res.data.summary)) setSummary(res.data.summary);
    if (res.ok) setNotice("catering.refunds.payment.check_done");
    else setError(res.code);
  };

  const closeForm = () => {
    setFormOpen(false);
    setReview(null);
    setMode("full");
    setAmountText("");
    setReason(null);
    setNote("");
    setToken(newToken());
    onTriggerHandled();
  };

  /** Send a Tier B action; on `step_up_required` / `step_up_stale` it stays HELD and the password modal opens. */
  const runTierB = async (a: TierB) => {
    hold(a);
    setBusy(true);
    setError(null);
    setNotice(null);
    if (a.kind === "refund") setPress(null);
    const res = await post(a.url, a.body);
    setBusy(false);
    if (!res.ok && isStepUpCode(res.code)) {
      setStepUpOpen(true);
      return;
    }
    setStepUpOpen(false);
    hold(null);
    const fresh = isSummary(res.data.summary) ? res.data.summary : null;
    if (fresh) setSummary(fresh);
    if (a.kind === "refund") {
      if (res.ok) {
        const result = res.data.result as RefundPressResult | undefined;
        setPress(result && (result.kind === "replay" || result.kind === "pressed") ? result : null);
        closeForm();
        if (!fresh) void load();
        onChanged();
        return;
      }
      setError(res.code);
      if (REDRAW_CODES.has(res.code)) {
        setReview(null);
        setToken(newToken());
        if (!fresh) void load();
      }
      return;
    }
    if (res.ok) {
      setNotice(a.kind === "attach" ? "catering.refunds.resolve.done.attached" : "catering.refunds.resolve.done.released");
      setResolve((m) => {
        const next = { ...m };
        delete next[a.requestId];
        return next;
      });
      if (!fresh) void load();
      onChanged();
      return;
    }
    setError(res.code);
    if (res.code === "credential_changed") setCredentialChanged((s) => new Set([...s, a.requestId]));
  };

  // A failed read is NOT "nothing to refund": say so, keep a way to try again.
  if (loadFailed && !summary) {
    return (
      <div className="co-card flex flex-col gap-2 p-4" data-testid="refund-panel-unavailable" role="status">
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.refunds.heading")}</h3>
        <p className="text-sm font-semibold text-co-warning-text">{t("catering.refunds.unavailable")}</p>
        <div>
          <button type="button" onClick={() => void load()} className={BTN_SMALL}>
            {t("catering.refunds.try_again")}
          </button>
        </div>
      </div>
    );
  }
  if (!summary) return null;
  const { totals } = summary;
  // Nothing taken through Stripe, nothing by hand, no request: there is no refund story to tell.
  if (summary.eligiblePayments === 0 && totals.outsideAppCents === 0 && summary.requests.length === 0) return null;

  const locked = held !== null || busy || checking;
  const offered = refundFormOffered(summary);
  const total = offered ? (summary.refundableTotalCents as number) : 0;
  const trigger: RefundTrigger = openTrigger ?? "panel";
  const showForm = offered && (formOpen || openTrigger !== null);
  const chosenReason = reason ?? DEFAULT_REASON[trigger];
  const partialCents = mode === "partial" ? refundDollarsToCents(amountText) : null;
  const amountCents = mode === "full" ? total : partialCents;
  const amountOk = amountCents !== null && amountCents > 0 && amountCents <= total;
  const noteOk = chosenReason !== "other" || note.trim().length > 0;
  const genMs = summary.generatedAt ? Date.parse(summary.generatedAt) : NaN;

  const confirmRefund = () => {
    if (!review || locked) return;
    void runTierB({
      kind: "refund",
      url: `/api/catering/quotes/${quoteId}/refunds`,
      body: {
        clientToken: token,
        // The number on the confirm button, "Full" included: the server refunds exactly what was confirmed.
        amountCents: review.amountCents,
        // The refundable total this confirm SHOWED [DR6]: the reserve refuses `figures_changed` otherwise.
        seenRefundableCents: review.seenCents,
        reasonCode: chosenReason,
        reasonNote: note.trim() || null,
        trigger,
      },
    });
  };

  const setResolveFor = (id: string, patch: Partial<ResolveState>) =>
    setResolve((m) => ({ ...m, [id]: { ...(m[id] ?? EMPTY_RESOLVE), ...patch } }));

  const stripeStatus = (s: string | null) =>
    t(`catering.refunds.stripe_status.${(STRIPE_STATUSES as readonly string[]).includes(s ?? "") ? s : "unknown"}` as TranslationKey);

  const outcomeText = (row: RefundRowOutcome): string => {
    const amount = money(row.amountCents);
    const cause = t(`catering.refunds.cause.${row.cause ?? "unknown"}` as TranslationKey);
    switch (row.outcome) {
      case "created":
        return t("catering.refunds.outcome.created", { amount, refund: row.stripeRefundId ?? "" });
      case "never_sent":
        return t("catering.refunds.outcome.never_sent", { amount, cause });
      case "armed_unsent":
        return t("catering.refunds.outcome.armed_unsent", { amount, cause });
      default:
        return t(`catering.refunds.outcome.${row.outcome}` as TranslationKey, { amount });
    }
  };

  const refundLine = (p: RefundPaymentView, f: RefundStripeRefundView) =>
    p.known
      ? t("catering.refunds.refund.line", { refund: f.refundId, amount: money(f.amountCents), status: stripeStatus(f.status), date: f.createdAt ? when(f.createdAt) : "" })
      : t("catering.refunds.refund.line_no_amount", { refund: f.refundId, status: stripeStatus(f.status), date: f.createdAt ? when(f.createdAt) : "" });

  const renderResolve = (p: RefundPaymentView, r: RefundRequestView) => {
    const slot = r.armAccountSlot;
    const live = r.armLivemode;
    if (r.legacy || credentialChanged.has(r.id) || slot === null || live === null) {
      return (
        <p className="text-xs font-semibold text-co-cta-text" data-testid="refund-resolve-legacy">
          {t("catering.refunds.resolve.legacy")}
        </p>
      );
    }
    const st = resolve[r.id] ?? EMPTY_RESOLVE;
    const attachable = p.refunds.filter((f) => f.attachableTo === r.id);
    const relMs = r.releasableAt ? Date.parse(r.releasableAt) : NaN;
    const releasable = Number.isFinite(genMs) && Number.isFinite(relMs) && genMs >= relMs;
    return (
      <div className="flex flex-col gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-3" data-testid="refund-resolve">
        <h5 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("catering.refunds.resolve.heading")}</h5>
        <p className="text-sm text-co-text" data-testid="refund-resolve-where">
          {t("catering.refunds.resolve.where", {
            pi: p.paymentIntentId ?? "",
            account: t(`catering.refunds.resolve.account.${slot}` as TranslationKey),
            mode: t(live ? "catering.refunds.resolve.mode.live" : "catering.refunds.resolve.mode.test"),
          })}
        </p>
        {p.credentialFp && <p className="text-[11px] text-co-text-dim">{t("catering.refunds.resolve.fingerprint", { fp: p.credentialFp })}</p>}
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm text-co-text">{t("catering.refunds.resolve.question", { key: refundIdempotencyKey(r.id) })}</legend>
          {FINDINGS.map((f) => (
            <label key={f} className={RADIO_ROW}>
              <input
                type="radio"
                name={`refund-finding-${r.id}`}
                aria-label={t(`catering.refunds.resolve.finding.${f}` as TranslationKey)}
                checked={st.finding === f}
                disabled={locked}
                onChange={() => setResolveFor(r.id, { finding: f, refundId: null, slot: null, live: null })}
                className="h-5 w-5"
              />
              {t(`catering.refunds.resolve.finding.${f}` as TranslationKey)}
            </label>
          ))}
        </fieldset>

        {st.finding === "unclear" && <p className="text-sm font-semibold text-co-cta-text" data-testid="refund-resolve-unclear">{t("catering.refunds.resolve.unclear")}</p>}

        {st.finding === "request_succeeded" && attachable.length === 0 && (
          <div className="flex flex-col gap-2" data-testid="refund-attach-none">
            <p className="text-sm font-semibold text-co-cta-text">{t("catering.refunds.resolve.attach_none")}</p>
            {summary.canRefund && (
              <div>
                <button type="button" disabled={locked} onClick={() => void check()} className={BTN_SMALL}>
                  {checking ? t("catering.refunds.working") : t("catering.refunds.payment.check_now")}
                </button>
              </div>
            )}
          </div>
        )}

        {st.finding === "request_succeeded" && attachable.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="refund-attach">
            <fieldset className="flex flex-col gap-1">
              <legend className={FIELD_LABEL}>{t("catering.refunds.resolve.attach_pick")}</legend>
              {attachable.map((f) => (
                <label key={f.refundId} className={RADIO_ROW}>
                  <input type="radio" name={`refund-attach-${r.id}`} aria-label={t("catering.refunds.refund.line", { refund: f.refundId, amount: money(f.amountCents), status: stripeStatus(f.status), date: f.createdAt ? when(f.createdAt) : "" })}checked={st.refundId === f.refundId} disabled={locked} onChange={() => setResolveFor(r.id, { refundId: f.refundId })} className="h-5 w-5" />
                  {t("catering.refunds.refund.line", { refund: f.refundId, amount: money(f.amountCents), status: stripeStatus(f.status), date: f.createdAt ? when(f.createdAt) : "" })}
                </label>
              ))}
            </fieldset>
            <label className={FIELD_LABEL}>
              {t("catering.refunds.note_label")}
              <textarea aria-label={t("catering.refunds.note_label")} value={st.note} maxLength={500} rows={2} disabled={locked} onChange={(e) => setResolveFor(r.id, { note: e.target.value })} className="w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm normal-case tracking-normal text-co-text" />
            </label>
            <div>
              <button
                type="button"
                disabled={locked || st.refundId === null}
                onClick={() => {
                  if (st.refundId === null) return;
                  void runTierB({ kind: "attach", requestId: r.id, url: `/api/catering/quotes/${quoteId}/refunds/${r.id}/attach`, body: { refundId: st.refundId, note: st.note.trim() || null } });
                }}
                className={BTN_PRIMARY}
              >
                {t("catering.refunds.resolve.attach_button")}
              </button>
            </div>
          </div>
        )}

        {(st.finding === "no_request" || st.finding === "request_failed") && !releasable && (
          <p className="text-sm text-co-text" data-testid="refund-release-wait">
            {t("catering.refunds.resolve.release_wait", { releasableAt: r.releasableAt ? when(r.releasableAt) : "" })}
          </p>
        )}

        {(st.finding === "no_request" || st.finding === "request_failed") && releasable && (
          <div className="flex flex-col gap-2" data-testid="refund-release">
            <fieldset className="flex flex-col gap-1">
              <legend className={FIELD_LABEL}>{t("catering.refunds.resolve.account_question")}</legend>
              {SLOTS.map((s) => (
                <label key={s} className={RADIO_ROW}>
                  <input type="radio" name={`refund-slot-${r.id}`} aria-label={t(`catering.refunds.resolve.account_option.${s}` as TranslationKey)} checked={st.slot === s} disabled={locked} onChange={() => setResolveFor(r.id, { slot: s })} className="h-5 w-5" />
                  {t(`catering.refunds.resolve.account_option.${s}` as TranslationKey)}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1">
              <legend className={FIELD_LABEL}>{t("catering.refunds.resolve.mode_question")}</legend>
              {([true, false] as const).map((m) => (
                <label key={String(m)} className={RADIO_ROW}>
                  <input type="radio" name={`refund-mode-read-${r.id}`} aria-label={t(m ? "catering.refunds.resolve.mode_option.live" : "catering.refunds.resolve.mode_option.test")} checked={st.live === m} disabled={locked} onChange={() => setResolveFor(r.id, { live: m })} className="h-5 w-5" />
                  {t(m ? "catering.refunds.resolve.mode_option.live" : "catering.refunds.resolve.mode_option.test")}
                </label>
              ))}
            </fieldset>
            <label className={FIELD_LABEL}>
              {t("catering.refunds.note_label")}
              <textarea aria-label={t("catering.refunds.note_label")} value={st.note} maxLength={500} rows={2} disabled={locked} onChange={(e) => setResolveFor(r.id, { note: e.target.value })} className="w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm normal-case tracking-normal text-co-text" />
            </label>
            <p className="text-xs text-co-text">{t("catering.refunds.resolve.release_body")}</p>
            <div>
              <button
                type="button"
                disabled={locked || st.slot === null || st.live === null}
                onClick={() => {
                  if (st.slot === null || st.live === null) return;
                  void runTierB({
                    kind: "release",
                    requestId: r.id,
                    url: `/api/catering/quotes/${quoteId}/refunds/${r.id}/release`,
                    body: { finding: st.finding, accountSlot: st.slot, livemode: st.live, note: st.note.trim() || null },
                  });
                }}
                className={BTN_DANGER}
              >
                {t("catering.refunds.resolve.release_button")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRequest = (p: RefundPaymentView, r: RefundRequestView) => {
    const bound = r.view === "bound" ? p.refunds.find((f) => f.refundId === r.stripeRefundId) ?? null : null;
    return (
      <div key={r.id} className="flex flex-col gap-1 text-sm" data-testid="refund-row" data-view={r.view}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 text-co-text">{t(`catering.refunds.reason.${r.reasonCode}` as TranslationKey)}</span>
          <span className="tabular-nums text-co-text-muted">{money(r.amountCents)}</span>
        </div>
        <span className="text-xs text-co-text-dim">
          {t("catering.refunds.by", { name: r.requestedByName ?? t("catering.refunds.someone"), date: r.requestedAt ? when(r.requestedAt) : "" })}
        </span>
        {r.view === "reserved" && <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.view.reserved")}</span>}
        {r.view === "unconfirmed" && (
          <span className="text-xs font-semibold text-co-warning-text" data-testid="refund-row-unconfirmed">
            {t("catering.refunds.view.unconfirmed", { releasableAt: r.releasableAt ? when(r.releasableAt) : "" })}
          </span>
        )}
        {r.view === "bound" && (
          <span className="text-xs text-co-text">
            {t("catering.refunds.view.bound", { refund: r.stripeRefundId ?? "", status: stripeStatus(bound?.status ?? null) })}
            {r.resolvedBy && r.resolvedAt && ` ${t("catering.refunds.view.attached_by", { name: r.resolvedByName ?? t("catering.refunds.someone"), date: when(r.resolvedAt) })}`}
          </span>
        )}
        {r.view === "released" && (
          <span className="text-xs text-co-text">
            {t("catering.refunds.view.released", { name: r.resolvedByName ?? t("catering.refunds.someone"), date: r.resolvedAt ? when(r.resolvedAt) : "" })}
          </span>
        )}
        {r.view === "never_sent" && <span className="text-xs text-co-text-muted">{t("catering.refunds.view.never_sent")}</span>}
        {r.view === "closed" && <span className="text-xs text-co-text-muted">{t("catering.refunds.view.closed")}</span>}
        {r.view === "unconfirmed" && summary.canRelease && renderResolve(p, r)}
      </div>
    );
  };

  const renderPayment = (p: RefundPaymentView) => {
    const others = p.refunds.filter((f) => f.claimKind !== "bound");
    return (
      <div key={p.id} className="flex flex-col gap-2 border-t border-co-border pt-3" data-testid="refund-payment" data-state={p.state}>
        <h4 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t(`catering.refunds.payment.kind.${p.kind}` as TranslationKey)}</h4>
        {p.known ? (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-co-text-muted">{t("catering.refunds.figure.captured")}</dt>
              <dd className="text-right tabular-nums text-co-text">{p.capturedCents !== null ? money(p.capturedCents) : null}</dd>
              <dt className="text-co-text-muted">{t("catering.refunds.figure.counted")}</dt>
              <dd className="text-right tabular-nums text-co-text">{p.countedCents !== null ? money(p.countedCents) : null}</dd>
              {p.inFlightCents !== null && p.inFlightCents > 0 && (
                <>
                  <dt className="text-co-text-muted">{t("catering.refunds.figure.in_flight")}</dt>
                  <dd className="text-right tabular-nums text-co-warning-text">{money(p.inFlightCents)}</dd>
                </>
              )}
              <dt className="font-semibold text-co-text">{t("catering.refunds.figure.refundable")}</dt>
              <dd className="text-right font-semibold tabular-nums text-co-text">{p.refundableCents !== null ? money(p.refundableCents) : null}</dd>
            </dl>
            {p.checkedAt && <p className="text-[11px] text-co-text-dim">{t("catering.refunds.figure.checked", { when: when(p.checkedAt) })}</p>}
          </>
        ) : p.state === "paused" ? (
          <p className="text-sm font-semibold text-co-warning-text" role="status">{t("catering.refunds.payment.paused")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-co-warning-text" role="status">{t("catering.refunds.payment.checking")}</p>
            {summary.canRefund && (
              <div>
                <button type="button" disabled={locked} onClick={() => void check()} className={BTN_SMALL} data-testid="refund-check-now">
                  {checking ? t("catering.refunds.working") : t("catering.refunds.payment.check_now")}
                </button>
              </div>
            )}
          </div>
        )}
        {p.blocked && <p className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.payment.blocked")}</p>}
        {p.disagrees && <p className="text-xs font-semibold text-co-cta-text">{t("catering.refunds.payment.disagrees")}</p>}
        {others.length > 0 && (
          <div className="flex flex-col gap-1">
            <h5 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("catering.refunds.refunds.heading")}</h5>
            {others.map((f) => (
              <div key={f.refundId} className="flex flex-col text-xs" data-testid="refund-stripe-refund" data-kind={f.claimKind}>
                <span className="text-co-text">{refundLine(p, f)}</span>
                {f.claimKind === "none" ? (
                  <span className="text-co-text-muted">{t("catering.refunds.refund.outside")}</span>
                ) : (
                  <span className="font-semibold text-co-cta-text">{t(`catering.refunds.refund.warning.${f.claimKind}` as TranslationKey)}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {p.requests.length > 0 && (
          <div className="flex flex-col gap-2">
            <h5 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("catering.refunds.history")}</h5>
            {p.requests.map((r) => renderRequest(p, r))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="co-card flex flex-col gap-3 p-4" data-testid="refund-panel">
      <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.refunds.heading")}</h3>

      {summary.eligiblePayments > 0 &&
        (summary.allKnown && summary.refundableTotalCents !== null ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" data-testid="refund-totals">
            <dt className="font-semibold text-co-text">
              {t("catering.refunds.totals.heading")} · {t("catering.refunds.figure.refundable")}
            </dt>
            <dd className="text-right font-semibold tabular-nums text-co-text">{money(summary.refundableTotalCents)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-co-text-muted" role="status">{t("catering.refunds.totals.not_known")}</p>
        ))}
      {totals.outsideAppCents > 0 && <p className="text-xs text-co-text-muted">{t("catering.refunds.outside_app", { amount: money(totals.outsideAppCents) })}</p>}

      {openTrigger === "declined" && offered && !formOpen && <p className="text-sm font-semibold text-co-text">{t("catering.refunds.prompt.declined", { amount: money(total) })}</p>}
      {openTrigger === "lost" && offered && !formOpen && <p className="text-sm font-semibold text-co-text">{t("catering.refunds.prompt.lost", { amount: money(total) })}</p>}

      {offered && !showForm && (
        <div>
          <button type="button" disabled={locked} onClick={() => setFormOpen(true)} className={BTN_DANGER}>
            {t("catering.refunds.start")}
          </button>
        </div>
      )}

      {showForm && !review && (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-co-border bg-co-surface-inset p-3" data-testid="refund-form">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catering.refunds.how_much")}</legend>
            <label className={RADIO_ROW}>
              <input type="radio" name={`refund-mode-${quoteId}`} aria-label={t("catering.refunds.choice.full", { amount: money(total) })} checked={mode === "full"} onChange={() => setMode("full")} className="h-5 w-5" />
              {t("catering.refunds.choice.full", { amount: money(total) })}
            </label>
            <label className={RADIO_ROW}>
              <input type="radio" name={`refund-mode-${quoteId}`} aria-label={t("catering.refunds.choice.partial")} checked={mode === "partial"} onChange={() => setMode("partial")} className="h-5 w-5" />
              {t("catering.refunds.choice.partial")}
            </label>
            {mode === "partial" && (
              <label className={FIELD_LABEL}>
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
                  <span className="text-xs font-semibold normal-case tracking-normal text-co-cta-text">{t("catering.refunds.amount_invalid", { max: money(total) })}</span>
                )}
              </label>
            )}
          </fieldset>
          <label className={FIELD_LABEL}>
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
          <label className={FIELD_LABEL}>
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
              disabled={!amountOk || !noteOk || locked}
              onClick={() => amountCents !== null && setReview({ amountCents, seenCents: total })}
              className={BTN_PRIMARY}
            >
              {t("catering.refunds.review")}
            </button>
            <button type="button" disabled={locked} onClick={closeForm} className={BTN_SECONDARY}>
              {t("catering.refunds.cancel")}
            </button>
          </div>
        </div>
      )}

      {showForm && review && (
        <div role="group" data-testid="refund-confirm" className="flex flex-col gap-2 rounded-lg border-2 border-co-cta-text bg-co-surface p-3">
          <p className="text-sm font-bold text-co-text">{t("catering.refunds.confirm_title", { amount: money(review.amountCents) })}</p>
          <p className="text-xs text-co-text-muted">
            {t(`catering.refunds.reason.${chosenReason}` as TranslationKey)}
            {note.trim() ? ` · ${note.trim()}` : ""}
          </p>
          <p className="text-xs text-co-text">{t("catering.refunds.confirm_body")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={locked} onClick={confirmRefund} className={BTN_DANGER}>
              {busy ? t("catering.refunds.working") : t("catering.refunds.confirm_button", { amount: money(review.amountCents) })}
            </button>
            <button type="button" disabled={locked} onClick={() => setReview(null)} className={BTN_SECONDARY}>
              {t("catering.refunds.back")}
            </button>
          </div>
        </div>
      )}

      {press && (
        <div className="flex flex-col gap-1 rounded-lg border-2 border-co-border bg-co-surface-inset p-3" data-testid="refund-press" role="status">
          <h4 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("catering.refunds.press.heading")}</h4>
          {press.kind === "replay" ? (
            <p className="text-sm text-co-text">{t("catering.refunds.press.replay")}</p>
          ) : (
            press.rows.map((row) => (
              <p
                key={row.requestId}
                data-testid="refund-press-row"
                data-outcome={row.outcome}
                className={`text-sm font-semibold ${row.outcome === "created" ? "text-co-confirm-text" : "text-co-warning-text"}`}
              >
                {outcomeText(row)}
              </p>
            ))
          )}
        </div>
      )}

      {notice && <p className="rounded-lg border-2 border-co-success/40 bg-co-success/10 px-3 py-2 text-sm font-semibold text-co-confirm-text">{t(notice)}</p>}
      {error && (
        <p className="text-sm font-semibold text-co-cta-text" role="alert" data-testid="refund-error" data-code={error}>
          {t(errorKey(error))}
        </p>
      )}
      {loadFailed && (
        <div className="flex flex-wrap items-center gap-2" role="status" data-testid="refund-panel-stale">
          <span className="text-xs font-semibold text-co-warning-text">{t("catering.refunds.unavailable")}</span>
          <button type="button" disabled={locked} onClick={() => void load()} className={BTN_SMALL}>
            {t("catering.refunds.try_again")}
          </button>
        </div>
      )}

      {summary.payments.filter((p) => p.eligible).map(renderPayment)}

      <PasswordModal
        open={stepUpOpen}
        onConfirm={async () => {
          const a = heldRef.current;
          if (a) await runTierB(a);
        }}
        onCancel={() => {
          setStepUpOpen(false);
          hold(null);
        }}
      />
    </div>
  );
}
