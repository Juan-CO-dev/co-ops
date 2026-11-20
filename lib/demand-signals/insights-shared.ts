/**
 * Demand signals (item 4 PR 7): AI INSIGHTS, the pure half. No I/O, no clock, no environment read, and it
 * imports nothing but the contract (so the page's client component may use it).
 *
 * WHAT AN INSIGHT IS: of the FACTS the signals page already shows, which few to look at first. Nothing more.
 * THE CONTRACT (contracts-shared.ts, Astra r2 P2 #4), held here:
 *   · THE MODEL SEES FACTS ONLY (`buildInsightFacts`): an id, a kind from the closed list, dates, and codes from
 *     closed lists (a category, a direction, a reason). NO title, NO note, NO shop name, NO person, NO wage, NO
 *     sales figure. Every field is rebuilt from an allow-list; a value outside its list is replaced or dropped.
 *   · THE MODEL RETURNS CLAIMS ONLY: a type from the closed list and the ids of the facts it cites. It is asked
 *     for JSON of one fixed schema and `parseModelClaims` refuses anything else as a whole.
 *   · `validateInsightClaims` DECIDES. A claim whose type is unknown, whose evidence is not among the facts sent,
 *     or whose evidence is of a kind that type may not cite, is dropped and counted.
 *   · WE WRITE THE SENTENCE. A valid claim is rendered from a deterministic en + es template
 *     (`insightSentenceKey`) with the dates and codes of the FACTS it cites. Text written by the model is never
 *     shown, stored or logged: `MODEL_FREE_TEXT_RENDERED` is false and there is no field that could carry it.
 * NEVER AUTO-ACTS: an insight is a line on a read-only page. It is not an input to any suggestion, approval or
 * writer (tests/demand-signals-insights.test.ts proves the import closure).
 *
 * MONEY: `AI_PRICES` is the ONLY price source. A model with no entry REFUSES (`model_unpriced`): pricing we have
 * not read blocks the call, never the page. The worst case of a call is reserved before it is made
 * (`worstCaseMicro`); the cap is `DEMAND_AI_CODE_CAP_MICRO` and an environment value can only LOWER it.
 */
import { INSIGHT_CLAIMS, MODEL_FREE_TEXT_RENDERED, validateInsightClaims, type InsightClaim, type InsightClaimType, type InsightEvidenceKind } from "./contracts-shared";

// ── the facts the model is given ────────────────────────────────────────────────────────────────
const CATEGORIES = ["weather_alert", "government_closure", "federal_holiday", "school_closure", "transit_disruption", "street_closure", "sports_game",
  "concert_show", "convention", "race", "festival_parade", "demonstration", "other"] as const;
const IMPACTS = ["up", "down", "unknown"] as const;
/** Why a stretch of days has no forecast we can show (the page's reasons, minus "past the forecast's reach", which is normal). */
export const INSIGHT_GAP_REASONS = ["source_not_verified", "not_collected", "unreadable"] as const;
export type InsightGapReason = (typeof INSIGHT_GAP_REASONS)[number];

export type InsightFact =
  | { id: string; kind: "named_event"; date: string; endDate: string; category: (typeof CATEGORIES)[number]; impact: (typeof IMPACTS)[number]; origin: "manual" | "feed"; scope: "shop" | "all" }
  | { id: string; kind: "coverage_gap"; date: string; endDate: string; reason: InsightGapReason };

/** The evidence kinds this builder can produce today, and so the only claim types the model is offered. */
export const PRODUCIBLE_EVIDENCE: ReadonlyArray<InsightEvidenceKind> = ["named_event", "coverage_gap"];
export const OFFERED_CLAIM_TYPES: ReadonlyArray<InsightClaimType> = (Object.keys(INSIGHT_CLAIMS) as InsightClaimType[])
  .filter((type) => (INSIGHT_CLAIMS[type] as ReadonlyArray<InsightEvidenceKind>).every((kind) => PRODUCIBLE_EVIDENCE.includes(kind)));

export const INSIGHT_MAX_EVENT_FACTS = 40;
export const INSIGHT_MAX_CLAIMS = 5;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends string>(list: ReadonlyArray<T>, v: unknown, fallback: T): T => (typeof v === "string" && (list as ReadonlyArray<string>).includes(v) ? (v as T) : fallback);

export interface InsightSourceEvent { origin: string; locationId: string | null; category: string; validFrom: string; validTo: string; expectedImpact: string }
export interface InsightSourceDay { date: string; weatherGap: string | null }
export type InsightFactsResult =
  | { ok: true; facts: InsightFact[] }
  | { ok: false; code: "facts_incomplete" | "nothing_to_say" | "input_too_large" };

