/**
 * LRA-210 — the /order/review payment copy must describe what ACTUALLY happens next.
 *
 * ── WHAT THIS TEST USED TO PIN, AND WHY IT CHANGED ───────────────────────────────────
 * The original defect was a page that said "securely via Stripe" over a pay route that
 * returned a stub. The first fix was BLUNT because it had to be: the word "Stripe" was
 * banned from the page and the route/lib were pinned to their stub shapes, because at that
 * moment no provider existed and any payment promise was false.
 *
 * A provider now exists, and it is DORMANT PER SHOP. So the invariant is no longer "never
 * mention a provider" — that would forbid telling the truth once the truth changed — it is
 * the thing the original was reaching for:
 *
 *   THE COPY IS A FUNCTION OF WHETHER THIS SHOP CAN ACTUALLY TAKE A CARD.
 *
 * Both branches are pinned here, in both languages, along with the plumbing that makes the
 * branch a SERVER fact (`paymentsOnline`, resolved from credentials in
 * lib/stripe/client.ts and delivered beside the draft) rather than a client guess. A page
 * that hardcoded either branch, or that derived it from anything the browser controls,
 * fails this file.
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const page = readFileSync("app/order/review/page.tsx", "utf8");
const route = readFileSync("app/api/portal/quote/[id]/pay/route.ts", "utf8");
const library = readFileSync("lib/portal/quotes.ts", "utf8");
const draftRoute = readFileSync("app/api/portal/order/draft/[quoteId]/route.ts", "utf8");

it("LRA-210: the review page makes NO payment promise of its own — every payment sentence branches on paymentsOnline", () => {
  // The flag exists, comes from the server, and starts false (the honest dormant reading).
  expect(draftRoute).toContain("paymentsOnlineForLocation(draft.locationId)");
  expect(page).toContain("useState(false)");
  expect(page).toContain("setPaymentsOnline(json.paymentsOnline === true)");

  // Every payment-mechanics string on the page is a ternary on that flag — never a literal.
  for (const pair of [
    ['"order.review.pay_online"', '"order.review.no_online_payment"'],
    ['"order.review.deposit_pay"', '"order.review.deposit_record"'],
    ['"order.review.deposit_due"', '"order.review.deposit_label"'],
    ['"order.review.submit_pay"', '"order.review.submit"'],
  ]) {
    expect(page, pair.join(" / ")).toContain(`paymentsOnline ? ${pair[0]} : ${pair[1]}`);
  }

  // No provider name is RENDERED from the component — it lives in the dictionaries, on the
  // branch that is only shown when a provider is genuinely wired. Comments may name it;
  // copy may not, which is why the check runs over the code with comments stripped.
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  expect(code).not.toMatch(/Stripe/);
});

it("LRA-210: the DORMANT branch still says no money is taken online", () => {
  expect(en["order.review.no_online_payment"]).toContain("No money is taken online");
  expect(es["order.review.no_online_payment"]).toContain("No se cobra dinero en línea");
});

it("LRA-210: the CONFIGURED branch names the provider and promises nothing we do not do", () => {
  // We never see the card: hosted Checkout means the details go to Stripe, not to us.
  expect(en["order.review.pay_online"]).toMatch(/Stripe/);
  expect(en["order.review.pay_online"]).toMatch(/never see or store/i);
  expect(es["order.review.pay_online"]).toMatch(/Stripe/);
});

it("the pay route still records the intent first, and only then offers a checkout", () => {
  expect(route).toContain("await initiatePayment(session.customerId, id, kind)");
  // Dormant answer: unchanged stub shape.
  expect(route).toContain("if (result.stub)");
  expect(route).toContain("stub: true, message: STUB_MESSAGE");
  // Configured answer: a URL and nothing else.
  expect(route).toContain("createQuoteCheckout(");
  expect(route).toContain("stub: false, url: checkout.url");
  // The intent is guaranteed by the library, whatever the provider does afterwards.
  expect(library).toContain("return { ok: true, paymentId, amountCents, stub };");
  expect(library).toContain('const stub = stripeCredentialsFor(code) === null;');
});

it("every order.* key ships in BOTH dictionaries", () => {
  for (const key of Object.keys(en).filter((key) => key.startsWith("order."))) {
    expect(es, key).toHaveProperty(key);
  }
});
