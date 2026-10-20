/**
 * EMPLOYMENT RECORDS — the READ side (0279), lean on purpose: the scheduling loader and the Users screen import it
 * without pulling in user management's writers. A missing table (0279 not applied yet) is "not available", never a 500.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "@/lib/people/facts";
import { selectAllRows } from "@/lib/supabase-paginate";
import { ACTIVE_STATE, employmentStatesByUser, type EmploymentEventKind, type EmploymentEventRow, type EmploymentState, type RehireSetting } from "./employment-core-shared";

export const ID_CHUNK = 100;
const COLUMNS = "id, user_id, kind, corrects_id, leave_reason, expected_back, separation_type, last_day_worked, reason, rehire, rehire_note, note, actor_id, created_at";
type Db = {
  id: string; user_id: string; kind: EmploymentEventKind; corrects_id: string | null; leave_reason: EmploymentEventRow["leaveReason"];
  expected_back: string | null; separation_type: EmploymentEventRow["separationType"]; last_day_worked: string | null; reason: string | null;
  rehire: RehireSetting | null; rehire_note: string | null; note: string | null; actor_id: string; created_at: string;
};
const rowOf = (r: Db): EmploymentEventRow => ({
  id: r.id, userId: r.user_id, kind: r.kind, correctsId: r.corrects_id, leaveReason: r.leave_reason, expectedBack: r.expected_back,
  separationType: r.separation_type, lastDayWorked: r.last_day_worked, reason: r.reason, rehire: r.rehire, rehireNote: r.rehire_note,
  note: r.note, actorId: r.actor_id, createdAt: r.created_at,
});

export interface EmploymentStates {
  /** False before 0279 is applied (every state then reads active). */
  available: boolean;
  states: Map<string, EmploymentState>;
}

/** One batch read of 0279 for these people. A missing table = not available (never a 500). */
export async function loadEmploymentStates(sb: SupabaseClient, userIds: readonly string[]): Promise<EmploymentStates> {
  const ids = [...new Set(userIds)];
  const rows: EmploymentEventRow[] = [];
  try {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      rows.push(...(await selectAllRows<Db>((from, to) => sb.from("user_employment_events").select(COLUMNS)
        .in("user_id", chunk).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to))).map(rowOf));
    }
  } catch (e) {
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) })) return { available: false, states: new Map() };
    throw e;
  }
  return { available: true, states: employmentStatesByUser(rows) };
}

export const stateOf = (s: EmploymentStates, userId: string): EmploymentState => s.states.get(userId) ?? ACTIVE_STATE;

/** Is 0279 applied? (One cheap read; a missing table is false, anything else throws.) */
export async function employmentAvailable(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from("user_employment_events").select("id").limit(1);
  if (!error) return true;
  if (isMissingTable(error)) return false;
  throw new Error(`employmentAvailable failed: ${error.code ?? "unknown"}`);
}

/** Every person with a separation or a leave on record (the rehire warning's candidates; the reconciliation's absentees). */
export async function peopleWithEvents(sb: SupabaseClient): Promise<string[] | null> {
  try {
    const rows = await selectAllRows<{ user_id: string }>((from, to) => sb.from("user_employment_events").select("user_id")
      .in("kind", ["separated", "leave_start"]).order("user_id", { ascending: true }).range(from, to));
    return [...new Set(rows.map((r) => r.user_id))];
  } catch (e) {
    if (isMissingTable({ message: e instanceof Error ? e.message : String(e) })) return null;
    throw e;
  }
}

