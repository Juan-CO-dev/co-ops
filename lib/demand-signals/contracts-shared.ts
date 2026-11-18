/**
 * Demand signals: TWO CONTRACTS FOR LATER PRs, written now so they cannot be missed (item 4 PR 1).
 * Pure. Nothing live calls this file yet. tests/demand-signals-contracts.test.ts holds a CLOSED CENSUS of the
 * modules under lib/demand-signals and of the signal routes: a new module fails that test until its author
 * states, in the census, how it answers the contract below that applies to it.
 *
 * ── PR 2: SOURCE REVOCATION STOPS USE, NOT ONLY COLLECTION (Astra r2 P2 #3) ─────────────────
 * The source register gates adapters and backfills. That is not enough: a forecast term persisted while a
 * source was verified would keep steering actionable suggestions after the source is revoked.
 * THE RULE: a signal may be collected, computed into a term, rendered as an actionable chip or accepted ONLY
 * while EVERY source behind it is `verified` AT THAT INSTANT. `signalUsable` is the one check, and all four
 * use points call it with the register's CURRENT status, never a status remembered from an earlier step.
 *   · collect  the adapter and the backfill: no network request, nothing written (`source_unverified`).
 *   · compute  the nightly term builder: a revoked source's rows are not read into a term; the term is 1.
 *   · render   the page and the chip loader: a persisted term with a revoked source renders no chip.
 *   · accept   the chip's accept route re-checks INSIDE the write (under the same lock or in the same
 *              statement as the accept): a revocation between display and accept answers `source_revoked`
 *              and writes nothing. PR 2 / PR 6 must ship a test of exactly that interleaving.
 * EXISTING DATA: rows already stored from a revoked source are KEPT as historical evidence under the retention
 * rule (25 months) and are never deleted by a revocation; they are excluded from every use above, and a
 * qualification that leaned on them returns its signal to observing. Persisted terms therefore carry their
 * source ids (`sourceIds` on the term), so a consumer can ask the register. A zero-feed signal (trend, the
 * holiday calendar) has no source and is always usable on this axis.
 *
 * ── PR 7: THE AI SENTENCE PASSES THE SAME EVIDENCE VALIDATION (Astra r2 P2 #4) ──────────────
 * A lexical filter (no digit, no currency mark, no unknown name) lets "Demand will surge because of the
 * shutdown" through: no digits, and an unsupported forecast and cause. So there is NO free-text channel.
 * THE RULE: the model returns claims only: a claim type from the closed list plus evidence ids. Each claim
 * is validated (`validateInsightClaims`): the type is known, every evidence id exists in the DTO the model was
 * given, and each evidence kind is one that type may cite. A sentence is then RENDERED BY US from the
 * validated claim through a deterministic en + es template (`insightSentenceKey`), with every number, shop and
 * date supplied from the evidence. A claim that fails validation renders nothing. Text written by the model
 * is never shown: `MODEL_FREE_TEXT_RENDERED` is false, and PR 7 must not add a field that carries it.
 */

// ── PR 2 ────────────────────────────────────────────────────────────────────────────────────

export type SourceStatus = "unverified" | "verified" | "revoked";
export const SIGNAL_USE_POINTS = ["collect", "compute", "render", "accept"] as const;
export type SignalUsePoint = (typeof SIGNAL_USE_POINTS)[number];
export type SignalUseRefusal = "source_unverified" | "source_revoked";

/** May a signal be used at this point, given the CURRENT status of every source behind it? */
export function signalUsable(
  sources: ReadonlyArray<{ sourceId: string; status: SourceStatus }>,
  _use: SignalUsePoint,
): { ok: true } | { ok: false; code: SignalUseRefusal; sourceId: string } {
  // The answer is the same at every use point on purpose: there is no point at which a revoked source may be used.
  void _use;
  const revoked = sources.find((s) => s.status === "revoked");
  if (revoked) return { ok: false, code: "source_revoked", sourceId: revoked.sourceId };
  const unverified = sources.find((s) => s.status !== "verified");
  if (unverified) return { ok: false, code: "source_unverified", sourceId: unverified.sourceId };
  return { ok: true };
}

/** A revocation never deletes what was stored; it only stops its use. */
export const REVOCATION_KEEPS_HISTORY = true;

// ── PR 7 ────────────────────────────────────────────────────────────────────────────────────

/** Text written by the model is never rendered. There is no flag that turns this on. */
export const MODEL_FREE_TEXT_RENDERED = false;

export const INSIGHT_EVIDENCE_KINDS = ["baseline_score", "candidate_score", "qualification", "episode", "coverage_gap", "named_event"] as const;
export type InsightEvidenceKind = (typeof INSIGHT_EVIDENCE_KINDS)[number];

/** The closed list of things an insight may say, and the evidence each may cite. Adding a claim type is a reviewed change. */
export const INSIGHT_CLAIMS = Object.freeze({
  baseline_is_off: ["baseline_score"],
  signal_helped_on_history: ["candidate_score"],
  signal_qualified: ["qualification"],
  signal_not_enough_history: ["candidate_score", "episode"],
  data_missing: ["coverage_gap"],
  event_on_date: ["named_event"],
} as const satisfies Record<string, ReadonlyArray<InsightEvidenceKind>>);
export type InsightClaimType = keyof typeof INSIGHT_CLAIMS;

export interface InsightClaim { type: string; evidenceIds: ReadonlyArray<string> }
export interface InsightEvidence { id: string; kind: InsightEvidenceKind }
export type InsightRejection = "unknown_claim_type" | "no_evidence" | "unknown_evidence" | "evidence_kind_mismatch";

/**
 * Validate what the model returned against the evidence it was given. Only a valid claim may be rendered,
 * and it is rendered by a template, never by the model.
 */
export function validateInsightClaims(claims: ReadonlyArray<InsightClaim>, evidence: ReadonlyArray<InsightEvidence>): {
  valid: Array<{ type: InsightClaimType; evidenceIds: string[] }>;
  rejected: Array<{ claim: InsightClaim; reason: InsightRejection }>;
} {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const valid: Array<{ type: InsightClaimType; evidenceIds: string[] }> = [];
  const rejected: Array<{ claim: InsightClaim; reason: InsightRejection }> = [];
  for (const claim of claims) {
    if (!Object.prototype.hasOwnProperty.call(INSIGHT_CLAIMS, claim.type)) { rejected.push({ claim, reason: "unknown_claim_type" }); continue; }
    const type = claim.type as InsightClaimType;
    if (claim.evidenceIds.length === 0) { rejected.push({ claim, reason: "no_evidence" }); continue; }
    const cited = claim.evidenceIds.map((id) => byId.get(id));
    if (cited.some((e) => e === undefined)) { rejected.push({ claim, reason: "unknown_evidence" }); continue; }
    const allowed: ReadonlyArray<InsightEvidenceKind> = INSIGHT_CLAIMS[type];
    if (cited.some((e) => !allowed.includes(e!.kind))) { rejected.push({ claim, reason: "evidence_kind_mismatch" }); continue; }
    valid.push({ type, evidenceIds: [...claim.evidenceIds] });
  }
  return { valid, rejected };
}

/** The i18n key of the deterministic sentence for a validated claim (en + es ship with PR 7). */
export function insightSentenceKey(type: InsightClaimType): string {
  return `signals.insight.${type}`;
}
