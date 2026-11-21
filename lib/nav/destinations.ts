/**
 * THE destination list (nav spec r5, PR 3; plan r5 section 5): every page a person navigates to, once.
 *
 * Pure and client-safe. Every role list or floor here is either one of the four role-list constants the Back office
 * registry already imports, or a literal proved equal to the owning predicate by tests/nav-destinations-access.test.ts
 * (guard d) and the constant pins beside it. lib/nav never imports lib/demand-signals/* and never reads "works as".
 *
 * Order: room (ROOMS), then the Back office group (GROUPS), then the spec's order. Nothing renders this list yet:
 * NAV_LINKS, ADMIN_SECTIONS and the catering EDITORS are derived from it (lib/nav/legacy.ts) with their output
 * frozen by tests/nav-legacy-snapshot.test.ts; Go to, search and the Back office groups consume it in later PRs.
 */
import { PARS_VIEW_ROLES } from "@/lib/admin/pars-shared";
import { SANDWICHES_VIEW_ROLES } from "@/lib/admin/sandwiches-shared";
import { OPERATIONAL_LEVEL6_ROLES, PM_CRITERIA_EDITOR_ROLES } from "@/lib/people/access-shared";
import type { Destination, GroupId, RoomId, TabFamilyId } from "@/lib/nav/types";

/** Spec section 1, in display order. */
export const ROOMS: readonly RoomId[] = ["today", "catering", "reports", "back-office", "me"];
/** Spec 5.2, in display order. */
export const GROUPS: readonly GroupId[] = [
  "people-and-schedule", "menu-and-recipes", "ordering-and-stock", "catering-setup",
  "checklists-and-reports", "customers-and-marketing", "system",
];

const MOO_PLUS = ["moo", "owner", "cgs"] as const;
const GM_PLUS = ["gm", "moo", "owner", "cgs"] as const;

