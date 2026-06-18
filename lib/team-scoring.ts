import type { RoleCode } from "@/lib/roles";

export type ActionCategory = "tasks" | "finalizations" | "peopleMgmt" | "oversight" | "notes";
export const ALL_CATEGORIES: ActionCategory[] = ["tasks", "finalizations", "peopleMgmt", "oversight", "notes"];
export type CategoryCounts = Record<ActionCategory, number>;

export function emptyCounts(): CategoryCounts {
  return { tasks: 0, finalizations: 0, peopleMgmt: 0, oversight: 0, notes: 0 };
}

/**
 * Role code → expected categories. Keyed by ROLE CODE, not level: trainer and
 * key_holder are both level 4 but have different expected work. Unknown role
 * codes default to ["tasks","notes"]. moo/owner/cgs are excluded from the
 * roster (level < 8 filter upstream), so they need no entry.
 */
const ROLE_EXPECTED: Partial<Record<RoleCode, ActionCategory[]>> = {
  prospect: ["tasks", "notes"],
  hired_not_yet_worked: ["tasks", "notes"],
  trainee: ["tasks", "notes"],
  employee: ["tasks", "notes"],
  trainer: ["tasks", "notes"],
  key_holder: ["tasks", "finalizations", "notes", "oversight"],
  shift_lead: ["tasks", "finalizations", "notes", "oversight"],
  agm: ["finalizations", "peopleMgmt", "oversight", "notes"],
  gm: ["finalizations", "peopleMgmt", "oversight", "notes"],
  catering_mgr: ["finalizations", "peopleMgmt", "oversight", "notes"],
  prep_mgr: ["finalizations", "peopleMgmt", "oversight", "notes"],
  social_media_mgr: ["finalizations", "peopleMgmt", "oversight", "notes"],
};

export function expectedCategoriesFor(role: RoleCode): ActionCategory[] {
  return ROLE_EXPECTED[role] ?? ["tasks", "notes"];
}

/** Score = sum of counts in the role's expected categories (off-role categories not scored). */
export function scoreFromCounts(role: RoleCode, counts: CategoryCounts): number {
  return expectedCategoriesFor(role).reduce((s, c) => s + counts[c], 0);
}

export type Health = "on_track" | "needs_attention";
export interface HealthResult {
  health: Health;
  reasons: string[];
}

/**
 * needs_attention when ANY expected category is zero in the window, OR the
 * current score dropped to <= 60% of the previous window (when prev > 0).
 */
export function healthFromCounts(
  role: RoleCode,
  counts: CategoryCounts,
  currentScore: number,
  previousScore: number | null,
): HealthResult {
  const reasons: string[] = [];
  for (const c of expectedCategoriesFor(role)) {
    if (counts[c] === 0) reasons.push(`no_${c}`);
  }
  if (previousScore !== null && previousScore > 0 && currentScore <= previousScore * 0.6) {
    reasons.push("sharp_drop");
  }
  return { health: reasons.length ? "needs_attention" : "on_track", reasons };
}

/**
 * Consecutive active days ending at `today` (or yesterday-contiguous). Counts
 * backward while each prior calendar day is present. If not active today AND
 * not yesterday, streak is 0 (stale).
 */
export function activeDayStreak(activeDates: string[], today: string): number {
  const set = new Set(activeDates);
  const start = set.has(today) ? today : shiftDay(today, -1);
  if (!set.has(start)) return 0;
  let streak = 0;
  let d = start;
  while (set.has(d)) {
    streak++;
    d = shiftDay(d, -1);
  }
  return streak;
}

/** Trailing-true count in a chronological boolean list (most recent last). */
export function onTimeStreak(inWindowChrono: boolean[]): number {
  let n = 0;
  for (let i = inWindowChrono.length - 1; i >= 0; i--) {
    if (inWindowChrono[i]) n++;
    else break;
  }
  return n;
}

/** Max single-day count. */
export function personalBest(dayCounts: number[]): number {
  return dayCounts.length ? Math.max(...dayCounts) : 0;
}

/** Longest run of consecutive calendar days present in the set. */
export function longestStreak(dates: string[]): number {
  const set = new Set(dates);
  let best = 0;
  for (const d of set) {
    if (set.has(shiftDay(d, -1))) continue; // only count from a run start
    let len = 1;
    let cur = d;
    while (set.has(shiftDay(cur, 1))) { len++; cur = shiftDay(cur, 1); }
    if (len > best) best = len;
  }
  return best;
}

function shiftDay(yyyymmdd: string, delta: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
