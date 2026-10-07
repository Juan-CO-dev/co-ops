import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";

/** Hub provenance is consumed only when returning to the Reports landing. */
export function reportParentContext(parentPath: string, params: Record<string, string | undefined>, level: number): Record<string, string | undefined> {
  if (parentPath !== "/reports") return params;
  return {
    ...params,
    location: level >= REPORT_ALL_LOCATIONS_LEVEL && params.hubLocation === "all" ? "all" : params.location,
    hubLocation: undefined,
  };
}

/** Preserve browse context verbatim when moving through the reports hierarchy. */
export function reportNavigationHref(path: string, params: Record<string, string | undefined>, location?: string): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  if (location !== undefined) { query.set("location", location); query.delete("loc"); }
  return `${path}${query.size ? `?${query}` : ""}`;
}
