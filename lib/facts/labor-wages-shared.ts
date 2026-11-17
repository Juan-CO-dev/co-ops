/** Item 2 PR 2c (labor plan r6 §2 + Astra r6 P1): THE rate pick, pure (no I/O, no clock, no env).
 *
 * Two steps, two owners, never a second resolver:
 *  Step 1 (SQL, 0338 `fact_wage_current_versions`): supersession. A wage (user_id, wage_id) has two lanes
 *    (upcoming, current). Each lane's HEAD is its greatest-seq observation. A lane is ELIGIBLE when it is
 *    the current lane (live or retired: a retired current wage is the truth for its past dates) or a LIVE
 *    upcoming lane. Of the eligible lanes the one ASSERTED most recently (greatest seq of a non-retire
 *    observation) is the wage's ONE version. So a promotion supersedes the upcoming row the moment the
 *    current row is inserted, whatever the dates, roles or retire order (an incomplete snapshot leaves the
 *    upcoming row live, and it still never prices anything).
 *  Step 2 (here): the rate for (role R, day D) over those versions only.
 *    1. role tier: role_id = R, then role_id null, then any (R "0" = no role: null, then any);
 *    2. dated on or before D beats undated; the greatest effective_date wins;
 *    3. tie: current before upcoming, then the greatest seq.
 *    Nothing eligible: the FIRST KNOWN wage (role tier, smallest dated date, current first, greatest seq;
 *    undated only when nothing is dated) is carried back as `before_first_known` (Q5); no version = `none`.
 */
export type WageType = "hourly" | "weekly_salary" | "annual_salary";
export interface WageVersion {
  user_id: string; wage_id: string; upcoming: boolean; effective_date: string | null; wage_type: WageType;
  wage_cents: number; role_id: string | null; active: boolean; seq: number;
}
export type RateBasis = "known" | "undated" | "before_first_known" | "none";
export type PayClass = "hourly" | "salaried";
export interface WagePick { basis: RateBasis; rate: WageVersion | null; carryBack: WageVersion | null; payClass: PayClass }

const idText = (v: unknown): string | null => v === null || v === undefined ? null : String(v);
const dateText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** A row of fact_wage_current_versions (PostgREST or pg) as a WageVersion: ids as digit strings. */
export function toWageVersion(r: Record<string, unknown>): WageVersion {
  return {
    user_id: String(r.user_id), wage_id: String(r.wage_id), upcoming: r.upcoming === true, effective_date: dateText(r.effective_date),
    wage_type: r.wage_type as WageType, wage_cents: Number(r.wage_cents), role_id: idText(r.role_id), active: r.active === true, seq: Number(r.seq),
  };
}

export const payClassOf = (w: Pick<WageVersion, "wage_type">): PayClass => w.wage_type === "hourly" ? "hourly" : "salaried";

function tier(w: WageVersion, roleKey: string): number {
  if (roleKey !== "0" && w.role_id === roleKey) return 0;
  if (w.role_id === null) return 1;
  return 2;
}
/** current before upcoming, then the greater seq */
const lane = (a: WageVersion, b: WageVersion) => Number(a.upcoming) - Number(b.upcoming) || b.seq - a.seq;

export function pickWage(versions: readonly WageVersion[], roleKey: string, date: string): WagePick {
  if (versions.length === 0) return { basis: "none", rate: null, carryBack: null, payClass: "hourly" };
  const eligible = versions.filter((w) => w.effective_date === null || w.effective_date <= date);
  if (eligible.length > 0) {
    const best = [...eligible].sort((a, b) => tier(a, roleKey) - tier(b, roleKey)
      || Number(a.effective_date === null) - Number(b.effective_date === null)
      || (a.effective_date !== null && b.effective_date !== null ? b.effective_date.localeCompare(a.effective_date) : 0)
      || lane(a, b))[0]!;
    return { basis: best.effective_date === null ? "undated" : "known", rate: best, carryBack: null, payClass: payClassOf(best) };
  }
  // Every version starts after D (an undated one would have been eligible): carry the first known back.
  const first = [...versions].sort((a, b) => tier(a, roleKey) - tier(b, roleKey)
    || (a.effective_date ?? "").localeCompare(b.effective_date ?? "") || lane(a, b))[0]!;
  return { basis: "before_first_known", rate: null, carryBack: first, payClass: payClassOf(first) };
}
