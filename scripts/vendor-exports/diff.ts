/** Offline: npx tsx scripts/vendor-exports/diff.ts [--as-of YYYY-MM-DD] */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXPORT_ROOT, ROOT, normalizeAll } from "./normalize";
import { buildDiff, packEqual, recent, type CatalogRow, type Evidence, type GuideRow } from "./diff-core";
import type { ExportRow } from "./model";

const GUIDE = "docs/seed/source/order-guide-2026-09-13.json";
const CATALOG = "docs/seed/source/vendor-exports/context/readiness-list-prod-2026-09-16.json";
const SEED = "docs/seed/source/vendor-exports/context/seed37-report-prod.txt";
const OLDER = "docs/seed/source/order-guide-caphill-2025-pfg.csv";
const V3A = "docs/superpowers/specs/2026-09-16-vendor-ordering-v3a-order-guides-design.md";
const REPORT_DIR = join(EXPORT_ROOT, "reports");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const cell = (value: unknown) => String(value ?? "unavailable").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
const table = (headers: string[], rows: unknown[][]) => [
  `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map(row => `| ${row.map(cell).join(" | ")} |`), "",
].join("\n");

function cite(e: Evidence): string {
  const path = relative(REPORT_DIR, join(ROOT, e.source_file)).replaceAll("\\", "/");
  return `[${basename(e.source_file)}:${e.source_line}](${path}#L${e.source_line})`;
}
function locate(path: string, token: string): Evidence {
  const index = read(path).split(/\r?\n/).findIndex(l => l.includes(token));
  if (index < 0) throw new Error(`Citation not found: ${path}: ${token}`);
  return { source_file: path, source_line: index + 1 };
}
const money = (cents: number | null | undefined) => cents == null ? "unavailable" : `$${(cents / 100).toFixed(Number.isInteger(cents) ? 2 : 4).replace(/(\.\d{2})0+$/, "$1")}`;
const price = (r: ExportRow) => r.price_per_lb_cents == null ? `${money(r.price_cents)}/${r.uom}` : `${money(r.price_per_lb_cents)}/lb`;
const purchase = (r: ExportRow) => r.last_purchase_date ? `${r.last_purchase_qty} ${r.last_purchase_uom} ${r.last_purchase_date}` : "never bought / no last purchase recorded";

export function loadInputs() {
  const source = JSON.parse(read(GUIDE)) as { sheets: { pfg_leonard: Omit<GuideRow, keyof Evidence>[] } };
  const snapshot = JSON.parse(read(CATALOG)) as { active: number; probed_at: string; skus: Omit<CatalogRow, keyof Evidence>[] };
  if (!Array.isArray(snapshot.skus) || snapshot.active !== snapshot.skus.length) throw new Error("Catalog snapshot count/shape mismatch");
  const guides: GuideRow[] = source.sheets.pfg_leonard.filter(g => g.vendor === "PFG").map(g => ({ ...g, ...locate(GUIDE, `"item": ${JSON.stringify(g.item)}`) }));
  const catalog: CatalogRow[] = snapshot.skus.map(s => ({ ...s, ...locate(CATALOG, `"id": ${JSON.stringify(s.id)}`) }));
  return { guides, catalog, snapshot };
}

export function writeReport(asOf = "2026-09-18"): { path: string; summary: string[] } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of requires YYYY-MM-DD");
  const normalized = normalizeAll(); // Use this manifest only; stale generated JSON is never an input.
  const rows = normalized.flatMap(n => n.rows).filter(r => r.vendor === "pfg");
  if (!rows.length) throw new Error("No PFG observations");
  const { guides, catalog, snapshot } = loadInputs();
  const d = buildDiff(rows, guides, catalog, asOf);
  const seedLines = read(SEED).split(/\r?\n/);
  const seedEvidence = (g: GuideRow) => {
    const i = seedLines.findIndex(l => l.includes(`: ${g.item} (pfg_leonard`));
    return i >= 0 ? `${seedLines[i]!.trim()} ${cite({ source_file: SEED, source_line: i + 1 })}` : `No individual exception; aggregate 55 matched ${cite({ source_file: SEED, source_line: 5 })}`;
  };
  const start = new Date(Date.parse(`${asOf}T00:00:00Z`) - 59 * 86400000).toISOString().slice(0, 10);
  const recentCount = d.items.filter(r => recent(r, asOf)).length;
  const segments: string[] = [
    `# PFG vendor-export diff — ${asOf}`,
    "Generated offline by `scripts/vendor-exports/diff.ts`. Review only; no database writes. Laminate sequence remains authoritative.",
    `Scope: account **${rows[0]!.account_id}**, Dupont/P Street (location code EM per task; no code rename). All five source files identify the same account. Snapshot timestamp ${snapshot.probed_at}. The catalog is global, not proof of per-shop stocking.`,
    `**Evidence limits:** the supplied catalog has ${catalog.length} active SKU names/vendor/readiness records but **no item numbers, pack values, UOM, or prices**. D/E are unavailable, not zero deltas or verified equal packs. B is a list of candidate catalog gaps, not proof that a vendor item number is absent. Name/family matches are review hypotheses. The seed report proves only its reported counts/exceptions, not a row-by-row SKU mapping.`,
    `**[ASSUMPTION] Window:** ${start} through ${asOf}, inclusive (60 calendar dates). Last Purchase is one event per item, not cumulative 60-day quantity. Repeated list rows never add volume. Quantity-weighted impact is only an absolute last-event proxy; /lb prices cannot be weighted with CS quantities. Prices are export-date quotes, not historical invoice prices.`,
    "Matching: vendor-scoped exact item number first; then token/family description suggestions (including brand). Distinct item numbers remain distinct. Fresh/dried, shell/cooked, grade, and pack differences require review. For duplicate observations, newest export date then newest purchase date wins; history wins a tie. Equal-date disagreements remain visible below. No fuzzy match authorizes a write.",
    "## Input inventory and reproducibility",
    table(["Input", "Rows / role", "SHA-256", "Source"], [
      ...normalized.filter(n => n.rows[0]?.vendor === "pfg").map(n => [n.rows[0]!.list_name, n.rows.length, createHash("sha256").update(read(n.rows[0]!.source_file)).digest("hex"), `${cite({ ...n.rows[0]!, source_line: 8 })}; rows ${n.rows[0]!.source_line}–${n.rows.at(-1)!.source_line}; account ${cite({ ...n.rows[0]!, source_line: 3 })}`]),
      ...[GUIDE, CATALOG, SEED].map(file => [basename(file), file === GUIDE ? `${guides.length} PFG guide rows` : file === CATALOG ? `${catalog.length} SKUs (${catalog.filter(s => s.vendor === "PFG").length} PFG)` : "seed outcome", createHash("sha256").update(read(file)).digest("hex"), cite({ source_file: file, source_line: file === CATALOG ? 3 : 1 })]),
    ]),
    "Counts independently checked with PowerShell ConvertFrom-Csv: history 97, Izzy 84, Opening 58, managed 14, Paper 20. The four list counts are each one higher than the brief; blank Last Purchase rows are retained. Managed rows have real categories. Category/list order never overrides the laminate.",
    `Summary: ${rows.length} observations; ${d.items.length} unique item numbers; ${recentCount} recent item numbers; ${d.gaps.length} guide gaps after description candidates; ${d.unmatchedPurchases.length} recent items without a PFG catalog name/family candidate; ${d.conflicts.length} guide lines with multiple item-number candidates.`,
    "## A. Guide lines with no PFG export row — true gaps under the matching rule",
    table(["Guide line", "Item no.", "Finding", "Seed 37", "Evidence"], d.gaps.length ? d.gaps.map(m => [m.guide.item, m.guide.item_number, "No exact number or description candidate in any supplied export", seedEvidence(m.guide), cite(m.guide)]) : [["None", "—", "Every guide line has a number or a description candidate", "—", cite(guides[0]!)] ]),
    "### A.1 Description-only candidates (not quietly treated as confirmed matches)",
    table(["Guide", "Printed no.", "Export candidates", "Judgment / evidence"], d.guideMatches.filter(m => !m.direct.length && m.candidates.length).map(m => [m.guide.item, m.guide.item_number, m.candidates.map(r => `${r.item_no} ${r.description} ${cite(r)}`).join("; "), `[ASSUMPTION] likely family; exact identity unverified. ${cite(m.guide)}; ${seedEvidence(m.guide)}`])),
    "## B. Purchases in the last 60 days with no catalog candidate",
    "No item-number join is possible against this snapshot. These are candidate gaps after vendor-scoped name/family screening; new SKU creation still needs a person. A same product at another vendor is not a PFG vendor line.",
    table(["Item", "Description / pack", "Export price", "Last purchase", "Other-vendor name candidates", "Evidence"], d.unmatchedPurchases.map(m => {
      const other = catalog.filter(s => {
        const tokens = s.name.toLowerCase().split(/\W+/).filter(t => t.length > 2);
        const words = `${m.row.description} ${m.row.brand}`.toLowerCase().split(/\W+/);
        return s.vendor !== "PFG" && tokens.length > 0 && tokens.every(t => words.includes(t));
      });
      return [m.row.item_no, `${m.row.description}; ${m.row.pack}`, price(m.row), purchase(m.row), other.length ? other.map(s => `${s.vendor}: ${s.name} ${cite(s)}`).join("; ") : "None by token screen", `${cite(m.row)}; catalog universe ${cite({ source_file: CATALOG, source_line: 4 })}`];
    })),
    "### B.1 Ambiguous catalog candidates — unresolved, not absent",
    table(["Item", "Description", "Catalog candidates", "Evidence"], d.matches.filter(m => recent(m.row, asOf) && m.skus.length > 1).map(m => [m.row.item_no, m.row.description, m.skus.map(s => `${s.name} ${cite(s)}`).join("; "), cite(m.row)])),
    "## C. Item-number conflict families",
    "[ASSUMPTION] Recommend the latest purchased semantic candidate as the observed live line, not an approved substitution. Different pack/grade/product and large price differences are flagged below; lower case price alone never wins over a smaller pack. All candidate families detected by the rules are listed, including alternatives with no purchases. The two egg guide rows deliberately appear separately.",
  ];
  const conflictRows: unknown[][] = [];
  for (const m of d.conflicts) {
    const family = [...new Map([...m.direct, ...m.candidates].map(r => [r.item_no, r])).values()];
    const semantic = m.candidates.length ? m.candidates : family;
    const ranked = [...semantic].sort((a, b) => (b.last_purchase_date ?? "").localeCompare(a.last_purchase_date ?? "") || a.item_no.localeCompare(b.item_no));
    const winner = ranked[0]!;
    const tied = ranked.filter(r => r.last_purchase_date === winner.last_purchase_date);
    const recommendation = !winner.last_purchase_date || tied.length > 1 ? "No unique recency winner; human decision" : `${winner.item_no} observed live (latest purchase)`;
    for (const row of family) {
      let risk = packEqual(row.pack, winner.pack) === true ? "same parsed pack" : "different pack; compare contents before switching";
      if (row.item_no === winner.item_no) risk = "recency recommendation only; grade/brand still matter";
      if (m.guide.item === "Basil") risk += "; 855571 costs $20.95 vs 23097 $10.34 at the same 1/1 LB — confirm premium/availability";
      if (m.guide.item === "Onion (White)") risk += "; both exports say YELLOW, guide says White";
      if (m.guide.item === "Shredded Mozz") risk += "; 1715 is mozzarella/provolone 50/50, 288533 whole-milk mozzarella";
      if (m.guide.item === "Eggs" && row.item_no === "439686") risk += "; WRONG for shell-egg guide line";
      const unit = row.price_cents != null && typeof row.pack_size === "number" && row.pack_qty && ["LB", "OZ"].includes(row.pack_unit ?? "")
        ? `${money(row.price_cents / (row.pack_qty * row.pack_size))}/${row.pack_unit} contents (as labeled)` : "—";
      conflictRows.push([`${m.guide.item} (${m.guide.item_number})`, row.item_no, `${row.description}; ${row.brand}`, row.pack, `${price(row)}; ${unit}`, purchase(row), `${recommendation}; ${risk}`, `${cite(m.guide)}; ${family.map(cite).join("; ")}`]);
    }
  }
  segments.push(table(["Guide family", "Item no.", "Export description / brand", "Pack", "Price", "Last purchase", "Recommendation / caution", "Evidence"], conflictRows));
  const conflicts = new Map<string, ExportRow[]>();
  for (const row of rows) conflicts.set(row.item_no, [...(conflicts.get(row.item_no) ?? []), row]);
  const disagree = [...conflicts.values()].filter(group => new Set(group.map(r => JSON.stringify([r.pack, r.uom, r.price_cents, r.price_per_lb_cents, r.last_purchase_qty, r.last_purchase_date]))).size > 1);
  segments.push("### C.1 Same item number, disagreeing observations", table(["Item", "Observation", "Evidence"], disagree.length ? disagree.flatMap(group => group.map(r => [r.item_no, `${r.list_name}: ${r.pack}; ${price(r)}; ${purchase(r)}`, cite(r)])) : [["None", "Repeated items agree on pack, price and last purchase in the supplied files", rows.map(r => r.source_file).filter((f, i, a) => a.indexOf(f) === i).map(f => cite({ source_file: f, source_line: 8 })).join("; ")]]));
  segments.push(
    "## D. Catalog versus export price deltas",
    "All catalog prices and bases are absent from this snapshot. The rows below are unambiguous name/family hypotheses, not confirmed item-number matches. Numerical deltas, percentages and impact order are unavailable; ties sort by SKU name/item. With an enriched snapshot, the tool ranks abs(delta × recent last-event qty), and refuses unequal/unknown packs or UOM. This is not 60-day spending.",
    table(["Catalog SKU / export item", "Match", "Catalog price", "Export price", "Delta", "%", "Recent last-event qty", "Absolute impact proxy", "Evidence"], d.comparisons.map(c => [
      `${c.sku.name} / ${c.row.item_no}`, c.method, money(c.row.price_per_lb_cents != null ? c.sku.price_per_lb_cents : c.sku.price_cents), price(c.row), money(c.price.delta), c.price.percent == null ? "unavailable" : `${c.price.percent.toFixed(2)}%`, c.price.weight ?? "basis unavailable", money(c.price.impact), `${cite(c.sku)}; ${cite(c.row)}; ${c.price.reason ?? "comparable"}`,
    ])),
    "## E. Catalog versus export pack mismatches",
    "The snapshot contains readiness flags such as missing_pack, not actual pack values. Unknown is not a mismatch and not a match. Different export packs for the same family are in C. No catalog pack equality can be established here.",
    table(["Catalog SKU / export item", "Catalog pack", "Export pack / UOM", "Result", "Evidence"], d.comparisons.filter(c => !c.sku.pack || packEqual(c.sku.pack, c.row.pack) !== true).map(c => [`${c.sku.name} / ${c.row.item_no}`, c.sku.pack ?? "not supplied", `${c.row.pack} / ${c.row.uom}`, !c.sku.pack ? "unavailable" : packEqual(c.sku.pack, c.row.pack) === false ? "MISMATCH" : "unparsed", `${cite(c.sku)}; ${cite(c.row)}`])),
    "## F. Lists versus purchases",
    "Sets use unique item numbers, not line count or quantity. Recent Jaccard = |list ∩ recent purchases| / |list ∪ recent purchases|; coverage = intersection / all recent purchases. History Jaccard also compares against all 97 history items, including old purchases. A live catalog list is not the laminate's sequence.",
    table(["List", "Unique items", "Recent overlap / universe", "Recent coverage", "Recent Jaccard", "All-history Jaccard", "Evidence"], d.lists.map(l => [l.name, l.count, `${l.overlap}/${l.recentCount}`, `${(l.coverage * 100).toFixed(2)}%`, l.jaccard.toFixed(4), l.historyJaccard.toFixed(4), `${cite({ ...l.observations[0]!, source_line: 2 })}; membership rows ${Math.min(...l.observations.map(r => r.source_line))}–${Math.max(...l.observations.map(r => r.source_line))}; history ${cite(rows.find(r => r.list_name === "Purchase History")!)}`])),
    `**[ASSUMPTION] ${d.lists[0]?.name ?? "No list"} is the best live-list candidate by overlap.** Import observations from all files, prefer current purchase evidence, preserve the laminate's ordering. A manager still confirms the operational list.`,
    "## G. Floor questions — data answers and remaining decisions",
  );
  const item = (id: string) => {
    const r = d.items.find(r => r.item_no === id);
    return r ? `${id}: ${r.description}, ${r.pack}, ${price(r)}, ${purchase(r)} ${cite(r)}` : `${id}: absent from supplied exports`;
  };
  const g = (name: string) => guides.find(row => row.item === name)!;
  segments.push(table(["Question", "Evidence", "Recommendation / unresolved decision"], [
    ["Eggs 439686", `${cite(g("Eggs"))}; ${cite(g("Eggs (cooked)"))}; ${item("439686")}; ${item("466355")}; ${item("517879")}; ${item("517842")}; ${seedEvidence(g("Eggs"))}; ${seedEvidence(g("Eggs (cooked)"))}`, "439686 belongs to Eggs (cooked), not Eggs. [ASSUMPTION] propose 517879 for shell Eggs (large AA, last 07-25); 517842 is medium AA (07-18, outside window). Confirm which size/pack is used before assigning the existing shell-egg SKU. Do not merge the two SKUs or auto-substitute 466355."],
    ["Dried Chives", `${cite(g("Dried Chives"))}: item_number and par say Fresh chives; note says use fresh chives instead. ${cite(g("Chives"))}: separate Produce line. ${item("855552")}; ${seedEvidence(g("Dried Chives"))}`, "The laminate explicitly suggests fresh, but the export proves only a fresh product, not dried equivalence. Leave the dry-goods line unresolved; ask whether it is a reminder for the same fresh stock or a separately stocked item. One SKU cannot occupy two guide lines."],
  ]));
  segments.push("## Scope and next evidence", table(["Issue", "Conclusion", "Evidence"], [
    ["V3-A egg premise", "V3-A §11 described the repeated egg number as a prep par rather than a second order line. The exports show distinct shell and cooked products; seed 37 actually left both lines ambiguous. CC should review that factual premise before applying the proposed mappings, preserving one placement per SKU.", `${cite(locate(V3A, "**Owner questions, answered"))}; ${cite({ source_file: SEED, source_line: 6 })}; ${cite({ source_file: SEED, source_line: 7 })}; ${item("439686")}; ${item("517879")}`],
    ["Second shop", "Dupont account 56910015 applies to P Street. Capitol Hill's account and current prices remain unknown. The 2025 Cap Hill guide shows historical PFG lines, not an account number or current price entitlement.", `${cite({ ...rows[0]!, source_line: 3 })}; ${cite({ source_file: OLDER, source_line: 4 })}; ${cite({ source_file: OLDER, source_line: 6 })}`],
    ["Substitution text", "474569 is the Product Number. '496 REPLACE 416637' is prose; neither 496 nor 416637 becomes an automatic identity or alias.", item("474569")],
    ["Missing comparison values", "CC needs an offline SKU export including vendor item_number, pack hierarchy, UOM, price basis and timestamp for a definitive B/D/E. This task made no prod reads.", cite({ source_file: CATALOG, source_line: 5 })],
  ]));
  const path = join(REPORT_DIR, `${asOf}-pfg-diff.md`);
  mkdirSync(REPORT_DIR, { recursive: true });
  const content = segments.join("\n\n") + "\n";
  writeFileSync(path, content);
  if (readFileSync(path, "utf8") !== content) throw new Error("Report readback failed");
  return { path, summary: [`${rows.length} observations; ${d.items.length} unique items; ${recentCount} recent`, `${d.gaps.length} guide gaps; ${d.unmatchedPurchases.length} candidate catalog gaps; ${d.conflicts.length} conflict families`, `Best list: ${d.lists[0]?.name}; D/E unavailable in supplied snapshot`] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--as-of")) throw new Error("Usage: diff.ts [--as-of YYYY-MM-DD]");
  const result = writeReport(args[1]);
  console.log(relative(ROOT, result.path));
  result.summary.forEach(s => console.log(s));
}
