/**
 * Demand signals (item 4 PR 7): AI INSIGHTS, the one path a call takes. It reads no table and no environment
 * and makes no request itself: the store, the model client and the configuration are handed in.
 *
 * THE ORDER, and nothing may be skipped or reordered:
 *   1. the configuration says `ready` (the switch, this feature's own key, a priced model) or NOTHING happens;
 *   2. the facts were built from a WHOLE read and fit the size limit;
 *   3. the cap leaves room for the worst case (a cap of 0 never reaches the database);
 *   4. RESERVE the worst case (0352: one attempt per shop per ET day, the month's cap under one lock, the actor
 *      re-read on the row). A refusal ends here: no request was made;
 *   5. ONE call, bounded (output limit, timeout) and NEVER retried: a retry's first attempt could be billed and
 *      never accounted, so one reservation covers exactly one request;
 *   6. the answer goes through `parseModelClaims` then `acceptClaims` (which ends in `validateInsightClaims`):
 *      only a claim type and fact ids survive. `MODEL_FREE_TEXT_RENDERED` is false: no text the model wrote is
 *      returned, stored or logged;
 *   7. SETTLE with the real usage and the accepted claims. A call that failed is settled `failed` (its cost is
 *      unknown, so its whole reservation stands). If the settle itself fails, the reservation stands in full
 *      and the answer is NOT shown (the page renders from the stored row only).
 * NEVER AUTO-ACTS: this is called by one route, when a person asks. Its result is rendered and nothing else.
 */
import { MODEL_FREE_TEXT_RENDERED } from "./contracts-shared";
import type { AskArgs, AskResult } from "./ai-client";
import type { AiReservation, AiSettlement, AiToday } from "./ai-store";
import { addressOf } from "./hash";
import {
  DEMAND_AI_MAX_INPUT_BYTES, DEMAND_AI_MAX_OUTPUT_TOKENS, DEMAND_AI_TIMEOUT_MS, INSIGHT_AUDIENCE_POLICY, INSIGHT_OUTPUT_SCHEMA,
  INSIGHT_PROMPT_VERSION, INSIGHT_SYSTEM, acceptClaims, actualMicro, insightInputBytes, insightUserMessage, parseModelClaims, readStoredClaims, supportedNow, worstCaseMicro,
  type AiConfig, type AiStatus, type InsightFact, type InsightFactsResult, type StoredInsightClaim,
} from "./insights-shared";

export interface InsightDeps {
  reserve: (args: { actorId: string; locationId: string; inputHash: string; model: string; promptVersion: number; reserveMicro: number; capMicro: number }) => Promise<AiReservation>;
  settle: (reservationId: string, settlement: AiSettlement) => Promise<void>;
  ask: (args: AskArgs) => Promise<AskResult>;
}

/** What a call is: the facts and everything that shapes the answer. Two requests with the same hash are the same question. */
export function insightInputHash(args: { today: string; facts: ReadonlyArray<InsightFact>; model: string }): string {
  return addressOf({ audience: INSIGHT_AUDIENCE_POLICY, facts: args.facts, model: args.model, promptVersion: INSIGHT_PROMPT_VERSION,
    schema: INSIGHT_OUTPUT_SCHEMA, system: INSIGHT_SYSTEM, today: args.today }).hash;
}

export type InsightRequestResult =
  | { ok: true; claims: StoredInsightClaim[]; rejected: number }
  | { ok: false; status: number; code: string };

