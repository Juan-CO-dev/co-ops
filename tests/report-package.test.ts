import { describe, expect, it } from "vitest";
import { CSV_BOM, NOT_YET_AVAILABLE, toCsv, type ShopRef } from "@/lib/report-export-shared";
import {
  PACKAGE_COLUMNS,
  ROLLUP_SECTIONS,
  buildPackageTables,
  cashSection,
  cateringSection,
  inventorySection,
  packagePeriod,
  periodicPackageDue,
  purchasesSection,
  resolvePackageRecipients,
  salesSection,
  wasteSection,
  type PackageInput,
  type PackageRecipientRow,
} from "@/lib/report-package-shared";
import { PACKAGE_SECTIONS } from "@/lib/report-recipients-shared";
import { packageEmail, renderPackageFiles } from "@/lib/report-package";

const A: ShopRef = { id: "aaaaaaaa-0000-4000-8000-000000000001", code: "MEP", name: "Capitol Hill" };
const B: ShopRef = { id: "bbbbbbbb-0000-4000-8000-000000000002", code: "EM", name: "P Street" };

function input(over: Partial<PackageInput> = {}): PackageInput {
  return {
    shops: [A, B], from: "2026-10-06", to: "2026-10-06", cash: [], leads: [], quotes: [], payments: [], deliveries: [], deliveryLines: [],
    credits: [], waste: [], inventoryEvents: [], inventoryLines: [], baseUrl: "https://ops.example.com", ...over,
  };
}
const csvLines = (key: keyof typeof PACKAGE_COLUMNS, rows: ReturnType<typeof salesSection>) =>
  toCsv(PACKAGE_COLUMNS[key], rows).slice(CSV_BOM.length).trim().split("\r\n");

describe("the accountant contract (column names are pinned)", () => {
  it("every per-day section starts business_date, location_code, location_name, currency (per shop per day)", () => {
    for (const s of PACKAGE_SECTIONS) {
      expect(PACKAGE_COLUMNS[s].slice(0, 4).map((c) => c.key), s).toEqual(["business_date", "location_code", "location_name", "currency"]);
    }
    for (const r of ROLLUP_SECTIONS) {
      expect(PACKAGE_COLUMNS[r].slice(0, 5).map((c) => c.key), r).toEqual(["period_start", "period_end", "location_code", "location_name", "currency"]);
    }
  });

  it("carries every money field, tax, tips, discounts and payment type", () => {
    const keys = (s: keyof typeof PACKAGE_COLUMNS) => PACKAGE_COLUMNS[s].map((c) => c.key);
    expect(keys("sales")).toEqual(expect.arrayContaining(["gross", "discounts", "comps", "voids", "refunds", "net", "sales_tax", "tips", "service_fees", "delivery_fees", "gift_cards", "payment_type", "channel"]));
    expect(keys("cash")).toEqual(expect.arrayContaining(["projected", "drawer_total", "float", "deposit", "over_short", "cash_tips", "paid_ins", "paid_outs", "payment_type"]));
    expect(keys("catering")).toEqual(expect.arrayContaining(["subtotal", "delivery_fee", "service_charge", "gratuity", "tax", "total", "deposit", "paid_stripe", "paid_platform", "refunded", "outstanding", "payment_type"]));
    expect(keys("purchases")).toEqual(expect.arrayContaining(["invoice_total", "lines_total", "credit_amount"]));
  });

  it("snapshot", () => {
    expect(Object.fromEntries(Object.entries(PACKAGE_COLUMNS).map(([k, cols]) => [k, cols.map((c) => c.key).join(",")]))).toMatchInlineSnapshot(`
      {
        "cash": "business_date,location_code,location_name,currency,report_id,projected,drawer_total,float,deposit,over_short,cash_tips,count_method,paid_ins,paid_outs,paid_ins_outs_status,closer,signed_at,payment_type",
        "catering": "business_date,location_code,location_name,currency,lead_id,external_ref,lead_source,stage,money_status,customer,headcount,quote_id,quote_version,subtotal,delivery_fee,service_charge,gratuity,tax,total,deposit,value,value_basis,paid_total,paid_stripe,paid_manual,paid_platform,refunded,outstanding,payment_type",
        "inventory": "business_date,location_code,location_name,currency,row_type,count_event_id,counted_at,counted_by,sku_id,sku,level_label,qty,resolved_oz,cost_per_oz,value,cost_status",
        "purchases": "business_date,location_code,location_name,currency,kind,delivery_id,vendor_or_store,invoice_number,invoice_total,line_count,priced_line_count,lines_total,has_receipt_photo,detail_link,po_code,match_state,delivery_status,received_by,credit_count,credit_amount,credit_status",
        "rollup_cash_variance": "period_start,period_end,location_code,location_name,currency,cash_reports,deposits,over_short_total,over_total,short_total,cash_tips",
        "rollup_purchases_by_vendor": "period_start,period_end,location_code,location_name,currency,kind,vendor_or_store,deliveries,invoice_total,lines_total,credits_total",
        "rollup_sales_by_tax_category": "period_start,period_end,location_code,location_name,currency,tax_category,status,net_sales,sales_tax",
        "rollup_waste_by_category": "period_start,period_end,location_code,location_name,currency,category,tosses,est_cost,uncosted_tosses",
        "sales": "business_date,location_code,location_name,currency,status,gross,discounts,comps,voids,refunds,net,sales_tax,tips,service_fees,delivery_fees,gift_cards,payment_type,channel",
        "waste": "business_date,location_code,location_name,currency,item,category,tossed_qty,par_unit,tossed_at,tossed_by,source,unit_cost,est_cost,cost_status",
      }
    `);
  });
});

