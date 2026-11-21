/**
 * Nav PR 4 (plan r2, 7.7): the Back office's new words, en and es in the same PR. Every key listed literally: present
 * in both dictionaries, non-empty, the same {params}; every _one has its _other; Spanish in tú-form (no usted), and
 * the job labels are infinitives like the two jobs already on the row.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { BACK_OFFICE_JOBS, BUYING_PATH, GROUP_LABELS, GROUP_ROWS } from "@/lib/nav/back-office";
import { byId } from "@/lib/nav/destinations";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

/** The keys PR 4 adds (plan r2, 3.2), by block, as they land. */
const NEW_KEYS = {
  states: ["admin.backoffice.state.issue", "admin.backoffice.state.healthy", "admin.backoffice.state.unavailable", "admin.backoffice.state.not_enabled"],
  attention: [
    "admin.backoffice.attention.title", "admin.backoffice.attention.summary", "admin.backoffice.attention.ok",
    "admin.backoffice.attention.ok_sales_today", "admin.backoffice.attention.ok_sales_date", "admin.backoffice.check.sales_pull",
    "admin.backoffice.check.inbox", "admin.backoffice.attention.sales_failed", "admin.backoffice.attention.sales_degraded",
    "admin.backoffice.attention.inbox_one", "admin.backoffice.attention.inbox_other", "admin.backoffice.attention.vendor_mail_one",
    "admin.backoffice.attention.vendor_mail_other", "admin.backoffice.attention.not_ready", "admin.backoffice.attention.unavailable",
  ],
  jobs: ["admin.backoffice.jobs.label", "admin.backoffice.job.add_person", "admin.backoffice.job.change_par", "admin.backoffice.job.edit_checklist"],
  groups: [
    "admin.backoffice.group.people_and_schedule.name", "admin.backoffice.group.people_and_schedule.line",
    "admin.backoffice.group.menu_and_recipes.name", "admin.backoffice.group.menu_and_recipes.line",
    "admin.backoffice.group.ordering_and_stock.name", "admin.backoffice.group.ordering_and_stock.line",
    "admin.backoffice.group.catering_setup.name", "admin.backoffice.group.catering_setup.line",
    "admin.backoffice.group.checklists_and_reports.name", "admin.backoffice.group.checklists_and_reports.line",
    "admin.backoffice.group.customers_and_marketing.name", "admin.backoffice.group.customers_and_marketing.line",
    "admin.backoffice.group.system.name", "admin.backoffice.group.system.line",
    "admin.backoffice.group.count_one", "admin.backoffice.group.count_other", "admin.backoffice.group.issues_one", "admin.backoffice.group.issues_other",
  ],
  buyingPath: [
    "admin.backoffice.step_label", "admin.backoffice.step.vendors", "admin.backoffice.step.skus", "admin.backoffice.step.products",
    "admin.backoffice.step.recipes", "admin.backoffice.step.items", "admin.backoffice.step.sandwiches",
  ],
  rows: [
    "admin.backoffice.row.schedule", "admin.backoffice.row.stations", "admin.backoffice.row.toast_employees", "admin.backoffice.row.sevenshifts",
    "admin.backoffice.row.people_reconcile", "admin.backoffice.row.pm_criteria", "admin.backoffice.row.shop_changes", "admin.backoffice.row.vendor_mail",
    "admin.backoffice.row.locations", "admin.backoffice.row.report_recipients", "admin.backoffice.row.customers", "admin.backoffice.row.marketing",
    "admin.backoffice.row.audit",
  ],
};
const ALL = Object.values(NEW_KEYS).flat();
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Back office keys, en and es", () => {
  it("61 new keys so far, and they are every admin.backoffice.* key", () => {
    expect(ALL).toHaveLength(61);
    expect(new Set(ALL).size).toBe(61);
    expect(Object.keys(EN).filter((k) => k.startsWith("admin.backoffice.")).sort()).toEqual([...ALL].sort());
  });

  it.each(ALL)("%s: in both languages, non-empty, the same {params}", (key) => {
    expect(EN[key], `en ${key}`).toBeTruthy();
    expect(ES[key], `es ${key}`).toBeTruthy();
    expect(params(ES[key]!), key).toEqual(params(EN[key]!));
  });

  it("every _one has its _other", () => {
    for (const k of ALL.filter((x) => x.endsWith("_one"))) expect(ALL, k).toContain(k.replace(/_one$/, "_other"));
  });


  it("the Catering setup group's name is the destination's name, in both languages", () => {
    expect(EN["admin.backoffice.group.catering_setup.name"]).toBe(EN["admin.section.catering"]);
    expect(ES["admin.backoffice.group.catering_setup.name"]).toBe(ES["admin.section.catering"]);
  });

  it("every label key the module names resolves in both languages", () => {
    const keys = [
      ...Object.values(GROUP_LABELS).flatMap((g) => [g.nameKey, g.lineKey]),
      ...Object.values(BUYING_PATH).map((p) => p.lineKey),
      ...BACK_OFFICE_JOBS.map((j) => j.labelKey),
      ...Object.values(GROUP_ROWS).flat().flatMap((id) => [byId(id).nameKey, byId(id).descriptionKey].filter((k) => k !== undefined)),
    ];
    for (const k of keys) { expect(EN[k], `en ${k}`).toBeTruthy(); expect(ES[k], `es ${k}`).toBeTruthy(); }
  });

  it("Spanish speaks tú, never usted", () => {
    for (const k of ALL) expect(ES[k], k).not.toMatch(/\busted\b|\b(Configure|Agregue|Edite|Cambie|Vincule|Conecte|Revise)\b/i);
  });

  it("the job labels are infinitives, like the two jobs already on the row", () => {
    for (const j of BACK_OFFICE_JOBS) expect(ES[j.labelKey], j.labelKey).toMatch(/^\p{Lu}\p{Ll}+(ar|er|ir)\b/u);
  });

  it("the three hand-made back-link keys are gone from both dictionaries", () => {
    for (const k of ["signals.sources.back", "marketing.adcodes.back", "customers.back"]) {
      expect(k in EN, k).toBe(false);
      expect(k in ES, k).toBe(false);
    }
  });
});
