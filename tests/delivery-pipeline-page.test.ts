/**
 * Catering delivery D2 (review DELIV2-r1, P2) — the PAGE: /catering/pipeline renders the pickup shop's "orders that
 * moved" list from `loadMovedDeliveriesSafe`. A database failure there is NOT an empty list: the real page, over a
 * client whose delivery reads fail, renders the translated "Couldn't load deliveries booked here" line (en + es). A
 * successful empty answer (off, the shop off, nothing moved) renders nothing; rows render the list.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryActor, deliveryFake, type FakeTables } from "./helpers/delivery-fake";

const h = vi.hoisted(() => ({ auth: null as unknown, sb: null as unknown }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => h.auth }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.sb }));
vi.mock("@/lib/catering/pipeline", () => ({ PIPELINE_READ_MIN: 5, PIPELINE_WRITE_MIN: 6, loadAssignableStaff: async () => [], loadPipelineBoard: async () => [], loadFollowUps: async () => [], searchPipeline: async () => [] }));
vi.mock("@/lib/catering/not-in-toast", () => ({ loadNotInToast: async () => [] }));
vi.mock("@/lib/shop-context", () => ({ resolveShop: async () => null }));
// The board itself is not under test (it has its own); the page's own markup and the delivery list are.
vi.mock("@/components/catering/pipeline/PipelineClient", () => ({ PipelineClient: () => null }));
vi.mock("@/components/nav/BackLink", () => ({ BackLink: () => null }));
vi.mock("@/components/admin/StepUpProvider", () => ({ StepUpProvider: ({ children }: { children: unknown }) => children }));

import CateringPipelinePage from "@/app/(authed)/catering/pipeline/page";
import { TranslationProvider } from "@/lib/i18n/provider";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", LEAD = "00000000-0000-4000-8000-0000000000d1";
const JOB = { id: "j1", pipeline_id: LEAD, location_id: A, provider_label: "Courier A", attempt_no: 1, pickup_at: null, dropoff_at: null, status: "cancelled", status_at: "2026-11-20T15:00:00Z",
  created_at: new Date(Date.now() - 86_400_000).toISOString() };
const TABLES: FakeTables = {
  locations: () => ({ data: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }] }),
  delivery_settings: (q) => ({ data: (q.in.location_id as string[]).map((id) => ({ location_id: id, enabled: true })) }),
  delivery_job_current: () => ({ data: [JOB] }),
  catering_pipeline: () => ({ data: [{ id: LEAD, location_id: B }] }),
};
const render = async (tables: FakeTables, language: "en" | "es" = "en") => {
  const who = deliveryActor("gm", [A]);
  h.auth = { ...who, user: { ...who.user, language }, session: { stepUpUnlocked: false, stepUpUnlockedAt: null } };
  h.sb = deliveryFake(tables).sb;
  const page = await CateringPipelinePage({ searchParams: Promise.resolve({}) });
  // eslint-disable-next-line react/no-children-prop -- TranslationProvider requires children in its props type.
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: page }))
    .replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
};

beforeEach(() => { vi.stubEnv("DELIVERY_TRACKING", "1"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("/catering/pipeline: the moved-deliveries list", () => {
  it("a database failure renders 'Couldn't load', never a silent nothing — en + es", async () => {
    for (const table of ["delivery_settings", "delivery_job_current", "catering_pipeline"]) {
      const broken = { ...TABLES, [table]: () => ({ error: { code: "57014", message: "canceling statement due to statement timeout" } }) };
      const en = await render(broken);
      expect(en, table).toContain("Couldn't load deliveries booked here for orders that moved. Reload to try again.");
      expect(en, table).not.toContain("Deliveries booked here for orders that moved 1");
      expect(en).toContain("Catering"); // the page itself still renders
    }
    const es = await render({ ...TABLES, delivery_job_current: () => ({ error: { code: "XX000", message: "boom" } }) }, "es");
    expect(es).toContain("No se pudieron cargar las entregas reservadas aquí para pedidos que se movieron.");
  });
  it("a successful answer with rows renders the list", async () => {
    const en = await render(TABLES);
    expect(en).toContain("Deliveries booked here for orders that moved 1");
    expect(en).toContain("Courier A · Cancelled");
    expect(en).not.toContain("Couldn't load");
  });
  it("a successful EMPTY answer renders nothing: the switch off, the shop off, 0356 missing, nothing moved", async () => {
    const quiet = async (tables: FakeTables) => {
      const en = await render(tables);
      expect(en).not.toContain("Couldn't load");
      expect(en).not.toContain("Deliveries booked here");
    };
    await quiet({ ...TABLES, delivery_settings: (q) => ({ data: (q.in.location_id as string[]).map((id) => ({ location_id: id, enabled: false })) }) });
    await quiet({ ...TABLES, delivery_settings: () => ({ data: [] }) });
    await quiet({ ...TABLES, delivery_settings: () => ({ error: { code: "42P01", message: "relation does not exist" } }) });
    await quiet({ ...TABLES, catering_pipeline: () => ({ data: [{ id: LEAD, location_id: A }] }) });
    vi.stubEnv("DELIVERY_TRACKING", "");
    await quiet(TABLES);
  });
});
