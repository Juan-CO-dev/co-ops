/**
 * Demand signals (item 4 PR 7): THE AI SPEND LEDGER'S STORE. Server-only. The one module that talks to 0352.
 * It writes no table: every write is one of 0352's definer functions (DEMAND_AI_RPCS), which re-read the
 * actor's role and shop, hold the cap under one lock, and allow one attempt per shop per ET day.
 * 0352 not applied answers `demand_ai_unavailable` (503); every other refusal is 0352's own name.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredInsightClaim } from "./insights-shared";

export const DEMAND_AI_RPCS = ["demand_ai_reserve", "demand_ai_settle", "demand_ai_today"] as const;
type Rpc = (typeof DEMAND_AI_RPCS)[number];

export class DemandAiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = "DemandAiError"; }
}
const REFUSALS: Record<string, number> = {
  demand_ai_forbidden: 403, demand_ai_shop_forbidden: 403, demand_ai_invalid: 400, demand_ai_unknown: 404,
  demand_ai_daily_limit: 409, demand_ai_cap_reached: 409, demand_ai_settled: 409,
};
type RpcError = { code?: string; message?: string };
const notInstalled = (e: RpcError) => e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");
function toError(e: RpcError): DemandAiError {
  if (notInstalled(e)) return new DemandAiError(503, "demand_ai_unavailable");
  const message = e.message ?? "";
  const name = Object.keys(REFUSALS).find((n) => message === n || new RegExp(`(^|[^a-z_])${n}($|[^a-z_])`).test(message));
  return name ? new DemandAiError(REFUSALS[name]!, name) : new DemandAiError(500, "generic");
}
async function call<T>(sb: SupabaseClient, name: Rpc, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw toError(error);
  return data as T;
}

export interface AiReservation { id: string; dayEt: string; monthSpentBeforeMicro: number }
/** Set the worst case aside BEFORE the call. Refused by name when the day is used, the cap is reached or the actor may not. */
export async function reserveAiCall(sb: SupabaseClient, args: { actorId: string; locationId: string; inputHash: string; model: string; promptVersion: number; reserveMicro: number; capMicro: number }): Promise<AiReservation> {
  const out = await call<{ id: string; day_et: string; month_spent_before_micro: number | string }>(sb, "demand_ai_reserve", {
    p_actor: args.actorId, p_location_id: args.locationId, p_input_hash: args.inputHash, p_model: args.model, p_prompt_version: args.promptVersion,
    p_reserve_micro: args.reserveMicro, p_cap_micro: args.capMicro });
  return { id: out.id, dayEt: out.day_et, monthSpentBeforeMicro: Number(out.month_spent_before_micro) };
}

export type AiSettlement =
  | { outcome: "ok"; inputTokens: number; outputTokens: number; actualMicro: number; stopReason: string | null; claims: StoredInsightClaim[]; rejected: number }
  | { outcome: "failed"; errorCode: string };
/** Record what the call really cost and the claims that passed. A reservation that is never settled stands in full. */
export async function settleAiCall(sb: SupabaseClient, reservationId: string, s: AiSettlement): Promise<void> {
  const stop = s.outcome === "ok" && s.stopReason !== null && /^[a-z_]{1,40}$/.test(s.stopReason) ? s.stopReason : null;
  await call(sb, "demand_ai_settle", s.outcome === "ok"
    ? { p_reservation_id: reservationId, p_outcome: "ok", p_input_tokens: s.inputTokens, p_output_tokens: s.outputTokens, p_actual_micro: s.actualMicro,
      p_stop_reason: stop, p_error_code: null, p_claims: s.claims, p_rejected_count: s.rejected }
    : { p_reservation_id: reservationId, p_outcome: "failed", p_input_tokens: null, p_output_tokens: null, p_actual_micro: null,
      p_stop_reason: null, p_error_code: /^[a-z_]{1,40}$/.test(s.errorCode) ? s.errorCode : "failed", p_claims: [], p_rejected_count: 0 });
}

export interface AiAttempt {
  id: string; inputHash: string; model: string; promptVersion: number; reservedAt: string; settled: boolean;
  outcome: "ok" | "failed" | null; stopReason: string | null; errorCode: string | null; claims: unknown; rejectedCount: number; settledAt: string | null;
}
export interface AiToday { dayEt: string; attempt: AiAttempt | null; monthSpentMicro: number; capCeilingMicro: number }
/** Today's attempt for one shop (if any) and what this ET month has cost so far. */
export async function loadAiToday(sb: SupabaseClient, locationId: string): Promise<AiToday> {
  const out = await call<{ day_et: string; attempt: Record<string, unknown> | null; month_spent_micro: number | string; cap_ceiling_micro: number | string }>(sb, "demand_ai_today", { p_location_id: locationId });
  const a = out.attempt;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    dayEt: out.day_et, monthSpentMicro: Number(out.month_spent_micro), capCeilingMicro: Number(out.cap_ceiling_micro),
    attempt: a === null || a === undefined ? null : {
      id: String(a.id), inputHash: String(a.input_hash), model: String(a.model), promptVersion: Number(a.prompt_version), reservedAt: String(a.reserved_at),
      settled: a.settled === true, outcome: a.outcome === "ok" || a.outcome === "failed" ? a.outcome : null, stopReason: text(a.stop_reason), errorCode: text(a.error_code),
      claims: a.claims, rejectedCount: Number(a.rejected_count ?? 0), settledAt: text(a.settled_at) },
  };
}
