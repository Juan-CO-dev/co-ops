import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import type { AuthContext } from "@/lib/session";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const locationId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const actor = (role: RoleCode) => ({ user: { id: "operator", role }, role, level: getRoleLevel(role), locations: [locationId] }) as AuthContext;
let ownAssignment = false;
let assignedToOther = false;
let domainRead: ReturnType<typeof vi.fn<(table: string) => never>>;

beforeEach(() => {
  ownAssignment = false;
  assignedToOther = false;
  domainRead = vi.fn((_table: string): never => { throw new Error("Unauthorized domain I/O"); });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: (table: string) => {
    if (table !== "report_assignments") return domainRead(table);
    let own = false;
    const q = {
      select: () => q, limit: () => q,
      eq: (key: string) => { if (key === "assignee_id") own = true; return q; },
      maybeSingle: async () => ({ data: (own ? ownAssignment : ownAssignment || assignedToOther) ? { id: "assignment" } : null, error: null }),
    };
    return q;
  } } as unknown as ReturnType<typeof getServiceRoleClient>);
});

class DomainError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
// Execute the actual boundary function with production assignment access and a recording database.
// This keeps unrelated domain loaders outside the test while proving access before their I/O.
function boundary(file: string, name: string) {
  const source = readFileSync(`lib/${file}.ts`, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const js = ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
  const dependencies = {
    canDoOperationalTask, getServiceRoleClient, getRoleLevel,
    selectAllRows: async () => [],
    requireLevel: (a: AuthContext, min: number) => { if (getRoleLevel(a.user.role) < min) throw new DomainError(403, "forbidden"); },
    requireReceiver: (a: AuthContext) => { if (getRoleLevel(a.user.role) < 4) throw new DomainError(403, "forbidden"); },
    actorLoc: (a: AuthContext) => a, lockLocationContext: () => true,
    COUNT_WRITE_MIN: 4, COUNT_READ_MIN: 6, PAR_PASS_MIN: 4,
    CountError: DomainError, OrderingError: DomainError, ReceivingError: DomainError,
  };
  return new Function(...Object.keys(dependencies), `${js}; return ${name};`)(...Object.values(dependencies));
}
const count = boundary("counts", "createCountEvent");
const order = boundary("ordering", "submitParPass");

describe("operational task enforcement", () => {
  for (const role of ["key_holder", "trainer", "shift_lead", "agm", "gm", "owner"] as const) {
    it(`${role} retains count and ordering authority when assigned to somebody else`, async () => {
      assignedToOther = true;
      await expect(count(actor(role), { locationId, lines: [] })).rejects.toMatchObject({ status: 400, code: "no_lines" });
      await expect(order(actor(role), locationId, [])).rejects.toMatchObject({ status: 400, code: "no_lines" });
      expect(domainRead).not.toHaveBeenCalled();
    });
  }
  it("an assigned KH passes the count gate and reaches input validation", async () => {
    ownAssignment = true;
    await expect(count(actor("key_holder"), { locationId, lines: [] })).rejects.toMatchObject({ status: 400, code: "no_lines" });
  });
  it("an unassigned KH can take a count, but a below-floor assignment never authorizes it", async () => {
    await expect(count(actor("key_holder"), { locationId, lines: [] })).rejects.toMatchObject({ status: 400, code: "no_lines" });
    ownAssignment = true;
    await expect(count(actor("employee"), { locationId, lines: [] })).rejects.toMatchObject({ status: 403 });
  });
  for (const task of ["counts", "receiving", "ordering", "pm_report"] as const) {
    it(`${task} rejects a below-floor user even with an assignment`, async () => {
      ownAssignment = true;
      expect(await canDoOperationalTask(actor("employee"), locationId, task)).toBe(false);
    });
    it(`${task} refuses another shop even with an assignment`, async () => {
      ownAssignment = true;
      expect(await canDoOperationalTask(actor("key_holder"), "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb", task)).toBe(false);
    });
  }
});

function countPost(ctx: AuthContext, writer: (...args: unknown[]) => Promise<unknown>, pin: string | undefined = "1234") {
  const src = readFileSync("app/api/operations/counts/route.ts", "utf8");
  const ast = ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "POST")!;
  const js = ts.transpile(fn.getText(ast).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });
  const deps = {
    ROLES, assertStepUp, COUNT_WRITE_MIN: 4, COUNT_READ_MIN: 6, CountError: DomainError,
    requireSession: async () => ctx,
    parseJsonBody: async () => ({ locationId, pin, lines: [{ skuId: "sku", levelLabel: "each", qty: 1 }] }),
    verifyActorPin: async (_userId: string, supplied: string) => supplied === "1234",
    createCountEvent: writer,
    jsonError: (status: number, code: string) => Response.json({ code }, { status }),
    jsonOk: (body: unknown, status: number) => Response.json(body, { status }),
  };
  return new Function(...Object.keys(deps), `${js}; return POST;`)(...Object.values(deps))({}) as Promise<Response>;
}

