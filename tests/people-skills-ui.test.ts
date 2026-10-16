/**
 * Scheduling Phase 1, Task 17 — the skills UI, rendered with react-dom/server.
 *
 * - GM: the Adjust control (− / + , reason, Save) and, on a starting point, "Set a starting rating";
 * - AGM: the same view without any control; the SMM never reaches it (the page redirects before any read,
 *   and the lib refuses — pinned in source order here);
 * - self (R8): bands and positive lines only — no "0." value, no "Adjusted"/"Ajust" text and no adjustment
 *   or rating key, even when the person HAS an adjustment and a rating;
 * - disclosure: collapsed by default; 44 px controls with items-center; en + es keys for every string used.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { emptySkillFacts, type SkillFacts } from "@/lib/people/facts-shared";
import { computeSkills, toManagerSkillView, toSelfSkillView, type ManagerSkillView } from "@/lib/people/skill-matrix-shared";
import { SKILL_TUNABLE_DEFAULTS as D } from "@/lib/people/tunables-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { SkillsSection } = await import("@/components/people/SkillsSection");
const { MySkills } = await import("@/components/people/MySkills");

const SHOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GM = "99999999-9999-4999-8999-999999999999";
const ST = "51515151-5151-4151-8151-515151515151";
const P_WALK = "11111111-1111-4111-8111-111111111111";
const P_PREP = "22222222-2222-4222-8222-222222222222";
const P_NEW = "33333333-3333-4333-8333-333333333333";

function facts(): SkillFacts {
  const f = emptySkillFacts();
  f.stations = [{ id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true, usually_closes_at: "22:00:00" }];
  f.positions = [
    { id: P_WALK, station_id: ST, name: "Walk-ins", name_es: "Tienda", sort: 1, active: true },
    { id: P_PREP, station_id: ST, name: "Prep", name_es: "Prep", sort: 2, active: true },
    { id: P_NEW, station_id: ST, name: "Expeditor", name_es: "Expedidor", sort: 3, active: true },
  ];
  f.stationEvents = [
    { id: "e1", sequence: "1", locationId: SHOP, businessDate: "2026-10-14", userId: EMP, stationId: ST, positionId: P_WALK, kind: "claim", at: "2026-10-14T20:00:00Z", source: "claimed", effectiveAt: null },
    { id: "e2", sequence: "2", locationId: SHOP, businessDate: "2026-10-14", userId: EMP, stationId: null, positionId: null, kind: "release", at: "2026-10-15T02:30:00Z", source: null, effectiveAt: null },
  ];
  f.closingInstances = [{ id: "i1", date: "2026-10-14", template_id: "t1", shift_start_at: null, triggered_at: null }];
  f.closingItems = [{ id: "li1", template_id: "t1", station: "Walk-ins", active: true }];
  f.closingCompletions = [{ id: "c1", instance_id: "i1", template_item_id: "li1", completed_by: EMP, completed_at: "2026-10-15T02:05:00Z" }];
  f.productions = [{ id: "pr1", itemId: "ham", producedAt: "2026-10-14T21:00:00Z", madeBy: EMP, batchesMade: 1, cameOutTo: 10, yieldAtTime: 10 }];
  f.adjustments = [{ id: "ad1", user_id: EMP, position_id: P_WALK, delta: 0.1, reason_code: "observed_on_floor", reason_note: null, actor_id: GM, created_at: "2026-10-12T15:00:00Z" }];
  f.ratings = [{ id: "ra1", user_id: EMP, position_id: P_WALK, rating: 0.8, reason_code: "training_completed", reason_note: null, actor_id: GM, created_at: "2026-10-01T15:00:00Z" }];
  return f;
}
const names = new Map([[GM, "Alex"]]);
const computed = () => computeSkills({
  locationId: SHOP, facts: facts(), members: [{ userId: EMP, name: "Eli", role: "employee" }], asOf: "2026-10-15",
  nowIso: "2026-10-15T20:00:00Z", tunables: D, actorNames: names,
});
const managerView = (canAdjust: boolean): ManagerSkillView => toManagerSkillView({ computed: computed(), subjectId: EMP, facts: facts(), actorNames: names, canAdjust });
const render = (node: ReturnType<typeof createElement>, language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: node }));

describe("the manager view", () => {
  it("GM: the summary, the row (bar, value, band, based-on, the Adjusted chip), evidence, history, and the Adjust control", () => {
    const html = render(createElement(SkillsSection, { view: managerView(true), initiallyOpen: true }));
    expect(html).toContain("Skills");
    expect(html).toContain("1 positions · 1 adjusted");
    expect(html).toContain("Walk-ins");
    expect(html).toContain("Adjusted +0.10");
    expect(html).toContain("based on 1 days");
    expect(html).toContain("Closing lines done before the station closed: 1 of 1");
    expect(html).toContain("Manager adjustment +0.10 · Alex");
    expect(html).toContain("Observed on the floor");
    expect(html).toContain("Adjust this skill");
    expect(html).toContain("Save adjustment");
    expect(html).toContain("Set a starting rating"); // 1 quality day < 3: still a starting point
    expect(html).toContain("Other positions");
  });

  it("collapsed by default: only the summary row renders", () => {
    const html = render(createElement(SkillsSection, { view: managerView(true) }));
    expect(html).toContain("1 positions · 1 adjusted");
    expect(html).not.toContain("Adjust this skill");
    expect(html).not.toContain("Closing lines done");
  });

  it("AGM (cannot adjust): the same evidence, no control", () => {
    const html = render(createElement(SkillsSection, { view: managerView(false), initiallyOpen: true }));
    expect(html).toContain("Closing lines done before the station closed");
    expect(html).not.toContain("Adjust this skill");
    expect(html).not.toContain("Set a starting rating");
    expect(html).not.toContain("Save adjustment");
  });

  it("Spanish: the position's Spanish name, the band and the reasons in es", () => {
    const html = render(createElement(SkillsSection, { view: managerView(true), initiallyOpen: true }), "es");
    expect(html).toContain("Tienda");
    expect(html).toContain("Ajustado +0.10");
    expect(html).toContain("Observado en el piso");
    expect(html).toContain("Guardar ajuste");
  });

  it("every control is 44 px with items-center", () => {
    const src = readFileSync("components/people/SkillsSection.tsx", "utf8");
    for (const m of src.matchAll(/min-h-\[44px\][^"]*/g)) expect(m[0]).toContain("items-center");
    expect(src).not.toMatch(/["'](EM|MEP)["']/);
  });
});

