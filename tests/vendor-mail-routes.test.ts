import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { session, list, detail, sign } = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), detail: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: session }));
vi.mock("@/lib/vendor-mail", () => ({ listVendorMail: list, getVendorMailMessage: detail, VendorMailError: class extends Error { constructor(public status: number, public code: string) { super(code); } } }));
vi.mock("@/lib/vendor-mail-assets", () => ({ signVendorMailAsset: sign }));
import { GET as listGet } from "@/app/api/operations/vendor-mail/route";
import { GET as detailGet } from "@/app/api/operations/vendor-mail/[id]/route";
import { GET as assetGet } from "@/app/api/operations/vendor-mail/[id]/attachments/[assetId]/route";
import { VendorMailError } from "@/lib/vendor-mail";
const ctx = { user: { id: "actor" } };
const request = (query = "") => new NextRequest(`https://co.test/api/operations/vendor-mail${query}`);
beforeEach(() => { vi.clearAllMocks(); session.mockResolvedValue(ctx); list.mockResolvedValue({ messages: [] }); detail.mockResolvedValue({ id: "message" }); sign.mockResolvedValue({ signed_url: "private" }); });
it("requires a session on all three GET routes before loading", async () => {
  session.mockResolvedValue(new Response(null, { status: 401 }));
  expect((await listGet(request())).status).toBe(401);
  expect((await detailGet(request(), { params: Promise.resolve({ id: "message" }) })).status).toBe(401);
  expect((await assetGet(request(), { params: Promise.resolve({ id: "message", assetId: "raw" }) })).status).toBe(401);
  expect(list).not.toHaveBeenCalled(); expect(detail).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
});
it("passes filter and bound asset IDs, never a browser storage path", async () => {
  expect((await listGet(request("?location=shop&status=handled&search=invoice&stale=true"))).status).toBe(200);
  expect(list).toHaveBeenCalledWith(ctx, expect.objectContaining({ locationId: "shop", status: "handled", search: "invoice", stale: true }));
  await detailGet(request(), { params: Promise.resolve({ id: "message" }) });
  expect(detail).toHaveBeenCalledWith(ctx, "message");
  await assetGet(request("?path=attacker"), { params: Promise.resolve({ id: "message", assetId: "raw" }) });
  expect(sign).toHaveBeenCalledWith(ctx, "message", "raw");
});
it("maps named failures and refuses ambiguous stale filters", async () => {
  list.mockRejectedValue(new VendorMailError(403, "forbidden"));
  expect((await listGet(request())).status).toBe(403);
  expect((await listGet(request("?stale=garbage"))).status).toBe(400);
  detail.mockRejectedValue(new VendorMailError(404, "not_found"));
  expect((await detailGet(request(), { params: Promise.resolve({ id: "message" }) })).status).toBe(404);
  sign.mockRejectedValue(new VendorMailError(503, "asset_unavailable"));
  expect((await assetGet(request(), { params: Promise.resolve({ id: "message", assetId: "raw" }) })).status).toBe(503);
});
