import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), detail: vi.fn(), handle: vi.fn(), reassign: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/catering/inbox", () => ({
  CateringInboxError: class extends Error { constructor(public status: number, public code: string) { super(code); } },
  listCateringInbox: mocks.list, getCateringInboxMessage: mocks.detail,
  handleCateringInbox: mocks.handle, reassignCateringInbox: mocks.reassign,
}));
import { CateringInboxError } from "@/lib/catering/inbox";
import { GET as list } from "@/app/api/catering/inbox/route";
import { GET as detail } from "@/app/api/catering/inbox/[id]/route";
import { POST as handle } from "@/app/api/catering/inbox/[id]/handle/route";
import { POST as reassign } from "@/app/api/catering/inbox/[id]/reassign/route";

const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ id }) };
const ctx = { user: { id: "reader" }, session: { id: "session", step_up_unlocked: false } };
function request(method = "GET", body?: unknown, origin: string | null = "https://tenant.example", suffix = "") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new NextRequest(`https://tenant.example/api/catering/inbox${suffix}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const valid = { expectedRevision: 2, requestId };
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue(ctx);
  mocks.list.mockResolvedValue({ messages: [], mode: "shadow", assignees: [] });
  mocks.detail.mockResolvedValue({ id });
  mocks.handle.mockResolvedValue({ message_id: id, revision: 3 });
  mocks.reassign.mockResolvedValue({ message_id: id, revision: 3 });
});
describe("catering inbox route contracts", () => {
  it("GET list forwards the assignee and returns the library DTO", async () => {
    const response = await list(request("GET", undefined, null, `?assignee=${id}`));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(ctx, id);
    expect(await response.json()).toMatchObject({ inbox: { mode: "shadow" } });
  });
  it("GET detail resolves asynchronous route params", async () => {
    const response = await detail(request(), params);
    expect(response.status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith(ctx, id);
    expect(await response.json()).toEqual({ message: { id } });
  });
  it.each(["list", "detail", "handle", "reassign"] as const)("%s returns the auth refusal before reaching the library", async route => {
    const refusal = new Response("unauthorized", { status: 401 }); mocks.session.mockResolvedValue(refusal);
    const response = route === "list" ? await list(request()) : route === "detail" ? await detail(request(), params)
      : route === "handle" ? await handle(request("POST", valid), params) : await reassign(request("POST", { ...valid, assignedTo: null }), params);
    expect(response).toBe(refusal);
    expect(mocks[route]).not.toHaveBeenCalled();
  });
  it.each(["list", "detail", "handle", "reassign"] as const)("%s preserves typed library authorization/error status", async route => {
    mocks[route].mockRejectedValue(new CateringInboxError(403, "forbidden"));
    const response = route === "list" ? await list(request()) : route === "detail" ? await detail(request(), params)
      : route === "handle" ? await handle(request("POST", valid), params) : await reassign(request("POST", { ...valid, assignedTo: null }), params);
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "forbidden" });
  });
  it.each(["handle", "reassign"] as const)("%s requires same origin before even reading the session", async action => {
    for (const origin of [null, "https://attacker.example"]) {
      const response = await (action === "handle" ? handle : reassign)(request("POST", { ...valid, assignedTo: null }, origin), params);
      expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: "bad_origin" });
    }
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks[action]).not.toHaveBeenCalled();
  });
  it("handle forwards revision/request id with no step-up grant", async () => {
    const response = await handle(request("POST", valid), params);
    expect(response.status).toBe(200); expect(mocks.handle).toHaveBeenCalledWith(ctx, id, valid);
    expect(mocks.session).toHaveBeenCalledWith(expect.anything(), "/api/catering/inbox");
  });
  it("reassign forwards explicit null to clear assignment", async () => {
    const response = await reassign(request("POST", { ...valid, assignedTo: null }), params);
    expect(response.status).toBe(200); expect(mocks.reassign).toHaveBeenCalledWith(ctx, id, { ...valid, assignedTo: null });
  });
  it.each([null, [], {}, { expectedRevision: "2", requestId }, { expectedRevision: 2, requestId: 123 }])("both mutations refuse malformed payload %j", async body => {
    for (const route of [handle, reassign]) expect((await route(request("POST", body), params)).status).toBe(400);
    expect(mocks.handle).not.toHaveBeenCalled(); expect(mocks.reassign).not.toHaveBeenCalled();
  });
  it("handle refuses an assignment and reassign requires one", async () => {
    expect((await handle(request("POST", { ...valid, assignedTo: id }), params)).status).toBe(400);
    expect((await reassign(request("POST", valid), params)).status).toBe(400);
    expect((await reassign(request("POST", { ...valid, assignedTo: 42 }), params)).status).toBe(400);
  });
  it("invalid JSON is refused without a mutation", async () => {
    for (const route of [handle, reassign]) {
      const req = new NextRequest("https://tenant.example/api/catering/inbox", { method: "POST", headers: { origin: "https://tenant.example" }, body: "{" });
      expect((await route(req, params)).status).toBe(400);
    }
    expect(mocks.handle).not.toHaveBeenCalled(); expect(mocks.reassign).not.toHaveBeenCalled();
  });
  it("neither mutation route imports or invokes a step-up mechanism", () => {
    for (const action of ["handle", "reassign"]) {
      const source = readFileSync(`app/api/catering/inbox/[id]/${action}/route.ts`, "utf8");
      expect(source).not.toMatch(/step-up|assertStepUp|consumeGrant|stepUp/);
    }
  });
});
