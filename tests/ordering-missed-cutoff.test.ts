/**
 * D-63 (Juan 2026-10-13): a vendor order cutoff that has PASSED with no placed order is red —
 * "missed cutoff — call the vendor" — on the Pulse (v1 banner + v2 Needs attention), the dashboard
 * ordering tile and the /ordering page. A still-open cutoff keeps its old (yellow on v1) advisory.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { cutoffMissed } from "@/lib/dashboard-status-shared";
import { etClockTime, etWallClockToUtcIso, etWallMinutesInstant } from "@/lib/operational-day";
import { etWallTime } from "@/lib/report-digests-shared";
import { pulseScore, type AttentionItem } from "@/lib/midshift-shared";
import { AttentionBanner } from "@/components/midshift/AttentionBanner";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { OrderingCutoffAttention } from "@/lib/ordering";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { OrderingSurfaces } = await import("@/components/ordering/OrderingSurfaces");

describe("cutoffMissed", () => {
  const cutoff = "2026-10-13T15:00:00.000Z"; // 11:00 AM ET
  it("is missed at and after the cutoff instant, open before it", () => {
    expect(cutoffMissed(cutoff, Date.parse("2026-10-13T14:59:59Z"))).toBe(false);
    expect(cutoffMissed(cutoff, Date.parse(cutoff))).toBe(true);
    expect(cutoffMissed(cutoff, Date.parse("2026-10-13T19:30:00Z"))).toBe(true);
  });
  it("an unparseable instant is never missed", () => {
    expect(cutoffMissed("not a date", Date.now())).toBe(false);
  });
});

describe("review #1: the cutoff instant reads the ET offset AT the cutoff time (DST days)", () => {
  it("fall back, Sun 2026-11-01: an 11:00 cutoff is 11:00 EST (16:00Z), so 10:30 ET is NOT missed", () => {
    const iso = etWallClockToUtcIso("2026-11-01", "11:00:00")!;
    expect(iso).toBe("2026-11-01T16:00:00.000Z");
    expect(etClockTime(iso)).toBe("11:00");
    expect(cutoffMissed(iso, Date.parse("2026-11-01T15:30:00Z"))).toBe(false); // 10:30 EST
    expect(cutoffMissed(iso, Date.parse("2026-11-01T16:00:00Z"))).toBe(true);
  });
  it("spring forward, Sun 2026-03-08: an 11:00 cutoff is 11:00 EDT (15:00Z), so 11:30 ET IS missed", () => {
    const iso = etWallClockToUtcIso("2026-03-08", "11:00")!;
    expect(iso).toBe("2026-03-08T15:00:00.000Z");
    expect(etClockTime(iso)).toBe("11:00");
    expect(cutoffMissed(iso, Date.parse("2026-03-08T15:30:00Z"))).toBe(true); // 11:30 EDT
    expect(cutoffMissed(iso, Date.parse("2026-03-08T14:30:00Z"))).toBe(false); // 10:30 EDT
  });
  it("ordinary days in both halves of the year, and malformed input is null", () => {
    expect(etWallClockToUtcIso("2026-10-13", "16:00:00")).toBe("2026-10-13T20:00:00.000Z");
    expect(etWallClockToUtcIso("2026-01-13", "16:00:00")).toBe("2026-01-13T21:00:00.000Z");
    for (const bad of ["24:00", "11:60", "noon", "11", ""]) expect(etWallClockToUtcIso("2026-10-13", bad)).toBeNull();
    expect(etWallClockToUtcIso("10/13/2026", "11:00")).toBeNull();
  });
});

describe("review 2: the DST edge hours follow the digest helper's policy (one resolver)", () => {
  it("SKIPPED hour — 02:30 on 2026-03-08 never happens: rolls FORWARD to 07:30Z (03:30 EDT), same as the digest", () => {
    const iso = etWallClockToUtcIso("2026-03-08", "02:30:00")!;
    expect(iso).toBe("2026-03-08T07:30:00.000Z");
    expect(iso).toBe(etWallTime("2026-03-08", 150).toISOString());
    expect(etClockTime(iso)).toBe("03:30");
    // So at 01:45 EST (06:45Z) the cutoff is NOT yet missed; it is once the gap is over.
    expect(cutoffMissed(iso, Date.parse("2026-03-08T06:45:00Z"))).toBe(false);
    expect(cutoffMissed(iso, Date.parse("2026-03-08T07:30:00Z"))).toBe(true);
  });
  it("REPEATED hour — 01:30 on 2026-11-01 happens twice: the FIRST (EDT) occurrence, 05:30Z, same as the digest", () => {
    const iso = etWallClockToUtcIso("2026-11-01", "01:30")!;
    expect(iso).toBe("2026-11-01T05:30:00.000Z");
    expect(iso).toBe(etWallTime("2026-11-01", 90).toISOString());
  });
  it("agrees with the digest helper minute-for-minute across both transition days", () => {
    for (const day of ["2026-03-08", "2026-11-01", "2026-10-13", "2026-01-13"]) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
        const mm = String(minutes % 60).padStart(2, "0");
        expect(etWallClockToUtcIso(day, `${hh}:${mm}:00`), `${day} ${hh}:${mm}`).toBe(etWallTime(day, minutes).toISOString());
      }
    }
    expect(etWallTime("2026-03-08", 150).getTime()).toBe(etWallMinutesInstant("2026-03-08", 150).getTime());
  });
});

describe("v1 mid-shift banner", () => {
  const missed: AttentionItem = { kind: "ordering_cutoff_missed", count: 1, cutoffVendors: [{ name: "PFG", time: "11:00 AM", hasDraft: true }] };
  const open: AttentionItem = { kind: "ordering_cutoff", count: 1, cutoffVendors: [{ name: "Ferraro", time: "5:00 PM", hasDraft: false }] };
  it("a missed cutoff turns the Pulse score red; an open one alone stays yellow", () => {
    expect(pulseScore([missed])).toBe("red");
    expect(pulseScore([open])).toBe("yellow");
  });
  it("renders the missed line in red with the call-the-vendor errand", () => {
    const html = renderToStaticMarkup(createElement(AttentionBanner, { items: [missed, open], locationId: "shop", language: "en" }));
    expect(html).toContain("PFG: missed the 11:00 AM cutoff — call the vendor");
    expect(html).toMatch(/text-co-cta-text[^>]*><a[^>]*href="\/ordering\?location=shop"/);
    expect(html).toContain("Ferraro cutoff 5:00 PM — no draft yet");
  });
  it("pluralizes on the missed count", () => {
    const html = renderToStaticMarkup(createElement(AttentionBanner, {
      items: [{ ...missed, count: 2, cutoffVendors: [...missed.cutoffVendors!, { name: "Baldor", time: "11:30 AM", hasDraft: false }] }], locationId: "shop", language: "es",
    }));
    expect(html).toContain("PFG: se pasó el corte de las 11:00 AM — llama al proveedor · 2 proveedores sin pedido");
  });
});

describe("/ordering page surfaces", () => {
  const c = (over: Partial<OrderingCutoffAttention>): OrderingCutoffAttention => ({ vendorId: "v", vendorName: "V", cutoffTime: "11:00 AM", hasDraft: false, missed: false, ...over });
  // eslint-disable-next-line react/no-children-prop -- house test pattern: TranslationProvider's children prop is required
  const render = (cutoffAttention: OrderingCutoffAttention[]) => renderToStaticMarkup(createElement(TranslationProvider, {
    initialLanguage: "en",
    children: createElement(OrderingSurfaces, { todaysOrders: [], history: [], cutoffAttention, locationId: "shop", actorLevel: 7, language: "en", shopLabel: "Shop", dateLabel: "Today" }),
  }));
  it("lists every missed vendor (draft or not) in a red alert, and marks a draftless missed row", () => {
    const html = render([c({ vendorId: "pfg", vendorName: "PFG", hasDraft: true, missed: true }), c({ vendorId: "bal", vendorName: "Baldor", cutoffTime: "11:30 AM", missed: true }), c({ vendorId: "fer", vendorName: "Ferraro", cutoffTime: "5:00 PM" })]);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Missed cutoff — call the vendor");
    expect(html).toContain("PFG: the 11:00 AM cutoff passed with no order placed");
    expect(html).toContain("Baldor: the 11:30 AM cutoff passed with no order placed");
    expect(html).toContain("Missed the 11:30 AM cutoff — call the vendor");
    expect(html).toContain("Cutoff 5:00 PM");
    expect(html).not.toContain("Ferraro: the");
  });
  it("no alert when nothing is missed", () => {
    expect(render([c({})])).not.toContain("Missed cutoff — call the vendor");
  });
});

describe("i18n", () => {
  it.each([
    "midshift.attention.ordering_cutoff_missed_one", "midshift.attention.ordering_cutoff_missed_other",
    "dashboard.ordering.headline_missed", "dashboard.ordering.pill_missed",
    "pulse.attention.cutoff_missed", "pulse.inventory.cutoff_missed",
    "ordering.po.cutoff_missed_at", "ordering.po.missed_title", "ordering.po.missed_line",
  ])("%s exists in en and es with the same placeholders", (key) => {
    const a = (en as Record<string, string>)[key]!;
    const b = (es as Record<string, string>)[key]!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect((b.match(/\{\w+\}/g) ?? []).sort()).toEqual((a.match(/\{\w+\}/g) ?? []).sort());
  });
});
