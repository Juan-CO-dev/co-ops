/**
 * Mid-shift overdue model (council 2026-07-31 PR-2) — pins the decision table
 * incl. the two new states: due_now (the mid-day 14:00–15:30 window nudge) and
 * waiting_on_closing (names the closing-dependent neutral so am-prep/cash
 * never read as a silent "all good" pre-close). Juan's overdue LAW is
 * unchanged: am_prep/cash become overdue only once closing is done.
 */
import { describe, it, expect } from "vitest";
import { computeOverdue, EXPECTED_BY } from "@/lib/midshift-shared";

const base = { done: false, closingDone: false, midDayDoneCount: 0 };

describe("computeOverdue", () => {
  it("done is always ok, for every key", () => {
    for (const key of ["opening", "am_prep", "mid_day", "cash", "closing"] as const) {
      expect(computeOverdue({ ...base, key, done: true, minutesOfDay: 1439 })).toBe("ok");
    }
  });

  describe("opening (clock 10:30)", () => {
    it("ok at 10:30 sharp, overdue after", () => {
      expect(computeOverdue({ ...base, key: "opening", minutesOfDay: EXPECTED_BY.openingOverdueAfter })).toBe("ok");
      expect(computeOverdue({ ...base, key: "opening", minutesOfDay: EXPECTED_BY.openingOverdueAfter + 1 })).toBe("overdue");
    });
  });

  describe("mid_day (window 14:00–15:30)", () => {
    it("not_due_yet before 14:00", () => {
      expect(computeOverdue({ ...base, key: "mid_day", minutesOfDay: EXPECTED_BY.midDayDueFrom - 1 })).toBe("not_due_yet");
    });
    it("due_now inside the window (was a silent ok)", () => {
      expect(computeOverdue({ ...base, key: "mid_day", minutesOfDay: EXPECTED_BY.midDayDueFrom })).toBe("due_now");
      expect(computeOverdue({ ...base, key: "mid_day", minutesOfDay: EXPECTED_BY.midDayOverdueAfter })).toBe("due_now");
    });
    it("overdue after 15:30", () => {
      expect(computeOverdue({ ...base, key: "mid_day", minutesOfDay: EXPECTED_BY.midDayOverdueAfter + 1 })).toBe("overdue");
    });
    it("any done instance settles the whole row to ok", () => {
      expect(
        computeOverdue({ ...base, key: "mid_day", midDayDoneCount: 1, minutesOfDay: EXPECTED_BY.midDayOverdueAfter + 60 }),
      ).toBe("ok");
    });
  });

  describe("closing (clock 21:00)", () => {
    it("ok at 21:00 sharp, overdue after", () => {
      expect(computeOverdue({ ...base, key: "closing", minutesOfDay: EXPECTED_BY.closingOverdueAfter })).toBe("ok");
      expect(computeOverdue({ ...base, key: "closing", minutesOfDay: EXPECTED_BY.closingOverdueAfter + 1 })).toBe("overdue");
    });
  });

  describe("am_prep + cash (closing-dependent — Juan's law)", () => {
    it("waiting_on_closing (named neutral, NOT a silent ok) before closing is done", () => {
      expect(computeOverdue({ ...base, key: "am_prep", minutesOfDay: 18 * 60 })).toBe("waiting_on_closing");
      expect(computeOverdue({ ...base, key: "cash", minutesOfDay: 18 * 60 })).toBe("waiting_on_closing");
    });
    it("overdue once closing is done and they are not", () => {
      expect(computeOverdue({ ...base, key: "am_prep", closingDone: true, minutesOfDay: 21 * 60 })).toBe("overdue");
      expect(computeOverdue({ ...base, key: "cash", closingDone: true, minutesOfDay: 21 * 60 })).toBe("overdue");
    });
  });
});
