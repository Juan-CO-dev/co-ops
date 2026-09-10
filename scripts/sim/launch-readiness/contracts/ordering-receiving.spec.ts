import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as driver from "../../concurrency/driver.mjs";
import { SIM_LOCATIONS, type LocationCode } from "../../personas-shared";
import { sessionFor, readRows } from "./opening.spec";
import { selectAllRows } from "../../../../lib/supabase-paginate";
import type { WalkerVendor } from "../../../../lib/ordering";
import type { RecordDeliveryInput } from "../../../../lib/receiving";
import type { ThreeWayView } from "../../../../lib/po-match-shared";

export { sessionFor, readRows };
export const PO_API = "/api/operations/ordering/po";
export const RECEIVE_API = "/api/operations/receiving";
export type Session = Awaited<ReturnType<typeof sessionFor>>;
export type FrozenLine = { skuId: string; name: string; qty: number; unitLabel: string | null; priceCents: number | null };
export type Po = { id: string; vendor_id: string; location_id: string; status: string; created_at: string; display_code: string; par_pass_event_id: string | null; confirmed_snapshot: { lines: FrozenLine[] } | null };
export type PoLine = { id: string; sku_id: string; order_qty: number | string; order_unit_label: string | null; price_cents_at_order: number | null };
export type Delivery = { id: string; location_id: string; vendor_id: string; purchase_order_id: string | null; invoice_number: string; invoice_total: number | string; delivery_date: string; delivery_status: string; receipt_url: string | null; created_at: string };
export type ReceiptLine = { id: string; vendor_item_id: string; qty_received: number | string; received_qty_at_level: number | string | null; received_level_label: string | null; expected_qty: number | string; unit_price: number | string; discrepancy_type: string | null; created_at: string };
export type Credit = { id: string; sku_id: string; delivery_item_id: string | null; reason: string; qty: number | string; amount_cents: number; status: string; location_id: string; vendor_id: string };
export const sortSku = <T extends { skuId: string }>(rows: T[]) => [...rows].sort((a, b) => a.skuId.localeCompare(b.skuId));

export async function call(session: Session, method: string, path: string, body?: unknown) {
  const response = await session.call(method, path, body);
  assert(response.status < 500, "ordering.raw-500");
  return response;
}