export async function requestInsights(deps: InsightDeps, args: {
  config: AiConfig; apiKey: string | undefined; actorId: string; locationId: string; today: string; facts: InsightFactsResult;
}): Promise<InsightRequestResult> {
  if (MODEL_FREE_TEXT_RENDERED) throw new Error("model_free_text_must_stay_off");
  const { config } = args;
  if (config.status !== "ready" || !args.apiKey || args.apiKey.trim() === "") {
    return { ok: false, status: 503, code: config.status === "ready" ? "demand_ai_not_configured" : `demand_ai_${config.status}` };
  }
  if (!args.facts.ok) return { ok: false, status: args.facts.code === "input_too_large" ? 413 : 409, code: `demand_ai_${args.facts.code}` };
  const facts = args.facts.facts;
  const user = insightUserMessage({ today: args.today, facts });
  const bytes = insightInputBytes(user);
  if (bytes > DEMAND_AI_MAX_INPUT_BYTES) return { ok: false, status: 413, code: "demand_ai_input_too_large" };
  const reserveMicro = worstCaseMicro(config.model, bytes);
  if (reserveMicro === null) return { ok: false, status: 503, code: "demand_ai_model_unpriced" };
  if (config.capMicro < reserveMicro) return { ok: false, status: 409, code: "demand_ai_cap_reached" };

  // From here a refusal is the store's own (thrown as DemandAiError; the route answers it by name).
  const reservation = await deps.reserve({ actorId: args.actorId, locationId: args.locationId, inputHash: insightInputHash({ today: args.today, facts, model: config.model }),
    model: config.model, promptVersion: INSIGHT_PROMPT_VERSION, reserveMicro, capMicro: config.capMicro });

  let answer: AskResult;
  try {
    answer = await deps.ask({ apiKey: args.apiKey, model: config.model, system: INSIGHT_SYSTEM, user, schema: INSIGHT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: DEMAND_AI_MAX_OUTPUT_TOKENS, timeoutMs: DEMAND_AI_TIMEOUT_MS });
  } catch {
    answer = { ok: false, code: "ai_unavailable" };
  }
  if (!answer.ok) {
    try { await deps.settle(reservation.id, { outcome: "failed", errorCode: answer.code }); } catch { /* the reservation stands in full */ }
    return { ok: false, status: 502, code: `demand_${answer.code}` };
  }
  const cost = actualMicro(config.model, { inputTokens: answer.inputTokens, outputTokens: answer.outputTokens });
  const parsed = parseModelClaims(answer.text);
  const { accepted, rejected } = parsed === null ? { accepted: [] as StoredInsightClaim[], rejected: 0 } : acceptClaims(parsed, facts);
  try {
    if (cost === null) await deps.settle(reservation.id, { outcome: "failed", errorCode: "usage_unreadable" });
    else await deps.settle(reservation.id, { outcome: "ok", inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, actualMicro: cost,
      stopReason: parsed === null ? "answer_unreadable" : answer.stopReason, claims: accepted, rejected });
  } catch {
    return { ok: false, status: 502, code: "demand_ai_not_recorded" };
  }
  if (cost === null) return { ok: false, status: 502, code: "demand_ai_usage_unreadable" };
  if (parsed === null) return { ok: false, status: 502, code: "demand_ai_answer_unreadable" };
  return { ok: true, claims: accepted, rejected };
}

/** What the page shows about AI insights. `off` renders nothing at all. */
export type InsightsView =
  | { status: Exclude<AiStatus, "ready" | "off"> }
  | { status: "unavailable" }
  /** The ledger could not be read just now. Nothing is offered, and nothing is claimed about today or the month. */
  | { status: "unreadable" }
  | {
    status: "ready";
    /** Why a request cannot be made now, if it cannot: the facts, or the day already used. null = it can. */
    blocked: "facts_incomplete" | "nothing_to_say" | "input_too_large" | "asked_today" | "cap_reached" | null;
    /** Today's stored answer, rendered from the row. null = none asked today. */
    /**
     * `claims` = the stored claims' facts that are STILL among the page's facts now (`supportedNow`); `dropped` = how
     * many cited facts are no longer on the page (a revoked source, an event taken back) and so are not shown.
     */
    attempt: { state: "ok" | "failed" | "pending"; claims: StoredInsightClaim[]; dropped: number; rejected: number; askedAt: string; factsChanged: boolean } | null;
    monthSpentMicro: number;
    capMicro: number;
  };

/** The insights section's state, from the configuration, the stored row for today and the facts as they are now. */
export function insightsView(args: { config: AiConfig; today: AiToday | "unavailable" | "unreadable"; facts: InsightFactsResult; todayEt: string }): InsightsView | null {
  const { config } = args;
  if (config.status === "off") return null;
  if (config.status !== "ready") return { status: config.status };
  if (args.today === "unavailable" || args.today === "unreadable") return { status: args.today };
  const a = args.today.attempt;
  const currentHash = args.facts.ok ? insightInputHash({ today: args.todayEt, facts: args.facts.facts, model: config.model }) : null;
  const user = args.facts.ok ? insightUserMessage({ today: args.todayEt, facts: args.facts.facts }) : null;
  const worst = user === null ? null : worstCaseMicro(config.model, insightInputBytes(user));
  const blocked = a !== null ? "asked_today" as const
    : !args.facts.ok ? args.facts.code
      : worst === null || insightInputBytes(user!) > DEMAND_AI_MAX_INPUT_BYTES ? "input_too_large" as const
        : args.today.monthSpentMicro + worst > config.capMicro ? "cap_reached" as const : null;
  return {
    status: "ready", blocked, monthSpentMicro: args.today.monthSpentMicro, capMicro: config.capMicro,
    attempt: a === null ? null : attemptView(a, currentHash, args.facts.ok ? args.facts.facts : null),
  };
}

function attemptView(a: NonNullable<AiToday["attempt"]>, currentHash: string | null, current: ReadonlyArray<InsightFact> | null): NonNullable<Extract<InsightsView, { status: "ready" }>["attempt"]> {
  const state = !a.settled ? "pending" as const : a.outcome === "ok" && a.stopReason !== "answer_unreadable" ? "ok" as const : "failed" as const;
  // Claims are shown for an answer that was read and recorded, and ONLY the facts the page still holds now: a stored
  // answer never outlives the facts it cites (a revoked source, an event taken back).
  const shown = state === "ok" ? supportedNow(readStoredClaims(a.claims), current) : { claims: [], dropped: 0 };
  return { state, claims: shown.claims, dropped: shown.dropped, rejected: a.rejectedCount, askedAt: a.reservedAt,
    factsChanged: currentHash === null || currentHash !== a.inputHash };
}
