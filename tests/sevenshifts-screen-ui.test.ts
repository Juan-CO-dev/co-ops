/**
 * Scheduling Phase 1, Task 10 — /admin/sevenshifts rendered with react-dom/server for MoO, GM and the
 * dormant states. The status line always shows; not_connected / sync_off / not_supported hide every other
 * section; no wage figure and no email ever reach the HTML; nothing is pre-selected; en + es parity.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { SEVENSHIFTS_LINK_ERROR_CODES, SYNC_PARTS } from "@/lib/sevenshifts/links-shared";
import type { LinkScreen } from "@/lib/sevenshifts/links";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
const { SevenShiftsScreen } = await import("@/components/admin/sevenshifts/SevenShiftsScreen");

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const okResults = { okParts: 10, totalParts: 11, planForbidden: ["time_off"] as const, multiCompany: false };
const base: LinkScreen = {
  locationId: SHOP_A, state: "ready", can: { manageShops: true, linkPeople: true, syncNow: true },
  recentRuns: [{ id: "r1", trigger: "cron", startedAt: "2026-10-15T18:14:00Z", finishedAt: "2026-10-15T18:14:40Z", state: "partial", ...okResults, planForbidden: ["time_off"] }],
  shops: [
    { locationId: SHOP_A, name: "Shop A", link: { id: "SL1", remoteId: "4569", remoteName: "Seven P" } },
    { locationId: SHOP_B, name: "Shop B", link: null },
  ],
  remoteLocations: [{ id: "4570", name: "Seven C" }],
  shopLink: { id: "SL1", remoteId: "4569", remoteName: "Seven P" },
  linked: [{ linkId: "UL1", remoteUserId: "503", displayName: "Cy L.", employeeId: "10491", userId: "u3", userName: "Cy Lee", linkedHere: true }],
  waiting: [
    { remoteUserId: "501", displayName: "Ana R.", employeeId: "10482", roles: ["Line", "Prep"] },
    { remoteUserId: "502", displayName: "Ana R.", employeeId: null, roles: [] },
  ],
  members: [{ id: "u1", name: "Ana Rivera" }, { id: "u2", name: "Bo Diaz" }],
  wagesCount: 31,
};
const render = (screen: LinkScreen, language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(SevenShiftsScreen, { screen }) }));

describe("SevenShiftsScreen", () => {
  it("MoO, ready: status line with parts and the plan note, a wages COUNT, shops, the people summary, Sync now", () => {
    const html = render(base);
    expect(html).toContain("10 of 11 parts OK");
    expect(html).toContain("Time off needs a higher 7shifts plan");
    expect(html).toContain("Wages on file for 31 people at this shop");
    expect(html).toContain("Linked to 7shifts: Seven P");
    expect(html).toContain("Not linked to 7shifts");
    expect(html).toContain("Seven C");
    expect(html).toContain("1 linked · 2 waiting");
    expect(html).toContain("Sync now");
  });

  it("disclosure: Waiting to link, Linked and Recent syncs are collapsed by default (their rows are not rendered)", () => {
    const html = render(base);
    for (const title of ["Waiting to link", "Linked", "Recent syncs"]) expect(html).toContain(title);
    expect(html).not.toContain("7shifts #10482");
    expect(html).not.toContain("Cy Lee");
    expect((html.match(/aria-expanded="false"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("GM: no Shops section and no Sync now", () => {
    const html = render({ ...base, can: { manageShops: false, linkPeople: true, syncNow: false }, shops: [], remoteLocations: [] });
    expect(html).not.toContain("Linked to 7shifts: Seven P");
    expect(html).not.toContain(">Sync now<");
    expect(html).toContain("1 linked · 2 waiting");
  });

  it.each([
    ["not_connected", "7shifts is not connected yet. Juan adds the access token; nothing is read until then."],
    ["sync_off", "7shifts is connected, but syncing is switched off."],
    ["not_supported", "This 7shifts token covers more than one company, which CO-OPS doesn&#x27;t support yet."],
  ] as const)("%s: the one status line, and every other section hidden", (state, line) => {
    const html = render({ ...base, state });
    expect(html).toContain(line);
    for (const hidden of ["Shops", "People", "Recent syncs", "Sync now", "Wages on file", "waiting"]) expect(html).not.toContain(hidden);
  });

  it("ruling (c): sync off behaves EXACTLY like not connected — the same page with only its own status line (en + es)", () => {
    for (const lang of ["en", "es"] as const) {
      const dict = lang === "en" ? en : es;
      const off = render({ ...base, state: "sync_off" }, lang);
      const nc = render({ ...base, state: "not_connected" }, lang);
      expect(dict["sevenshifts.status.syncOff"]).not.toBe(dict["sevenshifts.status.notConnected"]);
      const esc = (t: string) => renderToStaticMarkup(createElement("span", null, t)).slice(6, -7);
      expect(off).toContain(esc(dict["sevenshifts.status.syncOff"]));
      expect(nc).toContain(esc(dict["sevenshifts.status.notConnected"]));
      expect(off.replace(esc(dict["sevenshifts.status.syncOff"]), "§")).toBe(nc.replace(esc(dict["sevenshifts.status.notConnected"]), "§"));
    }
  });

  it("no wage figure, no email address, no full 7shifts last name in the HTML (MoO, GM, dormant)", () => {
    for (const screen of [base, { ...base, can: { manageShops: false, linkPeople: true, syncNow: false } }, { ...base, state: "not_connected" as const }]) {
      const html = render(screen);
      expect(html).not.toMatch(/\$\s?\d|\d+\.\d{2}\b|wage_cents|wage_type/i); // a rate never renders
      expect(html).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    }
  });

  it("controls are 44 px and centred; no select pre-selects a person", () => {
    const html = render(base);
    for (const m of html.matchAll(/<(button|select)[^>]*class="([^"]*)"/g)) {
      expect(m[2], m[0]).toMatch(/min-h-\[44px\]/);
      if (m[1] === "button") expect(m[2], m[0]).toMatch(/items-center/);
    }
    expect(html).not.toMatch(/<option[^>]*selected=""[^>]*value="u\d"/);
  });

  it("renders in Spanish (tú) with the same structure", () => {
    const html = render(base, "es");
    expect(html).toContain("10 de 11 partes bien");
    expect(html).toContain("Tiempo libre necesita un plan más alto de 7shifts");
    expect(html).toContain("1 enlazadas · 2 por enlazar");
    expect(html).toContain("Sincronizar ahora");
    expect(render({ ...base, state: "not_connected" }, "es")).toContain("7shifts aún no está conectado. Juan agrega el token de acceso; no se lee nada hasta entonces.");
  });
});

describe("i18n parity for the 7shifts screen", () => {
  const keys = (o: Record<string, string>) => Object.keys(o).filter((k) => k.startsWith("sevenshifts.")).sort();
  it("every sevenshifts.* key exists in en AND es, none empty, and the placeholders match", () => {
    expect(keys(es)).toEqual(keys(en));
    expect(keys(en).length).toBeGreaterThan(40);
    for (const k of keys(en)) {
      const e = (en as Record<string, string>)[k]!, s = (es as Record<string, string>)[k]!;
      expect(e.trim(), k).not.toBe("");
      expect(s.trim(), k).not.toBe("");
      const ph = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(s), k).toEqual(ph(e));
    }
  });
  it("every error code and every synced part has its string", () => {
    for (const c of SEVENSHIFTS_LINK_ERROR_CODES) expect(en, c).toHaveProperty([`sevenshifts.error.${c}`]);
    for (const p of SYNC_PARTS) expect(en, p).toHaveProperty([`sevenshifts.part.${p}`]);
  });
  it("Spanish is operational tú, not usted", () => {
    for (const k of keys(es)) expect((es as Record<string, string>)[k], k).not.toMatch(/\busted\b|\bsu cuenta\b|\bintente\b|\bactualice\b/i);
  });
});

describe("source pins", () => {
  const screen = readFileSync("components/admin/sevenshifts/SevenShiftsScreen.tsx", "utf8");
  const page = readFileSync("app/admin/sevenshifts/page.tsx", "utf8");
  it("disclosure state is useState only (no storage, no URL)", () => {
    expect(screen).not.toMatch(/localStorage|sessionStorage|searchParams/);
  });
  it("never keys on a location code", () => {
    for (const src of [screen, page, readFileSync("lib/sevenshifts/links.ts", "utf8"), readFileSync("lib/sevenshifts/links-shared.ts", "utf8")]) {
      expect(src).not.toMatch(/["'](EM|MEP)["']/);
    }
  });
  it("the page resolves its shop through the one shop-context getter and binds the viewer with canViewSevenShiftsStatus", () => {
    expect(page).toMatch(/await resolveShop\(locations, shopParamFor\("\/admin\/sevenshifts", /);
    expect(page).toMatch(/canViewSevenShiftsStatus\(actor, /);
  });
});

describe("chunk C review (Astra P3): the admin hub card is role-aware", () => {
  it("GM+ and the operational level-6 managers see the 7shifts card; the social media manager never does", async () => {
    const { adminSectionsFor } = await import("@/lib/admin/sections");
    const sees = (level: number, role: Parameters<typeof adminSectionsFor>[1]) =>
      adminSectionsFor(level, role).some((s) => s.id === "sevenshifts" && s.href === "/admin/sevenshifts");
    for (const role of ["agm", "prep_mgr", "catering_mgr"] as const) expect(sees(6, role), role).toBe(true);
    expect(sees(6, "social_media_mgr")).toBe(false);
    expect(sees(7, "gm")).toBe(true);
    expect(sees(8, "moo")).toBe(true);
    expect(sees(9, "owner")).toBe(true);
    expect(sees(5, "shift_lead")).toBe(false);
  });

  it("the role-aware rule changes no other card: level-6 roles see the same cards as before, apart from 7shifts and (Phase 2) the schedule board", async () => {
    const { adminSectionsFor } = await import("@/lib/admin/sections");
    const ids = (level: number, role: Parameters<typeof adminSectionsFor>[1]) => adminSectionsFor(level, role).map((s) => s.id);
    expect(ids(6, "agm").filter((id) => id !== "sevenshifts" && id !== "schedule")).toEqual(ids(6, "social_media_mgr"));
    expect(ids(7, "gm")).toContain("recipe-notices");
  });

  it("the hub passes the session's trusted role", () => {
    expect(readFileSync("app/admin/page.tsx", "utf8")).toContain("adminSectionsFor(auth.level, auth.role)");
  });
});
