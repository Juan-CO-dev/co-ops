/**
 * Digests round 3, PR 1b (plan §3.4): the REAL /catering/pipeline page with the day filter, rendered through the real
 * `PipelineClient`. Only the session, the board's loaders and the navigation hooks are stubbed.
 *
 *  - The page parses `?day=&location=&view=booked` and hands it to the board loader; a bad or impossible day, a
 *    malformed shop or a missing `view` is ignored (null), never an error.
 *  - Search (`q`) wins: no board read, no banner.
 *  - The board loader's APPLIED filter decides the banner: one line "Showing booked <shop> events on <date> · Show all",
 *    "Show all" a plain link to /catering/pipeline (44 px); none when the loader cleared or ignored it. en + es.
 *  - The anchors the digest links to are on the board: #follow-ups (when one is due) and #pipeline-stages.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const st = vi.hoisted(() => ({
  lang: "en" as "en" | "es",
  client: null as unknown,
  view: { leads: [] as unknown[], filter: null as unknown },
  followUps: [] as unknown[],
  boardCalls: [] as unknown[],
  searchCalls: [] as unknown[],
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "u-gm", name: "Gee Em", language: st.lang, active: true, role: "gm" }, role: "gm", level: 7, locations: [A],
  session: { id: "s", stepUpUnlocked: false, stepUpUnlockedAt: null },
}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => st.client }));
vi.mock("@/lib/catering/pipeline", async (orig) => ({
  ...(await orig<typeof import("@/lib/catering/pipeline")>()),
  loadPipelineBoardView: async (_auth: unknown, opts: unknown) => { st.boardCalls.push(opts); return st.view; },
  loadFollowUps: async () => st.followUps,
  loadAssignableStaff: async () => [],
  searchPipeline: async (_auth: unknown, args: unknown) => { st.searchCalls.push(args); return []; },
}));
vi.mock("@/lib/catering/not-in-toast", () => ({ loadNotInToast: async () => [] }));
vi.mock("@/lib/shop-context", () => ({ resolveShop: async (list: Array<{ id: string }>) => list[0] ?? null }));
vi.mock("@/components/nav/BackLink", () => ({ BackLink: () => null }));

import CateringPipelinePage from "@/app/(authed)/catering/pipeline/page";
import { TranslationProvider } from "@/lib/i18n/provider";
import { fakeSupabase } from "./helpers/fake-supabase";

const boardLead = (id: string, over: Record<string, unknown> = {}) => ({
  id, customerId: null, contactName: `Contact ${id}`, company: null, eventDate: "2026-11-27", headcount: 10, contactPhone: null, deliveryAddress: null,
  timeWindow: null, eventType: null, dietaryNotes: null, eventName: null, dropoffDoor: null, stage: "confirmed", leadSource: "phone", locationId: A,
  locationName: "Shop A", notes: null, followUpDate: null, estimatedRevenueCents: null, assignedTo: null, createdBy: null, createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: null, quoteStatus: "accepted", ...over });

async function page(sp: Record<string, string>) {
  st.client = fakeSupabase((c) => (c.table === "locations" ? { data: [{ id: A, name: "Shop A" }] } : { data: [] })).client;
  const tree = await CateringPipelinePage({ searchParams: Promise.resolve(sp) });
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: st.lang, children: tree as ReactNode }));
}
const BANNER = /<p role="status" data-pipeline-day-filter="[^"]*"[\s\S]*?<\/p>/;

beforeEach(() => {
  st.lang = "en";
  st.view = { leads: [boardLead("l1")], filter: null };
  st.followUps = [];
  st.boardCalls = [];
  st.searchCalls = [];
});

describe("the page reads the filter params and hands them to the board", () => {
  it("a well-formed filter goes to the loader (with ?lead=)", async () => {
    await page({ day: "2026-11-27", location: A, view: "booked", lead: "x" });
    expect(st.boardCalls).toEqual([{ ensureLead: "x", filter: { day: "2026-11-27", location: A } }]);
  });

  it.each([
    [{ day: "2026-02-31", location: A, view: "booked" }, "an impossible date"],
    [{ day: "27-11-2026", location: A, view: "booked" }, "a bad day"],
    [{ day: "2026-11-27", location: "P Street", view: "booked" }, "a shop name"],
    [{ day: "2026-11-27", location: A }, "no view"],
  ])("%j (%s): ignored, the normal board, no banner, no error", async (sp: Record<string, string>, why: string) => {
    const html = await page(sp);
    expect(st.boardCalls, why).toEqual([{ ensureLead: null, filter: null }]);
    expect(html).not.toMatch(BANNER);
    expect(html).toContain('id="pipeline-stages"');
  });

  it("search wins: q runs the search, the board is not read, no banner", async () => {
    st.view = { leads: [], filter: { day: "2026-11-27", location: A, shopName: "Shop A" } };
    const html = await page({ q: "smith", day: "2026-11-27", location: A, view: "booked" });
    expect(st.searchCalls).toEqual([{ query: "smith" }]);
    expect(st.boardCalls).toEqual([]);
    expect(html).not.toMatch(BANNER);
  });
});

describe("the banner follows the filter the board APPLIED", () => {
  it("applied: one line naming the shop and the date, with a plain 'Show all' link to the whole board", async () => {
    st.view = { leads: [boardLead("l1")], filter: { day: "2026-11-27", location: A, shopName: "Shop A" } };
    const html = await page({ day: "2026-11-27", location: A, view: "booked" });
    const banner = html.match(BANNER)?.[0] ?? "";
    expect(banner).toContain("Showing booked Shop A events on");
    expect(banner).toContain("Nov 27");
    expect(banner).toMatch(/<a href="\/catering\/pipeline" class="inline-flex min-h-\[44px\] items-center[^"]*">Show all<\/a>/);
    expect(html.match(new RegExp(BANNER.source, "g"))).toHaveLength(1);
  });

  it("`none`: the no-shop wording; Spanish", async () => {
    st.view = { leads: [], filter: { day: "2026-11-27", location: "none", shopName: null } };
    expect((await page({ day: "2026-11-27", location: "none", view: "booked" })).match(BANNER)?.[0]).toContain("Showing booked events with no shop set on");
    st.lang = "es";
    st.view = { leads: [], filter: { day: "2026-11-27", location: A, shopName: "Shop A" } };
    const es = (await page({ day: "2026-11-27", location: A, view: "booked" })).match(BANNER)?.[0] ?? "";
    expect(es).toContain("Mostrando los eventos reservados de Shop A el");
    expect(es).toContain(">Ver todo</a>");
  });

  it("ignored or cleared by the loader (another shop, an ensured lead outside it): no banner", async () => {
    st.view = { leads: [boardLead("l1")], filter: null };
    expect(await page({ day: "2026-11-27", location: A, view: "booked", lead: "l1" })).not.toMatch(BANNER);
  });
});

describe("the anchors the digest links to are on the board", () => {
  it("#pipeline-stages always; #follow-ups when a follow-up is due", async () => {
    expect(await page({})).not.toContain('id="follow-ups"');
    st.followUps = [boardLead("f1", { followUpDate: "2026-11-20" })];
    const html = await page({});
    expect(html).toContain('id="follow-ups"');
    expect(html).toContain('id="pipeline-stages"');
  });
});
