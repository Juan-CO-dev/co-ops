"use client";

/**
 * ParSuggestionRow — ONE NUMBER PAIR, ONE TAP (Dynamic Pars Phase 4, Task 4.3).
 *
 * Sits inside the walker's SKU row, under the par chip: "Par 3 → suggested 5", the reason
 * in kitchen language, and two affordances. Nothing else. The r1 walker-legibility rule is
 * that a row says ONE numeric thing — so the #283 cause advisory and this block never
 * co-render, and that exclusivity is enforced server-side in `buildRow`, not here.
 *
 * ── THE NUMBER IS THE SERVER'S, TWICE ─────────────────────────────────────────
 * The suggested par is computed by the engine, re-selected at the walk instant (R3-A), and
 * re-derived AGAIN by the route before anything is written. This component posts an
 * IDENTITY (the generation id) and never a value: there is no payload it can send that
 * moves a par to a number the system did not choose.
 *
 * ── ACCEPTING RE-RUNS THE ORDER QTY THROUGH THE SAME ENGINE (r1) ──────────────
 * On success the row's order quantity is recomputed with `suggestedOrderQty` from
 * lib/dynamic-pars-shared.ts — the SAME pure function the server used to draw the Suggest
 * chip. Imported, never re-derived: a second spelling of "order up to par" is how the chip
 * and the par start disagreeing on a shelf walk.
 *
 * ── SHADOW HONESTY (r3) ───────────────────────────────────────────────────────
 * The accept affordance is LIVE — the suggestion tier is real in v1. What is NOT real is
 * application, so an auto-tier row reads "WOULD tune 3 → 4" and its undo is rendered
 * DISABLED with a title saying why. A "par auto-tuned 3→4" notice beside a par that is
 * still 3, with a working undo for a move that never happened, is a lie. The global "in
 * shadow" banner lives once on the page (ParPassWalker); it is never a per-row badge.
 *
 * House laws: `useState`-only, type-only server imports, phone-first, 44px floor with
 * `items-center`, every string and every ARIA label i18n'd (en + es, same PR).
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { ActionButton } from "@/components/ActionButton";
import { suggestedOrderQty, type WalkerParSuggestion } from "@/lib/dynamic-pars-shared";
import type { WalkerSku } from "@/lib/ordering";

/** Error codes this surface has copy for. Anything else falls back to the generic line —
 *  a raw key string rendered at 6 AM is worse than "something went wrong". */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "suggestion_superseded", "suggestion_already_actioned", "nothing_to_revert",
  "par_ledger_pending", "forbidden", "not_found", "invalid_payload",
]);

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "accepted"; par: number }
  | { kind: "dismissed"; par: number }
  | { kind: "error"; message: string };

