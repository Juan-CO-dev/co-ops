/**
 * POSITION RANK — primary / secondary position per person (Juan 2026-10-20). Pure, zero I/O, client-safe.
 *
 * Storage: the ONE ordered list `schedule_person_settings.cover_positions` (0274): [0] = PRIMARY, [1] = SECONDARY,
 * [2..] = "can flex to". No migration: `record_schedule_person_settings` accepts any ordered, distinct list of the
 * shop's active positions for any person at the shop.
 *
 * The generator's hourly ranking (`rankCandidates`) puts the position rank FIRST: on position X, a person whose
 * primary is X (rank 0) beats one whose secondary is X (rank 1), who beats everyone else eligible (FLEX, rank 2 —
 * the "can flex to" entries included). Flex is allowed, only ranked last. A deficit with no single position (the
 * MoD lane, `positionId` null) ranks everyone as flex, so nothing changes there.
 *
 * HOURLY LEADS (Juan 2026-10-20: "put manager duties as secondary. They are hourly pay." — the shift lead and the key
 * holder, `isHourlyLeadRole`): [0] = their PRIMARY station, ranked like anyone's primary; their SECONDARY is always
 * MANAGER DUTIES — an implicit rule, never stored (MoD is not a position uuid): when the generator fills the manager-on-
 * duty lane or the Closing Manager's closing slot, a lead ranks 1 there (their station primary still wins a station slot).
 * The rest of their list ([1..]) is "can flex to" and keeps its existing cover-order meaning where the code reads it (a
 * shift lead's `cover_outside_preferences`). A lead with NO primary behaves exactly as before: every candidate of those
 * two lanes is a lead, so they all rank 1 together.
 *
 * SALARIED MANAGERS (GM / AGM) and every other manager role keep the list's EXISTING meaning, unchanged: their preferred
 * cover positions in order (the MoD cover ranking, `cover_outside_preferences`). For them there is no primary /
 * secondary: every rank here is flex, no primary reason is emitted and nothing is validated.
 *
 * Eligibility is unchanged: a rank never makes anyone eligible. `positionListProblems` is the save-time check (UI
 * and the save path, en + es) that a primary or secondary is one the person's work type allows.
 *
 * `suggestPrimaryFromToast`: a person with a Toast link and no primary gets a SUGGESTION from their most-worked Toast
 * job (hours, last 8 weeks), matched against the shop's ACTUAL position names; no confident match → no suggestion.
 * It is a button, never saved on its own.
 */
import type { RoleCode } from "@/lib/roles";
import type { RulePerson, WorkType } from "./context-shared";
import { isManagerRole, workTypeAllows } from "./rules-shared";
import type { PositionRole } from "./structure-shared";

// ─── The rank ────────────────────────────────────────────────────────────────

export const POSITION_RANK = { primary: 0, secondary: 1, flex: 2 } as const;
export type PositionRank = (typeof POSITION_RANK)[keyof typeof POSITION_RANK];

/**
 * The HOURLY LEAD roles: paid hourly (not the salaried GM / AGM, not the presence-only MoO / Owner, not the never-generated
 * catering / prep managers, never the CGS / social media manager) AND able to lead a shift (manager on duty or Closing
 * Manager): the shift lead and the key holder. Pinned against the role table by a test.
 */
export const HOURLY_LEAD_ROLES: readonly RoleCode[] = ["shift_lead", "key_holder"];
export function isHourlyLeadRole(role: RoleCode): boolean {
  return HOURLY_LEAD_ROLES.includes(role);
}

/** Does this person have a primary at all? Everyone below shift lead, and the hourly leads; a salaried manager's list is their cover order. */
export function hasPositionRank(p: Pick<RulePerson, "role">): boolean {
  return !isManagerRole(p.role) || isHourlyLeadRole(p.role);
}

