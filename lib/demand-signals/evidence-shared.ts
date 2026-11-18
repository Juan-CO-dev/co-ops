/**
 * Demand signals (item 4 PR 1): the EVIDENCE CLASSES and the four times of an input. Pure.
 *
 *   E0 hindsight       a feature that was NOT knowable at the decision (observed weather). Unlocks nothing.
 *   E1 retrospective   the feature was knowable, but an input is today's copy of history (orders are
 *                      rebuilt from current pointers, pars and settings are read as they are now).
 *                      May be SHOWN, labelled. Never acts.
 *   E2 point-in-time   every input comes from a vintage STORED at the decision, the forecast was recorded
 *                      at the decision, and the target was frozen. The only class that can unlock a chip.
 *
 * What E2 means here, exactly (Astra r2 P2 #1): the forecast ledger row names a manifest; the manifest
 * names content-addressed blobs holding EVERY input the engine read at its boundary (lib/demand-signals/
 * replay-shared.ts); re-running the engine over those blobs reproduces the stored forecast. The upstream
 * derivation (orders -> ounces through recipes and packs) is NOT re-derived: its OUTPUT as of the decision
 * is what is stored. A forecast whose manifest does not resolve, or does not reproduce, is E1.
 */
export type EvidenceClass = "E0" | "E1" | "E2";

export interface EvidenceFacts {
  /** Could the candidate's feature be known at the decision instant? Observed weather: no. */
  featureKnownAtDecision: boolean;
  /** The forecast was recorded at the decision and its manifest resolves and reproduces it. */
  replayedFromStoredInputs: boolean;
  /** The target was frozen at D+4 (or later) with its source fingerprint. */
  targetFrozen: boolean;
}

export function classifyEvidence(facts: EvidenceFacts): EvidenceClass {
  if (!facts.featureKnownAtDecision) return "E0";
  return facts.replayedFromStoredInputs && facts.targetFrozen ? "E2" : "E1";
}

export type EvidenceUse = "display" | "actionable";
const UNLOCKS: Record<EvidenceClass, ReadonlyArray<EvidenceUse>> = { E0: [], E1: ["display"], E2: ["display", "actionable"] };

/** E0 unlocks nothing, E1 a labelled display, E2 an actionable suggestion. PR 4's state machine reads this. */
export function evidenceAllows(cls: EvidenceClass, use: EvidenceUse): boolean {
  return UNLOCKS[cls].includes(use);
}

/**
 * The four times of an input row (Astra r1 P1 #2). They are different facts:
 *   decisionAt   when the forecast was made (the loader's parameter, never a column);
 *   availableAt  when WE held the row;
 *   issuedAt     when the source issued it (null when the source does not say);
 *   validAt      the time the row is about.
 */
export interface InputVintage {
  id: string;
  availableAt: string;
  issuedAt: string | null;
  validAt?: string | null;
}

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new Error("vintage_bad_instant");
  return t;
};

/** May a decision made at `decisionAt` read this row? Only when we already held it. */
export function readableAt(row: InputVintage, decisionAt: string): boolean {
  return ms(row.availableAt) <= ms(decisionAt);
}

/** The vintage in force at a decision: the latest `availableAt <= decisionAt`, then `issuedAt`, then id. */
export function selectVintage<T extends InputVintage>(rows: ReadonlyArray<T>, decisionAt: string): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!readableAt(row, decisionAt)) continue;
    if (best === null) { best = row; continue; }
    const a = ms(row.availableAt) - ms(best.availableAt);
    const i = (row.issuedAt === null ? -Infinity : ms(row.issuedAt)) - (best.issuedAt === null ? -Infinity : ms(best.issuedAt));
    if (a > 0 || (a === 0 && (i > 0 || ((i === 0 || Number.isNaN(i)) && row.id > best.id)))) best = row;
  }
  return best;
}

/** Every point-in-time loader ends with this: a row held after the decision is a leak, and it throws. */
export function assertNoLeak(rows: ReadonlyArray<InputVintage>, decisionAt: string): void {
  for (const row of rows) if (!readableAt(row, decisionAt)) throw new Error(`input_after_decision:${row.id}`);
}