export const DESTINATIONS: readonly Destination[] = [
  // ─── Today ────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: "dashboard", route: "/dashboard", nameKey: "nav.dashboard", room: "today", takesShop: true, access: { minLevel: 0 }, numbers: false, kind: "place" },
  {
    id: "mid-shift", route: "/mid-shift", nameKey: "nav.mid_shift", room: "today", parent: "dashboard", children: ["/mid-shift/[section]"],
    takesShop: true, access: { minLevel: 4, floorWhenOn: { switch: "pulseV2", minLevel: 2 } }, surface: "ops", numbers: true, kind: "place",
    aliases: { en: ["Mid-Shift Pulse"], es: ["Pulso de medio turno"] },
  },
  {
    id: "assignments", route: "/assignments", nameKey: "nav.assignments", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 0 }, surface: "ops", numbers: false, kind: "place", legacy: { chipScoped: true },
    aliases: { en: ["Assignments", "View my day", "Today's team"], es: ["Asignaciones", "Ver mi día"] },
  },
  {
    id: "profile", route: "/profile", nameKey: "nav.profile", room: "today", parent: "dashboard", children: ["/profile/[userId]"],
    takesShop: false, access: { minLevel: 0 }, numbers: false, kind: "place", legacy: { chipScoped: false },
    aliases: { en: ["Profile", "Team Profiles"], es: ["Perfil", "Perfiles del Equipo"] },
  },
  {
    id: "station-guide", route: "/stations", nameKey: "stations.page.title", room: "today", parent: "assignments", takesShop: true,
    access: { minLevel: 0 }, surface: "ops", numbers: false, kind: "place", aliases: { en: ["Stations"], es: ["Estaciones"] },
  },
  {
    id: "opening", route: "/operations/opening", nameKey: "opening.page.label", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 4, assignedFrom: 3 }, task: "opening_report", surface: "tasks", numbers: false, kind: "place",
    aliases: { en: ["Opening Report", "Opening prep"], es: ["Reporte de apertura", "Preparación de apertura"] },
  },
  {
    id: "am-prep", route: "/operations/am-prep", nameKey: "am_prep.page.title", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 4, assignedFrom: 3 }, task: "am_prep", surface: "tasks", numbers: false, kind: "place",
  },
  {
    id: "mid-day", route: "/operations/mid-day", nameKey: "mid_day_prep.page.title", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 4, assignedFrom: 3 }, task: "mid_day_prep", surface: "tasks", numbers: false, kind: "place",
    aliases: { en: [], es: ["Preparación de mediodía", "Preparación del mediodía"] },
  },
  {
    id: "closing", route: "/operations/closing", nameKey: "closing.page.title", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 0 }, surface: "tasks", numbers: false, kind: "place",
  },
  {
    id: "cash", route: "/cash", nameKey: "cash.page.title", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 4, assignedFrom: 4 }, task: "cash_report", surface: "ops", numbers: true, kind: "place",
    aliases: { en: ["Cash report"], es: ["Reporte de caja"] },
  },
  {
    id: "pm-report", route: "/pm-report", nameKey: "pm.page.title", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 4, assignedFrom: 4 }, task: "pm_report", surface: "ops", numbers: true, kind: "place",
  },
  {
    id: "ordering", route: "/ordering", nameKey: "nav.ordering", room: "today", tabFamily: "stock-loop", parent: "dashboard", takesShop: true,
    access: { minLevel: 4, assignedFrom: 4 }, task: "ordering", surface: "ops", numbers: true, kind: "place", labels: { hub: "nav.ordering" },
  },
  {
    id: "receiving", route: "/operations/receiving", nameKey: "receiving.page.title", room: "today", tabFamily: "stock-loop", parent: "dashboard",
    children: ["/operations/receiving/[id]"], takesShop: true, access: { minLevel: 4, assignedFrom: 4 }, task: "receiving", surface: "ops",
    numbers: true, kind: "place",
  },
  {
    id: "counts", route: "/operations/counts", nameKey: "counts.page.title", room: "today", tabFamily: "stock-loop", parent: "dashboard",
    takesShop: true, access: { minLevel: 4, assignedFrom: 4 }, task: "counts", surface: "ops", numbers: true, kind: "place",
    labels: { hub: "reports.hub.counts" },
    aliases: { en: ["Inventory Audit", "Counts", "Counts and variance"], es: ["Auditoría de inventario", "Conteos", "Conteos y variaciones"] },
  },
  {
    id: "production", route: "/operations/production", nameKey: "production.page.title", room: "today", parent: "dashboard",
    children: ["/operations/production/yield"], takesShop: true, access: { minLevel: 3 }, surface: "ops", numbers: true, kind: "place",
    legacy: { chipScoped: true },
  },
  {
    id: "maintenance", route: "/maintenance", nameKey: "maintenance.nav_label", room: "today", parent: "dashboard", takesShop: true,
    access: { minLevel: 3 }, surface: "ops", numbers: false, kind: "place", legacy: { chipScoped: true },
    aliases: { en: ["Maintenance Log"], es: ["Registro de mantenimiento"] },
  },
  {
    id: "vendor-mail", route: "/operations/vendor-mail", nameKey: "vendorMail.title", room: "today", group: "ordering-and-stock",
    tabFamily: "stock-loop", parent: "dashboard", takesShop: true, access: { minLevel: 7, onlyRoles: GM_PLUS }, surface: "ops", numbers: true,
    kind: "place",
  },

  // ─── Catering ─────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "catering-workspace", route: "/catering", nameKey: "nav.catering", descriptionKey: "catering.hub.subtitle", room: "catering",
    parent: "dashboard", takesShop: false, access: { minLevel: 5 }, surface: "catering", numbers: true, kind: "place", legacy: { chipScoped: true },
  },
  {
    id: "catering-insights", route: "/catering/insights", nameKey: "catering.insights.title", descriptionKey: "catering.hub.insights_desc",
    room: "catering", parent: "catering-workspace", takesShop: false, access: { minLevel: 5 }, surface: "catering", numbers: true, kind: "place",
    aliases: { en: [], es: ["Panel de Catering"] },
  },
  {
    id: "catering-pipeline", route: "/catering/pipeline", nameKey: "catering.pipeline.title", descriptionKey: "catering.hub.pipeline_desc",
    room: "catering", parent: "catering-workspace", takesShop: false, access: { minLevel: 5 }, surface: "catering", numbers: true, kind: "place",
  },
  {
    id: "catering-quotes", route: "/catering/quotes", nameKey: "catering.quotes.title", descriptionKey: "catering.hub.quotes_desc",
    room: "catering", parent: "catering-workspace", takesShop: false, access: { minLevel: 5 }, surface: "catering", numbers: true, kind: "place",
  },
  {
    id: "catering-customers", route: "/catering/customers", nameKey: "catering.customers.title", descriptionKey: "catering.hub.customers_desc",
    room: "catering", tabFamily: "catering-customers", parent: "catering-workspace", takesShop: false, access: { minLevel: 5 },
    surface: "catering", numbers: true, kind: "place",
  },
  {
    id: "catering-companies", route: "/catering/companies", nameKey: "catering.companies.title", descriptionKey: "catering.hub.companies_desc",
    room: "catering", tabFamily: "catering-customers", parent: "catering-workspace", takesShop: false, access: { minLevel: 5 },
    surface: "catering", numbers: true, kind: "place",
  },
  {
    id: "catering-inbox", route: "/catering/inbox", nameKey: "catering.inbox.title", descriptionKey: "catering.inbox.hub_desc", room: "catering",
    parent: "catering-workspace", takesShop: false, access: { minLevel: 8, alsoRoles: ["gm", "catering_mgr"] }, surface: "catering",
    numbers: true, kind: "place",
  },
  {
    id: "lto", route: "/lto", nameKey: "nav.lto", room: "catering", tabFamily: "lto", parent: "dashboard", takesShop: false,
    access: { minLevel: 6 }, surface: "catering", numbers: true, kind: "place", legacy: { chipScoped: true },
  },
  {
    id: "catering", route: "/admin/catering", nameKey: "admin.section.catering", descriptionKey: "admin.catering.subtitle", room: "catering",
    group: "catering-setup", parent: "admin", takesShop: false, access: { minLevel: 6 }, surface: "catering", numbers: true, kind: "place",
    labels: { hub: "catering.hub.admin_link_title" },
  },
  editor("catering-packages", "/admin/catering/packages", "admin.catering.hub.packages", 6, "packages"),
  editor("catering-menu", "/admin/catering/menu", "admin.catering.hub.menu", 7, "menu"),
  { ...editor("catering-pricing", "/admin/catering/pricing", "admin.catering.hub.pricing", 8, "pricing"), tabFamily: "catering-prices", aliases: { en: ["Pricing & Tax"], es: ["Precios e impuestos"] } },
  { ...editor("catering-rate-rules", "/admin/catering/rate-rules", "admin.catering.hub.rate_rules", 8, "rate-rules"), tabFamily: "catering-prices" },
  editor("catering-capacity", "/admin/catering/capacity", "admin.catering.hub.capacity", 7, "capacity"),
  { ...editor("catering-zones", "/admin/catering/zones", "admin.catering.hub.zones", 7, "zones"), aliases: { en: ["Delivery Zones"], es: ["Zonas de entrega"] } },
  { ...editor("catering-faq", "/admin/catering/faq", "admin.catering.hub.faq", 6, "faq"), numbers: false },
  { ...editor("catering-prep-demand", "/admin/catering/prep-demand", "admin.catering.prep_demand.card", 6, "prep-demand"), takesShop: true },
  { ...editor("catering-lto", "/admin/catering/lto", "admin.catering.hub.lto", 6, "lto"), tabFamily: "lto", takesShop: true },
  { ...editor("catering-fulfillment", "/admin/catering/fulfillment", "admin.catering.hub.fulfillment", 7, "fulfillment"), aliases: { en: ["Fulfillment Zones"], es: ["Zonas de Entrega"] } },
  {
    id: "catering-ezcater-review", route: "/admin/catering/ezcater-review", nameKey: "admin.ezcaterReview.title", room: "catering",
    parent: "catering", takesShop: false, access: { minLevel: 8, alsoRoles: ["catering_mgr"] }, surface: "catering", numbers: true, kind: "place",
  },
  {
    id: "catering-toast", route: "/admin/catering/toast", nameKey: "admin.catering.hub.toast", room: "catering", parent: "catering",
    takesShop: false, access: { minLevel: 8, onlyRoles: MOO_PLUS }, surface: "catering", numbers: false, kind: "place",
  },

  // ─── Reports ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "reports", route: "/reports", nameKey: "nav.reports_hub", room: "reports", parent: "dashboard", takesShop: true, access: { minLevel: 2 },
    surface: "report_read", numbers: true, kind: "place", legacy: { chipScoped: true }, aliases: { en: ["Reports Hub"], es: ["Centro de reportes"] },
  },
  {
    id: "shift-reports", route: "/reports/operations", nameKey: "reports.hub.operations", room: "reports", parent: "reports",
    children: ["/reports/[type]/[id]"], takesShop: true, access: { minLevel: 2 }, surface: "report_read", numbers: true, kind: "place",
    aliases: { en: ["Operations"], es: ["Operaciones"] },
  },
  {
    id: "written-reports", route: "/reports/written", nameKey: "nav.written_reports", room: "reports", parent: "reports", takesShop: true,
    access: { minLevel: 2 }, surface: "report_read", numbers: true, kind: "place", labels: { hub: "reports.hub.written" },
    legacy: { chipScoped: true },
  },
  {
    id: "trends", route: "/reports/trends", nameKey: "nav.trends", room: "reports", parent: "reports", takesShop: true, access: { minLevel: 4 },
    surface: "report_read", numbers: true, kind: "place", legacy: { chipScoped: true },
  },
  {
    id: "trends-ops", route: "/reports/trends/ops", nameKey: "reports.hub.trends", room: "reports", parent: "trends", takesShop: true,
    access: { minLevel: 4 }, surface: "report_read", numbers: true, kind: "place",
  },
  {
    id: "trends-team", route: "/reports/trends/team", nameKey: "reports.hub.team", room: "reports", parent: "trends",
    children: ["/reports/trends/team/[personId]"], takesShop: true,
    // The page's own rule (canOpenPeopleViews from level 6); the hub's per-shop canViewPeople stays a hub detail.
    access: { minLevel: 6, onlyRoles: ["agm", "catering_mgr", "prep_mgr", "gm", "moo", "owner", "cgs"] }, surface: "report_read",
    numbers: true, kind: "place",
  },
  {
    id: "sales", route: "/reports/sales", nameKey: "reports.hub.sales", room: "reports", tabFamily: "sales", parent: "reports", takesShop: true,
    access: { minLevel: 7 }, surface: "report_read", numbers: true, kind: "place",
  },
  {
    id: "sales-checks", route: "/reports/sales/checks", nameKey: "reports.sales.checks.title", room: "reports", tabFamily: "sales",
    parent: "sales", children: ["/reports/sales/checks/[checkGuid]"], takesShop: true, access: { minLevel: 7 }, surface: "report_read",
    numbers: true, kind: "place",
  },
  {
    id: "sales-catering", route: "/reports/sales/catering", nameKey: "reports.sales.catering.title", room: "reports", tabFamily: "sales",
    parent: "sales", takesShop: true, access: { minLevel: 7 }, surface: "report_read", numbers: true, kind: "place",
  },
  {
    id: "business", route: "/reports/business", nameKey: "reports.business.title", room: "reports", parent: "reports", takesShop: true,
    access: { minLevel: 7, onlyRoles: GM_PLUS, requires: "businessReport", needsFact: { fact: "businessReportOffered", roles: ["gm"] } },
    surface: "report_read", numbers: true, kind: "place",
  },

  // ─── Back office ──────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "admin", route: "/admin", nameKey: "nav.admin", descriptionKey: "admin.hub.subtitle", room: "back-office", parent: "dashboard",
    takesShop: false, access: { minLevel: 6 }, numbers: true, kind: "place", aliases: { en: ["Admin"], es: ["Admin", "Administración"] },
  },
  // People and schedule
  {
    id: "schedule", route: "/schedule", nameKey: "schedule.page.title", room: "back-office", group: "people-and-schedule", tabFamily: "schedule",
    parent: "admin", takesShop: true, access: { minLevel: 7, alsoRoles: ["agm"] }, surface: "schedule", numbers: true, kind: "place",
  },
  {
    id: "schedule-settings", route: "/schedule/settings", nameKey: "schedule.settings.page_title", room: "back-office",
    group: "people-and-schedule", tabFamily: "schedule", parent: "schedule", takesShop: true, access: { minLevel: 7, alsoRoles: ["agm"] },
    surface: "schedule", numbers: true, kind: "place",
  },
  {
    id: "users", route: "/admin/users", nameKey: "admin.section.users", descriptionKey: "admin.users.subtitle", room: "back-office",
    group: "people-and-schedule", parent: "admin", takesShop: false, access: { minLevel: 7 }, numbers: false, kind: "place",
    aliases: { en: ["User Management"], es: ["Gestión de Usuarios"] },
  },
  {
    id: "stations", route: "/admin/stations", nameKey: "admin.section.stations", room: "back-office", group: "people-and-schedule",
    parent: "admin", takesShop: true, access: { minLevel: 7 }, surface: "ops", numbers: false, kind: "place",
    aliases: { en: ["Stations"], es: ["Estaciones"] },
  },
  {
    id: "toast-employees", route: "/admin/toast-employees", nameKey: "toastLinks.title", room: "back-office", group: "people-and-schedule",
    tabFamily: "staff-links", parent: "admin", takesShop: true, access: { minLevel: 7 }, numbers: false, kind: "place",
  },
  {
    id: "sevenshifts", route: "/admin/sevenshifts", nameKey: "sevenshifts.title", room: "back-office", group: "people-and-schedule",
    tabFamily: "staff-links", parent: "admin", takesShop: true, access: { minLevel: 7, alsoRoles: OPERATIONAL_LEVEL6_ROLES }, numbers: true,
    kind: "place",
  },
  {
    id: "people-reconcile", route: "/admin/people-reconcile", nameKey: "schedule.reconcile.title", room: "back-office",
    group: "people-and-schedule", tabFamily: "staff-links", parent: "admin", takesShop: true,
    access: { minLevel: 7, onlyRoles: PM_CRITERIA_EDITOR_ROLES }, numbers: false, kind: "place",
  },
  {
    id: "pm-criteria", route: "/admin/pm-criteria", nameKey: "pmCriteria.title", room: "back-office", group: "people-and-schedule",
    parent: "admin", takesShop: true, access: { minLevel: 7, onlyRoles: PM_CRITERIA_EDITOR_ROLES }, numbers: false, kind: "place",
  },
  // Menu and recipes
  {
    id: "sandwiches", route: "/admin/sandwiches", nameKey: "admin.sandwiches.title", descriptionKey: "admin.sandwiches.subtitle",
    room: "back-office", group: "menu-and-recipes", tabFamily: "menu", parent: "admin", children: ["/admin/catalog/menu-item/[id]"],
    takesShop: true, access: { minLevel: 6, onlyRoles: SANDWICHES_VIEW_ROLES }, surface: "ops", numbers: true, kind: "place",
    labels: { hub: "reports.hub.costing" },
  },
  {
    id: "recipes", route: "/admin/recipes", nameKey: "admin.section.recipes", room: "back-office", group: "menu-and-recipes", tabFamily: "menu",
    parent: "admin", children: ["/admin/recipes/[id]", "/admin/recipes/new", "/admin/catalog/recipe/[id]"], takesShop: true,
    access: { minLevel: 6 }, surface: "ops", numbers: true, kind: "place", labels: { chip: "nav.recipes" }, legacy: { chipScoped: false },
  },
  {
    id: "items", route: "/admin/items", nameKey: "admin.section.items", descriptionKey: "admin.items.subtitle", room: "back-office",
    group: "menu-and-recipes", tabFamily: "menu", parent: "admin", takesShop: true, access: { minLevel: 6 }, surface: "ops", numbers: true,
    kind: "place", aliases: { en: ["Items", "Items Catalog", "Item Registry"], es: ["Artículos", "Catálogo de artículos"] },
  },
  {
    id: "recipe-notices", route: "/admin/catalog/notices", nameKey: "admin.section.recipe-notices", descriptionKey: "catalog.notices.intro",
    room: "back-office", group: "menu-and-recipes", tabFamily: "recipe-changes", parent: "admin", takesShop: true, access: { minLevel: 7 },
    surface: "ops", numbers: false, kind: "place",
  },
  {
    id: "shop-changes", route: "/admin/catalog/shop-changes", nameKey: "admin.section.shop-changes", room: "back-office",
    group: "menu-and-recipes", tabFamily: "recipe-changes", parent: "admin", takesShop: false, access: { minLevel: 8 }, surface: "ops",
    numbers: false, kind: "place",
  },
  {
    id: "new-sandwich", route: "/admin/catalog/new/sandwich", nameKey: "catalog.jobs.sandwich.title", room: "back-office",
    group: "menu-and-recipes", parent: "admin", takesShop: true, access: { minLevel: 7, onlyRoles: GM_PLUS }, surface: "ops", numbers: true,
    kind: "job",
  },
  // Ordering and stock
  {
    id: "vendors", route: "/admin/vendors", nameKey: "admin.section.vendors", descriptionKey: "admin.vendors.subtitle", room: "back-office",
    group: "ordering-and-stock", tabFamily: "supplies", parent: "admin", children: ["/admin/vendors/[id]"], takesShop: false,
    access: { minLevel: 6 }, surface: "ops", numbers: true, kind: "place",
  },
  {
    id: "skus", route: "/admin/skus", nameKey: "admin.section.skus", descriptionKey: "admin.skus.subtitle", room: "back-office",
    group: "ordering-and-stock", tabFamily: "supplies", parent: "admin", children: ["/admin/catalog/sku/[id]", "/admin/catalog/sku/[id]/swap"],
    takesShop: true, access: { minLevel: 6 }, surface: "ops", numbers: true, kind: "place",
  },
  {
    id: "products", route: "/admin/products", nameKey: "admin.section.products", descriptionKey: "admin.products.subtitle", room: "back-office",
    group: "ordering-and-stock", tabFamily: "supplies", parent: "admin", takesShop: false, access: { minLevel: 6 }, surface: "ops",
    numbers: true, kind: "place",
  },
  {
    id: "pars", route: "/admin/pars", nameKey: "admin.section.pars", descriptionKey: "admin.pars.subtitle", room: "back-office",
    group: "ordering-and-stock", tabFamily: "supplies", parent: "admin", takesShop: true, access: { minLevel: 6, onlyRoles: PARS_VIEW_ROLES },
    surface: "ops", numbers: true, kind: "place", aliases: { en: ["Pars"], es: [] },
  },
  {
    id: "weights", route: "/admin/weights", nameKey: "admin.section.weights", room: "back-office", group: "ordering-and-stock",
    tabFamily: "supplies", parent: "admin", takesShop: false, access: { minLevel: 6 }, surface: "ops", numbers: true, kind: "place",
    aliases: { en: ["Weights & Trim"], es: [] },
  },
  {
    id: "categories", route: "/admin/categories", nameKey: "admin.section.categories", descriptionKey: "admin.categories.subtitle",
    room: "back-office", group: "ordering-and-stock", tabFamily: "supplies", parent: "admin", takesShop: false, access: { minLevel: 8 },
    numbers: false, kind: "place",
  },
  {
    id: "locations", route: "/admin/locations", nameKey: "admin.section.locations", room: "back-office", group: "ordering-and-stock",
    parent: "admin", takesShop: false, access: { minLevel: 8, onlyRoles: MOO_PLUS }, numbers: false, kind: "place",
    aliases: { en: ["Locations"], es: ["Ubicaciones"] },
  },
  {
    id: "demand-signals", route: "/admin/demand-signals", nameKey: "signals.title", descriptionKey: "signals.intro", room: "back-office",
    group: "ordering-and-stock", tabFamily: "demand-signals", parent: "admin", takesShop: true,
    access: { minLevel: 7, onlyRoles: GM_PLUS, requires: "demandSignals" }, numbers: true, kind: "place",
  },
  {
    id: "demand-signals-sources", route: "/admin/demand-signals/sources", nameKey: "signals.sources.title", room: "back-office",
    group: "ordering-and-stock", tabFamily: "demand-signals", parent: "admin", takesShop: false,
    access: { minLevel: 8, onlyRoles: MOO_PLUS, requires: "demandSignals" }, numbers: false, kind: "place",
  },
  {
    id: "new-item", route: "/admin/catalog/new/item", nameKey: "catalog.jobs.new_item.title", room: "back-office", group: "ordering-and-stock",
    parent: "admin", takesShop: true, access: { minLevel: 7, onlyRoles: GM_PLUS }, surface: "ops", numbers: true, kind: "job",
  },
  // Checklists and reports
  {
    id: "checklist-templates", route: "/admin/checklist-templates", nameKey: "admin.section.checklist-templates",
    descriptionKey: "admin.templates.subtitle", room: "back-office", group: "checklists-and-reports", parent: "admin",
    children: ["/admin/checklist-templates/[subtype]", "/admin/checklist-templates/opening", "/admin/checklist-templates/closing"],
    takesShop: false, access: { minLevel: 7 }, numbers: false, kind: "place",
    aliases: { en: ["Checklist Templates", "Lists & Reports"], es: ["Plantillas de Listas", "Listas y Reportes"] },
  },
  {
    id: "report-recipients", route: "/admin/report-recipients", nameKey: "admin.section.report-recipients", room: "back-office",
    group: "checklists-and-reports", parent: "admin", takesShop: false, access: { minLevel: 7 }, numbers: false, kind: "place",
  },
  // Customers and marketing
  {
    id: "customers", route: "/admin/customers", nameKey: "customers.title", room: "back-office", group: "customers-and-marketing",
    tabFamily: "customers", parent: "admin", children: ["/admin/customers/[id]"], takesShop: false, access: { minLevel: 7 }, numbers: true,
    kind: "place",
  },
  {
    id: "customers-catering", route: "/admin/customers/catering", nameKey: "customers.catering.title", room: "back-office",
    group: "customers-and-marketing", tabFamily: "customers", parent: "admin", takesShop: false,
    access: { minLevel: 7, requires: "customerProfiles" }, numbers: true, kind: "place",
  },
  {
    // Its back link points at the hub today (spec section 9, mirrored as it is; PR 4 fixes the registry and this row).
    id: "customers-consent", route: "/admin/customers/consent", nameKey: "customers.consent.title", room: "back-office",
    group: "customers-and-marketing", tabFamily: "customers", parent: "admin", takesShop: false,
    access: { minLevel: 9, requires: "customerProfiles" }, numbers: false, kind: "place",
  },
  {
    id: "marketing", route: "/admin/marketing", nameKey: "marketing.title", room: "back-office", group: "customers-and-marketing",
    tabFamily: "marketing", parent: "admin", children: ["/admin/marketing/ad-codes"], takesShop: false,
    access: { minLevel: 8, onlyRoles: MOO_PLUS, requires: "marketingScorecard" }, numbers: true, kind: "place",
  },
  // System
  {
    id: "audit", route: "/admin/audit", nameKey: "admin.section.audit", room: "back-office", group: "system", parent: "admin",
    takesShop: false, access: { minLevel: 9 }, numbers: false, kind: "place", planned: true,
  },

  // ─── Me ───────────────────────────────────────────────────────────────────────────────────────────────────────
  // "Me" is /settings; its key still reads "Settings" until merge M4 (nav PR 10) retitles it.
  { id: "me", route: "/settings", nameKey: "nav.settings", room: "me", parent: "dashboard", takesShop: false, access: { minLevel: 0 }, numbers: false, kind: "place", legacy: { chipScoped: false } },
  {
    id: "my-feedback", route: "/my-feedback", nameKey: "nav.my_feedback", room: "me", parent: "reports", takesShop: true, access: { minLevel: 0 },
    numbers: false, kind: "place", legacy: { chipScoped: false }, aliases: { en: ["My feedback"], es: [] },
  },
  {
    id: "training", route: "/training", nameKey: "nav.training", room: "me", parent: "dashboard", children: ["/training/build/[item]"],
    takesShop: false, access: { minLevel: 0 }, numbers: false, kind: "place", legacy: { chipScoped: false },
  },
  { id: "vault", route: "/vault", nameKey: "nav.vault", room: "me", parent: "dashboard", takesShop: false, access: { minLevel: 0, requires: "vault" }, numbers: false, kind: "place" },
];

