/**
 * Needs attention — one ranked list. The order IS the product (spec: uncovered station, station due
 * to close/trim, late task, missed checklist, fridge, item low, catering not rung, upcoming catering
 * not prepped, unlinked clock-in). Crew see only rows about themselves plus shop-wide reminders.
 */
import { describe, expect, it } from "vitest";
import { ATTENTION_ORDER, attentionScore, crewAttention, rankAttention, severityOf } from "@/lib/pulse/attention-shared";
import type { AttentionRow } from "@/lib/pulse/types";

const row = (kind: AttentionRow["kind"], over: Partial<AttentionRow> = {}): AttentionRow => ({
  key: `${kind}:${over.key ?? "x"}`, kind, severity: severityOf(kind), params: {}, href: "/x", action: "open", ...over,
});

describe("rankAttention", () => {
  it("orders by the spec's kind order, then by key for stability", () => {
    const shuffled = [row("clockin_unlinked"), row("fridge_out_of_range"), row("station_uncovered", { key: "b" }), row("task_late"), row("station_uncovered", { key: "a" }), row("catering_not_rung")];
    expect(rankAttention(shuffled).map((r) => r.key)).toEqual([
      "station_uncovered:a", "station_uncovered:b", "task_late:x", "fridge_out_of_range:x", "catering_not_rung:x", "clockin_unlinked:x",
    ]);
    expect(ATTENTION_ORDER[0]).toBe("station_uncovered");
    expect(ATTENTION_ORDER.at(-1)).toBe("clockin_unlinked");
  });
  it("dedupes by key (two sources reporting the same subject collapse to one row)", () => {
    expect(rankAttention([row("task_late", { key: "same" }), row("task_late", { key: "same" })])).toHaveLength(1);
  });
});

describe("severity + score", () => {
  it("red = act now (uncovered, trim/close due, late task, missed checklist, fridge excursion, not rung); yellow = the rest", () => {
    expect(severityOf("station_uncovered")).toBe("red");
    expect(severityOf("checklist_missed")).toBe("red");
    expect(severityOf("fridge_out_of_range")).toBe("red");
    expect(severityOf("catering_not_rung")).toBe("red");
    expect(severityOf("station_closing_soon")).toBe("yellow");
    expect(severityOf("fridge_unchecked")).toBe("yellow");
    expect(severityOf("item_low")).toBe("yellow");
    expect(severityOf("clockin_unlinked")).toBe("yellow");
  });
  it("score mirrors v1's pulseScore: green empty, red when any red row, else yellow", () => {
    expect(attentionScore([])).toBe("green");
    expect(attentionScore([row("item_low")])).toBe("yellow");
    expect(attentionScore([row("item_low"), row("task_late")])).toBe("red");
  });
});

describe("crewAttention", () => {
  it("keeps rows about the viewer and shop-wide reminders; drops everyone else's and anything with money", () => {
    const rows = [
      row("task_late", { key: "mine", subjectUserId: "me" }),
      row("task_late", { key: "theirs", subjectUserId: "them" }),
      row("fridge_unchecked", { key: "shop", shopWide: true }),
      row("station_closing_soon", { key: "my-station", subjectUserId: "me" }),
      row("catering_not_rung", { key: "money", params: { total: "$120.00" } }),
      row("clockin_unlinked", { key: "names", params: { names: "Pat" } }),
    ];
    expect(crewAttention(rows, "me").map((r) => r.key)).toEqual(["task_late:mine", "fridge_unchecked:shop", "station_closing_soon:my-station"]);
  });
});
