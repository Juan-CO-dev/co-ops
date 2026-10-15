/**
 * Catalog Phase 2a (sim QA, 2026-10-15) — the /admin/skus chain editor tells the truth BEFORE a save:
 *   · below MoO an EXISTING global pack opens READ-ONLY with a plain line (no password prompt for a
 *     save the database refuses);
 *   · saving an unchanged chain is a no-op — no request;
 *   · every named refusal the pack-chain route can return shows ITS OWN message, never the generic
 *     text (the old editor read the parent's error prop in a stale closure and always fell back).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { canChangeGlobalPack, hasGlobalPack, resolveErrorKey, STEP_UP_CANCELLED } from "@/components/admin/skus/shared";

const E = en as Record<string, string>;
const S = es as Record<string, string>;
const flat = (o: Partial<{ packFormat: string | null; unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null }> = {}) =>
  ({ packFormat: null, unitsPerPack: null, eachSize: null, eachMeasure: null, ...o });

describe("who may change a GLOBAL pack from this screen", () => {
  it("a SKU has a global pack when it has a live chain or any flat field set — the 'Each (no case)' placeholder alone is not one", () => {
    expect(hasGlobalPack(flat(), 2)).toBe(true);
    expect(hasGlobalPack(flat({ unitsPerPack: 4 }), 0)).toBe(true);
    expect(hasGlobalPack(flat({ eachSize: 5, eachMeasure: "lb" }), 0)).toBe(true);
    expect(hasGlobalPack(flat({ packFormat: "Case" }), 0)).toBe(true);
    expect(hasGlobalPack(flat({ packFormat: "Each (no case)" }), 0)).toBe(false);
    expect(hasGlobalPack(flat(), 0)).toBe(false);
  });
  it("it mirrors 0259's first-value rule (the same placeholder exemption)", () => {
    const sql = readFileSync("supabase/migrations/0259_sku_shop_versions.sql", "utf8");
    expect(sql).toContain("or (v_flat.pack_format is not null and v_flat.pack_format <> 'Each (no case)'));");
  });
  it("MoO+ always; a GM only the FIRST pack — Marcus (GM) on Balsamic Glaze (has a pack) is read-only", () => {
    expect(canChangeGlobalPack(8, true)).toBe(true);
    expect(canChangeGlobalPack(9, true)).toBe(true);
    expect(canChangeGlobalPack(7, true)).toBe(false);
    expect(canChangeGlobalPack(7, false)).toBe(true);
  });
});

describe("the editor opens read-only instead of offering a doomed save", () => {
  const src = readFileSync("components/admin/skus/SkuBuilder.tsx", "utf8");
  it("both branches (chained, and unchained with a flat pack) render the plain line in place of the edit trigger", () => {
    expect(src).toContain("const globalPackLocked = isEdit && !canChangeGlobalPack(actorLevel, hasGlobalPack(initial!, initialChain?.length ?? 0));");
    expect(src.match(/\{t\("admin\.skus\.chain\.global_read_only"\)\}/g)).toHaveLength(2);
    expect(src).toMatch(/\{globalPackLocked \? \(\s+<p role="note"[^>]*>\{t\("admin\.skus\.chain\.global_read_only"\)\}<\/p>\s+\) : onSaveChain \? \(/);
    expect(src).toMatch(/\{globalPackLocked \? \(\s+<p role="note"[^>]*>\{t\("admin\.skus\.chain\.global_read_only"\)\}<\/p>\s+\) : !wizardOpen \? \(/);
  });
  it("the line reads plainly in English and Spanish", () => {
    expect(E["admin.skus.chain.global_read_only"]).toBe("Only the Director of Operations can change this pack for every shop.");
    expect(S["admin.skus.chain.global_read_only"]).toMatch(/Director de Operaciones/);
  });
});

describe("an unchanged chain is a no-op", () => {
  const src = readFileSync("components/admin/skus/SkuBuilder.tsx", "utf8");
  it("the baseline is taken when the editor opens, and an identical save returns before the request", () => {
    expect(src).toContain("setChainBaseline(JSON.stringify(editorRowsToPayload(rows)));");
    const save = src.slice(src.indexOf("const saveChain = async () => {"), src.indexOf("const saveWizardChain"));
    expect(save.indexOf('setChainNote(t("admin.skus.chain.no_changes"));')).toBeGreaterThan(-1);
    expect(save.indexOf('setChainNote(t("admin.skus.chain.no_changes"));')).toBeLessThan(save.indexOf("await onSaveChain("));
    expect(E["admin.skus.chain.no_changes"]).toBe("No changes to save.");
    expect(S["admin.skus.chain.no_changes"]).toBeTruthy();
  });
});

describe("every named refusal shows its own message", () => {
  const lib = readFileSync("lib/admin/pack-chain.ts", "utf8");
  const route = readFileSync("app/api/admin/skus/[id]/pack-chain/route.ts", "utf8");
  // Every code the chain editor's save can come back with: the lib's PackChainError codes, the
  // RPC refusal map, validateSubmission's derived chain codes, the route's own, and step-up.
  const codes = new Set<string>([
    ...[...lib.matchAll(/PackChainError\(\d+, "([a-z_]+)"/g)].map((m) => m[1]!),
    ...[...lib.matchAll(/\[\d+, "([a-z_]+)",/g)].map((m) => m[1]!),
    ...[...lib.matchAll(/\? "([a-z_]+)" :/g)].map((m) => m[1]!), ...[...lib.matchAll(/"(chain_invalid)";/g)].map((m) => m[1]!),
    ...[...route.matchAll(/jsonError\(\d+, "([a-z_]+)"/g)].map((m) => m[1]!),
    "step_up_required", "step_up_stale",
  ]);
  it("covers the codes the sim refusal produced (and is not vacuous)", () => {
    for (const c of ["global_requires_moo", "version_changed", "sku_inactive", "not_found", "chain_cycle", "leaf_needs_avg"]) expect(codes, c).toContain(c);
    expect(codes.size).toBeGreaterThan(15);
  });
  it("each resolves to its own key, present in English and Spanish — never the generic text", () => {
    for (const code of codes) {
      const key = resolveErrorKey(code);
      expect(key, code).not.toBe("admin.skus.error.generic");
      expect(E[key], `${code} en`).toBeTruthy();
      expect(S[key], `${code} es`).toBeTruthy();
    }
  });
  it("the first-value refusals and a concurrent change read as the sim asked", () => {
    expect(E[resolveErrorKey("global_requires_moo")]).toBe("Only the Director of Operations can change this pack for every shop.");
    expect(E[resolveErrorKey("version_changed")]).toBe("Someone else changed this pack. Reload to see it.");
    expect(lib).toContain('flat_pack_exists: [403, "global_requires_moo"');
  });
  it("the save hands the CODE back (no stale prop); a dismissed password prompt says nothing", () => {
    const b = readFileSync("components/admin/skus/SkuBuilder.tsx", "utf8");
    expect(b).not.toContain('errorMsg ?? t("admin.skus.error.generic")');
    expect(b).toContain("} else if (res.code !== STEP_UP_CANCELLED) {");
    expect(STEP_UP_CANCELLED).toBe("step_up_cancelled");
    for (const parent of ["components/admin/skus/SkuCatalogClient.tsx", "components/admin/skus/VendorSkusCard.tsx"]) {
      const src = readFileSync(parent, "utf8");
      expect(src).toContain('if ((await requestStepUp("E")) !== "ok") return { ok: false, code: STEP_UP_CANCELLED };');
      expect(src).toContain("return { ok: false, code: result.code };");
    }
  });
});
