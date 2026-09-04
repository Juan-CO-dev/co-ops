// ezCater lifecycle — pure decision table (lib/ezcater/lifecycle-shared.ts).
// Spec: catering-inbox design, Amendment A1.1. Juan (2026-09-04): capture from `submitted`
// and move the lead along automatically through every stage we can observe; confirmation
// stays human (the ezManage acceptance IS the human act); `lost` is terminal.
import { describe, expect, it } from "vitest";
import { EZCATER_ORDER_EVENT_KEYS, planEzcaterEvent } from "@/lib/ezcater/lifecycle-shared";

describe("EZCATER_ORDER_EVENT_KEYS", () => {
  it("is the live enum introspected 2026-09-03 (subscribe to all of them)", () => {
    expect([...EZCATER_ORDER_EVENT_KEYS].sort()).toEqual([
      "accepted", "cancelled", "failed", "modified", "rejected", "relish_finalized",
      "submitted", "succeeded", "succeeded_with_warnings", "uncancelled", "updated",
    ].sort());
  });
});

describe("planEzcaterEvent — no lead yet", () => {
  it("submitted creates at inquiry", () => {
    expect(planEzcaterEvent("submitted", null)).toEqual({ action: "create", stage: "inquiry" });
  });
  it("accepted without a lead (submitted missed) creates straight at confirmed", () => {
    expect(planEzcaterEvent("accepted", null)).toEqual({ action: "create", stage: "confirmed" });
  });
  it("modified/updated without a lead create at inquiry (the order exists, we just never saw it)", () => {
    expect(planEzcaterEvent("modified", null)).toEqual({ action: "create", stage: "inquiry" });
    expect(planEzcaterEvent("updated", null)).toEqual({ action: "create", stage: "inquiry" });
  });
  it("terminal or advisory events without a lead are unmatched (ledger only)", () => {
    for (const k of ["cancelled", "rejected", "failed", "uncancelled", "succeeded", "succeeded_with_warnings", "relish_finalized"]) {
      expect(planEzcaterEvent(k, null)).toEqual({ action: "unmatched" });
    }
  });
});

describe("planEzcaterEvent — lead exists", () => {
  it("accepted moves inquiry → confirmed; a repeat accepted is a duplicate", () => {
    expect(planEzcaterEvent("accepted", "inquiry")).toEqual({ action: "move", stage: "confirmed" });
    expect(planEzcaterEvent("accepted", "quote_sent")).toEqual({ action: "move", stage: "confirmed" });
    expect(planEzcaterEvent("accepted", "confirmed")).toEqual({ action: "duplicate" });
  });
  it("submitted on an existing lead is a duplicate delivery", () => {
    expect(planEzcaterEvent("submitted", "inquiry")).toEqual({ action: "duplicate" });
    expect(planEzcaterEvent("submitted", "confirmed")).toEqual({ action: "duplicate" });
  });
  it("modified/updated refresh in place, no stage change", () => {
    expect(planEzcaterEvent("modified", "inquiry")).toEqual({ action: "refresh" });
    expect(planEzcaterEvent("updated", "confirmed")).toEqual({ action: "refresh" });
  });
  it("cancelled/rejected/failed move to lost from any open stage", () => {
    for (const k of ["cancelled", "rejected", "failed"]) {
      expect(planEzcaterEvent(k, "inquiry")).toEqual({ action: "move", stage: "lost" });
      expect(planEzcaterEvent(k, "confirmed")).toEqual({ action: "move", stage: "lost" });
      expect(planEzcaterEvent(k, "out")).toEqual({ action: "move", stage: "lost" });
    }
  });
  it("a move the pipeline forbids is refused, not forced (lost and completed are terminal)", () => {
    expect(planEzcaterEvent("accepted", "lost")).toEqual({ action: "illegal_transition", stage: "confirmed" });
    expect(planEzcaterEvent("cancelled", "completed")).toEqual({ action: "illegal_transition", stage: "lost" });
    expect(planEzcaterEvent("cancelled", "lost")).toEqual({ action: "duplicate" });
  });
  it("uncancelled only notes — reopening is human (lost is terminal)", () => {
    expect(planEzcaterEvent("uncancelled", "lost")).toEqual({ action: "note" });
    expect(planEzcaterEvent("uncancelled", "confirmed")).toEqual({ action: "note" });
  });
  it("succeeded / succeeded_with_warnings / relish_finalized are advisory notes in v1", () => {
    for (const k of ["succeeded", "succeeded_with_warnings", "relish_finalized"]) {
      expect(planEzcaterEvent(k, "confirmed")).toEqual({ action: "note" });
    }
  });
  it("an unknown key is ignored", () => {
    expect(planEzcaterEvent("something_new", "inquiry")).toEqual({ action: "ignore" });
    expect(planEzcaterEvent("something_new", null)).toEqual({ action: "ignore" });
  });
});
