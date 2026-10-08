/** Offline component previews. No app server, credentials, database, or sim evidence. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { expect, it, vi } from "vitest";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { StationsAdmin } from "@/components/assignments/StationsAdmin";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { ShiftBoard, Station } from "@/lib/assignments-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));

const at = "2026-10-08T19:12:00Z";
function station(id: string, name: string, nameEs: string): Station {
  return { id, name, nameEs, active: true, staffed: true, sort: 1, usuallyClosesAt: "14:00:00",
    positions: [1, 2].map(sort => ({ id: `${id}-${sort}`, stationId: id, sort, active: true,
      name: sort === 1 ? "Orders" : "Support", nameEs: sort === 1 ? "Pedidos" : "Apoyo",
      duty: sort === 1 ? "Prepare and hand off orders" : "Cover rush orders",
      dutyEs: sort === 1 ? "Prepara y entrega pedidos" : "Cubre los pedidos en horas pico",
      usuallyTrimsAt: sort === 2 ? "16:00:00" : null,
    })) };
}
function fixture(level: number): ShiftBoard {
  const closed = station("closed", "Sandwich station", "Estación de sándwiches"); closed.closedAt = "2026-10-08T18:07:00Z";
  return { locationId: "fixture-shop", date: "2026-10-08", viewerId: "viewer", viewerLevel: level,
    stations: [closed, station("open", "Service station", "Estación de servicio")],
    people: [{ id: "viewer", name: "Alex (fixture)", level, hasWork: false, onBreak: true },
      { id: "crew", name: "Sam (fixture)", level: 3, hasWork: false }], events: [], tasks: [],
    positionVacancies: [
      { positionId: "open-1", userId: "viewer", name: "Alex", reason: "on_break", at },
      { positionId: "open-2", userId: "left", name: "Jordan", reason: "clocked_out", at },
    ], taskVacancies: [{ task: "am_prep", userId: "left", name: "Jordan", at }],
  };
}

it("captures actual components with actual compiled CSS, labelled as fixtures", async () => {
  const dir = resolve("docs/reviews/station-lifecycle");
  const css = await postcss([tailwindcss({ base: resolve(".") })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") });
  const browser = await chromium.launch({ headless: true });
  const report: unknown[] = [];
  try {
    for (const item of [
      { name: "board-crew-en-360", width: 360, language: "en" as const, level: 3, admin: false },
      { name: "board-crew-es-360", width: 360, language: "es" as const, level: 3, admin: false },
      { name: "board-kh-en-1280", width: 1280, language: "en" as const, level: 4, admin: false },
      { name: "timing-kh-es-360", width: 360, language: "es" as const, level: 4, admin: true },
    ]) {
      const board = fixture(item.level);
      const component = item.admin
        ? createElement(StationsAdmin, { locationId: board.locationId, stations: board.stations, translatedNames: [], canEdit: false, canEditTiming: true })
        : createElement(ShiftBoardClient, { board });
      const markup = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: item.language, children: component }));
      const html = `<!doctype html><html lang="${item.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FIXTURE PREVIEW — ${item.name}</title><style>${css.css}:root{--font-dm-sans:"Segoe UI"}</style></head><body><main style="max-width:1040px;margin:auto;padding:12px"><p style="padding:12px;background:#FFE560;font-weight:bold;margin-bottom:12px">FIXTURE PREVIEW — NOT SIM<br>Actual components + compiled app CSS.<br>Fictional people. All sections expanded for inspection. Static controls. Offline Segoe UI font fallback.</p>${markup}</main></body></html>`;
      const page = await browser.newPage({ viewport: { width: item.width, height: 900 }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "load" });
      await page.locator('[data-collapsible-section] [hidden]').evaluateAll(elements => elements.forEach(element => element.removeAttribute("hidden")));
      await page.locator('[data-collapsible-section] button[aria-expanded]').evaluateAll(elements => elements.forEach(element => element.setAttribute("aria-expanded", "true")));
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport);
      if (!item.admin) {
        await expect.poll(() => page.getByText(item.language === "en" ? "Closed · 2:07 PM" : "Cerrada · 2:07 p.m.", { exact: true }).count()).toBe(1);
        expect(await page.getByText(item.language === "en" ? "Open for cover · Alex on break" : "Libre para cubrir · Alex está en descanso", { exact: true }).count()).toBe(1);
      }
      await writeFile(resolve(dir, `${item.name}.html`), await page.content(), "utf8");
      await page.screenshot({ path: resolve(dir, `${item.name}.png`), fullPage: true });
      report.push({ ...item, ...dimensions, source: "renderToStaticMarkup of actual component; app/globals.css compiled with Tailwind; no live state" });
      await page.close();
    }
    await writeFile(resolve(dir, "fixture-results.json"), JSON.stringify(report, null, 2) + "\n");
  } finally { await browser.close(); }
});
