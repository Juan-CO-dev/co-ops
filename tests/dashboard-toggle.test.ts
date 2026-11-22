/**
 * Nav PR 8, T-T1 (plan r2 2.7, 2.19; lead rulings r1 Q9): "My shift | Shop pulse". Shown iff `pulseToggleFor`: KH and up
 * yes; crew (level 2-3) yes with PULSE_V2 on and no with it off; levels 0-1 no; the social media manager never; no `ops`
 * surface at the shop, none. The links keep the shop in each route's own parameter (`?loc=` / `?location=`), and the
 * current side has aria-current. (Its mounting on both /mid-shift versions is pinned in tests/dashboard-blocks-payload.test.ts.)
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MyShiftPulseToggle } from "@/components/dashboard/MyShiftPulseToggle";
import { pulseToggleFor, toggleHrefs } from "@/lib/dashboard-blocks-shared";
import type { Surface } from "@/lib/day-plan-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { ROLES, type RoleCode } from "@/lib/roles";
import { links } from "./helpers/day-render";

const ALL: ReadonlySet<Surface> = new Set<Surface>(["tasks", "ops", "catering", "schedule", "report_read"]);
const v = (role: RoleCode, pulseV2: boolean, surfaces: ReadonlySet<Surface> = ALL) => ({ role, level: ROLES[role].level, surfaces, switches: { pulseV2 } });

describe("T-T1: who gets the toggle", () => {
  it.each(Object.keys(ROLES) as RoleCode[])("%s", (role) => {
    const level = ROLES[role].level;
    const on = role !== "social_media_mgr" && level >= 2;
    const off = role !== "social_media_mgr" && level >= 4;
    expect(pulseToggleFor(v(role, true))).toBe(on);
    expect(pulseToggleFor(v(role, false))).toBe(off);
  });
  it("no ops surface at the shop: none", () => {
    expect(pulseToggleFor(v("gm", true, new Set<Surface>(["tasks", "catering"])))).toBe(false);
  });
  it("the social media manager never, whatever the switch", () => {
    expect(pulseToggleFor(v("social_media_mgr", true))).toBe(false);
    expect(renderToStaticMarkup(createElement(MyShiftPulseToggle, { viewer: v("social_media_mgr", true), shopId: "s1", current: "my_shift", language: "en" }))).toBe("");
  });
});

describe("T-T1: the links", () => {
  it("each side's own parameter; bare without a shop", () => {
    expect(toggleHrefs("s 1")).toEqual({ myShift: "/dashboard?loc=s%201", pulse: "/mid-shift?location=s%201" });
    expect(toggleHrefs(null)).toEqual({ myShift: "/dashboard", pulse: "/mid-shift" });
  });
  it.each([["en", "my_shift"], ["es", "pulse"]] as const)("%s, current %s: aria-current, labels, 44 px with items-center", (lang, current) => {
    const html = renderToStaticMarkup(createElement(MyShiftPulseToggle, { viewer: v("key_holder", true), shopId: "s1", current, language: lang }));
    const L = (lang === "en" ? en : es) as Record<string, string>;
    expect(html).toContain(`aria-label="${L["dashboard.toggle.aria"]}"`);
    const ls = links(html);
    expect(ls.map((l) => [l.href, l.text])).toEqual([["/dashboard?loc=s1", L["dashboard.toggle.my_shift"]], ["/mid-shift?location=s1", L["nav.mid_shift"]]]);
    const current_ = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*data-toggle="([^"]+)"|<a[^>]*data-toggle="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1] ?? m[2]);
    expect(current_).toEqual([current]);
    for (const a of html.match(/<a\b[^>]*>/g)!) expect(a).toMatch(/min-h-\[44px\][^"]*items-center/);
  });
});

describe("T-T1: mounted on /mid-shift, both versions (source pins)", () => {
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("v2: PulseHome draws it first in its page, gated at the shop on show, current = pulse", () => {
    const src = code("components/pulse/PulseHome.tsx");
    expect(src).toMatch(/<main className=\{shell\}>\s*<MyShiftPulseToggle viewer=\{dayViewerFor\(auth, shops\[0\]!\.id, navSwitches\(\)\)\} shopId=\{both \? null : shops\[0\]!\.id\} current="pulse"/);
  });
  it("v1: the first child of the page's main, after the level check, at the resolved shop", () => {
    const src = code("app/(authed)/mid-shift/page.tsx");
    const level = src.indexOf("auth.level < MIDSHIFT_BASE_LEVEL");
    const toggle = src.indexOf("<MyShiftPulseToggle viewer={dayViewerFor(auth, locationId, navSwitches())} shopId={locationId} current=\"pulse\"");
    expect(level).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(level);
    expect(src.slice(src.lastIndexOf("<main", toggle), toggle)).toMatch(/^<main[^>]*>\s*$/);
  });
});
