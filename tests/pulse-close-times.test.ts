/**
 * Station close times SEAM. Today the facts are 0230's advisory `usually_closes_at` / `usually_trims_at`
 * plus the lifecycle closure; Astra's 0238 (`stations.trims` jsonb) is in review — when it merges, the
 * seam reads `trims` structurally and nothing else in the pulse changes.
 */
import { describe, expect, it } from "vitest";
import { closeTimeFacts, CLOSING_SOON_MINUTES, clockToMinutes } from "@/lib/pulse/close-times-shared";
import type { Station } from "@/lib/assignments-shared";

const station = (over: Partial<Station> & Record<string, unknown> = {}): Station => ({
  id: "s1", name: "Line", nameEs: "Línea", sort: 1, active: true, staffed: true, positions: [], closedAt: null, usuallyClosesAt: null, ...over,
});

describe("clockToMinutes", () => {
  it("parses HH:MM and HH:MM:SS; refuses junk", () => {
    expect(clockToMinutes("14:30")).toBe(870);
    expect(clockToMinutes("14:30:00")).toBe(870);
    expect(clockToMinutes("9:05")).toBe(545);
    expect(clockToMinutes(null)).toBeNull();
    expect(clockToMinutes("soon")).toBeNull();
    expect(clockToMinutes("25:00")).toBeNull();
  });
});

describe("closeTimeFacts", () => {
  it("a closed station is closed, whatever the clock says", () => {
    const f = closeTimeFacts(station({ closedAt: "2026-10-09T18:00:00Z", usuallyClosesAt: "14:00:00" }), 600);
    expect(f.closedAt).toBe("2026-10-09T18:00:00Z");
    expect(f.closingSoon).toBe(false);
    expect(f.closeDue).toBe(false);
  });
  it("closing soon inside the window, due once past it", () => {
    expect(CLOSING_SOON_MINUTES).toBe(60);
    const s = station({ usuallyClosesAt: "14:00:00" });
    expect(closeTimeFacts(s, 12 * 60).closingSoon).toBe(false);
    expect(closeTimeFacts(s, 13 * 60 + 1).closingSoon).toBe(true);
    expect(closeTimeFacts(s, 14 * 60).closeDue).toBe(true);
    expect(closeTimeFacts(s, 14 * 60).closingSoon).toBe(false);
    expect(closeTimeFacts(s, 13 * 60 + 1).closesAt).toBe("14:00");
  });
  it("no close time → nothing claimed (null, never a fake 'closes at')", () => {
    const f = closeTimeFacts(station(), 900);
    expect(f.closesAt).toBeNull();
    expect(f.closingSoon).toBe(false);
    expect(f.trimAt).toBeNull();
  });
  it("trims: 0238's `trims` jsonb wins when present and valid; the latest due trim applies", () => {
    const s = station({ trims: [{ at: "13:00", to_count: 2 }, { at: "15:00", to_count: 1 }] });
    expect(closeTimeFacts(s, 12 * 60).trimAt).toBe("13:00");
    expect(closeTimeFacts(s, 12 * 60).trimTo).toBe(2);
    expect(closeTimeFacts(s, 12 * 60).trimDue).toBe(false);
    expect(closeTimeFacts(s, 14 * 60).trimDue).toBe(true);
    expect(closeTimeFacts(s, 14 * 60).trimTo).toBe(2);
    expect(closeTimeFacts(s, 16 * 60).trimTo).toBe(1);
  });
  it("invalid trims are ignored and 0230's position usually_trims_at is the fallback", () => {
    const s = station({
      trims: [{ at: "nope", to_count: 2 }],
      positions: [
        { id: "p1", stationId: "s1", name: "1", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true },
        { id: "p2", stationId: "s1", name: "2", nameEs: null, duty: null, dutyEs: null, sort: 2, active: true, usuallyTrimsAt: "16:00:00" },
      ],
    });
    const f = closeTimeFacts(s, 15 * 60);
    expect(f.trimAt).toBe("16:00");
    expect(f.trimTo).toBe(1); // trimming the second position leaves one
    expect(f.trimDue).toBe(false);
    expect(closeTimeFacts(s, 16 * 60).trimDue).toBe(true);
  });
});
