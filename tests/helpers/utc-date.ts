import { vi } from "vitest";

// Simulate Vercel's UTC parsing for zone-less date-times even on an ET Windows host.
// This makes tests of the former `new Date(ymd + "T00:00:00")` and Date.parse paths load-bearing.
export function stubUtcDateParsing(): void {
  const RuntimeDate = Date;
  const asUtc = (value: string): string =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) ? `${value}Z` : value;
  class UtcDate extends RuntimeDate {
    constructor(value?: string | number) {
      super(value === undefined ? RuntimeDate.now() : typeof value === "string" ? asUtc(value) : value);
    }
    static parse(value: string): number {
      return RuntimeDate.parse(asUtc(value));
    }
  }
  vi.stubGlobal("Date", UtcDate);
}
