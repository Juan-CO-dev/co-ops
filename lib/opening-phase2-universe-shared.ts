/**
 * W15/B085 — which openingPhase2 items are in THIS opening's Phase 2. CLIENT-SAFE (pure).
 *
 * A prep line switched to "opening verification" (or a new AM-prep line with it on) is
 * mirrored straight into today's opening template. Today's instance never snapshotted it,
 * so it has no Phase 1 row: the per-item save refuses it (phase1_not_resolved) and the old
 * finalize counted it forever (phase2_incomplete) — the day's opening could not be finished.
 *
 * The rule (owner decision W15-2 a — it starts with tomorrow's opening): once Phase 1 is
 * submitted, an instance's Phase 2 universe is its openingPhase2 items that have a LIVE
 * Phase 1 row (prep_data.phase1) on that instance. The same rule is in submit_phase2_atomic
 * (0320 section D). Before Phase 1 is submitted nothing changes: every mirror is listed.
 */
export interface Phase2UniverseCompletion {
  templateItemId: string;
  prepData?: unknown;
}

const hasPhase1 = (prepData: unknown): boolean =>
  typeof prepData === "object" && prepData !== null && !Array.isArray(prepData)
  && (prepData as Record<string, unknown>).phase1 != null;

/** Item ids with a live Phase 1 row (callers pass LIVE completions only). */
export function phase1ItemIds(completions: ReadonlyArray<Phase2UniverseCompletion>): Set<string> {
  const out = new Set<string>();
  for (const c of completions) if (hasPhase1(c.prepData)) out.add(c.templateItemId);
  return out;
}

/** Is this openingPhase2 item in the instance's Phase 2 universe? */
export function inPhase2Universe(itemId: string, phase1Submitted: boolean, phase1Ids: ReadonlySet<string>): boolean {
  return !phase1Submitted || phase1Ids.has(itemId);
}
