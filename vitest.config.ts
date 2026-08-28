/**
 * Vitest — unit-test spine (2026-07-23, from the round-table review's #1 finding).
 *
 * Scope: PURE domain modules only (pricing, charge stack, geo, auth primitives,
 * roles). No DB, no Next runtime — the DB-coupled integration layer stays on the
 * existing script harnesses (scripts/phase-2-audit-harness.ts et al.), which need
 * live Supabase and are run manually.
 *
 * ── ONE NARROW AMENDMENT (Dynamic Pars, LEAD RULING F7) ───────────────────────
 * `server-only` is aliased to its own no-op `empty.js` so a test may IMPORT a
 * server module in order to exercise the pure GUARDS at its front door — the role
 * floor and the location bind, which are decisions, not I/O. Without the alias the
 * package throws at import and those guards are untestable, which is how a missing
 * IDOR check survives review.
 *
 * THE SCOPE ABOVE STILL HOLDS, AND IT ENFORCES ITSELF. Nothing here supplies
 * Supabase env, so the instant a test reaches `getServiceRoleClient()` it fails
 * loudly on a missing variable. A test can therefore prove "this call was refused
 * BEFORE any database work" — but it cannot accidentally become an integration
 * test, because there is no database to integrate with.
 *
 * Auth-primitive tests need the three auth env vars; test-only values are set
 * here so `npm test` runs anywhere (CI included) with zero secrets. These are
 * NOT real secrets — never copy them to a real .env.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // See the header: lets a test reach a server module's pure front-door guards.
      // The package ships this exact file for the react-server condition.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
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
