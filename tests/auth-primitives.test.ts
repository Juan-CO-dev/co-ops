/**
 * Unit spine — lib/auth.ts stateless primitives (pure crypto + JWT; no DB).
 * Pins: pepper-dependence of hashes, JWT round-trip + tamper/expiry discrimination,
 * hex-secret interpretation, token generation/hashing.
 *
 * Env comes from vitest.config.ts test values (NOT real secrets). bcrypt cost 12
 * is deliberately slow (~1s/hash) — hash count here is kept minimal.
 */
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  hashPin,
  verifyPin,
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  isJwtExpired,
  generateToken,
  hashToken,
  type AppJwtClaims,
} from "@/lib/auth";

const CLAIMS: AppJwtClaims = {
  user_id: "00000000-0000-0000-0000-000000000001",
  app_role: "gm",
  role_level: 7,
  locations: ["loc-mep", "loc-em"],
  session_id: "11111111-1111-1111-1111-111111111111",
  role: "authenticated",
};

describe("PIN + password primitives (bcrypt cost 12, peppered)", () => {
  it("pin round-trips; wrong pin fails; pin hash never verifies as password", async () => {
    const hash = await hashPin("4271");
    expect(await verifyPin("4271", hash)).toBe(true);
    expect(await verifyPin("4272", hash)).toBe(false);
    // Different pepper namespace: the same literal through the password path must fail.
    expect(await verifyPassword("4271", hash)).toBe(false);
  }, 30_000);

  it("password round-trips and produces salted (non-deterministic) hashes", async () => {
    const h1 = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h1)).toBe(true);
    expect(await verifyPassword("wrong horse", h1)).toBe(false);
    const h2 = await hashPassword("correct horse battery");
    expect(h2).not.toBe(h1); // bcrypt salts
  }, 30_000);
});

describe("JWT sign/verify (HS256, hex-interpreted secret, issuer co-ops)", () => {
  it("round-trips all app claims and stamps iat/exp/iss", async () => {
    const token = await signJwt(CLAIMS);
    const verified = await verifyJwt(token);
    expect(verified.user_id).toBe(CLAIMS.user_id);
    expect(verified.app_role).toBe("gm");
    expect(verified.role_level).toBe(CLAIMS.role_level);
    expect(verified.locations).toEqual(CLAIMS.locations);
    expect(verified.session_id).toBe(CLAIMS.session_id);
    expect(verified.role).toBe("authenticated"); // PostgREST DB-role claim
    expect(verified.iss).toBe("co-ops");
    expect(verified.exp - verified.iat).toBe(12 * 3600); // 12h hard ceiling
  });

  it("rejects tampered tokens, and isJwtExpired() is false for tamper rejections", async () => {
    const token = await signJwt(CLAIMS);
    const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
    let err: unknown;
    try {
      await verifyJwt(tampered);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(isJwtExpired(err)).toBe(false);
  });

  it("rejects expired tokens, and isJwtExpired() discriminates them", async () => {
    // Sign an already-expired token with the SAME key/issuer/alg as lib/auth.ts.
    const key = Buffer.from(process.env.AUTH_JWT_SECRET!, "hex");
    const expired = await new SignJWT({ ...CLAIMS })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("co-ops")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);
    let err: unknown;
    try {
      await verifyJwt(expired);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(isJwtExpired(err)).toBe(true);
  });

  it("rejects tokens signed with a different secret", async () => {
    const otherKey = Buffer.from("bb".repeat(32), "hex");
    const forged = await new SignJWT({ ...CLAIMS })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("co-ops")
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(otherKey);
    await expect(verifyJwt(forged)).rejects.toThrow();
  });
});

describe("random tokens", () => {
  it("generateToken: 64-char lowercase hex, unique across calls", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t2).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it("hashToken: SHA-256 known vector, lowercase hex", async () => {
    // sha256("abc")
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
