/**
 * Scheduling Phase 1, Task 25 — the manager guide's three new sections (en + es) name the REAL buttons and labels.
 *
 * Every bold control the guide tells a manager to tap or read is the exact UI string, in both languages (the 3b
 * guide pin's pattern): 7shifts links, skills per position, PM report copies, the criteria editor. A renamed key
 * fails here, so the guide can't drift from the screens. Screenshots are not in yet: every new step says
 * "(not shown)".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const guide = readFileSync("docs/guides/manager-guide.md", "utf8");
/** `**` + the string up to its first {param}, trimmed: "Copies ({n})" → "**Copies (". */
const named = (s: string) => `**${s.split("{")[0]!.trim()}`;

const KEYS = [
  // 7shifts links
  "sevenshifts.title", "sevenshifts.people.title", "sevenshifts.people.waitingTitle", "sevenshifts.people.pick", "sevenshifts.link",
  "sevenshifts.people.confirmYes", "sevenshifts.people.linkedTitle", "sevenshifts.unlink", "sevenshifts.people.unlinkYes", "sevenshifts.sync.now",
  // skills
  "people.skills.title", "people.skills.band.strong", "people.skills.band.solid", "people.skills.band.building", "people.skills.startingPoint",
  "people.skills.evidenceTitle", "people.skills.historyTitle", "people.skills.otherPositions", "people.skills.adjust.title",
  "people.skills.adjust.pickReason", "people.skills.adjust.save", "people.skills.reason.observed_on_floor", "people.skills.reason.training_completed",
  "people.skills.reason.correction", "people.skills.reason.other", "people.skills.unsaved", "people.skills.rate.title", "people.skills.rate.save",
  "people.skills.self.title",
  // PM report copies
  "pmv2.copy.header", "pmv2.window.title", "pmv2.window.from", "pmv2.window.to", "pmv2.window.save", "pmv2.grade.great", "pmv2.grade.good",
  "pmv2.grade.needs_work", "pmv2.grade.didntSee", "pmv2.note.label", "pmv2.add.open", "pmv2.add.save", "pmv2.person.unsaved",
  "pmv2.copy.markDone", "pmv2.copy.reopen", "pmv2.submit.button", "pmv2.submit.mvp", "pmv2.submit.confirmButton", "pmv2.submit.cancel",
  "pmv2.results.byPerson", "pmv2.results.copies", "pmv2.results.themes", "pmv2.mine.title",
  // the criteria editor
  "pmCriteria.title", "pmCriteria.save", "pmCriteria.addTitle", "pmCriteria.add", "pmCriteria.deactivate", "pmCriteria.reactivate",
] as const;

