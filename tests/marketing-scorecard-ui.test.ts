// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { render as renderBase, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ScorecardClient from "@/app/admin/marketing/ScorecardClient";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

import { data } from "./fixtures/marketing-scorecard";
import { TranslationProvider } from "@/lib/i18n/provider";
function render(ui: ReactElement) {
  const lang = (ui.props as { lang?: "en" | "es"; children?: ReactElement<{ lang?: "en" | "es" }> }).lang
    ?? (ui.props as { children?: ReactElement<{ lang?: "en" | "es" }> }).children?.props.lang ?? "en";
  return renderBase(createElement(TranslationProvider, { initialLanguage: lang, children: ui }));
}
afterEach(cleanup);
describe("marketing scorecard UI", () => {
  it("has exact en/es key and interpolation parity for every marketing surface", () => {
    const keys = Object.keys(en).filter(key => key.startsWith("marketing."));
    expect(keys.length).toBeGreaterThan(100);
    expect(Object.keys(es).filter(key => key.startsWith("marketing.")).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const english = en[key as keyof typeof en]; const spanish = es[key as keyof typeof es];
      expect([...spanish.matchAll(/\{\w+\}/g)].map(match => match[0]).sort(), key).toEqual([...english.matchAll(/\{\w+\}/g)].map(match => match[0]).sort());
      expect(spanish, key).not.toMatch(/[a-z]\?[a-z]/i);
    }
  });
  it.each(["en", "es"] as const)("renders a 375px phone surface in %s with full-row disclosures", lang => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    const { container } = render(createElement("div", { style: { width: 375 } }, createElement(ScorecardClient, { data, lang })));
    expect(screen.getByRole("heading", { name: lang === "en" ? en["marketing.title"] : es["marketing.title"] })).toBeTruthy();
    expect(container.querySelector('[data-testid="marketing-scorecard"]')?.className).toContain("min-w-0");
    expect(container.textContent).not.toMatch(/marketing\.[a-z]|reports\.sales\./);
    const row = screen.getByRole("button", { name: new RegExp(lang === "en" ? en["marketing.kpi.online_share"] : es["marketing.kpi.online_share"]) });
    expect(row.className).toContain("min-h-[48px]");
    fireEvent.click(row);
    const drawer = screen.getByRole("dialog");
    expect(drawer.textContent).toContain(lang === "en" ? en["marketing.kpi.online_share.definition"] : es["marketing.kpi.online_share.definition"]);
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps alerts visible while historical taps remain collapsed", () => {
    render(createElement(ScorecardClient, { data, lang: "en" }));
    expect(screen.getByText(en["marketing.alert.no_snapshot"])).toBeTruthy();
    expect(screen.getByText(en["marketing.alert.drift"])).toBeTruthy();
    expect(screen.getByText(en["marketing.alert.capi"])).toBeTruthy();
    expect(screen.getByText(en["marketing.alert.test"])).toBeTruthy();
    expect(screen.queryByText(/old-ad/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Order taps by ad code/ }));
    expect(screen.getAllByText(/old-ad/).every(row => row.textContent?.includes("Retired"))).toBe(true);
    expect(screen.getByRole("heading", { name: en["marketing.taps.by_intent"] })).toBeTruthy();
    for (const intent of ["pickup", "delivery", "visit", "legacy"] as const) {
      expect(screen.getByText(`${en[`marketing.taps.intent.${intent}`]}: ${intent === "legacy" ? 2 : 0}`)).toBeTruthy();
    }
    expect(screen.getByText(en["marketing.tap_disclosure"])).toBeTruthy();
  });
  it("shows ships-OFF honestly without rendering metrics", () => {
    render(createElement(ScorecardClient, { data: { state: "unavailable", reason: "not_switched_on" }, lang: "en" }));
    expect(screen.getByRole("status").textContent).toBe(en["marketing.state.not_switched_on"]);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

it("shows share changes in points and keeps weekly tap detail behind a drawer", () => {
  render(createElement(ScorecardClient, { data, lang: "en" }));
  const row = screen.getByRole("button", { name: new RegExp(en["marketing.kpi.online_share"]) });
  expect(row.textContent).toMatch(/Change: .* pts/);
  fireEvent.click(screen.getByRole("button", { name: /Order taps by ad code/ }));
  expect(screen.getByText(en["marketing.taps.campaign"])).toBeTruthy();
  const weekly = screen.getByRole("button", { name: en["marketing.taps.by_week"] });
  expect(weekly.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(weekly);
  expect(weekly.getAttribute("aria-expanded")).toBe("true");
});
it("counts an overlapping misaligned spend entry as missing", () => {
  if (data.state !== "ok") throw new Error("fixture not ready");
  const week = data.series[0]!.window;
  const entry = { id: "entry", kind: "meta_spend", location_id: null, platform: null, period_start: "2026-01-01", period_end: "2026-12-31", amount_cents: 500, list_count: null, note: null, corrects_id: null };
  const first = render(createElement(ScorecardClient, { data: { ...data, entries: [entry] }, lang: "en" }));
  expect(screen.getByRole("button", { name: /3 missing this week/ })).toBeTruthy();
  first.unmount();
  render(createElement(ScorecardClient, { data: { ...data, entries: [{ ...entry, period_start: week.from, period_end: week.to }] }, lang: "en" }));
  expect(screen.getByRole("button", { name: /2 missing this week/ })).toBeTruthy();
});
it("shows load failure separately from no captured sales", () => {
  render(createElement(ScorecardClient, { data: { state: "load_failed" }, lang: "en" }));
  expect(screen.getByRole("status").textContent).toBe(en["marketing.state.load_failed"]);
  expect(screen.queryByText(en["marketing.state.no_capture"])).toBeNull();
});
