/**
 * Nav PR 1, "Names" (nav spec r5, section 2): one canonical name per destination, in English and Spanish,
 * on every surface that labels it (page title, nav chip, Back office card, Reports hub link, Dashboard tile,
 * shift-board task, back link, search). Labels only: no route, gate or layout is pinned here.
 *
 * Three guards:
 *  1. the table: every key that labels a destination carries that destination's one name, in both languages;
 *  2. the registries: the nav chips (and so unified search), the Back office cards and the back-link parents
 *     label a destination only with one of that destination's keys;
 *  3. the source: no link written in a page or component is labelled with ANOTHER destination's name (a link
 *     may carry a job or status label, "Assign or cover", "Shift reports: 12"), and the links this PR
 *     re-pointed name their own destination.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS } from "@/lib/admin/sections";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { NAV_LINKS, navDestinationsFor } from "@/lib/nav-links";
import { parentFor } from "@/lib/nav-parents";

type Name = { en: string; es: string; keys: string[] };

/** Destination route → its one name (en / es) and every key that labels it. */
const NAMES: Record<string, Name> = {
  // 2.1 Juan's four
  "/dashboard": { en: "Dashboard", es: "Panel", keys: ["nav.dashboard"] },
  "/admin": { en: "Back office", es: "Oficina", keys: ["nav.admin", "admin.hub.heading", "admin.back_to_hub"] },
  "/operations/counts": { en: "Inventory count", es: "Conteo de inventario", keys: ["counts.page.title", "dashboard.counts.tile_label", "reports.hub.counts", "assignments.task.counts"] },
  "/assignments": { en: "Team today", es: "Equipo de hoy", keys: ["nav.assignments", "assignments.title", "assignments.team", "assignments.viewDay"] },
  // 2.2 The daily tasks
  "/operations/opening": { en: "Opening", es: "Apertura", keys: ["opening.page.label", "assignments.task.opening_report", "reports.type.opening", "midshift.report.opening", "admin.templates.type.opening", "admin.templates.builder.connections.report_ref.opening_report"] },
  "/operations/am-prep": { en: "AM prep list", es: "Lista de prep AM", keys: ["am_prep.page.title", "assignments.task.am_prep", "reports.type.am_prep", "midshift.report.am_prep", "admin.hub.week.row.am_prep", "admin.templates.type.am_prep", "admin.templates.subtype.am_prep", "admin.templates.builder.preview.mirror_flag", "admin.templates.builder.connections.report_ref.am_prep"] },
  "/operations/mid-day": { en: "Mid-day prep", es: "Prep de mediodía", keys: ["mid_day_prep.page.title", "dashboard.mid_day_prep.tile_label", "assignments.task.mid_day_prep", "reports.type.mid_day", "midshift.report.mid_day", "admin.hub.week.row.mid_day", "admin.templates.type.mid_day_prep", "admin.templates.subtype.mid_day_prep", "admin.templates.builder.connections.report_ref.mid_day_prep"] },
  "/operations/closing": { en: "Closing checklist", es: "Lista de cierre", keys: ["closing.page.title", "assignments.closing", "pulse.drawer.go_close"] },
  "/cash": { en: "Cash deposit", es: "Depósito de efectivo", keys: ["cash.page.title", "assignments.task.cash_report", "reports.type.cash", "midshift.report.cash", "admin.templates.builder.connections.report_ref.cash_report"] },
  "/pm-report": { en: "PM report", es: "Reporte PM", keys: ["pm.page.title", "assignments.task.pm_report", "reports.type.pm", "admin.templates.builder.connections.report_ref.pm_report"] },
  "/ordering": { en: "Ordering", es: "Pedidos", keys: ["nav.ordering", "dashboard.ordering.tile_label", "assignments.task.ordering", "pulse.inventory.ordering_link"] },
  "/operations/receiving": { en: "Receiving", es: "Recepción", keys: ["nav.receiving", "receiving.page.title", "dashboard.receiving.tile_label", "assignments.task.receiving"] },
  // 2.3 The rest
  "/mid-shift": { en: "Shop pulse", es: "Pulso de la tienda", keys: ["nav.mid_shift", "midshift.page.title", "pulse.page.title", "pulse.page.back"] },
  "/stations": { en: "Station guide", es: "Guía de estaciones", keys: ["stations.page.title"] },
  "/admin/stations": { en: "Station setup", es: "Configuración de estaciones", keys: ["admin.section.stations"] },
  "/profile": { en: "Team directory", es: "Directorio del equipo", keys: ["nav.profile", "profile.directory_title"] },
  "/my-feedback": { en: "My performance", es: "Mi desempeño", keys: ["nav.my_feedback", "me.title"] },
  "/maintenance": { en: "Maintenance", es: "Mantenimiento", keys: ["maintenance.nav_label", "maintenance.page.title", "reports.type.maintenance", "pulse.food_safety.maintenance_link"] },
  "/reports": { en: "Reports", es: "Reportes", keys: ["nav.reports_hub", "reports.page.title"] },
  "/reports/operations": { en: "Shift reports", es: "Reportes de turno", keys: ["reports.hub.operations"] },
  "/reports/trends": { en: "Trends", es: "Tendencias", keys: ["nav.trends", "reports.trends.landing.title"] },
  "/reports/trends/ops": { en: "Operations trends", es: "Tendencias de operaciones", keys: ["reports.hub.trends", "reports.trends.title", "reports.trends.nav_label", "reports.trends.landing.ops_card", "reports.trends.landing.view_ops"] },
  "/reports/trends/team": { en: "Team trends", es: "Tendencias del equipo", keys: ["reports.hub.team", "reports.trends.team.title", "reports.trends.team.nav_label", "reports.trends.landing.team_card", "reports.trends.landing.view_team"] },
  "/reports/written": { en: "Written reports", es: "Reportes escritos", keys: ["nav.written_reports", "written_reports.page.title", "reports.hub.written"] },
  "/catering": { en: "Catering", es: "Catering", keys: ["nav.catering", "catering.hub.title"] },
  "/catering/insights": { en: "Catering insights", es: "Resumen de catering", keys: ["catering.insights.title"] },
  "/admin/catering": { en: "Catering setup", es: "Configuración de catering", keys: ["admin.section.catering", "admin.catering.title", "catering.hub.admin_link_title"] },
  "/admin/catering/fulfillment": { en: "Delivery setup", es: "Configuración de entregas", keys: ["admin.catering.hub.fulfillment", "admin.catering.fulfillment.title"] },
  "/admin/catering/zones": { en: "Fees and minimums", es: "Tarifas y mínimos", keys: ["admin.catering.hub.zones", "admin.catering.zones.title"] },
  "/admin/catering/rate-rules": { en: "Catering rates", es: "Tarifas de catering", keys: ["admin.catering.hub.rate-rules", "admin.catering.hub.rate_rules", "admin.catering.rate.title"] },
  "/admin/catering/pricing": { en: "Tax, deposit and fees", es: "Impuesto, depósito y cargos", keys: ["admin.catering.hub.pricing", "admin.catering.pricing.title"] },
  "/admin/catering/lto": { en: "LTOs and discounts", es: "LTO y descuentos", keys: ["admin.catering.hub.lto", "admin.catering.lto.title"] },
  "/admin/users": { en: "Staff accounts", es: "Cuentas del personal", keys: ["admin.section.users", "admin.users.title"] },
  "/admin/checklist-templates": { en: "Checklists and prep lists", es: "Listas y checklists", keys: ["admin.section.checklist-templates", "admin.templates.title"] },
  "/admin/items": { en: "Prep items", es: "Artículos de prep", keys: ["admin.section.items", "admin.catalog.title"] },
  "/admin/catalog/new/item": { en: "Add an item we buy", es: "Agregar un artículo de compra", keys: ["catalog.jobs.new_item.title"] },
  "/admin/catalog/new/sandwich": { en: "Add a sandwich", es: "Agregar un sándwich", keys: ["catalog.jobs.sandwich.title"] },
  "/admin/pars": { en: "Par levels", es: "Niveles par", keys: ["admin.section.pars", "admin.pars.title"] },
  "/admin/categories": { en: "Categories and order types", es: "Categorías y tipos de orden", keys: ["admin.section.categories", "admin.categories.title"] },
  "/admin/locations": { en: "Shop email addresses", es: "Correos de las tiendas", keys: ["admin.section.locations", "admin.inbound.locations_title"] },
  "/admin/weights": { en: "Weights and trim", es: "Pesos y merma", keys: ["admin.section.weights", "admin.weights.title"] },
};

