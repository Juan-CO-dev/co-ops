/**
 * Scheduling Phase 2, chunk G, Task 25 — the reconciliation PAGE (/admin/people-reconcile), rendered with
 * react-dom/server from a page object the pure `reconcile` builds, per the disclosure doctrine:
 *  - summary rows (name + the three ticks + how many things to look at) with full-row 44 px toggles and drawers;
 *  - counts on the collapsed section headers; alerts (flags) visible on the summary row;
 *  - each day names its basis: "Against the published 7shifts schedule" or "Against the CO-OPS proposal (not
 *    published)", with the missing evidence; sources_disagree says Toast stays the backup source;
 *  - the actions deep-link to the existing link screens (no writer here);
 *  - en + es (tú), every rendered key in both; no shop-code literal; the first name only for an unlinked clock-in;
 *  - the route is in the shop-context map WITH its page, and the hub card shows to GM and MoO+ only.
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { reconcile, type ReconcileInput } from "@/lib/scheduling/reconcile-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { ReconcileList } = await import("@/components/admin/people-reconcile/ReconcileList");
type Page = Parameters<typeof ReconcileList>[0]["page"];

const LOC = "1c000000-0000-4000-8000-000000000002";
const D1 = "2026-10-14";
const at = (date: string, hhmm: string) => `${date}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`;
const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b1";
const CY = "00000000-0000-4000-8000-0000000000c1";

function page(over: Partial<ReconcileInput> = {}, extra: Partial<Page> = {}): Page {
  const input: ReconcileInput = {
    dates: [D1], sevenStatus: "ready", shopLinkedToSeven: true,
    members: [{ userId: ANA, name: "Ana Ruiz" }, { userId: BEN, name: "Ben Lee" }, { userId: CY, name: "Cy Park" }],
    toastLinks: [{ employeeGuid: "tg-ana", userId: ANA }, { employeeGuid: "tg-cy", userId: CY }],
    sevenLinks: [{ sevenUserId: "701", userId: ANA }, { sevenUserId: "703", userId: CY }],
    sevenUsersAtShop: [{ sevenUserId: "701", displayName: "Ana R.", employeeId: "E1" }, { sevenUserId: "703", displayName: "Cy P.", employeeId: "E3" }, { sevenUserId: "799", displayName: "Rosa V.", employeeId: "E9" }],
    toastPunches14d: [
      { employeeGuid: "tg-ana", firstName: "Ana", businessDate: D1, inAt: at(D1, "16:00"), outAt: at(D1, "18:00"), hours: null },
      { employeeGuid: "tg-cy", firstName: "Cy", businessDate: D1, inAt: at(D1, "07:00"), outAt: at(D1, "13:00"), hours: null },
      { employeeGuid: "tg-x", firstName: "Zed", businessDate: D1, inAt: at(D1, "07:00"), outAt: at(D1, "11:00"), hours: null },
    ],
    sevenPunches14d: [{ sevenUserId: "703", clockedIn: at(D1, "07:00"), clockedOut: at(D1, "12:00"), breakMinutes: 0 }],
    publishedSevenShifts14d: [{ sevenUserId: "701", startAt: at(D1, "11:00"), endAt: at(D1, "15:00"), draft: false, deleted: false },
      { sevenUserId: "703", startAt: at(D1, "07:00"), endAt: at(D1, "13:00"), draft: false, deleted: false }],
    coopsProposalShifts14d: [], coopsProposalDates: [D1],
    ...over,
  };
  return {
    locationId: LOC, today: D1, dates: [D1], sevenStatus: input.sevenStatus, shopLinkedToSeven: input.shopLinkedToSeven,
    toastLinksAvailable: true, proposalAvailable: true, view: reconcile(input),
    links: { toast: `/admin/toast-employees?loc=${LOC}`, seven: `/admin/sevenshifts?loc=${LOC}` }, ...extra,
  };
}
const render = (p: Page, language: "en" | "es" = "en", openAll = true) =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(ReconcileList, { page: p, initialOpen: openAll }) as ReactNode }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const fill = (s: string, p: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(p[k] ?? `{${k}}`));

describe("the summary rows: three ticks, alerts visible, full-row 44 px toggles", () => {
  it("each person is a summary row with CO-OPS · Toast · 7shifts ticks; the flagged rows first; the count of things to look at", () => {
    const html = render(page(), "en", false);
    const t = text(html);
    const rows = html.match(/<button[^>]*data-person="[^"]+"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(3);
    for (const r of rows) { expect(r).toContain("min-h-[44px]"); expect(r).toContain("items-center"); expect(r).toContain("w-full"); expect(r).toMatch(/aria-expanded="false"/); }
    // Ben (no links at all) and Ana (a published shift with no punch, a punch with no shift) come before Cy (5 h vs 6 h → sources_disagree, so Cy is flagged too).
    expect(rows.map((r) => /data-person="([^"]+)"/.exec(r)![1])).toEqual([ANA, BEN, CY]);
    expect(html).toMatch(new RegExp(`data-person="${BEN}"[\\s\\S]*?data-tick="toast"[^>]*data-state="missing"`));
    expect(t).toContain(en["schedule.reconcile.tick.coops"]);
    expect(t).toContain(fill(en["schedule.reconcile.row.to_look_at"], { n: 2 }));
  });

  it("collapsed section headers carry their counts (people, Toast clock-ins, 7shifts people)", () => {
    const t = text(render(page(), "en", false));
    expect(t).toContain(fill(en["schedule.reconcile.section.people"], { n: 3 }));
    expect(t).toContain(fill(en["schedule.reconcile.section.toast"], { n: 1 }));
    expect(t).toContain(fill(en["schedule.reconcile.section.seven"], { n: 1 }));
  });
});

describe("the drawers: the basis, the flags, the missing evidence, the actions", () => {
  it("against the PUBLISHED schedule: the shift with no punch and the punch with no shift, with times", () => {
    const t = text(render(page()));
    expect(t).toContain(en["schedule.reconcile.basis.published"]);
    expect(t).toMatch(/a published shift 11:00\s?AM–3:00\s?PM with no punch/);
    expect(t).toMatch(/a punch at 4:00\s?PM with no published shift/);
    expect(t).toMatch(/7shifts says 5 h, Toast says 6 h\. Toast stays the backup source of actual hours\./);
    // Hours carry their unit only when known: an unknown source reads "—", never "— h".
    expect(t).toContain("Toast 2 h · 7shifts —");
    expect(t).not.toContain("— h");
  });

  it("no published data → 'Against the CO-OPS proposal (not published)' and the missing evidence, by reason", () => {
    const p = page({ sevenStatus: "not_connected", sevenLinks: [], sevenUsersAtShop: [], publishedSevenShifts14d: [], sevenPunches14d: [],
      coopsProposalShifts14d: [{ userId: ANA, date: D1, startQ: 44, endQ: 60 }] });
    const t = text(render(p));
    expect(t).toContain(en["schedule.reconcile.basis.proposal"]);
    expect(t).toContain(fill(en["schedule.reconcile.missing.seven_not_connected"], { date: "Wed, Oct 14" }));
    expect(t).toContain(en["schedule.reconcile.seven_state.not_connected"]);
    expect(t).toContain(en["schedule.reconcile.tick.not_connected"]);
    expect(t).toMatch(/the punches differ from the CO-OPS proposal/);
  });

  it("the actions deep-link to the existing link screens; the unlinked clock-in shows the FIRST name only", () => {
    const html = render(page());
    expect(html).toContain(`href="/admin/toast-employees?loc=${LOC}"`);
    expect(html).toContain(`href="/admin/sevenshifts?loc=${LOC}"`);
    const toastSection = html.match(/<section[^>]*data-section="toast-unlinked"[\s\S]*?<\/section>/)![0];
    expect(text(toastSection)).toContain("Zed");
    expect(text(toastSection)).toContain(fill(en["schedule.reconcile.flag.toast_clockin_no_user"], { days: 1 }));
    expect(text(html)).toContain("Rosa V.");
    expect(text(html)).toContain("E9");
    // No writer: no form, no POST button beyond the toggles.
    expect(html).not.toMatch(/<form/);
  });

  it("everyone lines up → the empty line; the install / connection states name themselves", () => {
    const clean = page({ toastLinks: [{ employeeGuid: "tg-ana", userId: ANA }], members: [{ userId: ANA, name: "Ana Ruiz" }], sevenStatus: "not_connected",
      sevenLinks: [], sevenUsersAtShop: [], toastPunches14d: [], sevenPunches14d: [], publishedSevenShifts14d: [], coopsProposalDates: [] });
    expect(text(render(clean))).toContain(en["schedule.reconcile.all_clear"]);
    expect(text(render(page({}, { toastLinksAvailable: false })))).toContain(en["schedule.reconcile.toast_links_unavailable"]);
    expect(text(render(page({}, { proposalAvailable: false })))).toContain(en["schedule.reconcile.proposal_unavailable"]);
    expect(text(render(page({ shopLinkedToSeven: false, sevenUsersAtShop: [] })))).toContain(en["schedule.reconcile.seven_state.shop_not_linked"]);
  });
});

describe("en + es, the route, the hub", () => {
  it("es renders the same page in Spanish; every schedule.reconcile key the page can show has en AND es", async () => {
    const t = text(render(page(), "es"));
    expect(t).toContain(es["schedule.reconcile.basis.published"]);
    expect(t).toContain(fill(es["schedule.reconcile.section.people"], { n: 3 }));
    const enKeys = Object.keys(en).filter((k) => k.startsWith("schedule.reconcile."));
    const esKeys = Object.keys(es).filter((k) => k.startsWith("schedule.reconcile."));
    expect(enKeys.length).toBeGreaterThan(30);
    expect(esKeys.sort()).toEqual(enKeys.sort());
    const { RECONCILE_FLAG_CODES, RECONCILE_MISSING } = await import("@/lib/scheduling/reconcile-shared");
    for (const c of RECONCILE_FLAG_CODES) expect(enKeys).toContain(`schedule.reconcile.flag.${c}`);
    for (const c of RECONCILE_MISSING) expect(enKeys).toContain(`schedule.reconcile.missing.${c}`);
  });

  it("the page reads its shop through the shop-context getter, is declared in the map, and never keys on a shop code", async () => {
    const src = readFileSync("app/admin/people-reconcile/page.tsx", "utf8");
    expect(src).toContain('shopParamFor("/admin/people-reconcile", searchParamValues(');
    expect(src).toContain("loadReconciliation(");
    const { declaredShopRoutes } = await import("@/lib/shop-context-shared");
    expect(declaredShopRoutes()).toContain("/admin/people-reconcile");
    for (const f of ["app/admin/people-reconcile/page.tsx", "components/admin/people-reconcile/ReconcileList.tsx", "lib/scheduling/reconcile.ts", "lib/scheduling/reconcile-shared.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/["'](EM|MEP)["']/);
    }
  });

  it("the hub card: GM and MoO+ (never the AGM, the social media / catering / prep managers or a key holder)", async () => {
    const { adminSectionsFor } = await import("@/lib/admin/sections");
    const has = (level: number, role: Parameters<typeof adminSectionsFor>[1]) => adminSectionsFor(level, role).some((x) => x.id === "people-reconcile" && x.href === "/admin/people-reconcile");
    expect([has(7, "gm"), has(8, "moo"), has(9, "owner"), has(10, "cgs")]).toEqual([true, true, true, true]);
    expect([has(6, "agm"), has(6, "social_media_mgr"), has(6, "catering_mgr"), has(6, "prep_mgr"), has(4, "key_holder")]).toEqual([false, false, false, false, false]);
  });
});