/**
 * The facts for one shop, from what the page ALREADY read whole. `events` null = the event read did not finish:
 * no fact list is built from part of the truth (`facts_incomplete`). Events are in the page's order; ids are
 * positional (e1, e2, ... g1, ...), so the same page gives the same facts and the same hash.
 */
export function buildInsightFacts(args: { today: string; days: ReadonlyArray<InsightSourceDay>; events: ReadonlyArray<InsightSourceEvent> | null }): InsightFactsResult {
  if (args.events === null) return { ok: false, code: "facts_incomplete" };
  const horizonEnd = args.days.at(-1)?.date ?? args.today;
  const inHorizon = args.events.filter((e) => YMD.test(e.validFrom) && YMD.test(e.validTo) && e.validFrom <= horizonEnd && e.validTo >= args.today);
  if (inHorizon.length > INSIGHT_MAX_EVENT_FACTS) return { ok: false, code: "input_too_large" };
  const facts: InsightFact[] = inHorizon.map((e, i) => ({
    id: `e${i + 1}`, kind: "named_event", date: e.validFrom, endDate: e.validTo, category: pick(CATEGORIES, e.category, "other"),
    impact: pick(IMPACTS, e.expectedImpact, "unknown"), origin: e.origin === "feed" ? "feed" : "manual", scope: e.locationId === null ? "all" : "shop" }));
  // Consecutive days with the same reason are ONE gap fact.
  let run: { date: string; endDate: string; reason: InsightGapReason } | null = null;
  const gaps: Array<{ date: string; endDate: string; reason: InsightGapReason }> = [];
  for (const day of args.days) {
    const reason = (INSIGHT_GAP_REASONS as ReadonlyArray<string>).includes(day.weatherGap ?? "") ? (day.weatherGap as InsightGapReason) : null;
    if (reason !== null && run !== null && run.reason === reason) { run.endDate = day.date; continue; }
    if (run !== null) gaps.push(run);
    run = reason === null ? null : { date: day.date, endDate: day.date, reason };
  }
  if (run !== null) gaps.push(run);
  gaps.forEach((g, i) => facts.push({ id: `g${i + 1}`, kind: "coverage_gap", ...g }));
  return facts.length === 0 ? { ok: false, code: "nothing_to_say" } : { ok: true, facts };
}

// ── what is sent, and what may come back ────────────────────────────────────────────────────────
/** Bump on ANY change to the system text, the schema or the fact shape: it is part of what a call is. */
export const INSIGHT_PROMPT_VERSION = 1;
/** One audience today (GM and up, facts with no restricted field). A second audience is a new policy and a new hash. */
export const INSIGHT_AUDIENCE_POLICY = "gm_plus_v1";
export const INSIGHT_SYSTEM = [
  "You help a restaurant manager decide what to look at first on a planning page.",
  "You are given FACTS as JSON. Each fact has an id and a kind.",
  `Choose at most ${INSIGHT_MAX_CLAIMS} claims. A claim is a type and the ids of the facts it cites.`,
  "Allowed types: event_on_date (cites facts of kind named_event) and data_missing (cites facts of kind coverage_gap).",
  "Cite only ids that appear in the facts. Do not forecast, do not explain a cause, do not add any text.",
  "If nothing deserves attention, return an empty list of claims.",
].join("\n");
export const INSIGHT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    claims: { type: "array", items: { type: "object",
      properties: { type: { type: "string", enum: [...OFFERED_CLAIM_TYPES] }, evidenceIds: { type: "array", items: { type: "string" } } },
      required: ["type", "evidenceIds"], additionalProperties: false } },
  },
  required: ["claims"], additionalProperties: false,
});
/** The user message: the facts and nothing else. Keys are written in a fixed order. */
export function insightUserMessage(args: { today: string; facts: ReadonlyArray<InsightFact> }): string {
  return JSON.stringify({ today: args.today, facts: args.facts.map((f) => f.kind === "named_event"
    ? { id: f.id, kind: f.kind, date: f.date, endDate: f.endDate, category: f.category, impact: f.impact, origin: f.origin, scope: f.scope }
    : { id: f.id, kind: f.kind, date: f.date, endDate: f.endDate, reason: f.reason }) });
}

/**
 * Read the model's answer. It must be JSON of exactly the schema asked for; anything else (no text, prose,
 * another key, a non-string id) is refused AS A WHOLE with null. Claims past the limit are cut and counted.
 */