/**
 * The person's rank on `positionId`: 0 = their primary, 1 = their secondary, 2 = flex (everything else — the "can flex
 * to" entries, a position not on the list, an empty list, a null position — and every salaried manager). For an hourly
 * lead the secondary is MANAGER DUTIES: `managerDuty` (the MoD lane, the Closing Manager's slot) ranks them 1 unless the
 * slot is their primary station; a station entry of theirs is never rank 1.
 */
export function positionRankOf(p: Pick<RulePerson, "role" | "coverPositions">, positionId: string | null, managerDuty = false): PositionRank {
  if (!hasPositionRank(p)) return POSITION_RANK.flex;
  const lead = isHourlyLeadRole(p.role);
  const i = positionId === null ? -1 : p.coverPositions.indexOf(positionId);
  const station = i === 0 ? POSITION_RANK.primary : i === 1 && !lead ? POSITION_RANK.secondary : POSITION_RANK.flex;
  return managerDuty && lead && station === POSITION_RANK.flex ? POSITION_RANK.secondary : station;
}

/** The person's primary position, or null when their list is empty (and always null for a manager). */
export function primaryPositionOf(p: Pick<RulePerson, "role" | "coverPositions">): string | null {
  return hasPositionRank(p) ? p.coverPositions[0] ?? null : null;
}

// ─── The list helpers (the editors) ──────────────────────────────────────────

/**
 * The ordered list after picking a primary and a secondary, keeping the "can flex to" tail (entries [2..] minus the
 * two picks). Nothing is ever PROMOTED silently (Astra BC-013): no primary → the whole list is cleared, and no secondary
 * → the tail is cleared too (its first entry would otherwise become the secondary). The pickers say so before a save
 * ("None, and clear the N other positions"); choosing a secondary FROM the tail moves it up explicitly. A secondary
 * equal to the primary counts as none.
 */
export function withPrimarySecondary(list: readonly string[], primary: string | null, secondary: string | null): string[] {
  if (!primary) return [];
  const second = secondary && secondary !== primary ? secondary : null;
  if (!second) return [primary];
  return [primary, second, ...list.slice(2).filter((x) => x !== primary && x !== second)];
}

/**
 * An hourly lead's list after picking a primary station (their secondary is manager duties, not in the list): the new
 * primary first, then everything else they had, in order (the old primary moves to the front of "can flex to" — for a
 * shift lead the list is also the positions they may cover, so nothing is dropped). No primary → the list is cleared
 * (its first entry would otherwise become the primary; the pickers name the count first).
 */
export function withLeadPrimary(list: readonly string[], primary: string | null): string[] {
  if (!primary) return [];
  return [primary, ...list.filter((x) => x !== primary)];
}

/** The label role of entry `i` of the ordered list (an hourly lead's secondary is manager duties, so their [1..] are flex). */
export function positionSlotOf(i: number, lead = false): "primary" | "secondary" | "flex" {
  return i === 0 ? "primary" : i === 1 && !lead ? "secondary" : "flex";
}

// ─── Save-time validation ────────────────────────────────────────────────────

export interface PositionListPerson { role: RoleCode; workType: WorkType; alsoAllowed: ReadonlyArray<"boh" | "foh"> }
export interface PositionListProblem { slot: "primary" | "secondary"; positionId: string; code: "work_type" }

/**
 * The primary and secondary (entries 0 and 1) the person may never hold: their work type (with "also allowed") does not
 * allow the position. `workType` is the EFFECTIVE one (the setting, else the role default). Positions whose role is
 * unknown are skipped: until the shop's structure is SAVED every position reads as a line position, so a check there
 * would refuse a correct BOH primary — the caller passes only known roles. The "can flex to" tail is not judged (it
 * never makes anyone eligible either), and a manager's list (their cover order) is not judged at all — unchanged.
 */
