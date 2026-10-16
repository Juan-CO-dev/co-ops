import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentPlan } from "@/lib/catering/payment-plan";
import { stubUtcDateParsing } from "./helpers/utc-date";

const DAYS = [
  ["2026-07-10", "2026-07-10T04:00:00.000Z"], // EDT
  ["2026-01-14", "2026-01-14T05:00:00.000Z"], // EST
] as const;

describe("staff quote deposit uses the ET event-day boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(DAYS)("%s across the seven-day boundary", (eventDate, startIso) => {
    const start = Date.parse(startIso);
    stubUtcDateParsing();
    const modeAt = (now: number) => paymentPlan({
      origin: "staff", eventDate, totalCents: 10_000, depositCents: 2_000, now,
    }).mode;
    expect(modeAt(start - 8 * 86_400_000)).toBe("deposit_optional");
    expect(modeAt(start - 8 * 86_400_000 + 1)).toBe("full_only");
    expect(modeAt(start - 7 * 86_400_000)).toBe("full_only");
  });
});
