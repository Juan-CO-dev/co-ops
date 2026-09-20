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
import * as driver from "../../concurrency/driver.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
      // V3-A (ordering.po.guide-order): a GM sets this vendor's order guide BEFORE the walk creates
      // the draft, so the draft's lines snapshot the guide (section*1000+line) and every surface
      // reads it. Two sections, deliberately NOT alphabetical: the last SKU by name goes first.
      const gm = await sessionFor("marcus", code);
      const guideApi = `/api/admin/vendors/${vendor.vendorId}/order-guide`;
      const orderedSkus = decisions.filter(d => d.orderQty > 0).map(d => ({ skuId: d.skuId, name: d.name })).sort((a, b) => a.name.localeCompare(b.name));
      expect(orderedSkus.length, "ordering.po.guide-order: needs at least two ordered SKUs").toBeGreaterThanOrEqual(2);
      // One guide per VENDOR (not per shop): the second shop's run finds the first shop's guide (409 exists) and rewrites it.
      type GuideJson = { guide?: { guideId: string; updatedAt: string; sections: unknown[] } | null };
      const createAttempt = await gm.call("POST", guideApi, { create: true }) as { status: number; code?: string; json: GuideJson };
      expect([201, 409].includes(createAttempt.status), `ordering.po.guide-order: create (${createAttempt.status} ${createAttempt.code ?? ""})`).toBe(true);
      const createdGuide = createAttempt.status === 201
        ? createAttempt
        : await gm.call("GET", guideApi) as { status: number; json: GuideJson };
      expect(createdGuide.json.guide, "ordering.po.guide-order: guide present").toBeTruthy();
      const existingGuide = createdGuide.json.guide!;
      const firstSection = [orderedSkus[orderedSkus.length - 1]!];              // the alphabetically-last SKU leads
      const secondSection = orderedSkus.slice(0, -1);
      const guideModel = {
        guideId: existingGuide.guideId, vendorId: vendor.vendorId, name: "Sim guide", updatedAt: existingGuide.updatedAt,
        sections: [
          { id: "00000000-0000-4000-8000-000000000a01", name: "Extras", position: 1, lines: firstSection.map((x, j) => ({ id: `00000000-0000-4000-8000-0000000000${(10 + j).toString(16).padStart(2, "0")}`, position: j + 1, skuId: x.skuId, label: x.name, itemNumber: null, note: null })) },
          { id: "00000000-0000-4000-8000-000000000a02", name: "Deli", position: 2, lines: secondSection.map((x, j) => ({ id: `00000000-0000-4000-8000-0000000000${(20 + j).toString(16).padStart(2, "0")}`, position: j + 1, skuId: x.skuId, label: x.name, itemNumber: null, note: null })) },
        ],
      };
      const savedGuide = await gm.call("POST", guideApi, { model: guideModel, expectedUpdatedAt: guideModel.updatedAt }) as { status: number; code?: string };
      expect(savedGuide.status, `ordering.po.guide-order: save (${savedGuide.code ?? ""})`).toBe(200);
      const expectedGuideKey = new Map<string, { position: number; section: string }>();
      firstSection.forEach((x, j) => expectedGuideKey.set(x.skuId, { position: 1000 + j + 1, section: "Extras" }));
      secondSection.forEach((x, j) => expectedGuideKey.set(x.skuId, { position: 2000 + j + 1, section: "Deli" }));
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
      mark("ordering.po.guide-order");
      const snapLines = await readRows<{ sku_id: string; guide_position_snapshot: number | null; guide_section_snapshot: string | null }>("po_lines", "sku_id,guide_position_snapshot,guide_section_snapshot", { po_id: poId });
      for (const l of snapLines) {
        expect({ position: l.guide_position_snapshot, section: l.guide_section_snapshot }, `ordering.po.guide-order: snapshot for ${l.sku_id}`).toEqual(expectedGuideKey.get(l.sku_id) ?? { position: null, section: null });
      }
      const frozen = (po.confirmed_snapshot as unknown as { lines: { skuId: string; guideSection: string | null }[] }).lines;
      for (const l of frozen) expect(l.guideSection, "ordering.po.guide-order: confirmed snapshot carries the section").toBe(expectedGuideKey.get(l.skuId)?.section ?? null);
      // The panel renders the frozen table in guide order: Extras header, its line, Deli header, its lines (by position).
      const expectedRowOrder = ["Extras", ...firstSection.map(x => x.name), ...(secondSection.length ? ["Deli", ...secondSection.map(x => x.name)] : [])];
      // textContent (not innerText): the frozen table lives in a collapsible section that may be folded after confirm.
      await contract.screenshot("guide-order");
      const tables = page.locator("table"); // page-wide: the frozen table may sit outside the heading's wrapper after confirm
      await expect(page.getByText(text(lang, "ordering.po.loading"), { exact: true }), "ordering.po.guide-order: panel reloaded").toHaveCount(0, { timeout: 20000 });
      await expect(tables.first(), "ordering.po.guide-order: frozen table rendered").toBeAttached({ timeout: 20000 });
      let renderedRows: string[] = [];
      for (let i = 0; i < await tables.count(); i++) {
        const rows = (await tables.nth(i).getByRole("row").allTextContents()).map(t => t.replace(/\s+/g, " ").trim()).filter(t => t.length > 0);
        if (rows.some(r => expectedRowOrder.some(name => r.includes(name)))) { renderedRows = rows; break; }
      }
      const firstRowWith = (name: string) => renderedRows.findIndex(r => r.includes(name));
      const bodyPositions = expectedRowOrder.map(firstRowWith);
      expect(bodyPositions.every(i => i >= 0), `ordering.po.guide-order: every header and line rendered (tables=${await tables.count()} rows=${JSON.stringify(renderedRows)} pageText=${JSON.stringify((await page.locator("body").textContent() ?? "").replace(/\s+/g, " ").slice(0, 600))})`).toBe(true);
      expect([...bodyPositions].sort((a, b) => a - b), "ordering.po.guide-order: header before lines, sections in order").toEqual(bodyPositions);
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
      // V3-B (receiving.scan.teach-then-hit): teach a case code for a received SKU, then look it up both ways.
      mark("receiving.scan.teach-then-hit");
      const receivedItems = await readRows<{ vendor_item_id: string }>("vendor_delivery_items", "vendor_item_id", { delivery_id: receipt.header.id });
      const taughtSku = receivedItems[0]!.vendor_item_id;
      const scanApi = (leaf: string) => `/api/operations/receiving/scan/${leaf}`;
      // One code per shop: SKUs are global, and both shops receive the same vendor — the same code taught to two SKUs is (correctly) ambiguous.
      const scanCode = code === "EM" ? "04006381333931" : "5901234123457"; // EM: GTIN-14 with a leading zero (folds to 13); MEP: a plain EAN-13
      const scanBody = { vendorId: vendor.vendorId, locationId: SIM_LOCATIONS[code].id, code: scanCode };
      const teach1 = await api.call("POST", scanApi("teach"), { ...scanBody, skuId: taughtSku, level: "case", invoiceNumber: ledger.body.invoiceNumber });
      expect({ status: teach1.status, created: (teach1.json as { created?: boolean }).created }, "receiving.scan.teach-then-hit: teach").toEqual({ status: 201, created: true });
      const asSku = await api.call("POST", scanApi("lookup"), { ...scanBody, lineSkuIds: [] });
      expect(asSku.json, "receiving.scan.teach-then-hit: lookup off the delivery").toMatchObject({ kind: "sku", skuId: taughtSku, level: "case" });
      const asLine = await api.call("POST", scanApi("lookup"), { ...scanBody, lineSkuIds: [taughtSku] });
      expect(asLine.json, "receiving.scan.teach-then-hit: lookup on the delivery").toMatchObject({ kind: "line", skuId: taughtSku, level: "case" });
      const teachAgain = await api.call("POST", scanApi("teach"), { ...scanBody, skuId: taughtSku, level: "case" });
      expect({ status: teachAgain.status, created: (teachAgain.json as { created?: boolean }).created }, "receiving.scan.teach-then-hit: idempotent").toEqual({ status: 200, created: false });
      const otherLevel = await api.call("POST", scanApi("teach"), { ...scanBody, skuId: taughtSku, level: "inner" });
      expect({ status: otherLevel.status, code: otherLevel.code }, "receiving.scan.teach-then-hit: second level asks first").toEqual({ status: 409, code: "level_differs" });
      const confirmed = await api.call("POST", scanApi("teach"), { ...scanBody, skuId: taughtSku, level: "inner", confirmLevelChange: true });
      expect(confirmed.status, "receiving.scan.teach-then-hit: second level added").toBe(201);
      const both = await api.call("POST", scanApi("lookup"), { ...scanBody, lineSkuIds: [taughtSku] });
      expect((both.json as { levels?: string[] }).levels, "receiving.scan.teach-then-hit: both levels").toEqual(["case", "inner"]);
      expect((await api.call("POST", scanApi("forget"), { ...scanBody, skuId: taughtSku, level: "case" })).status, "receiving.scan.teach-then-hit: forget").toBe(200);
      const after = await api.call("POST", scanApi("lookup"), { ...scanBody, lineSkuIds: [taughtSku] });
      expect((after.json as { levels?: string[] }).levels, "receiving.scan.teach-then-hit: forgotten level gone").toEqual(["inner"]);
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

