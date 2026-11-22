/**
 * M2 (nav PR 9, plan r2 8.2, A1; lead ruling r1 Q2; was tests/idle-warning-outside-layouts.test.ts): EVERY signed-in
 * page tree mounts the top bar's frame, and with it the idle-logout warning (spec r5 §9). No signed-in page may lose it.
 *
 * - NavFrame (components/nav/NavFrame.tsx) carries the warning with today's exact mount: the server's idle limit, the
 *   signed-in user and the session id the page was served for.
 * - Both layouts render <NavFrame> around {children} and no warning of their own.
 * - Every page.tsx OUTSIDE both layouts that calls requireSessionFromHeaders renders <NavFrame auth={auth}> in EVERY
 *   TranslationProvider branch it returns (the old branch-count method), or hands its session to PlannedPage as
 *   `frame={auth}`; none mounts a second warning. Public pages are a closed, reviewed exemption list.
 * - No duplicate guard: /admin/audit renders PlannedPage WITHOUT a frame, and the admin layout around it renders exactly
 *   one warning (a unit-level serialization of the tree; not browser evidence).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderServerTree } from "./helpers/render-server-tree";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const MOUNT = "<IdleTimeoutWarning idleMinutes={sessionIdleMinutes()} userId={auth.user.id} sessionId={auth.session.id} />";

function pages(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const p = `${dir}/${name}`;
    return statSync(join(ROOT, p)).isDirectory() ? pages(p) : name === "page.tsx" ? [p] : [];
  });
}
const ALL_PAGES = pages("app");
const IN_LAYOUT = (p: string) => p.startsWith("app/(authed)/") || p.startsWith("app/admin/");
/** Public pages outside both layouts (no session): the reviewed exemption list. */
const PUBLIC = new Set([
  "app/page.tsx", "app/reset-password/page.tsx", "app/verify/page.tsx", "app/eat/page.tsx", "app/eat/privacy/page.tsx",
  "app/order/page.tsx", "app/order/account/page.tsx", "app/order/build/page.tsx", "app/order/quote/[id]/page.tsx",
  "app/order/review/page.tsx", "app/order/sign-out-failed/page.tsx", "app/order/start/page.tsx", "app/order/verify/page.tsx",
]);

describe("the frame carries the warning; both layouts render the frame around the page", () => {
  it("NavFrame mounts it exactly once, with exactly this shape", () => {
    const frame = read("components/nav/NavFrame.tsx");
    expect(frame).toContain(MOUNT);
    expect(frame.split("<IdleTimeoutWarning")).toHaveLength(2);
  });
  it.each(["app/(authed)/layout.tsx", "app/admin/layout.tsx"])("%s renders <NavFrame> around {children} and no second warning", (layout) => {
    const src = read(layout);
    expect(src).toContain('import { NavFrame } from "@/components/nav/NavFrame";');
    expect(src).toMatch(/<NavFrame auth={auth}/);
    expect(src.indexOf("<NavFrame")).toBeLessThan(src.indexOf("{children}"));
    expect(src.indexOf("{children}")).toBeLessThan(src.indexOf("</NavFrame>"));
    expect(src).not.toContain("<IdleTimeoutWarning");
  });
});

