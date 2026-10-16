/**
 * Scheduling Phase 1, Task 21 — the PM v2 surfaces, rendered with react-dom/server from views the REAL lib
 * builds over the in-memory fake.
 *
 * - the copy form for its author: another manager's copy is in the fixture and NONE of its grades or notes
 *   reach the HTML (counts only);
 * - the three lifecycle states, driven by the SHARED lifecycle file through `copyFormState`: open → editable;
 *   done → read-only (every grade control disabled) with the banner and Reopen; sealed → no controls;
 * - results: rendered for a GM (each manager's grade and minutes, write-ins, themes); a KH/SL who did not
 *   author that day is refused by the lib before anything renders;
 * - my feedback v2: bands only — no manager's name, no note text, no number;
 * - en + es parity for every pmv2.* key, every key the components use exists, 44 px buttons with items-center,
 *   no shop code literals.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import lifecycle from "./fixtures/pm-copy-lifecycle-cases.json";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => undefined) }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { PmCopyForm } = await import("@/components/pm-report-v2/PmCopyForm");
const { PmDayResults } = await import("@/components/pm-report-v2/PmDayResults");
const { MyFeedbackV2 } = await import("@/components/pm-report-v2/MyFeedbackV2");
const { loadDayResults, loadMyCopy, loadMyFeedbackV2 } = await import("@/lib/pm-report-v2");
const { copyFormState } = await import("@/lib/pm-report-v2-shared");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KH = id(1), GM = id(2), SL = id(3), EMP = id(6);
const ST = id(11), P_EXPO = id(21), C_SHARED = id(31), C_EXPO = id(32), DAY = id(41), COPY_KH = id(42), COPY_GM = id(43);
const DATE = "2026-10-15";
const kh = { userId: KH, role: "key_holder" as const, level: 4, locations: [A] };
const gm = { userId: GM, role: "gm" as const, level: 7, locations: [A] };
const sl = { userId: SL, role: "shift_lead" as const, level: 5, locations: [A] };

function tables(submitted: boolean): Tables {
  return {
    users: [{ id: KH, name: "Kim", role: "key_holder", active: true }, { id: GM, name: "Alex", role: "gm", active: true }, { id: EMP, name: "Eli", role: "employee", active: true }],
    pm_reports: [{ id: DAY, location_id: A, report_date: DATE, status: submitted ? "submitted" : "open", format: "v2", created_by: GM, submitted_by: submitted ? GM : null, submitted_at: submitted ? "2026-10-16T03:00:00Z" : null, mvp_user_id: null, superseded_at: null }],
    pm_report_copies: [
      { id: COPY_KH, pm_report_id: DAY, location_id: A, author_id: KH, status: submitted ? "sealed" : "open", observed_from: "2026-10-15T20:00:00Z", observed_to: "2026-10-15T21:00:00Z", created_at: "2026-10-15T20:00:00Z", sealed_at: null },
      { id: COPY_GM, pm_report_id: DAY, location_id: A, author_id: GM, status: submitted ? "sealed" : "done", observed_from: "2026-10-15T18:00:00Z", observed_to: "2026-10-15T21:00:00Z", created_at: "2026-10-15T18:00:00Z", sealed_at: null },
    ],
    stations: [{ id: ST, location_id: A, active: true, sort: 1 }],
    station_positions: [{ id: P_EXPO, station_id: ST, location_id: A, name: "Expeditor", name_es: "Expedidor", sort: 1, active: true }],
    pm_criteria: [
      { id: C_SHARED, location_id: A, position_id: null, label: "Arrived ready", label_es: "Llegó listo", sort: 1, active: true },
      { id: C_EXPO, location_id: A, position_id: P_EXPO, label: "Ticket accuracy", label_es: "Precisión de tickets", sort: 1, active: true },
    ],
    station_events: [
      { id: "e1", sequence: 1, location_id: A, business_date: DATE, user_id: EMP, station_id: ST, position_id: P_EXPO, kind: "claim", at: "2026-10-15T18:00:00Z", source: "claimed", effective_at: null, reason_code: null },
      { id: "e2", sequence: 2, location_id: A, business_date: DATE, user_id: EMP, station_id: null, position_id: null, kind: "release", at: "2026-10-15T22:00:00Z", source: null, effective_at: null, reason_code: null },
    ],
    pm_copy_grades: [
      { id: "g-kh", copy_id: COPY_KH, location_id: A, subject_id: EMP, position_id: P_EXPO, criterion_id: C_EXPO, grade: "great", superseded_at: null },
      { id: "g-gm", copy_id: COPY_GM, location_id: A, subject_id: EMP, position_id: P_EXPO, criterion_id: C_SHARED, grade: "needs_work", superseded_at: null },
    ],
    pm_copy_notes: [
      { id: "n-kh", copy_id: COPY_KH, location_id: A, subject_id: EMP, position_id: P_EXPO, note: "slow on the slicer", superseded_at: null },
      { id: "n-gm", copy_id: COPY_GM, location_id: A, subject_id: EMP, position_id: P_EXPO, note: "GM-PRIVATE slicer slow", superseded_at: null },
    ],
    pm_copy_positions: [],
  };
}
const serviceFor = (submitted: boolean) => {
  const db = createFakeDb(tables(submitted));
  return { from: (t: string) => db.client.from(t), rpc: vi.fn() } as never;
};
const render = (node: ReturnType<typeof createElement>, language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: node }));
const myView = () => loadMyCopy(serviceFor(false), { actor: kh, locationId: A, date: DATE, presenceRoster: [{ id: EMP, name: "Eli" }], now: new Date("2026-10-16T03:00:00Z") });

describe("the copy form", () => {
  it("renders the author's own copy; another manager's grades and notes never reach the HTML", async () => {
    const view = (await myView())!;
    const html = render(createElement(PmCopyForm, { view, initiallyOpen: true }));
    expect(html).toContain("Your copy · only you can see it until the closing manager submits");
    expect(html).toContain("slow on the slicer");
    expect(html).toContain("Ticket accuracy");
    expect(html).toContain(en["pmv2.copy.others"].replace("{n}", "1"));
    expect(html).not.toContain("GM-PRIVATE");
    expect(html).not.toContain("g-gm");
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1); // only KH's own Great on Ticket accuracy
    expect(render(createElement(PmCopyForm, { view, initiallyOpen: true }), "es")).toContain("Tu copia · solo tú la ves hasta que el gerente de cierre la envíe");
  });

  it("the three lifecycle states come from the SHARED lifecycle file (open / done / sealed)", async () => {
    const view = (await myView())!;
    const writeCases = lifecycle.cases.filter((c) => c.act === "write" && c.day === "open" && c.author);
    expect(writeCases.map((c) => c.copy).sort()).toEqual(["done", "open", "sealed"]);
    for (const c of writeCases) {
      const status = c.copy as "open" | "done" | "sealed";
      const formState = copyFormState({ authorId: KH, locationId: A, status }, { locationId: A, status: "open", authorIds: [KH] });
      const html = render(createElement(PmCopyForm, { view: { ...view, copy: { ...view.copy, status }, formState }, initiallyOpen: true }));
      const gradeButtons = html.match(/<button[^>]*aria-pressed="(true|false)"[^>]*>/g) ?? [];
      if (c.expect === null) {
        expect(formState).toBe("editable");
        expect(gradeButtons.length).toBeGreaterThan(0);
        expect(gradeButtons.every((b) => !/\sdisabled=""/.test(b))).toBe(true);
        expect(html).toContain(en["pmv2.copy.markDone"]);
        expect(html).not.toContain(en["pmv2.copy.doneBanner"]);
      } else if (c.expect === "copy_done") {
        expect(formState).toBe("done_readonly");
        expect(html).toContain(en["pmv2.copy.doneBanner"]);
        expect(html).toContain(">Reopen<");
        expect(gradeButtons.every((b) => /\sdisabled=""/.test(b))).toBe(true);
        expect(html).not.toContain(en["pmv2.copy.markDone"]);
      } else {
        expect(formState).toBe("sealed");
        expect(html).toContain(en["pmv2.copy.sealed"]);
        expect(html).not.toContain(en["pmv2.submit.button"]);
        expect(gradeButtons.every((b) => /\sdisabled=""/.test(b))).toBe(true);
      }
    }
  });
});

describe("the results", () => {
  it("a GM sees each manager's grade and minutes, the write-ins attributed and the themes", async () => {
    const results = (await loadDayResults(serviceFor(true), { actor: gm, locationId: A, date: DATE }))!;
    const html = render(createElement(PmDayResults, { results, initiallyOpen: true }));
    expect(html).toContain("Kim · Great · 1h 0m");
    expect(html).toContain("Alex · Needs work · 3h 0m");
    expect(html).toContain("Kim: slow on the slicer");
    expect(html).toContain(en["pmv2.results.themes"]);
    expect(html).toContain("slicer");
  });
  it("a shift lead who did not author that day is refused by the lib (nothing renders)", async () => {
    await expect(loadDayResults(serviceFor(true), { actor: sl, locationId: A, date: DATE })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("my feedback v2", () => {
  it("bands only: no manager's name, no note text, no number", async () => {
    const days = await loadMyFeedbackV2(serviceFor(true), { userId: EMP });
    const html = render(createElement(MyFeedbackV2, { days, initiallyOpen: true }));
    expect(html).toContain("Ticket accuracy · Great");
    expect(html).toContain("Arrived ready · Building");
    for (const leak of ["Kim", "Alex", "slicer", "PRIVATE", "3.0", "1.0"]) expect(html).not.toContain(leak);
    expect(render(createElement(MyFeedbackV2, { days, initiallyOpen: true }), "es")).toContain("Precisión de tickets · Excelente");
  });
});

describe("the strings and the controls", () => {
  const files = ["components/pm-report-v2/PmCopyForm.tsx", "components/pm-report-v2/PmDayResults.tsx", "components/pm-report-v2/MyFeedbackV2.tsx", "app/(authed)/pm-report/page.tsx"];
  it("en + es parity for every pmv2.* key; every key a component names exists in both", () => {
    const enKeys = Object.keys(en).filter((k) => k.startsWith("pmv2.")).sort();
    const esKeys = Object.keys(es).filter((k) => k.startsWith("pmv2.")).sort();
    expect(esKeys).toEqual(enKeys);
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/"(pmv2\.[a-zA-Z_.]+)"/g)) {
        expect(en, `${f}: ${m[1]}`).toHaveProperty([m[1]!]);
        expect(es, `${f}: ${m[1]}`).toHaveProperty([m[1]!]);
      }
    }
    for (const prefix of ["pmv2.grade.", "pmv2.band.", "pmv2.error."]) expect(enKeys.some((k) => k.startsWith(prefix))).toBe(true);
  });
  it("every rendered button is a 44 px control with items-center; no shop code literal", async () => {
    const view = (await myView())!;
    const results = (await loadDayResults(serviceFor(true), { actor: gm, locationId: A, date: DATE }))!;
    const html = render(createElement(PmCopyForm, { view, initiallyOpen: true })) + render(createElement(PmDayResults, { results, initiallyOpen: true }));
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) {
      expect(b, b).toContain("min-h-[44px]");
      expect(b, b).toContain("items-center");
    }
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/["'](EM|MEP)["']/);
  });
});
