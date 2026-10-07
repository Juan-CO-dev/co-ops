/** CC operator entry: see docs/runbooks/toast-order-capture.md. Never imports env files. */
import { pathToFileURL } from "node:url";
import { backfillDates, captureErrorCode } from "../lib/toast/capture-runner";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [mode, ...extra] = args;
  let from: string | undefined, through: string | undefined;
  let retryCompleted = false;
  if (!["probe", "backfill", "channel-seed"].includes(mode ?? "")) throw new Error("capture_invalid_mode");
  for (let i = 0; i < extra.length; i++) {
    const flag = extra[i];
    if (flag === "--retry-completed" && mode === "backfill") retryCompleted = true;
    else if ((flag === "--from" || flag === "--through") && mode === "backfill") {
      const value = extra[++i];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("capture_invalid_date");
      if (flag === "--from") from = value; else through = value;
    } else throw new Error("capture_invalid_flag");
  }
  const dates = backfillDates(from, through); // Validate before creating a client or writing.
  const { getServiceRoleClient } = await import("../lib/supabase-server");
  const { captureToastDaySystem, probeToastDate, captureEnabled } = await import("../lib/toast/capture");
  if (mode !== "channel-seed" && !captureEnabled()) throw new Error("capture_disabled_or_fixture");
  const sb = getServiceRoleClient();
  const locations = await sb.from("locations").select("id").eq("active", true)
    .not("toast_restaurant_guid", "is", null).order("id").returns<{ id: string }[]>();
  if (locations.error || !locations.data?.length) throw new Error("capture_locations_unavailable");
  if (mode === "channel-seed") {
    // Paginate existing legacy labels; output ONLY config vocabulary, no customer/order fields.
    const labels = new Set<string>();
    for (const location of locations.data) {
      for (let start = 0; ; start += 1000) {
        const page = await sb.from("toast_sales_events").select("id,dining_option")
          .eq("location_id", location.id).order("id").range(start, start + 999)
          .returns<{ id: string; dining_option: string | null }[]>();
        if (page.error || !page.data) throw new Error("capture_labels_read_failed");
        for (const row of page.data) if (row.dining_option) labels.add(row.dining_option);
        if (page.data.length < 1000) break;
      }
    }
    console.log(JSON.stringify([...labels].sort().map((label) => ({ dining_option_label: label, channel: "Unknown", provider: null, fulfillment: null })), null, 2));
    return;
  }
  // Every backfill starts with a real probe for every shop. Empty is inconclusive;
  // an HTTP/access failure aborts before writes, while an empty date doesn't invent retention.
  for (const location of locations.data) {
    const result = await probeToastDate(location.id);
    console.log(JSON.stringify({ mode: "probe", location: location.id, date: "2025-10-01", ...result,
      retention: result.orders > 0 ? "data_returned" : "empty_retention_unproven" }));
  }
  if (mode === "probe") return;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    // Newest first through yesterday ET unless the operator selects a window.
    for (const date of dates) {
      for (const location of locations.data) {
        if (stopping) return;
        const result = await captureToastDaySystem(location.id, date, { resume: !retryCompleted, backfill: true });
        console.log(JSON.stringify({ mode, date, location: location.id, ...result }));
        if ("reason" in result && typeof result.reason === "string") throw new Error(result.reason);
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(captureErrorCode(error)); process.exitCode = 1; });
}
