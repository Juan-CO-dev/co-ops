/**
 * THE SHARED GAP PARTITION — pure (PR SCH, plan r5 20.2; ruling D2). One rule for the crew generator and the edit tail
 * (and so `setDayOpening`, which re-validates through the edit tail): each undeclared deficit of a date is proven
 * TRUTHFULLY, piece by piece.
 *
 *  - On a crew-engine day a `mod_missing` hole that starts before the earliest typed manager-on-duty start
 *    (`crewEarliestModStart`) is split there. The early piece takes its own proof (the `no_mod_member` structure
 *    certificate where it holds) and the `crew_mod_start_mismatch` note; the rest is proven on its own. When the early
 *    piece cannot be proven alone, the whole interval is proven as one, as the crew generator always did.
 *  - Every other code, and every other piece, is proven on its own with `proveGap`.
 *  - A piece without a proof is NEVER suppressed: `generate` declares it `unresolved_search` (with the full candidate
 *    list); `edit` leaves it undeclared, so the validator reports it. Either way Approve is refused honestly
 *    (`unresolved_gaps` / `rules_failing`).
 *
 * For the generator this is a pure refactor of crew-shared's old tail: same selection, same order, same proofs against the
 * same growing gap list, so its output is byte-identical (the goldens and the crew acceptance test prove it).
 */
import type { RuleContext } from "./context-shared";
import type { BoardNote } from "./reasons-shared";
import {
  REPAIR_LIMITS, checkScheduleRules, crewEarliestModStart, proveGap,
  type DeclaredGap, type GapCode, type GapSubject, type RuleProblem, type WeekSchedule,
} from "./rules-shared";
import { scheduleEngine } from "./structure-shared";

export interface DeclareDayGapsOptions {
  /** generate: an unprovable piece is declared `unresolved_search`; edit: it stays undeclared (the validator reports it). */
  mode: "generate" | "edit";
  /** The `unresolved_search` certificate's candidates (generate only). */
  candidateIds: readonly string[];
  /** Gaps already declared for this date by the caller (never declared twice). */
  known: readonly DeclaredGap[];
  /** Which undeclared codes this caller declares (the selection each caller made before; default every code). */
  codes?: readonly GapCode[];
  /** The validator's problems over `schedule`, when the caller already has them (one validator run per week). */
  problems?: readonly RuleProblem[];
  /** Validate as a manager's edit (the station floor warns). */
  managerEdited?: boolean;
}

export interface DeclaredDay { gaps: DeclaredGap[]; notes: BoardNote[]; unresolved: GapSubject[] }

const same = (a: Pick<GapSubject, "code" | "positionId" | "fromQ" | "toQ">, b: Pick<GapSubject, "code" | "positionId" | "fromQ" | "toQ">) =>
  a.code === b.code && a.positionId === b.positionId && a.fromQ === b.fromQ && a.toQ === b.toQ;

/**
 * Declare `date`'s undeclared deficits. Proofs run against `schedule` plus every gap this call has declared so far (in
 * the validator's order), which is how the generator always proved them.
 */
export function declareDayGaps(date: string, schedule: WeekSchedule, ctx: RuleContext, opts: DeclareDayGapsOptions): DeclaredDay {
  const day = ctx.days[date];
  const out: DeclaredDay = { gaps: [], notes: [], unresolved: [] };
  if (!day) return out;
  const problems = opts.problems ?? checkScheduleRules(schedule, ctx, opts.managerEdited ? { managerEdited: true } : {});
  const crewDay = scheduleEngine(day.structure) === "crew";
  const probe = (): WeekSchedule => ({ ...schedule, gaps: [...schedule.gaps, ...out.gaps] });
  const declare = (subject: GapSubject, proof: NonNullable<ReturnType<typeof proveGap>>) => out.gaps.push({ ...subject, ...proof } as DeclaredGap);
  for (const p of problems) {
    if (p.inherited || p.code !== "undeclared_gap" || p.day !== date) continue;
    const code = p.params.gap as GapCode;
    if (opts.codes && !opts.codes.includes(code)) continue;
    const subject: GapSubject = { code, date, positionId: p.positionId ?? null, fromQ: Number(p.params.fromQ), toQ: Number(p.params.toQ) };
    if (opts.known.some((g) => same(g, subject))) continue;
    if (crewDay && subject.code === "mod_missing") {
      const earliestQ = crewEarliestModStart(day.structure, Object.values(ctx.people));
      if (subject.fromQ < earliestQ) {
        const early = { ...subject, toQ: Math.min(subject.toQ, earliestQ) };
        const proof = proveGap(early, probe(), ctx);
        if (proof) {
          declare(early, proof);
          out.notes.push({ code: "crew_mod_start_mismatch", date, userId: null, positionId: null, params: { earliestQ } });
          subject.fromQ = early.toQ;
          if (subject.fromQ >= subject.toQ) continue;
        }
      }
    }
    const proof = proveGap(subject, probe(), ctx);
    if (proof) declare(subject, proof);
    else if (opts.mode === "generate") {
      out.gaps.push({ ...subject, cause: "unresolved_search", certificate: { searched: { steps: 0, donorsTried: 0, chainDepth: 0 }, limits: { ...REPAIR_LIMITS }, candidateIds: [...opts.candidateIds] } } as DeclaredGap);
    } else out.unresolved.push(subject);
  }
  return out;
}
