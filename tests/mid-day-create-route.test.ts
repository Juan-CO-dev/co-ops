/**
 * W13/B178 — mid-day prep create: the day is the server's ET day (never the client's), and the
 * count + insert go through the 0314 atomic RPC (the old count-then-insert is only the fallback
 * while 0314 is not applied).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), create: vi.fn(), template: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: h.access, auditTaskOverride: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST } from "@/app/api/prep/mid-day/route";
import * as prep from "@/lib/prep";
import { audit } from "@/lib/audit";
import { etCalendarDate } from "@/lib/operational-day";

const SHOP = "11111111-1111-4111-8111-111111111111";
const TODAY = etCalendarDate(new Date().toISOString());
const shift = (days: number) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const req = (body: unknown) => new NextRequest("http://localhost/api/prep/mid-day", {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  h.session.mockResolvedValue({ user: { id: "kh" }, role: "key_holder", level: 4, locations: [SHOP] });
  h.access.mockResolvedValue(true);
});

describe("POST /api/prep/mid-day — the server's ET day", () => {
  it.each([["yesterday", -1], ["2030-01-01", null]] as const)("refuses a date that is not today in ET (%s)", async (_label, offset) => {
    const create = vi.spyOn(prep, "createMidDayPrepInstance");
    const res = await POST(req({ locationId: SHOP, date: offset === null ? "2030-01-01" : shift(offset) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "date_not_today" });
    expect(create).not.toHaveBeenCalled();
    expect(h.access).not.toHaveBeenCalled();
  });

  it("today's date reaches the create with the server's today", async () => {
    vi.spyOn(prep, "resolveMidDayPrepTemplate").mockResolvedValue({ id: "tmpl", name: "Mid-day" });
    const create = vi.spyOn(prep, "createMidDayPrepInstance").mockResolvedValue({ ok: true, id: "inst" });
    const res = await POST(req({ locationId: SHOP, date: TODAY }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ templateId: "tmpl", locationId: SHOP, date: TODAY }));
    expect(h.access).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ date: TODAY, task: "mid_day_prep" }));
  });
});

describe("createMidDayPrepInstance — one locked RPC", () => {
  const args = { templateId: "tmpl", locationId: SHOP, date: TODAY, actor: { userId: "kh", role: "key_holder" as const, level: 4 } };
  function client(rpcResult: { data: unknown; error: { code?: string; message: string } | null }) {
    const insert = vi.fn();
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q); q.eq = vi.fn(() => q);
    q.insert = vi.fn((...a: unknown[]) => { insert(...a); return q; });
    q.maybeSingle = vi.fn(async () => ({ data: { id: "legacy-inst" }, error: null }));
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(resolve);
    const rpc = vi.fn(async () => rpcResult);
    return { service: { from: vi.fn(() => q), rpc } as unknown as SupabaseClient, rpc, insert };
  }

  it("creates through the atomic RPC with the server cap and audits once", async () => {
    const c = client({ data: { ok: true, id: "inst" }, error: null });
    await expect(prep.createMidDayPrepInstance(c.service, args)).resolves.toEqual({ ok: true, id: "inst" });
    expect(c.rpc).toHaveBeenCalledWith("create_mid_day_prep_instance_atomic", {
      p_template_id: "tmpl", p_location_id: SHOP, p_date: TODAY, p_actor_id: "kh", p_cap: prep.MAX_MID_DAY_PREP_PER_DAY,
    });
    expect(prep.MAX_MID_DAY_PREP_PER_DAY).toBe(2);
    expect(c.insert).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "checklist_instance.create", resourceId: "inst" }));
  });

  it("cap_reached maps to the existing result and writes no audit", async () => {
    const c = client({ data: { ok: false, reason: "cap_reached", cap: 2 }, error: null });
    await expect(prep.createMidDayPrepInstance(c.service, args)).resolves.toEqual({ ok: false, reason: "cap_reached", cap: 2 });
    expect(audit).not.toHaveBeenCalled();
  });

  it("the SQL day pin maps to date_not_today", async () => {
    const c = client({ data: null, error: { code: "P0001", message: "date_not_today" } });
    await expect(prep.createMidDayPrepInstance(c.service, args)).resolves.toEqual({ ok: false, reason: "date_not_today" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("falls back to the old count-then-insert only while 0314 is missing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = client({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(prep.createMidDayPrepInstance(c.service, args)).resolves.toEqual({ ok: true, id: "legacy-inst" });
    expect(c.insert).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith("[mid-day create 0314_missing]", { code: "PGRST202" });
    expect(audit).toHaveBeenCalledOnce();
  });

  it("any other RPC error throws", async () => {
    const c = client({ data: null, error: { code: "P0001", message: "template_mismatch" } });
    await expect(prep.createMidDayPrepInstance(c.service, args)).rejects.toThrow(/template_mismatch/);
  });
});
