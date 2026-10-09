/**
 * Needs attention — PURE ranking (client-safe, zero I/O). The server composes rows from the other
 * sections' facts (lib/pulse/sections.ts); this module owns the ORDER, the severity classes, the
 * score (same three states as v1's pulseScore) and the crew filter.
 */
import type { PulseScore } from "@/lib/midshift-shared";
import type { AttentionEvidence, AttentionKind, AttentionRow, AttentionRowScoped, AttentionSeverity } from "@/lib/pulse/types";

/** Spec order. The index is the rank. */
export const ATTENTION_ORDER: readonly AttentionKind[] = [
  "station_uncovered",
  "station_trim_due",
  "station_closing_soon",
  "task_late",
  "checklist_missed",
  "fridge_out_of_range",
  "fridge_unchecked",
  "item_low",
  "catering_not_rung",
  "catering_unprepped",
  "clockin_unlinked",
];

const RED: ReadonlySet<AttentionKind> = new Set([
  "station_uncovered", "station_trim_due", "task_late", "checklist_missed", "fridge_out_of_range", "catering_not_rung",
]);

export function severityOf(kind: AttentionKind): AttentionSeverity {
  return RED.has(kind) ? "red" : "yellow";
}

export function rankAttention<T extends AttentionRow>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out.sort((a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind) || a.key.localeCompare(b.key));
}

/**
 * The score, honest about evidence (Astra #7): with every source answering, an empty list is green;
 * with sources missing, an empty list claims NOTHING (null) — rows that did arrive still colour it.
 */
export function attentionScore(rows: readonly AttentionRow[], evidence: AttentionEvidence = "complete"): PulseScore | null {
  if (rows.length === 0) return evidence === "complete" ? "green" : null;
  return rows.some((r) => r.severity === "red") ? "red" : "yellow";
}

export function attentionEvidence(attempted: number, failed: number): AttentionEvidence {
  if (failed === 0) return "complete";
  return failed >= attempted ? "unavailable" : "partial";
}

/** Crew (<4): only what concerns THEM, plus shop-wide reminders. Never other people, never money. */
export function crewAttention(rows: readonly AttentionRowScoped[], viewerId: string): AttentionRowScoped[] {
  return rows.filter((r) => r.shopWide === true || (r.subjectUserIds?.includes(viewerId) ?? false));
}

/** Authorization-only metadata never leaves the server (Astra #4). */
export function stripAttentionRows(rows: readonly AttentionRowScoped[]): AttentionRow[] {
  return rows.map(({ subjectUserIds: _s, shopWide: _w, ...row }) => row);
}