export function positionListProblems(person: PositionListPerson, list: readonly string[], roles: Readonly<Record<string, PositionRole>>): PositionListProblem[] {
  if (!hasPositionRank(person)) return [];
  const out: PositionListProblem[] = [];
  const asPerson = { workType: person.workType, alsoAllowed: [...person.alsoAllowed] };
  // An hourly lead's secondary is manager duties: only their primary station is judged.
  list.slice(0, isHourlyLeadRole(person.role) ? 1 : 2).forEach((positionId, i) => {
    const role = roles[positionId];
    if (role && !workTypeAllows(asPerson, { role })) out.push({ slot: i === 0 ? "primary" : "secondary", positionId, code: "work_type" });
  });
  return out;
}

// ─── The Toast suggestion ────────────────────────────────────────────────────

/** Words that say nothing about WHICH position ("Sandwich Maker" is about the sandwich). */
const FILLER = new Set(["maker", "makers", "person", "staff", "worker", "workers", "team", "crew", "member", "and", "the", "of", "y", "de", "la", "el"]);
/** One spelling per idea: every dishwashing word is "dish". */
const CANON: Readonly<Record<string, string>> = { dishwasher: "dish", dishwashers: "dish", dishwashing: "dish", dishes: "dish", dishwash: "dish" };
/** A Toast job that names a FUNCTION, not a position name: the shop's single position of that role. */
const JOB_ROLE: Readonly<Record<string, PositionRole>> = { counter: "register", cashier: "register" };

/** A name as its set of canonical words (lower case, accents dropped, punctuation splits, filler dropped). */
export function nameTokens(name: string): string[] {
  const words = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  return [...new Set(words.map((w) => CANON[w] ?? w).filter((w) => !FILLER.has(w)))].sort();
}

export interface SuggestPosition { id: string; name: string; role: PositionRole | null }
export interface ToastPrimarySuggestion { positionId: string; jobName: string }

/**
 * The position a Toast job name confidently names at this shop, or null. In order, the first rule with EXACTLY one
 * position wins (two or more = not confident = null, never a guess): the same words ("Dish/Prep" = "Prep / Dishwasher",
 * "Prep" = "Prep"); every word of the job inside the position's name ("Sandwich Maker" → a "Sandwich line"); a job that
 * names a function ("Counter") → the shop's one position of that role.
 */
export function matchToastJob(jobName: string, positions: readonly SuggestPosition[]): string | null {
  const job = nameTokens(jobName);
  if (job.length === 0) return null;
  const named = positions.map((p) => ({ p, words: nameTokens(p.name) }));
  const one = (hits: readonly SuggestPosition[]) => (hits.length === 1 ? hits[0]!.id : null);
  const same = named.filter((x) => x.words.length === job.length && x.words.every((w, i) => w === job[i])).map((x) => x.p);
  if (same.length > 0) return one(same);
  const within = named.filter((x) => job.every((w) => x.words.includes(w))).map((x) => x.p);
  if (within.length > 0) return one(within);
  const roles = [...new Set(job.map((w) => JOB_ROLE[w]).filter((r): r is PositionRole => !!r))];
  if (roles.length !== 1) return null;
  return one(positions.filter((p) => p.role === roles[0]));
}

/**
 * The suggested primary from a person's Toast hours by job (the last 8 weeks): their MOST-worked job (a tie at the top
 * = not confident = null), matched by `matchToastJob`. Jobs without a name and non-positive hours are ignored.
 */
export function suggestPrimaryFromToast(hoursByJob: Readonly<Record<string, number>>, positions: readonly SuggestPosition[]): ToastPrimarySuggestion | null {
  const jobs = Object.entries(hoursByJob).filter(([name, h]) => name.trim() !== "" && Number.isFinite(h) && h > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const top = jobs[0];
  if (!top) return null;
  if (jobs[1] && jobs[1][1] === top[1]) return null;
  const positionId = matchToastJob(top[0], positions);
  return positionId ? { positionId, jobName: top[0] } : null;
}

/** How many days of Toast punches the suggestion reads (8 weeks). */
export const TOAST_SUGGESTION_DAYS = 56;
