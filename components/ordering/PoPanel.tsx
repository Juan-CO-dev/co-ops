"use client";

/**
 * PoPanel — the purchase-order review + transmit island (Vendor Ordering V1, spec §3/§5).
 *
 * A full-screen overlay (the walker's review-sheet idiom) that surfaces ONE PO through its
 * lifecycle. Opened from the /ordering "Today's orders" chips or the history list. It fetches
 * the PO detail on mount (GET ?poId=) and renders per SERVER-AUTHORITATIVE status:
 *
 *   draft      → editable qty steppers (reuse the walker's row idiom; qty 0 = struck-through
 *                "removed"); explicit Save → PATCH updateDraftLines; Confirm (second-tap) →
 *                POST confirm → re-fetch as confirmed.
 *   confirmed  → frozen lines from the snapshot + the TIER-APPROPRIATE transmit block
 *                (manual → contact cards w/ accepts_text_orders badges + ordering-detail
 *                affordances; assisted → guide-position-sorted lines + portal deep link;
 *                every channel keeps Copy w/ the PO-code line). Then Mark-placed → a small
 *                dialog: channel select (prefilled from the last affordance tapped) + optional
 *                target/note → POST place.
 *   placed / received / reconciled → read-only trail: status timeline, transmissions list,
 *                linked delivery link, credits summary; AGM+ gets Mark-reconciled (second-tap)
 *                on received, with the open-credits 409 surfaced (count).
 *
 * ── HOUSE LAWS ─────────────────────────────────────────────────────────────────────────
 * Irreversible affordances (Confirm / Mark-placed / Mark-reconciled) gate on the SERVER
 * status in the freshly-loaded detail, never on spinner state (the smoke-test lesson). Every
 * mutation re-fetches the detail + calls onChanged() so the parent's Today's-orders chips
 * refresh (router.refresh does NOT reset this island's useState — explicit reload). Draft-edit
 * state is a plain useState map seeded from the loaded lines; Save is EXPLICIT (a tap), not
 * debounced — the manager reviews then commits, matching the walker's explicit-observation
 * ethos. Untrusted portal_url renders ONLY via the shared isValidHttpUrl validator.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatTime } from "@/lib/i18n/format";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import {
  CopyButton,
  DeliveryRow,
  isValidHttpUrl,
  isValidTel,
  linkBtn,
} from "@/components/ordering/delivery-affordances";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { PoDetail } from "@/lib/purchase-orders";
import type { OrderEmailPreview } from "@/lib/po-email-shared";
import type { ThreeWayView, ThreeWayLine, ThreeWayFlag } from "@/lib/po-match-shared";
import type { TranslationKey } from "@/lib/i18n/types";

type Channel = "email" | "sms" | "phone" | "portal" | "in_person";
const CHANNELS: Channel[] = ["email", "sms", "phone", "portal", "in_person"];

/** Status → pill tone (D2 always-visible identity/status). */
const STATUS_TONE: Record<string, AlertPillTone> = {
  draft: "info",
  confirmed: "warn",
  placed: "ok",
  received: "ok",
  reconciled: "ok",
  invoiced: "info",
};

const stepBtn =
  "inline-flex h-11 w-11 min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface text-2xl font-bold text-co-text hover:border-co-text disabled:opacity-60";

/** Money: integer cents → "$1.23" (advisory null → em dash). */
function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

interface DraftEdit {
  qty: string; // raw input
  note: string | null;
}

