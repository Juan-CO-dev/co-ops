/**
 * W23/B129 — createCompany committed the company row BEFORE validating its domains, so a refused
 * domain (personal, malformed, already taken) left an orphan company and the retry made a
 * duplicate. Domains are now validated before any I/O and the company + domains are written in
 * one transaction (0330 create_catering_company); before 0330 the two-step fallback pre-checks a
 * taken domain before inserting the company.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  heldDomains: [] as string[],
}));
const audit = vi.hoisted(() => vi.fn(async (_input: unknown) => undefined));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/catering/ezcater-detail", () => ({ loadCateringReader: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ rpc: state.rpc, from: state.from }) }));

import { createCompany } from "@/lib/catering/companies";

const mgr = { user: { id: "u-cm", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: [] } as unknown as AuthContext;

function fakeFrom(table: string) {
  let row: Record<string, unknown> | null = null;
  let domains: string[] = [];
  const q = {
    select: () => q, eq: () => q, limit: () => q, returns: () => q,
    in: (_c: string, v: string[]) => { domains = v; return q; },
    insert: (r: Record<string, unknown>) => { row = r; return q; },
    single: () => q,
    then: (res: (v: unknown) => unknown) => {
      if (row) { state.inserts.push({ table, row }); return Promise.resolve({ data: { id: `${table}-${state.inserts.length}` }, error: null }).then(res); }
      return Promise.resolve({ data: domains.filter((d) => state.heldDomains.includes(d)).map((domain) => ({ domain })), error: null }).then(res);
    },
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.inserts = []; state.heldDomains = [];
  state.from.mockImplementation(fakeFrom);
  state.rpc.mockResolvedValue({ data: { company_id: "co-1", domain_ids: ["d-1"] }, error: null });
});

describe("W23/B129 createCompany validates before it writes", () => {
  it.each([
    [["gmail.com"], 400, "personal_domain"],
    [["acme"], 400, "invalid_payload"],
    [["acme.com", "ACME.com"], 400, "invalid_payload"],
  ])("%j is refused (%s %s) with no write at all", async (domains, status, code) => {
    await expect(createCompany(mgr, { name: "Acme", domains })).rejects.toMatchObject({ status, code });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("a domain another company holds is 409 domain_taken and audits nothing (the RPC rolled the company back)", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "domain_taken" } });
    await expect(createCompany(mgr, { name: "Acme", domains: ["acme.com"] })).rejects.toMatchObject({ status: 409, code: "domain_taken" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("success writes through the one-transaction RPC and audits the create + each domain", async () => {
    expect(await createCompany(mgr, { name: " Acme ", domains: ["@Acme.com"], notes: "n" })).toEqual({ id: "co-1" });
    expect(state.rpc).toHaveBeenCalledWith("create_catering_company", { p_actor_id: "u-cm", p_name: "Acme", p_notes: "n", p_domains: ["acme.com"] });
    expect(state.from).not.toHaveBeenCalled();
    const actions = audit.mock.calls.map(([a]) => (a as { action: string }).action);
    expect(actions).toEqual(["catering.company.create", "catering.company.add_domain"]);
  });

  it("before 0330: the fallback refuses a taken domain BEFORE inserting the company", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    state.heldDomains = ["acme.com"];
    await expect(createCompany(mgr, { name: "Acme", domains: ["acme.com"] })).rejects.toMatchObject({ status: 409, code: "domain_taken" });
    expect(state.inserts).toHaveLength(0);
  });

  it("before 0330: the fallback still creates the company and its domains", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "missing" } });
    expect((await createCompany(mgr, { name: "Acme", domains: ["acme.com"] })).id).toBe("catering_companies-1");
    expect(state.inserts.map((i) => i.table)).toEqual(["catering_companies", "catering_company_domains"]);
  });
});