describe("sales: not_yet_available, never 0", () => {
  it("one row per shop per day, every money cell empty", () => {
    const lines = csvLines("sales", salesSection(input({ from: "2026-10-05", to: "2026-10-06" })));
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe(`2026-10-05,MEP,Capitol Hill,USD,${NOT_YET_AVAILABLE},,,,,,,,,,,,,`);
    expect(lines.join("\n")).not.toMatch(/(^|,)0(\.00)?(,|$)/m);
  });
});

it("cash: the live report per shop per day; paid-ins/outs say not_yet_available, not 0", () => {
  const rows = cashSection(input({ cash: [{
    id: "c1", location_id: A.id, report_date: "2026-10-06", projected_cents: 51000, drawer_total_cents: 71200, float_cents: 20000,
    deposit_cents: 51000, over_short_cents: 200, cash_tips_cents: 1500, count_method: "denomination", closer: "Ana", signed_at: "2026-10-07T02:10:00Z",
  }] }));
  expect(csvLines("cash", rows)[1]).toBe("2026-10-06,MEP,Capitol Hill,USD,c1,510.00,712.00,200.00,510.00,2.00,15.00,denomination,,,not_yet_available,Ana,2026-10-07T02:10:00.000Z,cash");
});

describe("catering (0195 money split)", () => {
  const lead = (id: string, stage: string, over: Record<string, unknown> = {}) => ({
    id, location_id: A.id, event_date: "2026-10-06", stage, lead_source: "web", external_ref: null, contact_name: "Dana", company: "Acme",
    headcount: 40, estimated_revenue_cents: 90000, ...over,
  });
  const quote = { id: "q1", pipeline_id: "L1", version: 2, subtotal_cents: 80000, delivery_fee_cents: 2500, service_charge_cents: 4000, gratuity_cents: 8000, tax_cents: 7800, total_cents: 102300, deposit_cents: 30000 };
  const rows = cateringSection(input({
    leads: [lead("L1", "completed"), lead("L2", "confirmed", { lead_source: "ezcater", external_ref: "ez-9", estimated_revenue_cents: 45000 }), lead("L3", "lost"), lead("L4", "quote_sent")],
    quotes: [{ ...quote, version: 1, id: "q0", total_cents: 1 }, quote],
    payments: [
      { quote_id: "q1", status: "paid", provider: "stripe", amount_cents: 30000 },
      { quote_id: "q1", status: "paid", provider: "manual", amount_cents: 20000 },
      { quote_id: "q1", status: "refunded", provider: "stripe", amount_cents: 5000 },
      { quote_id: "q1", status: "due", provider: null, amount_cents: 52300 },
    ],
  }));

  it("lost and unconfirmed leads never enter money", () => {
    expect(rows.map((r) => r.lead_id)).toEqual(["L1", "L2"]);
  });

  it("quoted event: the full charge stack from the LATEST accepted quote; outstanding = total − paid", () => {
    expect(rows[0]).toMatchObject({
      money_status: "earned", quote_id: "q1", quote_version: 2, subtotal: 80000, delivery_fee: 2500, service_charge: 4000, gratuity: 8000,
      tax: 7800, total: 102300, deposit: 30000, value: 102300, value_basis: "accepted_quote", paid_stripe: 30000, paid_manual: 20000,
      paid_total: 50000, refunded: 5000, outstanding: 52300, payment_type: "mixed", customer: "Acme (Dana)",
    });
  });

  it("an ezCater order with no app quote is paid on the platform: value = estimate, outstanding 0", () => {
    expect(rows[1]).toMatchObject({ money_status: "to_earn", value: 45000, value_basis: "estimated_revenue", paid_platform: 45000, paid_total: 45000, outstanding: 0, payment_type: "ezcater", total: null, tax: null });
  });
});

