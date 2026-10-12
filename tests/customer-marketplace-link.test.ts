import { describe, expect, it, vi } from "vitest";
import { marketplaceLinkVerdict, type MarketplaceCandidate, type MarketplacePerson } from "@/lib/customers/marketplace-link-shared";
import { applyMarketplaceLinks, main, parseMarketplaceDecision, planMarketplaceLinks } from "../scripts/link-marketplace-guests";

const shop = "00000000-0000-0000-0000-000000000001";
const guestId = "00000000-0000-0000-0000-000000000002";
const directId = "00000000-0000-0000-0000-000000000003";
const guest: MarketplacePerson = { nameKey: "ana diaz", locationId: shop, items: ["Sub", "Chips"], dates: [] };
const direct: MarketplaceCandidate = { ...guest, customerId: directId };
const score = (g = guest, candidates = [direct]) => marketplaceLinkVerdict({ guest: g, candidates });
const decision = { guest_id: guestId, customer_id: directId, guest_name_key: "ana diaz", customer_name_key: "ana diaz", confidence: 0.9, reasons: ["same_name", "same_shop", "shared_items"] };

describe("marketplace advisory scorer", () => {
  it("scores full name plus items, name only, and initial plus items", () => {
    expect(score()).toMatchObject({ confidence: 0.9, reasons: ["same_name", "same_shop", "shared_items"] });
    expect(score({ ...guest, items: [] })?.confidence).toBe(0.8);
    expect(score({ ...guest, nameKey: "ana d" })).toMatchObject({ confidence: 0.7, reasons: ["same_initial", "same_shop", "shared_items"] });
    expect(score({ ...guest, nameKey: "ana d", items: [] })).toBeNull();
    // Initial-only names need two shared top items; one shared sub is not evidence at a sandwich shop.
    expect(score({ ...guest, nameKey: "ana d", items: ["Sub"] })).toBeNull();
    expect(score({ ...guest, items: ["Sub"] })?.confidence).toBe(0.9);
  });
  it("refuses ambiguity before item evidence", () => {
    expect(score({ ...guest, nameKey: "ana d" }, [direct, { ...direct, customerId: shop, nameKey: "ana doe", items: [] }])).toBeNull();
  });
  it("never links cross-shop, conflicting full surnames, initial first names, or one-token names", () => {
    expect(score(guest, [{ ...direct, locationId: "elsewhere" }])).toBeNull();
    expect(score(guest, [{ ...direct, nameKey: "ana doe" }])).toBeNull();
    expect(score({ ...guest, nameKey: "a diaz" }, [{ ...direct, nameKey: "a diaz" }])).toBeNull();
    expect(score({ ...guest, nameKey: "ana" })).toBeNull();
    expect(score(guest, [])).toBeNull();
  });
  it("uses only the candidate's first five items", () => {
    expect(score({ ...guest, nameKey: "ana d" }, [{ ...direct, items: ["a", "b", "c", "d", "Chips", "Sub"] }])).toBeNull();
  });
  it("matches SQL punctuation handling and preserves accented identity distinctions", () => {
    expect(score({ ...guest, nameKey: "  ANA   D. " })?.confidence).toBe(0.7);
    expect(score({ ...guest, nameKey: "ana día z" }, [{ ...direct, nameKey: "ana dia z" }])?.confidence).toBe(0.7);
    expect(score({ ...guest, nameKey: "josé diaz" }, [{ ...direct, nameKey: "jose diaz" }])).toBeNull();
    expect(score({ ...guest, nameKey: "ana o'neil" }, [{ ...direct, nameKey: "ana oneil" }])).toBeNull();
    expect(score(guest, [direct, { ...direct, customerId: shop, nameKey: "ana diaz." }])).toBeNull();
  });
});

describe("marketplace decision pipeline", () => {
  it("rejects extra fields, contact-shaped names, arbitrary reason text and invalid confidence", () => {
    expect(parseMarketplaceDecision(decision)).toEqual(decision);
    for (const invalid of [{ ...decision, email: "fixture@example.com" }, { ...decision, guest_name_key: "fixture@example.com" }, { ...decision, guest_name_key: "202 555 0123" }, { ...decision, reasons: ["free text"] }, { ...decision, confidence: 0.99 }]) {
      expect(() => parseMarketplaceDecision(invalid)).toThrow("Invalid marketplace link input");
    }
  });
  it("pages whole guest candidate sets and writes only whitelisted decision fields", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ guest_id: guestId, guest_name_key: "ana diaz", location_id: shop, guest_items: ["Sub"], guest_dates: [], candidates: [{ customer_id: directId, name_key: "ana diaz", items: ["Sub"], dates: [] }], email: "ignored@example.com" }], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await planMarketplaceLinks({ rpc }, shop)).toEqual([decision]);
    expect(rpc.mock.calls[1]?.[1]).toEqual({ p_location_id: shop, p_after: guestId, p_limit: 100 });
  });
  it("validates all decisions before mutations and never includes RPC error detail", async () => {
    const rpc = vi.fn();
    await expect(applyMarketplaceLinks({ rpc }, JSON.stringify(decision) + "\n" + JSON.stringify({ ...decision, phone: "2025550123" }))).rejects.toThrow("Invalid marketplace link input");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "private customer data" } });
    await expect(applyMarketplaceLinks({ rpc }, JSON.stringify(decision))).rejects.toThrow("Marketplace link apply refused");
  });
  it("applies via the reviewed RPC with no contact or name values", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await applyMarketplaceLinks({ rpc }, JSON.stringify(decision))).toBe(1);
    expect(rpc).toHaveBeenCalledWith("customer_probable_link_upsert", { p_guest_id: guestId, p_customer_id: directId, p_confidence: 0.9, p_reasons: decision.reasons, p_decided_by: "rule" });
  });
  it("accepts idempotent SQL replay and skips whole guests with unsafe candidate names", async () => {
    const replay = vi.fn().mockResolvedValue({ data: false, error: null });
    expect(await applyMarketplaceLinks({ rpc: replay }, JSON.stringify(decision))).toBe(1);
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ guest_id: guestId, guest_name_key: "ana diaz", location_id: shop, guest_items: ["Sub"], guest_dates: [], candidates: [
      { customer_id: directId, name_key: "ana diaz", items: ["Sub"], dates: [] },
      { customer_id: shop, name_key: "ana 2025550123", items: [], dates: [] },
    ] }], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await planMarketplaceLinks({ rpc }, shop)).toEqual([]);
    expect(rpc.mock.calls[1]?.[1].p_after).toBe(guestId);
    expect(parseMarketplaceDecision({ ...decision, guest_name_key: "josé d.", customer_name_key: "josé díaz" }).guest_name_key).toBe("josé d.");
  });
  it("refuses direct CLI execution while disabled before any client/file access", async () => {
    vi.stubEnv("CUSTOMER_PROFILES", "0");
    try { await expect(main(["plan"])).rejects.toThrow("CUSTOMER_PROFILES must be enabled"); } finally { vi.unstubAllEnvs(); }
  });
});
