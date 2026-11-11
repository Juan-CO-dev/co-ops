import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getCateringInboxMessage, handleCateringInbox, listCateringInbox, reassignCateringInbox } from "@/lib/catering/inbox";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const input = { expectedRevision: 1, requestId: "00000000-0000-4000-8000-000000000002" };
const context = (role: RoleCode) => ({ user: { id, role, active: true }, session: { id }, locations: ["old-shop"] } as unknown as AuthContext);
function database(role: RoleCode, location: string | null, active = true, memberships = ["shop"]) {
  const rpc = vi.fn().mockResolvedValue({ data: { revision: 2 }, error: null });
  const from = vi.fn((table: string) => {
    const data = table === "users" ? { role, active } : table === "user_locations" ? memberships.map(location_id => ({ location_id })) : { location_id: location };
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "order", "range"]) chain[name] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    chain.then = (resolve: (x: unknown) => unknown) => Promise.resolve(resolve({ data, error: null }));
    return chain;
  });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as never);
  return { from, rpc };
}
beforeEach(() => vi.clearAllMocks());
describe("inbox library authority", () => {
  const refused = Object.keys(ROLES).filter(r => !["gm", "catering_mgr", "moo", "owner", "cgs"].includes(r)) as RoleCode[];
  it.each(refused)("refuses %s before service client creation", async role => {
    const ctx = context(role);
    for (const operation of [() => listCateringInbox(ctx), () => getCateringInboxMessage(ctx,id), () => handleCateringInbox(ctx,id,input), () => reassignCateringInbox(ctx,id,{...input,assignedTo:null})]) await expect(operation()).rejects.toMatchObject({status:403});
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it.each(["catering_mgr","moo","owner","cgs"] as RoleCode[])("allows %s on null-location rows", async role => {
    const db = database(role,null);
    await handleCateringInbox(context(role),id,input);
    expect(db.rpc).toHaveBeenCalledWith("act_on_catering_inbox", expect.objectContaining({p_action:"handle",p_expected_revision:1,p_actor_id:id,p_session_id:id}));
  });
  it("allows GM only at a current active membership", async () => {
    const db = database("gm","shop"); await reassignCateringInbox(context("gm"),id,{...input,assignedTo:null}); expect(db.rpc).toHaveBeenCalledOnce();
  });
  it.each([null,"other-shop","old-shop"])("denies GM location %s despite old session membership", async location => {
    const db = database("gm",location);
    await expect(getCateringInboxMessage(context("gm"),id)).rejects.toMatchObject({status:404});
    await expect(handleCateringInbox(context("gm"),id,input)).rejects.toMatchObject({status:404}); expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalledWith("catering_inbox_drafts");
  });
  it("rechecks deactivation and role downgrade", async () => {
    for (const [role,active] of [["gm",false],["agm",true]] as const) {
      const db = database(role,"shop",active);
      await expect(listCateringInbox(context("gm"))).rejects.toMatchObject({status:403});
      expect(db.from).not.toHaveBeenCalledWith("catering_inbound_messages");
    }
  });
  it("returns a conflict for a stale SQL revision without claiming success", async () => {
    const db=database("gm","shop"); db.rpc.mockResolvedValue({data:null,error:{message:"stale_revision"}} as never);
    await expect(handleCateringInbox(context("gm"),id,input)).rejects.toMatchObject({status:409,code:"stale_revision"});
  });
  it.each(["PGRST205", "42P01", "42883", "PGRST202"])("maps missing action RPC %s to inbox_unavailable", async code => {
    const db = database("gm", "shop"); db.rpc.mockResolvedValue({ data: null, error: { code, message: "missing" } } as never);
    await expect(handleCateringInbox(context("gm"), id, input)).rejects.toMatchObject({ status: 503, code: "inbox_unavailable" });
  });
});
