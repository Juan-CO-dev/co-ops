import { expect, it, vi } from "vitest";
import { isValidElement, Children } from "react";
const mocks = vi.hoisted(() => ({ candidates: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ level: 4, user: { language: "en" } }) }));
vi.mock("@/lib/receiving", () => ({ RECEIVE_MIN: 4, ReceivingError: class extends Error {}, loadDeliveryDetail: async () => ({ id: "d", locationId: "shop", lines: [] }) }));
vi.mock("@/lib/credits", () => ({ CreditError: class extends Error {}, loadCreditsForDelivery: async () => [] }));
vi.mock("@/lib/email-receipts", () => ({ EmailReceiptError: class extends Error {}, loadReceiptForDelivery: async () => null, listUnlinkedReceipts: async () => ({ receipts: [{ id: "triage" }], total: 140, hasMore: true, flagged: 2 }), loadReceivingReceiptCandidates: mocks.candidates }));
import Page from "@/app/(authed)/operations/receiving/[id]/page";
import { VendorClaimPanel } from "@/components/receiving/VendorClaimPanel";
it("failed advisory candidate read renders the receiving page with [] and preserves triage", async () => {
  mocks.candidates.mockRejectedValue(new Error("candidate read unavailable"));
  const page = await Page({ params: Promise.resolve({ id: "d" }) });
  const panel = Children.toArray(page.props.children).find(child => isValidElement(child) && child.type === VendorClaimPanel);
  expect(panel).toBeDefined();
  if (!isValidElement<{ invoiceCandidates: unknown[]; unlinked: unknown[]; unlinkedTotal: number; unlinkedHasMore: boolean; unlinkedFlagged: number }>(panel)) throw new Error("missing panel");
  expect(panel.props.invoiceCandidates).toEqual([]);
  expect(panel.props.unlinked).toEqual([{ id: "triage" }]);
  // W20/B195: the page hands the panel the first page plus the whole queue's numbers.
  expect(panel.props).toMatchObject({ unlinkedTotal: 140, unlinkedHasMore: true, unlinkedFlagged: 2 });
});
