/** Catalog Phase 1 — how the window and the grants are wired on the client. Source pins. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
function filesUnder(...roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const entry of readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" })) {
      out.push(`${root}/${entry.split(sep).join("/")}`);
    }
  }
  return out.sort();
}

describe("the window is decided once, and the server stays the authority", () => {
  it("StepUpProvider decides over refs of BOTH clocks and exposes the grant and forget lanes", () => {
    const src = read("components/admin/StepUpProvider.tsx");
    expect(src).toContain('from "@/lib/admin/step-up-shared"');
    expect(src).toContain(
      "stepUpDecision(tier, { unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, Date.now(), editWindowMs)",
    );
    expect(src).toContain("requestStepUpGrant");
    expect(src).toContain("forgetStepUp");
  });

  it("the admin layout hands the server's clock and window to the client and opens the window", () => {
    const layout = read("app/admin/layout.tsx");
    expect(layout).toContain("catalogUnlockedAt={auth.session.catalogEditUnlockedAt ?? null}");
    expect(layout).toContain("editWindowMs={stepUpEditWindowMs()}");
    expect(layout).toMatch(/\n\s+catalogWindow\n/);
  });

  it("the modal sends the purpose and the window flag; the reactive catalog modal opens the window too", () => {
    const modal = read("components/auth/PasswordModal.tsx");
    expect(modal).toContain("...(catalogWindow ? { catalogWindow: true } : {})");
    expect(modal).toContain("...(purpose ? { purpose } : {})");
    expect(read("components/admin/catalog/CatalogClient.tsx")).toMatch(/<PasswordModal\s+catalogWindow/);
  });

  it("the reactive catalog modal reports to the provider: confirm advances the clock, refusal forgets it (Astra r3 #1)", () => {
    const catalog = read("components/admin/catalog/CatalogClient.tsx");
    expect(catalog).toContain("onConfirm={async () => { noteStepUpConfirmed(); if (pendingRef.current) await pendingRef.current(); }}");
    expect(catalog.match(/b\.code === "step_up_stale"\) \{\n\s+forgetStepUp\(\);/g)).toHaveLength(2);
    const provider = read("components/admin/StepUpProvider.tsx");
    expect(provider).toContain("confirmClientUnlock({ unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, now, catalogWindow)");
    expect(provider).toMatch(/const handleConfirm = useCallback\(\(\) => \{[\s\S]{0,120}noteStepUpConfirmed\(\);/);
  });

  it("a successful unlock is audited with the window and the grant it opened", () => {
    expect(read("app/api/auth/step-up/route.ts")).toMatch(
      /action: "auth_step_up_success",[\s\S]{0,300}edit_window_seconds: catalogWindow \? stepUpEditWindowMs\(\) \/ 1000 : null/,
    );
  });

  it("useStepUpPost forgets an unlock the server refused", () => {
    expect(read("components/admin/useStepUpPost.ts")).toContain(
      "if (!result.ok && isStepUpRefusal(result.code)) forgetStepUp();",
    );
  });

  it("only unlockStepUp stamps either clock, so neither window can slide", () => {
    const writers = (re: RegExp) =>
      filesUnder("app", "lib", "components").filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => re.test(read(f)));
    expect(writers(/step_up_unlocked_at:\s*now/)).toEqual(["lib/session.ts"]);
    expect(writers(/catalog_edit_unlocked_at:\s*now/)).toEqual(["lib/session.ts"]);
  });
});