describe("purchases: deliveries AND store runs, with credits", () => {
  const rows = purchasesSection(input({
    deliveries: [
      { id: "d1", location_id: A.id, delivery_date: "2026-10-06", vendor_name: "Baldor", source_kind: "vendor", invoice_number: "INV-1", invoice_total: 412.37, match_state: "discrepant", delivery_status: "complete", receipt_url: "receipts/x.jpg", received_by: "Ana", po_code: "MEP-20261005-BALDOR" },
      { id: "d2", location_id: B.id, delivery_date: "2026-10-06", vendor_name: "Costco", source_kind: "store", invoice_number: null, invoice_total: null, match_state: "counted_only", delivery_status: "complete", receipt_url: null, received_by: "Bo", po_code: null },
    ],
    deliveryLines: [
      { delivery_id: "d1", qty_received: 2, unit_price: 100.5 }, { delivery_id: "d1", qty_received: 1, unit_price: null },
      { delivery_id: "d2", qty_received: 3, unit_price: 4.99 },
    ],
    credits: [
      { id: "cr1", location_id: A.id, delivery_id: "d1", vendor_name: "Baldor", source_kind: "vendor", amount_cents: 2010, status: "open", created_day: "2026-10-06" },
      { id: "cr2", location_id: A.id, delivery_id: null, vendor_name: "Baldor", source_kind: "vendor", amount_cents: 999, status: "resolved_credit", created_day: "2026-10-06" },
    ],
  }));
  it("each delivery: invoice total, priced lines total, receipt flag, detail link, credits", () => {
    expect(rows[0]).toMatchObject({ kind: "vendor", invoice_total: 41237, line_count: 2, priced_line_count: 1, lines_total: 20100, has_receipt_photo: true, detail_link: "https://ops.example.com/operations/receiving/d1", credit_count: 1, credit_amount: 2010, credit_status: "open" });
  });
  it("a store run is kind store_run; a credit filed with no delivery is its own row", () => {
    expect(rows[1]).toMatchObject({ kind: "store_run", vendor_or_store: "Costco", lines_total: 1497, has_receipt_photo: false, invoice_total: null, credit_amount: null });
    expect(rows[2]).toMatchObject({ kind: "credit", vendor_or_store: "Baldor", credit_amount: 999, credit_status: "resolved_credit" });
  });
});

it("waste: toss × one par unit's cost; an uncostable toss has an EMPTY cost and says why", () => {
  const rows = wasteSection(input({ waste: [
    { location_id: A.id, business_date: "2026-10-06", item: "Pesto", category: "sauces", tossed_qty: 1.5, par_unit: "quart", tossed_at: "2026-10-06T14:00:00Z", tossed_by: "Ana", source: "opening_p2", unit_cost: 6.4, cost_status: "costed" },
    { location_id: A.id, business_date: "2026-10-06", item: "Slaw", category: "salads", tossed_qty: 2, par_unit: "pan", tossed_at: null, tossed_by: null, source: "mid_day_p2", unit_cost: null, cost_status: "unpriced" },
  ] }));
  expect(rows.find((r) => r.item === "Pesto")).toMatchObject({ unit_cost: 640, est_cost: 960, cost_status: "costed" });
  expect(rows.find((r) => r.item === "Slaw")).toMatchObject({ unit_cost: null, est_cost: null, cost_status: "unpriced" });
});

it("inventory: value per count line and an event_total row (partial when a SKU is unpriced)", () => {
  const rows = inventorySection(input({
    inventoryEvents: [{ id: "e1", location_id: A.id, counted_at: "2026-10-06T20:00:00Z", counted_day: "2026-10-06", counted_by: "Cristian" }],
    inventoryLines: [
      { count_event_id: "e1", sku_id: "s1", sku: "Ham", level_label: "case", qty: 2, resolved_oz: 320, cost_per_oz: 0.25 },
      { count_event_id: "e1", sku_id: "s2", sku: "Bags", level_label: "each", qty: 100, resolved_oz: 0, cost_per_oz: null },
    ],
  }));
  expect(rows.map((r) => [r.row_type, r.sku ?? null, r.value, r.cost_status])).toEqual([
    ["line", "Bags", null, "unpriced"], ["line", "Ham", 8000, "priced"], ["event_total", null, 8000, "partial_1_unpriced"],
  ]);
});

