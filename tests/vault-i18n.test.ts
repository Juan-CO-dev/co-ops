/** Password vault translations: en/es parity, matching placeholders, and every key the surfaces use exists. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const english = en as Record<string, string>;
const spanish = es as Record<string, string>;
const PREFIXES = ["vault.", "nav.vault", "notifications.vault_"];
const isVaultKey = (k: string) => PREFIXES.some((p) => k.startsWith(p));
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const SURFACE_DIRS = ["app/(authed)/vault", "components/vault"];
function surfaceSources(): string[] {
  const out: string[] = [];
  for (const dir of SURFACE_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".tsx") || f.endsWith(".ts")) out.push(readFileSync(path.join(dir, f), "utf8"));
  }
  return out;
}
const usedKeys = [...new Set(surfaceSources().flatMap((src) => [...src.matchAll(/\b(?:t|serverT\([^,]+,)\s*\(?\s*"((?:vault|nav)\.[^"]+)"/g)].map((m) => m[1]!)))];
const libSource = existsSync("lib/vault.ts") ? readFileSync("lib/vault.ts", "utf8") : "";
const libKeys = [...new Set([...libSource.matchAll(/"(notifications\.vault_[a-z_.]+)"/g)].map((m) => m[1]!))];

describe("vault translations", () => {
  const enKeys = Object.keys(english).filter(isVaultKey).sort();
  const esKeys = Object.keys(spanish).filter(isVaultKey).sort();
  it("ship en + es in parity (same keys)", () => {
    expect(enKeys.length).toBeGreaterThan(60);
    expect(enKeys).toEqual(esKeys);
  });
  it.each(enKeys)("%s has a Spanish value with the same placeholders", (key) => {
    expect(english[key]).toBeTruthy();
    expect(spanish[key]).toBeTruthy();
    expect(placeholders(spanish[key]!)).toEqual(placeholders(english[key]!));
  });
  it("covers the notification types the lib emits and every floor/type label", () => {
    for (const k of ["notifications.vault_reveal.title", "notifications.vault_reveal.body", "notifications.vault_entry_change.title.create",
      "notifications.vault_entry_change.title.update", "notifications.vault_entry_change.title.deactivate", "notifications.vault_recovery.title.owner",
      "notifications.vault_recovery.title.previous", "notifications.vault_burst.title", "notifications.vault_alert.title", "nav.vault",
      "vault.reveal.recorded_banner", "vault.reveal.personal_banner", "vault.error.reveal_cap", "vault.error.vault_unavailable"]) {
      expect(english[k], k).toBeTruthy();
    }
    for (const floor of [4, 5, 6, 7, 8, 9]) expect(english[`vault.floor.${floor}`]).toBeTruthy();
    for (const type of ["login", "code", "ai_key"]) expect(english[`vault.type.${type}`]).toBeTruthy();
  });
  it("every key a vault surface or the lib references exists in both languages", () => {
    const missing = [...usedKeys, ...libKeys].filter((k) => !english[k] || !spanish[k]);
    expect(missing).toEqual([]);
  });
});
