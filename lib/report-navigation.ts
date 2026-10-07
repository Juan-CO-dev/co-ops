import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";

/** Only shared browse context belongs to the landing and its cards. */
export function reportLandingContext(params: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(["range", "from", "to", "compare", "location", "hubLocation"].filter(key => params[key] !== undefined).map(key => [key, params[key]]));
}

/** Hub provenance is consumed only when returning to the Reports landing. */
export function reportParentContext(parentPath: string, params: Record<string, string | undefined>, level: number): Record<string, string | undefined> {
  if (parentPath !== "/reports") return params;
  return {
    ...reportLandingContext(params),
    location: level >= REPORT_ALL_LOCATIONS_LEVEL && params.hubLocation === "all" ? "all" : params.location,
    hubLocation: undefined,
  };
}

/** Preserve browse context verbatim when moving through the reports hierarchy. */
export function reportNavigationHref(path: string, params: Record<string, string | undefined>, location?: string): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  if (location !== undefined) {
    if (location !== (params.location ?? params.loc)) {
      for (const key of [...query.keys()]) if (key.startsWith("cursor")) query.delete(key);
    }
    query.set("location", location);
    query.delete("loc");
  }
  return `${path}${query.size ? `?${query}` : ""}`;
}
