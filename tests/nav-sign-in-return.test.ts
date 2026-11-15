/**
 * The W06-2 HYBRID return rule (owner decision): after a sign-out, the SAME person signing back in returns to the page
 * they were on; a DIFFERENT person goes to the dashboard / hub.
 */
import { describe, expect, it } from "vitest";
import { returnPathAfterSignIn, signInHref } from "@/lib/nav-sign-in-return";

describe("signInHref", () => {
  it("binds the return link to its user", () => {
    expect(signInHref({ next: "/catering/inbox/abc?tab=2", forUser: "u1" })).toBe("/?next=%2Fcatering%2Finbox%2Fabc%3Ftab%3D2&for=u1");
  });
  it("carries the idle reason", () => {
    expect(signInHref({ reason: "idle", next: "/operations/counts", forUser: "u1" })).toBe("/?reason=idle&next=%2Foperations%2Fcounts&for=u1");
    expect(signInHref({ reason: "idle" })).toBe("/?reason=idle");
  });
  it("drops an unowned return link unless the caller keeps it on purpose", () => {
    expect(signInHref({ next: "/admin/vendors/v1" })).toBe("/");
    expect(signInHref({ next: "/admin/vendors/v1", keepUnownedNext: true })).toBe("/?next=%2Fadmin%2Fvendors%2Fv1");
  });
  it("never builds a protocol-relative return link", () => {
    expect(signInHref({ next: "//evil.com", forUser: "u1" })).toBe("/");
    expect(signInHref({ next: "https://evil.com", forUser: "u1" })).toBe("/");
  });
});

describe("returnPathAfterSignIn", () => {
  it("the same person returns to their page", () => {
    expect(returnPathAfterSignIn({ next: "/catering/inbox/abc", forUser: "u1", signedInUserId: "u1" })).toBe("/catering/inbox/abc");
  });
  it("a different person goes to the dashboard", () => {
    expect(returnPathAfterSignIn({ next: "/catering/inbox/abc", forUser: "u1", signedInUserId: "u2" })).toBe("/dashboard");
    expect(returnPathAfterSignIn({ next: "/catering/inbox/abc", forUser: "u1", signedInUserId: null })).toBe("/dashboard");
  });
  it("an unowned link (opened while signed out) keeps its old meaning", () => {
    expect(returnPathAfterSignIn({ next: "/catering/inbox/abc", forUser: null, signedInUserId: "u2" })).toBe("/catering/inbox/abc");
  });
  it("the next value is still sanitized", () => {
    expect(returnPathAfterSignIn({ next: "//evil.com", forUser: "u1", signedInUserId: "u1" })).toBe("/dashboard");
    expect(returnPathAfterSignIn({ next: null, forUser: null, signedInUserId: "u1" })).toBe("/dashboard");
  });
});
