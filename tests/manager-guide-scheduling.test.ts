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
