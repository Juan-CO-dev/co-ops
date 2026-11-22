/**
 * Demand signals (item 4 PR 2): THE SOURCE REGISTER, pure. No I/O.
 *
 * A source is a DEFINITION: where it is, what it gives, what its terms say, whether it may be ingested, and
 * which adapter version reads it. The definition's canonical text is named by its sha256 (0343 recomputes
 * it), so a changed endpoint, adapter version or terms text is a NEW definition, and a new definition is
 * `unverified` until a person marks it. Nothing is ingested from a source that is not `verified` NOW.
 *
 * THE GATE (the answers a definition can carry):
 *   allow                  its terms were read and permit our internal operational use.
 *   allow_with_conditions  as above, with conditions the adapter must meet (a key, a rate, attribution).
 *   pending_terms          a real feed, but nobody has read terms that settle it. NOT ingestible.
 *   named_only             no machine feed (a web page, a PDF): people enter these events by hand.
 *   refuse                 its terms forbid automated or commercial use. Never ingested.
 * Only `allow` and `allow_with_conditions` can be marked verified (0343: source_not_ingestible otherwise).
 * FREE ONLY (Juan 2026-11-18): a paid source cannot be registered at all (`cost` is the literal "free").
 *
 * REVOCATION STOPS USE (Astra r2 P2 #3; the contract is contracts-shared.ts). Every use point asks
 * `signalUsable` with the register's CURRENT statuses through the helpers below. A source the register does
 * not list is `unverified`.
 */
import { signalUsable, type SignalUsePoint, type SignalUseRefusal, type SourceStatus } from "./contracts-shared";
import { addressOf } from "./hash";

export const SOURCE_CATEGORIES = ["weather", "government_status", "holiday_calendar", "transit", "street_closure", "public_event",
  "school_calendar", "sports", "venue", "race", "news", "other"] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];
export const SOURCE_GATES = ["allow", "allow_with_conditions", "pending_terms", "named_only", "refuse"] as const;
export type SourceGate = (typeof SOURCE_GATES)[number];
export const INGESTIBLE_GATES: ReadonlyArray<SourceGate> = ["allow", "allow_with_conditions"];

export interface SourceDefinition {
  sourceId: string;
  name: string;
  category: SourceCategory;
  cost: "free";
  homepageUrl: string;
  /** Every URL the adapter may request (or, with no adapter, where the data is). */
  endpoints: string[];
  format: string;
  gives: string;
  auth: string;
  rateLimit: string | null;
  termsUrl: string | null;
  /** A short quote of the sentence that grants or restricts use, as read on termsCheckedOn. */
  termsQuote: string | null;
  termsStatus: "verified" | "unverified";
  termsCheckedOn: string;
  gate: SourceGate;
  conditions: string[];
  caveats: string | null;
  /** null = no adapter in code. */
  adapter: { key: string; version: number } | null;
}

const ID = /^[a-z0-9_]{2,40}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Why a definition cannot be registered, or null. 0343's checks are the same rules. */
export function definitionProblem(d: SourceDefinition): string | null {
  if (!ID.test(d.sourceId)) return "source_id";
  if (d.name.trim().length < 2 || d.name.length > 120) return "name";
  if (!SOURCE_CATEGORIES.includes(d.category)) return "category";
  if ((d.cost as string) !== "free") return "not_free";
  if (!SOURCE_GATES.includes(d.gate)) return "gate";
  if (d.termsStatus !== "verified" && d.termsStatus !== "unverified") return "terms_status";
  if (!YMD.test(d.termsCheckedOn)) return "terms_checked_on";
  if (d.termsUrl !== null && !d.termsUrl.startsWith("https://")) return "terms_url";
  if (d.termsStatus === "verified" && (d.termsUrl === null || d.termsQuote === null || d.termsQuote.trim().length < 10)) return "verified_terms_need_url_and_quote";
  if (INGESTIBLE_GATES.includes(d.gate) && d.termsStatus !== "verified") return "ingestible_needs_verified_terms";
  if (d.adapter !== null && (!ID.test(d.adapter.key) || !Number.isInteger(d.adapter.version) || d.adapter.version < 1 || d.adapter.version > 9999)) return "adapter";
  if (d.adapter !== null && !INGESTIBLE_GATES.includes(d.gate)) return "adapter_needs_ingestible_gate";
  if (d.adapter !== null && d.endpoints.length === 0) return "adapter_needs_endpoints";
  if (d.endpoints.some((u) => !u.startsWith("https://"))) return "endpoint";
  if (d.gives.trim().length < 10) return "gives";
  return null;
}