describe("count API step-up and assignment boundary", () => {
  const signedIn = (role: RoleCode, unlocked = false) => ({ ...actor(role), session: { stepUpUnlocked: unlocked } }) as AuthContext;
  it.each(["key_holder", "trainer", "shift_lead"] as const)("%s must re-enter a correct PIN before writing", async role => {
    const writer = vi.fn(async () => ({ countEventId: "count", advisories: [] }));
    const res = await countPost(signedIn(role), writer, "0000");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "pin_invalid" });
    expect(writer).not.toHaveBeenCalled();
  });
  it.each(["agm", "gm", "owner"] as const)("%s retains the password step-up before writing", async role => {
    const writer = vi.fn(async () => ({ countEventId: "count", advisories: [] }));
    const res = await countPost(signedIn(role), writer);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "step_up_required" });
    expect(writer).not.toHaveBeenCalled();
  });
  it("passes an assigned KH through the actual library authorization gate", async () => {
    ownAssignment = true;
    // Empty lines deliberately stop immediately AFTER authorization, without simulating inventory writes.
    const res = await countPost(signedIn("key_holder"), (ctx) => count(ctx, { locationId, lines: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "no_lines" });
  });
  it.each(["key_holder", "owner"] as const)("%s passes library authorization for another assignee after credential confirmation", async role => {
    assignedToOther = true;
    // Empty lines stop after the real assignment boundary, before inventory writes.
    const res = await countPost(signedIn(role, true), (ctx) => count(ctx, { locationId, lines: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "no_lines" });
    expect(domainRead).not.toHaveBeenCalled();
  });
});

async function countPage(role: RoleCode, mayCount: boolean) {
  const src = readFileSync("app/(authed)/operations/counts/page.tsx", "utf8");
  const ast = ts.createSourceFile("page.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "CountsPage")!;
  const js = ts.transpile(fn.getText(ast).replace(/^export default /, ""), { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
  const form = vi.fn(async () => ({ skus: [], products: [] }));
  const reference = vi.fn(async () => ({ skus: [], products: [] }));
  const onHand = vi.fn(async () => ({ rows: [], products: [] }));
  const deps = {
    requireSessionFromHeaders: async () => actor(role),
    canDoOperationalTask: async () => mayCount,
    COUNT_WRITE_MIN: 4, COUNT_READ_MIN: 6, lockLocationContext: () => true,
    redirect: () => { throw new Error("redirect"); },
    loadCountFormData: form, loadCountReferenceData: reference, loadOnHand: onHand,
    serverT: () => "label", twinVendorLabels: () => new Map(),
    CountForm: "CountForm", OnHandPanel: "OnHandPanel", DashboardBackLink: "DashboardBackLink", ExportLinks: "ExportLinks",
    React: { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) },
  };
  const page = new Function(...Object.keys(deps), `${js}; return CountsPage;`)(...Object.values(deps));
  const result = await page({ searchParams: Promise.resolve({ location: locationId }) });
  return { rendered: JSON.stringify(result), form, reference, onHand };
}

describe("count read-only view", () => {
  it("retains AGM history/variance when the count belongs to another person", async () => {
    const page = await countPage("agm", false);
    expect(page.rendered).toContain("OnHandPanel");
    expect(page.rendered).not.toContain("CountForm");
    expect(page.form).not.toHaveBeenCalled();
    expect(page.reference).toHaveBeenCalledOnce();
  });
  it.each(["key_holder", "trainer", "shift_lead"] as const)("assigned %s receives a PIN form without the AGM reference view", async role => {
    const page = await countPage(role, true);
    expect(page.rendered).toContain("CountForm");
    expect(page.rendered).toContain('"requiresPin":true');
    expect(page.rendered).not.toContain("OnHandPanel");
    expect(page.onHand).not.toHaveBeenCalled();
  });
  it("AGM receives the password confirmation form", async () => {
    expect((await countPage("agm", true)).rendered).toContain('"requiresPin":false');
  });
  it("a below-floor assignee cannot see a count form", async () => {
    await expect(countPage("employee", true)).rejects.toThrow("redirect");
  });
  it("KH without task permission cannot enter the reference view", async () => {
    await expect(countPage("key_holder", false)).rejects.toThrow("redirect");
  });
});


describe("count tile metadata", () => {
  const tile = boundary("counts", "loadCountsTileState");
  it("lets an assigned KH load the tile without AGM-only history authority", async () => {
    ownAssignment = true;
    await expect(tile(actor("key_holder"), locationId)).resolves.toEqual({ lastCountDate: null, anchoredSkuCount: 0 });
  });
  it("retains KH count metadata when another person holds the task", async () => {
    assignedToOther = true;
    await expect(tile(actor("key_holder"), locationId)).resolves.toEqual({ lastCountDate: null, anchoredSkuCount: 0 });
  });
});
