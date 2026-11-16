/**
 * Audit W22/B206 — cancelling a live LTO / discount takes two taps. The first tap only asks
 * (it sets `confirming`); `handleCancel` (step-up + the cancel POST) is reachable only from the
 * confirm button. Source pin: the component is client-only and the repo's unit spine has no DOM.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const src = readFileSync(path.join(process.cwd(), "components/admin/catering/lto/LtoClient.tsx"), "utf8");
const row = src.slice(src.indexOf("function EventRow("), src.indexOf("// ── Main client component"));

describe("B206: LTO cancel asks first", () => {
  it("the first button only sets confirming", () => {
    expect(row).toMatch(/onClick=\{\(\) => \{ setErrorMsg\(null\); setConfirming\(true\); \}\}/);
  });

  it("handleCancel is called from exactly one place: the confirm button", () => {
    const uses = row.match(/handleCancel\(\)/g) ?? [];
    expect(uses).toHaveLength(1);
    const confirmBtn = row.slice(row.indexOf("cancel_keep"));
    expect(confirmBtn).toContain("onClick={() => void handleCancel()}");
    expect(confirmBtn.indexOf("handleCancel()")).toBeLessThan(confirmBtn.indexOf("cancel_confirm"));
  });

  it("the cancel POST lives only inside handleCancel", () => {
    const body = row.slice(row.indexOf("const handleCancel"), row.indexOf("const terms"));
    expect(body).toContain("/cancel");
    expect(row.split("/cancel`").length - 1).toBe(1);
  });

  it("ships en + es copy", () => {
    for (const k of ["admin.catering.lto.cancel_keep", "admin.catering.lto.cancel_confirm", "admin.catering.lto.cancel_warning"] as const) {
      expect((en as Record<string, string>)[k]).toBeTruthy();
      expect((es as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
