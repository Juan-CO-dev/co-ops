/**
 * W08/B163 — opening Phase 1 submit refuses a photoId that is not a photo of the instance's shop, before the
 * RPC. assertPhase1PhotosAtShop runs on its real body (transpiled) with a stub service client; a source pin
 * proves submitPhase1Atomic calls it before `submit_phase1_atomic` (and keeps the rpcEntries anchor).
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/opening.ts", "utf8");
const ast = ts.createSourceFile("opening.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string): ts.FunctionDeclaration {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return fn;
}
class OpeningEntryShapeError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}
const RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const P = "0d9a3c1e-5b6f-4a7d-8e9f-0123456789ab";
const FOREIGN = "0d9a3c1e-5b6f-4a7d-8e9f-0123456789cd";

function harness(photos: Array<{ id: string; location_id: string }>) {
  const js = ts.transpile(declaration("assertPhase1PhotosAtShop").getText(ast), { target: ts.ScriptTarget.ES2022 });
  const fn = new Function("OPENING_PHOTO_ID_RE", "OpeningEntryShapeError", `${js}; return assertPhase1PhotosAtShop;`)(RE, OpeningEntryShapeError) as
    (service: unknown, instanceId: string, entries: Array<{ photoId?: string | null }>) => Promise<void>;
  const reads: string[] = [];
  const service = { from: (table: string) => {
    reads.push(table);
    let ids: string[] = [];
    const q = {
      select: () => q, eq: () => q, in: (_c: string, v: string[]) => { ids = v; return q; },
      maybeSingle: async () => ({ data: table === "checklist_instances" ? { location_id: "shop" } : null, error: null }),
      returns: async () => ({ data: photos.filter(p => ids.includes(p.id)), error: null }),
    };
    return q;
  } };
  return { run: (entries: Array<{ photoId?: string | null }>) => fn(service, "instance", entries), reads };
}

describe("W08/B163 opening Phase 1 photo binding", () => {
  it("an unbound photoId rejects with OpeningEntryShapeError(photo_not_found)", async () => {
    const h = harness([]);
    await expect(h.run([{ photoId: P }])).rejects.toMatchObject({ reason: "photo_not_found" });
  });
  it("another shop's photo rejects", async () => {
    const h = harness([{ id: FOREIGN, location_id: "other" }]);
    await expect(h.run([{ photoId: FOREIGN }])).rejects.toBeInstanceOf(OpeningEntryShapeError);
  });
  it("a malformed photoId rejects invalid_photo before any read", async () => {
    const h = harness([]);
    await expect(h.run([{ photoId: "nope" }])).rejects.toMatchObject({ reason: "invalid_photo" });
    expect(h.reads).toHaveLength(0);
  });
  it("this shop's photos and empty ones pass; no photo means no read", async () => {
    const h = harness([{ id: P, location_id: "shop" }]);
    await expect(h.run([{ photoId: P }, { photoId: "" }, { photoId: null }, {}])).resolves.toBeUndefined();
    const none = harness([]);
    await expect(none.run([{ photoId: "" }, { photoId: null }])).resolves.toBeUndefined();
    expect(none.reads).toHaveLength(0);
  });
  it("submitPhase1Atomic binds the photos before the RPC, after the access gate", () => {
    const body = declaration("submitPhase1Atomic").body!.getText(ast);
    const bind = body.indexOf("await assertPhase1PhotosAtShop(service, args.instanceId, args.entries);");
    expect(bind).toBeGreaterThan(body.indexOf("canAccessOpeningInstance("));
    expect(bind).toBeLessThan(body.indexOf('service.rpc("submit_phase1_atomic"'));
    expect(body).toContain("const rpcEntries = args.entries.map");
  });
});
