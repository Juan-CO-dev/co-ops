import type { Page } from "@playwright/test";
import type { DraftLoad } from "../../../../lib/portal/draft";
import type { ChargeStack } from "../../../../lib/catering/quotes";
import { test, expect } from "../playwright.config";
import { SIM_APP_ORIGIN } from "../../../../lib/sim-isolation-shared";
import { SIM_LOCATIONS } from "../../personas-shared";
import {
  CUSTOMER_A, CUSTOMER_B, REQUEST, VERIFY, LINES, SUBMIT, draftPath, payPath,
  mailFiles, capturedLink, customers, quotes, quoteLines, effects, readRows,
} from "../contracts/customer-first-use.spec";

const responseFor = (page: Page, path: string) => page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === "POST");
const post = (page: Page, path: string, data: unknown) => page.request.post(`${SIM_APP_ORIGIN}${path}`, { data, headers: { Origin: SIM_APP_ORIGIN }, maxRedirects: 0 });
const shape = (lines: Awaited<ReturnType<typeof quoteLines>>) => lines.map(line => ({ ...line, quantity: Number(line.quantity) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

async function signIn(page: Page, email: string) {
  await page.goto("/order/start?mode=signin");
  await page.getByLabel(/^Email/).fill(email);
  const before = await mailFiles(), response = responseFor(page, REQUEST);
  await page.getByRole("button", { name: /^Send me a sign-in link/ }).click();
  expect(await (await response).json(), "customer.link.constant-shape").toEqual({ ok: true });
  const { link } = await capturedLink(before, email);
  await page.goto(link);
  await page.waitForURL(url => url.pathname === "/order/account");
}

for (const code of ["EM", "MEP"] as const) {
  test(`customer ${code} anonymous intake, real link, cart, submit and payment hold`, async ({ page, browser, contract }, info) => {
    const mark = (id: string) => { if (!contract.assertionIds.includes(id)) contract.assertionIds.push(id); };
    const finding = (id: string) => info.annotations.push({ type: "finding", description: id });
    const blocked = (id: string) => info.annotations.push({ type: "blocked", description: id });
    const location = SIM_LOCATIONS[code];
    // Count only the explicitly reviewed destinations, before the default route denies them.
    // An unexpected host still fails the fixture's actualDenials == expectedDenials check.
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.protocol === "https:" && !url.username && !url.password && (
        (url.hostname === "static.spotapps.co" && url.pathname.startsWith("/spots/")) ||
        (url.hostname === "s3.amazonaws.com" && url.pathname.startsWith("/toasttab/")) ||
        (url.hostname === "nominatim.openstreetmap.org" && url.pathname === "/search")
      )) contract.expectedDenials++;
    });
    mark("customer.cold-baseline");
    expect(process.env.LRA_FIXTURE).toBe("cold-empty");
    expect(await customers(CUSTOMER_A), "customer.cold-baseline").toEqual([]);
    expect(await customers(CUSTOMER_B), "customer.cold-baseline").toEqual([]);
    mark("customer.storefront.public");
    await page.goto("/order");
    await expect(page.getByRole("heading", { level: 1 }), "customer.storefront.public").toBeVisible();
    await contract.screenshot("start");
    blocked("customer.landing-photos"); blocked("customer.email.activation"); blocked("LRA-008");
    mark("customer.storefront.spanish");
    const spanishToggle = page.getByRole("button", { name: /español|spanish/i }).or(page.getByRole("link", { name: /español|spanish/i }));
    const hasSpanish = (await page.locator("html").getAttribute("lang")) === "es" || await spanishToggle.count() > 0;
    if (!hasSpanish) finding("LRA-005");
    expect.soft(hasSpanish, "customer.storefront.spanish LRA-005").toBe(true);

    await page.goto("/order/start");
    // The denied geocoder is an activated failure, with a visible-error expectation (LRA-044).
    mark("customer.delivery.failure-visible");
    const locate = page.getByRole("button", { name: /locate|locate address|find address/i });
    if (await locate.count()) {
      await page.getByPlaceholder("Street, city, ZIP").fill("Synthetic event address, Washington DC");
      const denied = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).hostname === "nominatim.openstreetmap.org" });
      await locate.click(); await denied;
      await expect(locate).toBeEnabled();
      await contract.screenshot("delivery-failure-decision");
      const errorVisible = await page.getByText(/couldn.t (locate|find)|unable to (locate|find)|try again|address not found/i).count() > 0;
      if (!errorVisible) finding("LRA-044");
      expect.soft(errorVisible, "customer.delivery.failure-visible LRA-044").toBe(true);
    } else blocked("customer.delivery.failure-visible");
    blocked("customer.delivery.activation");

    mark("customer.intake.pickup");
    await page.getByLabel("Your name", { exact: true }).fill("Synthetic Customer A");
    await page.getByLabel(/^Email/).fill(CUSTOMER_A);
    // Runner supplies the ET anchor; future date avoids testing a stale one-off fixture date.
    const date = new Date(`${contract.manifest.etAnchor}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 14);
    await page.getByLabel("Event date", { exact: true }).fill(date.toISOString().slice(0, 10));
    await page.getByLabel("Guests", { exact: true }).fill("20");
    // LRA-212: the start form's Field wrapper renders its controls inside a <label>, so the FIRST button of each
    // group inherits the label text as its accessible name ("Pickup location P Street" for the Capitol Hill button,
    // "Delivery or pickup? pickup" for Delivery). Click by visible text; the role-name lookup is the soft a11y claim.
    const byText = (name: string) => page.getByRole("button").and(page.getByText(name, { exact: true }));
    await page.getByRole("button", { name: "pickup", exact: true }).click(); // the toggle's SECOND button carries a correct name (LRA-212 hits the first)
    await byText(location.name).click();
    mark("customer.a11y.field-label");
    const namedShop = await page.getByRole("button", { name: location.name, exact: true }).count();
    if (namedShop !== 1) finding("LRA-212");
    expect.soft(namedShop, "customer.a11y.field-label LRA-212: first control in a Field inherits the label as its name").toBe(1);
    await contract.screenshot("pickup-decision");
    const before = await mailFiles(), requested = responseFor(page, REQUEST);
    await page.getByRole("button", { name: /^Continue/ }).click();
    const request = await requested;
    mark("customer.link.constant-shape");
    expect(request.status(), "customer.link.constant-shape").toBe(200);
    expect(await request.json(), "customer.link.constant-shape").toEqual({ ok: true });
    expect(request.request().postDataJSON().intake.locationId, "customer.intake.pickup").toBe(location.id);
    expect(request.request().postDataJSON().intake.isDelivery, "customer.intake.pickup").toBe(false);
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    mark("customer.link.no-preverify-artifact");
    expect(await customers(CUSTOMER_A), "customer.link.no-preverify-artifact").toEqual([]);
    expect(await readRows("catering_quotes", "id"), "customer.link.no-preverify-artifact").toEqual([]);
    expect(await readRows("catering_pipeline", "id"), "customer.link.no-preverify-artifact").toEqual([]);
    await contract.screenshot("email-decision");
    const captured = await capturedLink(before, CUSTOMER_A);
    mark("customer.email.spanish");
    if (info.project.metadata.locale === "es") {
      const spanish = /<html[^>]*lang=["']es["']/i.test(captured.mail.html);
      if (!spanish) finding("LRA-097");
      expect.soft(spanish, "customer.email.spanish LRA-097").toBe(true);
    }
    mark("customer.link.verified-draft");
    const verified = responseFor(page, VERIFY);
    await page.goto(captured.link);
    expect((await verified).status(), "customer.link.verified-draft").toBe(200);
    await page.waitForURL(url => url.pathname === "/order/build");
    mark("customer.link.session-cookie");
    expect((await page.context().cookies()).some(cookie => cookie.name === "co_ops_portal" && cookie.httpOnly), "customer.link.session-cookie").toBe(true);
    const contacts = await customers(CUSTOMER_A);
    expect(contacts, "customer.link.verified-draft").toHaveLength(1);
    const owned = await quotes(contacts[0]!.id, location.id);
    expect(owned, "customer.link.verified-draft").toHaveLength(1);
    const quote = owned[0]!;
    expect(quote.status, "customer.link.verified-draft").toBe("draft");
    expect(new URL(page.url()).searchParams.get("draft"), "customer.link.verified-draft").toBe(quote.id);
    const originalEffects = await effects(quote);
    expect(originalEffects.pipeline, "customer.link.verified-draft").toEqual([{ id: quote.pipeline_id, stage: "inquiry", lead_source: "portal" }]);
    await contract.screenshot("verified-outcome");

    mark("customer.link.reuse-refused");
    await page.goto(captured.link);
    await expect(page.getByRole("heading", { name: "Link expired" }), "customer.link.reuse-refused").toBeVisible();
    await expect(page.getByText(/was already used, or was replaced/)).toBeVisible();
    expect(await quotes(quote.customer_id), "customer.link.reuse-refused").toHaveLength(1);
    await contract.screenshot("reused-link-outcome");
    mark("customer.link.malformed-refused");
    await page.goto("/order/verify?token=malformed-synthetic-token");
    await expect(page.getByRole("heading", { name: "Link expired" }), "customer.link.malformed-refused").toBeVisible();

    await page.goto(`/order/build?draft=${quote.id}`);
    const loaded = await page.request.get(`${SIM_APP_ORIGIN}${draftPath(quote.id)}`);
    expect(loaded.status()).toBe(200);
    const { draft } = await loaded.json() as { draft: DraftLoad };
    // Select two actual menu references with distinct names; derive prices from that shop's menu.
    const menu = draft.menu.filter(item => !item.sizes?.length).sort((a, b) => a.id.localeCompare(b.id));
    const selected = menu.filter((item, index) => menu.findIndex(other => other.name === item.name) === index).slice(0, 2);
    mark("customer.cart.two-lines"); expect(selected, "customer.cart.two-lines: configured menu required").toHaveLength(2);
    const [first, second] = selected;
    const quickAdd = (name: string) => page.getByRole("button", { name: `Quick add ${name}`, exact: true });
    await quickAdd(first!.name).click();
    const saved = responseFor(page, LINES);
    await quickAdd(second!.name).click();
    expect((await saved).status(), "customer.cart.two-lines").toBe(200);
    await expect.poll(async () => (await quoteLines(quote.id)).length, { message: "customer.cart.two-lines" }).toBe(2);
    const baseline = await quoteLines(quote.id);
    const expected = baseline.map(line => ({ ...line, quantity: (line.item_id ?? line.menu_item_id) === first!.id ? 2 : 1,
      line_total_cents: line.unit_price_cents * ((line.item_id ?? line.menu_item_id) === first!.id ? 2 : 1) }));
    expect(baseline.every(line => Number(line.quantity) === 1), "customer.cart.two-lines").toBe(true);
    mark("customer.cart.server-price");
    for (const item of selected) {
      const row = baseline.find(line => (line.item_id ?? line.menu_item_id) === item.id);
      expect(row?.unit_price_cents, "customer.cart.server-price").toBe(item.portionable ? item.portionPricesCents!.whole : item.unitPriceCents);
    }
    await contract.screenshot("cart-last-edit-decision");
    // Real UI handlers, back-to-back in one browser task: no artificial save delay or API cart edit.
    // Existing nonempty cart makes Continue enabled before the last click.
    const delta = await page.evaluate(name => {
      const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === `Quick add ${name}`);
      const next = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => /^Continue/.test(button.textContent?.trim() ?? "") && button.getClientRects().length > 0);
      if (!add || !next || next.disabled) throw new Error("customer.cart.race-controls");
      const started = performance.now(); add.click(); next.click(); return performance.now() - started;
    }, first!.name);
    mark("customer.cart.last-edit"); expect(delta, "customer.cart.last-edit: before 400ms debounce").toBeLessThan(400);
    await page.waitForURL(url => url.pathname === "/order/review");
    await page.reload();
    await page.context().clearCookies(); await signIn(page, CUSTOMER_A);
    mark("customer.review.persisted-total");
    const preview = responseFor(page, "/api/portal/order/draft/preview");
    await page.goto(`/order/review?draft=${quote.id}`);
    const previewResponse = await preview;
    expect(previewResponse.status(), "customer.review.persisted-total").toBe(200);
    const { stack: reviewedStack } = await previewResponse.json() as { stack: ChargeStack };
    await expect(page.getByRole("heading", { name: "Review, then lock in your date." })).toBeVisible();
    const persisted = await quoteLines(quote.id);
    if (JSON.stringify(shape(persisted)) !== JSON.stringify(shape(expected))) finding("LRA-007");
    expect.soft(shape(persisted), "customer.cart.last-edit LRA-007 after reload and real relogin").toEqual(shape(expected));
    mark("customer.review.persisted-total");
    const rules = await readRows<{ tax_rate_bps: number; service_charge_bps: number; deposit_pct_bps: number }>("catering_pricing_rules", "tax_rate_bps,service_charge_bps,deposit_pct_bps", { location_id: location.id, active: "true" });
    expect(rules, "customer.review.persisted-total: configured shop pricing required").toHaveLength(1);
    const rule = rules[0]!;
    const subtotal = persisted.reduce((sum, line) => sum + Math.round(Number(line.quantity) * line.unit_price_cents), 0);
    const service = Math.round(subtotal * rule.service_charge_bps / 10000);
    const tax = Math.round((subtotal + service) * rule.tax_rate_bps / 10000);
    const total = subtotal + service + tax; // pickup, no napkins, zero customer-selected tip
    expect(reviewedStack, "customer.review.persisted-total: independently recomputed cents").toEqual({ subtotalCents: subtotal, deliveryFeeCents: 0, gratuityCents: 0, serviceChargeCents: service, taxCents: tax, totalCents: total, depositCents: Math.round(total * rule.deposit_pct_bps / 10000) });
    await contract.screenshot("review-outcome");
    mark("customer.portal.spanish");
    if (info.project.metadata.locale === "es") {
      const spanish = await page.getByRole("heading", { name: /revisa|revisar|reserva/i }).count() > 0;
      if (!spanish) finding("LRA-097");
      expect.soft(spanish, "customer.portal.spanish LRA-097").toBe(true);
    }
    mark("customer.payment.copy-honest");
    const providerClaim = await page.getByText(/securely via Stripe/i).count() > 0;
    expect.soft(providerClaim, "customer.payment.copy-honest: provider claim while activation is blocked").toBe(false);

    // Both requests use the real customer's cookie and the actual UI submit payload.
    // Hold the UI request until its peer is dispatched, then release both to the real app.
    mark("customer.submit.once");
    let peer: ReturnType<typeof post> | undefined, raceRequests = 0;
    await page.route(`**${SUBMIT}`, async route => {
      raceRequests++;
      peer = post(page, SUBMIT, route.request().postDataJSON());
      await route.continue();
    }, { times: 1 });
    const submitted = responseFor(page, SUBMIT);
    await contract.screenshot("submit-decision");
    await page.getByRole("button", { name: /^Pay deposit & lock my date/ }).click();
    const uiResponse = await submitted;
    expect(raceRequests, "customer.submit.once: race activated").toBe(1);
    expect(peer, "customer.submit.once: peer dispatched").toBeDefined();
    const statuses = [uiResponse.status(), (await peer!).status()].sort();
    const after = await effects(quote);
    expect.soft(statuses, "customer.submit.once").toEqual([200, 409]);
    expect.soft(after.ownedQuotes, "customer.submit.once").toHaveLength(1);
    expect.soft(after.ownedQuotes[0]?.status, "customer.submit.once").toBe("submitted");
    expect.soft(after.pipeline, "customer.submit.once").toEqual(originalEffects.pipeline);
    expect.soft(after.events, "customer.submit.once").toEqual(originalEffects.events);
    expect.soft(after.demand, "customer.submit.once: Inquiry reserves no demand").toEqual([]);
    expect.soft(after.payments, "customer.submit.once").toEqual([{ kind: "deposit", status: "due", amount_cents: after.ownedQuotes[0]!.deposit_cents, provider: null, provider_ref: null, paid_at: null }]);
    mark("customer.review.persisted-total");
    const current = after.ownedQuotes[0]!;
    expect(current.subtotal_cents, "customer.review.persisted-total").toBe(persisted.reduce((sum, line) => sum + line.line_total_cents, 0));
    expect({ subtotalCents: current.subtotal_cents, totalCents: current.total_cents, depositCents: current.deposit_cents }, "customer.review.persisted-total").toEqual({ subtotalCents: reviewedStack.subtotalCents, totalCents: reviewedStack.totalCents, depositCents: reviewedStack.depositCents });
    // The peer can win; navigate to the persisted order even if the UI received the honest 409.
    await page.goto(`/order/quote/${quote.id}`);
    await contract.screenshot("submit-outcome");
    mark("customer.payment.stub");
    expect(current.deposit_cents, "customer.payment.stub: configured deposit required").toBeGreaterThan(0);
    const paying = responseFor(page, payPath(quote.id));
    await page.getByRole("button", { name: /^Pay deposit to reserve/ }).click();
    const payment = await paying;
    expect(payment.status(), "customer.payment.stub").toBe(200);
    expect(await payment.json(), "customer.payment.stub").toMatchObject({ ok: true, stub: true, message: expect.stringContaining("Payment isn't wired yet") });
    await expect(page.getByText(/Payment isn't wired yet/), "customer.payment.stub").toBeVisible();
    expect((await effects(quote)).payments, "customer.payment.stub").toEqual(after.payments);
    mark("customer.payment.kind-authority");
    expect((await post(page, payPath(quote.id), { kind: "full" })).status(), "customer.payment.kind-authority").toBe(400);
    await contract.screenshot("payment-hold-outcome");
    await page.goto("/order/account");
    mark("customer.account.owned-order");
    await expect(page.locator(`a[href="/order/quote/${quote.id}"]`), "customer.account.owned-order").toBeVisible();
    await contract.screenshot("account-outcome");

    const beforeDenials = await effects(quote), linesBeforeDenials = await quoteLines(quote.id);
    const other = await browser.newContext({ baseURL: SIM_APP_ORIGIN, viewport: page.viewportSize()!, locale: String(info.project.metadata.locale) });
    try {
      const b = await other.newPage(); await contract.trackPage(b);
      await signIn(b, CUSTOMER_B);
      mark("customer.ownership.denied");
      expect((await b.request.get(`${SIM_APP_ORIGIN}${draftPath(quote.id)}`, { maxRedirects: 0 })).status(), "customer.ownership.denied").toBe(404);
      // The quote page denies a non-owner with an honest "Order not found" body and none of the order's content;
      // its HTTP status is a separate, soft claim (LRA-211: the app answers that page with 200, not 404).
      const foreignPage = await b.request.get(`${SIM_APP_ORIGIN}/order/quote/${quote.id}`, { maxRedirects: 0 });
      const foreignBody = await foreignPage.text();
      expect(foreignBody, "customer.ownership.denied").toContain("Order not found");
      expect(foreignBody, "customer.ownership.denied: no order content").not.toContain(first!.name);
      mark("customer.ownership.soft-404");
      if (foreignPage.status() !== 404) finding("LRA-211");
      expect.soft(foreignPage.status(), "customer.ownership.soft-404 LRA-211").toBe(404);
      for (const [path, body] of [[LINES, { quoteId: quote.id, lines: [] }], [SUBMIT, { quoteId: quote.id }], [payPath(quote.id), { kind: "deposit" }]] as const) {
        expect((await post(b, path, body)).status(), "customer.ownership.denied").toBe(404);
      }
      await contract.screenshot("customer-b-denied-decision", b);
      await other.clearCookies();
      mark("customer.anonymous.mutation-denied");
      for (const [path, body] of [[LINES, { quoteId: quote.id, lines: [] }], [SUBMIT, { quoteId: quote.id }], [payPath(quote.id), { kind: "deposit" }]] as const) {
        expect((await post(b, path, body)).status(), "customer.anonymous.mutation-denied").toBe(401);
      }
      expect(await effects(quote), "customer.ownership.denied: no side effects").toEqual(beforeDenials);
      expect(await quoteLines(quote.id), "customer.ownership.denied: cart unchanged").toEqual(linesBeforeDenials);
      mark("customer.email.failure-honesty");
      await b.goto("/order/start?mode=signin");
      await b.getByLabel(/^Email/).fill("foreign@sim.invalid");
      const mailBefore = await mailFiles(), refused = responseFor(b, REQUEST);
      await b.getByRole("button", { name: /^Send me a sign-in link/ }).click();
      expect(await (await refused).json(), "customer.link.constant-shape").toEqual({ ok: true });
      await expect(b.getByRole("heading", { name: "Check your email" })).toBeVisible();
      expect(await mailFiles(), "customer.email.failure-honesty: no captured delivery").toEqual(mailBefore);
      const claimsSent = await b.getByText(/We sent a link to/).count() > 0;
      if (claimsSent) finding("LRA-009");
      expect.soft(claimsSent, "customer.email.failure-honesty LRA-009").toBe(false);
      await contract.screenshot("email-refusal-outcome", b);
    } finally { await other.close(); }
    await contract.screenshot("outcome");
  });
}
