import type { RoleCode } from "@/lib/roles";
import type { Health } from "@/lib/team-scoring";

export interface NarrativeLine {
  /** i18n key as plain string; caller casts to TranslationKey for serverT. */
  key: string;
  params?: Record<string, string | number>;
}

export interface PersonNarrativeInput {
  rank: number;
  role: RoleCode;
  health: Health;
  reasons: string[];
  scoreDeltaPct: number | null;
  onTimePct: number | null;
}

/** The rich "read" — one summary line chosen by the dominant signal. */
export function personReadNarrative(p: PersonNarrativeInput): NarrativeLine {
  if (p.health === "needs_attention") {
    if (p.reasons.includes("sharp_drop") && p.scoreDeltaPct !== null) {
      return { key: "people.read.tasks_down", params: { pct: Math.abs(p.scoreDeltaPct) } };
    }
    const missing = p.reasons.find((r) => r.startsWith("no_"));
    if (missing) {
      return { key: "people.read.missing_category", params: { category: missing.slice(3) } };
    }
    return { key: "people.read.needs_attention_generic" };
  }
  if (p.rank === 1) return { key: "people.read.top_contributor", params: { delta: p.scoreDeltaPct ?? 0 } };
  if (p.onTimePct !== null && p.onTimePct >= 95) return { key: "people.read.steady_reliable", params: { ontime: p.onTimePct } };
  return { key: "people.read.on_track_generic" };
}

/** Short one-liner under a roster card. */
export function personCardLine(p: PersonNarrativeInput): NarrativeLine {
  if (p.health === "needs_attention") {
    if (p.reasons.includes("sharp_drop") && p.scoreDeltaPct !== null) {
      return { key: "people.line.down", params: { pct: Math.abs(p.scoreDeltaPct) } };
    }
    return { key: "people.line.check_in" };
  }
  if (p.rank === 1) return { key: "people.line.top" };
  return { key: "people.line.steady" };
}

export function teamBannerNarrative(s: { onTrack: number; needsAttention: number; attentionNames: string[] }): NarrativeLine {
  if (s.needsAttention === 0) return { key: "people.banner.all_on_track", params: { onTrack: s.onTrack } };
  return {
    key: "people.banner.some_attention",
    params: { onTrack: s.onTrack, needs: s.needsAttention, names: s.attentionNames.join(", ") },
  };
}

export interface MyPerformanceReadInput {
  role: RoleCode;
  scoreDeltaPct: number | null;
  onTimePct: number | null;
  activeDayStreak: number;
  mvpAwards: number;
  gradient: { great: number; good: number; needsWork: number };
}

/**
 * Positive-only "read" for the employee self-view. NEVER returns a
 * needs-attention key — picks the strongest positive signal, falling back to a
 * neutral-encouraging steady line. (A quiet period reads as "steady", not a flag.)
 */
export function myPerformanceRead(p: MyPerformanceReadInput): NarrativeLine {
  if (p.mvpAwards > 0) return { key: "me.read.mvp", params: { n: p.mvpAwards } };
  if (p.activeDayStreak >= 5) return { key: "me.read.streak", params: { n: p.activeDayStreak } };
  if (p.scoreDeltaPct !== null && p.scoreDeltaPct > 0) return { key: "me.read.up", params: { pct: p.scoreDeltaPct } };
  if (p.onTimePct !== null && p.onTimePct >= 90) return { key: "me.read.reliable", params: { ontime: p.onTimePct } };
  if (p.gradient.great >= p.gradient.good + p.gradient.needsWork && p.gradient.great > 0) return { key: "me.read.strong_gradients" };
  return { key: "me.read.steady" };
}
