/**
 * Vitest — unit-test spine (2026-07-23, from the round-table review's #1 finding).
 *
 * Scope: PURE domain modules only (pricing, charge stack, geo, auth primitives,
 * roles). No DB, no Next runtime — the DB-coupled integration layer stays on the
 * existing script harnesses (scripts/phase-2-audit-harness.ts et al.), which need
 * live Supabase and are run manually.
 *
 * Auth-primitive tests need the three auth env vars; test-only values are set
 * here so `npm test` runs anywhere (CI included) with zero secrets. These are
 * NOT real secrets — never copy them to a real .env.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // 64-char hex → 32-byte HS256 key, matching lib/auth.ts's hex interpretation.
      AUTH_JWT_SECRET:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      AUTH_PIN_PEPPER: "test-pin-pepper",
      AUTH_PASSWORD_PEPPER: "test-password-pepper",
    },
    testTimeout: 30_000, // bcrypt cost-12 hashes are deliberately slow
  },
});
