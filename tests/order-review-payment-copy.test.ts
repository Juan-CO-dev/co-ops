import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

it("LRA-210: review makes no provider/payment promise while the pay route returns its library's stub", () => {
  const page = readFileSync("app/order/review/page.tsx", "utf8");
  const route = readFileSync("app/api/portal/quote/[id]/pay/route.ts", "utf8");
  const library = readFileSync("lib/portal/quotes.ts", "utf8");
  expect(page).not.toMatch(/Stripe|Pay deposit & lock|We never see or store your card/);
  expect(route).toContain("await initiatePayment(session.customerId, id, kind)");
  expect(route).toContain("{ ...result, message: STUB_MESSAGE }");
  expect(library).toContain("return { ok: true, stub: true }");
  expect(page).toContain('t("order.review.no_online_payment")');
  expect(en["order.review.no_online_payment"]).toContain("No money is taken online");
  expect(es["order.review.no_online_payment"]).toContain("No se cobra dinero en línea");
  for (const key of Object.keys(en).filter((key) => key.startsWith("order.review."))) {
    expect(es).toHaveProperty(key);
  }
});
