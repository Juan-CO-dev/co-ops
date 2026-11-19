"use client";

/**
 * Item 21 PR 3 — a house catering order's Toast checks: what is linked, what could be, and the decisions (link, unlink,
 * not a match, no Toast ring expected). Shown only when the server returns a panel (the shop is on, 0347 is applied,
 * and this is a booked house order). Decision controls only for the catering manager and GM and up (Juan answer 8);
 * everyone else reads it. Every POST names the head the person saw, so a decision someone else made in the meantime is
 * refused ("decision_moved") instead of overwritten. After any answer the panel reloads and the page refreshes, so a
 * linked order leaves the "Not in Toast yet" list.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  candidateActions, decisionErrorKey, TOAST_NO_RING_REASONS,
  type HouseToastPanel as Panel, type ToastCandidate, type ToastDecisionKind, type ToastNoRingReason,
} from "@/lib/catering/catering-toast-links-shared";

type Body = { kind: ToastDecisionKind; locationId?: string; orderGuid?: string; checkGuid?: string; reasonCode?: ToastNoRingReason; expectedHeadId: string | null };

const BUTTON = "inline-flex min-h-[44px] items-center rounded-lg border px-3 text-xs font-bold tracking-[0.1em]";
const PRIMARY = `${BUTTON} border-co-gold-deep bg-co-surface text-co-text`;
const QUIET = `${BUTTON} border-co-border bg-co-surface text-co-text-muted`;

/** `initial` seeds the first render (tests / server render); the panel still reloads from the route on mount. */
export function HouseToastPanel({ leadId, startOpen = false, initial }: { leadId: string; startOpen?: boolean; initial?: Panel | null }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const bodyId = useId();
  const [open, setOpen] = useState(startOpen);
  const [state, setState] = useState<{ leadId: string; panel: Panel | null; failed: boolean } | null>(
    initial === undefined ? null : { leadId, panel: initial, failed: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [noRing, setNoRing] = useState<ToastNoRingReason | "">("");
  const [askNoRing, setAskNoRing] = useState(false);

  const load = useCallback((signal?: AbortSignal) => fetch(`/api/catering/pipeline/${leadId}/toast-links`, { signal, redirect: "error" })
    .then(async (r) => { if (!r.ok) throw new Error("unavailable"); return (await r.json()) as { panel: Panel | null }; })
    .then((r) => setState({ leadId, panel: r.panel, failed: false }))
    .catch(() => { if (!signal?.aborted) setState({ leadId, panel: null, failed: true }); }), [leadId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const current = state?.leadId === leadId ? state : null;
  if (!current) return null;
  if (current.failed) return <p role="status" className="mt-3 text-xs text-co-warning-text">{t("catering.toast_link.unavailable")}</p>;
  const panel = current.panel;
  if (!panel) return null;

  async function decide(body: Body) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/catering/pipeline/${leadId}/toast-links`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error",
      });
      if (!res.ok) {
        const code = ((await res.json().catch(() => ({}))) as { code?: string }).code ?? "generic";
        setMessage(t(decisionErrorKey(code) as TranslationKey));
      }
    } catch {
      setMessage(t("catering.toast_link.error.generic"));
    } finally {
      setConfirmUnlink(null);
      setAskNoRing(false);
      setNoRing("");
      await load();
      router.refresh();
      setBusy(false);
    }
  }

  const money = (cents: number | null) => (cents === null ? t("catering.toast_pending.amount_unknown") : formatCents(cents, language));
  const pairBody = (kind: ToastDecisionKind, c: { orderGuid: string; checkGuid: string; headId: string | null }, locationId = panel.locationId): Body =>
    ({ kind, locationId, orderGuid: c.orderGuid, checkGuid: c.checkGuid, expectedHeadId: c.headId });
  const evidence = (e: string) => t(`${e === "manual" ? "catering.toast_link.evidence" : "catering.toast_pending.evidence"}.${e}` as TranslationKey);

  return <section className="mt-3 border-t border-co-border pt-2" aria-busy={busy}>
    <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-sm font-bold text-co-text"
      aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
      <span>{t("catering.toast_link.title")}</span>
      <span className={panel.status === "not_rung_in_toast" || panel.status === "amount_mismatch" ? "text-xs text-co-warning-text" : "text-xs text-co-text-muted"}>
        {t(`catering.toast_link.status.${panel.status}` as TranslationKey)}
      </span>
    </button>
    <div id={bodyId} hidden={!open} className="space-y-3 text-xs text-co-text-muted">
      {!panel.canDecide && <p>{t("catering.toast_link.view_only")}</p>}
      {message && <p role="alert" className="text-co-cta-text">{message}</p>}
      {busy && <p role="status">{t("catering.toast_link.saving")}</p>}

      {panel.leadHead?.kind === "no_ring_expected" && <div className="space-y-2">
        <p>{t("catering.toast_link.no_ring_marked", { reason: t(`catering.toast_link.reason.${panel.leadHead.reasonCode ?? "other"}` as TranslationKey) })}</p>
        {panel.canDecide && <button type="button" className={QUIET} disabled={busy}
          onClick={() => void decide({ kind: "ring_expected", expectedHeadId: panel.leadHead!.id })}>{t("catering.toast_link.action.ring_expected")}</button>}
      </div>}

      {panel.links.length > 0 && <div>
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("catering.toast_link.linked_heading")}</h4>
        <ul className="mt-1 space-y-2">{panel.links.map((l) => {
          const key = `${l.orderGuid}|${l.checkGuid}`;
          return <li key={key} className="space-y-1">
            <p className="text-co-text">{t("catering.toast_link.check_line", {
              amount: money(l.totalCents), date: l.businessDate ? formatDateLabel(l.businessDate, language) : "—", evidence: evidence(l.evidence),
            })}</p>
            {!l.live && <p className="text-co-warning-text">{t("catering.toast_link.check_gone")}</p>}
            {panel.canDecide && (confirmUnlink === key
              ? <div className="space-y-2">
                <p>{t("catering.toast_link.confirm_unlink")}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => void decide(pairBody("unlink", l, l.locationId))}>{t("catering.toast_link.action.confirm")}</button>
                  <button type="button" className={QUIET} disabled={busy} onClick={() => setConfirmUnlink(null)}>{t("catering.toast_link.action.cancel")}</button>
                </div>
              </div>
              : <button type="button" className={QUIET} disabled={busy} onClick={() => setConfirmUnlink(key)}>{t("catering.toast_link.action.unlink")}</button>)}
          </li>;
        })}</ul>
      </div>}

      {panel.leadHead?.kind !== "no_ring_expected" && <div>
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("catering.toast_link.candidates_heading")}</h4>
        {panel.candidates.length === 0 ? <p className="mt-1">{t("catering.toast_link.no_candidates")}</p>
          : <ul className="mt-1 space-y-3">{panel.candidates.map((c) => <Candidate key={`${c.orderGuid}|${c.checkGuid}`} c={c}
            canDecide={panel.canDecide} busy={busy} money={money} evidence={evidence} onDecide={(kind) => void decide(pairBody(kind, c))} />)}</ul>}
      </div>}

      {panel.canDecide && panel.links.length === 0 && panel.leadHead?.kind !== "no_ring_expected" && (askNoRing
        ? <div className="space-y-2">
          <label className="flex min-h-[44px] flex-wrap items-center gap-2">
            <span>{t("catering.toast_link.no_ring_reason")}</span>
            <select value={noRing} onChange={(e) => setNoRing(e.target.value as ToastNoRingReason | "")}
              className="min-h-[44px] rounded-lg border border-co-border bg-co-surface px-2 text-co-text">
              <option value="" />
              {TOAST_NO_RING_REASONS.map((r) => <option key={r} value={r}>{t(`catering.toast_link.reason.${r}` as TranslationKey)}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy || !noRing}
              onClick={() => noRing && void decide({ kind: "no_ring_expected", reasonCode: noRing, expectedHeadId: panel.leadHead?.id ?? null })}>{t("catering.toast_link.action.confirm")}</button>
            <button type="button" className={QUIET} disabled={busy} onClick={() => { setAskNoRing(false); setNoRing(""); }}>{t("catering.toast_link.action.cancel")}</button>
          </div>
        </div>
        : <button type="button" className={QUIET} disabled={busy} onClick={() => setAskNoRing(true)}>{t("catering.toast_link.action.no_ring")}</button>)}
    </div>
  </section>;
}

function Candidate({ c, canDecide, busy, money, evidence, onDecide }: {
  c: ToastCandidate; canDecide: boolean; busy: boolean; money: (cents: number | null) => string; evidence: (e: string) => string;
  onDecide: (kind: "link" | "not_a_match") => void;
}) {
  const { t, language } = useTranslation();
  const note = c.state === "blocked" ? `catering.toast_link.state.blocked_${c.blockedBy ?? "unlink"}`
    : c.state === "open" ? null : `catering.toast_link.state.${c.state}`;
  return <li className="space-y-1">
    <p className="text-co-text">
      {t("catering.toast_link.check_line", { amount: money(c.checkTotalCents), date: formatDateLabel(c.businessDate, language), evidence: evidence(c.evidence) })}
      {c.amountMismatch && c.amountDiffCents !== null
        ? <span className="text-co-warning-text"> · {t("catering.toast_link.amount_differs", { amount: money(Math.abs(c.amountDiffCents)) })}</span> : null}
    </p>
    {note && <p className={c.state === "dual_code" ? "text-co-warning-text" : ""}>{t(note as TranslationKey)}</p>}
    {canDecide && <div className="flex flex-wrap gap-2">
      {candidateActions(c).map((kind) => <button key={kind} type="button" disabled={busy} className={kind === "link" ? PRIMARY : QUIET}
        onClick={() => onDecide(kind)}>
        {t(kind === "link" ? (c.state === "blocked" ? "catering.toast_link.action.relink" : "catering.toast_link.action.link") : "catering.toast_link.action.not_a_match")}
      </button>)}
    </div>}
  </li>;
}
