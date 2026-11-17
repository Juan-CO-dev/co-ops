import type { Adapter, ExportRow } from "../model";
import { parseCsv, parseDate, parsePack, parsePrice } from "../parsers";

/** US Foods MOXe invoice "CSV Full" export: one row per invoice line, 57 columns.
 *  BillToStreet and ShipToStreet each appear twice, so columns are read by POSITION against this exact header. */
export const USFOODS_INVOICE_HEADER = "DocumentNumber,DocumentType,DocumentDate,CustomerNumber,CustomerName,AccountNumber,PurchaseOrder,USFSalesLocation,USFSalesRep,DateOrdered,OrderNumber,PaymentTerms,DateShipped,DeliveryAdjustment,NetAmountAfter Adjustment,NetAmountBefore Adj,CreditMemoNumber,CreditMemoDate,BillToName,BillToStreet,BillToStreet,BillToCity,BillToState,BillToZip,BillToPhone,BillToAttn,ShipToName,ShipToStreet,ShipToStreet,ShipToCity,ShipToState,ShipToZip,ShipToPhone,ShipToDept,ShipToDeptName,RemitToName,RemitToStreet1,RemitToStreet2,RemitToCity,RemitToState,RemitToZip,RemitToPhone,ShipFromStreet1,ShipFromStreet2,ShipFromCity,ShipFromState,ProductNumber,ProductDescription,Product Label,PackingSize,Weight,QtyOrder,QtyShip,QtyAdjust,PricingUnit,UnitPrice,ExtendedPrice";
const COLUMNS = USFOODS_INVOICE_HEADER.split(",");
const at = (name: string) => COLUMNS.indexOf(name);
const C = {
  doc: at("DocumentNumber"), type: at("DocumentType"), date: at("DocumentDate"), customer: at("CustomerNumber"),
  credit: at("CreditMemoNumber"), item: at("ProductNumber"), description: at("ProductDescription"), brand: at("Product Label"),
  pack: at("PackingSize"), weight: at("Weight"), qtyShip: at("QtyShip"), unit: at("PricingUnit"), price: at("UnitPrice"),
};
/** The pricing unit names what UnitPrice is per. LB = catch weight: the case varies, the pound is the price. */
const BASIS: Record<string, NonNullable<ExportRow["price_basis"]>> = { CS: "per case", CA: "per case", LB: "per lb", EA: "per each", DZ: "per dozen" };
/** The only PricingUnit values this adapter prices. Any other (BD, BNDL, BG, blank, …) is marked
 *  `price_unit_unsupported` and the matcher holds the line for a person; its UOM is never read as a basis. */
export const USFOODS_INVOICE_PRICING_UNITS: readonly string[] = Object.keys(BASIS);
const signedNumber = /^-?\d+(?:\.\d+)?$/;

function records(text: string) {
  const all = parseCsv(text);
  return all.slice(1).filter(r => r.cells.some(c => c.trim()));
}
/** Only an invoice line prices: a credit memo, an unknown document type, or a negative/zero line is never price evidence. */
function isPriceLine(c: readonly string[]): boolean {
  const type = c[C.type]!.trim().toUpperCase();
  if (!/^[A-Z0-9]+_INV$/.test(type) || c[C.credit]!.trim()) return false;
  const qty = c[C.qtyShip]!.trim(), price = c[C.price]!.trim();
  if (!signedNumber.test(qty) || !signedNumber.test(price)) return true; // malformed: let parse refuse it by name
  return Number(qty) >= 0 && Number(price) > 0;
}

export const usfoodsInvoice: Adapter = {
  id: "usfoods-invoice-csv", vendor: "usfoods",
  detects: text => text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] === USFOODS_INVOICE_HEADER,
  ignoredRows(text) {
    return records(text).filter(({ cells }) => cells.length === COLUMNS.length && !isPriceLine(cells)).length;
  },
  parse(text, sourceFile) {
    return records(text).flatMap(({ cells, line }): ExportRow[] => {
      if (cells.length !== COLUMNS.length) throw new Error(`${sourceFile}:${line}: invalid US Foods invoice row (${cells.length} columns)`);
      const c = cells.map(v => v.trim());
      if (!isPriceLine(c)) return [];
      if (!/^\d+$/.test(c[C.item]!) || !c[C.description] || !c[C.doc] || !/^\d+$/.test(c[C.customer]!)) {
        throw new Error(`${sourceFile}:${line}: invalid US Foods invoice row (identity)`);
      }
      try {
        const date = parseDate(c[C.date]!);
        const unit = c[C.unit]!.toUpperCase();
        const basis = BASIS[unit] ?? null;
        const perLb = unit === "LB";
        const qty = Number(c[C.qtyShip]);
        const weight = Number(c[C.weight]);
        if (!signedNumber.test(c[C.qtyShip]!) || !Number.isFinite(qty)) throw new Error(`Invalid quantity: ${c[C.qtyShip]}`);
        return [{
          vendor: "usfoods", source_file: sourceFile, source_line: line, account_id: c[C.customer]!,
          list_name: `US Foods invoice ${c[C.doc]}`, category: "", item_no: c[C.item]!, description: c[C.description]!, brand: c[C.brand]!,
          ...parsePack(c[C.pack]!),
          ...(perLb ? { pack_catch_weight: true as const, ...(signedNumber.test(c[C.weight]!) && weight > 0 ? { net_wt_lb: weight } : {}) } : {}),
          uom: unit, price_basis: basis, ...(basis ? {} : { price_unit_unsupported: true as const }), ...parsePrice(`${c[C.price]}${perLb ? "/lb" : ""}`),
          last_purchase_qty: qty, last_purchase_uom: unit, last_purchase_date: date, exported_at: date,
          // Ordered but not shipped: the line still states a price, but it is shown flagged and left unselected.
          ...(qty === 0 ? { flags: ["not_shipped" as const] } : {}),
        }];
      } catch (error) { throw new Error(`${sourceFile}:${line}: ${String(error)}`); }
    });
  },
};
