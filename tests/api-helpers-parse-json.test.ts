import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseJsonBody } from "@/lib/api-helpers";

// W27 / B226: a JSON `null` body was returned as the payload, and ~100 routes cast it to a record and read a field —
// a TypeError, so a 500. It is now a 400 invalid_payload in the one helper.
const req = (body: string) => new NextRequest("https://x.test/api/thing", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("parseJsonBody", () => {
  it("a JSON null body is a 400 invalid_payload", async () => {
    const r = await parseJsonBody(req("null"));
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(400);
    expect(await (r as Response).json()).toMatchObject({ code: "invalid_payload" });
  });
  it("an array body passes through unchanged (the weights route takes one)", async () => {
    expect(await parseJsonBody(req("[1,2]"))).toEqual([1, 2]);
  });
  it("an object passes through; invalid JSON is still invalid_json", async () => {
    expect(await parseJsonBody(req('{"a":1}'))).toEqual({ a: 1 });
    const bad = await parseJsonBody(req("{"));
    expect(await (bad as Response).json()).toMatchObject({ code: "invalid_json" });
  });
});

vi.mock("@/lib/portal/csrf", () => ({ assertSameOrigin: () => null }));
vi.mock("@/lib/session", () => ({ requireSession: async () => ({ user: { id: "u", role: "employee" }, level: 3, locations: [] }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no db in this test"); } }));

describe("a route given a null body", () => {
  it("POST /api/cash with null answers 400, not a throw", async () => {
    const { POST } = await import("@/app/api/cash/route");
    const res = await POST(req("null"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload" });
  });
});
