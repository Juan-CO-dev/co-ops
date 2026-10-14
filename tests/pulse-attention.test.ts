/**
 * Needs attention — one ranked list. The order IS the product. D-27 (Juan 2026-10-13): red items
 * first (missed checklist, late task, fridge out of range, catering not rung), stations after
 * (uncovered, trim due, closing soon), then the yellow advisories (fridge unchecked, item low,
 * upcoming catering not prepped, unlinked clock-in). Crew see only rows about themselves plus
 * shop-wide reminders.
 */
import { describe, expect, it } from "vitest";
import { ATTENTION_ORDER, attentionEvidence, attentionScore, crewAttention, rankAttention, severityOf, stripAttentionRows } from "@/lib/pulse/attention-shared";
import type { AttentionRow, AttentionRowScoped } from "@/lib/pulse/types";

const row = (kind: AttentionRow["kind"], over: Partial<AttentionRowScoped> = {}): AttentionRowScoped => ({
  kind, severity: severityOf(kind), params: {}, href: "/x", action: "open", ...over, key: `${kind}:${over.key ?? "x"}`,
});

describe("rankAttention", () => {
  it("orders by the kind order, then by key for stability", () => {
    const shuffled = [row("clockin_unlinked"), row("fridge_out_of_range"), row("station_uncovered", { key: "b" }), row("task_late"), row("station_uncovered", { key: "a" }), row("catering_not_rung")];
    expect(rankAttention(shuffled).map((r) => r.key)).toEqual([
      "task_late:x", "fridge_out_of_range:x", "catering_not_rung:x", "station_uncovered:a", "station_uncovered:b", "clockin_unlinked:x",
    ]);
    expect(ATTENTION_ORDER[0]).toBe("checklist_missed");
    expect(ATTENTION_ORDER.at(-1)).toBe("clockin_unlinked");
  });
  it("D-27: a missed checklist leads even behind eight uncovered stations (the card shows 8)", () => {
    const stations = Array.from({ length: 8 }, (_, i) => row("station_uncovered", { key: `s${i}` }));
    const ranked = rankAttention([...stations, row("fridge_unchecked"), row("checklist_missed", { key: "closing" })]);
    expect(ranked[0]!.key).toBe("checklist_missed:closing");
    expect(ranked.slice(0, 8).map((r) => r.kind)).toContain("checklist_missed");
  });
  it("D-27: every red non-station kind ranks above every station kind, and stations above yellow advisories", () => {
    const rank = (k: AttentionRow["kind"]) => ATTENTION_ORDER.indexOf(k);
    const stationKinds = ATTENTION_ORDER.filter((k) => k.startsWith("station_"));
    const redOther = ATTENTION_ORDER.filter((k) => !k.startsWith("station_") && severityOf(k) === "red");
    const yellowOther = ATTENTION_ORDER.filter((k) => !k.startsWith("station_") && severityOf(k) === "yellow");
    expect(Math.max(...redOther.map(rank))).toBeLessThan(Math.min(...stationKinds.map(rank)));
    expect(Math.max(...stationKinds.map(rank))).toBeLessThan(Math.min(...yellowOther.map(rank)));
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

describe("evidence (Astra #7) + stripping (Astra #4)", () => {
  it("an empty list is green only with complete evidence; partial/unavailable evidence yields null", () => {
    expect(attentionScore([], "complete")).toBe("green");
    expect(attentionScore([], "partial")).toBeNull();
    expect(attentionScore([], "unavailable")).toBeNull();
    expect(attentionScore([row("item_low")], "partial")).toBe("yellow");
    expect(attentionEvidence(7, 0)).toBe("complete");
    expect(attentionEvidence(7, 1)).toBe("partial");
    expect(attentionEvidence(7, 7)).toBe("unavailable");
  });
  it("stripAttentionRows removes subjectUserIds and shopWide and nothing else", () => {
    const [out] = stripAttentionRows([row("task_late", { subjectUserIds: ["me"], shopWide: true, params: { task: "am_prep" } })]);
    expect(out).toEqual({ key: "task_late:x", kind: "task_late", severity: "red", params: { task: "am_prep" }, href: "/x", action: "open" });
  });
});

describe("crewAttention", () => {
  it("keeps rows about the viewer and shop-wide reminders; drops everyone else's and anything with money", () => {
    const rows = [
      row("task_late", { key: "mine", subjectUserIds: ["me"] }),
      row("task_late", { key: "theirs", subjectUserIds: ["them"] }),
      row("fridge_unchecked", { key: "shop", shopWide: true }),
      row("station_closing_soon", { key: "my-station", subjectUserIds: ["them", "me"] }),
      row("catering_not_rung", { key: "money", params: { total: "$120.00" } }),
      row("clockin_unlinked", { key: "names", params: { names: "Pat" } }),
    ];
    expect(crewAttention(rows, "me").map((r) => r.key)).toEqual(["task_late:mine", "fridge_unchecked:shop", "station_closing_soon:my-station"]);
  });
});
