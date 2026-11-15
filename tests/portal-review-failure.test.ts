// Audit W01/B034: /order/review hung on "Loading your order…" when the preview call failed (e.g. Back
// after submit → 409 not_draft; a removed zone/item; an expired session). Every failure now resolves.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewFailure } from "@/lib/portal/draft-shared";

describe("reviewFailure", () => {
  it("an already-submitted order goes to its quote page", () => {
    expect(reviewFailure(409, "not_draft", false)).toBe("go_to_quote");
    expect(reviewFailure(409, "not_draft", true)).toBe("go_to_quote");
  });
  it("a changed cart sends the customer back to it; an expired session offers sign-in", () => {
    expect(reviewFailure(409, "cart_changed", false)).toBe("cart_changed");
    expect(reviewFailure(401, "unauthorized", true)).toBe("session_expired");
  });
  it("anything else (500, network = null) is a visible error — never an endless spinner — unless a breakdown is already shown", () => {
    expect(reviewFailure(500, null, false)).toBe("error");
    expect(reviewFailure(null, null, false)).toBe("error");
    expect(reviewFailure(400, "invalid_tip", false)).toBe("error");
    expect(reviewFailure(500, null, true)).toBe("keep");
  });
});

describe("the review page wires every failure", () => {
  const page = readFileSync("app/order/review/page.tsx", "utf8");
  it("the preview no longer returns silently on !res.ok, and a submitted draft redirects before preview", () => {
    expect(page).not.toContain("if (!res.ok) return; // keep showing prior stack");
    expect(page).toContain("reviewFailure(");
    expect(page).toMatch(/json\.draft\.status !== "draft"[\s\S]*?router\.replace\(`\/order\/quote\/\$\{/);
    expect(page).toContain('t("order.review.retry")');
    expect(page).toContain('"order.review.cart_changed"');
    expect(page).toContain('"order.review.session_expired"');
  });
});
