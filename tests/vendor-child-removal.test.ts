/**
 * W19/B191 — two people removing a vendor's contacts (or ordering details) at the same moment can no longer remove
 * the last one. The count and the deactivation run in ONE transaction under the vendor row lock (0325
 * remove_vendor_contact / remove_vendor_ordering_detail; proven in scripts/sql-harness-0325.mjs). Here: the real lib
 * bodies (transpiled) call the RPCs, map their refusals, and fall back only when 0325 is not applied.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("lib/admin/vendors.ts", "utf8");
const ast = ts.createSourceFile("vendors.ts", source, ts.ScriptTarget.Latest, true);
function fnText(name: string): string {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
}
class AdminVendorError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}
const optional = (name: string) => { try { return new Function(`${fnText(name)}; return ${name};`)(); } catch { return undefined; } };

const CASES = [
  { fn: "removeVendorContact", rpc: "remove_vendor_contact", table: "vendor_contacts", idArg: "contactId", rpcId: "p_contact_id", last: "last_contact", require: "requireContactRow" },
  { fn: "removeVendorOrderingDetail", rpc: "remove_vendor_ordering_detail", table: "vendor_ordering_details", idArg: "detailId", rpcId: "p_detail_id", last: "last_ordering_detail", require: "requireOrderingRow" },
] as const;

function setup(c: (typeof CASES)[number], rpcError: { code: string; message: string } | null, activeCount = 2) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: unknown[] = [];
  const sb = {
    rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return { error: rpcError }; },
    from: () => {
      const chain: Record<string, unknown> = {};
      let op = "select";
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.update = (p: unknown) => { op = "update"; updates.push(p); return chain; };
      chain.then = (res: (v: unknown) => void) => res(op === "select" ? { count: activeCount, error: null } : { error: null });
      return chain;
    },
  };
  const audit = vi.fn(async () => {});
  const deps: Record<string, unknown> = {
    requireLevel: () => {}, GM_MIN: 7, getServiceRoleClient: () => sb, AdminVendorError, audit,
    [c.require]: async () => ({ id: "row", vendor_id: "v1" }), vendorRpcMissing: optional("vendorRpcMissing"),
  };
  const remove = new Function(...Object.keys(deps), `${fnText(c.fn)}; return ${c.fn};`)(...Object.values(deps)) as
    (actor: unknown, args: Record<string, string>) => Promise<void>;
  return { run: () => remove({ user: { id: "gm", role: "gm" } }, { [c.idArg]: "row" }), rpcCalls, updates, audit };
}

describe.each(CASES)("W19/B191 $fn", (c) => {
  it("removes through the locked RPC (never a bare count-then-update) and audits", async () => {
    const f = setup(c, null);
    await f.run();
    expect(f.rpcCalls).toEqual([{ name: c.rpc, args: { [c.rpcId]: "row", p_actor: "gm" } }]);
    expect(f.updates).toEqual([]);
    expect(f.audit).toHaveBeenCalledTimes(1);
  });

  it(`the RPC's ${c.last} refusal is the same 400 as before`, async () => {
    const f = setup(c, { code: "P0001", message: c.last });
    await expect(f.run()).rejects.toMatchObject({ status: 400, code: c.last });
    expect(f.audit).not.toHaveBeenCalled();
  });

  it("an already-removed row is 404 not_found", async () => {
    const f = setup(c, { code: "P0001", message: "not_found" });
    await expect(f.run()).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("before 0325 (function missing) it falls back to the old count + update", async () => {
    const f = setup(c, { code: "PGRST202", message: "Could not find the function" }, 2);
    await f.run();
    expect(f.updates).toHaveLength(1);
    const g = setup(c, { code: "PGRST202", message: "Could not find the function" }, 1);
    await expect(g.run()).rejects.toMatchObject({ status: 400, code: c.last });
  });
});
