/**
 * Nav PR 2 (spec r5 §7.2): the seven planned routes stay, and each is the smallest honest page — the feature's
 * name and one sentence. /admin/audit carries the owner-level (9) gate before anything else.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { ADMIN_SECTIONS } from "@/lib/admin/sections";
import type { RoleCode } from "@/lib/roles";

const h = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: h.auth }));

import AuditPage from "@/app/admin/audit/page";
import TipsPage from "@/app/tips/page";
import AnnouncementsPage from "@/app/announcements/page";
import RecipesPage from "@/app/recipes/page";
import FeedbackPage from "@/app/feedback/page";
import DeepCleaningPage from "@/app/deep-cleaning/page";
import CommsPage from "@/app/comms/page";

const ROOT = process.cwd();
const session = (role: RoleCode, level: number, language: "en" | "es" = "en") =>
  ({ user: { role, language }, role, level, locations: [] });

const PLANNED = [
  { route: "/tips", file: "app/tips/page.tsx", Page: TipsPage, titleKey: "planned.name.tips" },
  { route: "/announcements", file: "app/announcements/page.tsx", Page: AnnouncementsPage, titleKey: "planned.name.announcements" },
  { route: "/recipes", file: "app/recipes/page.tsx", Page: RecipesPage, titleKey: "planned.name.recipes" },
  { route: "/feedback", file: "app/feedback/page.tsx", Page: FeedbackPage, titleKey: "planned.name.feedback" },
  { route: "/deep-cleaning", file: "app/deep-cleaning/page.tsx", Page: DeepCleaningPage, titleKey: "planned.name.deep_cleaning" },
  { route: "/comms", file: "app/comms/page.tsx", Page: CommsPage, titleKey: "planned.name.comms" },
  { route: "/admin/audit", file: "app/admin/audit/page.tsx", Page: AuditPage, titleKey: "admin.section.audit" },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(session("owner", 9));
});

describe("/admin/audit is owner level (9) and up", () => {
  it.each([
    ["moo", 8], ["gm", 7], ["agm", 6], ["social_media_mgr", 6], ["shift_lead", 5], ["key_holder", 4], ["employee", 3], ["trainee", 2],
  ] as const)("refuses %s (level %s) before rendering anything", async (role, level) => {
    h.auth.mockResolvedValue(session(role, level));
    await expect(AuditPage()).rejects.toThrow("redirect:/dashboard");
  });

  it.each([["owner", 9], ["cgs", 10]] as const)("admits %s (level %s)", async (role, level) => {
    h.auth.mockResolvedValue(session(role, level));
    const html = renderToStaticMarkup(await AuditPage());
    expect(html).toContain(en["admin.section.audit"]);
    expect(html).toContain(en["planned.body"]);
  });

  it("the gate reads the session level: a level-8 session is refused whatever role it names", async () => {
    // A level-8 session is refused whatever role it carries; the page reads only the session's level.
    h.auth.mockResolvedValue(session("owner", 8));
    await expect(AuditPage()).rejects.toThrow("redirect:/dashboard");
  });

  it("the hub card agrees with the page gate and reads Planned", () => {
    const card = ADMIN_SECTIONS.find((s) => s.id === "audit");
    expect(card).toMatchObject({ href: "/admin/audit", minLevel: 9, comingSoon: true });
    const hub = readFileSync(join(ROOT, "app/admin/page.tsx"), "utf8");
    const templates = readFileSync(join(ROOT, "app/admin/checklist-templates/page.tsx"), "utf8");
    for (const src of [hub, templates]) {
      expect(src).toContain('serverT(lang, "planned.label")');
      expect(src).not.toMatch(/arrives_with_module|admin\.hub\.arrives/);
    }
    expect(en["planned.label"]).toBe("Planned");
    expect(es["planned.label"]).toBe("Planeado");
  });
});

describe("the seven planned pages are the feature's name and one honest sentence", () => {
  it("the sentence is the approved one in both languages", () => {
    expect(en["planned.body"]).toBe("This page is planned. It is not built yet.");
    expect(es["planned.body"]).toBe("Esta página está planeada. Todavía no está lista.");
  });

  it.each(PLANNED)("$route keeps its session gate and renders only its name and the sentence", async ({ route, file, Page, titleKey }) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src).toContain(`requireSessionFromHeaders("${route}")`);
    expect(src).toContain(`titleKey="${titleKey}"`);
    expect(src).not.toMatch(/\.ph\.|PlaceholderCard|features|shippingIn/);

    for (const lang of ["en", "es"] as const) {
      h.auth.mockResolvedValue(session("cgs", 10, lang));
      const dict: Record<string, string> = lang === "en" ? en : es;
      const html = renderToStaticMarkup(await Page());
      expect(h.auth).toHaveBeenLastCalledWith(route);
      expect(html).toContain(dict[titleKey]);
      expect(html).toContain(dict["planned.body"]);
      expect(html).not.toMatch(/Phase|Fase|Module|Módulo|<li/);
    }
  });

  it("no planned route is linked from any menu, search list or hub card that links", () => {
    const sources = ["lib/nav-links.ts", "lib/unified-search.ts"].map((f) => readFileSync(join(ROOT, f), "utf8"));
    for (const { route } of PLANNED) {
      const literal = new RegExp(`["'\`]${route.replace(/\//g, "\\/")}["'\`?#]`);
      for (const src of sources) expect(src).not.toMatch(literal);
    }
    // The one hub card naming a planned route is the muted, non-link audit card.
    expect(ADMIN_SECTIONS.filter((s) => PLANNED.some((p) => p.route === s.href)).map((s) => [s.id, s.comingSoon])).toEqual([["audit", true]]);
  });
});
