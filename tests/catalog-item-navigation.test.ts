/** Catalog Phase 2b — switching shop (or SKU) never shows the previous scope's draft or a late preview (Astra 2b#5). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { itemClientKey } from "@/lib/catalog/sku-item-shared";

describe("late responses are dropped", () => {
  it("shop A's slow preview resolves after shop B's: A's answer is discarded", async () => {
    const g = createRequestGuard();
    let resolveA!: (v: string) => void;
    const a = g.run(() => new Promise<string>((r) => { resolveA = r; }));
    const b = g.run(async () => "B");
    expect(await b).toBe("B");
    resolveA("A");
    expect(await a).toBeNull();
  });
  it("an edited draft (or a left job) invalidates the in-flight preview", async () => {
    const g = createRequestGuard();
    let resolveA!: (v: string) => void;
    const a = g.run(() => new Promise<string>((r) => { resolveA = r; }));
    g.invalidate();
    resolveA("A");
    expect(await a).toBeNull();
  });
});

describe("a shop switch remounts the page body", () => {
  it("the client is keyed by (SKU, shop), and every preview goes through the guard", () => {
    expect(readFileSync("app/admin/catalog/sku/[id]/page.tsx", "utf8")).toContain("key={itemClientKey(view.sku.id, view.scope)}");
    expect(itemClientKey("s", "a")).not.toBe(itemClientKey("s", "b"));
    const client = readFileSync("components/catalog/SkuItemClient.tsx", "utf8");
    expect(client.match(/guard\.run\(/g)?.length).toBe(2);
    expect(client).toContain("target: preview.target,");
    expect(client).toContain("previewToken: preview.token");
  });
});
