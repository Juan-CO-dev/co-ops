import { readFileSync } from "node:fs";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import type { NewItemJobView } from "@/lib/catalog/jobs-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({
  useStepUp: () => ({ requestStepUp: vi.fn(async () => "ok"), forgetStepUp: vi.fn() }),
}));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => vi.fn() }));

const { NewItemJob, NewItemCreated, postNewItem } = await import("@/components/catalog/jobs/NewItemJob");
const { createNewItemAttemptController, initialSetupState, setupReducer, canRetrySetupStep } = await import("@/lib/catalog/jobs-shared");

const SHOP = "10000000-0000-4000-8000-000000000001";
const VENDOR = "20000000-0000-4000-8000-000000000001";
const view: NewItemJobView = {
  scope: SHOP,
  shops: [{ id: SHOP, name: "P Street" }],
  allowGlobal: false,
  vendors: [{ id: VENDOR, name: "Baldor" }],
  categories: [{ id: "cat", slug: "produce", label: "Produce", labelEs: "Productos" }],
  orderTypes: [{ id: "type", slug: "email", label: "Email", labelEs: "Correo" }],
  guides: [{ id: "guide", vendorId: VENDOR, name: "Main", updatedAt: "2026-10-16T12:00:00Z", sections: [{ id: "section", name: "Produce", position: 1 }] }],
  rhythm: [{ id: "rhythm", vendorId: VENDOR, orderDow: 1, leadDays: 1 }],
  measures: [{ label: "oz", dimension: "weight" }, { label: "lb", dimension: "weight" }, { label: "each", dimension: "count" }],
  recipes: [{ id: "recipe", name: "House pickles", activeVersionId: "version", basedOnVersionId: null }],
  setupShops: [{ shopId: SHOP, rhythm: [{ id: "rhythm", vendorId: VENDOR, orderDow: 1, leadDays: 1 }], recipes: [{ id: "recipe", name: "House pickles", activeVersionId: "version", basedOnVersionId: null }] }],
};

const draft = (name: string) => ({ name, vendorId: VENDOR });

it("offers the authorized swap return after creation without changing the item's scope link", () => {
  const source = "30000000-0000-4000-8000-000000000001";
  const skuId = "40000000-0000-4000-8000-000000000001";
  const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: "en", children: jsx(NewItemCreated, {
    view, swapFrom: source, created: { skuId, ownerLocationId: SHOP, replayed: false, vendorId: VENDOR },
  }) }));
  expect(html).toContain(`/admin/catalog/sku/${source}/swap?location=${SHOP}&amp;replacement=${skuId}`);
  expect(html).toContain(`/admin/catalog/sku/${skuId}?location=${SHOP}`);
  expect(html).toContain(en["catalog.jobs.swap.return"]);
});

describe("new item attempt identity", () => {
  it("keeps one request id across pending, edits, a lost response and retry", async () => {
    const ids = ["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"];
    const attempts = createNewItemAttemptController(() => ids.shift()!);
    const first = attempts.request(draft("Tomatoes"));
    expect(attempts.request(draft("Tomatoes, red")).request_id).toBe(first.request_id);
    attempts.uncertain();
    expect(attempts.request(draft("Tomatoes, retry")).request_id).toBe(first.request_id);
    attempts.acknowledge({ skuId: "sku", ownerLocationId: SHOP, replayed: false });
    expect(attempts.request(draft("Onions")).request_id).toBe("30000000-0000-4000-8000-000000000002");
  });

  it("a replay advances to the prior SKU and says edited fields were not applied", () => {
    const attempts = createNewItemAttemptController(() => "30000000-0000-4000-8000-000000000001");
    attempts.request(draft("edited"));
    const state = attempts.acknowledge({ skuId: "existing", ownerLocationId: SHOP, replayed: true });
    expect(state).toMatchObject({ status: "created", item: { skuId: "existing", replayed: true } });
  });

  it("never advances on a malformed success body", () => {
    const attempts = createNewItemAttemptController(() => "30000000-0000-4000-8000-000000000001", SHOP);
    attempts.request(draft("Tomatoes"));
    expect(attempts.readResponse({ replayed: false })).toMatchObject({ status: "uncertain" });
    expect(attempts.getState().status).toBe("uncertain");
  });

  it("does not accept a non-UUID identity or an owner outside the requested creation scope", () => {
    const attempts = createNewItemAttemptController(() => "30000000-0000-4000-8000-000000000001", SHOP);
    attempts.request(draft("Tomatoes"));
    expect(attempts.readResponse({ skuId: "not-an-id", ownerLocationId: SHOP, replayed: false }).status).toBe("uncertain");
    expect(attempts.readResponse({ skuId: "40000000-0000-4000-8000-000000000001", ownerLocationId: "50000000-0000-4000-8000-000000000001", replayed: false }).status).toBe("uncertain");
  });

  it("distinguishes a lost response and an unreadable success from a server refusal", async () => {
    const lost = await postNewItem({}, vi.fn(async () => { throw new TypeError("offline"); }) as never);
    expect(lost).toEqual({ kind: "uncertain" });
    const unreadable = await postNewItem({}, vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError("empty"); } })) as never);
    expect(unreadable).toEqual({ kind: "uncertain" });
    const refused = await postNewItem({}, vi.fn(async () => ({ ok: false, json: async () => ({ code: "invalid_name" }) })) as never);
    expect(refused).toEqual({ kind: "refused", code: "invalid_name" });
    const serverLost = await postNewItem({}, vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ code: "generic" }) })) as never);
    expect(serverLost).toEqual({ kind: "uncertain" });
  });
});

