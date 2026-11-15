// Audit W01/B004: a customer's self-serve order ('submitted') must offer staff Accept / Decline —
// it had only Revise + Labels, so portal orders stuck with the deposit paid and no way forward.
import { describe, expect, it } from "vitest";
import { quoteDetailActions } from "@/components/catering/quotes/shared";

describe("quoteDetailActions", () => {
  it("a submitted (portal) quote is decidable by a writer", () => {
    expect(quoteDetailActions({ status: "submitted", isExpired: false }, true)).toEqual({ sendable: false, decidable: true });
  });
  it("a sent quote keeps send + decide; a draft keeps send only", () => {
    expect(quoteDetailActions({ status: "sent", isExpired: false }, true)).toEqual({ sendable: true, decidable: true });
    expect(quoteDetailActions({ status: "draft", isExpired: false }, true)).toEqual({ sendable: true, decidable: false });
  });
  it("expired, decided, or read-only quotes offer neither", () => {
    expect(quoteDetailActions({ status: "sent", isExpired: true }, true)).toEqual({ sendable: false, decidable: false });
    for (const status of ["accepted", "declined", "expired"]) expect(quoteDetailActions({ status, isExpired: false }, true)).toEqual({ sendable: false, decidable: false });
    expect(quoteDetailActions({ status: "submitted", isExpired: false }, false)).toEqual({ sendable: false, decidable: false });
  });
});