// V3-C-2 v1 (admin.vendor_import.stage-review-apply): the real PFG CustomerFirst export against the restored catalog.
// Counts pinned from CC's sim rehearsal of 2026-09-20 (.scratch/v3c2-rehearsal.mts) on the post-seed-38 snapshot.
const PFG_IZZY_MAIN = {
  file: "docs/seed/source/vendor-exports/pfg/list-izzy-main-2026-09-18.csv", name: "list-izzy-main-2026-09-18.csv",
  adapter: "pfg-customerfirst-v1", exportedAt: "2026-09-18", rows: 84, counts: { noop: 20, price: 2, needs_person: 62 } as Record<string, number>, needsPerson: 62,
};
test("vendor import: stage the PFG export, same file twice is one report, employee denied, GM cannot apply", async ({ contract }) => {
  const mark = (id: string) => { if (!contract.assertionIds.includes(id)) contract.assertionIds.push(id); };
  mark("ordering.raw-500"); mark("admin.vendor_import.stage-review-apply");
  const claim = "admin.vendor_import.stage-review-apply";
  expect(process.env.LRA_FIXTURE, claim).toBe("cold-empty");
  const gm = await sessionFor("marcus", "EM");
  const vendors = await readRows<{ id: string; name: string }>("vendors", "id,name", { name: "PFG", active: "true" });
  expect(vendors, `${claim}: exactly one PFG vendor`).toHaveLength(1);
  const vendorId = vendors[0]!.id;
  const importApi = `/api/admin/vendors/${vendorId}/import`;
  const text = readFileSync(resolve(PFG_IZZY_MAIN.file), "utf8");
  type View = { batch: { id: string; status: string; adapter: string; exported_at: string | null; row_count: number; report: { counts: Record<string, number>; needs_person: unknown[] } }; observations: unknown[]; ops: unknown[]; expectedDigest: string };
  // The stage route takes multipart, which the JSON session helper cannot send: same cookie, same origin header, manual redirects.
  const stage = async (session: { cookie: string }) => {
    const form = new FormData();
    form.append("file", new Blob([text], { type: "text/csv" }), PFG_IZZY_MAIN.name);
    const res = await fetch(new URL(importApi, driver.BASE), { method: "POST", headers: { cookie: session.cookie, origin: driver.BASE }, body: form, redirect: "manual" });
    expect(res.status, "ordering.raw-500").toBeLessThan(500);
    let json: View | { code?: string } | null = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  };
  const first = await stage(gm as { cookie: string });
  expect(first.status, `${claim}: GM stages (${(first.json as { code?: string } | null)?.code ?? ""})`).toBe(200);
  const view = first.json as View;
  expect(view.batch.status, claim).toBe("staged");
  expect({ adapter: view.batch.adapter, exportedAt: view.batch.exported_at, rows: view.batch.row_count }, `${claim}: identity of the export`)
    .toEqual({ adapter: PFG_IZZY_MAIN.adapter, exportedAt: PFG_IZZY_MAIN.exportedAt, rows: PFG_IZZY_MAIN.rows });
  expect(view.batch.report.counts, `${claim}: report counts by kind`).toEqual(PFG_IZZY_MAIN.counts);
  expect(view.batch.report.needs_person, `${claim}: rows that need a person`).toHaveLength(PFG_IZZY_MAIN.needsPerson);
  expect(view.observations, `${claim}: one observation per counted row`).toHaveLength(Object.values(PFG_IZZY_MAIN.counts).reduce((a, b) => a + b, 0));
  expect(view.ops, `${claim}: default plan accepts every price, item number and pack row once`).toHaveLength((PFG_IZZY_MAIN.counts.price ?? 0) + (PFG_IZZY_MAIN.counts.item_number ?? 0) + (PFG_IZZY_MAIN.counts.pack ?? 0));
  expect(view.expectedDigest, claim).toMatch(/^[a-f0-9]{64}$/);
  // "the same file staged twice returns the same report"
  const second = await stage(gm as { cookie: string });
  expect(second.status, claim).toBe(200);
  expect({ id: (second.json as View).batch.id, digest: (second.json as View).expectedDigest }, `${claim}: same file → same batch and digest`).toEqual({ id: view.batch.id, digest: view.expectedDigest });
  const reloaded = await gm.call("GET", `${importApi}/${view.batch.id}`) as { status: number; json: View };
  expect(reloaded.status, claim).toBe(200);
  expect(reloaded.json.expectedDigest, `${claim}: the stored report reloads to the same digest`).toBe(view.expectedDigest);
  // Staging writes nothing to the catalog: only the import ledger holds rows.
  const ledger = await readRows<{ id: string; status: string; row_count: number }>("vendor_import_batches", "id,status,row_count", { vendor_id: vendorId });
  expect(ledger, `${claim}: one staged batch`).toEqual([{ id: view.batch.id, status: "staged", row_count: PFG_IZZY_MAIN.rows }]);
  expect(await readRows<{ id: string }>("vendor_import_observations", "id", { batch_id: view.batch.id }), claim).toHaveLength(view.observations.length);
  expect(await readRows<{ id: string }>("vendor_import_applies", "id", { batch_id: view.batch.id }), `${claim}: nothing applied`).toHaveLength(0);
  expect(await readRows<{ id: string }>("vendor_price_history", "id", { source: "vendor_import" }), `${claim}: no imported price rows`).toHaveLength(0);
  // Applying is an owner-level act: the GM is refused before any step-up question.
  const applyAsGm = await call(gm, "POST", `${importApi}/${view.batch.id}/apply`, { decisions: {}, expectedDigest: view.expectedDigest });
  expect({ status: applyAsGm.status, code: applyAsGm.code }, `${claim}: GM cannot apply`).toEqual({ status: 403, code: "forbidden" });
  const employee = await sessionFor("maya", "EM");
  const asEmployee = await stage(employee as { cookie: string });
  expect({ status: asEmployee.status, code: (asEmployee.json as { code?: string } | null)?.code }, `${claim}: employee cannot stage`).toEqual({ status: 403, code: "forbidden" });
  expect(await readRows<{ id: string }>("vendor_import_batches", "id", { vendor_id: vendorId }), `${claim}: refusals write nothing`).toHaveLength(1);
});
