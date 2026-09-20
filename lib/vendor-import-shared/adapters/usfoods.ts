import type { Adapter } from "../model";
import { parseCsv, parseDate, parsePack } from "../parsers";

const COMMON = "Product Number,Product Description,Product Brand,Product Package Size,Customer Product Number,USF Class Description,Storage Description";
export const USFOODS_HEADER = `Line Number,Group Name,${COMMON}`;
const lists: Record<string, string> = {
  "order-guide-514925-managed": "Order Guide #514925", "list-daily": "Daily List",
  "list-master": "Master List", "recently-purchased": "Recently Purchased", "list-catering-supplies": "Catering Supplies",
};

export const usfoods: Adapter = {
  id: "usfoods-moxe-list", vendor: "usfoods",
  detects: text => [COMMON, USFOODS_HEADER].includes(text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? ""),
  parse(text, sourceFile) {
    const name = /^(.*)-(\d{4})-(\d{2})-(\d{2})\.csv$/.exec(sourceFile.split(/[\\/]/).at(-1)!);
    if (!name || !lists[name[1]!]) throw new Error(`${sourceFile}: missing reviewed list/date metadata`);
    const date = parseDate(`${name[3]}/${name[4]}/${name[2]}`);
    const records = parseCsv(text);
    const grouped = records[0]!.cells[0] === "Line Number";
    if (grouped === (name[1] === "recently-purchased")) throw new Error(`${sourceFile}: list/header disagreement`);
    return records.slice(1).filter(r => r.cells.some(c => c.trim())).map(({ cells, line }) => {
      const c = cells.map(v => v.trim());
      if (c.length !== (grouped ? 9 : 7) || (grouped && !/^\d+$/.test(c[0]!))) throw new Error(`${sourceFile}:${line}: invalid MOXe row`);
      const v = grouped ? c.slice(2) : c;
      if (!/^\d+$/.test(v[0]!) || !v[1]) throw new Error(`${sourceFile}:${line}: missing product identity`);
      return {
        vendor: "usfoods", source_file: sourceFile, source_line: line,
        // Account/date are pinned capture metadata from the adjacent README/filename, not CSV fields.
        account_id: "71628390", list_name: lists[name[1]!]!, category: grouped ? c[1]! : "",
        item_no: v[0]!, description: v[1]!, brand: v[2]!,
        ...parsePack(cells[grouped ? 5 : 3]!), uom: "", price_basis: null,
        price_cents: null, price_per_lb_cents: null, last_purchase_qty: null,
        last_purchase_uom: null, last_purchase_date: null, exported_at: date,
        customer_product_no: v[4]!, product_class: v[5]!, storage: v[6]!,
      };
    });
  },
};
