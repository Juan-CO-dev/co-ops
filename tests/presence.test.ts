import { describe, expect, it } from "vitest";
import { coopsEvidence, personPresence, PRESENCE_PRECEDENCE, resolvePresence, toastEvidence, type CoopsDayFacts } from "@/lib/presence-shared";

const none: CoopsDayFacts = { stationAt: null, taskAt: null, signedInAt: null, endedAt: null, shopClosedAt: null };

describe("presence: who is on shift today", () => {
  it("an open Toast entry = on shift, clocked in at its in time (latest open entry wins)", () => {
    expect(personPresence({ entries: [{ inAt: "2026-10-08T13:58:00Z", outAt: null }] }, none))
      .toEqual({ onShift: true, source: "toast_clock", since: "2026-10-08T13:58:00Z" });
    expect(toastEvidence({ entries: [{ inAt: "2026-10-08T12:00:00Z", outAt: "2026-10-08T15:00:00Z" }, { inAt: "2026-10-08T16:00:00Z", outAt: null }] }))
      .toMatchObject({ onShift: true, since: "2026-10-08T16:00:00Z" });
  });
  it("Toast decides alone when it has an entry: clocked out beats CO-OPS activity", () => {
    const p = personPresence({ entries: [{ inAt: "2026-10-08T12:00:00Z", outAt: "2026-10-08T18:00:00Z" }] },
      { ...none, stationAt: "2026-10-08T19:00:00Z", signedInAt: "2026-10-08T19:00:00Z" });
    expect(p).toEqual({ onShift: false, source: "toast_clock", since: null, off: { reason: "clocked_out", at: "2026-10-08T18:00:00Z" } });
  });
  it("no Toast entry: holding a station, holding a task, or signing in = active in CO-OPS (newest wins)", () => {
    expect(personPresence({ entries: [] }, { ...none, stationAt: "2026-10-08T14:00:00Z" })).toEqual({ onShift: true, source: "coops_activity", since: "2026-10-08T14:00:00Z", activity: "station" });
    expect(personPresence({ entries: [] }, { ...none, taskAt: "2026-10-08T15:00:00Z", signedInAt: "2026-10-08T13:00:00Z" })).toMatchObject({ onShift: true, activity: "task" });
    expect(personPresence({ entries: [] }, { ...none, signedInAt: "2026-10-08T13:00:00Z" })).toMatchObject({ onShift: true, activity: "signed_in" });
  });
  it("no evidence at all = not on shift, no source, no off reason", () => {
    expect(personPresence({ entries: [] }, none)).toEqual({ onShift: false, source: null, since: null });
  });
  it("End my shift ends CO-OPS presence until NEW activity (a new sign-in or claim)", () => {
    const ended = { ...none, signedInAt: "2026-10-08T13:00:00Z", endedAt: "2026-10-08T20:00:00Z" };
    expect(personPresence({ entries: [] }, ended)).toEqual({ onShift: false, source: "coops_activity", since: null, off: { reason: "ended_shift", at: "2026-10-08T20:00:00Z" } });
    expect(personPresence({ entries: [] }, { ...ended, stationAt: "2026-10-08T20:30:00Z" })).toMatchObject({ onShift: true, activity: "station" });
    expect(personPresence({ entries: [] }, { ...ended, signedInAt: "2026-10-08T21:00:00Z" })).toMatchObject({ onShift: true, activity: "signed_in" });
  });
  it("the shop's close ends CO-OPS presence too; the later of end and close names the reason", () => {
    const closed = { ...none, signedInAt: "2026-10-08T13:00:00Z", shopClosedAt: "2026-10-09T02:00:00Z" };
    expect(personPresence({ entries: [] }, closed).off).toEqual({ reason: "shop_closed", at: "2026-10-09T02:00:00Z" });
    expect(personPresence({ entries: [] }, { ...closed, endedAt: "2026-10-09T02:30:00Z" }).off).toEqual({ reason: "ended_shift", at: "2026-10-09T02:30:00Z" });
    expect(coopsEvidence({ ...closed, taskAt: "2026-10-09T01:00:00Z" })).toMatchObject({ onShift: false });
  });
  it("the resolver's seam: precedence is explicit and a clock beats an inference", () => {
    expect(PRESENCE_PRECEDENCE).toEqual(["toast_clock", "coops_activity"]);
    expect(resolvePresence([{ source: "coops_activity", onShift: true, since: "a", activity: "signed_in" }, { source: "toast_clock", onShift: true, since: "b" }], {}))
      .toEqual({ onShift: true, source: "toast_clock", since: "b" });
  });
});