/** The canonical text 0343 stores and the hash it recomputes. */
export function definitionAddress(d: SourceDefinition): { hash: string; text: string } {
  return addressOf(d);
}

/** What the verification page shows of a definition: the stored canonical text, read back. null = not readable as one. */
export interface SourceDefinitionView {
  homepageUrl: string | null; endpoints: string[]; format: string | null; gives: string | null; auth: string | null; rateLimit: string | null;
  termsQuote: string | null; termsCheckedOn: string | null; conditions: string[]; caveats: string | null;
}
/** Read a stored definition text for display. Total: any text that is not a definition object answers null. */
export function parseDefinitionText(text: string): SourceDefinitionView | null {
  let d: unknown;
  try { d = JSON.parse(text); } catch { return null; }
  if (typeof d !== "object" || d === null || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  return { homepageUrl: s(o.homepageUrl), endpoints: list(o.endpoints), format: s(o.format), gives: s(o.gives), auth: s(o.auth), rateLimit: s(o.rateLimit),
    termsQuote: s(o.termsQuote), termsCheckedOn: s(o.termsCheckedOn), conditions: list(o.conditions), caveats: s(o.caveats) };
}

/** One source as the register reads NOW (0343 demand_source_states). */
export interface SourceState {
  sourceId: string;
  definitionHash: string;
  gate: SourceGate;
  adapter: string | null;
  status: SourceStatus;
}

/** The current status of each source id; one the register does not list is `unverified`. */
export function currentStatuses(states: ReadonlyArray<SourceState>, sourceIds: ReadonlyArray<string>): Array<{ sourceId: string; status: SourceStatus }> {
  const byId = new Map(states.map((s) => [s.sourceId, s.status]));
  return [...new Set(sourceIds)].sort().map((sourceId) => ({ sourceId, status: byId.get(sourceId) ?? "unverified" }));
}

export type UseDecision = { ok: true } | { ok: false; code: SignalUseRefusal; sourceId: string };

/** May signals of these sources be used at this point, given the register as it reads NOW? */
export function usableNow(states: ReadonlyArray<SourceState>, sourceIds: ReadonlyArray<string>, use: SignalUsePoint): UseDecision {
  return signalUsable(currentStatuses(states, sourceIds), use);
}

/**
 * May the adapter built for `definitionHash` COLLECT from this source now? Verified, and the register's current
 * definition is the one the adapter was built for (a changed endpoint or adapter version is unverified again).
 */
export function collectDecision(states: ReadonlyArray<SourceState>, sourceId: string, definitionHash: string): UseDecision {
  const decision = usableNow(states, [sourceId], "collect");
  if (!decision.ok) return decision;
  const state = states.find((s) => s.sourceId === sourceId);
  if (!state || state.definitionHash !== definitionHash || !INGESTIBLE_GATES.includes(state.gate)) return { ok: false, code: "source_unverified", sourceId };
  return { ok: true };
}

/** Keep only the rows whose source is usable NOW (compute and render). Rows without a source are zero-feed. */
export function keepUsable<T extends { sourceId: string | null }>(rows: ReadonlyArray<T>, states: ReadonlyArray<SourceState>, use: SignalUsePoint): T[] {
  const verdict = new Map<string, boolean>();
  return rows.filter((row) => {
    if (row.sourceId === null) return true;
    let ok = verdict.get(row.sourceId);
    if (ok === undefined) { ok = usableNow(states, [row.sourceId], use).ok; verdict.set(row.sourceId, ok); }
    return ok;
  });
}

// What a person sends (the source mark, a manual event) lives in input-shared.ts: it imports nothing, so the
// pages' forms validate with the SAME rules the routes parse with. Re-exported here so server consumers keep this path.
export * from "./input-shared";