export function PoPanel({
  poId,
  actorLevel,
  language,
  shopLabel,
  dateLabel,
  onClose,
  onChanged,
}: {
  poId: string;
  /** The actor's role level (server-computed) — gates Mark-reconciled (shift_lead+ ≥ 5). */
  actorLevel: number;
  language: "en" | "es";
  shopLabel: string;
  dateLabel: string;
  onClose: () => void;
  /** Called after any successful mutation so the parent refreshes its chip list. */
  onChanged: () => void;
}) {
  const { t } = useTranslation();

  const [detail, setDetail] = useState<PoDetail | null>(null);
  // The server-rendered email preview for the auto tier (null unless confirmed + the
  // location's auto leg is awake). The server is the sole author — this is display-only.
  const [emailPreview, setEmailPreview] = useState<OrderEmailPreview | null>(null);
  // The three-way match view (V2 §5) + the SKUs carrying an open credit on the linked
  // deliveries. Server-derived, advisory; a null threeWay = derivation unavailable (the
  // section simply doesn't render — no pipe failure blocks the PO trail).
  const [threeWay, setThreeWay] = useState<ThreeWayView | null>(null);
  const [openCreditSkuIds, setOpenCreditSkuIds] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Draft line edits, keyed by skuId. Seeded from the loaded lines on each (re)load of a draft.
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({});
  // Second-tap arming for irreversible actions.
  const [armConfirm, setArmConfirm] = useState(false);
  const [armReconcile, setArmReconcile] = useState(false);
  // Mark-placed dialog state. channel prefilled from the last transmit affordance tapped.
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeChannel, setPlaceChannel] = useState<Channel>("email");
  const [placeTarget, setPlaceTarget] = useState("");
  const [placeNote, setPlaceNote] = useState("");

  const seedEdits = useCallback((d: PoDetail) => {
    if (d.status !== "draft") {
      setEdits({});
      return;
    }
    const next: Record<string, DraftEdit> = {};
    for (const l of d.lines) next[l.skuId] = { qty: String(l.orderQty), note: l.note };
    setEdits(next);
  }, []);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErr(null);
    try {
      const res = await fetch(`/api/operations/ordering/po?poId=${encodeURIComponent(poId)}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      const j = (await res.json()) as {
        detail?: PoDetail;
        emailPreview?: OrderEmailPreview | null;
        threeWay?: ThreeWayView | null;
        openCreditSkuIds?: string[];
      };
      if (!j.detail) {
        setLoadState("error");
        return;
      }
      setDetail(j.detail);
      setEmailPreview(j.emailPreview ?? null);
      setThreeWay(j.threeWay ?? null);
      setOpenCreditSkuIds(j.openCreditSkuIds ?? []);
      seedEdits(j.detail);
      // Reset transient action arming after every (re)load — never carry a stale arm.
      setArmConfirm(false);
      setArmReconcile(false);
      setPlaceOpen(false);
      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
  }, [poId, seedEdits]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // ── Draft edit ops (walker row idiom) ───────────────────────────────────────────
  const stepQty = (skuId: string, delta: number) =>
    setEdits((m) => {
      const cur = m[skuId] ?? { qty: "0", note: null };
      const base = Number(cur.qty);
      const next = Math.max(0, (Number.isFinite(base) ? base : 0) + delta);
      return { ...m, [skuId]: { ...cur, qty: String(next) } };
    });
  const setQty = (skuId: string, qty: string) =>
    setEdits((m) => ({ ...m, [skuId]: { qty, note: m[skuId]?.note ?? null } }));

  // The PATCH payload: every seeded line at its (possibly edited) qty. A qty of 0 keeps the
  // line as a "removed" row (append-only: the lib stores qty 0, transmission skips it).
  const editPayload = useMemo(
    () =>
      Object.entries(edits)
        .map(([skuId, e]) => ({ skuId, orderQty: Number(e.qty), note: e.note }))
        .filter((l) => Number.isFinite(l.orderQty) && l.orderQty >= 0),
    [edits],
  );

  const anyInvalid = useMemo(
    () => Object.values(edits).some((e) => !Number.isFinite(Number(e.qty)) || Number(e.qty) < 0),
    [edits],
  );

  const setErrFromCode = (code: string | undefined, count?: number) => {
    const key = ("ordering.po.error." + (code ?? "generic")) as TranslationKey;
    setErr(count != null ? t(key, { n: count }) : t(key));
  };

  const doAction = async (
    body: Record<string, unknown>,
    method: "POST" | "PATCH",
  ): Promise<{ ok: boolean; code?: string }> => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/operations/ordering/po", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { code?: string; message?: string; n?: number };
      if (!res.ok) {
        // Surface the open-credits count when the lib packs it into the message (409 open_credits).
        const countMatch = j.message?.match(/^(\d+)/);
        setErrFromCode(j.code, j.code === "open_credits" && countMatch ? Number(countMatch[1]) : undefined);
        return { ok: false, code: j.code };
      }
      return { ok: true };
    } catch {
      setErr(t("ordering.po.error.generic"));
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (anyInvalid || editPayload.length === 0) return;
    const res = await doAction({ poId, lines: editPayload }, "PATCH");
    if (res.ok) {
      await load();
      onChanged();
    } else if (res.code === "confirmed_during_edit") {
      // The PO was confirmed mid-edit — reload so the editor sees the confirmed state
      // (and the authoritative snapshot); the error message already explains the miss.
      await load();
      onChanged();
    }
  };

  const confirm = async () => {
    if (!armConfirm) {
      setArmConfirm(true);
      return;
    }
    // Save any pending edits FIRST (freeze what the manager sees), then confirm.
    if (!anyInvalid && editPayload.length > 0) {
      const saved = await doAction({ poId, lines: editPayload }, "PATCH");
      if (!saved.ok) {
        // If someone else confirmed while we were editing, reload into the confirmed state.
        if (saved.code === "confirmed_during_edit") {
          await load();
          onChanged();
        }
        return;
      }
    }
    const res = await doAction({ action: "confirm", poId }, "POST");
    if (res.ok) {
      await load();
      onChanged();
    }
  };

  const openPlace = (channel: Channel, target: string | null) => {
    setPlaceChannel(channel);
    setPlaceTarget(target ?? "");
    setPlaceNote("");
    setPlaceOpen(true);
  };

  const place = async () => {
    const res = await doAction(
      { action: "place", poId, channel: placeChannel, target: placeTarget.trim() || null, note: placeNote.trim() || null },
      "POST",
    );
    if (res.ok) {
      await load();
      onChanged();
    }
  };

  const reconcile = async () => {
    if (!armReconcile) {
      setArmReconcile(true);
      return;
    }
    const res = await doAction({ action: "reconcile", poId }, "POST");
    if (res.ok) {
      await load();
      onChanged();
    }
  };

  // Auto tier (V2): send the confirmed PO to the vendor by email. The server re-derives +
  // gates (409 email_dormant / no_email_target / po status raced; 502 send_failed) and, on
  // success, places the PO — so we just reload into the placed trail. Busy-guarded; the
  // mapped 409/502 message surfaces via doAction's setErrFromCode. Manual affordances stay
  // below regardless (no pipe blocks ordering).
  const sendEmail = async () => {
    const res = await doAction({ action: "send_email", poId }, "POST");
    if (res.ok) {
      await load();
      onChanged();
    }
  };

  // ── The plaintext order body (PO code first line, then shop/date, then lines) ────
  const bodyText = useMemo(() => {
    if (!detail) return "";
    const poLine = `${t("ordering.email.body_po", { code: detail.displayCode })}\n`;
    const header = t("ordering.email.body_header", { shop: shopLabel, date: dateLabel });
    const lines = detail.lines
      .filter((l) => l.orderQty > 0)
      .map((l) =>
        t("ordering.email.body_line", {
          sku: l.skuName,
          qty: l.orderQty,
          unit: l.orderUnitLabel ?? t("ordering.unit_generic"),
          item: l.itemNumber ?? "—",
        }),
      );
    return `${poLine}${header}\n\n${lines.join("\n")}`;
  }, [detail, shopLabel, dateLabel, t]);

  const subject = t("ordering.email.subject", { shop: shopLabel, date: dateLabel });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-co-bg">
      <div className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-co-text">
            {detail ? t("ordering.po.panel_title", { code: detail.displayCode }) : t("ordering.po.panel_title_bare")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center px-2 text-sm font-bold text-co-text-dim hover:text-co-text"
          >
            {t("ordering.po.close")}
          </button>
        </div>

        {loadState === "loading" && (
          <p className="mt-4 text-[13px] italic text-co-text-muted">{t("ordering.po.loading")}</p>
        )}
        {loadState === "error" && (
          <div role="alert" className="mt-4 rounded-lg border-2 border-co-danger bg-co-danger-surface px-3 py-3 text-sm text-co-text">
            {t("ordering.po.load_error")}
          </div>
        )}

        {detail && loadState === "loaded" && (
          <>
            {/* Identity + status (D1/D2 — always visible). */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-co-text">{detail.vendorName}</span>
              <AlertPill tone={STATUS_TONE[detail.status] ?? "info"} uppercase={false}>
                {t(("ordering.po.status." + detail.status) as TranslationKey)}
              </AlertPill>
              {/* V2-D2: acknowledgment is EVIDENCE on placed, not a status — the ✓ chip
                  appears the moment a matched confirmation fills the ack (any channel). */}
              {detail.ack && (
                <AlertPill tone="ok" uppercase={false}>
                  {t("ordering.po.ack.confirmed")}
                  {detail.ack.additionalCount > 0 ? ` +${detail.ack.additionalCount}` : ""}
                </AlertPill>
              )}
              {/* THE ID THREAD (identity, every status incl. draft): the display_code born
                  at draft creation is what the vendor, the invoice, and the door intake all
                  quote back. Copyable so it can be pasted into a text/portal/phone note —
                  the shared CopyButton, same affordance as the transmit block below. */}
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded-md bg-co-surface-2 px-2 py-0.5 font-mono text-[12px] font-bold tracking-wide text-co-text-dim">
                  {detail.displayCode}
                </span>
                <CopyButton text={detail.displayCode} />
              </span>
            </div>

            {err && (
              <div role="alert" className="mt-3 rounded-lg border-2 border-co-danger bg-co-danger-surface px-3 py-3 text-sm text-co-text">
                {err}
              </div>
            )}

            {detail.status === "draft" && (
              <DraftView
                detail={detail}
                edits={edits}
                onStep={stepQty}
                onQty={setQty}
                onSave={() => void saveDraft()}
                onConfirm={() => void confirm()}
                armConfirm={armConfirm}
                busy={busy}
                anyInvalid={anyInvalid}
              />
            )}

            {detail.status === "confirmed" && (
              <ConfirmedView
                detail={detail}
                subject={subject}
                body={bodyText}
                emailPreview={emailPreview}
                busy={busy}
                onSend={() => void sendEmail()}
                onUse={openPlace}
                onOpenPlace={() => openPlace("in_person", null)}
              />
            )}

            {(detail.status === "placed" || detail.status === "received" || detail.status === "reconciled" || detail.status === "invoiced") && (
              <TrailView
                detail={detail}
                language={language}
                actorLevel={actorLevel}
                armReconcile={armReconcile}
                busy={busy}
                onReconcile={() => void reconcile()}
                threeWay={threeWay}
                openCreditSkuIds={openCreditSkuIds}
              />
            )}
          </>
        )}
      </div>

      {/* Mark-placed dialog (small modal). */}
      {placeOpen && detail && (
        <PlaceDialog
          channel={placeChannel}
          target={placeTarget}
          note={placeNote}
          busy={busy}
          onChannel={setPlaceChannel}
          onTarget={setPlaceTarget}
          onNote={setPlaceNote}
          onCancel={() => setPlaceOpen(false)}
          onConfirm={() => void place()}
        />
      )}
    </div>
  );
}

// ── DRAFT: editable lines + Save + Confirm ──────────────────────────────────────────
function DraftView({
  detail,
  edits,
  onStep,
  onQty,
  onSave,
  onConfirm,
  armConfirm,
  busy,
  anyInvalid,
}: {
  detail: PoDetail;
  edits: Record<string, DraftEdit>;
  onStep: (skuId: string, delta: number) => void;
  onQty: (skuId: string, qty: string) => void;
  onSave: () => void;
  onConfirm: () => void;
  armConfirm: boolean;
  busy: boolean;
  anyInvalid: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-[13px] text-co-text-dim">{t("ordering.po.draft_help")}</p>
      <div className="flex flex-col gap-2">
        {detail.lines.map((l) => {
          const e = edits[l.skuId] ?? { qty: String(l.orderQty), note: l.note };
          const qtyNum = Number(e.qty);
          const removed = Number.isFinite(qtyNum) && qtyNum === 0;
          const invalid = !Number.isFinite(qtyNum) || qtyNum < 0;
          return (
            <div
              key={l.skuId}
              className={
                "rounded-lg border-2 p-3 " +
                (invalid
                  ? "border-co-danger bg-co-danger-surface"
                  : removed
                    ? "border-co-border-2 bg-co-surface-2"
                    : "border-co-border-2 bg-co-surface")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className={"block text-[15px] font-bold text-co-text" + (removed ? " line-through opacity-60" : "")}>
                    {l.skuName}
                  </span>
                  <span className="block text-[12px] text-co-text-dim">
                    {l.itemNumber ? `#${l.itemNumber} · ` : ""}
                    {l.orderUnitLabel ?? t("ordering.unit_generic")}
                  </span>
                </div>
                {removed && (
                  <AlertPill tone="info" uppercase={false}>
                    {t("ordering.po.removed")}
                  </AlertPill>
                )}
              </div>
              <div className="mt-2 flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => onStep(l.skuId, -1)}
                  aria-label={t("ordering.po.decrement", { sku: l.skuName })}
                  className={stepBtn}
                >
                  −
                </button>
                <input
                  className="min-h-[44px] w-full flex-1 rounded-lg border-2 border-co-border bg-co-surface px-3 text-center text-xl font-bold text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={e.qty}
                  onChange={(ev) => onQty(l.skuId, ev.target.value)}
                  aria-label={t("ordering.po.qty_for", { sku: l.skuName })}
                />
                <button
                  type="button"
                  onClick={() => onStep(l.skuId, 1)}
                  aria-label={t("ordering.po.increment", { sku: l.skuName })}
                  className={stepBtn}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy || anyInvalid}
          className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text hover:border-co-text disabled:opacity-50"
        >
          {t("ordering.po.save")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || anyInvalid}
          className={
            "inline-flex min-h-[48px] flex-[2] items-center justify-center rounded-lg border-2 px-4 text-sm font-bold uppercase tracking-[0.1em] disabled:opacity-50 " +
            (armConfirm
              ? "border-co-gold-deep bg-co-gold-deep text-white"
              : "border-co-gold-deep bg-co-gold text-co-text")
          }
        >
          {armConfirm ? t("ordering.po.confirm_arm") : t("ordering.po.confirm")}
        </button>
      </div>
    </div>
  );
}

