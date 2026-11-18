/**
 * Item 21 PR 2, review r2 P2: house (portal / staff-entered) catering leads join the not-rung list through
 * readNotInToast, so EVERY consumer of that seam must say which source a row came from — never "ezCater" for a house
 * lead. The consumers (closed list, pinned at the bottom): the Pulse attention rows + the Pulse catering card
 * (lib/pulse/sections.ts), the morning catering digest (lib/report-digests.ts → composeCateringSections), the nightly
 * v2 digest (lib/report-digests-v2.ts → composeV2Sections), and the pipeline (loadNotInToast → NotInToast.tsx).
 * Each is driven through its real projection AND rendering, in English and Spanish.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { loadPulseSection, type PulseCtx, type PulseDeps } from "@/lib/pulse/sections";
import type { AttentionData, CateringData } from "@/lib/pulse/types";
import { AttentionList } from "@/components/pulse/sections/AttentionList";
import { CateringSection } from "@/components/pulse/sections/CateringSection";
import { TranslationProvider } from "@/lib/i18n/provider";
import { notRungLabel, notRungSource, type NotInToastOrder } from "@/lib/catering/not-in-toast-shared";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { composeCateringSections, type CateringFacts } from "@/lib/report-digests-compose";
import { composeV2Sections } from "@/lib/report-digests-v2-compose";
import { v2Fixture } from "./fixtures/digest-v2";

const LOC = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-09T19:30:00Z");
const auth = (level: number): AuthContext => ({
  user: { id: "me", role: level >= 7 ? "gm" : "key_holder", language: "en" } as AuthContext["user"],
  session: {} as AuthContext["session"], role: level >= 7 ? "gm" : "key_holder", level, locations: [LOC],
});
const ctx = (level: number): PulseCtx => ({ auth: auth(level), locationId: LOC, date: "2026-10-09", now: NOW });

const ez: NotInToastOrder = { order_id: "ez1", lead_id: null, location_id: LOC, event_date: "2026-10-09", order_number: "EZ-1",
  handoff_time: "2026-10-09T17:00:00Z", event_timestamp: null, headcount: 12, total_cents: 12000 };
const house: NotInToastOrder = { order_id: "lead-h1", lead_id: "lead-h1", location_id: LOC, event_date: "2026-10-09", order_number: "CO-4KM7R",
  handoff_time: null, event_timestamp: null, headcount: 20, total_cents: 30000, source: "house" };
const houseNoCode: NotInToastOrder = { ...house, order_id: "lead-h2", lead_id: "lead-h2", order_number: null };

function deps(rows: NotInToastOrder[]): PulseDeps {
  const empty = vi.fn(async () => []);
  return {
    board: vi.fn(async () => { throw new Error("unused"); }),
    reports: vi.fn(async () => ({ rows: [], closingDone: true, midDayDoneCount: 0 })),
    fridges: empty, cateringToday: empty,
    cateringTomorrow: vi.fn(async () => ({ count: 0, firstWindow: null })),
    notRung: vi.fn(async () => rows),
    unlinkedClockIns: vi.fn(async () => ({ count: 0, entries: [] })),
    lastParPass: vi.fn(async () => null),
    priorAmPrep: vi.fn(async () => null),
    deliveries: empty,
    cutoffs: vi.fn(async () => ({ count: 0, vendors: [] })),
    sales: vi.fn(async () => { throw new Error("unused"); }),
    handoff: vi.fn(async () => ({ notes: [], acks: [], names: {} })),
    layout: vi.fn(async () => null),
  } as unknown as PulseDeps;
}

// eslint-disable-next-line react/no-children-prop -- TranslationProvider requires children in its props type.
const render = (el: ReturnType<typeof createElement>, language: "en" | "es") => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: el }));
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const HOUSE_WORD = { en: "House order", es: "Pedido de la casa" } as const;
const NO_CODE = { en: "No ring code yet", es: "Todavía sin código de caja" } as const;

describe.each(["en", "es"] as const)("not-rung rows name their source (%s)", (language) => {
  it("Pulse attention: a house lead is never called ezCater; an ezCater order still is", async () => {
    const r = (await loadPulseSection(deps([ez, house, houseNoCode]), ctx(5), "attention")) as { data: AttentionData };
    const rows = r.data.items.filter((i) => i.kind === "catering_not_rung");
    expect(rows).toHaveLength(3);
    const texts = rows.map((row) => strip(render(createElement(AttentionList, { data: { ...r.data, items: [row] }, mode: "detail" }), language)));
    expect(texts[0]).toContain("ezCater EZ-1");
    expect(texts[1]).toContain(`${HOUSE_WORD[language]} CO-4KM7R`);
    expect(texts[1]).not.toMatch(/ezCater/);
    expect(texts[2]).toContain(HOUSE_WORD[language]);
    expect(texts[2]).toContain(NO_CODE[language]);
    expect(texts[2]).not.toMatch(/ezCater|—/);
  });

  it("Pulse catering card: the house row carries its source and renders labelled", async () => {
    const r = (await loadPulseSection(deps([ez, house]), ctx(5), "catering")) as { data: CateringData };
    expect(r.data.notRung.map((o) => o.source)).toEqual(["ezcater", "house"]);
    const html = strip(render(createElement(CateringSection, { data: r.data, mode: "detail" }), language));
    expect(html).toContain(HOUSE_WORD[language]);
    expect(html).toContain("ezCater");
  });

  it("morning digest: the ring line names the source", () => {
    const facts: CateringFacts = { today: "2026-10-09", leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [], toRingInToast: [ez, house, houseNoCode] };
    const sections = composeCateringSections(facts, { locations: [{ id: LOC, name: "Shop A" }], includeUnassigned: false }, language, "https://x.test");
    const lines = sections.find((s) => /To ring into Toast|Por registrar en Toast/.test(s.title))!.lines;
    const labels = lines.map((l) => l.label);
    expect(labels).toContain("ezCater EZ-1");
    expect(labels).toContain(`${HOUSE_WORD[language]} CO-4KM7R`);
    expect(labels).toContain(`${HOUSE_WORD[language]} · ${NO_CODE[language]}`);
    expect(labels.filter((l) => /ezCater/.test(l))).toEqual(["ezCater EZ-1"]);
  });

  it("nightly digest: the D+1 ring line names the source", () => {
    const sections = composeV2Sections({
      shopName: "Shop A", locationId: LOC, day: "2026-10-08", prefix: false,
      extras: { operations: [], pmLine: null, pendingItems: 0, who: { openedBy: null, closedBy: null, openingHref: "x", closingHref: "x" } },
      v: v2Fixture({ catering: { kind: "ok", value: { day: { orders: 0, completedCents: 0, confirmedCents: 0 }, tomorrow: [], toRingInToast: [ez, house].map((o) => ({ ...o, event_date: "2026-10-08" })) } } }),
    }, language, "https://x.test");
    const labels = sections.find((s) => /Ring into Toast tomorrow|Registra en Toast mañana/.test(s.title))!.lines.map((l) => l.label);
    expect(labels.sort()).toEqual(["ezCater EZ-1", `${HOUSE_WORD[language]} CO-4KM7R`].sort());
  });

  it("pipeline: every row's label comes from the one source-aware helper (the list is collapsed in SSR)", () => {
    const src = readFileSync("components/catering/pipeline/NotInToast.tsx", "utf8");
    expect(src).toMatch(/notRungLabel\(notRungSource\(row\), row\.order_number\)/);
    expect(src).not.toMatch(/catering\.toast_pending\.no_ring_code|cross_check\.no_code/);
    const t = (o: NotInToastOrder) => { const l = notRungLabel(notRungSource(o), o.order_number); return serverT(language, l.key as TranslationKey, l.params); };
    expect(t(ez)).toBe("ezCater EZ-1");
    expect(t(house)).toBe(`${HOUSE_WORD[language]} CO-4KM7R`);
    expect(t(houseNoCode)).toBe(`${HOUSE_WORD[language]} · ${NO_CODE[language]}`);
  });
});

describe("the consumer list of the not-rung seam is closed", () => {
  it("only the five known modules read readNotInToast / loadNotInToast", () => {
    const out = execFileSync("git", ["grep", "-lE", "(readNotInToast|loadNotInToast)\\(", "--", "lib", "app", "components"], { encoding: "utf8" });
    const users = out.split("\n").filter(Boolean).filter((f) => /\.tsx?$/.test(f)).sort();
    expect(users).toEqual([
      "app/(authed)/catering/pipeline/page.tsx",
      "lib/catering/not-in-toast.ts",
      "lib/pulse/sections.ts",
      "lib/report-digests-v2.ts",
      "lib/report-digests.ts",
    ]);
  });
});
