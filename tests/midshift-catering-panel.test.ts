/**
 * Unit spine — the mid-shift catering panel v2 pure core (lib/midshift-shared.ts):
 * the tomorrow summary, the stage chip's token roles, and the time-window DISPLAY
 * helper that hides prod's three heterogeneous `catering_pipeline.time_window`
 * shapes (Toast "13:15" · ezCater raw ISO · portal "11:30 AM–12:00 PM") behind one
 * manager-readable label.
 */
import { describe, it, expect } from "vitest";
import { stageChip, timeWindowLabel, tomorrowSummary } from "@/lib/midshift-shared";

describe("timeWindowLabel", () => {
  it("renders an ezCater raw ISO instant as its ET clock time", () => {
    // 2026-09-08T15:30:00Z = 11:30 AM EDT.
    expect(timeWindowLabel("2026-09-08T15:30:00Z", "en")).toBe("11:30 AM");
  });
  it("renders a Toast 24-hour clock string as a 12-hour label, with no Date math", () => {
    expect(timeWindowLabel("13:15", "en")).toBe("1:15 PM");
    expect(timeWindowLabel("00:30", "en")).toBe("12:30 AM");
    expect(timeWindowLabel("12:05", "en")).toBe("12:05 PM");
    expect(timeWindowLabel("09:00", "en")).toBe("9:00 AM");
    expect(timeWindowLabel("13:15", "es")).toBe("1:15 p. m.");
  });
  it("passes any other free text through verbatim, and null through as null", () => {
    expect(timeWindowLabel("11:30 AM–12:00 PM", "en")).toBe("11:30 AM–12:00 PM");
    expect(timeWindowLabel("tbd", "en")).toBe("tbd");
    // ISO-SHAPED but not a real instant: render the raw text, never the string "Invalid Date".
    expect(timeWindowLabel("2026-13-45T99:00:00Z", "en")).toBe("2026-13-45T99:00:00Z");
    expect(timeWindowLabel(null, "en")).toBeNull();
  });
});

describe("tomorrowSummary", () => {
  it("picks the earliest parseable window and counts everything", () => {
    expect(tomorrowSummary([])).toEqual({ count: 0, firstWindow: null });
    expect(tomorrowSummary(["1:00–1:30 PM", "11:30 AM–12:00 PM", null])).toEqual({
      count: 3,
      firstWindow: "11:30 AM–12:00 PM",
    });
    expect(tomorrowSummary([null, "tbd"])).toEqual({ count: 2, firstWindow: null });
  });
  it("counts an unparseable window — a booked event is booked whatever its time reads", () => {
    expect(tomorrowSummary(["tbd", "13:15"])).toEqual({ count: 2, firstWindow: "13:15" });
  });
});

describe("stageChip", () => {
  it("maps the two live stages to token roles", () => {
    expect(stageChip("confirmed")).toEqual({
      className: "bg-co-gold/20 text-co-gold-text",
      labelKey: "catering.pipeline.stage.confirmed",
    });
    expect(stageChip("out")).toEqual({
      className: "bg-co-text text-co-bg",
      labelKey: "catering.pipeline.stage.out",
    });
  });
});
