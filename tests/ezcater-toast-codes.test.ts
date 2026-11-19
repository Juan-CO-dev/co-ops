import { afterEach, expect, it, vi } from "vitest";
import { toastGet } from "@/lib/toast/client";
import { loadKnownToastOrderCodes, toastCodeSelectionKey } from "@/lib/ezcater/toast-codes";

vi.mock("@/lib/toast/client", () => ({ toastGet: vi.fn(), ToastApiError: class extends Error {} }));
afterEach(() => vi.clearAllMocks());
const order = (note: string) => ({ guid: "order", checks: [{ guid: "check", selections: [
  { guid: "selection", item: { guid: "item" }, modifiers: [{ guid: "note", selectionType: "SPECIAL_REQUEST", displayName: note }] },
] }] });

it("returns only known code matches and never note text or unknown identifiers", async () => {
  vi.mocked(toastGet).mockResolvedValue([order("PRIVATE AB-1234 phone 202-555-0199 UNKNOWN99 123-456")]);
  const matched = await loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AB1234", "123456"]);
  expect([...matched]).toEqual([[toastCodeSelectionKey("order", "check", "selection"), ["AB1234", "123456"]]]);
  expect(JSON.stringify([...matched])).not.toMatch(/PRIVATE|555|UNKNOWN/);
});

it("does not partially match codes or inspect deleted orders", async () => {
  vi.mocked(toastGet).mockResolvedValue([order("PREFIXAB1234 AB1234SUFFIX"), { ...order("AB-1234"), deleted: true }]);
  expect((await loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AB1234"])).size).toBe(0);
});

it("skips voided notes and attributes a nested note to its closest item selection", async () => {
  vi.mocked(toastGet).mockResolvedValue([{ guid: "order", checks: [{ guid: "check", selections: [
    { guid: "outer", item: { guid: "parent" }, modifiers: [
      { guid: "void", selectionType: "SPECIAL_REQUEST", displayName: "AA1111", voided: true },
      { guid: "inner", item: { guid: "child" }, modifiers: [{ guid: "note", selectionType: "SPECIAL_REQUEST", displayName: "BB2222" }] },
    ] },
  ] }] }]);
  expect([...(await loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AA1111", "BB2222"]))])
    .toEqual([[toastCodeSelectionKey("order", "check", "inner"), ["BB2222"]]]);
});

it("does no provider request without known orders and honors an aborted deadline", async () => {
  expect((await loadKnownToastOrderCodes("restaurant", "2026-10-08", [])).size).toBe(0);
  expect(toastGet).not.toHaveBeenCalled();
  const parent = new AbortController();
  parent.abort();
  await expect(loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AA1111"], { signal: parent.signal }))
    .rejects.toThrow("capture_deadline");
  expect(toastGet).not.toHaveBeenCalled();
});

it("fences transient notes to the exact captured version and permitted order GUIDs", async () => {
  vi.mocked(toastGet).mockResolvedValue([
    { ...order("AA1111"), guid: "matching", modifiedDate: "2026-10-08T09:00:00-0400" },
    { ...order("AA1111"), guid: "changed", modifiedDate: "2026-10-08T14:00:00Z" },
    { ...order("AA1111"), guid: "outside-catering", modifiedDate: "2026-10-08T13:00:00Z" },
    { ...order("AA1111"), guid: "missing", modifiedDate: null },
    { ...order("AA1111"), guid: "null-expected", modifiedDate: "2026-10-08T13:00:00Z" },
    { ...order("AA1111"), guid: "unqualified-time", modifiedDate: "2026-10-08T13:00:00" },
  ]);
  const expectedVersions = new Map<string, string | null>([
    ["matching", "2026-10-08T13:00:00.000Z"], ["changed", "2026-10-08T13:00:00Z"],
    ["missing", null], ["null-expected", null], ["unqualified-time", "2026-10-08T13:00:00Z"],
  ]);
  const result = await loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AA1111"], { expectedVersions });
  expect([...result]).toEqual([[toastCodeSelectionKey("matching", "check", "selection"), ["AA1111"]]]);
});

it("does no provider read when the captured catering order scope is empty", async () => {
  const result = await loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AA1111"], { expectedVersions: new Map() });
  expect(result.size).toBe(0);
  expect(toastGet).not.toHaveBeenCalled();
});

// Item 21 PR 4 (review PORTAL4-r1): the lookup reports which orders it actually READ, so its caller can record coverage.
it("reports as examined only live orders read at exactly the captured version, with or without a match", async () => {
  const at = (guid: string, modifiedDate: string, extra: Record<string, unknown> = {}) => ({ ...order("no code here"), guid, modifiedDate, ...extra });
  vi.mocked(toastGet).mockResolvedValue([
    at("same", "2026-10-08T12:00:00.000+0000"), at("moved", "2026-10-08T12:30:00.000+0000"), at("gone", "2026-10-08T12:00:00.000+0000", { voided: true }),
    at("unlisted", "2026-10-08T12:00:00.000+0000"), { ...order("AB-1234"), guid: "hit", modifiedDate: "2026-10-08T12:00:00.000+0000" },
  ]);
  const examined = new Set<string>();
  const matched = await loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AB1234"], { examined,
    expectedVersions: new Map<string, string | null>([["same", "2026-10-08T12:00:00+00:00"], ["moved", "2026-10-08T12:00:00+00:00"],
      ["gone", "2026-10-08T12:00:00+00:00"], ["hit", "2026-10-08T12:00:00+00:00"], ["absent", "2026-10-08T12:00:00+00:00"], ["undated", null]]) });
  expect([...examined].sort()).toEqual(["hit", "same"]);
  expect([...matched.keys()]).toEqual([toastCodeSelectionKey("hit", "check", "selection")]);
});

it("a failed page throws, so a partial examined set is never trusted by a caller that awaits the result", async () => {
  vi.mocked(toastGet).mockResolvedValue({ not: "an array" });
  await expect(loadKnownToastOrderCodes("restaurant", "2026-10-08", ["AB1234"], { examined: new Set(), expectedVersions: new Map([["o", "2026-10-08T12:00:00Z"]]) }))
    .rejects.toThrow("ezcater_toast_bad_page");
});
