/** Catalog Phase 1 — SkuPackChainPanel was dead (SkuBuilder replaced it, 2026-07-27) and is gone. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("dead code stays dead", () => {
  it("components/admin/skus/SkuPackChainPanel.tsx no longer exists", () => {
    expect(existsSync(join(ROOT, "components", "admin", "skus", "SkuPackChainPanel.tsx"))).toBe(false);
  });
});
