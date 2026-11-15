/**
 * Audit W06/B012 fix round 7 (review W06-r7 P2 #1) — EVERY sign-out names the session the page was served for.
 *
 * The dashboard and opening-page <LogoutButton /> used to send no session id and rely on a 503 body naming one. When the
 * first request failed some other way (a network error, a timeout, a 504) nothing was named, someone signed in through
 * another tab during the backoff, and the unnamed retry revoked that NEW session (the route ends whatever session the
 * cookie carries when none is named). Now requestSignOut takes a required session id and every caller passes the served
 * one, so every attempt and every retry names it and the route answers `session_superseded` to a retry that finds a
 * different session on the cookie (the route half, end to end, is in tests/logout-revoke-only.test.ts).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { requestSignOut } from "@/lib/logout-client";

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
const SOURCES = [...files("app"), ...files("components")].map((path) => ({
  path: relative(ROOT, join(ROOT, path)).replace(/\\/g, "/"),
  text: readFileSync(join(ROOT, path), "utf8"),
}));

describe("round 7 — every sign-out caller names its session", () => {
  it("every <LogoutButton> is given the served session id (dashboard and opening page included)", () => {
    const uses = SOURCES.flatMap(({ path, text }) => [...text.matchAll(/<LogoutButton\b[^>]*>/g)].map((m) => ({ path, tag: m[0] })));
    expect(uses.map((u) => u.path).sort()).toEqual(
      expect.arrayContaining(["app/(authed)/dashboard/page.tsx", "app/(authed)/operations/opening/page.tsx"]),
    );
    for (const use of uses) expect(use, use.path).toMatchObject({ tag: expect.stringMatching(/sessionId=\{[^}]+\}/) });
  });

  it("every sign-out call passes a session id and a kind (there is no unnamed sign-out)", () => {
    // Round 9: the surfaces call the shared signOutAndBroadcast(sessionId, kind), which wraps requestSignOut.
    const calls = SOURCES.flatMap(({ path, text }) =>
      [...text.matchAll(/signOutAndBroadcast\(([^)]*)\)/g)].map((m) => ({ path, args: m[1]!.split(",").map((a) => a.trim()) })),
    );
    expect(calls.length).toBeGreaterThanOrEqual(4); // LogoutButton, UserMenu, the idle sign-out, Log out now
    expect(calls.map((c) => c.path)).toEqual(
      expect.arrayContaining(["components/auth/LogoutButton.tsx", "components/UserMenu.tsx", "components/auth/IdleTimeoutWarning.tsx"]),
    );
    for (const call of calls) {
      expect(call.args, call.path).toHaveLength(2);
      expect(call.args[0], call.path).toMatch(/\S/);
      expect(call.args[1], call.path).toMatch(/^"(idle|logout)"$/);
    }
  });

  it("round 9: no surface calls requestSignOut directly — every sign-out tells the other tabs", () => {
    const direct = SOURCES.filter(({ text }) => /requestSignOut\(/.test(text)).map(({ path }) => path);
    expect(direct).toEqual([]);
  });

  it("the session id is required by the type (tsc --noEmit is the gate for this one)", () => {
    // Never run: this only has to fail to typecheck when the id is left out.
    const typeOnly = () => {
      // @ts-expect-error — requestSignOut has no unnamed form.
      void requestSignOut();
    };
    expect(typeof typeOnly).toBe("function");
  });
});
