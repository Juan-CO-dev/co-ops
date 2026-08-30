/**
 * Unit spine — the auth / step-up cluster's three "a security write must not be
 * swallowed, and must not crash" guarantees (wiring audit 2026-08-29).
 *
 * All three are properties of I/O code, so two of them are asserted AT THE SOURCE,
 * the house fallback for a guarantee no unit test over the module's exports can
 * see (tests/loader-scale-ceilings.test.ts, tests/dynamic-pars-write.test.ts):
 *
 *   · the LOCKOUT WRITE is load-bearing — `locked_until` is rowcount-checked and
 *     retried, and the audit row says whether it actually landed. The bug: the
 *     UPDATE's error was console.error'd, then the flow wrote an
 *     auth_account_locked row and returned {locked:true} anyway, so the route
 *     answered 423 over a `locked_until` that was still null.
 *   · the STEP-UP AUTO-CLEAR is housekeeping and can never fail a valid session —
 *     clearStepUp() throws, and unguarded that throw 500s an already-verified
 *     session on a transient blip.
 *   · the TIER an admin surface REQUESTS is the tier its route ENFORCES. That one
 *     is half behavioural (assertStepUp is pure: Tier A and Tier B disagree the
 *     moment an unlock ages past the freshness window — the bug's precondition)
 *     and half source-level (client and server tiers must agree per action, which
 *     is a fact about two files at once).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { assertStepUp, stepUpFreshWindowMs } from "@/lib/admin/step-up";
import type { AuthContext } from "@/lib/session";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");

/** assertStepUp reads exactly two fields; the rest of AuthContext is irrelevant here. */
function ctxUnlockedAt(unlockedAt: string | null, unlocked = true): AuthContext {
  return {
    session: { stepUpUnlocked: unlocked, stepUpUnlockedAt: unlockedAt },
  } as unknown as AuthContext;
}

describe("Tier A and Tier B are not interchangeable — the mismatch's precondition", () => {
  const NOW = Date.parse("2026-08-29T10:00:00.000Z");
  const fresh = new Date(NOW - 30_000).toISOString(); // 30s old
  const stale = new Date(NOW - 10 * 60_000).toISOString(); // 10 min old

  it("an AGED unlock still satisfies Tier A and no longer satisfies Tier B", () => {
    // This asymmetry is the whole bug: a client asking for Tier A resolves "ok"
    // with NO password prompt, and the Tier-B route it then calls returns 403.
    expect(assertStepUp(ctxUnlockedAt(stale), "A", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctxUnlockedAt(stale), "B", NOW)).toEqual({
      ok: false,
      code: "step_up_stale",
    });
  });

  it("a FRESH unlock satisfies both tiers", () => {
    expect(assertStepUp(ctxUnlockedAt(fresh), "A", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctxUnlockedAt(fresh), "B", NOW)).toEqual({ ok: true });
  });

  it("a locked session fails both tiers with step_up_required, not stale", () => {
    expect(assertStepUp(ctxUnlockedAt(null, false), "A", NOW)).toEqual({
      ok: false,
      code: "step_up_required",
    });
    expect(assertStepUp(ctxUnlockedAt(fresh, false), "B", NOW)).toEqual({
      ok: false,
      code: "step_up_required",
    });
  });

  it("the freshness window is 120s by default — the width of the mismatch window", () => {
    expect(stepUpFreshWindowMs()).toBe(120_000);
  });
});

describe("the user-admin surface asks for the tier its routes enforce", () => {
  /** Every assertStepUp tier under app/api/admin/users, route file → tier. */
  const routeTiers = (): Array<[string, string]> => {
    const dir = join(ROOT, "app", "api", "admin", "users");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith("route.ts"))
      .sort();
    const out: Array<[string, string]> = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/assertStepUp\(\s*ctx\s*,\s*"([AB])"/g)) {
        out.push([f, m[1] as string]);
      }
    }
    return out;
  };

  it("every user-admin mutation route enforces Tier B (WB2-01)", () => {
    const tiers = routeTiers();
    // If this list ever shrinks to zero the assertion below would pass vacuously.
    expect(tiers.length).toBeGreaterThanOrEqual(8);
    expect(tiers.filter(([, tier]) => tier !== "B")).toEqual([]);
  });

  it("CreateUserForm requests the same tier the create route enforces", () => {
    const src = read("components/admin/users/CreateUserForm.tsx");
    expect(src).toContain('requestStepUp("B")');
    expect(src).not.toContain('requestStepUp("A")');
  });

  it("every UserActions action — edit_profile included — requests Tier B", () => {
    const src = read("components/admin/users/UserActions.tsx");
    const tiers = [...src.matchAll(/\brun\(\s*"([AB])"/g)].map((m) => m[1]);
    expect(tiers.length).toBeGreaterThanOrEqual(7); // one per action branch
    expect(tiers.filter((t) => t !== "B")).toEqual([]);
    expect(src).toContain('a.kind === "edit_profile") void run("B"');
  });
});

describe("the lockout write is load-bearing, and the audit row says so", () => {
  const src = read("lib/auth-flows.ts");

  it("locked_until is rowcount-checked, not fire-and-forget", () => {
    // AGENTS.md: UPDATE denials are silent (UPDATE 0, no error) — check rowcount,
    // never infer success from the absence of an error.
    expect(src).toMatch(
      /\.update\(\{ locked_until: lockedUntilIso \}\)[\s\S]{0,120}\.select\("id"\)/,
    );
    expect(src).toMatch(/\(data\?\.length \?\? 0\) > 0/);
  });

  it("a failed lock write is retried once before the flow gives up", () => {
    expect(src).toMatch(/attempt <= 2/);
  });

  it("auth_account_locked carries whether the lock actually persisted", () => {
    expect(src).toContain("lock_persisted: lockPersisted");
    expect(src).toContain("lock_persist_failed: true");
  });

  it("a broken counter RPC is forensically visible instead of logging attempt 0", () => {
    // counter_error must be reached BEFORE attempt_number in the metadata ternary:
    // an uncounted attempt may never publish a fabricated number.
    expect(src).toMatch(/counterError[\s\S]{0,200}counter_error: true[\s\S]{0,120}attempt_number/);
  });

  it("the lock helper never throws — a failed lock must not also fail the response", () => {
    const helper = /async function persistLockout\(([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
    expect(helper.length).toBeGreaterThan(100); // the body was really found
    expect(helper).not.toContain("throw");
  });
});

describe("the step-up auto-clear can never fail an already-verified session", () => {
  const src = read("lib/session.ts");

  it("requireSessionCore's clearStepUp call is guarded", () => {
    expect(src).toMatch(/try\s*\{[\s\S]{0,200}?await clearStepUp\(row\.id\)[\s\S]{0,200}?\}\s*catch/);
  });

  it("clearStepUp itself still throws — the contract for any load-bearing caller", () => {
    expect(src).toContain("throw new Error(`clearStepUp failed:");
  });
});