describe("the manager guide's scheduling sections match what was built, en + es", () => {
  it("has the three sections, each with its Spanish twin", () => {
    for (const h of ["### Linking people to 7shifts (GM)", "### Skills per position (GM)", "### PM report copies (when your shop uses PM reports v2)",
      "#### Enlazar personas con 7shifts (gerente general)", "#### Habilidades por puesto (gerente general)", "#### Copias del reporte PM (cuando tu tienda usa el reporte PM v2)"]) {
      expect(guide, h).toContain(h);
    }
  });

  it("names every button and label exactly as the app shows it, in both languages", () => {
    for (const k of KEYS) {
      expect(guide, k).toContain(named(en[k]));
      expect(guide, `${k} (es)`).toContain(named(es[k]));
    }
  });

  it("says the plain truths the screens enforce", () => {
    const en7 = guide.slice(guide.indexOf("### Linking people to 7shifts (GM)"), guide.indexOf("### Skills per position (GM)"));
    expect(en7).toContain("We never match people by name: you confirm each person.");
    const enPm = guide.slice(guide.indexOf("### PM report copies"), guide.lastIndexOf("### En español"));
    expect(enPm).toContain("not even the owner");
    expect(enPm).toContain("how long they saw that person at that position");
    expect(enPm).toContain("Nobody gets a notice");
    const enSkills = guide.slice(guide.indexOf("### Skills per position (GM)"), guide.indexOf("### PM report copies"));
    expect(enSkills).toContain("The reason is required");
    expect(enSkills).toContain("They never see a number, a rank or your adjustment.");
  });

  it("every new English step is marked (not shown) until its screenshot exists", () => {
    const section = guide.slice(guide.indexOf("### Linking people to 7shifts (GM)"), guide.lastIndexOf("### En español"));
    const steps = section.split("\n").filter((l) => l.startsWith("#### "));
    expect(steps.length).toBeGreaterThanOrEqual(14);
    for (const s of steps) expect(s, s).toMatch(/\(not shown\)$/);
    expect(section).not.toMatch(/!\[/);
  });
});

/**
 * Scheduling Phase 2, Task 27 — the guide's Phase 2 sections (the board, planning ahead, the hours budget, the labor
 * card, schedule settings, the reconciliation), en + es, name the REAL buttons and labels: every bold control below is
 * the exact UI string in both languages, so a renamed key fails here. Screenshots are not in yet: every step is
 * "(not shown)" (the Phase 1 test above covers every English step from "Linking people to 7shifts" to "En español").
 */
const P2_KEYS = [
  // the board
  "schedule.page.title", "schedule.board.act.generate", "schedule.board.act.regenerate", "schedule.board.timeline.fit", "schedule.board.nudge.earlier",
  "schedule.board.nudge.later", "schedule.board.reason.why_shift", "schedule.board.reason.who_else", "schedule.board.rules.pass",
  "schedule.board.approve.button", "schedule.board.ready_for_7shifts", "schedule.board.edit.head_moved",
  // planning ahead and rebuilding an edited week
  "schedule.board.horizon.title", "schedule.board.horizon.mode.next_week", "schedule.board.horizon.mode.next_weeks", "schedule.board.horizon.mode.rest_of_month",
  "schedule.board.horizon.mode.month", "schedule.board.horizon.preview", "schedule.board.horizon.apply", "schedule.board.horizon.edited_warning",
  "schedule.board.horizon.confirm_week", "schedule.board.regenerate.cancel",
  // the hours budget
  "schedule.board.budget.title", "schedule.board.budget.scope_week", "schedule.board.budget.scope_month", "schedule.board.budget.hours", "schedule.board.budget.save",
  "schedule.budget.none_set", "schedule.board.budget.set_link", "schedule.board.suggest.accept", "schedule.board.suggest.keep",
  // the labor card
  "schedule.board.labor_card.title", "schedule.board.labor_card.amber",
  // schedule settings
  "schedule.board.settings_link", "schedule.settings.structure_title", "schedule.settings.save", "schedule.settings.staff.title", "schedule.settings.presence.section",
  "schedule.settings.add.button", "schedule.settings.shop.title", "schedule.settings.shop.enabled", "schedule.settings.shop.hourly_estimate",
  "schedule.settings.shop.salaried_estimate", "schedule.settings.shop.agm_access",
  // the reconciliation
  "schedule.reconcile.title", "schedule.reconcile.basis.published", "schedule.reconcile.basis.proposal", "schedule.reconcile.action.link_toast",
  "schedule.reconcile.action.link_seven", "schedule.reconcile.tick.not_connected",
] as const;

const P2_EN = ["### The schedule board (GM)", "### Planning ahead (GM)", "### The hours budget (GM)", "### The labor target (GM)",
  "### Schedule settings (GM, Director of Operations)", "### People across CO-OPS, Toast and 7shifts (GM)"];
const P2_ES = ["#### El horario (gerente general)", "#### Planear con anticipación (gerente general)", "#### El presupuesto de horas (gerente general)",
  "#### El objetivo de mano de obra (gerente general)", "#### Ajustes del horario (gerente general, Director de Operaciones)",
  "#### Personas en CO-OPS, Toast y 7shifts (gerente general)"];

describe("the manager guide's Phase 2 sections match what was built, en + es", () => {
  it("has the six sections, each with its Spanish twin, before the Spanish part", () => {
    const es0 = guide.lastIndexOf("### En español");
    for (const h of P2_EN) { expect(guide, h).toContain(h); expect(guide.indexOf(h)).toBeLessThan(es0); }
    for (const h of P2_ES) { expect(guide, h).toContain(h); expect(guide.indexOf(h)).toBeGreaterThan(es0); }
  });

  it("names every button and label exactly as the app shows it, in both languages", () => {
    for (const k of P2_KEYS) {
      expect(guide, k).toContain(named(en[k]));
      expect(guide, `${k} (es)`).toContain(named(es[k]));
    }
  });

  it("says the plain truths the screens enforce", () => {
    const board = guide.slice(guide.indexOf("### The schedule board (GM)"), guide.lastIndexOf("### En español"));
    expect(board).toContain("Nothing is sent to 7shifts yet");
    expect(board).toContain("Nobody gets a notice");
    expect(board).toContain("asks for your password every time");
    expect(board).toContain("An AGM sees hours and people, never dollars");
    const recon = guide.slice(guide.indexOf("### People across CO-OPS, Toast and 7shifts (GM)"), guide.lastIndexOf("### En español"));
    expect(recon).toContain("Nothing here links people by name");
    expect(recon).toContain("Toast stays the backup source of actual hours");
    const settings = guide.slice(guide.indexOf("### Schedule settings"), guide.indexOf("### People across CO-OPS"));
    expect(settings).toContain("off for every shop until the Director of Operations turns it on");
  });
});
