/**
 * Mid-shift Pulse v2 — PURE page resolution (which mode, which shop(s)), shared by the home and the
 * section pages so both answer the same way. The v1 page's rule stands: the requested shop must be
 * one the actor may view (lockLocationContext honours the 9+ all-locations grant) AND one of the
 * active shops the page listed — the loaders run on the service role, so this is the gate.
 */
import { BOTH_SHOPS_LEVEL, canReadPulseLocation, type PulseReadActor } from "@/lib/pulse/scope-shared";
import { pickShopId } from "@/lib/shop-context-shared";

export interface PulseLocation { id: string; code: string; name: string }

export const BOTH = "both";

/**
 * The requested shop must pass the PULSE read grant (8+ any shop, else membership) AND be a listed active shop.
 * With no ?location=, the default is the remembered shop when listed, else the first (B2, lib/shop-context-shared.ts).
 */
export function resolveRequestedLocation(args: { requested: string | undefined; accessible: readonly PulseLocation[]; actor: PulseReadActor; remembered?: string | null }): string | null {
  const requested = args.requested ?? pickShopId({ allowed: args.accessible.map((l) => l.id), remembered: args.remembered });
  if (!requested) return null;
  return canReadPulseLocation(args.actor, requested) && args.accessible.some((l) => l.id === requested) ? requested : null;
}

/** Which panels the home renders: `both` (8+ with 2+ shops; the default for them) or one shop. */
export function resolvePulsePanels(args: { requested: string | undefined; accessible: readonly PulseLocation[]; actor: PulseReadActor; remembered?: string | null }): PulseLocation[] | null {
  const canBoth = args.actor.level >= BOTH_SHOPS_LEVEL && args.accessible.length > 1;
  if (canBoth && (args.requested === BOTH || args.requested === undefined)) return [...args.accessible];
  const id = resolveRequestedLocation({ requested: args.requested === BOTH ? undefined : args.requested, accessible: args.accessible, actor: args.actor, remembered: args.remembered });
  if (!id) return null;
  return args.accessible.filter((l) => l.id === id);
}