describe("NewItemJob", () => {
  for (const language of ["en", "es"] as const) {
    it(`renders the five-step phone-first job with translated controls (${language})`, () => {
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(NewItemJob, { view }) }));
      const dictionary = language === "en" ? en : es;
      expect(html).toContain(dictionary["catalog.jobs.new_item.title"]);
      for (const key of ["par", "order_days", "guide_line", "use_in", "barcode"] as const) {
        expect(html).toContain(dictionary[`catalog.jobs.new_item.setup.${key}`]);
      }
      expect(html).toContain(dictionary["catalog.pack.sentence_aria"]);
      expect(html).toContain(dictionary["catalog.jobs.new_item.vendor_add"]);
      expect(html).not.toContain("catalog.jobs.new_item");
      expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/);
      expect(html).not.toMatch(/<select(?![^>]*min-h-\[44px\])[^>]*>/);
      expect(html).not.toMatch(/<input(?![^>]*min-h-\[44px\])[^>]*>/);
      expect(html).toContain("flex-col");
    });
  }

  it("uses Tier E for item creation, Tier B for inline vendor creation, and every setup save is independent", () => {
    const src = readFileSync("components/catalog/jobs/NewItemJob.tsx", "utf8");
    expect(src).toContain('requestStepUp("E")');
    expect(src).toContain('requestStepUp("B")');
    expect(src).toContain("/api/admin/catalog/jobs/new-item");
    expect(src).toContain("/api/admin/vendors");
    expect(src).toContain("/setup");
    expect(src).toContain("setupReducer");
  });

  it("pins the UI race and state boundaries that protect committed setup", () => {
    const src = readFileSync("components/catalog/jobs/NewItemJob.tsx", "utf8");
    expect(src).toMatch(/if \(pending\.current\) return;\s*pending\.current = true; setBusy\(true\);\s*try \{ await work\(\)/);
    expect(src).toContain("function SetupStepCard(");
    expect(src.match(/function SetupStepCard\(/g)).toHaveLength(1);
    expect(src).toMatch(/shops\.map\(shop => <div key=\{shop\.id\} hidden=\{shop\.id !== setupShopId\}><SetupPanel/);
    expect(src).toContain('readVersion !== request.version');
    expect(src).toContain('setCreated({ ...state.item, vendorId: fields.vendorId ?? "" })');
    expect(src).toContain('days.filter(day => !setup.order_days.days[day]?.ok)');
    expect(src).toContain('Object.values(state.days).map');
  });

  it("keeps earlier saves and each order-day outcome through a later partial failure", () => {
    let state = initialSetupState();
    state = setupReducer(state, { kind: "result", result: { step: "par", ok: true, detail: { weekdayPar: 4 } } });
    state = setupReducer(state, { kind: "result", result: { step: "order_days", ok: false, detail: { outcomes: [
      { orderDow: 1, leadDays: 1, ok: true, pairId: "pair" },
      { orderDow: 4, leadDays: 2, ok: false, status: 500, code: "generic", messageKey: "catalog.error.generic", refreshRequired: true },
    ] } } });
    expect(state.par.status).toBe("saved");
    expect(state.order_days.days[1]).toMatchObject({ ok: true, pairId: "pair" });
    expect(state.order_days.days[4]).toMatchObject({ ok: false, refreshRequired: true });
    expect(state.order_days.status).toBe("unconfirmed");
  });

  it("guide unknown success requires refresh; skip cannot bypass the retry refusal", () => {
    let state = setupReducer(initialSetupState(), { kind: "result", result: { step: "guide_line", ok: false, detail: { lineSaved: null, refreshRequired: true } } });
    expect(canRetrySetupStep(state.guide_line)).toBe(false);
    state = setupReducer(state, { kind: "skip", step: "guide_line" });
    expect(state.guide_line.status).toBe("unconfirmed");
    expect(canRetrySetupStep(state.guide_line)).toBe(false);
    state = setupReducer(state, { kind: "refreshed", step: "guide_line" });
    expect(canRetrySetupStep(state.guide_line)).toBe(true);
  });
});

describe('review fixes render coverage', () => {
  for (const language of ['en', 'es'] as const) {
    const dictionary = language === 'en' ? en : es;
    it(`shows the summary before Create (${language})`, () => {
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(NewItemJob, { view }) }));
      expect(html).toContain(dictionary['catalog.jobs.new_item.summary']);
      expect(html.indexOf('<dl')).toBeGreaterThan(0);
      expect(html.indexOf('<dl')).toBeLessThan(html.indexOf('>' + dictionary['catalog.jobs.new_item.create'] + '</button>'));
      expect(html.match(/<dt/g)).toHaveLength(7);
    });
    it(`renders created status, five setup cards and touch controls (${language})`, () => {
      const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(NewItemCreated, { view, created: { skuId: 'sku', ownerLocationId: null, replayed: false, vendorId: VENDOR } }) }));
      expect(html).toContain(dictionary['catalog.jobs.new_item.created']);
      expect(html).toContain('/admin/catalog/sku/sku?location=global');
      expect(html.match(/<section/g)).toHaveLength(5);
      for (const key of ['par', 'order_days', 'guide_line', 'use_in', 'barcode'] as const) expect(html).toContain(dictionary[`catalog.jobs.new_item.setup.${key}`]);
      expect(html).not.toMatch(/<(?:button|select)(?![^>]*min-h-\[44px\])[^>]*>/);
      expect(html).not.toMatch(/<input(?![^>]*type="checkbox")(?![^>]*min-h-\[44px\])[^>]*>/);
      expect(html.match(/<label class="inline-flex min-h-\[44px\]/g)).toHaveLength(7);
      expect(html).toContain('minLength="6"');
      expect(html).toContain('grid-cols-1');
      expect(html).toContain('flex-col');
    });
  }
});
