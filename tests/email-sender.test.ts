// Sender-split semantics (2026-09-01): teamFrom() is the staff/internal sender override.
// The load-bearing promise is the FALLBACK — unset (or blank) EMAIL_FROM_TEAM must return
// undefined, because sendEmail spells `from: input.from ?? getFrom()` and undefined is what
// keeps every staff send on EMAIL_FROM exactly as before the split.
import { afterEach, describe, expect, it, vi } from "vitest";
import { teamFrom } from "@/lib/email";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("teamFrom", () => {
  it("returns undefined when EMAIL_FROM_TEAM is unset (fallback to EMAIL_FROM)", () => {
    vi.stubEnv("EMAIL_FROM_TEAM", "");
    expect(teamFrom()).toBeUndefined();
  });

  it("returns undefined when EMAIL_FROM_TEAM is whitespace-only", () => {
    vi.stubEnv("EMAIL_FROM_TEAM", "   ");
    expect(teamFrom()).toBeUndefined();
  });

  it("returns the trimmed sender when EMAIL_FROM_TEAM is set", () => {
    vi.stubEnv("EMAIL_FROM_TEAM", " CO Team <team@complimentsonlyoperations.com> ");
    expect(teamFrom()).toBe("CO Team <team@complimentsonlyoperations.com>");
  });
});
