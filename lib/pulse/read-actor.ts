import "server-only";
import type { AuthContext } from "@/lib/session";
import { canReadPulseLocation, PULSE_V2_BASE_LEVEL } from "./scope-shared";

const brand: unique symbol = Symbol("pulse-read");
/** An opaque read capability, deliberately incompatible with every operational actor. */
export interface PulseScopedReadActor {
  readonly kind: "pulse-read";
  readonly [brand]: true;
}
interface ReadScope {
  locationId: string;
  userId: string;
  level: number;
  language: AuthContext["user"]["language"];
}
const scopes = new WeakMap<PulseScopedReadActor, Readonly<ReadScope>>();

/** Mint only from verified session context, after the Pulse grant passes. Never adds membership. */
export function pulseReadActor(auth: AuthContext, locationId: string): PulseScopedReadActor {
  if (auth.level < PULSE_V2_BASE_LEVEL || !canReadPulseLocation(auth, locationId)) {
    throw new Error("location_access_denied");
  }
  const actor: PulseScopedReadActor = Object.freeze({ kind: "pulse-read", [brand]: true as const });
  scopes.set(actor, Object.freeze({ locationId, userId: auth.user.id, level: auth.level, language: auth.user.language }));
  return actor;
}

/** Recognize even a copied marker so it cannot fall through to an operational/write grant. */
export function isPulseReadActor(actor: object): actor is PulseScopedReadActor {
  return "kind" in actor && actor.kind === "pulse-read";
}

/** Only the three Pulse source readers accept this capability. Copies/forgeries fail closed. */
export function requirePulseReadScope(actor: PulseScopedReadActor, locationId: string, minLevel = PULSE_V2_BASE_LEVEL): Readonly<ReadScope> {
  const scope = scopes.get(actor);
  if (!scope || scope.locationId !== locationId || scope.level < minLevel) throw new Error("location_access_denied");
  return scope;
}