// ── CONFIRMED: frozen lines + tier-appropriate transmit block + Mark-placed ─────────
function ConfirmedView({
  detail,
  subject,
  body,
  emailPreview,
  busy,
  onSend,
  onUse,
  onOpenPlace,
}: {
  detail: PoDetail;
  subject: string;
  body: string;
  /** Server-rendered auto-tier email preview (null unless the auto leg is awake). */
  emailPreview: OrderEmailPreview | null;
  busy: boolean;
  onSend: () => void;
  onUse: (channel: "email" | "sms" | "phone" | "portal" | "in_person", target: string | null) => void;
  onOpenPlace: () => void;
}) {
  const { t } = useTranslation();
  const { transmit } = detail;

  // Assisted tier sorts lines by guide_position (nulls last, then name) — the vendor's guide
  // sequence, so the manager can key the order into the vendor's own portal top-to-bottom.
  const orderedLines = useMemo(() => {
    const sent = detail.lines.filter((l) => l.orderQty > 0);
    if (transmit.tier !== "assisted") return sent;
    return [...sent].sort((a, b) => {
      const ga = a.guidePositionSnapshot;
      const gb = b.guidePositionSnapshot;
      if (ga == null && gb == null) return a.skuName.localeCompare(b.skuName);
      if (ga == null) return 1; // nulls last
      if (gb == null) return -1;
      if (ga !== gb) return ga - gb;
      return a.skuName.localeCompare(b.skuName);
    });
  }, [detail.lines, transmit.tier]);

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* Frozen line table (read-only). */}
      <section className="co-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.frozen_lines")}</h3>
        <table className="mt-2 w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-co-text-dim">
              <th className="pb-1 font-bold">{t("ordering.review.col_sku")}</th>
              <th className="pb-1 font-bold">{t("ordering.review.col_item")}</th>
              <th className="pb-1 text-right font-bold">{t("ordering.review.col_qty")}</th>
              <th className="pb-1 text-right font-bold">{t("ordering.po.col_price")}</th>
            </tr>
          </thead>
          <tbody>
            {orderedLines.map((l) => (
              <tr key={l.skuId} className="border-t border-co-border/50">
                <td className="py-1 font-semibold text-co-text">{l.skuName}</td>
                <td className="py-1 text-co-text-dim">{l.itemNumber ?? "—"}</td>
                <td className="py-1 text-right font-bold text-co-text">
                  {t("ordering.review.qty_unit", { qty: l.orderQty, unit: l.orderUnitLabel ?? t("ordering.unit_generic") })}
                </td>
                <td className="py-1 text-right text-co-text-dim">{money(l.priceCentsAtOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* AUTO tier (V2 §3, two-tap): the Send-to-vendor preview + button. Rendered ONLY
          when the location's auto-email leg is awake (server-derived). When dormant, a
          note explains why. Either way, the manual transmit block below ALWAYS renders —
          no pipe blocks ordering (house law). */}
      {transmit.emailOrderingAvailable ? (
        <section className="co-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.auto.title")}</h3>
            <AlertPill tone="ok" uppercase={false}>{t("ordering.po.tier.auto")}</AlertPill>
          </div>
          {emailPreview && emailPreview.to.length > 0 ? (
            <>
              <dl className="mt-3 flex flex-col gap-1 text-[13px]">
                <div className="flex gap-2">
                  <dt className="shrink-0 font-bold text-co-text-dim">{t("ordering.po.auto.to")}</dt>
                  <dd className="min-w-0 break-words text-co-text">{emailPreview.to.join(", ")}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 font-bold text-co-text-dim">{t("ordering.po.auto.from")}</dt>
                  <dd className="min-w-0 break-words text-co-text">{emailPreview.from}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 font-bold text-co-text-dim">{t("ordering.po.auto.subject")}</dt>
                  <dd className="min-w-0 break-words text-co-text">{emailPreview.subject}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[12px] text-co-text-dim">
                {t("ordering.po.auto.line_summary", {
                  n: detail.lines.filter((l) => l.orderQty > 0).length,
                  count: emailPreview.to.length,
                })}
              </p>
              <button
                type="button"
                onClick={onSend}
                disabled={busy}
                className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
              >
                {t("ordering.po.auto.send")}
              </button>
              <p className="mt-2 text-[12px] italic text-co-text-muted">{t("ordering.po.auto.send_help")}</p>
            </>
          ) : emailPreview ? (
            // Auto leg awake, but the vendor has no email on file → no target.
            <p className="mt-3 text-[13px] text-co-text-dim">{t("ordering.po.auto.no_target")}</p>
          ) : (
            // Auto leg awake but the server-side preview derivation failed (transient) —
            // distinct from no-target: recipients may exist. Manual affordances below.
            <p className="mt-3 text-[13px] text-co-text-dim">{t("ordering.po.auto.preview_unavailable")}</p>
          )}
        </section>
      ) : (
        <section className="co-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.auto.title")}</h3>
          </div>
          <p className="mt-3 text-[13px] text-co-text-dim">{t("ordering.po.auto.dormant")}</p>
          {/* The dormant note above says WHAT (not set up — use another way); this says WHEN
              it changes. The block is not silent in this state, so per the design this line
              sits BENEATH the existing note rather than replacing it. Muted: standing
              configuration state, not an alert. */}
          <p className="mt-1 text-[12px] text-co-text-muted">{t("ordering.po.email_dormant_hint")}</p>
        </section>
      )}

      {/* TRANSMIT block — tier-appropriate. */}
      <section className="co-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.transmit")}</h3>
          <AlertPill tone="info" uppercase={false}>
            {t(("ordering.po.tier." + transmit.tier) as TranslationKey)}
          </AlertPill>
        </div>

        {transmit.tier === "assisted" ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[12px] text-co-text-dim">{t("ordering.po.assisted_help")}</p>
            {transmit.portalUrl && isValidHttpUrl(transmit.portalUrl) ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2">
                <span className="min-w-0 truncate text-[12px] text-co-text-dim">{transmit.portalUrl}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={transmit.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkBtn}
                    onClick={() => onUse("portal", transmit.portalUrl)}
                  >
                    {t("ordering.po.open_portal")}
                  </a>
                  <CopyButton text={body} />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-dashed border-co-border-2 px-3 py-2">
                <span className="text-[13px] text-co-text-dim">{t("ordering.po.no_portal")}</span>
                <CopyButton text={body} />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {/* Manual: contact cards (accepts_text_orders badged) + ordering-detail affordances. */}
            {transmit.contacts.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-co-text-dim">{t("ordering.po.contacts")}</span>
                {transmit.contacts.map((c) => (
                  <div key={c.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-bold text-co-text">{c.name}</span>
                      {c.acceptsTextOrders && (
                        <AlertPill tone="ok" uppercase={false}>
                          {t("ordering.po.accepts_text")}
                        </AlertPill>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {c.phone && (
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-co-text-dim">{c.phone}</span>
                          {isValidTel(c.phone) && (
                            <a
                              href={`tel:${c.phone.replace(/[^\d+()\-\s]/g, "")}`}
                              className={linkBtn}
                              onClick={() => onUse(c.acceptsTextOrders ? "sms" : "phone", c.phone)}
                            >
                              {c.acceptsTextOrders ? t("ordering.po.text") : t("ordering.deliver.call")}
                            </a>
                          )}
                        </div>
                      )}
                      {c.email && <CopyButton text={c.email} />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {transmit.orderingDetails.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-co-text-dim">{t("ordering.po.ordering_methods")}</span>
                {transmit.orderingDetails.map((d, i) => (
                  <DeliveryRow
                    key={`${d.method}-${i}`}
                    detail={d}
                    subject={subject}
                    body={body}
                    copyText={body}
                    onUse={onUse}
                  />
                ))}
              </div>
            ) : (
              transmit.contacts.length === 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-dashed border-co-border-2 px-3 py-2">
                  <span className="text-[13px] text-co-text-dim">{t("ordering.deliver.none")}</span>
                  <CopyButton text={body} />
                </div>
              )
            )}
          </div>
        )}

        {/* Copy always present (no pipe failure blocks ordering — spec §3). */}
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border-2 border-co-border-2 bg-co-surface-2 px-3 py-2">
          <span className="text-[12px] text-co-text-dim">{t("ordering.po.copy_hint")}</span>
          <CopyButton text={body} />
        </div>
      </section>

      {/* Mark placed. */}
      <button
        type="button"
        onClick={onOpenPlace}
        className="inline-flex min-h-[48px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text"
      >
        {t("ordering.po.mark_placed")}
      </button>
    </div>
  );
}

// ── PLACED / RECEIVED / RECONCILED: read-only trail ─────────────────────────────────
function TrailView({
  detail,
  language,
  actorLevel,
  armReconcile,
  busy,
  onReconcile,
  threeWay,
  openCreditSkuIds,
}: {
  detail: PoDetail;
  language: "en" | "es";
  actorLevel: number;
  armReconcile: boolean;
  busy: boolean;
  onReconcile: () => void;
  /** Server-derived three-way match (V2 §5); null when derivation was unavailable. */
  threeWay: ThreeWayView | null;
  /** SKUs carrying an open credit on the linked deliveries (chips a short line's credit). */
  openCreditSkuIds: string[];
}) {
  const { t } = useTranslation();
  const canReconcile = actorLevel >= 5; // shift_lead+ (see PO_RECONCILE_MIN)

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* Frozen lines (read-only). */}
      <section className="co-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.frozen_lines")}</h3>
        <table className="mt-2 w-full text-[13px]">
          <tbody>
            {detail.lines.filter((l) => l.orderQty > 0).map((l) => (
              <tr key={l.skuId} className="border-t border-co-border/50 first:border-t-0">
                <td className="py-1 font-semibold text-co-text">{l.skuName}</td>
                <td className="py-1 text-right font-bold text-co-text">
                  {t("ordering.review.qty_unit", { qty: l.orderQty, unit: l.orderUnitLabel ?? t("ordering.unit_generic") })}
                </td>
                <td className="py-1 text-right text-co-text-dim">{money(l.priceCentsAtOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Three-way match (V2 §5): ordered / received / billed per line + variance chips.
          Advisory-only; collapsible per D-doctrine. Renders only when derivation was
          available (threeWay non-null). */}
      {threeWay && (
        <ThreeWaySection
          view={threeWay}
          openCreditSkuIds={openCreditSkuIds}
          // The billed leg is still open on an order that HAS been sent → the emailed-invoice
          // parse cadence is the likeliest reason the column is empty. Gated on status here
          // (the section has no status of its own). See the prop's doc for why this is NOT
          // gated on transmit.emailOrderingAvailable.
          showParseCadence={detail.status === "placed" || detail.status === "invoiced"}
        />
      )}

      {/* Status timeline (from the row's own timestamps). */}
      <section className="co-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.timeline")}</h3>
        <ol className="mt-2 flex flex-col gap-1">
          {detail.timeline.map((ev, i) => (
            <li key={`${ev.status}-${i}`} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="font-semibold text-co-text">{t(("ordering.po.status." + ev.status) as TranslationKey)}</span>
              <span className="text-co-text-dim">{formatTime(ev.at, language)}</span>
            </li>
          ))}
        </ol>
        {/* V2-D2 evidence line: who confirmed, via which channel, when. from renders as
            plain text (vendor-supplied address/number — untrusted content law). */}
        {detail.ack && (
          <p className="mt-2 text-[12px] text-co-text-dim">
            {t("ordering.po.ack.detail", {
              from: detail.ack.from ?? "—",
              channel: detail.ack.source ?? "—",
            })}
            {detail.ack.at ? ` · ${formatTime(detail.ack.at, language)}` : ""}
          </p>
        )}
      </section>

      {/* Transmissions list. */}
      {detail.transmissions.length > 0 && (
        <section className="co-card p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.transmissions")}</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {detail.transmissions.map((tx) => (
              <li key={tx.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-co-text">{t(("ordering.po.channel." + tx.channel) as TranslationKey)}</span>
                  <span className="text-[12px] text-co-text-dim">{formatTime(tx.sentAt, language)}</span>
                </div>
                {tx.target && <span className="block text-[12px] text-co-text-dim">{tx.target}</span>}
                <span className="block text-[12px] text-co-text-muted">
                  {t("ordering.po.tx_by", { name: tx.sentByName ?? t("ordering.po.tx_automated") })}
                </span>
                {tx.note && <span className="block text-[12px] italic text-co-text-dim">{tx.note}</span>}
                {tx.providerMessageId && (
                  <span className="block break-all font-mono text-[11px] text-co-text-muted">{tx.providerMessageId}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* SMS messages (V2 §5c) — the text channel's half of the unified trail. The body is
          UNTRUSTED vendor content: rendered as a plain text node (React auto-escapes) — never
          markup, never a link/href. Direction badge distinguishes an inbound vendor reply from
          an outbound order (outbound is dormant in V1, so these are inbound today). */}
      {detail.smsMessages.length > 0 && (
        <section className="co-card p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.sms.heading")}</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {detail.smsMessages.map((sms) => (
              <li key={sms.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-co-text">
                    {t(("ordering.po.sms.direction." + sms.direction) as TranslationKey)}
                  </span>
                  <span className="text-[12px] text-co-text-dim">{formatTime(sms.occurredAt, language)}</span>
                </div>
                <span className="block text-[12px] text-co-text-muted">
                  {t("ordering.po.sms.from", { number: sms.fromNumber })}
                </span>
                {sms.body && <span className="mt-1 block whitespace-pre-wrap text-[13px] text-co-text">{sms.body}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Linked delivery + credits summary. */}
      {detail.deliveryIds.length > 0 && (
        <section className="co-card p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("ordering.po.delivery")}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {detail.deliveryIds.map((did) => (
              <li key={did}>
                <a href={`/operations/receiving/${did}`} className="text-[13px] font-bold text-co-gold-deep underline">
                  {t("ordering.po.open_delivery")}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-co-text-dim">
            {detail.credits.openCount > 0 ? (
              <AlertPill tone="warn" uppercase={false}>
                {t("ordering.po.credits_open", { open: detail.credits.openCount, total: detail.credits.totalCount })}
              </AlertPill>
            ) : (
              t("ordering.po.credits_clear", { total: detail.credits.totalCount })
            )}
          </p>
        </section>
      )}

      {detail.placedNote && (
        <p className="text-[13px] italic text-co-text-dim">{t("ordering.po.placed_note", { note: detail.placedNote })}</p>
      )}

      {/* Mark reconciled (AGM+; received-only). */}
      {detail.status === "received" && canReconcile && (
        <button
          type="button"
          onClick={onReconcile}
          disabled={busy}
          className={
            "inline-flex min-h-[48px] items-center justify-center rounded-lg border-2 px-4 text-sm font-bold uppercase tracking-[0.1em] disabled:opacity-50 " +
            (armReconcile
              ? "border-co-gold-deep bg-co-gold-deep text-white"
              : "border-co-gold-deep bg-co-gold text-co-text")
          }
        >
          {armReconcile ? t("ordering.po.reconcile_arm") : t("ordering.po.reconcile")}
        </button>
      )}
    </div>
  );
}

// ── THREE-WAY MATCH (V2 §5): ordered / received / billed + variance chips ────────────
/** Flag → AlertPill tone. billed_over_received is the loud one (money charged for goods
 *  that didn't arrive); the rest are advisory-warn / info. */
const FLAG_TONE: Record<ThreeWayFlag, AlertPillTone> = {
  billed_over_received: "danger",
  short_received: "warn",
  not_billed: "info",
  unmatched_invoice_line: "info",
};

/** Qty display: advisory-null → em dash (never a fabricated 0 — the null-leg law). */
function qtyOrDash(v: number | null): string {
  return v == null ? "—" : String(v);
}

function ThreeWaySection({
  view,
  openCreditSkuIds,
  showParseCadence,
}: {
  view: ThreeWayView;
  openCreditSkuIds: string[];
  /**
   * Explain an empty billed column with the inbound parse cadence? True for a PO already
   * out the door (placed/invoiced), where "no invoice yet" may just mean the daily sweep
   * hasn't run since the bill landed.
   *
   * NOT gated on `transmit.emailOrderingAvailable`: that flag is the OUTBOUND gate — it
   * additionally requires a verified EMAIL_FROM domain (non-resend.dev), which is exactly
   * the DNS errand still outstanding, so it reads false everywhere today. INBOUND invoice
   * parsing is a separate leg (the location's receipt alias + the daily parse-receipts
   * sweep) and no inbound-availability flag exists on PoDetail. Gating on the outbound
   * flag would therefore suppress a true explanation; status-only is the honest gate.
   */
  showParseCadence: boolean;
}) {
  const { t } = useTranslation();
  const creditSkus = useMemo(() => new Set(openCreditSkuIds), [openCreditSkuIds]);

  // The collapsed-header count = number of lines carrying at least one variance flag
  // (D5 i18n'd count). Zero flags → a clean "all matched" count; the section still opens.
  const flaggedCount = useMemo(() => view.lines.filter((l) => l.flags.length > 0).length, [view.lines]);

  return (
    <CollapsibleSection
      idBase="po-three-way"
      title={t("ordering.po.three_way.title")}
      count={t("ordering.po.three_way.count", { n: flaggedCount })}
    >
      {/* Advisory notes when a leg is missing (advisory-null law — an absent leg is
          STATED, never implied as zero). */}
      {!view.hasDelivery && (
        <p className="mb-2 text-[13px] italic text-co-text-dim">{t("ordering.po.three_way.no_delivery")}</p>
      )}
      {!view.hasInvoice && (
        <p className="mb-2 text-[13px] italic text-co-text-dim">{t("ordering.po.three_way.no_invoice")}</p>
      )}
      {/* WHY the billed column is empty on an already-placed order: emailed invoices are
          parsed by a once-daily sweep, so a bill that arrived after the last run shows up
          only after the next one. States the cadence; asserts nothing about this invoice. */}
      {!view.hasInvoice && showParseCadence && (
        <p className="mb-2 text-[12px] text-co-text-muted">{t("ordering.po.three_way.parse_cadence")}</p>
      )}

      {view.lines.length === 0 ? (
        <p className="text-[13px] text-co-text-dim">{t("ordering.po.three_way.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("ordering.po.three_way.title")}>
          {view.lines.map((l) => (
            <ThreeWayRow key={l.key} line={l} hasOpenCredit={creditSkus.has(l.key)} />
          ))}
        </ul>
      )}

      {/* Totals footer (advisory-null: em dash when a total couldn't be computed). */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-co-border/50 pt-2 text-[12px]">
        <span className="text-co-text-dim">
          {t("ordering.po.three_way.total_ordered", { amount: money(view.totals.orderedCents) })}
        </span>
        <span className="text-co-text-dim">
          {t("ordering.po.three_way.total_billed", { amount: money(view.totals.billedCents) })}
        </span>
      </div>
    </CollapsibleSection>
  );
}

/** One three-way line: name/item + the three stacked-on-narrow columns (ordered /
 *  received / billed) + variance chips. Phone-first: the three legs stack in a
 *  responsive grid (1 col on narrow, 3 cols ≥ sm). Untrusted invoice descriptions
 *  render as TEXT ONLY (house untrusted-content law). */
function ThreeWayRow({ line, hasOpenCredit }: { line: ThreeWayLine; hasOpenCredit: boolean }) {
  const { t } = useTranslation();
  return (
    <li className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-bold text-co-text">{line.name}</span>
        {line.itemNumber && (
          <span className="font-mono text-[11px] text-co-text-dim">#{line.itemNumber}</span>
        )}
      </div>

      {/* Ordered / Received / Billed — stack on narrow, three columns ≥ sm. */}
      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-3">
        <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:gap-0">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
            {t("ordering.po.three_way.ordered")}
          </dt>
          <dd className="text-[14px] font-semibold text-co-text">
            {qtyOrDash(line.orderedQty)}
            {line.orderedUnit ? <span className="text-[11px] font-normal text-co-text-dim"> {line.orderedUnit}</span> : null}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:gap-0">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
            {t("ordering.po.three_way.received")}
          </dt>
          <dd className="text-[14px] font-semibold text-co-text">
            {qtyOrDash(line.receivedQty)}
            {line.receivedLevel ? <span className="text-[11px] font-normal text-co-text-dim"> {line.receivedLevel}</span> : null}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:gap-0">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
            {t("ordering.po.three_way.billed")}
          </dt>
          <dd className="text-[14px] font-semibold text-co-text">
            {qtyOrDash(line.billedQty)}
            {line.billedCents != null ? (
              <span className="text-[11px] font-normal text-co-text-dim"> {money(line.billedCents)}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      {/* Variance chips (per flag). A short line with an open credit on the linked
          delivery shows the credit chip too — already-tracked, not a new alert. */}
      {line.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {line.flags.map((f) => (
            <AlertPill key={f} tone={FLAG_TONE[f]} uppercase={false}>
              {t(("ordering.po.three_way.flag." + f) as TranslationKey)}
            </AlertPill>
          ))}
          {line.flags.includes("short_received") && hasOpenCredit && (
            <AlertPill tone="info" uppercase={false}>
              {t("ordering.po.three_way.credit_tracked")}
            </AlertPill>
          )}
        </div>
      )}
    </li>
  );
}

// ── Mark-placed dialog (channel + target + note) ────────────────────────────────────
function PlaceDialog({
  channel,
  target,
  note,
  busy,
  onChannel,
  onTarget,
  onNote,
  onCancel,
  onConfirm,
}: {
  channel: Channel;
  target: string;
  note: string;
  busy: boolean;
  onChannel: (c: Channel) => void;
  onTarget: (v: string) => void;
  onNote: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const channelId = useId();
  const targetId = useId();
  const noteId = useId();
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl border-2 border-co-border bg-co-bg p-4 sm:rounded-2xl">
        <h3 className="text-base font-bold text-co-text">{t("ordering.po.place_title")}</h3>
        <p className="mt-1 text-[12px] text-co-text-dim">{t("ordering.po.place_help")}</p>

        <label htmlFor={channelId} className="mt-3 block text-[11px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
          {t("ordering.po.place_channel")}
        </label>
        <select
          id={channelId}
          value={channel}
          onChange={(e) => onChannel(e.target.value as Channel)}
          className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-semibold text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(("ordering.po.channel." + c) as TranslationKey)}
            </option>
          ))}
        </select>

        <label htmlFor={targetId} className="mt-3 block text-[11px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
          {t("ordering.po.place_target")}
        </label>
        <input
          id={targetId}
          value={target}
          onChange={(e) => onTarget(e.target.value)}
          placeholder={t("ordering.po.place_target_hint")}
          aria-label={t("ordering.po.place_target")}
          className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        />

        <label htmlFor={noteId} className="mt-3 block text-[11px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
          {t("ordering.po.place_note")}
        </label>
        <input
          id={noteId}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder={t("ordering.po.place_note_hint")}
          aria-label={t("ordering.po.place_note")}
          className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text-dim hover:border-co-text disabled:opacity-50"
          >
            {t("ordering.po.place_cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-[48px] flex-[2] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
          >
            {t("ordering.po.place_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
