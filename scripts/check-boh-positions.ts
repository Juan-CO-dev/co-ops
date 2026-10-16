/**
 * READ-ONLY dry run for the BOH positions data step (Scheduling Phase 1, Task 14b, R3).
 *
 *   npx tsx --env-file=.env.local scripts/check-boh-positions.ts
 *
 * Prints, per active shop, whether positions named exactly "Prep" and "Prep/Dishwasher" exist and are
 * active, on which station, and their Spanish names. Exit 0 when every active shop has both; exit 1
 * otherwise. It NEVER writes: service role, SELECT only. The data step itself is a human act through
 * the existing station admin (docs/runbooks/boh-positions.md), never a migration or a seed.
 * The report logic is pure in lib/people/boh-positions-shared.ts (tested in tests/boh-positions.test.ts).
 */
import { pathToFileURL } from "node:url";
import { bohPositionsReport, formatBohReport, type BohPositionRow, type BohShopRow, type BohStationRow } from "@/lib/people/boh-positions-shared";

async function main(): Promise<number> {
  const { getServiceRoleClient } = await import("@/lib/supabase-server");
  const sb = getServiceRoleClient();
  const shops = await sb.from("locations").select("id, name, active").eq("active", true).order("name", { ascending: true });
  if (shops.error) throw new Error(`locations: ${shops.error.message}`);
  const ids = (shops.data ?? []).map((s) => s.id as string);
  const stations = ids.length
    ? await sb.from("stations").select("id, location_id, name, active").in("location_id", ids).order("id", { ascending: true })
    : { data: [], error: null };
  if (stations.error) throw new Error(`stations: ${stations.error.message}`);
  const positions = ids.length
    ? await sb.from("station_positions").select("id, station_id, location_id, name, name_es, active").in("location_id", ids)
      .in("name", ["Prep", "Prep/Dishwasher"]).order("id", { ascending: true })
    : { data: [], error: null };
  if (positions.error) throw new Error(`station_positions: ${positions.error.message}`);
  const report = bohPositionsReport(
    (shops.data ?? []) as BohShopRow[], (stations.data ?? []) as BohStationRow[], (positions.data ?? []) as BohPositionRow[],
  );
  console.log(formatBohReport(report));
  return report.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
}
