/**
 * THE BOH POSITIONS REPORT (R3) — pure. Scheduling Phase 1, Task 14b.
 *
 * The data step that names the two back-of-house positions "Prep" and "Prep/Dishwasher" at every shop is
 * a HUMAN act through the existing station admin (`/admin/stations` → the prep station → Positions),
 * never a migration or a seed. `scripts/check-boh-positions.ts` is its read-only dry run: it loads the
 * rows and prints this report before and after. The names are matched EXACTLY, as data (a report, not
 * logic): nothing in the app keys on them. Shops are ids and names, never codes.
 */

/** The two position names the PM v2 criteria hang on (docs/seed criteria table, R1 / R3). */
export const BOH_POSITION_NAMES = ["Prep", "Prep/Dishwasher"] as const;
export type BohPositionName = (typeof BOH_POSITION_NAMES)[number];

export interface BohShopRow { id: string; name: string; active: boolean }
export interface BohStationRow { id: string; location_id: string; name: string; active: boolean }
export interface BohPositionRow {
  id: string; station_id: string; location_id: string; name: string; name_es: string | null; active: boolean;
}

export interface BohFinding {
  name: BohPositionName;
  /** "ok" = exactly one ACTIVE position with that exact name at the shop. */
  state: "ok" | "missing" | "inactive" | "duplicate";
  matches: Array<{ positionId: string; station: string; nameEs: string | null; active: boolean }>;
}
export interface BohShopReport { locationId: string; shop: string; ready: boolean; findings: BohFinding[] }
export interface BohReport { shops: BohShopReport[]; ready: boolean }

/** Per ACTIVE shop: does each BOH position exist exactly once, active, and on which station. */
export function bohPositionsReport(
  shops: readonly BohShopRow[],
  stations: readonly BohStationRow[],
  positions: readonly BohPositionRow[],
): BohReport {
  const stationName = new Map(stations.map((s) => [s.id, s.name] as const));
  const out: BohShopReport[] = [];
  for (const shop of [...shops].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const findings: BohFinding[] = BOH_POSITION_NAMES.map((name) => {
      const matches = positions
        .filter((p) => p.location_id === shop.id && p.name === name)
        .sort((a, b) => Number(b.active) - Number(a.active) || a.id.localeCompare(b.id))
        .map((p) => ({ positionId: p.id, station: stationName.get(p.station_id) ?? "?", nameEs: p.name_es, active: p.active }));
      const live = matches.filter((m) => m.active);
      const state: BohFinding["state"] = live.length === 1 ? "ok" : live.length > 1 ? "duplicate" : matches.length ? "inactive" : "missing";
      return { name, state, matches };
    });
    out.push({ locationId: shop.id, shop: shop.name, ready: findings.every((f) => f.state === "ok"), findings });
  }
  return { shops: out, ready: out.length > 0 && out.every((s) => s.ready) };
}

/** The printed report (plain English: it is a runbook artefact pasted into the PR, not a UI surface). */
export function formatBohReport(report: BohReport): string {
  const lines: string[] = [];
  for (const shop of report.shops) {
    lines.push(`${shop.shop} (${shop.locationId}): ${shop.ready ? "READY" : "NOT READY"}`);
    for (const f of shop.findings) {
      const where = f.matches.map((m) => `${m.station}${m.active ? "" : " [inactive]"} · es: ${m.nameEs ?? "(none)"}`).join("; ");
      lines.push(`  ${f.name}: ${f.state}${where ? ` — ${where}` : ""}`);
    }
  }
  if (!report.shops.length) lines.push("No active shop found.");
  lines.push(report.ready ? "All shops have both positions. Exit 0." : "Not every shop has both positions yet. Exit 1.");
  return lines.join("\n");
}