/** Opening's two steps (2.2): named inside the Opening page, never as a destination of their own. */
const OPENING_STEPS: Name[] = [
  { en: "Opening check", es: "Verificación de apertura", keys: ["opening.page.title", "opening.phase.tab_phase1", "admin.templates.builder.preview.phase1"] },
  { en: "Morning prep", es: "Prep de la mañana", keys: ["opening.phase.tab_phase2", "admin.templates.builder.preview.phase2"] },
];

/**
 * Section 2 names this PR deliberately does NOT apply, because the thing they name does not exist yet. Each keeps
 * its pre-rename value here, so the table is complete and the PR that applies it must flip this entry on purpose
 * (move it into NAMES, or into a step list, in the same change).
 */
const DEFERRED: { what: string; target: { en: string; es: string }; current: Name; appliedBy: string }[] = [
  {
    what: "/settings → Me",
    target: { en: "Me", es: "Yo" },
    current: { en: "Settings", es: "Configuración", keys: ["nav.settings", "settings.page.title"] },
    appliedBy: "nav PR 10, merge M4 (/settings retitled Me when it holds the Me rows)",
  },
];

/** Section 2 names APPLIED by a later PR, flipped out of DEFERRED on purpose. Not destinations (no route). */
const APPLIED: { what: string; name: { en: string; es: string }; keys: string[]; retiredKeys: string[]; appliedBy: string }[] = [
  {
    what: "the global button → Go to",
    name: { en: "Go to", es: "Ir a" },
    keys: ["nav.goto.open", "nav.goto.heading"],
    retiredKeys: ["user_menu.aria_label"],
    appliedBy: "nav PR 9 (the Go to sheet replaced the user menu)",
  },
];

