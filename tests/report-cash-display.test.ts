import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CashReportDetailView } from "@/components/reports-hub/CashReportDetail";
import type { CashReportDetail } from "@/lib/reports-hub";

it.each(["en", "es"] as const)("renders negative deposits and signed variances correctly in %s", language => {
  const detail: CashReportDetail = {
    kind:"cash", date:"2026-10-07", locationId:"shop", projectedCents:100,
    drawerTotalCents:19850, floatCents:20000, depositCents:-150, overShortCents:150,
    cashTipsCents:0, countMethod:"hand", onShift:[], signedByName:null, signedAt:"2026-10-08T02:00:00Z",
    overShortNote:null, signals:{done:1,total:1,underPar:0,overPar:0,skipped:0,notStarted:0,tempFlags:0,cashOverShortCents:150},
  };
  const render = () => renderToStaticMarkup(React.createElement(CashReportDetailView,{detail,language}));
  let html = render();
  expect(html).toContain("-$1.50"); expect(html).toContain("+$1.50");
  expect(html).not.toContain("$-2.-50");
  detail.depositCents = 0; detail.overShortCents = -150; detail.signals.cashOverShortCents = -150;
  html = render();
  expect(html).toContain("$0.00"); expect(html).toContain("-$1.50"); expect(html).not.toContain("+$");
});
