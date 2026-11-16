/**
 * W23/B210 review r2 (BC-032/BC-042): the sign-out failure page renders with the database DOWN.
 * The logout route keeps the cookie and sends the browser here when it could not end the session;
 * the page reads no session and no account, so the customer always sees that they are still signed
 * in and gets the Sign out retry (a form POST that carries the kept cookie).
 */
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const down = vi.hoisted(() => vi.fn(() => { throw new Error("database unavailable"); }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: down }));
vi.mock("@/lib/portal/session", () => ({ getCustomerFromHeaders: down, getCustomerSession: down }));
vi.mock("@/lib/portal/account", () => ({ loadCustomerAccount: down }));

import Page from "@/app/order/sign-out-failed/page";
import en from "@/lib/i18n/en.json";

it("shows the failure and the Sign out retry without any session or database read", async () => {
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('role="alert"');
  expect(html).toContain(String((en as Record<string, string>)["order.portal.sign_out_failed"]).replace(/'/g, "&#x27;"));
  const form = html.match(/<form[^>]*>/)?.[0] ?? "";
  expect(form).toContain('method="post"');
  expect(form).toContain('action="/api/portal/logout"');
  expect(html).toContain('href="/order/account"');
  expect(down).not.toHaveBeenCalled();
});
