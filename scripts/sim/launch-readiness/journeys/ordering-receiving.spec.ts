import type { Page } from "@playwright/test";
import { test, expect, login } from "../playwright.config";
import { SIM_LOCATIONS, personaByEmail, type LocationCode } from "../../personas-shared";
import en from "../../../../lib/i18n/en.json";
import es from "../../../../lib/i18n/es.json";
import { formatCents } from "../../../../lib/i18n/format";
import {
  PO_API, RECEIVE_API, call, sessionFor, readRows, walkLedger, orders, poById,
  poLines, lineShape, sortSku, checkSnapshot, receivingLedger, checkReceipt,
  checkCredits, checkThreeWay,
} from "../contracts/ordering-receiving.spec";

type Language = "en" | "es";
type Key = keyof typeof en;
const text = (lang: Language, key: Key, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), (lang === "es" ? es : en)[key]);
const url = (path: string, code: LocationCode) => `${path}?location=${SIM_LOCATIONS[code].id}`;
const responseFor = (page: Page, path: string, action?: string) => page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === "POST" && (!action || r.request().postDataJSON()?.action === action));

for (const [code, khAlias, employeeAlias] of [["EM", "rosa", "maya"], ["MEP", "angel", "luis"]] as const) {
  test(`ordering ${code} KH walk, manual PO, discrepancy receiving and durable credits`, async ({ page, contract }) => {
    const mark = (id: string) => { if (!contract.assertionIds.includes(id)) contract.assertionIds.push(id); };
    mark("ordering.raw-500");
    const rawFailures: number[] = [];
    page.on("response", r => { if (new URL(r.url()).origin === new URL(page.url()).origin && r.status() >= 500) rawFailures.push(r.status()); });
    const kh = personaByEmail(`${khAlias}@sim.co-ops`), lang = kh.language;
    const button = (key: Key, params: Record<string, string | number> = {}) => page.getByRole("button", { name: text(lang, key, params), exact: true });
    try {
      mark("ordering.walk.decisions");
      expect(process.env.LRA_FIXTURE, "ordering.walk.decisions").toBe("cold-empty");
      await login(page, kh, code);
      const api = await sessionFor(khAlias, code);
      const { vendor, decisions } = await walkLedger(api, code);
      expect(await orders(code, vendor.vendorId), "ordering.walk.decisions: clean shop").toEqual([]);
      await page.goto(url("/ordering", code));
      const accordion = page.getByRole("button", { name: /^Boar's Head/ }).filter({ has: page.locator("span") }).and(page.locator("[aria-expanded]"));
      await expect(accordion, "ordering.walk.decisions").toBeVisible();
      if (await accordion.getAttribute("aria-expanded") !== "true") await accordion.click();
      await contract.screenshot("start");
      await expect(button("ordering.walk.review"), "ordering.walk.decisions").toBeDisabled();
      for (const d of decisions) {
        const key = d.action === "suggest" ? "ordering.row.suggest_aria" : d.action === "empty" ? "ordering.row.order_par_aria" : "ordering.row.full_aria";
        await button(key, { sku: d.name, n: d.action === "empty" ? Math.ceil(d.parToday) : d.suggestedQty! }).click();
        const row = button("ordering.row.decrement", { sku: d.name }).locator("xpath=..");
        await expect(row.getByRole("spinbutton", { name: text(lang, "ordering.row.order_label", { unit: d.orderUnitLabel! }), exact: true }), "ordering.walk.decisions").toHaveValue(String(d.orderQty));
      }
      await expect(button("ordering.walk.review"), "ordering.walk.decisions").toBeEnabled();
      const expected = decisions.filter(d => d.orderQty > 0).map(d => ({ skuId: d.skuId, qty: d.orderQty, unit: d.orderUnitLabel }));

      mark("ordering.walk.persisted");
      await expect(button("ordering.walk.review"), "ordering.walk.persisted").toBeEnabled();
      await button("ordering.walk.review").click();
      const submitted = responseFor(page, "/api/operations/ordering");
      await button("ordering.review.submit", { n: decisions.length }).click();
      const walkResponse = await submitted;
      expect(walkResponse.status(), "ordering.walk.persisted").toBe(201);
      const walk = await walkResponse.json() as { eventId: string; poError: boolean; pos: { vendorId: string; poId: string }[] };
      expect(walk.poError, "ordering.walk.persisted").toBe(false);
      const recorded = await readRows<{ sku_id: string; order_qty: number | string; order_unit_label: string | null }>("par_pass_lines", "sku_id,order_qty,order_unit_label", { event_id: walk.eventId });
      expect(sortSku(recorded.map(l => ({ skuId: l.sku_id, qty: Number(l.order_qty), unit: l.order_unit_label }))), "ordering.walk.persisted: explicit zero included, untouched omitted").toEqual(sortSku(decisions.map(d => ({ skuId: d.skuId, qty: d.orderQty, unit: d.orderUnitLabel }))));
      const owned = walk.pos.filter(p => p.vendorId === vendor.vendorId);
      expect(owned, "ordering.walk.persisted").toHaveLength(1);
      const poId = owned[0]!.poId;
      mark("ordering.draft.matches-walk");
      expect(await orders(code, vendor.vendorId), "ordering.draft.matches-walk: Record walk creates one order").toHaveLength(1);
      expect(lineShape(await poLines(poId)), "ordering.draft.matches-walk: submitted walk PO").toEqual(sortSku(expected));
      const draft = await poById(poId);
      mark("ordering.po.snapshot");
      expect(draft.par_pass_event_id, "ordering.po.snapshot: walk provenance").toBe(walk.eventId);
      await test.step("LRA-206: Record walk then Generate draft refuses", async () => {
        mark("ordering.walk.duplicate-po");
        const refused = await api.call("POST", PO_API, { action: "generate_draft", locationId: SIM_LOCATIONS[code].id, vendorId: vendor.vendorId });
        const after = await orders(code, vendor.vendorId);
        if (refused.status !== 409 || refused.code !== "po_exists" || after.length !== 1) test.info().annotations.push({ type: "finding", description: "LRA-206" });
        expect.soft({ status: refused.status, code: refused.code }, "ordering.walk.duplicate-po LRA-206").toEqual({ status: 409, code: "po_exists" });
        expect.soft(refused.status, "ordering.raw-500").toBeLessThan(500);
        expect.soft(after, "ordering.walk.duplicate-po LRA-206: refusal leaves one PO").toHaveLength(1);
      });
      await page.goto(`${url("/ordering", code)}&po=${poId}`);
      // PoPanel has no dialog role: the display-code heading owns its content wrapper.
      const panel = page.getByRole("heading", { name: text(lang, "ordering.po.panel_title", { code: draft.display_code }), exact: true }).locator("../..");
      await expect(panel, "ordering.po.snapshot").toBeVisible();
      const poButton = (key: Key) => panel.getByRole("button", { name: text(lang, key), exact: true });
      const originalIds = (await poLines(poId)).map(l => l.id).sort();
      mark("ordering.po.snapshot");
      await poButton("ordering.po.confirm").click();
      const confirmation = responseFor(page, PO_API, "confirm");
      await poButton("ordering.po.confirm_arm").click();
      expect((await confirmation).status(), "ordering.po.snapshot").toBe(200);
      const po = await checkSnapshot(poId, expected);
      expect(po.status, "ordering.po.snapshot").toBe("confirmed");
      expect((await poLines(poId)).map(l => l.id).sort(), "ordering.po.snapshot").toEqual(originalIds);
      mark("ordering.po.manual");
      await poButton("ordering.po.mark_placed").click();
      // PlaceDialog is a sibling of the content wrapper inside THIS PoPanel.
      // Its submit shares the "Mark placed" name with the underlying opener.
      const placeDialog = panel.locator("..").getByRole("heading", { name: text(lang, "ordering.po.place_title"), exact: true }).locator("..");
      await expect(placeDialog.getByText(text(lang, "ordering.po.place_help"), { exact: true }), "ordering.po.manual: record how the order went out").toBeVisible();
      await placeDialog.getByRole("combobox", { name: text(lang, "ordering.po.place_channel"), exact: true }).selectOption("phone");
      await contract.screenshot("decision");
      const placement = responseFor(page, PO_API, "place");
      await placeDialog.getByRole("button", { name: text(lang, "ordering.po.place_confirm"), exact: true }).click();
      expect((await placement).status(), "ordering.po.manual").toBe(200);
      expect((await poById(poId)).status, "ordering.po.manual").toBe("placed");
      expect(await readRows("po_transmissions", "channel", { po_id: poId }), "ordering.po.manual").toEqual([{ channel: "phone" }]);
      await contract.screenshot("placed-outcome");

      mark("ordering.receiving.quantities");
      const ledger = await receivingLedger(po, code, `SIM-BH-${code}-1`);
      await page.goto(url("/operations/receiving", code));
      await page.getByRole("combobox", { name: text(lang, "receiving.form.vendor"), exact: true }).selectOption(vendor.vendorId);
      const receiving = page.getByRole("status").filter({ hasText: text(lang, "receiving.door.receiving_against_po", { code: po.display_code }) }).locator("../..");
      await expect(receiving, "ordering.receiving.quantities: linked PO form").toHaveCount(1);
      const receiveButton = (key: Key) => receiving.getByRole("button", { name: text(lang, key), exact: true });
      await page.getByRole("textbox", { name: text(lang, "receiving.form.date"), exact: true }).fill(ledger.body.deliveryDate);
      await page.getByRole("textbox", { name: text(lang, "receiving.form.invoice_number"), exact: true }).fill(ledger.body.invoiceNumber!);
      await page.getByRole("spinbutton", { name: text(lang, "receiving.form.invoice_total"), exact: true }).fill(String(ledger.invoiceCents / 100));
      for (const l of ledger.entries) {
        await expect(button("receiving.door.confirm_aria", { sku: l.name }), "ordering.receiving.quantities: PO expectation loaded").toHaveAttribute("aria-pressed", "false");
        await button("receiving.door.expand_aria", { sku: l.name }).click();
        const row = button("receiving.door.collapse_aria", { sku: l.name }).locator("xpath=../..");
        await row.getByRole("spinbutton", { name: text(lang, "receiving.form.price"), exact: true }).fill(String(l.priceCents! / 100));
        if (l.received > 0) {
          await row.getByRole("spinbutton", { name: text(lang, "receiving.door.qty_label", { level: l.level ?? text(lang, "receiving.door.level_generic") }), exact: true }).fill(String(l.received));
          if (l.flag) {
            // Suggested flags carry a decorative bullet in their accessible name.
            const flag = row.getByRole("button").filter({ hasText: text(lang, l.flag === "short" ? "receiving.flag.short" : "receiving.flag.damaged") });
            await flag.click();
            await expect(flag, "ordering.receiving.quantities").toHaveAttribute("aria-pressed", "true");
          }
        }
        await button("receiving.door.collapse_aria", { sku: l.name }).click();
        if (!l.flag) await button("receiving.door.confirm_aria", { sku: l.name }).click();
      }
      // No step-up is required. Photo later is the actual canSubmit gate at :438.
      await expect(receiveButton("receiving.door.submit_complete"), "ordering.receiving.quantities: photo required or explicitly deferred").toBeDisabled();
      await page.getByRole("checkbox", { name: text(lang, "receiving.door.photo_later"), exact: true }).check();
      await expect(receiveButton("receiving.door.submit_complete"), "ordering.receiving.quantities").toBeEnabled();
      await receiveButton("receiving.door.submit_complete").click();
      const missing = ledger.entries.find(l => l.received === 0)!;
      await button("receiving.missing.not_arrived_aria", { sku: missing.name }).click();
      await contract.screenshot("receiving-decision");
      const received = responseFor(page, RECEIVE_API);
      await receiveButton("receiving.door.submit_complete_anyway").click();
      const receivedResponse = await received;
      expect(receivedResponse.request().postDataJSON().purchaseOrderId, "ordering.receiving.quantities: submitted PO linkage").toBe(poId);
      expect(receivedResponse.status(), "ordering.receiving.quantities").toBe(201);
      const receipt = await checkReceipt(code, ledger);
      mark("ordering.receiving.credits");
      // Soft findings retain the failed verdict and still expose durable history.
      try { await checkCredits(receipt.header, receipt.lines, ledger); }
      catch { expect.soft(false, "ordering.receiving.credits: exact independent cent ledger").toBe(true); }
      expect((await poById(poId)).status, "ordering.receiving.quantities").toBe("received");
      mark("ordering.receiving.history");
      await page.reload();
      await page.context().clearCookies();
      await login(page, kh, code);
      await page.goto(url("/operations/receiving", code));
      const deliveryLink = page.getByRole("link").filter({ hasText: ledger.body.invoiceNumber! });
      await expect(deliveryLink, "ordering.receiving.history").toHaveCount(1);
      await expect(deliveryLink, "ordering.receiving.history").toContainText(text(lang, "receiving.badge.photo_missing"));
      await deliveryLink.click();
      for (const l of ledger.entries.filter(l => l.received > 0)) {
        const item = page.getByRole("listitem").filter({ has: page.getByText(l.name, { exact: true }) });
        await expect(item, "ordering.receiving.history").toHaveCount(1);
        if (l.flag) await expect(item, "ordering.receiving.history").toContainText(text(lang, l.flag === "short" ? "receiving.flag.short" : "receiving.flag.damaged"));
      }
      const creditSection = page.getByRole("heading", { name: text(lang, "receiving.credits.section_title"), exact: true }).locator("..");
      await expect.soft(creditSection.getByRole("listitem"), "ordering.receiving.history: three open credits").toHaveCount(3);
      for (const c of ledger.expectedCredits) {
        const reason = text(lang, c.reason === "damaged" ? "receiving.flag.damaged" : "receiving.flag.short");
        const row = creditSection.getByRole("listitem").filter({ hasText: reason }).filter({ hasText: text(lang, "receiving.credits.qty", { n: c.qty }) }).filter({ hasText: formatCents(c.cents, lang) });
        await expect.soft(row, "ordering.receiving.history: amount, quantity and reason").toHaveCount(1);
        await expect.soft(row, "ordering.receiving.history: open status").toContainText(text(lang, "receiving.credits.status.open"));
      }
      try { await checkThreeWay(await sessionFor(khAlias, code), poId, ledger); }
      catch { expect.soft(false, "ordering.receiving.history: three-way and open credit SKU linkage").toBe(true); }
      await contract.screenshot("outcome");

      mark("ordering.employee.denied");
      await page.context().clearCookies();
      const employee = personaByEmail(`${employeeAlias}@sim.co-ops`);
      await login(page, employee, code);
      await page.goto(url("/ordering", code));
      await expect(page.getByRole("button", { name: text(employee.language, "ordering.po.generate_draft"), exact: true }), "ordering.employee.denied").toHaveCount(0);
      await expect(page.getByRole("button", { name: text(employee.language, "ordering.po.mark_placed"), exact: true }), "ordering.employee.denied").toHaveCount(0);
      const employeeApi = await sessionFor(employeeAlias, code);
      for (const body of [{ action: "generate_draft", locationId: SIM_LOCATIONS[code].id, vendorId: vendor.vendorId }, { action: "place", poId, channel: "phone" }]) {
        expect((await call(employeeApi, "POST", PO_API, body)).status, "ordering.employee.denied").toBe(403);
      }
      expect((await poById(poId)).status, "ordering.employee.denied: no mutation").toBe("received");
    } finally {
      expect.soft(rawFailures, "ordering.raw-500: every server error is a finding").toEqual([]);
    }
  });
}
