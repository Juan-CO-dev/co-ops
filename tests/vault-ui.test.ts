/**
 * Password vault UI contracts (source-text, like the repo's other surface tests): 44 px controls paired
 * with items-center, the 30 s auto-hide from the one constant, no client-side caching of a secret,
 * every string through t()/serverT(), and the nav chip only behind the switch.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { navDestinationsFor } from "@/lib/nav-links";
import { VAULT_AUTO_HIDE_SECONDS } from "@/lib/vault-shared";

const files = {
  page: "app/(authed)/vault/page.tsx",
  client: "app/(authed)/vault/vault-client.tsx",
  reveal: "components/vault/SecretReveal.tsx",
  form: "components/vault/VaultEntryForm.tsx",
};
const src = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(p, "utf8")])) as Record<keyof typeof files, string>;
const clientFiles = [src.client, src.reveal, src.form];

/** Every opening tag of `tag` with its attributes (multi-line), closing at the first `>` outside a {…} expression. */
function tags(source: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b`, "g");
  for (const m of source.matchAll(re)) {
    let depth = 0;
    for (let i = m.index! + m[0].length; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) { out.push(source.slice(m.index!, i + 1)); break; }
    }
  }
  return out;
}

describe("44 px tap floor, always with items-center", () => {
  it("every button, link and ActionButton in the vault surface declares min-h-[44px] and items-center (or inherits both from a shared class)", () => {
    const classFloors = { CHIP: /const CHIP = "[^"]*min-h-\[44px\] items-center/, SMALL: /const SMALL = "[^"]*min-h-\[44px\] items-center/ };
    expect(src.client).toMatch(classFloors.CHIP);
    expect(src.client).toMatch(classFloors.SMALL);
    for (const source of clientFiles) {
      for (const tag of [...tags(source, "button"), ...tags(source, "a"), ...tags(source, "ActionButton")]) {
        const viaClass = /className=\{`?\$?\{?(CHIP|SMALL)/.test(tag) || /className=\{(CHIP|SMALL)\}/.test(tag);
        const inline = tag.includes("min-h-[44px]") && tag.includes("items-center");
        expect(viaClass || inline, tag.slice(0, 160)).toBe(true);
      }
    }
  });
  it("every input, select and textarea is at least 44 px tall", () => {
    for (const source of [src.client, src.form]) {
      for (const tag of [...tags(source, "input"), ...tags(source, "select"), ...tags(source, "textarea")]) {
        const ok = tag.includes("min-h-[44px]") || tag.includes("className={INPUT}") || tag.includes("className={`${INPUT}") || tag.includes('type="checkbox"');
        expect(ok, tag.slice(0, 160)).toBe(true);
      }
    }
    expect(src.form).toMatch(/const INPUT = "min-h-\[44px\]/);
    // The checkbox keeps a 20 px box inside a 44 px label hit area.
    expect(src.form).toMatch(/<label className="flex min-h-\[44px\] items-center[^"]*">\s*<input type="checkbox" className="h-5 w-5"/);
  });
});

describe("the revealed secret", () => {
  it("owns the 30-second expiry in the parent, independently of row mounting", () => {
    expect(VAULT_AUTO_HIDE_SECONDS).toBe(30);
    expect(src.reveal).toContain('import { VAULT_AUTO_HIDE_SECONDS } from "@/lib/vault-shared";');
    expect(src.reveal).not.toContain("setTimeout(");
    expect(src.client).toContain("createVaultRevealLifetime(() => setRevealed(null))");
    expect(src.client).toContain("revealLifetime.accept(requestGeneration, () => setRevealed(nextReveal))");
    for (const source of clientFiles) expect(source).not.toMatch(/\b30_?000\b|\b30 \* 1000\b/);
  });
  it("is never cached client-side: no storage, no cookies, no URL, no logging; navigation drops it", () => {
    for (const source of clientFiles) {
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|URLSearchParams|router\.push\([^)]*secret/);
      expect(source).not.toMatch(/console\./);
    }
    expect(src.client).toMatch(/return \(\) => \{\s*document.removeEventListener[\s\S]*?clearView\(\);/);
    expect(src.client).toContain('fetch("/api/vault/entries"');
    expect(src.client).not.toMatch(/secret[^\n]*\bcache\b/i);
  });
  it("shows the recorded banner for shared, the not-recorded banner for personal, the recovery banner for recoveries; Copy uses the clipboard API", () => {
    expect(src.reveal).toContain('mode === "shared" ? "vault.reveal.recorded_banner" : mode === "personal" ? "vault.reveal.personal_banner" : "vault.reveal.recovery_banner"');
    expect(src.reveal).toContain("navigator.clipboard.writeText(secret)");
  });
});

describe("PIN on every reveal", () => {
  it("the client sends the PIN once in the reveal/recover body and never keeps it", () => {
    expect(src.client).toContain("PinKeypad");
    expect(src.client).toMatch(/pending\.action === "reveal" \? \{ pin \} : \{ pin, mode: pending\.action \}/);
    expect(src.client).not.toMatch(/useState<string>\(""\)\s*;?\s*\/\/\s*pin|const \[pin/);
  });
});

describe("i18n and the switch", () => {
  it("every visible string goes through t() / serverT(): no bare English literals in JSX text", () => {
    for (const source of [src.page, ...clientFiles]) {
      // JSX text nodes between tags that start with a letter and are not an expression.
      const bare = [...source.matchAll(/>\s*([A-Za-z][A-Za-z ,.'!?-]{3,})\s*</g)].map((m) => m[1]!).filter((s) => !/^(null|undefined)$/.test(s));
      expect(bare, source.slice(0, 60)).toEqual([]);
    }
  });
  it("the nav chip exists only behind the switch, for every level that can sign in", () => {
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(navDestinationsFor(level).some((d) => d.href === "/vault"), `level ${level} off`).toBe(false);
      expect(navDestinationsFor(level, { vault: false }).some((d) => d.href === "/vault")).toBe(false);
      expect(navDestinationsFor(level, { vault: true }).find((d) => d.href === "/vault")).toMatchObject({ key: "nav.vault", scoped: false });
    }
    expect(readFileSync("components/DashboardNav.tsx", "utf8")).toContain("navDestinationsFor(actorLevel, { vault: vaultEnabled() })");
    expect(src.page).toContain('if (!vaultEnabled()) redirect("/dashboard");');
  });
});
