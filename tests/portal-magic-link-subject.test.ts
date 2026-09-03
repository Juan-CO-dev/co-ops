// Magic-link email subject (lib/portal/magic-link-shared.ts magicLinkSubject).
//
// Why this exists: Gmail threads messages with an identical subject from the same sender
// into ONE conversation. Juan's first-live test (2026-09-03) tapped the SIGN IN button of an
// OLDER message in that thread twice in a row — consuming a stale token each time (one with
// no intake → landed on the empty account page; one with the PREVIOUS form's store). Every
// subject must therefore be distinct per request and say what the link is for.
import { describe, expect, it } from "vitest";
import { magicLinkSubject } from "@/lib/portal/magic-link-shared";

const TENANT = "Compliments Only";
// 17:27:15Z on 2026-09-03 = 1:27 PM Eastern (EDT).
const SEPT = new Date("2026-09-03T17:27:15Z");

describe("magicLinkSubject", () => {
  it("an order link says it finishes the order and carries the ET request time", () => {
    expect(magicLinkSubject({ tenantName: TENANT, hasIntake: true, requestedAt: SEPT })).toBe(
      "Finish your Compliments Only order — sign in (1:27 PM ET)",
    );
  });

  it("a plain sign-in link keeps the sign-in wording, also stamped", () => {
    expect(magicLinkSubject({ tenantName: TENANT, hasIntake: false, requestedAt: SEPT })).toBe(
      "Your Compliments Only sign-in link (1:27 PM ET)",
    );
  });

  it("renders Eastern time year-round (EST in January)", () => {
    const jan = new Date("2026-01-15T17:27:00Z"); // 12:27 PM EST
    expect(magicLinkSubject({ tenantName: TENANT, hasIntake: false, requestedAt: jan })).toBe(
      "Your Compliments Only sign-in link (12:27 PM ET)",
    );
  });

  it("two requests a minute apart never share a subject (breaks Gmail threading)", () => {
    const a = magicLinkSubject({ tenantName: TENANT, hasIntake: true, requestedAt: SEPT });
    const b = magicLinkSubject({ tenantName: TENANT, hasIntake: true, requestedAt: new Date(SEPT.getTime() + 60_000) });
    expect(a).not.toBe(b);
  });

  it("uses plain ASCII spaces only (no narrow no-break space from ICU)", () => {
    const s = magicLinkSubject({ tenantName: TENANT, hasIntake: false, requestedAt: SEPT });
    expect(/[  ]/.test(s)).toBe(false);
  });
});
