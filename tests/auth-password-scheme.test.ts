/**
 * Password hashing scheme — the bcrypt 72-byte cap and the peppered-bcrypt
 * truncation bug (found live by Juan, 2026-09-01: "I can sign in with multiple
 * passwords").
 *
 * ROOT CAUSE. The legacy scheme was `bcrypt(PEPPER + password)`. The production
 * pepper is 64 bytes (scripts/generate-secrets.ps1 emits 64-hex-char secrets) and
 * bcrypt silently ignores every input byte past 72 — so only the first
 * 72 − 64 = 8 bytes of the PASSWORD ever reached the hash. Any password sharing a
 * user's first 8 characters verified. The vitest pepper is 20 bytes, which is
 * exactly why tests/auth-primitives.test.ts never saw it: 20 + password never
 * crossed 72. These tests set a REAL-LENGTH pepper.
 *
 * THE FIX. New scheme `hmac2$` + bcrypt(hex(HMAC-SHA256(pepper, password))):
 * the pre-hash is a constant 64 bytes (< 72) and depends on EVERY password byte,
 * so the pepper can no longer eat the password's share of bcrypt's budget.
 * Legacy hashes (bare `$2a$…`) must KEEP verifying — rehash-on-login (the hybrid
 * migration Juan chose) depends on being able to verify the old hash once more.
 *
 * PINs are deliberately NOT migrated: 64 + 4 = 68 < 72, every digit already counts.
 */
import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword, isLegacyPasswordHash, PASSWORD_HASH_PREFIX } from "@/lib/auth";
import { shouldUpgradePasswordHash } from "@/lib/auth-flows";
import { NON_DESTRUCTIVE_ACTIONS } from "@/lib/audit-actions";

/** Same LENGTH as the production pepper (64 hex chars). Not a real secret. */
const REAL_LENGTH_PEPPER = "0123456789abcdef".repeat(4);

async function withPepper<T>(pepper: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.AUTH_PASSWORD_PEPPER;
  process.env.AUTH_PASSWORD_PEPPER = pepper;
  try {
    return await fn();
  } finally {
    process.env.AUTH_PASSWORD_PEPPER = prev;
  }
}

describe("password scheme v2 — immune to bcrypt's 72-byte input cap", () => {
  it("with a 64-byte pepper, a password that matches only the first 8 chars is REJECTED (the live bug)", async () => {
    await withPepper(REAL_LENGTH_PEPPER, async () => {
      const h = await hashPassword("CorrectHorse!!!");
      expect(await verifyPassword("CorrectHorse!!!", h)).toBe(true);
      // Under the legacy scheme both of these verified: same first 8 bytes, rest truncated away.
      expect(await verifyPassword("CorrectHZZZZZZZ", h)).toBe(false);
      expect(await verifyPassword("CorrectHorse!!!X", h)).toBe(false); // an appended char must matter
    });
  }, 30_000);

  it("every byte of a long (>72-byte) password matters", async () => {
    await withPepper(REAL_LENGTH_PEPPER, async () => {
      const base = "p".repeat(80);
      const h = await hashPassword(base);
      expect(await verifyPassword(base, h)).toBe(true);
      expect(await verifyPassword(base.slice(0, -1) + "q", h)).toBe(false); // byte 80 differs
    });
  }, 30_000);

  it("new hashes carry the scheme tag and isLegacyPasswordHash discriminates them from bare bcrypt", async () => {
    const h = await hashPassword("anything");
    expect(h.startsWith(PASSWORD_HASH_PREFIX)).toBe(true);
    expect(isLegacyPasswordHash(h)).toBe(false);
    const legacy = await bcrypt.hash(process.env.AUTH_PASSWORD_PEPPER + "anything", 4);
    expect(legacy.startsWith("$2")).toBe(true);
    expect(isLegacyPasswordHash(legacy)).toBe(true);
    expect(isLegacyPasswordHash(null)).toBe(false); // no hash = nothing to migrate
  }, 30_000);

  it("a LEGACY hash still verifies (rehash-on-login needs one more successful legacy verify)", async () => {
    const legacy = await bcrypt.hash(process.env.AUTH_PASSWORD_PEPPER + "old-password", 4);
    expect(await verifyPassword("old-password", legacy)).toBe(true);
    expect(await verifyPassword("other-password", legacy)).toBe(false);
  }, 30_000);

  it("rehash-on-login upgrades ONLY a legacy hash, and ONLY after a successful verify", async () => {
    const legacy = await bcrypt.hash(process.env.AUTH_PASSWORD_PEPPER + "pw", 4);
    const v2 = await hashPassword("pw");
    expect(shouldUpgradePasswordHash(legacy, true)).toBe(true);
    expect(shouldUpgradePasswordHash(v2, true)).toBe(false); // already migrated
    expect(shouldUpgradePasswordHash(legacy, false)).toBe(false); // a failed login never rewrites a credential
    expect(shouldUpgradePasswordHash(null, true)).toBe(false); // nothing stored, nothing to migrate
  }, 30_000);

  it("the upgrade is audited under a registered, non-destructive action (closed vocabulary)", () => {
    // A hash upgrade is a system act on a security-relevant field: audited, never "destructive"
    // (no human altered config or the accountability record).
    expect((NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes("auth_password_hash_upgraded")).toBe(true);
  });

  it("a v2 hash never verifies through the legacy path and vice versa (no cross-scheme acceptance)", async () => {
    const v2 = await hashPassword("pw");
    // Strip the tag and feed the bare bcrypt to the legacy comparison: must fail — the
    // legacy input (PEPPER+"pw") is not what v2 hashed (hex HMAC digest).
    const bare = v2.slice(PASSWORD_HASH_PREFIX.length);
    expect(await bcrypt.compare(process.env.AUTH_PASSWORD_PEPPER + "pw", bare)).toBe(false);
  }, 30_000);
});
