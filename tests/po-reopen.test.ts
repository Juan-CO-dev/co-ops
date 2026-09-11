import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { isDestructive } from "@/lib/destructive-actions";
import { isKnownAuditAction, NON_DESTRUCTIVE_ACTIONS } from "@/lib/audit-actions";

const source = readFileSync("lib/purchase-orders.ts", "utf8");
const ast = ts.createSourceFile("purchase-orders.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return fn;
}
const body = declaration("reopenPO").body!.getText(ast);
class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message); }
}
function setup(status = "confirmed", count = 1, bound = true) {
  const updates: unknown[] = [];
  const filters: unknown[] = [];
  const audit = vi.fn();
  const requireLevel = vi.fn();
  const po = { id: "po", location_id: "shop", status, display_code: "CODE", confirmed_at: "2026-09-10T10:00:00Z", confirmed_by: "prior" };
  const sb = { from: () => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      maybeSingle: async () => ({ data: po, error: null }),
      update: (value: unknown) => { updates.push(value); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, count }).then(resolve),
    };
    return query;
  } };
  const deps = { PurchaseOrderError, PO_MIN: 4, requireLevel, getServiceRoleClient: () => sb, lockLocationContext: () => bound, actorLoc: () => ({}), audit };
  const js = ts.transpile(declaration("reopenPO").getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
  const reopen = new Function(...Object.keys(deps), `${js}; return reopenPO;`)(...Object.values(deps));
  const actor = { user: { id: "kh", role: "key_holder" } };
  return { updates, filters, audit, requireLevel, actor, run: () => reopen(actor, "po") };
}

describe("LRA-229: confirmed PO unlock", () => {
  it("uses KH floor and changes only status, auditing prior confirmation attribution", async () => {
    const f = setup();
    await f.run();
    expect(f.requireLevel).toHaveBeenCalledWith(f.actor, 4);
    expect(f.updates).toEqual([{ status: "draft" }]);
    expect(f.filters).toContainEqual(["status", "confirmed"]);
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "po.reopened", resourceId: "po",
      metadata: { display_code: "CODE", prior_confirmed_at: "2026-09-10T10:00:00Z", prior_confirmed_by: "prior" },
    }));
  });

  it.each(["draft", "placed", "invoiced", "received", "reconciled"])("refuses %s without an update or audit", async status => {
    const f = setup(status);
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "not_confirmed" });
    expect(f.updates).toEqual([]);
    expect(f.audit).not.toHaveBeenCalled();
  });

  it("refuses another location without a write", async () => {
    const f = setup("confirmed", 1, false);
    await expect(f.run()).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(f.updates).toEqual([]);
  });

  it("refuses a lost confirmed-state race when UPDATE affects no rows", async () => {
    const f = setup("confirmed", 0);
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "not_confirmed" });
    expect(f.audit).not.toHaveBeenCalled();
  });

  it("pins both status guards, rowcount and all history fields remaining outside the write", () => {
    expect(body).toContain('po.status !== "confirmed"');
    expect(body).toContain('.eq("status", "confirmed")');
    expect(body).toContain('{ count: "exact" }');
    expect(body).toContain("count === 0");
    expect(body).toContain('.update({ status: "draft" },');
    const writes = [...body.matchAll(/\.update\(([\s\S]*?)\)\.eq/g)].map(m => m[1]);
    expect(writes).toHaveLength(1);
    for (const field of ["confirmed_at", "confirmed_by", "confirmed_snapshot", "cutoff_at_confirm"]) {
      expect(writes[0]).not.toContain(field);
      expect(declaration("confirmPO").body!.getText(ast)).toContain(`${field}:`);
    }
  });

  it("registers reopening as known and destructive, never non-destructive", () => {
    expect(isDestructive("po.reopened")).toBe(true);
    expect(isKnownAuditAction("po.reopened")).toBe(true);
    expect(NON_DESTRUCTIVE_ACTIONS as readonly string[]).not.toContain("po.reopened");
    expect(readFileSync("lib/audit-actions.ts", "utf8")).toContain('"po.reopened"');
  });

  it("maps the reopen POST to a draft response", () => {
    const route = readFileSync("app/api/operations/ordering/po/route.ts", "utf8");
    expect(route).toMatch(/case "reopen":\s*\{[\s\S]*?await reopenPO\(ctx, b.poId\);\s*return jsonOk\(\{ poId: b.poId, status: "draft" \}\)/);
  });
});
