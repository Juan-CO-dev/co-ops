"use client";

/**
 * Catering delivery D3 — the delivery state chip on a pipeline card.
 *
 * The page reads every listed lead's state in ONE batched read (`loadPipelineDeliveryStates`, gated like the status
 * read) and hands the map to `DeliveryStatesProvider`; a card asks for its own lead by id. No provider, no entry for the
 * lead, or the state `none` = NO chip (delivery tracking off, a shop that is off, a viewer the gate refuses, a pickup
 * order). The words come from the one label rule (`deliveryLabel`); status only — no courier, no reference, no cost.
 *
 * THE CHIP AND THE PANEL ALWAYS AGREE (review rounds 5 and 6). The lead's Delivery panel, in the same card, publishes the
 * OUTCOME of every completed load of its own GET (`usePublishDeliveryState`) — on opening, and after each write — and
 * the chip shows what was published over the server's map: the lead's state; "Couldn't load delivery" when the load
 * failed (never the old state); nothing when the answer is off / not installed / nothing to see. The state is the
 * server's each time (`deliveryStateOf` behind the GET): nothing is derived in the browser, and the board is not
 * refreshed for a tap. The store and its rules are pure
 * (`lib/delivery/chip-shared.ts`). A NEW server map (a real reload, a `router.refresh()`) supersedes what was published
 * before it: adopted during render by comparing with the map the store holds, never in an effect.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { adoptServer, chipStateOf, chipStore, publishedOutcomeOf, publishState, type ChipStates, type ChipStore, type PanelLoadOutcome } from "@/lib/delivery/chip-shared";
import { deliveryLabel, type DeliveryTone } from "@/lib/delivery/day-shared";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";

interface ChipContext { store: ChipStore; publish(leadId: string, outcome: PanelLoadOutcome): void }
const DeliveryStatesContext = createContext<ChipContext | null>(null);

export function DeliveryStatesProvider({ states, children }: { states: ChipStates | null; children: ReactNode }) {
  const [held, setHeld] = useState<ChipStore>(() => chipStore(states));
  // A new server map supersedes what was published before it. During render, by comparing with the map the store holds
  // (router.refresh() does not reset this state; an effect would paint the stale chip first).
  const store = adoptServer(held, states);
  if (store !== held) setHeld(store);
  const publish = useCallback((leadId: string, outcome: PanelLoadOutcome) => {
    const published = publishedOutcomeOf(outcome);
    setHeld((s) => publishState(s, leadId, published));
  }, []);
  const value = useMemo(() => ({ store, publish }), [store, publish]);
  return <DeliveryStatesContext.Provider value={value}>{children}</DeliveryStatesContext.Provider>;
}

const NO_PUBLISH = (): void => undefined;
/**
 * For the Delivery panel: hand it the outcome of every COMPLETED load of its own GET — `{ loaded: view }` or
 * `{ failed: true }`. Each one is published to the card's chip (status only). An aborted load and a write with no load
 * after it are not outcomes: do not call it for them. Outside a provider it does nothing.
 */
export function usePublishDeliveryState(): (leadId: string, outcome: PanelLoadOutcome) => void {
  return useContext(DeliveryStatesContext)?.publish ?? NO_PUBLISH;
}

/** Fill and text split the same way every status colour does: a pale surface, the matching TEXT role on it. */
export const DELIVERY_CHIP_TONE: Record<DeliveryTone, string> = {
  alert: "bg-co-danger-surface text-co-cta-text",
  warn: "bg-co-warning-surface text-co-warning-text",
  ok: "bg-co-success-surface text-co-confirm-text",
  muted: "border border-co-border bg-co-surface text-co-text-muted",
};

export function DeliveryStateChip({ leadId }: { leadId: string }) {
  const ctx = useContext(DeliveryStatesContext);
  const { t, language } = useTranslation();
  const row = ctx ? chipStateOf(ctx.store, leadId) : undefined;
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
