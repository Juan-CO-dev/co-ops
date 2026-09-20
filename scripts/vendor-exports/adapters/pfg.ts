import type { Adapter } from "../model";
import { parseCsv, parseDate, parsePack, parsePrice, parsePurchase } from "../parsers";

export const PFG_HEADER = "Category Name,Custom Product Description,Product Description,Brand,StateOfOrigin,Domestic,Custom Product Number,Product Number,Pack Size,UOM,Price,Last Purchase (qty & date)";

export const pfg: Adapter = {
  id: "pfg-customerfirst-v1", vendor: "pfg",
  detects: text => text.replace(/^\uFEFF/, "").startsWith("Performance Foodservice") && text.split(/\r?\n/).includes(PFG_HEADER),
  parse(text, sourceFile) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const header = lines.indexOf(PFG_HEADER);
    const generated = lines.findIndex(l => /^Generated: /.test(l));
    const account = /- (\d+)\)/.exec(lines[2] ?? "")?.[1];
    const date = /^Generated: (\d{2}\/\d{2}\/\d{4})/.exec(lines[generated] ?? "")?.[1];
    if (header < 0 || generated <= header || !account || !date || !lines[1]?.trim()) throw new Error(`${sourceFile}: missing PFG metadata/header/footer`);
    const exportedAt = parseDate(date);
    // Only parse the CSV body; the prose disclaimer is deliberately not CSV.
    return parseCsv(lines.slice(header + 1, generated).join("\n"))
      .filter(r => r.cells.some(c => c.trim()))
      .map(({ cells: c, line }) => {
        const sourceLine = line + header + 1;
        if (c.length !== 12 || !/^\d+$/.test(c[7] ?? "") || !c[2]?.trim()) throw new Error(`${sourceFile}:${sourceLine}: invalid PFG row (${c.length} columns)`);
        try {
          return {
            vendor: "pfg", source_file: sourceFile, source_line: sourceLine, account_id: account,
            list_name: lines[1]!.trim(), category: c[0]!, item_no: c[7]!, description: c[2]!, brand: c[3]!,
            ...parsePack(c[8]!), uom: c[9]!, ...parsePrice(c[10]!), ...parsePurchase(c[11]!), exported_at: exportedAt,
          };
        } catch (error) { throw new Error(`${sourceFile}:${sourceLine}: ${String(error)}`); }
      });
  },
};