/** Named fixture ledger, not a first-SKU fallback. Quantities derive before UI input. */
export async function walkLedger(session: Session, code: LocationCode) {
  const response = await call(session, "GET", `/api/operations/ordering?locationId=${SIM_LOCATIONS[code].id}`);
  if (process.env.LRA_DEBUG) console.error(`[lra debug] walk ${code}: ${response.status} ${response.code ?? ""} keys=${Object.keys((response.json as object) ?? {}).join(",")} ${JSON.stringify(response.json ?? "").slice(0, 300)}`);
  assert.equal(response.status, 200, "ordering.walk.decisions");
  const vendors = (response.json as { walker: { vendors: WalkerVendor[] } }).walker?.vendors ?? [];
  if (process.env.LRA_DEBUG) console.error(`[lra debug] walk ${code}: vendors=${vendors.map(v => `${v.name}(${v.skus?.length ?? "?"})`).join(" | ")}`);
  const matches = vendors.filter(v => v.name === "Boar's Head");
  assert.equal(matches.length, 1, "ordering.walk.decisions: named vendor");
  const vendor = matches[0]!;
  if (process.env.LRA_DEBUG) console.error(`[lra debug] walk ${code}: named skus=${vendor.skus.filter(s => ["Provolone", "Genoa", "Turkey", "Capicola", "Pepperoni"].includes(s.name)).map(s => `${s.name}:sug=${s.suggestedQty}:par=${s.parToday}:unit=${s.orderUnitLabel}:${JSON.stringify(s).slice(0, 220)}`).join(" || ")}`);
  const decisions = ["Provolone", "Genoa", "Turkey", "Capicola", "Pepperoni"].map((name, index) => {
    const matches = vendor.skus.filter(s => s.name === name);
    assert.equal(matches.length, 1, "ordering.walk.decisions: named SKU");
    const sku = matches[0]!;
    // cold-empty carries NO on-hand evidence, so the walker honestly returns suggestedQty = null ("no fabricated
    // suggestion", lib/ordering.ts:495). A suggestion only appears once an opening/count/receipt exists (CC's aria
    // capture saw "Use the suggested order of 7" because the sim then held opening recounts). The contract therefore
    // takes the suggestion when it exists and otherwise orders the full par through the "empty shelf" path — the
    // cold state is recorded, never asserted away. (CC, 2026-09-10)
    assert(sku.parToday > 0, "ordering.walk.decisions: positive par");
    assert(sku.orderUnitLabel, "ordering.walk.decisions: real order unit");
    const suggested = index < 3 && sku.suggestedQty !== null && sku.suggestedQty > 0;
    if (index < 3 && !suggested && process.env.LRA_DEBUG) console.error(`[lra debug] walk ${code}: ${name} has no suggestion on cold-empty (advisoryOnHand=${JSON.stringify(sku.advisoryOnHand)}) → ordering full par`);
    const action = index < 3 ? (suggested ? "suggest" : "empty") : index === 3 ? "empty" : "full";
    return { ...sku, action, orderQty: action === "suggest" ? sku.suggestedQty! : action === "empty" ? Math.ceil(sku.parToday) : 0 };
  });
  return { vendor, decisions };
}
export async function orders(code: LocationCode, vendorId: string) {
  return (await readRows<Po>("purchase_orders", "id,vendor_id,location_id,status,created_at,display_code,par_pass_event_id,confirmed_snapshot", { location_id: SIM_LOCATIONS[code].id, vendor_id: vendorId })).filter(p => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(p.created_at)) === driver.todayEt());
}
export async function poById(id: string) {
  const rows = await readRows<Po>("purchase_orders", "id,vendor_id,location_id,status,created_at,display_code,par_pass_event_id,confirmed_snapshot", { id });
  assert.equal(rows.length, 1, "ordering.po.snapshot");
  return rows[0]!;
}
export const poLines = (poId: string) => readRows<PoLine>("po_lines", "id,sku_id,order_qty,order_unit_label,price_cents_at_order", { po_id: poId });
export const lineShape = (rows: PoLine[]) => sortSku(rows.map(l => ({ skuId: l.sku_id, qty: Number(l.order_qty), unit: l.order_unit_label })));
export const deliveries = (code: LocationCode, invoice: string) => readRows<Delivery>("vendor_deliveries", "id,location_id,vendor_id,purchase_order_id,invoice_number,invoice_total,delivery_date,delivery_status,receipt_url,created_at", { location_id: SIM_LOCATIONS[code].id, invoice_number: invoice });
export const receiptLines = (id: string) => readRows<ReceiptLine>("vendor_delivery_items", "id,vendor_item_id,qty_received,received_qty_at_level,received_level_label,expected_qty,unit_price,discrepancy_type,created_at", { delivery_id: id });
export const credits = (id: string) => readRows<Credit>("vendor_credits", "id,sku_id,delivery_item_id,reason,qty,amount_cents,status,location_id,vendor_id", { delivery_id: id });

export async function checkSnapshot(poId: string, expected: { skuId: string; qty: number; unit: string | null }[]) {
  const po = await poById(poId), lines = await poLines(poId);
  assert(po.confirmed_snapshot, "ordering.po.snapshot");
  assert.deepEqual(lineShape(lines), sortSku(expected), "ordering.po.snapshot");
  const frozen = po.confirmed_snapshot.lines;
  assert.deepEqual(sortSku(frozen.map(l => ({ skuId: l.skuId, qty: l.qty, unit: l.unitLabel }))), lineShape(lines), "ordering.po.snapshot");
  for (const line of frozen.filter(l => l.qty > 0)) {
    assert(Number.isInteger(line.priceCents) && line.priceCents! > 0, "ordering.po.snapshot: no fabricated price");
    assert.equal(lines.find(l => l.sku_id === line.skuId)!.price_cents_at_order, line.priceCents, "ordering.po.snapshot");
  }
  assert.equal(new Set(lines.map(l => l.sku_id)).size, lines.length, "ordering.po.snapshot");
  return po;
}