/**
 * Links whose label is a JOB (a verb or an action), not the destination's name (spec 1, rule 2: "Jobs are
 * buttons"). Pinned so a job label is never mistaken for, or turned into, a destination's name.
 */
const JOB_LABELS = new Set<string>([
  "pulse.drawer.go_assign", // "Assign or cover" → Team today
  "catalog.counting.open", // "Open inventory count"
  "assignments.editClosing", // "Edit closing checklist" → the closing template
  "dashboard.yesterday.cta", // finish yesterday's close
  "reports.business.hub_open", // "Open the business report"
  "admin.backoffice.job.add_person", // "Add a person" → Staff accounts (nav PR 4, the Back office jobs row)
  "admin.backoffice.job.change_par", // "Change a par" → Par levels
  "admin.backoffice.job.edit_checklist", // "Edit a checklist" → Checklists and prep lists
]);

/**
 * Keys that labelled more than one destination before this PR and now label none: "Stations" named the Station
 * guide, Station setup AND two Team today links. It stays only as a section heading inside the board.
 */
const RETIRED_LINK_LABELS = new Set<string>(["assignments.stations"]);

const enDict = en as Record<string, string>;
const esDict = es as Record<string, string>;
const routeFor = new Map<string, string>(Object.entries(NAMES).flatMap(([route, name]) => name.keys.map((key) => [key, route] as const)));

describe("nav names: one canonical name per destination (spec section 2)", () => {
  it("no key labels two destinations", () => {
    const seen = new Map<string, string>();
    for (const [route, { keys }] of Object.entries(NAMES)) for (const key of keys) {
      expect(seen.get(key), `${key} labels ${seen.get(key)} and ${route}`).toBeUndefined();
      seen.set(key, route);
    }
  });

  it.each(Object.entries(NAMES))("%s carries its one name in English and Spanish on every surface", (_route, { en: enName, es: esName, keys }) => {
    for (const key of keys) {
      expect(enDict[key], `en ${key}`).toBe(enName);
      expect(esDict[key], `es ${key}`).toBe(esName);
    }
  });

  it("Opening's two steps carry their step names", () => {
    for (const { en: enName, es: esName, keys } of OPENING_STEPS) for (const key of keys) {
      expect(enDict[key], `en ${key}`).toBe(enName);
      expect(esDict[key], `es ${key}`).toBe(esName);
    }
  });

  it.each(DEFERRED)("DEFERRED: $what is not applied yet (by $appliedBy) and still reads its pre-rename value", ({ target, current }) => {
    for (const key of current.keys) {
      expect(enDict[key], `en ${key}`).toBe(current.en);
      expect(esDict[key], `es ${key}`).toBe(current.es);
      expect(routeFor.has(key), `${key} is deferred, not a named surface`).toBe(false);
    }
    // The target name is not already in use for another destination.
    expect(Object.values(NAMES).map((n) => n.en)).not.toContain(target.en);
    expect(Object.values(NAMES).map((n) => n.es)).not.toContain(target.es);
  });

  it.each(APPLIED)("APPLIED: $what (by $appliedBy)", ({ name, keys, retiredKeys }) => {
    for (const key of keys) {
      expect(enDict[key], `en ${key}`).toBe(name.en);
      expect(esDict[key], `es ${key}`).toBe(name.es);
    }
    for (const key of retiredKeys) {
      expect(enDict[key], `en ${key} retired`).toBeUndefined();
      expect(esDict[key], `es ${key} retired`).toBeUndefined();
    }
  });

  it("no two destinations share a name in either language", () => {
    for (const lang of ["en", "es"] as const) {
      const names = Object.values(NAMES).map((n) => n[lang]);
      // Catering is the same word in both languages; the check is per language.
      expect(names.filter((n, i) => names.indexOf(n) !== i), lang).toEqual([]);
    }
  });

  it("the English and Spanish dictionaries hold the same keys", () => {
    expect(Object.keys(esDict).sort()).toEqual(Object.keys(enDict).sort());
  });
});

