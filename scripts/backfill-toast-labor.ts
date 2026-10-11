/** CC operator entry: injected environment only; no provider payloads in output. */
import { pathToFileURL } from "node:url";
import { etCalendarDate } from "../lib/operational-day";

export function laborBackfillDates(args: string[], now = new Date()): string[] {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if ((flag !== "--from" && flag !== "--through") || values.has(flag)) throw new Error("toast_labor_invalid_flag");
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value) throw new Error("toast_labor_invalid_date");
    values.set(flag, value);
  }
  const from = values.get("--from"), through = values.get("--through");
  const latest = new Date(Date.parse(etCalendarDate(now.toISOString())) - 2 * 86_400_000).toISOString().slice(0, 10);
  if (!from || !through || from > through || through > latest) throw new Error("toast_labor_invalid_window");
  const dates: string[] = [];
  for (let at = Date.parse(from); at <= Date.parse(through); at += 86_400_000) dates.push(new Date(at).toISOString().slice(0, 10));
  return dates;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const dates = laborBackfillDates(args); // Refuse unsafe dates before imports or I/O.
  if (process.env.TOAST_LABOR_PULL !== "1") throw new Error("toast_labor_disabled");
  const { runToastLaborPull } = await import("../lib/toast/labor");
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    for (let i = 0; i < dates.length; i += 7) {
      if (stopping) throw new Error("toast_labor_interrupted");
      const chunk = dates.slice(i, i + 7);
      const result = await runToastLaborPull(chunk, { deadlineMs: 300_000, context: "backfill" });
      const failures = result.results.filter((r) => !r.ok).map((r) => r.error ?? "toast_labor_failed");
      if (!result.ran) failures.push("toast_labor_disabled");
      if (!result.results.length) failures.push("toast_labor_no_locations");
      console.log(JSON.stringify({ from: chunk[0], through: chunk.at(-1),
        rows: result.results.reduce((n, r) => n + r.rows, 0), modified: result.modified, failures }));
      if (failures.length) throw new Error("toast_labor_backfill_failed");
    }
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Our own fixed codes are safe to print; anything else (provider text) stays generic.
  main().catch((e) => {
    console.error(e instanceof Error && /^toast_labor_[a-z_]+$/.test(e.message) ? e.message : "toast_labor_backfill_failed");
    process.exitCode = 1;
  });
}
