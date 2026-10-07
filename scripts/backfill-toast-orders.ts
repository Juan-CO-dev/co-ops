/** CC operator entry: see docs/runbooks/toast-order-capture.md. Never imports env files. */
import { pathToFileURL } from "node:url";
import { backfillDates, captureErrorCode } from "../lib/toast/capture-runner";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [mode, ...extra] = args;
  if (!["probe", "backfill", "channel-seed"].includes(mode ?? "") || extra.some((v) => v !== "--retry-completed")) {
    throw new Error("Usage: backfill-toast-orders.ts probe|backfill|channel-seed [--retry-completed]");
  }
  const { getServiceRoleClient } = await import("../lib/supabase-server");
  const { captureToastDaySystem, probeToastDate } = await import("../lib/toast/capture");
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
    // Exact 12-month half-open window ending 2026-07-23, newest first.
    for (const date of backfillDates()) {
      for (const location of locations.data) {
        if (stopping) return;
        const result = await captureToastDaySystem(location.id, date, { resume: !extra.includes("--retry-completed") });
        console.log(JSON.stringify({ mode, date, location: location.id, ...result }));
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
