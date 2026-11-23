"use client";

/**
 * Catering delivery D3 — the delivery state chip on a pipeline card.
 *
 * The page reads every listed lead's state in ONE batched read (`loadPipelineDeliveryStates`, gated like the status
 * read) and hands the map to `DeliveryStatesProvider`; a card asks for its own lead by id. No provider, no entry for the
 * lead, or the state `none` = NO chip (delivery tracking off, a shop that is off, a viewer the gate refuses, a pickup
 * order). The words come from the one label rule (`deliveryLabel`); status only — no courier, no reference, no cost.
 */
import { createContext, useContext, type ReactNode } from "react";
import { deliveryLabel, type DeliveryRowState, type DeliveryTone } from "@/lib/delivery/day-shared";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";

const DeliveryStatesContext = createContext<Readonly<Record<string, DeliveryRowState>> | null>(null);

export function DeliveryStatesProvider({ states, children }: { states: Readonly<Record<string, DeliveryRowState>> | null; children: ReactNode }) {
  return <DeliveryStatesContext.Provider value={states}>{children}</DeliveryStatesContext.Provider>;
}

/** Fill and text split the same way every status colour does: a pale surface, the matching TEXT role on it. */
export const DELIVERY_CHIP_TONE: Record<DeliveryTone, string> = {
  alert: "bg-co-danger-surface text-co-cta-text",
  warn: "bg-co-warning-surface text-co-warning-text",
  ok: "bg-co-success-surface text-co-confirm-text",
  muted: "border border-co-border bg-co-surface text-co-text-muted",
};

export function DeliveryStateChip({ leadId }: { leadId: string }) {
  const states = useContext(DeliveryStatesContext);
  const { t, language } = useTranslation();
  const row = states?.[leadId];
  const label = deliveryLabel(row);
  if (!row || !label) return null;
  const text = t(label.key, label.time ? { time: formatTime(label.time, language) } : undefined);
  return (
    <span
      data-testid="delivery-state-chip"
      data-delivery-state={row.state}
      aria-label={t("catering.delivery_state.aria", { state: text })}
      className={`ml-1 mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium ${DELIVERY_CHIP_TONE[label.tone]}`}
    >
      {text}
    </span>
  );
}
