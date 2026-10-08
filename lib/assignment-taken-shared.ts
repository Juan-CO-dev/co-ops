import type { TaskType } from "./assignments-shared";
import { etYmdMinusDays, operationalDayUtcRange } from "./operational-day";

export interface TakenTask { id: string; task: TaskType; userId: string; at: string }

/** An opener survives a drop for forensics, so it cannot resurrect ownership.
 * A different explicit assignee has no claim timestamp in this legacy schema;
 * do not label them Taken using the original opener's time.
 */
export function checklistTakenOwner(row: {
  triggered_by_user_id: string | null; triggered_at: string | null;
  assigned_to: string | null; dropped_at: string | null;
}): { userId: string; at: string } | null {
  if (row.dropped_at || !row.triggered_by_user_id || !row.triggered_at) return null;
  if (row.assigned_to && row.assigned_to !== row.triggered_by_user_id) return null;
  return { userId: row.triggered_by_user_id, at: row.triggered_at };
}

/** Use two local midnights: DST days have 23 or 25 hours. */
export function takenDayRange(date: string): { start: string; end: string } {
  return { start: operationalDayUtcRange(date).startIso,
    end: operationalDayUtcRange(etYmdMinusDays(date, -1)).startIso };
}

/** Several deliveries/counts/orders can belong to one person: show their first start. */
export function dedupeTakenTasks(rows: readonly TakenTask[]): TakenTask[] {
  const result = new Map<string, TakenTask>();
  const valid = rows.filter((row) => row.userId && Number.isFinite(Date.parse(row.at)));
  for (const row of valid.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))) {
    const key = `${row.task}/${row.userId}`;
    if (!result.has(key)) result.set(key, row);
  }
  return [...result.values()];
}