describe("nav names: the registries label each destination with one of its keys", () => {
  it("nav chips and unified search (navDestinationsFor at every level, every switch on)", () => {
    const links = [...NAV_LINKS, ...navDestinationsFor(10, { vault: true, pulseV2: true })];
    for (const { href, key } of links) if (NAMES[href]) expect(NAMES[href].keys, `${href} chip`).toContain(key);
  });

  it("Back office cards", () => {
    for (const { href, i18nKey } of ADMIN_SECTIONS) if (NAMES[href]) expect(NAMES[href].keys, `${href} card`).toContain(i18nKey);
  });

  it.each([
    "/admin/users", "/admin/stations", "/admin/catering", "/admin/catering/zones", "/admin/catering/fulfillment",
    "/admin/checklist-templates/closing", "/stations", "/my-feedback", "/reports/operations", "/reports/trends/team/p1",
    "/reports/trends/ops", "/reports/written/r1", "/reports/am_prep/r1", "/catering/insights", "/admin",
  ])("the back link from %s names its parent with one of the parent's keys", (child) => {
    const parent = parentFor(child);
    expect(NAMES[parent.href], `${child} → ${parent.href}`).toBeDefined();
    expect(NAMES[parent.href]?.keys).toContain(parent.labelKey);
  });
});

describe("nav names: links in pages and components name their destination", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".tsx")) files.push(path);
    }
  };
  walk("app");
  walk("components");

  // <Link|a|ActionLink href="/route" or href={`/route?...`} ...> followed directly by t("key") / serverT(lang, "key").
  const LINK = /href=\{?["`](\/[a-z0-9\-/]*?)\/?(?=[?"`#])[^>]*>\s*\{?\s*(?:t|serverT\(\s*[a-zA-Z.]+\s*,\s*)\(?\s*"([a-zA-Z0-9_.-]+)"/g;

  it("finds the links (the scan is alive)", () => {
    const found = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(LINK)]);
    expect(found.length).toBeGreaterThan(20);
  });

  it("no link to a destination is labelled with ANOTHER destination's name, or with a retired shared label", () => {
    const wrong: string[] = [];
    for (const file of files) {
      for (const [, route = "", key = ""] of readFileSync(file, "utf8").matchAll(LINK)) {
        if (RETIRED_LINK_LABELS.has(key)) { wrong.push(`${file}: ${route} labelled "${key}" (a retired shared label)`); continue; }
        const owner = routeFor.get(key);
        if (owner && owner !== route) wrong.push(`${file}: ${route} labelled "${key}" (the name of ${owner})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the links this PR re-pointed name their destination", () => {
    const linkKeys = (file: string, route: string) =>
      [...readFileSync(file, "utf8").matchAll(LINK)].filter(([, r]) => r === route).map(([, , key]) => key);
    expect(linkKeys("app/(authed)/reports/page.tsx", "/my-feedback")).toEqual(["nav.my_feedback"]);
    expect(linkKeys("app/(authed)/reports/page.tsx", "/catering/insights")).toEqual(["catering.insights.title"]);
    expect(linkKeys("app/(authed)/reports/page.tsx", "/operations/counts")).toEqual(["reports.hub.counts"]);
    expect(linkKeys("components/pulse/sections/PeopleSection.tsx", "/assignments")).toEqual(["nav.assignments"]);
    expect(linkKeys("components/pulse/sections/StationsSection.tsx", "/assignments")).toEqual(["nav.assignments"]);
    expect(linkKeys("components/assignments/ShiftBoardClient.tsx", "/stations")).toEqual(["stations.page.title"]);
    for (const job of JOB_LABELS) expect(routeFor.has(job), job).toBe(false);
  });

  it("the two station pages title themselves by their own names", () => {
    expect(readFileSync("app/(authed)/stations/page.tsx", "utf8")).toContain('"stations.page.title")}</h1>');
    expect(readFileSync("app/admin/stations/page.tsx", "utf8")).toContain('"admin.section.stations")}</h1>');
  });
});
