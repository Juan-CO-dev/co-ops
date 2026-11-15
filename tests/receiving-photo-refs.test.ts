/**
 * W08/B162 — receiving intake stores a receipt / line photo only as the canonical `/api/photos/<id>` of a photo
 * that exists at the delivery's shop. bindDeliveryPhotos is exercised on its real body (transpiled) with a stub
 * client; source pins prove both intake writers bind BEFORE their first insert and no longer write the raw string.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { photoIdFromRef } from "@/lib/receiving-shared";

const source = readFileSync("lib/receiving.ts", "utf8");
const ast = ts.createSourceFile("receiving.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string): ts.FunctionDeclaration {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn || !ts.isFunctionDeclaration(fn) || !fn.body) throw new Error(`Missing ${name}`);
  return fn;
}
class ReceivingError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

const SHOP = "shop-a";
const P1 = "0d9a3c1e-5b6f-4a7d-8e9f-0123456789a1";
const P2 = "0d9a3c1e-5b6f-4a7d-8e9f-0123456789a2";
const FOREIGN = "0d9a3c1e-5b6f-4a7d-8e9f-0123456789b1";
const photos = [{ id: P1, location_id: SHOP }, { id: P2, location_id: SHOP }, { id: FOREIGN, location_id: "shop-b" }];

function binder() {
  const js = ts.transpile(declaration("bindDeliveryPhotos").getText(ast), { target: ts.ScriptTarget.ES2022 });
  const fn = new Function("photoIdFromRef", "ReceivingError", `${js}; return bindDeliveryPhotos;`)(photoIdFromRef, ReceivingError) as
    (sb: unknown, loc: string, receipt: unknown, lines: unknown[]) => Promise<{ receiptUrl: string | null; lineUrls: Array<string | null> }>;
  const reads: string[] = [];
  const sb = { from: (table: string) => {
    reads.push(table);
    let ids: string[] = [];
    const q = { select: () => q, in: (_c: string, v: string[]) => { ids = v; return q; },
      returns: async () => ({ data: photos.filter(p => ids.includes(p.id)), error: null }) };
    return q;
  } };
  return { run: (receipt: unknown, lines: unknown[]) => fn(sb, SHOP, receipt, lines), reads };
}

describe("W08/B162 bindDeliveryPhotos", () => {
  it("returns the canonical strings for this shop's photos, index-aligned, nulls kept", async () => {
    const b = binder();
    await expect(b.run(`/api/photos/${P1}`, [null, `/api/photos/${P2}`, ""])).resolves.toEqual({
      receiptUrl: `/api/photos/${P1}`, lineUrls: [null, `/api/photos/${P2}`, null],
    });
  });

  it("no photo at all reads nothing", async () => {
    const b = binder();
    await expect(b.run(null, [undefined, null])).resolves.toEqual({ receiptUrl: null, lineUrls: [null, null] });
    expect(b.reads).toHaveLength(0);
  });

  it("an external receipt URL is 400 invalid_photo before any photos read", async () => {
    const b = binder();
    await expect(b.run("https://evil.example/r", [])).rejects.toMatchObject({ status: 400, code: "invalid_photo" });
    await expect(b.run(null, ["//evil.example/p"])).rejects.toMatchObject({ status: 400, code: "invalid_photo" });
    expect(b.reads).toHaveLength(0);
  });

  it("another shop's photo or a missing photo is 404 photo_not_found", async () => {
    const b = binder();
    await expect(b.run(`/api/photos/${FOREIGN}`, [])).rejects.toMatchObject({ status: 404, code: "photo_not_found" });
    await expect(b.run(null, ["/api/photos/00000000-0000-4000-8000-000000000000"])).rejects.toMatchObject({ status: 404, code: "photo_not_found" });
  });
});

describe("W08/B162 both intake writers bind before writing", () => {
  for (const name of ["recordDelivery", "addDeliveryLines"]) {
    it(`${name} calls bindDeliveryPhotos before its first insert`, () => {
      const body = declaration(name).body!.getText(ast);
      const bind = body.indexOf("await bindDeliveryPhotos(");
      expect(bind).toBeGreaterThan(0);
      expect(bind).toBeLessThan(body.indexOf(".insert("));
      expect(body).toContain("photos.lineUrls");
    });
  }
  it("the raw caller strings are no longer written", () => {
    expect(source).not.toContain("receipt_url: input.receiptUrl");
    expect(source).not.toContain("photo_url: l.photoUrl");
    expect(declaration("recordDelivery").body!.getText(ast)).toContain("receipt_url: photos.receiptUrl");
  });
});
