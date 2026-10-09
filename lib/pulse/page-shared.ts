/**
 * Mid-shift Pulse v2 — PURE page resolution (which mode, which shop(s)), shared by the home and the
 * section pages so both answer the same way. The v1 page's rule stands: the requested shop must be
 * one the actor may view (lockLocationContext honours the 9+ all-locations grant) AND one of the
 * active shops the page listed — the loaders run on the service role, so this is the gate.
 */
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { BOTH_SHOPS_LEVEL } from "@/lib/pulse/scope-shared";

export interface PulseLocation { id: string; code: string; name: string }

export const BOTH = "both";

export function resolveRequestedLocation(args: { requested: string | undefined; accessible: readonly PulseLocation[]; actor: LocationActor }): string | null {
  const requested = args.requested ?? args.accessible[0]?.id ?? null;
  if (!requested) return null;
  return lockLocationContext(args.actor, requested) && args.accessible.some((l) => l.id === requested) ? requested : null;
}

/** Which panels the home renders: `both` (8+ with 2+ shops; the default for them) or one shop. */
export function resolvePulsePanels(args: { requested: string | undefined; accessible: readonly PulseLocation[]; actor: LocationActor; level: number }): PulseLocation[] | null {
  const canBoth = args.level >= BOTH_SHOPS_LEVEL && args.accessible.length > 1;
  if (canBoth && (args.requested === BOTH || args.requested === undefined)) return [...args.accessible];
  const id = resolveRequestedLocation({ requested: args.requested === BOTH ? undefined : args.requested, accessible: args.accessible, actor: args.actor });
  if (!id) return null;
  return args.accessible.filter((l) => l.id === id);
}