/** Independent cent arithmetic. Damaged uses the recorded short delta too (not all received units). */
export async function receivingLedger(po: Po, code: LocationCode, invoice: string) {
  assert(po.confirmed_snapshot, "ordering.po.snapshot");
  const named = ["Provolone", "Genoa", "Turkey", "Capicola"].map(name => {
    const found = po.confirmed_snapshot!.lines.filter(l => l.name === name && l.qty > 0);
    assert.equal(found.length, 1, "ordering.receiving.quantities");
    const line = found[0]!;
    assert(Number.isInteger(line.priceCents) && line.priceCents! > 0, "ordering.po.snapshot");
    return line;
  });
  const chain = await readRows<{ sku_id: string }>("sku_pack_levels", "sku_id", { active: "true" });
  const chained = new Set(chain.map(l => l.sku_id));
  const entries = named.map((line, index) => ({ ...line, received: index === 2 ? 0 : index < 2 ? line.qty - 1 : line.qty, flag: index === 0 || index === 2 ? "short" as const : index === 1 ? "damaged" as const : null, level: chained.has(line.skuId) ? line.unitLabel : null }));
  assert(entries.filter(l => l.received > 0).length === 3, "ordering.receiving.quantities");
  const invoiceCents = entries.reduce((sum, l) => sum + Math.round(l.qty * l.priceCents!), 0);
  const body: RecordDeliveryInput = {
    vendorId: po.vendor_id, locationId: SIM_LOCATIONS[code].id, purchaseOrderId: po.id,
    deliveryDate: driver.todayEt(), invoiceNumber: invoice, invoiceTotal: invoiceCents / 100,
    deliveryStatus: "complete", receiptUrl: null,
    lines: entries.filter(l => l.received > 0).map(l => ({ skuId: l.skuId, qtyReceived: l.received, receivedLevelLabel: l.level, expectedQty: l.qty, unitPrice: l.priceCents! / 100, discrepancyType: l.flag })),
    missingLines: entries.filter(l => l.received === 0).map(l => ({ skuId: l.skuId, expectedQty: l.qty, unitPrice: l.priceCents! / 100 })),
  };
  const expectedCredits = entries.filter(l => l.flag).map(l => ({ skuId: l.skuId, reason: l.flag!, qty: l.qty - l.received, cents: Math.round((l.qty - l.received) * l.priceCents!) }));
  return { entries, body, expectedCredits, invoiceCents };
}
export async function checkReceipt(code: LocationCode, ledger: Awaited<ReturnType<typeof receivingLedger>>) {
  const headers = await deliveries(code, ledger.body.invoiceNumber!);
  assert.equal(headers.length, 1, "ordering.receiving.quantities");
  const header = headers[0]!;
  assert.equal(header.purchase_order_id, ledger.body.purchaseOrderId, "ordering.receiving.quantities");
  assert.equal(header.vendor_id, ledger.body.vendorId, "ordering.receiving.quantities");
  assert.equal(header.delivery_date, ledger.body.deliveryDate, "ordering.receiving.quantities");
  assert.equal(header.delivery_status, "complete", "ordering.receiving.quantities");
  assert.equal(header.receipt_url, null, "ordering.receiving.quantities");
  assert.equal(Math.round(Number(header.invoice_total) * 100), ledger.invoiceCents, "ordering.receiving.quantities");
  const lines = await receiptLines(header.id);
  assert.deepEqual(sortSku(lines.map(l => ({ skuId: l.vendor_item_id, qty: Number(l.received_qty_at_level ?? l.qty_received), rawQty: Number(l.qty_received), level: l.received_level_label, expected: Number(l.expected_qty), cents: Math.round(Number(l.unit_price) * 100), flag: l.discrepancy_type }))), sortSku(ledger.entries.filter(l => l.received > 0).map(l => ({ skuId: l.skuId, qty: l.received, rawQty: l.received, level: l.level, expected: l.qty, cents: l.priceCents!, flag: l.flag }))), "ordering.receiving.quantities");
  return { header, lines };
}
export async function checkCredits(header: Delivery, lines: ReceiptLine[], ledger: Awaited<ReturnType<typeof receivingLedger>>) {
  const rows = await credits(header.id);
  assert.deepEqual(sortSku(rows.map(c => ({ skuId: c.sku_id, reason: c.reason, qty: Number(c.qty), cents: c.amount_cents }))), sortSku(ledger.expectedCredits), "ordering.receiving.credits");
  for (const credit of rows) {
    assert.equal(credit.status, "open", "ordering.receiving.credits");
    assert.equal(credit.location_id, header.location_id, "ordering.receiving.credits");
    assert.equal(credit.vendor_id, header.vendor_id, "ordering.receiving.credits");
    assert.equal(credit.delivery_item_id, lines.find(l => l.vendor_item_id === credit.sku_id)?.id ?? null, "ordering.receiving.credits");
  }
  assert.equal(rows.reduce((sum, c) => sum + c.amount_cents, 0), ledger.expectedCredits.reduce((sum, c) => sum + c.cents, 0), "ordering.receiving.credits");
  return rows;
}