describe("the self view (R8)", () => {
  const rows = () => toSelfSkillView(computed().matrix, EMP, D);
  it("bands and positive lines only — no number, no adjustment, no rating, even when the person has both", () => {
    for (const language of ["en", "es"] as const) {
      const html = render(createElement(MySkills, { rows: rows(), language }), language);
      expect(html).toContain(language === "en" ? "My skills" : "Mis habilidades");
      expect(html).toContain(language === "en" ? "What you&#x27;ve been doing well" : "Lo que has estado haciendo bien");
      const text = html.replace(/<[^>]+>/g, " "); // the visible text (a class like py-0.5 is not a number shown)
      expect(text).not.toMatch(/0\./);
      expect(text).not.toMatch(/Adjusted|Ajust/);
      expect(html).not.toContain("Alex");
      expect(html).not.toContain("people.skills.evidence.adjustment");
      expect(html).not.toContain("people.skills.evidence.rating");
    }
    expect(JSON.stringify(rows())).not.toMatch(/adjust|rating|confidence|value/);
  });
  it("the band comes from the LEARNED skill: an adjustment cannot move it", () => {
    const withAdj = rows();
    const f = facts();
    f.adjustments = [];
    const without = toSelfSkillView(computeSkills({ locationId: SHOP, facts: f, members: [{ userId: EMP, name: "Eli", role: "employee" }], asOf: "2026-10-15", nowIso: "2026-10-15T20:00:00Z", tunables: D, actorNames: names }).matrix, EMP, D);
    expect(withAdj).toEqual(without);
  });
  it("only positions worked or observed: a position named only by a rating or adjustment never shows", () => {
    expect(rows().map((r) => r.positionId)).toEqual([P_WALK]);
  });
  it("an empty view says so", () => {
    expect(render(createElement(MySkills, { rows: [], language: "en" }))).toContain("Your skills show here after you work a position.");
  });
});

describe("the gates and the strings", () => {
  it("the person page refuses the SMM before any read; the skills load comes after the page gate", () => {
    const src = readFileSync("app/(authed)/reports/trends/team/[personId]/page.tsx", "utf8");
    const gate = src.indexOf("canOpenPeopleViews(peopleActorFromAuth(auth))");
    const load = src.indexOf("await loadSkills(sb,");
    expect(gate).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(gate);
    const self = readFileSync("app/(authed)/my-feedback/page.tsx", "utf8");
    expect(self).toContain("loadMySkills(sb, { actor: peopleActorFromAuth(auth), locationId: selected.id })");
  });

  it("every people.skills key the UI and the model use exists in en AND es", () => {
    const files = ["components/people/SkillsSection.tsx", "components/people/MySkills.tsx", "lib/people/skills-shared.ts", "lib/people/skill-matrix-shared.ts", "app/(authed)/reports/trends/team/[personId]/page.tsx"];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/"(people\.skills\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]!);
    for (const b of ["building", "solid", "strong"]) used.add(`people.skills.band.${b}`);
    for (const r of ["observed_on_floor", "training_completed", "correction", "other"]) used.add(`people.skills.reason.${r}`);
    for (const c of ["forbidden", "not_found", "invalid_payload", "invalid_adjustment", "invalid_rating", "invalid_reason", "invalid_tunables",
      "role_insufficient", "location_access_denied", "assignee_unavailable", "position_not_at_shop", "position_retired",
      "skills_unavailable", "pm_v2_unavailable", "write_failed", "generic"]) used.add(`people.skills.error.${c}`);
    expect(used.size).toBeGreaterThan(50);
    const E = en as Record<string, string>, S = es as Record<string, string>;
    for (const k of used) {
      expect(E[k], `en ${k}`).toBeTruthy();
      expect(S[k], `es ${k}`).toBeTruthy();
    }
    const enKeys = Object.keys(E).filter((k) => k.startsWith("people.skills.")).sort();
    expect(Object.keys(S).filter((k) => k.startsWith("people.skills.")).sort()).toEqual(enKeys);
  });
});
