/**
 * SIM-25 — the fridge aggregate may NEVER claim "all in range" while any fridge
 * lacks a reading (design §2, safety-adjacent, LOUD by Juan's call).
 *
 * The shipped defect: components/midshift/FridgeStrip.tsx rendered
 * `flagCount === 0 ? "All fridges in range" : ...`, and flagCount counted only
 * out_of_range fridges (lib/midshift.ts:381). Eight fridges with zero readings
 * produced flagCount 0 → a green all-clear. Worse, PulseFridge.latestF is the
 * latest reading SINCE sinceDate (lib/maintenance.ts:155), not today's, so the
 * chip could print YESTERDAY's number beside that all-clear.
 *
 * The false-all-clear case below is a PERMANENT regression case.
 */
import { describe, it, expect } from "vitest";
import { composeFridgeAggregate, type FridgeFacts } from "@/lib/dashboard-status-shared";

const fridge = (over: Partial<FridgeFacts> & { equipId: string }): FridgeFacts => ({
  name: `Fridge ${over.equipId}`,
  latestF: null,
  outOfRange: false,
  hasReadingToday: false,
  ...over,
});

describe("composeFridgeAggregate", () => {
  it("REGRESSION (SIM-25): eight unread fridges is ALERT + 'no readings yet', never all-clear", () => {
    const fridges = ["1", "2", "3", "4", "5", "6", "7", "8"].map((equipId) => fridge({ equipId }));
    const vm = composeFridgeAggregate(fridges);
    expect(vm.state).toBe("alert");
    expect(vm.headline.key).toBe("midshift.fridges.none_read_other");
    expect(vm.headline.tone).toBe("danger");
    expect(vm.unreadCount).toBe(8);
    expect(vm.readCount).toBe(0);
  });

  it("REGRESSION (SIM-25): a stale yesterday reading does NOT count as read", () => {
    // latestF is populated (yesterday's 38F) but nobody temped it today.
    const vm = composeFridgeAggregate([fridge({ equipId: "1", latestF: 38, hasReadingToday: false })]);
    expect(vm.state).toBe("alert");
    expect(vm.readCount).toBe(0);
  });

  it("ONE unread fridge among read ones is still ALERT (rule b — no threshold)", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 38, hasReadingToday: true }),
      fridge({ equipId: "2", latestF: 37, hasReadingToday: true }),
      fridge({ equipId: "3" }),
    ]);
    expect(vm.state).toBe("alert");
    expect(vm.headline.key).toBe("midshift.fridges.some_unread");
    expect(vm.headline.params).toEqual({ unread: 1, total: 3 });
  });

  it("the in-range pill claims ONLY the fridges actually read (rule a)", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 38, hasReadingToday: true }),
      fridge({ equipId: "2", latestF: 37, hasReadingToday: true }),
      fridge({ equipId: "3" }),
    ]);
    const inRange = vm.pills.find((p) => p.key === "midshift.fridges.pill_in_range_of_read_other");
    expect(inRange?.params).toEqual({ count: 2 });
  });

  it("pluralizes on ONE — the in-range pill and the all-clear both read singular", () => {
    // One read + one unread: the in-range pill speaks for exactly one fridge.
    const partial = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 38, hasReadingToday: true }),
      fridge({ equipId: "2" }),
    ]);
    const inRange = partial.pills.find((p) => p.id === "in-range");
    expect(inRange?.key).toBe("midshift.fridges.pill_in_range_of_read_one");
    expect(inRange?.params).toBeUndefined();

    // A single unread fridge is still the zero-readings alert, in the singular.
    const noneRead = composeFridgeAggregate([fridge({ equipId: "1" })]);
    expect(noneRead.headline.key).toBe("midshift.fridges.none_read_one");
    expect(noneRead.headline.params).toBeUndefined();

    // A lone fridge, read and in range, is the ok state in the singular.
    const allRead = composeFridgeAggregate([fridge({ equipId: "1", latestF: 38, hasReadingToday: true })]);
    expect(allRead.state).toBe("ok");
    expect(allRead.headline.key).toBe("midshift.fridges.all_read_in_range_one");
    expect(allRead.headline.params).toBeUndefined();
  });

  it("an out-of-range excursion outranks unread for the headline, and unread stays a pill", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 48, hasReadingToday: true, outOfRange: true }),
      fridge({ equipId: "2" }),
    ]);
    expect(vm.state).toBe("alert");
    expect(vm.headline.key).toBe("midshift.fridges.flagged");
    expect(vm.headline.params).toEqual({ count: 1 });
    expect(vm.pills.some((p) => p.key === "midshift.fridges.pill_unread")).toBe(true);
  });

  it("all read and all in range is the ONLY ok state, and it names the count", () => {
    const vm = composeFridgeAggregate([
      fridge({ equipId: "1", latestF: 38, hasReadingToday: true }),
      fridge({ equipId: "2", latestF: 37, hasReadingToday: true }),
    ]);
    expect(vm.state).toBe("ok");
    expect(vm.headline.key).toBe("midshift.fridges.all_read_in_range_other");
    expect(vm.headline.params).toEqual({ count: 2 });
    expect(vm.unreadCount).toBe(0);
  });

  it("no fridges configured makes no claim either way", () => {
    const vm = composeFridgeAggregate([]);
    expect(vm.state).toBe("ok");
    expect(vm.headline.key).toBe("midshift.fridges.none_configured");
    expect(vm.pills).toEqual([]);
  });
});
