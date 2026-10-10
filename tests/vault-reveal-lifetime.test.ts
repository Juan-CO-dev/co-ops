import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVaultRevealLifetime } from "@/lib/vault-reveal-lifetime";
import { VAULT_AUTO_HIDE_SECONDS } from "@/lib/vault-shared";

afterEach(() => vi.useRealTimers());

describe("vault plaintext lifetime (P1 #2 / BC-040)", () => {
  it("clears parent plaintext at 30 seconds without any mounted reveal row", () => {
    vi.useFakeTimers();
    let visible: string | null = null;
    const lifetime = createVaultRevealLifetime(() => { visible = null; });
    lifetime.accept(lifetime.begin(), () => { visible = "test value"; });
    vi.advanceTimersByTime(VAULT_AUTO_HIDE_SECONDS * 1000 - 1);
    expect(visible).toBe("test value");
    vi.advanceTimersByTime(1);
    expect(visible).toBeNull();
  });

  it.each(["shop filter", "tab change", "person filter", "edit dialog", "tab hidden", "page hide", "unmount", "PIN cancel"])(
    "%s discards plaintext and prevents a pending response from restoring it", () => {
      vi.useFakeTimers();
      let visible: string | null = null;
      const lifetime = createVaultRevealLifetime(() => { visible = null; });
      lifetime.accept(lifetime.begin(), () => { visible = "test value"; });
      lifetime.clear();
      expect(visible).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      const pending = lifetime.begin();
      lifetime.clear();
      expect(lifetime.accept(pending, () => { visible = "late value"; })).toBe(false);
      vi.advanceTimersByTime(120_000);
      expect(visible).toBeNull();
    },
  );

  it("rejects an older request and duplicate completions without extending expiry", () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    const publish = vi.fn();
    const lifetime = createVaultRevealLifetime(clear);
    const stale = lifetime.begin();
    const current = lifetime.begin();
    expect(lifetime.accept(stale, publish)).toBe(false);
    expect(lifetime.accept(current, publish)).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(lifetime.accept(current, publish)).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(3);
  });

  it("wires every view transition and browser lifecycle exit to parent invalidation", () => {
    const source = readFileSync("app/(authed)/vault/vault-client.tsx", "utf8").replace(/\r\n/g, "\n");
    for (const setter of ["setTab(tb.id)", 'setShopFilter("all")', "setShopFilter(s.id)", "setPerson(e.target.value)",
      'setForm({ kind: "shared" })', 'setForm({ kind: "personal" })', "setForm({ kind: entry.kind, initial: entry })"])
      expect(source).toContain(`clearView(); ${setter}`);
    expect(source).toContain('if (document.visibilityState === "hidden") clearView();');
    expect(source).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(source).toContain('window.addEventListener("pagehide", clearView)');
    expect(source).toContain('window.removeEventListener("pagehide", clearView);\n      clearView();');
    expect(source).toContain("hide();\n    setPending(null);\n    setForm(null);");
    expect(source).toContain("onBack={clearView}");
    expect(source).toContain("onCancel={clearView}");
    expect(source).toContain("const requestGeneration = revealLifetime.begin()");
  });
});