describe("periods and due times (ET)", () => {
  it("daily = the day; weekly = prior Mon-Sun; monthly = the whole prior month (Jan → Dec)", () => {
    expect(packagePeriod("daily_close", "2026-10-06")).toEqual({ from: "2026-10-06", to: "2026-10-06" });
    expect(packagePeriod("weekly_mon", "2026-10-12")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(packagePeriod("monthly_1st", "2026-11-01")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(packagePeriod("monthly_1st", "2027-01-01")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("weekly is Monday from 06:00 ET only; monthly the 1st from 06:00 ET (EDT and EST)", () => {
    expect(periodicPackageDue(new Date("2026-10-12T09:59:00Z"))).toEqual([]); // Mon 05:59 EDT
    expect(periodicPackageDue(new Date("2026-10-12T10:00:00Z"))).toEqual([{ cadence: "weekly_mon", day: "2026-10-12" }]);
    expect(periodicPackageDue(new Date("2026-10-13T10:00:00Z"))).toEqual([]); // Tuesday
    expect(periodicPackageDue(new Date("2026-12-01T10:59:00Z"))).toEqual([]); // 05:59 EST
    expect(periodicPackageDue(new Date("2026-12-01T11:00:00Z"))).toEqual([{ cadence: "monthly_1st", day: "2026-12-01" }]);
    expect(periodicPackageDue(new Date("2027-03-01T11:00:00Z"))).toEqual([
      { cadence: "weekly_mon", day: "2027-03-01" }, { cadence: "monthly_1st", day: "2027-03-01" },
    ]);
  });
});

describe("package recipients", () => {
  const users = [
    { id: "pete", name: "Pete", email: "Pete@Example.com", role: "owner", language: "en", active: true },
    { id: "alex", name: "Alex", email: "alex@example.com", role: "gm", language: "es", active: true },
    { id: "gone", name: "Gone", email: "gone@example.com", role: "owner", language: "en", active: false },
  ];
  const row = (over: Partial<PackageRecipientRow>): PackageRecipientRow => ({
    id: "11111111-1111-4111-8111-111111111111", kind: "internal", user_id: "pete", email: null, display_name: "Pete", active: true,
    location_ids: null, packages: ["sales", "cash"], cadence: "daily_close", formats: ["csv", "pdf"], ...over,
  });
  const accountant = row({ id: "22222222-2222-4222-8222-222222222222", kind: "external", user_id: null, display_name: "Accountant", active: false, email: null, packages: [...PACKAGE_SECTIONS] });
  const resolve = (rows: PackageRecipientRow[], cadence: "daily_close" | "weekly_mon" = "daily_close") =>
    resolvePackageRecipients({ rows, users, memberships: [{ userId: "alex", locationId: A.id }], locationIds: [A.id, B.id], cadence });

  it("the accountant row with no email is a recipient_disabled skip; Pete gets every shop, csv + pdf", () => {
    const [pete, acct] = resolve([row({}), accountant]).sort((a, b) => (a.external ? 1 : 0) - (b.external ? 1 : 0));
    expect(pete).toMatchObject({ ref: "user:pete", email: "pete@example.com", skip: null, allShops: true, locationIds: [A.id, B.id], formats: ["csv", "pdf"], sections: ["sales", "cash"] });
    expect(acct).toMatchObject({ ref: `ext:${accountant.id}`, skip: "recipient_disabled", external: true, sections: [...PACKAGE_SECTIONS] });
  });

  it("enabled with an email, the accountant sends (every shop unless narrowed)", () => {
    expect(resolve([{ ...accountant, active: true, email: "books@example.com" }])[0]).toMatchObject({ skip: null, email: "books@example.com", allShops: true, language: "en" });
    expect(resolve([{ ...accountant, active: true, email: "books@example.com", location_ids: [B.id] }])[0]).toMatchObject({ locationIds: [B.id], allShops: false });
  });

  it("a GM's own row covers only their shops; an inactive user is skipped; the cadence must match; no packages = not a recipient", () => {
    expect(resolve([row({ user_id: "alex" })])[0]).toMatchObject({ locationIds: [A.id], language: "es", skip: null });
    expect(resolve([row({ user_id: "gone" })])[0]).toMatchObject({ skip: "inactive" });
    expect(resolve([row({})], "weekly_mon")).toEqual([]);
    expect(resolve([row({ packages: [] })])).toEqual([]);
  });
});

describe("tables and files", () => {
  it("daily = the recipient's sections only; weekly/monthly add the four rollups", () => {
    expect(buildPackageTables(input(), ["sales", "cash"], "daily_close").map((t) => t.key)).toEqual(["sales", "cash"]);
    expect(buildPackageTables(input(), ["cash"], "weekly_mon").map((t) => t.key)).toEqual(["cash", ...ROLLUP_SECTIONS]);
  });

  it("rollup cash variance sums per shop; sales by tax category is not_yet_available", () => {
    const c = (id: string, os: number) => ({ id, location_id: A.id, report_date: "2026-10-05", projected_cents: 0, drawer_total_cents: 0, float_cents: 0, deposit_cents: 1000, over_short_cents: os, cash_tips_cents: 100, count_method: "hand", closer: null, signed_at: "2026-10-06T00:00:00Z" });
    const tables = buildPackageTables(input({ from: "2026-10-05", to: "2026-10-11", cash: [c("1", 300), c("2", -500)] }), ["cash"], "weekly_mon");
    const variance = tables.find((t) => t.key === "rollup_cash_variance")!.rows;
    expect(variance[0]).toMatchObject({ location_code: "MEP", cash_reports: 2, deposits: 2000, over_short_total: -200, over_total: 300, short_total: -500, cash_tips: 200 });
    expect(variance[1]).toMatchObject({ location_code: "EM", cash_reports: 0, over_short_total: 0 });
    expect(tables.find((t) => t.key === "rollup_sales_by_tax_category")!.rows[0]).toMatchObject({ status: NOT_YET_AVAILABLE });
  });

  it("files: one CSV per table + one PDF; the email has no app link, says sales are coming, and refuses > 10 MB", async () => {
    const tables = buildPackageTables(input(), ["sales", "cash"], "daily_close");
    const files = await renderPackageFiles({ tables, recipient: { formats: ["csv", "pdf"], language: "en", allShops: true, name: "Pete" }, shops: [A, B], from: "2026-10-06", to: "2026-10-06", cadence: "daily_close", at: new Date("2026-10-07T03:00:00Z") });
    expect(files.map((f) => f.filename)).toEqual(["sales_all_2026-10-06_2026-10-06.csv", "cash_all_2026-10-06_2026-10-06.csv", "package_all_2026-10-06_2026-10-06.pdf"]);
    expect(files[2]!.content.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const mail = packageEmail({ recipient: { language: "en" }, cadence: "daily_close", from: "2026-10-06", to: "2026-10-06", files, sections: ["sales", "cash"], env: { language: "en", baseUrl: "https://ops.example.com" } });
    expect(mail.attachments).toHaveLength(3);
    expect(mail.html).not.toMatch(/href|ops\.example\.com/);
    expect(mail.text).toContain("Sales: coming soon");
    const huge = [{ filename: "x.csv", content: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: "text/csv" }];
    expect(() => packageEmail({ recipient: { language: "en" }, cadence: "daily_close", from: "a", to: "b", files: huge, sections: [], env: { language: "en", baseUrl: "" } })).toThrow(/too_large/);
  });

  it("csv only / pdf only follow the row's formats; Spanish files for a Spanish recipient", async () => {
    const tables = buildPackageTables(input(), ["cash"], "daily_close");
    const csvOnly = await renderPackageFiles({ tables, recipient: { formats: ["csv"], language: "es", allShops: false, name: "Alex" }, shops: [A], from: "2026-10-06", to: "2026-10-06", cadence: "daily_close", at: new Date() });
    expect(csvOnly.map((f) => f.filename)).toEqual(["cash_MEP_2026-10-06_2026-10-06.csv"]);
    const mail = packageEmail({ recipient: { language: "es" }, cadence: "daily_close", from: "2026-10-06", to: "2026-10-06", files: csvOnly, sections: ["cash"], env: { language: "es", baseUrl: "" } });
    expect(mail.subject).toContain("Paquete de reportes diario");
    expect(mail.text).not.toContain("Ventas");
  });
});
