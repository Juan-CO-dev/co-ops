/**
 * Unit spine — lib/catering/toast-sales-shared.ts exclusion matcher (the
 * catering double-count rule). Pins kind semantics, case-insensitivity, and
 * location scoping.
 */
import { describe, it, expect } from "vitest";
import { matchesExclusion, type IngestExclusion, type ExclusionTarget } from "@/lib/catering/toast-sales-shared";

const LOC = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
function target(over: Partial<ExclusionTarget> = {}): ExclusionTarget {
  return { locationId: LOC, diningOption: "Take Out", menuGroup: "Subs", toastItemGuid: "tg-x", itemName: "Italian Sub", ...over };
}
function ex(kind: IngestExclusion["kind"], value: string, locationId: string | null = null): IngestExclusion {
  return { id: `${kind}:${value}`, locationId, kind, value, note: null };
}

describe("matchesExclusion", () => {
  it("dining_option matches case-insensitively", () => {
    expect(matchesExclusion(target({ diningOption: "Catering" }), [ex("dining_option", "catering")])).toBe(true);
    expect(matchesExclusion(target(), [ex("dining_option", "Catering")])).toBe(false);
    expect(matchesExclusion(target({ diningOption: null }), [ex("dining_option", "Catering")])).toBe(false);
  });
  it("menu_group and guid kinds match their fields only", () => {
    expect(matchesExclusion(target({ menuGroup: "Catering Menu" }), [ex("menu_group", "catering menu")])).toBe(true);
    expect(matchesExclusion(target(), [ex("toast_item_guid", "tg-x")])).toBe(true);
    expect(matchesExclusion(target(), [ex("toast_item_guid", "tg-y")])).toBe(false);
  });
  it("item_name_contains is a substring match", () => {
    expect(matchesExclusion(target({ itemName: "Catering Platter Large" }), [ex("item_name_contains", "platter")])).toBe(true);
  });
  it("location-scoped exclusions ignore other locations; global applies everywhere", () => {
    expect(matchesExclusion(target(), [ex("toast_item_guid", "tg-x", OTHER)])).toBe(false);
    expect(matchesExclusion(target(), [ex("toast_item_guid", "tg-x", LOC)])).toBe(true);
    expect(matchesExclusion(target(), [ex("toast_item_guid", "tg-x", null)])).toBe(true);
  });
});