/** Run the actual private loader, not a test reimplementation. AST selects its unchanged
 * source and two constants; its only runtime dependencies are the real paginator and
 * the lease-guarded SELECT-only driver. No server import, app client or new DB connection. */
export async function lastReceivedAt(skuIds: string[], locationId: string) {
  const source = readFileSync("lib/products.ts", "utf8");
  const file = ts.createSourceFile("products.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["loadLastReceivedAt", "DELIVERY_AT_LOCATION_EMBED", "DELIVERY_LOCATION_COLUMN"]);
  const selected = file.statements.filter(node => ts.isFunctionDeclaration(node) ? names.has(node.name?.text ?? "") : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.has(d.name.text)));
  assert.equal(selected.length, 3, "ordering.receipt.timestamp: loader source contract changed");
  const js = ts.transpileModule(selected.map(n => n.getText(file)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const loader = new Function("selectAllRows", `${js}\nreturn loadLastReceivedAt;`)(selectAllRows) as (db: typeof driver.db, ids: string[], location: string) => Promise<Map<string, string>>;
  return loader(driver.db, skuIds, locationId);
}

export async function checkThreeWay(session: Session, poId: string, ledger: Awaited<ReturnType<typeof receivingLedger>>) {
  const response = await call(session, "GET", `${PO_API}?poId=${poId}`);
  assert.equal(response.status, 200, "ordering.receiving.history");
  const payload = response.json as { detail: { status: string }; threeWay: ThreeWayView; openCreditSkuIds: string[] };
  assert.equal(payload.detail.status, "received", "ordering.receiving.history");
  assert(payload.threeWay?.hasDelivery && !payload.threeWay.hasInvoice, "ordering.receiving.history");
  assert.deepEqual([...payload.openCreditSkuIds].sort(), ledger.expectedCredits.map(c => c.skuId).sort(), "ordering.receiving.history");
  for (const line of ledger.entries) {
    const view = payload.threeWay.lines.find(l => l.key === line.skuId);
    assert(view, "ordering.receiving.history");
    assert.equal(view.orderedQty, line.qty, "ordering.receiving.history");
    assert.equal(view.receivedQty, line.received === 0 ? null : line.received, "ordering.receiving.history");
    if (line.received > 0 && line.received < line.qty) assert(view.flags.includes("short_received"), "ordering.receiving.history");
  }
}

export async function runOrderingContracts(pins: Record<string, string | undefined>) {
  const results: { id: string; assertionIds: string[]; status: "passed" | "failed"; failedAssertionIds: string[]; findingIds: string[]; skippedAssertionIds: string[]; race: { status: number; acknowledged: boolean }[] }[] = [];
  for (const code of ["EM", "MEP"] as const) {
    const result = { id: `ordering-contract-${code}`, assertionIds: [] as string[], status: "passed" as "passed" | "failed", failedAssertionIds: [] as string[], findingIds: [] as string[], skippedAssertionIds: [] as string[], race: [] as { status: number; acknowledged: boolean }[] };
    results.push(result);
    let current = "ordering.walk.decisions";
    const mark = (id: string) => { current = id; if (!result.assertionIds.includes(id)) result.assertionIds.push(id); };
    const fail = (error: unknown) => { const id = error instanceof Error ? error.message.match(/ordering\.[a-z0-9.-]+/)?.[0] ?? current : current; mark(id); result.status = "failed"; if (!result.failedAssertionIds.includes(id)) result.failedAssertionIds.push(id); };
    const soft = async (id: string, check: () => Promise<void>) => { mark(id); try { await check(); } catch (error) { fail(error); } };
    try {
      mark(current);
      const alias = code === "EM" ? "rosa" : "angel";
      const kh = await sessionFor(alias, code, pins), second = await sessionFor(alias, code, pins);
      const { vendor, decisions } = await walkLedger(kh, code);
      assert.deepEqual(await orders(code, vendor.vendorId), [], current);
      assert.deepEqual(await readRows("vendor_deliveries", "id", { location_id: SIM_LOCATIONS[code].id }), [], current);
      const request = { action: "generate_draft", locationId: SIM_LOCATIONS[code].id, vendorId: vendor.vendorId };
      mark("ordering.walk.persisted");
      const submitted = await call(kh, "POST", "/api/operations/ordering", { locationId: SIM_LOCATIONS[code].id, lines: decisions.map(d => ({ skuId: d.skuId, orderQty: d.orderQty })) });
      assert.equal(submitted.status, 201, current);
      const walk = submitted.json as { eventId: string; poError: boolean; pos: { vendorId: string; poId: string }[] };
      assert.equal(walk.poError, false, current);
      const owned = walk.pos.filter(p => p.vendorId === vendor.vendorId);
      assert.equal(owned.length, 1, current);
      const poId = owned[0]!.poId;
      const recorded = await readRows<{ sku_id: string; order_qty: number | string; order_unit_label: string | null }>("par_pass_lines", "sku_id,order_qty,order_unit_label", { event_id: walk.eventId });
      assert.deepEqual(sortSku(recorded.map(l => ({ skuId: l.sku_id, qty: Number(l.order_qty), unit: l.order_unit_label }))), sortSku(decisions.map(d => ({ skuId: d.skuId, qty: d.orderQty, unit: d.orderUnitLabel }))), current);
      mark("ordering.draft.matches-walk");
      const expected = decisions.filter(d => d.orderQty > 0).map(d => ({ skuId: d.skuId, qty: d.orderQty, unit: d.orderUnitLabel }));
      assert.deepEqual(lineShape(await poLines(poId)), sortSku(expected), current);
      assert.equal((await orders(code, vendor.vendorId)).length, 1, current);
      await soft("ordering.walk.duplicate-po", async () => {
        const refused = await call(kh, "POST", PO_API, request);
        assert.deepEqual({ status: refused.status, code: refused.code }, { status: 409, code: "po_exists" }, current);
        assert.equal((await orders(code, vendor.vendorId)).length, 1, current);
      });
      const original = await poLines(poId);
      mark("ordering.po.snapshot");
      assert.equal((await poById(poId)).par_pass_event_id, walk.eventId, current);
      assert.equal((await call(kh, "POST", PO_API, { action: "confirm", poId })).status, 200, current);
      let po = await checkSnapshot(poId, expected);
      assert.deepEqual((await poLines(poId)).map(l => l.id).sort(), original.map(l => l.id).sort(), current);
      mark("ordering.po.manual");
      assert.equal((await call(kh, "POST", PO_API, { action: "place", poId, channel: "phone", note: "Synthetic manual placement record" })).status, 200, current);
      assert.deepEqual(await readRows("po_transmissions", "channel", { po_id: poId }), [{ channel: "phone" }], current);
      po = await poById(poId); assert.equal(po.status, "placed", current);
      const ledger = await receivingLedger(po, code, `SIM-BH-${code}-1`);
      await soft("ordering.employee.denied", async () => {
        const employee = await sessionFor(code === "EM" ? "maya" : "luis", code, pins);
        for (const body of [request, { action: "place", poId, channel: "phone" }]) assert.equal((await call(employee, "POST", PO_API, body)).status, 403, current);
        assert.equal((await call(employee, "POST", RECEIVE_API, ledger.body)).status, 403, current);
        assert.deepEqual(await deliveries(code, ledger.body.invoiceNumber!), [], current);
      });
      await soft("ordering.cross-shop", async () => {
        const otherCode = code === "EM" ? "MEP" : "EM";
        const outsider = await sessionFor(code === "EM" ? "angel" : "rosa", otherCode, pins);
        // Send the victim shop, not a same-shop body with a different PO id.
        const denied = await call(outsider, "POST", RECEIVE_API, ledger.body);
        assert([403, 404].includes(denied.status), current);
        assert.deepEqual(await deliveries(code, ledger.body.invoiceNumber!), [], current);
      });
      mark("ordering.invoice.race");
      const intakeRace = await Promise.all([kh, second].map(s => s.call("POST", RECEIVE_API, ledger.body)));
      result.race.push(...intakeRace.map(r => ({ status: r.status, acknowledged: r.status === 201 })));
      await soft(current, async () => { assert(intakeRace.every(r => r.status < 500), "ordering.raw-500"); assert.deepEqual(intakeRace.map(r => r.status).sort(), [201, 409], current); assert.equal(intakeRace.find(r => r.status === 409)?.code, "duplicate_delivery", current); });
      mark("ordering.receiving.quantities");
      const receipt = await checkReceipt(code, ledger);
      await soft("ordering.receiving.credits", async () => { await checkCredits(receipt.header, receipt.lines, ledger); });
      const beforeCredits = await credits(receipt.header.id);
      await soft("ordering.invoice.serial", async () => {
        const retry = await call(kh, "POST", RECEIVE_API, ledger.body);
        assert.deepEqual({ status: retry.status, code: retry.code }, { status: 409, code: "duplicate_delivery" }, current);
      });
      // Cardinality/readback still run if the retry returned the wrong conflict code.
      await soft("ordering.invoice.serial-readback", async () => { assert.deepEqual(await checkReceipt(code, ledger), receipt, current); assert.deepEqual(await credits(receipt.header.id), beforeCredits, current); });
      await soft("ordering.receipt.timestamp", async () => {
        // The LINE's created_at is the lot instant by law (AGENTS.md § Product identity, FIFO): `loadLastReceivedAt`
        // ranks by vendor_delivery_items.created_at, so that — not the header — is the oracle. (CC, 2026-09-10; LRA-209 rejected)
        const actual = await lastReceivedAt(receipt.lines.map(l => l.vendor_item_id), SIM_LOCATIONS[code].id);
        for (const line of receipt.lines) assert.equal(actual.get(line.vendor_item_id), line.created_at, current);
      });
      await soft("ordering.receiving.history", async () => { await checkThreeWay(await sessionFor(alias, code, pins), poId, ledger); });
      await soft("ordering.reconcile.kh-denied", async () => { assert.equal((await call(kh, "POST", PO_API, { action: "reconcile", poId })).status, 403, current); assert.equal((await poById(poId)).status, "received", current); });
      // Open credits legitimately forbid reconciliation. A separate clean control PO
      // proves an actual successful SL transition, without resolving or deleting credits.
      await soft(code === "EM" ? "ordering.reconcile.sl-allowed" : "ordering.reconcile.gm-allowed", async () => {
        const manager = await sessionFor(code === "EM" ? "tommy" : "marcus", code, pins);
        const blocked = await call(manager, "POST", PO_API, { action: "reconcile", poId });
        assert.deepEqual({ status: blocked.status, code: blocked.code }, { status: 409, code: "open_credits" }, current);
        const control = decisions.find(d => d.name === "Capicola")!;
        const submitted = await call(kh, "POST", "/api/operations/ordering", { locationId: SIM_LOCATIONS[code].id, lines: [{ skuId: control.skuId, orderQty: 2 }] });
        assert.equal(submitted.status, 201, current);
        const controlPoId = (submitted.json as { pos: { poId: string }[] }).pos[0]!.poId;
        assert.equal((await call(kh, "POST", PO_API, { action: "confirm", poId: controlPoId })).status, 200, current);
        assert.equal((await call(kh, "POST", PO_API, { action: "place", poId: controlPoId, channel: "in_person" })).status, 200, current);
        const controlPrice = (await poById(controlPoId)).confirmed_snapshot!.lines[0]!.priceCents;
        assert(Number.isInteger(controlPrice) && controlPrice! > 0, current);
        const received = await call(kh, "POST", RECEIVE_API, { vendorId: vendor.vendorId, locationId: SIM_LOCATIONS[code].id, purchaseOrderId: controlPoId, invoiceNumber: `SIM-BH-${code}-CONTROL`, deliveryDate: driver.todayEt(), lines: [{ skuId: control.skuId, qtyReceived: 2, expectedQty: 2, unitPrice: controlPrice! / 100 }] });
        assert.equal(received.status, 201, current);
        assert.equal((await call(kh, "POST", PO_API, { action: "reconcile", poId: controlPoId })).status, 403, current);
        assert.equal((await call(manager, "POST", PO_API, { action: "reconcile", poId: controlPoId })).status, 200, current);
        assert.equal((await poById(controlPoId)).status, "reconciled", current);
      });
      // Finding probes run after the primary receipt and on a fresh vendor, so a
      // second draft cannot change which PO the receiving template selects.
      await soft("ordering.draft.race", async () => {
        const response = await call(kh, "GET", `/api/operations/ordering?locationId=${SIM_LOCATIONS[code].id}`);
        assert.equal(response.status, 200, current);
        const vendors = (response.json as { walker: { vendors: WalkerVendor[] } }).walker.vendors;
        let fresh: WalkerVendor | undefined;
        for (const candidate of [...vendors].sort((a, b) => a.vendorId.localeCompare(b.vendorId))) {
          if (candidate.vendorId !== vendor.vendorId && candidate.skus.some(s => s.suggestedQty !== null && s.suggestedQty > 0) && (await orders(code, candidate.vendorId)).length === 0) {
            fresh = candidate;
            break;
          }
        }
        if (!fresh) {
          // No restore or fixture mutation just to manufacture a suggestion.
          result.skippedAssertionIds.push("ordering.draft.race", "ordering.draft.ignores-typed", "ordering.walk.duplicate-po");
          return;
        }
        const suggestions = fresh.skus.filter(s => s.suggestedQty !== null && s.suggestedQty > 0);
        // These pending walk decisions deliberately differ from the system ledger.
        const typed = suggestions.map(s => ({ skuId: s.skuId, qty: s.suggestedQty! + 1, unit: s.orderUnitLabel }));
        const generate = { action: "generate_draft", locationId: SIM_LOCATIONS[code].id, vendorId: fresh.vendorId };
        const race = await Promise.all([kh, second].map(s => s.call("POST", PO_API, generate)));
        result.race.push(...race.map(r => ({ status: r.status, acknowledged: r.status === 201 })));
        await soft("ordering.draft.race", async () => {
          assert(race.every(r => r.status < 500), "ordering.raw-500");
          assert.deepEqual(race.map(r => r.status).sort(), [201, 409], current);
          assert.equal(race.find(r => r.status === 409)?.code, "po_exists", current);
        });
        const created = await orders(code, fresh.vendorId);
        assert.equal(created.length, 1, "ordering.draft.race");
        assert(race.some(r => r.status === 201 && (r.json as { poId?: string })?.poId === created[0]!.id), "ordering.draft.race");
        assert.equal(created[0]!.par_pass_event_id, null, "ordering.draft.race");
        const generatedLines = lineShape(await poLines(created[0]!.id));
        assert.deepEqual(generatedLines, sortSku(suggestions.map(s => ({ skuId: s.skuId, qty: s.suggestedQty!, unit: s.orderUnitLabel }))), "ordering.draft.race");
        await soft("ordering.draft.ignores-typed", async () => {
          if (JSON.stringify(generatedLines) !== JSON.stringify(sortSku(typed))) result.findingIds.push("LRA-207");
          assert.deepEqual(generatedLines, sortSku(typed), "ordering.draft.ignores-typed: LRA-207 system draft ignores pending walk decisions");
        });
        await soft("ordering.walk.duplicate-po", async () => {
          const recorded = await call(kh, "POST", "/api/operations/ordering", { locationId: SIM_LOCATIONS[code].id, lines: typed.map(l => ({ skuId: l.skuId, orderQty: l.qty })) });
          assert.equal(recorded.status, 201, current);
          const walk = recorded.json as { eventId: string; poError: boolean; pos: { vendorId: string; poId: string }[] };
          const after = await orders(code, fresh.vendorId);
          const duplicate = after.find(p => p.id !== created[0]!.id && p.par_pass_event_id === walk.eventId);
          if (duplicate) {
            result.findingIds.push("LRA-206");
            assert.equal(walk.poError, false, current);
            assert.equal(after.length, 2, current);
            assert(walk.pos.some(p => p.vendorId === fresh.vendorId && p.poId === duplicate.id), current);
            assert.deepEqual(lineShape(await poLines(duplicate.id)), sortSku(typed), current);
          }
          // A reproduced finding stays RED, while all remaining shops still run.
          assert.equal(after.length, 1, "ordering.walk.duplicate-po: LRA-206 generate then Record walk creates a second PO");
        });
      });
    } catch (error) { fail(error); }
  }
  return results;
}
