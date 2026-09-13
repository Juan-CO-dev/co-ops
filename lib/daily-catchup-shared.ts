import type { DailyCatchUpEntry } from "./jobs-registry";

/** UTC schedule days, deliberately separate from the watcher's ET alert days. */
export function decideCatchUp(entry: DailyCatchUpEntry, now: Date, lastSuccessAt: string | null): boolean {
  const day = now.toISOString().slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const due = Date.parse(`${day}T${entry.dueUtc}:00Z`);
  return now.getTime() >= due + 90 * 60_000 &&
    (lastSuccessAt === null || Date.parse(lastSuccessAt) < midnight);
}
