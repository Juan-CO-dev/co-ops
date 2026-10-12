import type { HeatmapGrid } from "@/lib/sales-reports-shared";

/** One context hour either side of the observed checks, including zero-dollar sales. */
export function heatmapHours(grid: HeatmapGrid): number[] {
  const active = Array.from({ length: 24 }, (_, hour) => hour)
    .filter((hour) => grid.checks.some((row) => (row[hour] ?? 0) > 0));
  if (!active.length) return [];
  const first = Math.max(0, active[0]! - 1);
  const last = Math.min(23, active[active.length - 1]! + 1);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