export function parseModelClaims(text: string | null): { claims: InsightClaim[]; overLimit: number } | null {
  if (typeof text !== "string" || text.length === 0 || text.length > 20_000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  const list = (parsed as { claims?: unknown }).claims;
  if (keys.length !== 1 || keys[0] !== "claims" || !Array.isArray(list)) return null;
  const claims: InsightClaim[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const k = Object.keys(r).sort();
    if (k.length !== 2 || k[0] !== "evidenceIds" || k[1] !== "type" || typeof r.type !== "string" || !Array.isArray(r.evidenceIds)
      || r.evidenceIds.some((id) => typeof id !== "string" || id.length > 12)) return null;
    claims.push({ type: r.type, evidenceIds: [...new Set(r.evidenceIds as string[])] });
  }
  return { claims: claims.slice(0, INSIGHT_MAX_CLAIMS), overLimit: Math.max(0, claims.length - INSIGHT_MAX_CLAIMS) };
}

/** A claim that passed validation, with the facts it cites (what is stored, and what the page renders from). */
export interface StoredInsightClaim { type: InsightClaimType; facts: InsightFact[] }

/**
 * Validate the model's claims against the facts IT WAS SENT and attach those facts. This is the only door from
 * model output to anything stored or shown, and it lets through a type and fact ids, nothing else.
 */
export function acceptClaims(parsed: { claims: InsightClaim[]; overLimit: number }, facts: ReadonlyArray<InsightFact>): { accepted: StoredInsightClaim[]; rejected: number } {
  if (MODEL_FREE_TEXT_RENDERED) throw new Error("model_free_text_must_stay_off");
  const offered = parsed.claims.filter((c) => (OFFERED_CLAIM_TYPES as ReadonlyArray<string>).includes(c.type));
  const { valid, rejected } = validateInsightClaims(offered, facts.map((f) => ({ id: f.id, kind: f.kind })));
  const byId = new Map(facts.map((f) => [f.id, f]));
  return {
    accepted: valid.map((c) => ({ type: c.type, facts: c.evidenceIds.map((id) => byId.get(id)!).filter((f) => f !== undefined) })).filter((c) => c.facts.length > 0),
    rejected: rejected.length + (parsed.claims.length - offered.length) + parsed.overLimit,
  };
}

/**
 * Read claims back from storage FOR DISPLAY. Total: every field is re-checked against its closed list, and a
 * claim or fact that is not exactly one we could have stored is dropped (rendering nothing), never repaired.
 */
export function readStoredClaims(value: unknown): StoredInsightClaim[] {
  if (!Array.isArray(value)) return [];
  const out: StoredInsightClaim[] = [];
  for (const raw of value.slice(0, INSIGHT_MAX_CLAIMS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const c = raw as { type?: unknown; facts?: unknown };
    if (typeof c.type !== "string" || !(OFFERED_CLAIM_TYPES as ReadonlyArray<string>).includes(c.type) || !Array.isArray(c.facts)) continue;
    const allowed: ReadonlyArray<InsightEvidenceKind> = INSIGHT_CLAIMS[c.type as InsightClaimType];
    const facts: InsightFact[] = [];
    for (const f of c.facts as Array<Record<string, unknown>>) {
      if (typeof f !== "object" || f === null || typeof f.id !== "string" || typeof f.date !== "string" || typeof f.endDate !== "string"
        || !YMD.test(f.date) || !YMD.test(f.endDate) || !allowed.includes(f.kind as InsightEvidenceKind)) continue;
      if (f.kind === "named_event" && (CATEGORIES as ReadonlyArray<string>).includes(String(f.category)) && (IMPACTS as ReadonlyArray<string>).includes(String(f.impact))) {
        facts.push({ id: f.id, kind: "named_event", date: f.date, endDate: f.endDate, category: f.category as (typeof CATEGORIES)[number], impact: f.impact as (typeof IMPACTS)[number],
          origin: f.origin === "feed" ? "feed" : "manual", scope: f.scope === "all" ? "all" : "shop" });
      } else if (f.kind === "coverage_gap" && (INSIGHT_GAP_REASONS as ReadonlyArray<string>).includes(String(f.reason))) {
        facts.push({ id: f.id, kind: "coverage_gap", date: f.date, endDate: f.endDate, reason: f.reason as InsightGapReason });
      }
    }
    if (facts.length > 0) out.push({ type: c.type as InsightClaimType, facts });
  }
  return out;
}

// ── money ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Microdollars per token (the published dollars per million tokens). Read on 2026-11-19 from the Claude
 * models overview (platform.claude.com/docs/en/about-claude/models/overview). A model that is not here cannot
 * be called. Re-read the page before adding or changing a row.
 */
export const AI_PRICES: Readonly<Record<string, { inputMicroPerToken: number; outputMicroPerToken: number }>> = Object.freeze({
  "claude-opus-5-5": Object.freeze({ inputMicroPerToken: 4, outputMicroPerToken: 20 }),
  "claude-sonnet-5-5": Object.freeze({ inputMicroPerToken: 2, outputMicroPerToken: 10 }),
});
export const DEMAND_AI_DEFAULT_MODEL = "claude-opus-5-5";
/** The most this feature may cost in one ET month: $5.00. 0352 holds the same ceiling. */
export const DEMAND_AI_CODE_CAP_MICRO = 5_000_000;
/** Everything the model may write, thinking included, is bounded by this. */
export const DEMAND_AI_MAX_OUTPUT_TOKENS = 2_000;
export const DEMAND_AI_TIMEOUT_MS = 20_000;
export const DEMAND_AI_MAX_RETRIES = 1;
/** The largest request body (system + schema + facts) we will send, in bytes. */
export const DEMAND_AI_MAX_INPUT_BYTES = 16_000;
/** Tokens the API may add around our text (roles, the schema's framing). A margin, counted as input. */
const INPUT_OVERHEAD_TOKENS = 1_024;
const bytesOf = (s: string) => new TextEncoder().encode(s).length;

/** The bytes a call sends: the system text, the schema and the user message. */
export function insightInputBytes(user: string): number {
  return bytesOf(INSIGHT_SYSTEM) + bytesOf(JSON.stringify(INSIGHT_OUTPUT_SCHEMA)) + bytesOf(user);
}
/**
 * The WORST a call can cost, reserved before it is made: one token per input byte (a token is never shorter than
 * a byte) plus the margin, at the input price, plus the whole output limit at the output price, times every
 * attempt the client may make. null = the model has no price here.
 */
export function worstCaseMicro(model: string, inputBytes: number): number | null {
  const price = AI_PRICES[model];
  if (!price || !Number.isFinite(inputBytes) || inputBytes < 0) return null;
  const perAttempt = (Math.ceil(inputBytes) + INPUT_OVERHEAD_TOKENS) * price.inputMicroPerToken + DEMAND_AI_MAX_OUTPUT_TOKENS * price.outputMicroPerToken;
  return perAttempt * (1 + DEMAND_AI_MAX_RETRIES);
}
/** What a finished call cost, from the usage the API reported (cache tokens, if any, at the full input price). */
export function actualMicro(model: string, usage: { inputTokens: number; outputTokens: number }): number | null {
  const price = AI_PRICES[model];
  if (!price || !Number.isInteger(usage.inputTokens) || !Number.isInteger(usage.outputTokens) || usage.inputTokens < 0 || usage.outputTokens < 0) return null;
  return usage.inputTokens * price.inputMicroPerToken + usage.outputTokens * price.outputMicroPerToken;
}

// ── configuration (the caller reads the environment and passes it in) ───────────────────────────
export type AiStatus = "off" | "not_configured" | "model_unpriced" | "ready";
export interface AiConfig { status: AiStatus; model: string; capMicro: number }
/**
 * DEMAND_AI=1 is the switch. Without a key the feature is INERT and says so (`not_configured`): no client is
 * built and nothing is sent. The key is this feature's OWN (`DEMAND_AI_API_KEY`), never a key another feature
 * uses. The cap: unset = the code cap; a whole number of cents = the lower of it and the code cap; anything we
 * cannot read = 0 (a cap we cannot read is not a licence to spend).
 */
export function aiConfig(env: { enabled: string | undefined; apiKey: string | undefined; model: string | undefined; monthlyCapCents: string | undefined }): AiConfig {
  const model = env.model?.trim() || DEMAND_AI_DEFAULT_MODEL;
  const raw = env.monthlyCapCents?.trim();
  const capMicro = raw === undefined || raw === "" ? DEMAND_AI_CODE_CAP_MICRO
    : /^\d{1,6}$/.test(raw) ? Math.min(DEMAND_AI_CODE_CAP_MICRO, Number(raw) * 10_000) : 0;
  const status: AiStatus = env.enabled !== "1" ? "off" : !env.apiKey || env.apiKey.trim() === "" ? "not_configured" : !AI_PRICES[model] ? "model_unpriced" : "ready";
  return { status, model, capMicro };
}