describe("the census: every signed-in page tree outside both layouts mounts the frame", () => {
  const outside = ALL_PAGES.filter((p) => !IN_LAYOUT(p));
  it("every page outside both layouts is either signed in (and checked below) or on the public list", () => {
    for (const p of outside) {
      const signedIn = read(p).includes("requireSessionFromHeaders(");
      expect(signedIn || PUBLIC.has(p), `${p}: signed in, or a reviewed public page`).toBe(true);
      if (PUBLIC.has(p)) expect(signedIn, `${p} is on the public list but reads a session`).toBe(false);
    }
    for (const p of PUBLIC) expect(ALL_PAGES, p).toContain(p);
  });
  const signedIn = outside.filter((p) => read(p).includes("requireSessionFromHeaders("));
  it("the signed-in pages outside both layouts are exactly the reviewed nine", () => {
    expect(signedIn.sort()).toEqual([
      "app/announcements/page.tsx", "app/comms/page.tsx", "app/deep-cleaning/page.tsx", "app/feedback/page.tsx",
      "app/ordering/page.tsx", "app/recipes/page.tsx", "app/tips/page.tsx", "app/training/build/[item]/page.tsx",
      "app/training/page.tsx",
    ]);
  });
  it.each(signedIn)("%s renders the frame in every branch, and no warning of its own", (file) => {
    const src = read(file);
    expect(src).not.toContain("<IdleTimeoutWarning");
    expect(src).toMatch(/const auth = await requireSessionFromHeaders\(/);
    if (src.includes("<PlannedPage")) {
      // Every PlannedPage it returns carries this page's session as the frame.
      const uses = [...src.matchAll(/<PlannedPage\b[^>]*\/>/g)].map((m) => m[0]);
      expect(uses.length).toBeGreaterThanOrEqual(1);
      for (const u of uses) expect(u).toContain("frame={auth}");
      return;
    }
    expect(src).toContain('import { NavFrame } from "@/components/nav/NavFrame";');
    const providers = [...src.matchAll(/<TranslationProvider initialLanguage=\{[\w.]+\}>/g)];
    expect(providers.length).toBeGreaterThanOrEqual(1);
    const returns = [...src.matchAll(/return \(\s*(?:\/\/[^\n]*\n\s*)*<TranslationProvider/g)];
    expect(returns).toHaveLength(providers.length);
    for (const p of providers) {
      const after = src.slice(p.index! + p[0].length, p.index! + p[0].length + 300);
      expect(after).toMatch(/^\s*(?:\{\/\*[^]*?\*\/\}\s*)?<NavFrame auth=\{auth\}/);
    }
    expect(src.split("<NavFrame auth={auth}")).toHaveLength(providers.length + 1);
    expect(src.split("</NavFrame>")).toHaveLength(providers.length + 1);
  });
  it("PlannedPage renders the frame exactly when it is given one (inside its own TranslationProvider)", () => {
    const src = read("components/PlannedPage.tsx");
    expect(src).toMatch(/if \(!frame\) return body;/);
    expect(src).toMatch(/<TranslationProvider initialLanguage=\{lang\}>\s*<NavFrame auth=\{frame\} language=\{lang\}>\s*\{body\}\s*<\/NavFrame>/);
  });
  it("/admin/audit passes no frame and no back link (the admin layout draws both)", () => {
    const src = read("app/admin/audit/page.tsx");
    expect(src).toMatch(/<PlannedPage [^>]*backLink=\{false\}[^>]*\/>/);
    expect(src).not.toContain("frame=");
  });
});

// ─── No duplicate guard: the admin layout around /admin/audit renders exactly ONE warning ─────────────────────────
// The audit page is owner level (its own gate), so the session here is an owner's.
vi.mock("@/lib/session", () => ({
  requireSessionFromHeaders: async () => ({
    user: { id: "u1", name: "Olivia", email: "o@example.test", role: "owner", language: "en", profileBlurb: null },
    session: { id: "s1", stepUpUnlocked: false, stepUpUnlockedAt: null, catalogEditUnlockedAt: null },
    role: "owner", level: 9, locations: [],
  }),
  sessionIdleMinutes: () => 10,
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("404"); } }));
vi.mock("@/components/auth/IdleTimeoutWarning", async () => ({ IdleTimeoutWarning: (await import("./helpers/render-server-tree")).standIn("IdleTimeoutWarning") }));
vi.mock("@/components/nav/NavShell", async () => ({ NavShell: (await import("./helpers/render-server-tree")).standIn("NavShell") }));
vi.mock("@/components/nav/TopBarBell", async () => ({ TopBarBell: (await import("./helpers/render-server-tree")).standIn("TopBarBell") }));
vi.mock("@/components/nav/BackLink", async () => ({ BackLink: (await import("./helpers/render-server-tree")).standIn("BackLink") }));
vi.mock("@/components/admin/StepUpProvider", async () => ({ StepUpProvider: (await import("./helpers/render-server-tree")).standIn("StepUpProvider") }));
vi.mock("@/components/ShopContextSync", async () => ({ ShopContextSync: (await import("./helpers/render-server-tree")).standIn("ShopContextSync") }));
vi.mock("@/components/layout/CanvasWatermark", async () => ({ CanvasWatermark: (await import("./helpers/render-server-tree")).standIn("CanvasWatermark") }));
vi.mock("@/lib/i18n/provider", async () => ({ TranslationProvider: (await import("./helpers/render-server-tree")).standIn("TranslationProvider") }));

describe("no duplicate guard under /admin/audit", () => {
  it("the admin layout around the audit page renders exactly one IdleTimeoutWarning (and one bar)", async () => {
    const { default: AdminLayout } = await import("@/app/admin/layout");
    const { default: AuditPage } = await import("@/app/admin/audit/page");
    const page = await (AuditPage as () => Promise<ReactNode>)();
    const tree = await renderServerTree(AdminLayout({ children: page }));
    expect(tree.standIns.filter((s) => s.name === "IdleTimeoutWarning")).toHaveLength(1);
    expect(tree.standIns.filter((s) => s.name === "NavShell")).toHaveLength(1);
    expect(tree.text).toContain("Audit");
  });
  it("a standalone planned page renders exactly one warning and one bar too", async () => {
    const { default: TipsPage } = await import("@/app/tips/page");
    const tree = await renderServerTree((TipsPage as () => Promise<ReactNode>)());
    expect(tree.standIns.filter((s) => s.name === "IdleTimeoutWarning")).toHaveLength(1);
    expect(tree.standIns.filter((s) => s.name === "NavShell")).toHaveLength(1);
  });
});
