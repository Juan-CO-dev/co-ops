/**
 * Needs attention — PURE ranking (client-safe, zero I/O). The server composes rows from the other
 * sections' facts (lib/pulse/sections.ts); this module owns the ORDER, the severity classes, the
 * score (same three states as v1's pulseScore) and the crew filter.
 */
import type { PulseScore } from "@/lib/midshift-shared";
import type { AttentionKind, AttentionRow, AttentionSeverity } from "@/lib/pulse/types";

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

export function rankAttention(rows: readonly AttentionRow[]): AttentionRow[] {
  const seen = new Set<string>();
  const out: AttentionRow[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out.sort((a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind) || a.key.localeCompare(b.key));
}

export function attentionScore(rows: readonly AttentionRow[]): PulseScore {
  if (rows.length === 0) return "green";
  return rows.some((r) => r.severity === "red") ? "red" : "yellow";
}

/** Crew (<4): only what concerns THEM, plus shop-wide reminders. Never other people, never money. */
export function crewAttention(rows: readonly AttentionRow[], viewerId: string): AttentionRow[] {
  return rows.filter((r) => r.shopWide === true || (r.subjectUserId != null && r.subjectUserId === viewerId));
}
