import { expect, it, vi } from "vitest";
import { isValidElement, Children } from "react";
const mocks = vi.hoisted(() => ({ candidates: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ level: 4, user: { language: "en" } }) }));
vi.mock("@/lib/receiving", () => ({ RECEIVE_MIN: 4, ReceivingError: class extends Error {}, loadDeliveryDetail: async () => ({ id: "d", locationId: "shop", lines: [] }) }));
vi.mock("@/lib/credits", () => ({ CreditError: class extends Error {}, loadCreditsForDelivery: async () => [] }));
vi.mock("@/lib/email-receipts", () => ({ EmailReceiptError: class extends Error {}, loadReceiptForDelivery: async () => null, listUnlinkedReceipts: async () => [{ id: "triage" }], loadReceivingReceiptCandidates: mocks.candidates }));
import Page from "@/app/(authed)/operations/receiving/[id]/page";
import { VendorClaimPanel } from "@/components/receiving/VendorClaimPanel";
it("failed advisory candidate read renders the receiving page with [] and preserves triage", async () => {
  mocks.candidates.mockRejectedValue(new Error("candidate read unavailable"));
  const page = await Page({ params: Promise.resolve({ id: "d" }) });
  const panel = Children.toArray(page.props.children).find(child => isValidElement(child) && child.type === VendorClaimPanel);
  expect(panel).toBeDefined();
  if (!isValidElement<{ invoiceCandidates: unknown[]; unlinked: unknown[] }>(panel)) throw new Error("missing panel");
  expect(panel.props.invoiceCandidates).toEqual([]);
  expect(panel.props.unlinked).toEqual([{ id: "triage" }]);
});