/** A catering setup editor (the catering hub's EDITORS row): in the Catering room, under Catering setup. */
function editor(id: string, route: string, nameKey: Destination["nameKey"], minLevel: number, editorId: string): Destination {
  return {
    id, route, nameKey, room: "catering", parent: "catering", takesShop: false, access: { minLevel }, surface: "catering", numbers: true,
    kind: "place", legacy: { editorId },
  };
}

/** Spec 6.3: each tab family's destinations, in tab order. */
export const TAB_FAMILIES: Readonly<Record<TabFamilyId, readonly string[]>> = {
  sales: ["sales", "sales-checks", "sales-catering"],
  "staff-links": ["toast-employees", "sevenshifts", "people-reconcile"],
  menu: ["sandwiches", "recipes", "items"],
  supplies: ["vendors", "skus", "products", "pars", "weights", "categories"],
  "recipe-changes": ["recipe-notices", "shop-changes"],
  customers: ["customers", "customers-catering", "customers-consent"],
  schedule: ["schedule", "schedule-settings"],
  "catering-prices": ["catering-rate-rules", "catering-pricing"],
  lto: ["catering-lto", "lto"],
  "catering-customers": ["catering-customers", "catering-companies"],
  marketing: ["marketing"],
  "demand-signals": ["demand-signals", "demand-signals-sources"],
  "stock-loop": ["ordering", "receiving", "counts", "vendor-mail"],
};

const BY_ID = new Map(DESTINATIONS.map((d) => [d.id, d]));
const BY_ROUTE = new Map(DESTINATIONS.map((d) => [d.route, d]));

/** The destination with this id. Throws on an unknown id: a typo is a bug, never an empty menu row. */
export function byId(id: string): Destination {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`unknown destination id: ${id}`);
  return d;
}

/** The destination at exactly this route (no query, no trailing slash), or undefined. */
export function byRoute(route: string): Destination | undefined {
  return BY_ROUTE.get(route);
}
