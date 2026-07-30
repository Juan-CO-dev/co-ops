/**
 * Client-safe checklist constants (zero I/O, no server imports) — shared by the
 * server lock-up gate (lib/checklists.ts confirmInstance) AND the client finalize
 * affordance (closing-client.tsx) so the security-critical system-keys can never
 * drift between the two. Pinned by tests/checklists-finalize-gate.test.ts.
 */

/**
 * The "I'm the last out" station key (C.38 system-key — ENGLISH, never
 * translated; a Spanish-resolved "Verificación de Salida" must never be matched
 * on a key path or the finalize gate breaks for es users). confirmInstance's
 * lock-up gate and the client's walkOutVerificationComplete both match on this.
 */
export const WALK_OUT_VERIFICATION_STATION = "Walk-Out Verification";
