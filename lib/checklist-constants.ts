/**
 * Client-safe checklist constants + pure gate predicate (zero I/O, no server
 * imports) — shared by the server lock-up gate (lib/checklists.ts confirmInstance),
 * the client finalize affordance (closing-client.tsx), and the vitest suite, so
 * the security-critical system-keys and gate LOGIC can never drift between them.
 * Pinned by tests/checklists-finalize-gate.test.ts.
 */

/**
 * The "I'm the last out" station key (C.38 system-key — ENGLISH, never
 * translated; a Spanish-resolved "Verificación de Salida" must never be matched
 * on a key path or the finalize gate breaks for es users). confirmInstance's
 * lock-up gate and the client's walkOutVerificationComplete both match on this.
 */
export const WALK_OUT_VERIFICATION_STATION = "Walk-Out Verification";

/** Verdict of the closing lock-up gate. */
export type LockUpGateResult =
  | { ok: true }
  | { ok: false; reason: "role" }
  | { ok: false; reason: "walk_out"; incompleteItemIds: string[] };

/**
 * The closing lock-up gate as a PURE predicate (hardening 2026-07-31, council
 * P1 — extracted for unit-testability per the adversarial review C1). Enforces
 * the C.26 invariant confirmInstance previously left client-only: for a CLOSING
 * template, the confirmer must be a key holder (level ≥ floor) AND every active
 * Walk-Out Verification station item must be completed. Non-closing templates
 * pass (they finalize via their own paths). The Walk-Out check is skipped when
 * the station has no items (a misconfig the Doctor flags; blocking on it would
 * brick a valid close). confirmInstance does the I/O + audit + throw around
 * this verdict; the security LOGIC lives here and is CI-covered.
 */
export function evaluateLockUpGate(args: {
  templateType: string;
  actorLevel: number;
  floorLevel: number;
  items: ReadonlyArray<{ id: string; station: string | null }>;
  completedItemIds: ReadonlySet<string>;
}): LockUpGateResult {
  if (args.templateType !== "closing") return { ok: true };
  if (args.actorLevel < args.floorLevel) return { ok: false, reason: "role" };
  const walkOut = args.items.filter((it) => it.station === WALK_OUT_VERIFICATION_STATION);
  const incompleteItemIds = walkOut.filter((it) => !args.completedItemIds.has(it.id)).map((it) => it.id);
  if (walkOut.length > 0 && incompleteItemIds.length > 0) return { ok: false, reason: "walk_out", incompleteItemIds };
  return { ok: true };
}
