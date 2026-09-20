import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as stagePOST } from "@/app/api/admin/vendors/[id]/import/route";
import { GET } from "@/app/api/admin/vendors/[id]/import/[batchId]/route";
import { POST as applyPOST } from "@/app/api/admin/vendors/[id]/import/[batchId]/apply/route";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { stageVendorImport, loadImportBatch, applyVendorImport, VendorImportError } from "@/lib/vendor-import";
import type { RoleCode } from "@/lib/roles";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/portal/csrf", () => ({ assertSameOrigin: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn() }));
vi.mock("@/lib/vendor-import", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vendor-import")>("@/lib/vendor-import");
  return { ...actual, stageVendorImport: vi.fn(), loadImportBatch: vi.fn(), applyVendorImport: vi.fn() };
});

const vendor = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const batch = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const params = Promise.resolve({ id: vendor, batchId: batch });
const url = `https://example.com/api/admin/vendors/${vendor}/import`;
const payload = { decisions: { "1:price": "accept" }, expectedDigest: "a".repeat(64) };
const view: Awaited<ReturnType<typeof stageVendorImport>> = {
  batch: { id: batch, vendor_id: vendor, location_id: null, account_id: null, adapter: "pfg", adapter_version: "v1",
    source_name: "export.csv", source_sha256: "b".repeat(64), exported_at: null, row_count: 0,
    report: { counts: {}, reasons: {}, needs_person: [], before_state: {}, ignored_rows: 0 },
    status: "staged", created_by: "actor", created_at: "2026-09-20T00:00:00Z" },
  observations: [], decisions: {}, beforeState: {}, ops: [], expectedDigest: payload.expectedDigest,
};
function asActor(role: RoleCode) {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "actor", role }, session: {} } as Awaited<ReturnType<typeof requireSession>>);
}
function upload(value: File | string | null = new File(["supplier export"], "export.csv")) {
  const form = new FormData();
  if (value !== null) form.set("file", value);
  return new NextRequest(url, { method: "POST", headers: { origin: "https://example.com" }, body: form });
}
function apply(body: unknown = payload) {
  return new NextRequest(`${url}/${batch}/apply`, { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify(body) });
}
const routes = [
  { name: "stage", call: () => stagePOST(upload(), { params }), lib: stageVendorImport },
  { name: "load", call: () => GET(new NextRequest(`${url}/${batch}`, { headers: { origin: "https://example.com" } }), { params }), lib: loadImportBatch },
  { name: "apply", call: () => applyPOST(apply(), { params }), lib: applyVendorImport },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(assertSameOrigin).mockReturnValue(null);
  vi.mocked(assertStepUp).mockReturnValue({ ok: true });
  vi.mocked(stageVendorImport).mockResolvedValue(view as Awaited<ReturnType<typeof stageVendorImport>>);
  vi.mocked(loadImportBatch).mockResolvedValue(view as Awaited<ReturnType<typeof loadImportBatch>>);
  vi.mocked(applyVendorImport).mockResolvedValue({ batch_id: batch, plan_digest: payload.expectedDigest, ops: [], non_atomic: [] });
  asActor("owner");
});

