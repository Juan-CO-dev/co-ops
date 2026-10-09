import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  EXPORT_COLUMNS,
  EXPORT_FAMILIES,
  NOT_YET_AVAILABLE,
  cashRows,
  centsToDollars,
  costingRows,
  csvField,
  dollarsToCents,
  exportFilename,
  formatCell,
  operationsRows,
  salesNotYetAvailableRows,
  toCsv,
  trendRows,
  type ShopRef,
} from "@/lib/report-export-shared";

const SHOP: ShopRef = { id: "loc-1", code: "MEP", name: "Capitol Hill" };
const shops = new Map([[SHOP.id, SHOP]]);

describe("CSV writer", () => {
  it("starts with the UTF-8 BOM, one header row, CRLF line ends and a trailing CRLF", () => {
    const csv = toCsv([{ key: "a", kind: "text" }, { key: "b", kind: "int" }], [{ a: "x", b: 1 }]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}a,b\r\nx,1\r\n`);
  });

  it("RFC 4180: commas, quotes, CR and LF are quoted; quotes are doubled", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvField(" padded")).toBe('" padded"');
  });

  it("round-trips a nasty field through the quoting", () => {
    const csv = toCsv([{ key: "note", kind: "text" }], [{ note: 'He said, "short $5"\nthen left' }]);
    expect(csv).toBe(`${CSV_BOM}note\r\n"He said, ""short $5""\nthen left"\r\n`);
  });

  it("defuses spreadsheet formulas in TEXT cells only (a negative amount stays a number)", () => {
    expect(formatCell("text", "=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(formatCell("text", "@cmd")).toBe("'@cmd");
    expect(formatCell("text", "-tip")).toBe("'-tip");
    expect(formatCell("money", -505)).toBe("-5.05");
  });
});

describe("cells", () => {
  it("cents → decimal dollars with integer math", () => {
    expect(centsToDollars(0)).toBe("0.00");
    expect(centsToDollars(5)).toBe("0.05");
    expect(centsToDollars(1234)).toBe("12.34");
    expect(centsToDollars(-1)).toBe("-0.01");
    expect(centsToDollars(-123456)).toBe("-1234.56");
    expect(centsToDollars(10.6)).toBe("0.11");
    expect(dollarsToCents(12.345)).toBe(1235);
    expect(dollarsToCents(null)).toBeNull();
  });

  it("an absent value is an empty cell, never a zero; the currency column always says USD", () => {
    expect(formatCell("money", null)).toBe("");
    expect(formatCell("int", undefined)).toBe("");
    expect(formatCell("currency", undefined)).toBe("USD");
  });

  it("ISO dates and ISO UTC timestamps", () => {
    expect(formatCell("date", "2026-10-06")).toBe("2026-10-06");
    expect(formatCell("date", "2026-10-06T04:00:00Z")).toBe("2026-10-06");
    expect(formatCell("datetime", "2026-10-06T23:15:00-04:00")).toBe("2026-10-07T03:15:00.000Z");
    expect(formatCell("bool", true)).toBe("true");
  });
});

describe("the column registry is the documented contract", () => {
  it("every family is registered, snake_case, unique, and carries currency iff it carries money", () => {
    for (const family of EXPORT_FAMILIES) {
      const cols = EXPORT_COLUMNS[family];
      const keys = cols.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(keys.includes("currency")).toBe(cols.some((c) => c.kind === "money"));
    }
  });

  it("stable names (renaming a column must fail this test first)", () => {
    expect(Object.fromEntries(EXPORT_FAMILIES.map((f) => [f, EXPORT_COLUMNS[f].map((c) => c.key).join(",")]))).toMatchInlineSnapshot(`
      {
        "cash": "business_date,location_code,location_name,report_id,projected,drawer_total,float,deposit,over_short,cash_tips,count_method,on_shift,signed_by,signed_at,over_short_note,payment_type,currency",
        "catering": "event_date,location_code,location_name,lead_id,event_name,time_window,headcount,lead_source,stage,money_status,value,currency",
        "costing": "menu_item_id,menu_item,section,menu_price,food_cost,food_cost_pct,margin,cost_status,currency",
        "counts": "location_code,location_name,sku_id,sku,dimension,anchor_at,anchor_age_days,anchor_qty,on_hand_qty,unit,anchor_stale",
        "operations": "business_date,location_code,location_name,report_type,report_id,status,submitted_by,under_par,over_par,skipped,temp_flags,cash_over_short,currency",
        "receiving": "delivery_date,location_code,location_name,delivery_id,vendor_or_store,invoice_number,line_count,received_by,match_state,delivery_status,has_receipt_photo,po_code",
        "sales": "row_type,period_start,period_end,location_code,location_name,coverage_status,covered_days,expected_days,toast_check_totals,checks,average_check,discounts,discount_count,sales_tax,tips,refunds_captured_so_far,refunds_captured_count,ezcater_sales,ezcater_orders,sales_before_refunds,amount_missing,unknown_tax,unknown_tips,unknown_discounts,gift_cards_excluded,gift_card_checks_excluded,ezcater_linked_toast_excluded,ezcater_linked_checks_excluded,void_checks,currency,sales_basis,refunds_basis,toast_gross,toast_discounts_comps,toast_item_voids,toast_service_charges,toast_sales_refunds,toast_item_sales_net,accounting_missing,sales_refund_missing,toast_net_basis",
        "team": "period_from,period_to,location_code,location_name,name,role,score,previous_score,health,tasks,finalizations,people_mgmt,oversight,notes",
        "trends_ops": "bucket_start,location_code,location_name,granularity,has_data,under_par,over_par,temp_flags,completion_pct,cash_over_short,currency",
        "written": "submitted_at,location_code,location_name,report_id,category,title,body,submitted_by,submitted_by_role,edit_count,last_edited_at",
      }
    `);
  });
});

describe("row mappers", () => {
  it("operations: one row per report, shop-coded, signals as counts, cash over/short in dollars", () => {
    const rows = operationsRows([
      { type: "cash", id: "c1", date: "2026-10-06", locationId: "loc-1", submitterName: "Ana", status: "flags",
        signalSummary: { underPar: 0, overPar: 0, skipped: 0, tempFlags: 0, cashOverShortCents: -250 } },
      { type: "closing", id: "k1", date: "2026-10-06", locationId: "loc-1", submitterName: null, status: "confirmed" },
    ], shops);
    const csv = toCsv(EXPORT_COLUMNS.operations, rows);
    expect(csv).toContain("2026-10-06,MEP,Capitol Hill,cash,c1,flags,Ana,0,0,0,0,-2.50,USD\r\n");
    expect(csv).toContain("2026-10-06,MEP,Capitol Hill,closing,k1,confirmed,,,,,,,USD\r\n");
  });

  it("cash: every money field, tips and the payment type, per shop per day", () => {
    const [row] = cashRows([{
      kind: "cash", id: "c1", date: "2026-10-06", locationId: "loc-1", projectedCents: 50000, drawerTotalCents: 70250,
      floatCents: 20000, depositCents: 50000, overShortCents: 250, cashTipsCents: 1200, countMethod: "denomination",
      onShift: [{ userId: null, name: "Ana" }, { userId: null, name: "Bo" }], signedByName: "Ana", signedAt: "2026-10-07T02:00:00Z",
      overShortNote: null, signals: {} as never,
    }], shops);
    expect(toCsv(EXPORT_COLUMNS.cash, [row!])).toContain(
      "2026-10-06,MEP,Capitol Hill,c1,500.00,702.50,200.00,500.00,2.50,12.00,denomination,Ana; Bo,Ana,2026-10-07T02:00:00.000Z,,cash,USD");
  });

  it("trends: a gap bucket stays empty, never a zero", () => {
    const rows = trendRows({
      granularity: "day", previous: null, cashVisible: false, totals: {} as never,
      current: [{ key: "2026-10-05", hasData: false, underPar: 0, overPar: 0, tempFlags: 0, cashOverShortCents: null, completionPct: null }],
    }, SHOP);
    expect(toCsv(EXPORT_COLUMNS.trends_ops, rows)).toContain("2026-10-05,MEP,Capitol Hill,day,false,,,,,,USD");
  });

  it("costing: a partial rollup exports no cost", () => {
    const rows = costingRows([{
      id: "m1", name: "Crunchy", nameEs: null, section: "subs", menuPrice: 13.5,
      rollup: { status: "partial", cost: null } as never, foodCostPct: null, marginDollars: null, overThreshold: false,
    }]);
    expect(toCsv(EXPORT_COLUMNS.costing, rows)).toContain("m1,Crunchy,subs,13.50,,,,partial,USD");
  });

  it("sales: a not_yet_available row per shop, every money cell empty (never 0)", () => {
    const csv = toCsv(EXPORT_COLUMNS.sales, salesNotYetAvailableRows([SHOP], { from: "2026-10-06", to: "2026-10-06" }));
    expect(csv).toContain(`total,2026-10-06,2026-10-06,MEP,Capitol Hill,${NOT_YET_AVAILABLE}${",".repeat(24)}USD`);
    expect(csv).not.toMatch(/,0\.00/);
  });
});

it("filenames are {family}_{shop}_{from}_{to}.{ext} and filesystem-safe", () => {
  expect(exportFilename("cash", "MEP", "2026-10-01", "2026-10-06", "csv")).toBe("cash_MEP_2026-10-01_2026-10-06.csv");
  expect(exportFilename("cash", "P St/../x", "a", "b", "pdf")).toBe("cash_P-St-x_a_b.pdf");
});
