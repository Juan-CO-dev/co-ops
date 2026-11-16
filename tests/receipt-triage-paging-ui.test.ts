/**
 * Audit W20/B195 (screen side): the triage list shows the queue's TOTAL, says how much of it is
 * on screen, and offers the older receipts, in both languages. The route takes ?offset=.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u", role: "key_holder" }, locations: ["shop"] })) }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceiptForActor: vi.fn() }));
vi.mock("@/lib/email-receipts", () => {
  class EmailReceiptError extends Error { constructor(public status: number, public code: string) { super(code); } }
  return { EmailReceiptError, RECEIPT_MIN: 4, RECEIPT_OVERRIDE_MIN: 6, listUnlinkedReceipts: mocks.list,
    moveConflictedReceipt: vi.fn(), uploadManualReceipt: vi.fn(), linkReceipt: vi.fn(), attestMatch: vi.fn(), overrideMatch: vi.fn(),
    unlinkReceipt: vi.fn(), attachReceiptToPo: vi.fn(), loadPoCandidatesForReceipt: vi.fn() };
});

import { GET } from "@/app/api/operations/receiving/email-receipts/route";

const panel = readFileSync("components/receiving/VendorClaimPanel.tsx", "utf8").replace(/\r\n/g, "\n");
const get = (query: string) => GET(new NextRequest(`https://co-ops.test/api/operations/receiving/email-receipts?${query}`));

beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ receipts: [{ id: "r1" }], total: 250, hasMore: true, flagged: 3 }); });

describe("GET ?locationId&offset", () => {
  it("returns the page with the queue's numbers; no offset means the first page", async () => {
    const res = await get("locationId=shop");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ receipts: [{ id: "r1" }], total: 250, hasMore: true, flagged: 3 });
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), "shop", { offset: 0 });
  });
  it("passes a whole-number offset through", async () => {
    await get("locationId=shop&offset=200");
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), "shop", { offset: 200 });
  });
  it.each(["-1", "1.5", "abc", "", "1e3", "9999999999"])("refuses offset=%s before reading anything", async offset => {
    const res = await get(`locationId=shop&offset=${encodeURIComponent(offset)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload" });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("the triage list on the delivery page", () => {
  it("counts the whole queue in its header and its flag pill", () => {
    expect(panel).toContain('count={t("receiving.claim.link_existing_count", { n: queueTotal })}');
    expect(panel).toContain('t("receiving.claim.attribution_conflict_count", { n: flaggedCount })');
    expect(panel).not.toContain("n: unlinked?.length ?? 0");
  });
  it("offers the older receipts through a 44 px centred control and asks the route for the next offset", () => {
    expect(panel).toContain('t("receiving.claim.link_existing_older")');
    expect(panel).toContain('t("receiving.claim.link_existing_showing", { n: shown.length, total: queueTotal })');
    const button = panel.slice(panel.indexOf("onClick={() => void showOlder()}") - 200, panel.indexOf("onClick={() => void showOlder()}") + 300);
    expect(button).toContain("min-h-[44px]");
    expect(button).toContain("items-center");
    expect(panel).toContain("`${API}?locationId=${encodeURIComponent(locationId)}&offset=${offset}`");
  });
  it("is worded in English and Spanish", () => {
    for (const key of ["receiving.claim.link_existing_showing", "receiving.claim.link_existing_older", "receiving.claim.link_existing_older_busy"]) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((es as Record<string, string>)[key], key).toBeTruthy();
    }
    expect((es as Record<string, string>)["receiving.claim.link_existing_showing"]).toContain("{total}");
    expect((es as Record<string, string>)["receiving.claim.link_existing_older"]).not.toBe((en as Record<string, string>)["receiving.claim.link_existing_older"]);
  });
});