export function ParSuggestionRow({
  sku,
  suggestion,
  locationId,
  dayClass,
  shadowMode,
  onAccepted,
}: {
  sku: WalkerSku;
  suggestion: WalkerParSuggestion;
  locationId: string;
  dayClass: "weekday" | "weekend";
  shadowMode: boolean;
  /** The parent re-runs the row's order qty through the ONE engine and refreshes. */
  onAccepted: (skuId: string, newPar: number, newQty: number | null) => void;
}) {
  const { t, language } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // D16: a day-class with no par slot is reported in the AGGREGATE only, never as a
  // row-level number. The server already refuses to emit one; this is the second lock.
  if (suggestion.slotCreation) return null;

  const day = formatDateLabel(suggestion.coverThroughDate, language);
  const pct = Math.round(suggestion.cushionPct * 100);
  const isAuto = suggestion.tier === "auto";
  const busy = status.kind === "busy";

  const act = async (action: "accept" | "dismiss") => {
    if (busy) return;
    setStatus({ kind: "busy" });
    try {
      const res = await fetch("/api/operations/ordering/suggestion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locationId,
          skuId: sku.skuId,
          dayClass,
          generationId: suggestion.generationId,
          action,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { code?: string; par?: number };
      if (!res.ok) {
        const code = j?.code ?? "generic";
        setStatus({
          kind: "error",
          message:
            code === "suggestion_superseded"
              ? t("ordering.suggestion.superseded")
              : t(
                  ("ordering.error." + (KNOWN_ERRORS.has(code) ? code : "generic")) as TranslationKey,
                ),
        });
        return;
      }
      if (action === "dismiss") {
        setStatus({ kind: "dismissed", par: suggestion.currentPar });
        return;
      }
      const newPar = j.par ?? suggestion.suggestedPar;
      setStatus({ kind: "accepted", par: newPar });
      // THE ONE ENGINE, re-run on the client with the number the server just wrote.
      onAccepted(sku.skuId, newPar, suggestedOrderQty(newPar, sku.advisoryOnHand?.orderUnits ?? null));
    } catch {
      setStatus({ kind: "error", message: t("ordering.error.generic") });
    }
  };

  return (
    <div
      className="mt-2 rounded-lg border-2 border-co-gold-deep bg-co-gold/20 px-3 py-2"
      role="group"
      aria-label={t("ordering.suggestion.pair_aria", {
        sku: sku.name,
        current: suggestion.currentPar,
        suggested: suggestion.suggestedPar,
        day,
      })}
    >
      {/* THE PAIR. In shadow an auto-tier row says WOULD — the par has not moved. */}
      <p className="text-[13px] font-bold text-co-text">
        {isAuto && shadowMode
          ? t("ordering.shadow.would_tune", {
              current: suggestion.currentPar,
              suggested: suggestion.suggestedPar,
            })
          : isAuto
            ? t("ordering.auto.tuned", {
                current: suggestion.currentPar,
                suggested: suggestion.suggestedPar,
              })
            : t("ordering.suggestion.pair", {
                current: suggestion.currentPar,
                suggested: suggestion.suggestedPar,
              })}
      </p>

      {/* THE REASON, in kitchen language. One clause per fact, SEPARATE KEYS — never
          string concatenation, which does not survive translation. */}
      <p className="mt-0.5 text-[12px] text-co-gold-text">
        {t("ordering.suggestion.reason_coverage", {
          suggested: suggestion.suggestedPar,
          day,
          pct,
        })}
      </p>
      {suggestion.velocityApplied && (
        <p className="text-[12px] text-co-gold-text">{t("ordering.suggestion.reason_velocity")}</p>
      )}
      {suggestion.flooredByPeak && (
        <p className="text-[12px] text-co-gold-text">{t("ordering.suggestion.reason_peak_floor")}</p>
      )}
      {suggestion.reasonCode === "below_band_resolution" && (
        <p className="text-[12px] text-co-text-muted">{t("ordering.suggestion.manual_only")}</p>
      )}

      {/* THE AFFORDANCES. Operational grammar (ActionButton): rounded-xl, 48px, 0.1em. */}
      {status.kind === "accepted" ? (
        <p role="status" className="mt-1.5 text-[12px] font-bold text-co-confirm-text">
          {t("ordering.suggestion.accepted", { n: status.par })}
        </p>
      ) : status.kind === "dismissed" ? (
        <p role="status" className="mt-1.5 text-[12px] text-co-text-muted">
          {t("ordering.suggestion.dismissed", { n: status.par })}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ActionButton
            variant="primary"
            onClick={() => void act("accept")}
            disabled={!suggestion.canAct || busy}
            title={suggestion.canAct ? undefined : t("ordering.suggestion.no_permission")}
            aria-label={t("ordering.suggestion.accept_aria", {
              sku: sku.name,
              n: suggestion.suggestedPar,
            })}
          >
            {busy
              ? t("ordering.suggestion.working")
              : t("ordering.suggestion.accept", { n: suggestion.suggestedPar })}
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={() => void act("dismiss")}
            disabled={!suggestion.canAct || busy}
            title={suggestion.canAct ? undefined : t("ordering.suggestion.no_permission")}
            aria-label={t("ordering.suggestion.dismiss_aria", {
              sku: sku.name,
              n: suggestion.currentPar,
            })}
          >
            {t("ordering.suggestion.dismiss")}
          </ActionButton>
          {/* THE UNDO, ON AN AUTO ROW ONLY, AND DISABLED WHILE NOTHING IS APPLIED.
              Rendered rather than hidden so the affordance is discoverable before the
              write bit flips — and its title says exactly why it cannot be pressed. */}
          {isAuto && (
            <ActionButton
              variant="secondary"
              disabled
              title={
                shadowMode
                  ? t("ordering.shadow.revert_disabled")
                  : t("ordering.auto.revert_aria", { sku: sku.name, n: suggestion.currentPar })
              }
              aria-label={t("ordering.auto.revert_aria", {
                sku: sku.name,
                n: suggestion.currentPar,
              })}
            >
              {t("ordering.auto.revert")}
            </ActionButton>
          )}
        </div>
      )}

      {status.kind === "error" && (
        <p role="alert" className="mt-1.5 text-[12px] font-bold text-co-cta-text">
          {status.message}
        </p>
      )}
    </div>
  );
}