describe("vendor import route gates", () => {
  it.each(routes)("$name rejects bad origin before session and library", async ({ call, lib }) => {
    vi.mocked(assertSameOrigin).mockReturnValue(Response.json({ error: "bad_origin" }, { status: 403 }) as ReturnType<typeof assertSameOrigin>);
    expect((await call()).status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
    expect(lib).not.toHaveBeenCalled();
  });
  it.each(routes)("$name preserves unauthenticated response", async ({ call, lib }) => {
    vi.mocked(requireSession).mockResolvedValue(NextResponse.json({ code: "unauthorized" }, { status: 401 }));
    expect((await call()).status).toBe(401);
    expect(lib).not.toHaveBeenCalled();
  });
  it.each(routes)("$name refuses level 6", async ({ call, lib }) => {
    asActor("agm");
    expect((await call()).status).toBe(403);
    expect(lib).not.toHaveBeenCalled();
  });
  it("stages for level 7 with vendor binding and file text", async () => {
    asActor("gm");
    const res = await stagePOST(upload(), { params });
    expect(await res.json()).toEqual(view);
    expect(stageVendorImport).toHaveBeenCalledWith(expect.anything(), vendor, { name: "export.csv", text: "supplier export" });
  });
  it("loads for level 7 without an Origin header and binds vendor and batch", async () => {
    asActor("gm");
    const res = await GET(new NextRequest(`${url}/${batch}`), { params });
    expect(await res.json()).toEqual(view);
    expect(loadImportBatch).toHaveBeenCalledWith(expect.anything(), vendor, batch);
  });
  it("rejects an origin-less cross-site GET before session", async () => {
    expect((await GET(new NextRequest(`${url}/${batch}`, { headers: { "sec-fetch-site": "cross-site" } }), { params })).status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
  });
  it.each(["gm", "moo"] as const)("refuses %s apply before step-up", async role => {
    asActor(role);
    const res = await applyPOST(apply(), { params });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(assertStepUp).not.toHaveBeenCalled();
    expect(applyVendorImport).not.toHaveBeenCalled();
  });
  it("requires Tier A step-up for level 9", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" });
    const res = await applyPOST(apply(), { params });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "step_up_required" });
    expect(assertStepUp).toHaveBeenCalledWith(expect.anything(), "A");
    expect(applyVendorImport).not.toHaveBeenCalled();
  });
  it("applies approved decisions for level 9 with vendor and batch binding", async () => {
    expect((await applyPOST(apply(), { params })).status).toBe(200);
    expect(applyVendorImport).toHaveBeenCalledWith(expect.anything(), vendor, batch, payload.decisions, payload.expectedDigest);
  });
});

describe("vendor import payloads and errors", () => {
  it.each([null, "text masquerading as file"])("rejects missing/non-File %s", async value => {
    expect((await stagePOST(upload(value), { params })).status).toBe(400);
    expect(stageVendorImport).not.toHaveBeenCalled();
  });
  it("rejects malformed multipart", async () => {
    expect((await stagePOST(new NextRequest(url, { method: "POST", body: "broken" }), { params })).status).toBe(400);
    expect(stageVendorImport).not.toHaveBeenCalled();
  });
  it("rejects 3 MB before library work", async () => {
    const res = await stagePOST(upload(new File([new Uint8Array(3 * 1024 * 1024)], "large.csv")), { params });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "too_large" });
    expect(stageVendorImport).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...payload, decisions: [] }, { ...payload, decisions: { x: "maybe" } }, { ...payload, expectedDigest: "bad" }])("rejects malformed apply payload %j", async body => {
    expect((await applyPOST(apply(body), { params })).status).toBe(400);
    expect(applyVendorImport).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await applyPOST(new NextRequest(url, { method: "POST", body: "{" }), { params })).status).toBe(400);
    expect(applyVendorImport).not.toHaveBeenCalled();
  });
  it.each(["plan_changed", "stale_before_state"])("preserves 409 %s", async code => {
    vi.mocked(applyVendorImport).mockRejectedValue(new VendorImportError(409, code));
    const res = await applyPOST(apply(), { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code });
  });
  it("maps staging adapter mismatch", async () => {
    vi.mocked(stageVendorImport).mockRejectedValue(new VendorImportError(400, "adapter_vendor_mismatch"));
    expect(await (await stagePOST(upload(), { params })).json()).toMatchObject({ code: "adapter_vendor_mismatch" });
  });
  it("maps a batch belonging to another vendor to 404", async () => {
    vi.mocked(loadImportBatch).mockRejectedValue(new VendorImportError(404, "batch_not_found"));
    const res = await GET(new NextRequest(url), { params });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "batch_not_found" });
  });
});
