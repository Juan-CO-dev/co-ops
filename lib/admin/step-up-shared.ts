/**
 * Step-up — CLIENT-SAFE pure surface (no I/O, no env, no server imports). Catalog redesign
 * Phase 1, 2026-10-15, revised after Astra r1.
 *
 * THREE TIERS, TWO CLOCKS:
 *   A — the shared flag (sessions.step_up_unlocked) is set, any age.
 *   B — the shared flag is set and step_up_unlocked_at is within 120 s; the client ALWAYS prompts.
 *   E — the catalog/recipe EDIT WINDOW, on its OWN clock (sessions.catalog_edit_unlocked_at,
 *       0257): stamped only by a password typed on the admin surface. A FIXED 15 minutes from
 *       that password — never extended, never cleared by navigation or background requests
 *       (Astra r2 design decision); it ends at expiry or with the session.
 *
 * DESTRUCTIVE CATALOG ACTS (retire a product, delete a recipe, deactivate a SKU) take neither:
 * they need a ONE-SHOT GRANT — minted by the step-up POST for exactly one (action, target),
 * bound to the session and user, consumed atomically by the route, 120 s TTL — so no window
 * and no earlier password can stand in for "ask every time" (Astra r1 P1-1).
 */
export type StepUpTier = "A" | "B" | "E";

export const GRANT_ACTIONS = ["product.retire", "recipe.delete", "sku.deactivate"] as const;
export type GrantAction = (typeof GRANT_ACTIONS)[number];
export interface StepUpPurpose {
  action: GrantAction;
  targetId: string;
}
/** What a client asks for before a write: a tier, or a one-shot purpose. */
export type StepUpGate = StepUpTier | StepUpPurpose;

export const DEFAULT_FRESH_SECONDS = 120;
export const DEFAULT_EDIT_WINDOW_SECONDS = 15 * 60;
export const DEFAULT_EDIT_WINDOW_MS = DEFAULT_EDIT_WINDOW_SECONDS * 1000;
/** The client gives up this much of the window so it never proceeds into a server-side stale. */
export const CLIENT_EDIT_WINDOW_MARGIN_MS = 30_000;
export const GRANT_TTL_MS = 120_000;

/** A positive whole-second env value, else the fallback. */
export function parseWindowSeconds(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Tier B's rule (unchanged): a real instant, not after `now`, and AT MOST `windowMs` old (inclusive). */
export function isFreshWithin(at: string | null, now: number, windowMs: number): boolean {
  if (!at) return false;
  const age = now - Date.parse(at);
  return !Number.isNaN(age) && age >= 0 && age <= windowMs;
}

/** Tier E's rule: a real instant, not after `now`, and STRICTLY less than `windowMs` old — the
 *  deadline is EXCLUSIVE, so at exactly 15:00 the window is already closed (Astra r3 #2). */
export function isInsideWindow(at: string | null, now: number, windowMs: number): boolean {
  if (!at) return false;
  const age = now - Date.parse(at);
  return !Number.isNaN(age) && age >= 0 && age < windowMs;
}

/** What a successful password does to this device's memory (pure, so the provider's own modal
 *  and any reactive admin modal record a confirm the same way — Astra r3 #1). */
export function confirmClientUnlock(unlock: ClientUnlock, nowIso: string, catalogWindow: boolean): ClientUnlock {
  return { unlocked: true, catalogUnlockedAt: catalogWindow ? nowIso : unlock.catalogUnlockedAt };
}

/** This device's memory of the two clocks. Advisory: the server re-checks every write. */
export interface ClientUnlock {
  unlocked: boolean;
  catalogUnlockedAt: string | null;
}

/** May this request skip the password prompt? */
export function stepUpDecision(
  tier: StepUpTier,
  unlock: ClientUnlock,
  now: number = Date.now(),
  editWindowMs: number = DEFAULT_EDIT_WINDOW_MS,
): "proceed" | "prompt" {
  if (tier === "A") return unlock.unlocked ? "proceed" : "prompt";
  if (tier === "E") {
    return isInsideWindow(unlock.catalogUnlockedAt, now, editWindowMs - CLIENT_EDIT_WINDOW_MARGIN_MS) ? "proceed" : "prompt";
  }
  return "prompt";
}

/** The two window codes assertStepUp answers with. On either, the client forgets its unlock. */
export function isStepUpRefusal(code: string | null | undefined): boolean {
  return code === "step_up_required" || code === "step_up_stale";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A grant target is a uuid. The destructive routes check the path id with this BEFORE touching a
 *  grant, so a malformed id is a 400 and never reaches the uuid column (a 22P02 → 500). */
export function isUuid(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw);
}

/** The step-up POST's optional `purpose`: null when absent, "invalid" when malformed. */
export function parseStepUpPurpose(raw: unknown): StepUpPurpose | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const r = raw as Record<string, unknown>;
  if (typeof r.action !== "string" || !(GRANT_ACTIONS as readonly string[]).includes(r.action)) return "invalid";
  if (typeof r.targetId !== "string" || !UUID_RE.test(r.targetId)) return "invalid";
  return { action: r.action as GrantAction, targetId: r.targetId };
}

export function grantExpiresAt(now: Date): Date {
  return new Date(now.getTime() + GRANT_TTL_MS);
}

