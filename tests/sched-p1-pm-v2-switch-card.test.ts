/**
 * Scheduling Phase 1 — CC's chunk G ruling 2: the per-shop PM v2 switch gets a SCREEN.
 *
 * A small admin card on the PM settings page (/admin/pm-criteria, the admin surface whose StepUpProvider opens the
 * Tier E window) shows each shop's PM v2 state with a toggle. MoO+ only, by trusted ROLE (moo / owner / cgs; the
 * social media manager never, whatever its level; a GM keeps the criteria editor but not this card). Every toggle
 * asks for the Tier E window first and posts the existing route (POST /api/people/settings, action "shop"),
 * carrying the shop's prep position unchanged. When the shop's data is not ready the card shows the
 * `pm_v2_not_ready` refusal and names what is missing (the BOH positions, the shared criteria), en + es (tú).
 * Turning OFF is never gated. 44 px controls; phone-first (wraps at 375 px).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { canManagePmV2Switch, PM_V2_SWITCH_ROLES, type PeopleActor } from "@/lib/people/access-shared";
import { pmV2SwitchBody, pmV2SwitchState, type PmV2SwitchShop } from "@/lib/people/pm-v2-switch-shared";
import { ROLES, type RoleCode } from "@/lib/roles";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { PmV2SwitchCard } = await import("@/components/people/PmV2SwitchCard");
const { loadPmV2SwitchView } = await import("@/lib/people/settings");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PREP = id(21);
const actor = (role: RoleCode, level = ROLES[role].level, locations: string[] = [A]): PeopleActor => ({ userId: id(1), role, level, locations });

const shop = (over: Partial<PmV2SwitchShop> = {}): PmV2SwitchShop =>
  ({ locationId: A, name: "Capitol Hill", pmV2: false, prepPositionId: PREP, ready: true, boh: true, criteria: 2, ...over });

const render = (node: ReturnType<typeof createElement>, language: "en" | "es" = "en") => renderToStaticMarkup(createElement(TranslationProvider, {
  initialLanguage: language, children: createElement(StepUpProvider, { unlocked: false, unlockedAt: null, children: node }),
})).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"); // compare with the plain strings

describe("role gating: MoO+ only, by trusted role", () => {
  it("MoO, owner and CGS may manage the switch", () => {
    for (const role of ["moo", "owner", "cgs"] as const) expect(canManagePmV2Switch(actor(role)), role).toBe(true);
    expect([...PM_V2_SWITCH_ROLES].sort()).toEqual(["cgs", "moo", "owner"]);
  });

  it("the social media manager never — even beside a level of 8 or 9", () => {
    expect(canManagePmV2Switch(actor("social_media_mgr"))).toBe(false);
    expect(canManagePmV2Switch(actor("social_media_mgr", 8))).toBe(false);
    expect(canManagePmV2Switch(actor("social_media_mgr", 9))).toBe(false);
  });

  it("a GM (even at its own shop), the level-6 managers and everyone below do not get the card", () => {
    for (const role of ["gm", "agm", "prep_mgr", "catering_mgr", "shift_lead", "key_holder", "trainer", "employee"] as const) {
      expect(canManagePmV2Switch(actor(role)), role).toBe(false);
    }
    expect(canManagePmV2Switch(actor("gm", 8))).toBe(false); // a level alone never opens it
  });

  it("the loader refuses a non-MoO+ actor before any read", async () => {
    const db = createFakeDb({ locations: [] } as unknown as Tables);
    await expect(loadPmV2SwitchView(db.client as never, actor("gm"), [{ id: A, name: "Capitol Hill" }])).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(loadPmV2SwitchView(db.client as never, actor("social_media_mgr", 8), [{ id: A, name: "Capitol Hill" }])).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the page renders the card only for canManagePmV2Switch, and the client asks for Tier E before posting the settings route", () => {
    const page = readFileSync("app/admin/pm-criteria/page.tsx", "utf8");
    expect(page).toContain("canManagePmV2Switch(actor)");
    expect(page).toContain("<PmV2SwitchCard");
    const card = readFileSync("components/people/PmV2SwitchCard.tsx", "utf8");
    expect(card).toContain('requestStepUp("E")');
    expect(card.indexOf('requestStepUp("E")')).toBeLessThan(card.indexOf('"/api/people/settings"'));
    expect(card).toContain("pmV2SwitchBody(");
  });
});

describe("the pure state and the request body", () => {
  it("off + ready → can turn on; off + not ready → names what is missing; on → can always turn off", () => {
    expect(pmV2SwitchState(shop())).toEqual({ on: false, canToggle: true, missing: [] });
    expect(pmV2SwitchState(shop({ ready: false, boh: false, criteria: 0 }))).toEqual({ on: false, canToggle: false, missing: ["boh", "criteria"] });
    expect(pmV2SwitchState(shop({ ready: false, boh: true, criteria: 0 }))).toEqual({ on: false, canToggle: false, missing: ["criteria"] });
    expect(pmV2SwitchState(shop({ ready: false, boh: false, criteria: 3 }))).toEqual({ on: false, canToggle: false, missing: ["boh"] });
    expect(pmV2SwitchState(shop({ pmV2: true, ready: false, boh: false, criteria: 0 }))).toEqual({ on: true, canToggle: true, missing: ["boh", "criteria"] });
  });

  it("the body is the route's exact shop action and carries the prep position unchanged", () => {
    expect(pmV2SwitchBody(shop(), true)).toEqual({ action: "shop", locationId: A, pmV2: true, prepPositionId: PREP });
    expect(pmV2SwitchBody(shop({ pmV2: true, prepPositionId: null }), false)).toEqual({ action: "shop", locationId: A, pmV2: false, prepPositionId: null });
  });
});

describe("the card renders each state (en + es), 44 px", () => {
  const shops = [
    shop(),
    shop({ locationId: B, name: "P Street", ready: false, boh: false, criteria: 0 }),
  ];

  it("off + ready: Off, a Turn on switch; off + not ready: the pm_v2_not_ready refusal and what is missing, the switch disabled", () => {
    const html = render(createElement(PmV2SwitchCard, { shops }));
    expect(html).toContain(en["pmV2Switch.title"]);
    expect(html).toContain("Capitol Hill");
    expect(html).toContain("P Street");
    expect(html).toContain(en["pmV2Switch.state.off"]);
    expect(html).toContain(en["pmV2Switch.turnOn"]);
    expect(html).toContain(en["people.skills.error.pm_v2_not_ready"]);
    expect(html).toContain(en["pmV2Switch.missing.boh"]);
    expect(html).toContain(en["pmV2Switch.missing.criteria"]);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(html.match(/disabled=""/g)?.length).toBe(1); // only the not-ready shop's switch
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("flex-wrap");
  });

  it("on: On and a Turn off switch, never gated", () => {
    const html = render(createElement(PmV2SwitchCard, { shops: [shop({ pmV2: true, ready: false, boh: true, criteria: 0 })] }));
    expect(html).toContain(en["pmV2Switch.state.on"]);
    expect(html).toContain(en["pmV2Switch.turnOff"]);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html).not.toContain('disabled=""');
  });

  it("a server refusal shows pm_v2_not_ready with what is missing for that shop", () => {
    const html = render(createElement(PmV2SwitchCard, { shops: [shop()], initialRefusal: { locationId: A, code: "pm_v2_not_ready" } }));
    expect(html).toContain('role="alert"');
    expect(html).toContain(en["people.skills.error.pm_v2_not_ready"]);
  });

  it("speaks Spanish (tú)", () => {
    const html = render(createElement(PmV2SwitchCard, { shops }), "es");
    for (const k of ["pmV2Switch.title", "pmV2Switch.state.off", "pmV2Switch.turnOn", "pmV2Switch.missing.boh", "pmV2Switch.missing.criteria", "people.skills.error.pm_v2_not_ready"] as const) {
      expect(html).toContain(es[k]);
    }
    expect(html).not.toContain(en["pmV2Switch.title"]);
  });

  it("every card string exists in en and es and differs", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("pmV2Switch."));
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      expect(es[k as keyof typeof es], k).toBeTruthy();
      expect(es[k as keyof typeof es], k).not.toBe(en[k as keyof typeof en]);
    }
    expect(es["pmV2Switch.intro"]).not.toMatch(/\busted\b/i); // tú, never usted
  });
});

describe("the loader: each shop's state and readiness, read-only", () => {
  let db: ReturnType<typeof createFakeDb>;
  beforeEach(() => {
    db = createFakeDb({
      locations: [{ id: A, name: "Capitol Hill", active: true }, { id: B, name: "P Street", active: true }],
      stations: [{ id: id(11), location_id: A, name: "Prep", active: true }],
      station_positions: [
        { id: PREP, station_id: id(11), location_id: A, name: "Prep", name_es: "Prep", active: true },
        { id: id(22), station_id: id(11), location_id: A, name: "Prep/Dishwasher", name_es: "Prep/Lavaplatos", active: true },
      ],
      pm_criteria: [{ id: "k1", location_id: A, position_id: null, label: "Arrived ready", label_es: "Llegó listo", sort: 10, active: true }],
      people_shop_settings: [{ location_id: A, pm_v2: true, prep_position_id: PREP }],
    } as unknown as Tables);
  });

  it("returns every shop with its switch, prep position and what is missing", async () => {
    const view = await loadPmV2SwitchView(db.client as never, actor("moo", 8, []), [{ id: A, name: "Capitol Hill" }, { id: B, name: "P Street" }]);
    expect(view).toEqual([
      { locationId: A, name: "Capitol Hill", pmV2: true, prepPositionId: PREP, ready: true, boh: true, criteria: 1 },
      { locationId: B, name: "P Street", pmV2: false, prepPositionId: null, ready: false, boh: false, criteria: 0 },
    ]);
  });
});
