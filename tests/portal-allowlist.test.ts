// Magic-link delivery allowlist semantics (lib/portal/magic-link-shared.ts).
// The load-bearing cases: unset must stay Juan-only (pre-verification posture, byte-
// identical to the inline spelling this replaced), "*" must open delivery (the go-live
// flip), and "" must close it entirely (kill switch — `??` not `||`).
import { describe, expect, it } from "vitest";
import { allowlistMatches, DEFAULT_MAGIC_LINK_ALLOWLIST } from "@/lib/portal/magic-link-shared";

describe("allowlistMatches", () => {
  it("unset env → only the historical default address, case-insensitively", () => {
    expect(allowlistMatches(undefined, DEFAULT_MAGIC_LINK_ALLOWLIST)).toBe(true);
    expect(allowlistMatches(undefined, "Juan@ComplimentsOnlySubs.com")).toBe(true);
    expect(allowlistMatches(undefined, "customer@example.com")).toBe(false);
  });

  it('"*" opens delivery to any requester', () => {
    expect(allowlistMatches("*", "customer@example.com")).toBe(true);
    expect(allowlistMatches(" * ", "anyone@anywhere.org")).toBe(true);
  });

  it('a literal "*" only opens when it is the WHOLE value, not a list entry', () => {
    // "a@x.com,*" is a malformed config, not a wildcard — exact-match keeps it closed
    // for non-listed addresses rather than silently opening the world.
    expect(allowlistMatches("a@x.com,*", "customer@example.com")).toBe(false);
    expect(allowlistMatches("a@x.com,*", "a@x.com")).toBe(true);
  });

  it("comma list matches exactly, trimmed and case-insensitive", () => {
    const raw = " keith@complimentsonlysubs.com , Pete@ComplimentsOnlySubs.com ";
    expect(allowlistMatches(raw, "keith@complimentsonlysubs.com")).toBe(true);
    expect(allowlistMatches(raw, "pete@complimentsonlysubs.com")).toBe(true);
    expect(allowlistMatches(raw, "juan@complimentsonlysubs.com")).toBe(false);
  });

  it('empty string ("") closes delivery entirely — distinct from unset', () => {
    expect(allowlistMatches("", DEFAULT_MAGIC_LINK_ALLOWLIST)).toBe(false);
    expect(allowlistMatches("", "customer@example.com")).toBe(false);
  });
});
