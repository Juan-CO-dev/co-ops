/**
 * Nav PR 3, guard (d): the page-gate reader (plan r5, 4.4). Test-only.
 *
 * For each destination it answers one question: does a GET of the destination's ENTRY REQUEST (the route, with
 * `?location=S` when the destination takes a shop, S a shop the viewer is an active member of, and no other
 * parameter) render the page or refuse? The system is assumed healthy.
 *
 * The reader is CLOSED and fails closed. It reads the census files (the 84 destination pages, the admin layout and
 * PulseHome) with the TypeScript API and enumerates every construct that can end the page:
 *   - every redirect(...) / notFound() call, every `throw`, every standalone call of an imported or same-file
 *     function, and every early `return` of a walked function (each together with its own guarding `if`);
 *   - every enclosing control-flow node around one of those that is not a core `if` (a non-core `if`, a `catch`
 *     clause, a `.catch(...)` callback, a loop, a ternary, a logical expression, a switch).
 * Each construct is either CORE (exactly `if (C) redirect(...)` / `if (C) notFound()` in a walked function under
 * core `if`s only, C a core condition over the closed atom tables below) or a REVIEWED ENTRY in
 * tests/fixtures/nav-reviewed-entries.json, bound to the source by (file, fn, anchor, kind, exact normalized text).
 * There is no third way: anything else throws a PageGateError with a code. Meanings are human-written; the census
 * mode never writes or changes one.
 *
 * The atoms are matched by MODULE SPECIFIER AND EXPORT NAME through the file's imports, never by local name.
 */
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
// ── The closed atom tables' real exports ──────────────────────────────────────────────────────────────────────────
import { CAPACITY_MIN } from "@/lib/admin/catering/capacity";
import { FULFILLMENT_MIN } from "@/lib/admin/catering/fulfillment";
import { MENU_ADMIN_MIN } from "@/lib/admin/catering/menu";
import { PACKAGE_READ_MIN } from "@/lib/admin/catering/packages";
import { PRICING_MIN } from "@/lib/admin/catering/pricing";
import { RATE_MIN } from "@/lib/admin/catering/rate-rules";
import { canManageInboundAliases } from "@/lib/admin/inbound-settings-shared";
import { ITEMS_READ_MIN } from "@/lib/admin/items";
import { canViewPars } from "@/lib/admin/pars-shared";
import { canViewSandwiches } from "@/lib/admin/sandwiches-shared";
import { canOpenUserAdmin } from "@/lib/admin/user-access-shared";
import { ADMIN_MIN_LEVEL } from "@/lib/admin/users";
import { TASK_MIN_LEVEL, type TaskType } from "@/lib/assignments-shared";
import { businessAllShopsAllowed, businessShopAllowed } from "@/lib/business-access-shared";
import { businessReportRefusal } from "@/lib/business-report-shared";
import { canManageCateringToastSettings } from "@/lib/catering/catering-toast-settings-shared";
import { COMPANY_READ_MIN } from "@/lib/catering/companies";
import { CUSTOMER_READ_MIN } from "@/lib/catering/customers";
import { INSIGHTS_READ_MIN } from "@/lib/catering/insights";
import { LTO_MIN } from "@/lib/catering/lto";
import { PIPELINE_READ_MIN } from "@/lib/catering/pipeline";
import { PREP_DEMAND_READ_MIN } from "@/lib/catering/prep-demand";
import { QUOTE_READ_MIN } from "@/lib/catering/quotes";
import { canTransferCatering } from "@/lib/catering/transfers-shared";
import { COUNT_READ_MIN, COUNT_WRITE_MIN } from "@/lib/counts";
import { CUSTOMER_CONTACT_MIN, CUSTOMER_STATS_MIN } from "@/lib/customers/customers";
import { canMarkSource, canViewDemandSignals } from "@/lib/demand-signals/access-shared";
import { REPORT_ALL_LOCATIONS_LEVEL, canReadReportLocation, canWorkShopTasks, lockLocationContext } from "@/lib/locations";
import { MAINTENANCE_BASE_LEVEL } from "@/lib/maintenance";
import { canReadMarketing } from "@/lib/marketing/access-shared";
import { MIDSHIFT_BASE_LEVEL } from "@/lib/midshift-shared";
import { PAR_PASS_MIN } from "@/lib/ordering";
import { canEditPmCriteria, canOpenPeopleViews, canSubmitPmDay, canViewSevenShiftsStatus, peopleActorFromAuth } from "@/lib/people/access-shared";
import { PM_REPORT_BASE_LEVEL } from "@/lib/pm-report";
import { PRODUCE_MIN } from "@/lib/production";
import { PRODUCT_READ_MIN } from "@/lib/products";
import { pulsePageAccess } from "@/lib/pulse/scope-shared";
import { RECIPE_SHOP_WRITE_MIN } from "@/lib/recipe-versions-shared";
import { RECIPE_READ_MIN } from "@/lib/recipes-shared";
import { RECIPIENTS_VIEW_MIN } from "@/lib/report-recipients-shared";
import { canReadScopedReport } from "@/lib/report-scope";
import { reportsRoleAllowed } from "@/lib/reports-access-shared";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";
import { SALES_READ_MIN } from "@/lib/sales-reports-shared";
import { canViewReconciliation, canViewSchedule } from "@/lib/scheduling/access-shared";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { GLOBAL_VERSION_WRITE_MIN, catalogShopAllowed } from "@/lib/sku-versions-shared";
import { TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { LINK_ADMIN_MIN_LEVEL } from "@/lib/toast/employee-links";
import { vendorMailRoleAllowed } from "@/lib/vendor-mail-shared";
import { WEIGHT_READ_MIN } from "@/lib/weights";
import { MARKETING_SCORECARD_ROLES } from "@/lib/marketing/access-shared";
import type { Facts, SwitchName, Switches } from "@/lib/nav/types";

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Errors
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type PageGateCode =
  | "UNREVIEWED_CONSTRUCT" | "ENTRY_TEXT_MISMATCH" | "STALE_ENTRY" | "AMBIGUOUS_ENTRY" | "UNCLASSIFIED_ENTRY"
  | "OPERATIONAL_MENTIONS_SESSION" | "UNKNOWN_CONDITION" | "BAD_REDIRECT_TARGET" | "REDIRECT_LOOP" | "UNSUPPORTED"
  | "NOT_A_CENSUS_PAGE";

export interface Problem { code: PageGateCode; file: string; line?: number; detail: string }

export class PageGateError extends Error {
  constructor(readonly code: PageGateCode, message: string, readonly problems: readonly Problem[] = []) {
    super(`${code}: ${message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The reviewed-entry list (4.4.4)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type ConstructKind =
  | "redirect" | "notFound" | "throw" | "standalone" | "early-return"
  | "enclosing-if" | "enclosing-catch" | "enclosing-.catch" | "enclosing-loop" | "enclosing-ternary"
  | "enclosing-logical" | "enclosing-switch";

type Meaning =
  /** At this construct the page refuses exactly when `when` holds (a core condition; `fact.*` allowed). */
  | { kind: "refuse"; when: string; why: string }
  /** Never refuses. Ends the page (it renders), or a branch walked on both arms, must-admit. `enters` names the one
   *  bound component a page returns as its whole view (Shop pulse → PulseHome), which is then walked. */
  | { kind: "admit"; why: string; enters?: { file: string; fn: string } }
  /** Sends an AUTHORIZED viewer elsewhere; the page's answer is the target's (route and query, <S> / <id>). */
  | { kind: "success-redirect"; target: string; why: string }
  /** Fires only on a broken dependency or a missing / invalid row for a valid entry URL; treated as not firing. */
  | { kind: "operational-error"; why: string };

interface Pin { file: string; text: string }

export interface ReviewedEntry {
  file: string;
  fn: string;
  anchor: string;
  kind: ConstructKind;
  /** For humans only: the line at the census. Not part of the key. */
  line?: number;
  text: string;
  pins?: Pin[];
  meaning: Meaning | null;
}

const ENTRIES_FILE = "tests/fixtures/nav-reviewed-entries.json";

export function loadReviewedEntries(): ReviewedEntry[] {
  return JSON.parse(readFileSync(ENTRIES_FILE, "utf8")) as ReviewedEntry[];
}

export const entryKey = (e: Pick<ReviewedEntry, "file" | "fn" | "anchor" | "kind" | "text">) =>
  `${e.file} | ${e.fn} | ${e.anchor} | ${e.kind} | ${e.text}`;

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The closed atom tables (4.4.3)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type Fn = (...args: never[]) => unknown;
interface TableEntry<T> { modules: readonly string[]; value: T }

/** L: level floors. Each imports the real export; file-local numeric `const`s are read from their declaration. */
export const CONSTANTS: Readonly<Record<string, TableEntry<number>>> = {
  PRODUCE_MIN: { modules: ["@/lib/production"], value: PRODUCE_MIN },
  SALES_READ_MIN: { modules: ["@/lib/sales-reports-shared", "@/lib/sales-reports"], value: SALES_READ_MIN },
  COUNT_WRITE_MIN: { modules: ["@/lib/counts"], value: COUNT_WRITE_MIN },
  COUNT_READ_MIN: { modules: ["@/lib/counts"], value: COUNT_READ_MIN },
  RECIPE_READ_MIN: { modules: ["@/lib/recipes", "@/lib/recipes-shared"], value: RECIPE_READ_MIN },
  ITEMS_READ_MIN: { modules: ["@/lib/admin/items"], value: ITEMS_READ_MIN },
  PRODUCT_READ_MIN: { modules: ["@/lib/products"], value: PRODUCT_READ_MIN },
  WEIGHT_READ_MIN: { modules: ["@/lib/weights"], value: WEIGHT_READ_MIN },
  PACKAGE_READ_MIN: { modules: ["@/lib/admin/catering/packages"], value: PACKAGE_READ_MIN },
  MENU_ADMIN_MIN: { modules: ["@/lib/admin/catering/menu"], value: MENU_ADMIN_MIN },
  PRICING_MIN: { modules: ["@/lib/admin/catering/pricing"], value: PRICING_MIN },
  RATE_MIN: { modules: ["@/lib/admin/catering/rate-rules"], value: RATE_MIN },
  CAPACITY_MIN: { modules: ["@/lib/admin/catering/capacity"], value: CAPACITY_MIN },
  PREP_DEMAND_READ_MIN: { modules: ["@/lib/catering/prep-demand"], value: PREP_DEMAND_READ_MIN },
  LTO_MIN: { modules: ["@/lib/catering/lto"], value: LTO_MIN },
  FULFILLMENT_MIN: { modules: ["@/lib/admin/catering/fulfillment"], value: FULFILLMENT_MIN },
  CUSTOMER_STATS_MIN: { modules: ["@/lib/customers/customers", "@/lib/customers/access-shared"], value: CUSTOMER_STATS_MIN },
  CUSTOMER_CONTACT_MIN: { modules: ["@/lib/customers/customers", "@/lib/customers/access-shared"], value: CUSTOMER_CONTACT_MIN },
  RECIPIENTS_VIEW_MIN: { modules: ["@/lib/report-recipients-shared"], value: RECIPIENTS_VIEW_MIN },
  LINK_ADMIN_MIN_LEVEL: { modules: ["@/lib/toast/employee-links"], value: LINK_ADMIN_MIN_LEVEL },
  GLOBAL_VERSION_WRITE_MIN: { modules: ["@/lib/sku-versions-shared"], value: GLOBAL_VERSION_WRITE_MIN },
  RECIPE_SHOP_WRITE_MIN: { modules: ["@/lib/recipe-versions-shared"], value: RECIPE_SHOP_WRITE_MIN },
  COMPANY_READ_MIN: { modules: ["@/lib/catering/companies"], value: COMPANY_READ_MIN },
  CUSTOMER_READ_MIN: { modules: ["@/lib/catering/customers"], value: CUSTOMER_READ_MIN },
  INSIGHTS_READ_MIN: { modules: ["@/lib/catering/insights"], value: INSIGHTS_READ_MIN },
  PIPELINE_READ_MIN: { modules: ["@/lib/catering/pipeline"], value: PIPELINE_READ_MIN },
  QUOTE_READ_MIN: { modules: ["@/lib/catering/quotes"], value: QUOTE_READ_MIN },
  TEAM_VIEW_LEVEL: { modules: ["@/lib/team-metrics"], value: TEAM_VIEW_LEVEL },
  PAR_PASS_MIN: { modules: ["@/lib/ordering"], value: PAR_PASS_MIN },
  PM_REPORT_BASE_LEVEL: { modules: ["@/lib/pm-report"], value: PM_REPORT_BASE_LEVEL },
  MAINTENANCE_BASE_LEVEL: { modules: ["@/lib/maintenance"], value: MAINTENANCE_BASE_LEVEL },
  MIDSHIFT_BASE_LEVEL: { modules: ["@/lib/midshift", "@/lib/midshift-shared"], value: MIDSHIFT_BASE_LEVEL },
  REPORT_ALL_LOCATIONS_LEVEL: { modules: ["@/lib/locations"], value: REPORT_ALL_LOCATIONS_LEVEL },
  ADMIN_MIN_LEVEL: { modules: ["@/lib/admin/users"], value: ADMIN_MIN_LEVEL },
};

/** R: role predicates, evaluated by calling the real function per role. */
export const ROLE_PREDICATES: Readonly<Record<string, TableEntry<Fn>>> = {
  reportsRoleAllowed: { modules: ["@/lib/reports-access-shared"], value: reportsRoleAllowed },
  vendorMailRoleAllowed: { modules: ["@/lib/vendor-mail-shared"], value: vendorMailRoleAllowed },
  canViewPars: { modules: ["@/lib/admin/pars-shared"], value: canViewPars },
  canViewSandwiches: { modules: ["@/lib/admin/sandwiches-shared"], value: canViewSandwiches },
  canOpenUserAdmin: { modules: ["@/lib/admin/user-access-shared"], value: canOpenUserAdmin },
  canManageInboundAliases: { modules: ["@/lib/admin/inbound-settings-shared"], value: canManageInboundAliases },
  canTransferCatering: { modules: ["@/lib/catering/transfers-shared"], value: canTransferCatering },
  canManageCateringToastSettings: { modules: ["@/lib/catering/catering-toast-settings-shared"], value: canManageCateringToastSettings },
  canReadMarketing: { modules: ["@/lib/marketing/access-shared"], value: canReadMarketing },
  canViewDemandSignals: { modules: ["@/lib/demand-signals/access-shared"], value: canViewDemandSignals },
  canMarkSource: { modules: ["@/lib/demand-signals/access-shared"], value: canMarkSource },
  businessReportRefusal: { modules: ["@/lib/business-report-shared"], value: businessReportRefusal },
  businessAllShopsAllowed: { modules: ["@/lib/business-access-shared"], value: businessAllShopsAllowed },
  canOpenPeopleViews: { modules: ["@/lib/people/access-shared"], value: canOpenPeopleViews },
  canSubmitPmDay: { modules: ["@/lib/people/access-shared"], value: canSubmitPmDay },
  pulsePageAccess: { modules: ["@/lib/pulse/scope-shared"], value: pulsePageAccess },
};

/** S: server switches, read from the combination under test (never from the environment). */
export const SWITCH_CALLS: Readonly<Record<string, TableEntry<SwitchName>>> = {
  vaultEnabled: { modules: ["@/lib/vault-flag"], value: "vault" },
  pulseV2Enabled: { modules: ["@/lib/pulse/flag"], value: "pulseV2" },
  businessReportEnabled: { modules: ["@/lib/business-report-shared"], value: "businessReport" },
  demandSignalsEnabled: { modules: ["@/lib/demand-signals/config-shared"], value: "demandSignals" },
  customerProfilesEnabled: { modules: ["@/lib/customers/customers"], value: "customerProfiles" },
};
/** The argument each switch call must be given (the environment read the real call makes). */
const SWITCH_ARGS: Readonly<Record<string, string>> = {
  vaultEnabled: "", pulseV2Enabled: "", customerProfilesEnabled: "",
  businessReportEnabled: "process.env", demandSignalsEnabled: "process.env.DEMAND_SIGNALS",
};

/** M: shop-scoped predicates, called for real with an actor who is an active member of S. Never assumed true. */
export const MEMBERSHIP: Readonly<Record<string, TableEntry<Fn>>> = {
  lockLocationContext: { modules: ["@/lib/locations"], value: lockLocationContext },
  canWorkShopTasks: { modules: ["@/lib/locations"], value: canWorkShopTasks },
  canReadReportLocation: { modules: ["@/lib/locations"], value: canReadReportLocation },
  canReadScopedReport: { modules: ["@/lib/report-scope"], value: canReadScopedReport },
  catalogShopAllowed: { modules: ["@/lib/sku-versions-shared"], value: catalogShopAllowed },
  businessShopAllowed: { modules: ["@/lib/business-access-shared"], value: businessShopAllowed },
  canViewSchedule: { modules: ["@/lib/scheduling/access-shared"], value: canViewSchedule },
  canViewSevenShiftsStatus: { modules: ["@/lib/people/access-shared"], value: canViewSevenShiftsStatus },
  canEditPmCriteria: { modules: ["@/lib/people/access-shared"], value: canEditPmCriteria },
  canViewReconciliation: { modules: ["@/lib/scheduling/access-shared"], value: canViewReconciliation },
};

/** T: task access (the byTask rule of plan 2.3 over Facts.assignedTasks; pinned to the real hasTaskAccess by 4.11). */
const TASK_CALLS: Readonly<Record<string, readonly string[]>> = {
  hasTaskAccess: ["@/lib/assignments"],
  canDoOperationalTask: ["@/lib/operational-task-access"],
};
const TASKS = new Set<string>(Object.keys(TASK_MIN_LEVEL));

/** The value helpers: how the session, the entry parameters and the entry shop are produced. */
const VALUE_HELPERS: Readonly<Record<string, readonly string[]>> = {
  requireSessionFromHeaders: ["@/lib/session"],
  peopleActorFromAuth: ["@/lib/people/access-shared"],
  getRoleLevel: ["@/lib/roles"],
  ROLES: ["@/lib/roles"],
  searchParamValues: ["@/lib/shop-context-shared"],
  shopParamFor: ["@/lib/shop-context-shared"],
  resolveShop: ["@/lib/shop-context"],
  resolveShopId: ["@/lib/shop-context"],
  resolveReportShopId: ["@/lib/shop-context"],
  loadAccessibleLocations: ["@/lib/pulse/page"],
  MARKETING_SCORECARD_ROLES: ["@/lib/marketing/access-shared"],
};

/** Components a page returns as its whole view under a gate (the closed list of bound component entries). */
const COMPONENTS: Readonly<Record<string, { file: string; fn: string; modules: readonly string[] }>> = {
  PulseHome: { file: "components/pulse/PulseHome.tsx", fn: "PulseHome", modules: ["@/components/pulse/PulseHome"] },
};

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Request and viewer
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The entry shop: a shop the viewer is an active member of. */
export const S = "shop-S";
/** The placeholder an instance id takes in a success-redirect target. */
const INSTANCE_ID = "instance-1";

export interface ViewerPoint { role: RoleCode; switches: Switches; facts?: Facts }

export type Arm = "then" | "else" | "caught" | "not-thrown" | "body" | "skip";
/** Fixture-only: fix the arm of an entry whose arm depends on data (matched by file and a prefix of its text). */
export interface ForceArm { file: string; textStartsWith: string; arm: Arm }

interface Ctx {
  role: RoleCode;
  level: number;
  switches: Switches;
  facts: Facts;
  params: Record<string, string | undefined>;
  auth: FakeAuth;
  readSwitches: Map<SwitchName, boolean>;
  forceArm: readonly ForceArm[];
  trace: string[];
  stack: string[];
}

interface FakeAuth {
  user: { id: string; role: RoleCode; language: "en"; active: true; name: string; email: string | null };
  session: { id: string };
  role: RoleCode;
  level: number;
  locations: string[];
}

function fakeAuth(role: RoleCode): FakeAuth {
  const level = ROLES[role].level;
  return { user: { id: "viewer", role, language: "en", active: true, name: "Viewer", email: null }, session: { id: "session" }, role, level, locations: [S] };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Values and conditions (statically classified, evaluated per viewer)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type Cls =
  | "session" | "level" | "role" | "actor" | "object" | "props" | "searchParamsPromise" | "params" | "paramValues" | "param"
  | "shop" | "shopRow" | "shopList" | "shopListLength" | "literal" | "const" | "switch" | "rolepred" | "membership"
  | "task" | "fact" | "facts" | "roleDef" | "rolesTable" | "processEnv" | "envVar" | "roleList" | "record";

interface Val { cls: Cls; get: (ctx: Ctx) => unknown; props?: ReadonlyMap<string, Val> }
interface Cond { get: (ctx: Ctx) => boolean }

/** Classes whose value depends on the viewer (session, switch, fact): an operational-error guard may not read one. */
const VIEWER_CLASSES = new Set<Cls>(["session", "level", "role", "actor", "switch", "rolepred", "membership", "task", "fact", "facts", "roleDef"]);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const OPAQUE = null;

type FnLike = ts.FunctionLikeDeclaration;

/** What an identifier is bound to in a function frame. */
type Binding =
  | { kind: "expr"; expr: ts.Expression; env: Env }
  | { kind: "val"; val: Val }
  | { kind: "destructured"; from: Binding; prop: string };

interface Env {
  id: number;
  file: FileInfo;
  fn: FnLike | undefined;
  params: Map<string, Binding>;
  parent: Env | undefined;
  /** The `when` environment: names resolve to the atom tables by bare name. */
  when?: true;
}

let envSeq = 0;
/** One environment per (site, parent environment): environments are static, so walks reuse them (and their caches). */
const siteEnvs = new WeakMap<ts.Node, Map<number, Env>>();
function siteEnv(site: ts.Node, parent: Env, make: () => Env): Env {
  let m = siteEnvs.get(site);
  if (!m) siteEnvs.set(site, (m = new Map()));
  let e = m.get(parent.id);
  if (!e) m.set(parent.id, (e = make()));
  return e;
}
function newEnv(file: FileInfo, fn: FnLike | undefined, params: Map<string, Binding>, parent?: Env): Env {
  return { id: ++envSeq, file, fn, params, parent };
}

interface FileInfo {
  file: string;
  sf: ts.SourceFile;
  imports: Map<string, { module: string; name: string }>;
  fns: Map<string, FnLike>;
  topConsts: Map<string, ts.VariableDeclaration>;
  /** Per function: the names it reassigns. */
  locals: Map<FnLike | undefined, Set<string>>;
  /** The switch table this file is read with (a copy in mutation case M2). */
  switchCalls: Readonly<Record<string, TableEntry<SwitchName>>>;
}

function importedAs(file: FileInfo, local: string, table: Readonly<Record<string, { modules: readonly string[] }>> | Readonly<Record<string, readonly string[]>>): string | undefined {
  const imp = file.imports.get(local);
  if (!imp) return undefined;
  const row = (table as Record<string, { modules: readonly string[] } | readonly string[]>)[imp.name];
  if (!row) return undefined;
  const modules = Array.isArray(row) ? row : (row as { modules: readonly string[] }).modules;
  return modules.includes(imp.module) ? imp.name : undefined;
}

/** Names reassigned anywhere inside a function (a reassigned binding is opaque). */
function reassignedIn(file: FileInfo, fn: FnLike | undefined): Set<string> {
  const hit = file.locals.get(fn);
  if (hit) return hit;
  const reassigned = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left)) reassigned.add(n.left.text);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) reassigned.add(n.operand.text);
    ts.forEachChild(n, visit);
  };
  visit(fn?.body ?? file.sf);
  file.locals.set(fn, reassigned);
  return reassigned;
}

type Resolution =
  | { kind: "decl"; decl: ts.VariableDeclaration; element?: ts.BindingElement; env: Env }
  | { kind: "param"; binding: Binding }
  | { kind: "opaque" }
  | { kind: "top" };

/** Lexical resolution of a name at a use site: block-scoped declarations, then parameters, up to the file. */
function resolveName(name: string, at: ts.Node, env: Env): Resolution {
  for (let p: ts.Node | undefined = at.parent; p; p = p.parent) {
    if (ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      for (const st of p.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          if (!bindsName(d.name, name)) continue;
          const declFn = fnOf(d);
          if (!(st.declarationList.flags & ts.NodeFlags.Const) || !d.initializer || reassignedIn(env.file, declFn).has(name)) return { kind: "opaque" };
          let owner: Env | undefined = env;
          while (owner && owner.fn !== declFn) owner = owner.parent;
          const declEnv = owner ?? env;
          if (ts.isIdentifier(d.name)) return { kind: "decl", decl: d, env: declEnv };
          if (ts.isObjectBindingPattern(d.name)) {
            const el = d.name.elements.find((x) => ts.isIdentifier(x.name) && x.name.text === name && !x.dotDotDotToken);
            return el ? { kind: "decl", decl: d, element: el, env: declEnv } : { kind: "opaque" };
          }
          return { kind: "opaque" };
        }
      }
    }
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isForStatement(p)) && p.initializer && ts.isVariableDeclarationList(p.initializer)
      && p.initializer.declarations.some((d) => bindsName(d.name, name))) return { kind: "opaque" };
    if (ts.isCatchClause(p) && p.variableDeclaration && bindsName(p.variableDeclaration.name, name)) return { kind: "opaque" };
    if (ts.isFunctionLike(p) && p.parameters.some((x) => bindsName(x.name, name))) {
      for (let e: Env | undefined = env; e; e = e.parent) {
        if (e.fn === p) { const b = e.params.get(name); return b ? { kind: "param", binding: b } : { kind: "opaque" }; }
      }
      return { kind: "opaque" };
    }
  }
  return { kind: "top" };
}

const valCache = new WeakMap<ts.Node, Map<number, Val | null>>();
const condCache = new WeakMap<ts.Node, Map<number, Cond | null>>();

function strip(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
    else return e;
  }
}

/** Resolve an identifier at a use site (locals, parameters, file-local numeric consts), or OPAQUE. */
function lookup(name: string, at: ts.Node, env: Env, depth: number): Val | null {
  if (depth > 12) return OPAQUE;
  if (name === "undefined") return { cls: "literal", get: () => undefined };
  if (env.when) {
    if (name === "S") return { cls: "shop", get: () => S };
    if (name === "auth") return { cls: "session", get: (c) => c.auth };
    if (name === "actor") return { cls: "actor", get: (c) => peopleActorFromAuth(c.auth) };
    if (name === "fact") return { cls: "facts", get: (c) => c.facts };
  }
  const r = resolveName(name, at, env);
  if (r.kind === "opaque") return OPAQUE;
  if (r.kind === "param") return bindingValue(r.binding, depth + 1);
  if (r.kind === "decl") {
    const { decl, element } = r;
    if (!element) return valueOf(decl.initializer!, r.env, depth + 1);
    const prop = element.propertyName ? element.propertyName.getText(env.file.sf) : (element.name as ts.Identifier).text;
    const from = valueOf(decl.initializer!, r.env, depth + 1);
    if (!from) return OPAQUE;
    const out = propertyOf(from, prop);
    if (!out) return OPAQUE;
    if (element.initializer) {
      const dflt = valueOf(element.initializer, r.env, depth + 1);
      if (!dflt || dflt.cls !== "literal") return OPAQUE;
      return { cls: out.cls, get: (c) => out.get(c) ?? dflt.get(c) };
    }
    return out;
  }
  const top = env.file.topConsts.get(name);
  if (top?.initializer) {
    const init = strip(top.initializer);
    if (ts.isNumericLiteral(init)) return { cls: "const", get: () => Number(init.text) };
  }
  return OPAQUE;
}

/** Is this name a local or a parameter at the use site (so it shadows an import of the same name)? */
const shadowed = (name: string, at: ts.Node, env: Env) => !env.when && resolveName(name, at, env).kind !== "top";

function bindsName(n: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(n)) return n.text === name;
  return n.elements.some((el) => !ts.isOmittedExpression(el) && bindsName(el.name, name));
}

function bindingValue(b: Binding, depth: number): Val | null {
  if (b.kind === "val") return b.val;
  if (b.kind === "expr") return valueOf(b.expr, b.env, depth);
  const from = bindingValue(b.from, depth);
  return from ? propertyOf(from, b.prop) : OPAQUE;
}

/** A property of a classified value. */
function propertyOf(base: Val, prop: string): Val | null {
  const get = (c: Ctx) => (base.get(c) as Record<string, unknown> | undefined)?.[prop];
  switch (base.cls) {
    case "session":
      if (prop === "level") return { cls: "level", get };
      if (prop === "role") return { cls: "role", get };
      if (prop === "locations") return { cls: "object", get };
      if (prop === "user") return { cls: "session", get };
      return { cls: "session", get };
    case "actor":
    case "object":
      if (prop === "level") return { cls: "level", get };
      if (prop === "role") return { cls: "role", get };
      return OPAQUE;
    case "props":
      if (prop === "searchParams") return { cls: "searchParamsPromise", get };
      return OPAQUE;
    case "params":
      return { cls: "param", get };
    case "roleDef":
      return prop === "level" ? { cls: "level", get } : OPAQUE;
    case "shopRow":
      return prop === "id" ? { cls: "shop", get } : OPAQUE;
    case "shopList":
      return prop === "length" ? { cls: "shopListLength", get } : OPAQUE;
    case "facts":
      return prop === "businessReportOffered" ? { cls: "fact", get: (c) => c.facts.businessReportOffered === true } : OPAQUE;
    case "processEnv":
      return { cls: "envVar", get: () => undefined };
    case "record":
      return base.props?.get(prop) ?? OPAQUE;
    default:
      return OPAQUE;
  }
}

function cached<T>(cache: WeakMap<ts.Node, Map<number, T | null>>, node: ts.Node, env: Env, make: () => T | null): T | null {
  let m = cache.get(node);
  if (!m) cache.set(node, (m = new Map()));
  if (m.has(env.id)) return m.get(env.id)!;
  m.set(env.id, OPAQUE); // cycle guard
  const v = make();
  m.set(env.id, v);
  return v;
}

/** Classify a value expression, or OPAQUE. */
function valueOf(expr: ts.Expression, env: Env, depth = 0): Val | null {
  return cached(valCache, expr, env, () => valueOfUncached(strip(expr), env, depth));
}

function calleeName(call: ts.CallExpression, env: Env): { local: string; file: FileInfo } | undefined {
  const callee = strip(call.expression);
  if (ts.isIdentifier(callee)) return { local: callee.text, file: env.file };
  return undefined;
}

/** The export name a callee resolves to through the imports (or, in a `when`, by bare name), in one of the tables. */
function resolveCallee(call: ts.CallExpression, env: Env, table: Readonly<Record<string, { modules: readonly string[] }>> | Readonly<Record<string, readonly string[]>>): string | undefined {
  const c = calleeName(call, env);
  if (!c) return undefined;
  if (env.when) return Object.prototype.hasOwnProperty.call(table, c.local) ? c.local : undefined;
  // A local binding shadows an import of the same name.
  if (shadowed(c.local, call, env)) return undefined;
  return importedAs(env.file, c.local, table);
}

function resolveIdent(id: ts.Identifier, env: Env, table: Readonly<Record<string, { modules: readonly string[] }>> | Readonly<Record<string, readonly string[]>>): string | undefined {
  if (env.when) return Object.prototype.hasOwnProperty.call(table, id.text) ? id.text : undefined;
  if (shadowed(id.text, id, env)) return undefined;
  return importedAs(env.file, id.text, table);
}

function valueOfUncached(e: ts.Expression, env: Env, depth: number): Val | null {
  if (depth > 24) return OPAQUE;
  if (ts.isNumericLiteral(e)) { const v = Number(e.text); return { cls: "literal", get: () => v }; }
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { const v = e.text; return { cls: "literal", get: () => v }; }
  if (e.kind === ts.SyntaxKind.TrueKeyword) return { cls: "literal", get: () => true };
  if (e.kind === ts.SyntaxKind.FalseKeyword) return { cls: "literal", get: () => false };
  if (e.kind === ts.SyntaxKind.NullKeyword) return { cls: "literal", get: () => null };
  if (ts.isIdentifier(e)) {
    const constant = resolveIdent(e, env, CONSTANTS);
    if (constant) { const v = CONSTANTS[constant]!.value; return { cls: "const", get: () => v }; }
    if (resolveIdent(e, env, { ROLES: ["@/lib/roles"] })) return { cls: "rolesTable", get: () => ROLES };
    if (resolveIdent(e, env, { MARKETING_SCORECARD_ROLES: ["@/lib/marketing/access-shared"] })) return { cls: "roleList", get: () => MARKETING_SCORECARD_ROLES };
    return lookup(e.text, e, env, depth);
  }
  if (ts.isAwaitExpression(e)) {
    const inner = valueOf(e.expression, env, depth + 1);
    if (!inner) return OPAQUE;
    if (inner.cls === "searchParamsPromise") return { cls: "params", get: inner.get };
    return inner;
  }
  if (ts.isPropertyAccessExpression(e)) {
    if (e.expression.kind === ts.SyntaxKind.Identifier && (e.expression as ts.Identifier).text === "process" && e.name.text === "env") return { cls: "processEnv", get: () => ({}) };
    const base = valueOf(e.expression, env, depth + 1);
    return base ? propertyOf(base, e.name.text) : OPAQUE;
  }
  if (ts.isElementAccessExpression(e)) {
    const base = valueOf(e.expression, env, depth + 1);
    const key = valueOf(e.argumentExpression, env, depth + 1);
    if (base?.cls === "rolesTable" && key?.cls === "role") return { cls: "roleDef", get: (c) => ROLES[key.get(c) as RoleCode] };
    if (base?.cls === "params" && key?.cls === "literal") return { cls: "param", get: (c) => (base.get(c) as Record<string, unknown>)[String(key.get(c))] };
    return OPAQUE;
  }
  if (ts.isObjectLiteralExpression(e) && e.properties.some(ts.isSpreadAssignment)) {
    const lastSpread = e.properties.map((p) => ts.isSpreadAssignment(p)).lastIndexOf(true);
    const known = new Map<string, Val>();
    for (const p of e.properties.slice(lastSpread + 1)) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        const v = valueOf(p.initializer, env, depth + 1);
        if (v) known.set(p.name.text, v);
      }
    }
    return { cls: "record", get: () => undefined, props: known };
  }
  if (ts.isObjectLiteralExpression(e)) {
    const props: [string, Val][] = [];
    for (const p of e.properties) {
      if (ts.isShorthandPropertyAssignment(p)) { const v = lookup(p.name.text, p.name, env, depth + 1); if (!v) return OPAQUE; props.push([p.name.text, v]); }
      else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        const v = valueOf(p.initializer, env, depth + 1); if (!v) return OPAQUE; props.push([p.name.text, v]);
      } else return OPAQUE;
    }
    return { cls: "object", get: (c) => Object.fromEntries(props.map(([k, v]) => [k, v.get(c)])) };
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const l = valueOf(e.left, env, depth + 1);
    const r = valueOf(e.right, env, depth + 1);
    if (!l || !r) return OPAQUE;
    const shopish = (x: Val) => x.cls === "param" || x.cls === "shop" || x.cls === "literal";
    if (shopish(l) && shopish(r)) return { cls: l.cls === "shop" || r.cls === "shop" ? "shop" : "param", get: (c) => l.get(c) ?? r.get(c) };
    if ((l.cls === "shopRow" || l.cls === "literal") && (r.cls === "shopRow" || r.cls === "literal")) return { cls: "shopRow", get: (c) => l.get(c) ?? r.get(c) };
    return OPAQUE;
  }
  if (ts.isConditionalExpression(e)) {
    const cond = condOf(e.condition, env, depth + 1);
    const a = valueOf(e.whenTrue, env, depth + 1);
    const b = valueOf(e.whenFalse, env, depth + 1);
    if (!cond || !a || !b) return OPAQUE;
    const cls = a.cls === "literal" ? b.cls : a.cls;
    return { cls, get: (c) => (cond.get(c) ? a.get(c) : b.get(c)) };
  }
  if (ts.isCallExpression(e)) return callValue(e, env, depth) ?? predicateCall(e, env, depth);
  return OPAQUE;
}

function argVals(call: ts.CallExpression, env: Env, depth: number): Val[] | null {
  const out: Val[] = [];
  for (const a of call.arguments) { const v = valueOf(a, env, depth + 1); if (!v) return null; out.push(v); }
  return out;
}

const SESSIONISH = new Set<Cls>(["session", "actor", "object", "role", "level"]);

function callValue(call: ts.CallExpression, env: Env, depth: number): Val | null {
  const helper = resolveCallee(call, env, VALUE_HELPERS);
  if (helper === "requireSessionFromHeaders") return { cls: "session", get: (c) => c.auth };
  if (helper === "peopleActorFromAuth") {
    const [a] = argVals(call, env, depth) ?? [];
    return a?.cls === "session" ? { cls: "actor", get: (c) => peopleActorFromAuth(a.get(c) as FakeAuth) } : OPAQUE;
  }
  if (helper === "getRoleLevel") {
    const [a] = argVals(call, env, depth) ?? [];
    return a?.cls === "role" ? { cls: "level", get: (c) => getRoleLevel(a.get(c) as RoleCode) } : OPAQUE;
  }
  if (helper === "searchParamValues") {
    const [a] = argVals(call, env, depth) ?? [];
    return a?.cls === "params" ? { cls: "paramValues", get: (c) => searchParamValues(a.get(c) as Record<string, string>) } : OPAQUE;
  }
  if (helper === "shopParamFor") {
    const args = argVals(call, env, depth);
    if (!args || args.length !== 2 || args[0]!.cls !== "literal" || args[1]!.cls !== "paramValues") return OPAQUE;
    const [route, values] = args as [Val, Val];
    return { cls: "param", get: (c) => shopParamFor(route.get(c) as string, values.get(c) as Parameters<typeof shopParamFor>[1]) };
  }
  if (helper === "resolveShop") return { cls: "shopRow", get: () => ({ id: S, name: "Shop S", code: "S" }) };
  if (helper === "resolveShopId" || helper === "resolveReportShopId") return { cls: "shop", get: () => S };
  if (helper === "loadAccessibleLocations") return { cls: "shopList", get: () => [{ id: S, name: "Shop S", code: "S" }] };
  return OPAQUE;
}

/** A role predicate / membership / switch / task call as a value (its concrete result), or OPAQUE. */
function predicateCall(call: ts.CallExpression, env: Env, depth: number): Val | null {
  const table = env.file.switchCalls;
  const sw = resolveCallee(call, env, table);
  if (sw) {
    const want = SWITCH_ARGS[sw] ?? "";
    const got = call.arguments.map((a) => norm(a.getText(env.file.sf))).join(", ");
    if (got !== want) return OPAQUE;
    const name = table[sw]!.value;
    return { cls: "switch", get: (c) => { const v = c.switches[name] === true; c.readSwitches.set(name, v); return v; } };
  }
  const role = resolveCallee(call, env, ROLE_PREDICATES);
  if (role) {
    const args = argVals(call, env, depth);
    if (!args || args.length === 0 || !args.every((a) => SESSIONISH.has(a.cls) || a.cls === "switch" || a.cls === "literal")) return OPAQUE;
    if (!args.some((a) => SESSIONISH.has(a.cls))) return OPAQUE;
    const fn = ROLE_PREDICATES[role]!.value as (...a: unknown[]) => unknown;
    return { cls: "rolepred", get: (c) => fn(...args.map((a) => a.get(c))) };
  }
  const member = resolveCallee(call, env, MEMBERSHIP);
  if (member) {
    const args = argVals(call, env, depth);
    if (!args || args.length !== 2 || !SESSIONISH.has(args[0]!.cls) || !(args[1]!.cls === "shop" || args[1]!.cls === "param")) return OPAQUE;
    const fn = MEMBERSHIP[member]!.value as (...a: unknown[]) => unknown;
    const [who, where] = args as [Val, Val];
    return { cls: "membership", get: (c) => fn(who.get(c), where.get(c)) === true };
  }
  const task = env.when && calleeName(call, env)?.local === "taskAccess" ? "taskAccess" : resolveCallee(call, env, TASK_CALLS);
  if (task) {
    const t = taskLiteral(call, env, depth);
    if (!t) return OPAQUE;
    return { cls: "task", get: (c) => byTask(c, t) };
  }
  if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "some") {
    // MARKETING_SCORECARD_ROLES.some((r) => r === <session role>)
    const list = valueOf(call.expression.expression, env, depth + 1);
    const [cb] = call.arguments;
    if (list?.cls !== "roleList" || !cb || !ts.isArrowFunction(cb) || cb.parameters.length !== 1 || !ts.isIdentifier(cb.parameters[0]!.name)) return OPAQUE;
    const param = cb.parameters[0]!.name.text;
    const body = ts.isExpression(cb.body) ? strip(cb.body) : undefined;
    if (!body || !ts.isBinaryExpression(body) || body.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return OPAQUE;
    const sides = [body.left, body.right].map(strip);
    const other = sides.find((s) => !(ts.isIdentifier(s) && s.text === param));
    if (!other || sides.filter((s) => ts.isIdentifier(s) && s.text === param).length !== 1) return OPAQUE;
    const r = valueOf(other, env, depth + 1);
    if (r?.cls !== "role") return OPAQUE;
    return { cls: "rolepred", get: (c) => (list.get(c) as readonly string[]).includes(r.get(c) as string) };
  }
  return OPAQUE;
}

function taskLiteral(call: ts.CallExpression, env: Env, depth: number): TaskType | undefined {
  let found: string | undefined;
  for (const a of call.arguments) {
    const x = strip(a);
    if ((ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) && TASKS.has(x.text)) found = x.text;
    if (ts.isObjectLiteralExpression(x)) {
      for (const p of x.properties) {
        if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
        const key = p.name.getText(env.file.sf);
        if (key === "task" && ts.isPropertyAssignment(p) && ts.isStringLiteral(strip(p.initializer)) && TASKS.has((strip(p.initializer) as ts.StringLiteral).text)) found = (strip(p.initializer) as ts.StringLiteral).text;
        if (key === "locationId") {
          const v = ts.isShorthandPropertyAssignment(p) ? lookup(p.name.text, p.name, env, depth + 1) : valueOf(p.initializer, env, depth + 1);
          if (!v || !(v.cls === "shop" || v.cls === "param")) return undefined;
        }
      }
    }
  }
  return found as TaskType | undefined;
}

/** The byTask rule (plan 2.3), mirroring hasTaskAccess: refused below the task's floor, open from level 4, between
 *  the two only with an assignment today. */
function byTask(c: Ctx, task: TaskType): boolean {
  if (c.level < TASK_MIN_LEVEL[task]) return false;
  if (c.level >= 4) return true;
  return c.facts.assignedTasks?.has(task) ?? false;
}

const COMPARE = new Set([
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);
/** Which classes may be compared with a literal (or a constant, for levels). */
const COMPARABLE = new Set<Cls>(["level", "role", "param", "shop", "shopListLength", "rolepred"]);
/** Which classes are a condition on their own (truthiness). */
const TRUTHY = new Set<Cls>(["param", "shop", "shopRow", "switch", "rolepred", "membership", "task", "fact"]);

/** Classify a condition: a tree of !, &&, ||, parentheses and ?: over atoms in the closed tables, or OPAQUE. */
function condOf(expr: ts.Expression, env: Env, depth = 0): Cond | null {
  return cached(condCache, expr, env, () => condOfUncached(strip(expr), env, depth));
}

function condOfUncached(e: ts.Expression, env: Env, depth: number): Cond | null {
  if (depth > 24) return OPAQUE;
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = condOf(e.operand, env, depth + 1);
    return inner ? { get: (c) => !inner.get(c) } : OPAQUE;
  }
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    const l = condOf(e.left, env, depth + 1);
    const r = condOf(e.right, env, depth + 1);
    if (!l || !r) return OPAQUE;
    return e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? { get: (c) => l.get(c) && r.get(c) } : { get: (c) => l.get(c) || r.get(c) };
  }
  if (ts.isConditionalExpression(e)) {
    const q = condOf(e.condition, env, depth + 1);
    const a = condOf(e.whenTrue, env, depth + 1);
    const b = condOf(e.whenFalse, env, depth + 1);
    return q && a && b ? { get: (c) => (q.get(c) ? a.get(c) : b.get(c)) } : OPAQUE;
  }
  if (ts.isAwaitExpression(e)) return condOf(e.expression, env, depth + 1);
  if (ts.isBinaryExpression(e) && COMPARE.has(e.operatorToken.kind)) {
    const l = valueOf(e.left, env, depth + 1);
    const r = valueOf(e.right, env, depth + 1);
    if (!l || !r) return OPAQUE;
    const [v, k] = l.cls === "literal" || l.cls === "const" ? [r, l] : [l, r];
    if (!COMPARABLE.has(v.cls) || !(k.cls === "literal" || (k.cls === "const" && v.cls === "level"))) return OPAQUE;
    if (k.cls === "const" && v.cls !== "level") return OPAQUE;
    if (v.cls !== "level" && !(e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || e.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) return OPAQUE;
    const op = e.operatorToken.kind;
    const cmp = (a: unknown, b: unknown): boolean => {
      switch (op) {
        case ts.SyntaxKind.LessThanToken: return (a as number) < (b as number);
        case ts.SyntaxKind.LessThanEqualsToken: return (a as number) <= (b as number);
        case ts.SyntaxKind.GreaterThanToken: return (a as number) > (b as number);
        case ts.SyntaxKind.GreaterThanEqualsToken: return (a as number) >= (b as number);
        case ts.SyntaxKind.EqualsEqualsEqualsToken: return a === b;
        default: return a !== b;
      }
    };
    return { get: (c) => cmp(l.get(c), r.get(c)) };
  }
  if (ts.isCallExpression(e)) {
    const p = predicateCall(e, env, depth);
    if (p) return { get: (c) => Boolean(p.get(c)) };
    return OPAQUE;
  }
  const v = valueOf(e, env, depth + 1);
  if (v && TRUTHY.has(v.cls)) return { get: (c) => Boolean(v.get(c)) };
  // An alias to a predicate call: `const ok = canViewPars(auth.user.role); if (!ok) ...`
  if (ts.isIdentifier(e)) {
    const r = resolveName(e.text, e, env);
    if (r.kind === "decl" && !r.element) return condOf(r.decl.initializer!, r.env, depth + 1);
    if (r.kind === "param" && r.binding.kind === "expr") return condOf(r.binding.expr, r.binding.env, depth + 1);
  }
  return OPAQUE;
}

/** Does this expression (after alias resolution) mention a session, switch or fact value? */
function mentionsViewer(expr: ts.Node, env: Env, depth = 0): boolean {
  if (depth > 12) return false;
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isExpression(n)) {
      const v = valueOf(n, env, 0);
      if (v && VIEWER_CLASSES.has(v.cls)) { found = true; return; }
      if (ts.isCallExpression(n) && predicateCall(n, env, 0)) { found = true; return; }
      if (ts.isPropertyAccessExpression(n) && n.name.text === "error") return; // a read's failure is data, not a decision
      if (ts.isIdentifier(n)) {
        const r = resolveName(n.text, n, env);
        const errorOfRead = r.kind === "decl" && r.element && (r.element.propertyName ?? r.element.name).getText(env.file.sf) === "error";
        if (r.kind === "decl" && !errorOfRead && mentionsViewer(r.decl.initializer!, r.env, depth + 1)) { found = true; return; }
        if (r.kind === "param" && r.binding.kind === "expr" && mentionsViewer(r.binding.expr, r.binding.env, depth + 1)) { found = true; return; }
      }
    }
    if (ts.isFunctionLike(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return found;
}

/** Three-valued evaluation: core leaves are evaluated, anything else is unknown (Kleene logic). */
function cond3(expr: ts.Expression, env: Env, ctx: Ctx): boolean | undefined {
  const e = strip(expr);
  const core = condOf(e, env);
  if (core) return core.get(ctx);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    const v = cond3(e.operand, env, ctx);
    return v === undefined ? undefined : !v;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const l = cond3(e.left, env, ctx);
    if (l === false) return false;
    const r = cond3(e.right, env, ctx);
    if (r === false) return false;
    return l === true && r === true ? true : undefined;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const l = cond3(e.left, env, ctx);
    if (l === true) return true;
    const r = cond3(e.right, env, ctx);
    if (r === true) return true;
    return l === false && r === false ? false : undefined;
  }
  return undefined;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The census (4.4.2): every construct that can end the page
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface Construct {
  file: string;
  kind: ConstructKind;
  node: ts.Node;
  /** The exit statement (for exit kinds). */
  exit?: ts.Node;
  /** The exit's own guarding if (the construct node for exits that have one). */
  ownIf?: ts.IfStatement;
  fnNode: FnLike | undefined;
  fn: string;
  anchor: string;
  text: string;
  line: number;
}

interface Analysis {
  info: FileInfo;
  walked: Set<FnLike>;
  roots: FnLike[];
  /** The canonical environment of each walked function (roots: the entry; delegates: their first call site). */
  envs: Map<FnLike, Env>;
  constructs: Construct[];
  coreExits: Set<ts.Node>;
}

function isFnExpr(n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n);
}

function fileInfo(file: string, src: string, switchCalls: Readonly<Record<string, TableEntry<SwitchName>>> = SWITCH_CALLS): FileInfo {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map<string, { module: string; name: string }>();
  const fns = new Map<string, FnLike>();
  const topConsts = new Map<string, ts.VariableDeclaration>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      if (st.importClause.name) imports.set(st.importClause.name.text, { module: spec, name: "default" });
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.set(el.name.text, { module: spec, name: (el.propertyName ?? el.name).text });
    }
    if (ts.isFunctionDeclaration(st) && st.name) fns.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        if (d.initializer && isFnExpr(d.initializer)) fns.set(d.name.text, d.initializer);
        else if (st.declarationList.flags & ts.NodeFlags.Const) topConsts.set(d.name.text, d);
      }
    }
  }
  return { file, sf, imports, fns, topConsts, locals: new Map(), switchCalls };
}

function fnOf(n: ts.Node): FnLike | undefined {
  for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p as FnLike;
  return undefined;
}

function fnName(fn: FnLike | undefined, sf: ts.SourceFile): string {
  if (!fn) return "<top>";
  if (ts.isFunctionDeclaration(fn)) return fn.name ? fn.name.text : "default";
  if (fn.parent && ts.isVariableDeclaration(fn.parent)) return "const " + fn.parent.name.getText(sf);
  if (fn.parent && ts.isCallExpression(fn.parent)) return "callback of " + norm(fn.parent.expression.getText(sf));
  if (fn.parent && ts.isJsxExpression(fn.parent)) return "jsx callback";
  return "<fn>";
}

function anchorOf(node: ts.Node, sf: ts.SourceFile): string {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) return "fn:" + fnName(p as FnLike, sf);
    if (ts.isCatchClause(p)) {
      const first = p.parent.tryBlock.statements[0];
      return "catch of try { " + (first ? norm(first.getText(sf)) : "") + " }";
    }
    if (ts.isIfStatement(p)) return "if (" + norm(p.expression.getText(sf)) + ")";
    if (ts.isIterationStatement(p, false)) return "loop";
  }
  return "<top>";
}

function isDefaultExport(n: ts.Node): boolean {
  return ts.canHaveModifiers(n) && (ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false);
}

/** The same-file function a `return f(...)` / `return await f(...)` delegates to, if any. */
function delegateOf(ret: ts.ReturnStatement, info: FileInfo): { fn: FnLike; call: ts.CallExpression } | undefined {
  if (!ret.expression) return undefined;
  let e = strip(ret.expression);
  if (ts.isAwaitExpression(e)) e = strip(e.expression);
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const fn = info.fns.get(e.expression.text);
    if (fn) return { fn, call: e };
  }
  return undefined;
}

/** Bind a function's parameters to call arguments evaluated in the caller's environment. */
function bindParams(fn: FnLike, args: readonly ts.Expression[], callerEnv: Env): Map<string, Binding> {
  const out = new Map<string, Binding>();
  fn.parameters.forEach((p, i) => {
    const arg = args[i];
    const b: Binding | undefined = arg ? { kind: "expr", expr: arg, env: callerEnv } : p.initializer ? { kind: "expr", expr: p.initializer, env: callerEnv } : undefined;
    if (!b) return;
    if (ts.isIdentifier(p.name)) out.set(p.name.text, b);
    else if (ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) {
        if (!ts.isIdentifier(el.name) || el.dotDotDotToken) continue;
        const prop = el.propertyName ? el.propertyName.getText() : el.name.text;
        out.set(el.name.text, { kind: "destructured", from: b, prop });
      }
    }
  });
  return out;
}

/** The page's own entry environment: its props hold the entry request's searchParams. */
function entryEnv(info: FileInfo, fn: FnLike): Env {
  const params = new Map<string, Binding>();
  const p = fn.parameters[0];
  const props: Val = { cls: "props", get: (c) => ({ searchParams: c.params }) };
  if (p) {
    if (ts.isIdentifier(p.name)) params.set(p.name.text, { kind: "val", val: props });
    else if (ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const prop = el.propertyName ? el.propertyName.getText(info.sf) : el.name.text;
        if (prop === "searchParams") params.set(el.name.text, { kind: "val", val: { cls: "searchParamsPromise", get: (c) => c.params } });
      }
    }
  }
  return newEnv(info, fn, params);
}

const ENCLOSING_KIND = (p: ts.Node): ConstructKind | undefined => {
  if (ts.isIfStatement(p)) return "enclosing-if";
  if (ts.isConditionalExpression(p)) return "enclosing-ternary";
  if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken || p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return "enclosing-logical";
  if (ts.isSwitchStatement(p)) return "enclosing-switch";
  if (ts.isIterationStatement(p, false)) return "enclosing-loop";
  if (ts.isCatchClause(p)) return "enclosing-catch";
  return undefined;
};

function analyze(file: string, src: string, switchCalls?: Readonly<Record<string, TableEntry<SwitchName>>>): Analysis {
  const info = fileInfo(file, src, switchCalls);
  const sf = info.sf;
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // Walked functions: the default export, PulseHome, and (transitively) same-file functions reached by `return f(...)`.
  const roots: FnLike[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && (isDefaultExport(st) || st.name?.text === "PulseHome")) roots.push(st);
  }
  const walked = new Set<FnLike>();
  const envs = new Map<FnLike, Env>();
  const addWalked = (fn: FnLike, env: Env) => {
    if (walked.has(fn)) return;
    walked.add(fn);
    envs.set(fn, env);
    const visit = (n: ts.Node) => {
      if (n !== fn && ts.isFunctionLike(n)) return;
      if (ts.isReturnStatement(n)) {
        const d = delegateOf(n, info);
        if (d) addWalked(d.fn, newEnv(info, d.fn, bindParams(d.fn, d.call.arguments, env)));
      }
      ts.forEachChild(n, visit);
    };
    if (fn.body) ts.forEachChild(fn.body, visit);
  };
  for (const r of roots) addWalked(r, isDefaultExport(r) ? entryEnv(info, r) : componentEnv(info, r));

  const envFor = (fn: FnLike | undefined): Env => (fn && envs.get(fn)) || newEnv(info, fn, new Map());

  // Exits.
  const exits: { n: ts.Node; kind: ConstructKind }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "redirect" || n.expression.text === "notFound")) exits.push({ n, kind: n.expression.text });
    if (ts.isThrowStatement(n)) exits.push({ n, kind: "throw" });
    if (ts.isExpressionStatement(n)) {
      let e = strip(n.expression);
      if (ts.isAwaitExpression(e)) e = strip(e.expression);
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text !== "redirect" && e.expression.text !== "notFound"
        && (info.imports.has(e.expression.text) || info.fns.has(e.expression.text))) exits.push({ n, kind: "standalone" });
    }
    if (ts.isReturnStatement(n)) {
      const fn = fnOf(n);
      if (fn && walked.has(fn) && fn.body && ts.isBlock(fn.body)) {
        const body = fn.body;
        const last = body.statements[body.statements.length - 1];
        const d = delegateOf(n, info);
        // A return that hands the page to an IMPORTED function is a delegation the reader cannot follow: an exit too,
        // even as the last statement ("anything else that delegates is a reviewed entry").
        let r = n.expression ? strip(n.expression) : undefined;
        if (r && ts.isAwaitExpression(r)) r = strip(r.expression);
        const importedDelegate = !!r && ts.isCallExpression(r) && ts.isIdentifier(r.expression) && info.imports.has(r.expression.text);
        if ((n !== last && !(d && n.parent === body)) || importedDelegate) exits.push({ n, kind: "early-return" });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const constructs: Construct[] = [];
  const coreExits = new Set<ts.Node>();
  const seen = new Set<ts.Node>();
  const add = (node: ts.Node, kind: ConstructKind, extra: Partial<Construct> = {}) => {
    if (seen.has(node)) return;
    seen.add(node);
    const fnNode = fnOf(node);
    constructs.push({ file, kind, node, fnNode, fn: fnName(fnNode, sf), anchor: anchorOf(node, sf), text: norm(node.getText(sf)), line: line(node), ...extra });
  };

  for (const { n, kind } of exits) {
    const fn = fnOf(n);
    const env = envFor(fn);
    const stmt = kind === "redirect" || kind === "notFound" ? n.parent : n;
    let own: ts.IfStatement | undefined;
    const pp = stmt.parent;
    if (pp && ts.isIfStatement(pp) && (pp.thenStatement === stmt || pp.elseStatement === stmt)) own = pp;
    else if (pp && ts.isBlock(pp) && pp.statements.length === 1 && pp.parent && ts.isIfStatement(pp.parent) && (pp.parent.thenStatement === pp || pp.parent.elseStatement === pp)) own = pp.parent;
    // Enclosing nodes up to the function, other than the exit's own if.
    const enclosing: ts.Node[] = [];
    for (let p = n.parent; p && p !== fn; p = p.parent) if (ENCLOSING_KIND(p) && p !== own) enclosing.push(p);
    const inTryBlock = (() => {
      for (let p: ts.Node | undefined = n.parent; p && p !== fn; p = p.parent) {
        if (ts.isTryStatement(p) && n.getStart(sf) >= p.tryBlock.getStart(sf) && n.getEnd() <= p.tryBlock.getEnd()) return true;
      }
      return false;
    })();
    const coreEnclosing = (x: ts.Node) => ts.isIfStatement(x) && condOf(x.expression, env) !== null;
    const isExitStmt = (kind === "redirect" || kind === "notFound") && ts.isExpressionStatement(stmt);
    if (isExitStmt && own && fn && walked.has(fn) && condOf(own.expression, env) && enclosing.every(coreEnclosing)) { coreExits.add(stmt); continue; }
    if (kind === "standalone" && inTryBlock) continue; // covered by its try's catch (core, or a reviewed entry)
    add(own ?? stmt, kind, { exit: stmt, ownIf: own });
    if (fn && isFnExpr(fn) && ts.isCallExpression(fn.parent) && ts.isPropertyAccessExpression(fn.parent.expression) && fn.parent.expression.name.text === "catch") {
      add(fn.parent, "enclosing-.catch");
    }
    for (const x of enclosing) {
      if (coreEnclosing(x)) continue;
      add(x, ENCLOSING_KIND(x)!);
    }
  }
  return { info, walked, roots, envs, constructs, coreExits };
}

/** A component's environment when it is analyzed on its own (its props are bound at the call site when walked). */
function componentEnv(info: FileInfo, fn: FnLike): Env {
  return newEnv(info, fn, new Map());
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Binding the reviewed entries to the constructs (4.4.4, 4.4.10)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

interface Bound { construct: Construct; entry: ReviewedEntry }

/** The binding key. An entry with no `fn` / `anchor` binds by text alone (fixtures only: the committed list always
 *  carries both, and a test pins that), which is how an ambiguous text is shown to fail. */
function sameKey(c: Construct, e: ReviewedEntry) {
  return c.kind === e.kind && c.text === e.text && (!e.fn || c.fn === e.fn) && (!e.anchor || c.anchor === e.anchor);
}

function bindFile(a: Analysis, entries: readonly ReviewedEntry[], readSource: (file: string) => string): { bound: Map<ts.Node, Bound>; problems: Problem[] } {
  const problems: Problem[] = [];
  const bound = new Map<ts.Node, Bound>();
  const mine = entries.filter((e) => e.file === a.info.file);
  const unboundEntries: ReviewedEntry[] = [];
  const usedConstructs = new Set<Construct>();
  for (const e of mine) {
    const hits = a.constructs.filter((c) => sameKey(c, e));
    if (hits.length > 1) {
      problems.push({ code: "AMBIGUOUS_ENTRY", file: e.file, line: e.line, detail: `${entryKey(e)} binds ${hits.length} nodes` });
      continue;
    }
    if (hits.length === 0) { unboundEntries.push(e); continue; }
    const c = hits[0]!;
    if (usedConstructs.has(c)) {
      problems.push({ code: "AMBIGUOUS_ENTRY", file: e.file, line: c.line, detail: `two entries bind one construct: ${entryKey(e)}` });
      continue;
    }
    usedConstructs.add(c);
    // Pins: each text must occur exactly once in its file.
    const badPin = (e.pins ?? []).find((p) => countOccurrences(norm(readSource(p.file)), norm(p.text)) !== 1);
    if (badPin) {
      problems.push({ code: "ENTRY_TEXT_MISMATCH", file: e.file, line: c.line, detail: `pin "${badPin.text}" no longer occurs exactly once in ${badPin.file}` });
      continue;
    }
    bound.set(c.node, { construct: c, entry: e });
  }
  const unreviewed = a.constructs.filter((c) => !usedConstructs.has(c));
  // An entry and a construct of the same kind in the same function that both failed to bind: the construct was edited.
  const pairedConstructs = new Set<Construct>();
  for (const e of unboundEntries) {
    const edited = unreviewed.find((c) => !pairedConstructs.has(c) && c.kind === e.kind && c.fn === e.fn && (c.anchor === e.anchor || c.line === e.line || similar(c.text, e.text)));
    if (edited) {
      pairedConstructs.add(edited);
      problems.push({ code: "ENTRY_TEXT_MISMATCH", file: e.file, line: edited.line, detail: `entry no longer matches its construct: ${entryKey(e)} ≠ ${edited.text}` });
    } else {
      problems.push({ code: "STALE_ENTRY", file: e.file, line: e.line, detail: `binds no construct: ${entryKey(e)}` });
    }
  }
  for (const c of unreviewed) {
    if (pairedConstructs.has(c)) continue;
    problems.push({ code: "UNREVIEWED_CONSTRUCT", file: c.file, line: c.line, detail: `${c.kind} in ${c.fn} at ${c.anchor}: ${c.text.slice(0, 160)}` });
  }
  return { bound, problems };
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) n++;
  return n;
}

/** Two texts share their first 40 characters (an edited construct keeps its opening). */
function similar(a: string, b: string): boolean {
  const k = Math.min(40, a.length, b.length);
  return k > 10 && a.slice(0, k) === b.slice(0, k);
}

/** Validate an entry's meaning (independent of any viewer). */
function validateMeaning(b: Bound, a: Analysis, pages: Map<string, CensusPage>, allRoutes: ReadonlySet<string>): Problem[] {
  const { entry: e, construct: c } = b;
  const out: Problem[] = [];
  const m = e.meaning;
  if (m === null) return [{ code: "UNCLASSIFIED_ENTRY", file: e.file, line: c.line, detail: `meaning is null: ${entryKey(e)}` }];
  if (m.kind === "refuse") {
    if (!whenCond(m.when)) out.push({ code: "UNKNOWN_CONDITION", file: e.file, line: c.line, detail: `refuse.when is not a core condition: ${m.when}` });
  }
  if (m.kind === "operational-error") {
    const env = a.envs.get(c.fnNode!) ?? newEnv(a.info, c.fnNode, new Map());
    const guard = c.ownIf?.expression ?? (ts.isIfStatement(c.node) ? c.node.expression : undefined);
    if (guard && mentionsViewer(guard, env)) out.push({ code: "OPERATIONAL_MENTIONS_SESSION", file: e.file, line: c.line, detail: `an operational-error guard reads the session, a switch or a fact: ${norm(guard.getText(a.info.sf))}` });
  }
  if (m.kind === "success-redirect") {
    const route = m.target.split("?")[0]!;
    if (!allRoutes.has(route) && !pages.has(route)) out.push({ code: "BAD_REDIRECT_TARGET", file: e.file, line: c.line, detail: `target resolves to no page: ${m.target}` });
  }
  if (m.kind === "admit" && m.enters && !Object.values(COMPONENTS).some((x) => x.file === m.enters!.file && x.fn === m.enters!.fn)) {
    out.push({ code: "UNSUPPORTED", file: e.file, line: c.line, detail: `admit.enters names a component outside the closed list: ${m.enters.file}#${m.enters.fn}` });
  }
  return out;
}

// The `when` grammar: a core condition over auth, actor, S, fact and the atom tables by bare name.
const whenCache = new Map<string, { cond: Cond | null }>();
function whenCond(text: string): Cond | null {
  const hit = whenCache.get(text);
  if (hit) return hit.cond;
  const src = `const __when = (${text});`;
  const info = fileInfo("<when>", src);
  const st = info.sf.statements[0];
  let cond: Cond | null = null;
  if (st && ts.isVariableStatement(st) && st.declarationList.declarations[0]?.initializer && (info.sf as unknown as { parseDiagnostics: readonly unknown[] }).parseDiagnostics.length === 0) {
    const env: Env = { ...newEnv(info, undefined, new Map()), when: true };
    cond = condOf(st.declarationList.declarations[0].initializer, env);
  }
  whenCache.set(text, { cond });
  return cond;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The walk (4.4.3, 4.4.4): the decision procedure under one viewer
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type K = Step | { tag: "admitted" } | { tag: "run"; run: () => boolean };
interface Step { tag: "step"; stmt: ts.Statement; env: Env; ret: K; next: K }
const ADMITTED: K = { tag: "admitted" };

function chain(stmts: readonly ts.Statement[], env: Env, ret: K, tail: K): K {
  let k = tail;
  for (let i = stmts.length - 1; i >= 0; i--) k = { tag: "step", stmt: stmts[i]!, env, ret, next: k };
  return k;
}
const stmtsOf = (s: ts.Statement | undefined): readonly ts.Statement[] => (!s ? [] : ts.isBlock(s) ? s.statements : [s]);

export interface CensusPage { route: string; file: string; takesShop: boolean; admin: boolean }

interface Loaded { a: Analysis; bound: Map<ts.Node, Bound> }

export interface ReaderOptions {
  /** In-memory sources (fixtures): file → text. Anything else is read from disk. */
  sources?: Readonly<Record<string, string>>;
  /** The reviewed entries (default: the committed list). */
  entries?: readonly ReviewedEntry[];
  /** Extra census pages (synthetic fixtures). */
  pages?: readonly CensusPage[];
  /** A copy of SWITCH_CALLS (mutation case M2). */
  switchCalls?: Readonly<Record<string, TableEntry<SwitchName>>>;
}

export interface Verdict { admitted: boolean; trace: string[]; readSwitches: Map<SwitchName, boolean> }

export class Reader {
  private readonly loaded = new Map<string, Loaded>();
  private readonly problems = new Map<string, Problem[]>();
  readonly pages: Map<string, CensusPage>;
  private readonly entries: readonly ReviewedEntry[];
  private readonly allRoutes: ReadonlySet<string>;

  constructor(pages: readonly CensusPage[], allRoutes: ReadonlySet<string>, private readonly opts: ReaderOptions = {}) {
    this.pages = new Map([...pages, ...(opts.pages ?? [])].map((p) => [p.route, p]));
    this.entries = opts.entries ?? loadReviewedEntries();
    this.allRoutes = new Set([...allRoutes, ...(opts.pages ?? []).map((p) => p.route)]);
  }

  read = (file: string): string => {
    const o = this.opts.sources?.[file];
    if (o !== undefined) return o;
    if (!existsSync(file)) throw new PageGateError("STALE_ENTRY", `no such file: ${file}`);
    return readFileSync(file, "utf8");
  };

  /** Analyze and bind one census file; throws a PageGateError carrying every problem. */
  load(file: string): Loaded {
    const hit = this.loaded.get(file);
    if (hit) return hit;
    const a = analyze(file, this.read(file), this.opts.switchCalls);
    const { bound, problems } = bindFile(a, this.entries, this.read);
    for (const b of bound.values()) problems.push(...validateMeaning(b, a, this.pages, this.allRoutes));
    if (problems.length) {
      this.problems.set(file, problems);
      throw new PageGateError(problems[0]!.code, problems.map((p) => `${p.file}:${p.line ?? "?"} ${p.code} ${p.detail}`).join("\n"), problems);
    }
    const l = { a, bound };
    this.loaded.set(file, l);
    return l;
  }

  /** The census of one file (constructs, with the records that bind them); never throws on binding problems. */
  census(file: string): { constructs: Construct[]; problems: Problem[]; bound: Map<ts.Node, Bound> } {
    const a = analyze(file, this.read(file), this.opts.switchCalls);
    const { bound, problems } = bindFile(a, this.entries, this.read);
    for (const b of bound.values()) problems.push(...validateMeaning(b, a, this.pages, this.allRoutes));
    return { constructs: a.constructs, problems, bound };
  }

  /** The keys of the reviewed entries a page consumes (its own file, the admin layout, PulseHome when it enters it). */
  consumes(route: string): string[] {
    const page = this.page(route);
    const files = [page.file, ...(page.admin ? ["app/admin/layout.tsx"] : [])];
    const keys: string[] = [];
    for (const f of files) {
      const l = this.load(f);
      for (const b of l.bound.values()) {
        keys.push(entryKey(b.entry));
        const m = b.entry.meaning;
        if (m?.kind === "admit" && m.enters) for (const b2 of this.load(m.enters.file).bound.values()) keys.push(entryKey(b2.entry));
      }
    }
    return [...new Set(keys)].sort();
  }

  page(route: string): CensusPage {
    const p = this.pages.get(route);
    if (!p) throw new PageGateError("NOT_A_CENSUS_PAGE", route);
    return p;
  }

  /** Does the entry request of `route` render the page for this viewer? */
  admits(route: string, viewer: ViewerPoint, opts: { forceArm?: readonly ForceArm[]; params?: Record<string, string> } = {}): Verdict {
    const page = this.page(route);
    const role = viewer.role;
    const ctx: Ctx = {
      role, level: ROLES[role].level, switches: viewer.switches, facts: viewer.facts ?? {},
      params: opts.params ?? (page.takesShop ? { location: S } : {}), auth: fakeAuth(role), readSwitches: new Map(),
      forceArm: opts.forceArm ?? [], trace: [], stack: [],
    };
    const admitted = this.evaluate(page, ctx);
    return { admitted, trace: ctx.trace, readSwitches: ctx.readSwitches };
  }

  private evaluate(page: CensusPage, ctx: Ctx): boolean {
    const key = `${page.route}?${JSON.stringify(Object.entries(ctx.params).sort())}`;
    if (ctx.stack.includes(key)) throw new PageGateError("REDIRECT_LOOP", [...ctx.stack, key].join(" → "));
    ctx.stack.push(key);
    try {
      if (page.admin && !this.walkRoot("app/admin/layout.tsx", ctx)) { ctx.trace.push(`${page.route}: refused by the admin layout`); return false; }
      return this.walkRoot(page.file, ctx);
    } finally {
      ctx.stack.pop();
    }
  }

  private walkRoot(file: string, ctx: Ctx): boolean {
    const l = this.load(file);
    const root = l.a.roots.find((r) => isDefaultExport(r));
    if (!root || !root.body || !ts.isBlock(root.body)) throw new PageGateError("UNSUPPORTED", `${file}: no default-export function body`);
    const env = l.a.envs.get(root)!;
    return this.walk(chain(root.body.statements, env, ADMITTED, ADMITTED), ctx);
  }

  private walk(k0: K, ctx: Ctx): boolean {
    let k = k0;
    for (;;) {
      if (k.tag === "admitted") return true;
      if (k.tag === "run") return k.run();
      const { stmt, env, ret, next } = k;
      const l = this.load(env.file.file);
      const bound = l.bound.get(stmt);
      if (bound) return this.applyConstruct(bound, k, ctx);
      if (l.a.coreExits.has(stmt)) { ctx.trace.push(`${env.file.file}:${lineOf(stmt)} core exit refuses`); return false; }
      if (ts.isBlock(stmt)) { k = chain(stmt.statements, env, ret, next); continue; }
      if (ts.isIfStatement(stmt)) {
        const c = condOf(stmt.expression, env);
        if (c) { k = chain(stmtsOf(c.get(ctx) ? stmt.thenStatement : stmt.elseStatement), env, ret, next); continue; }
        this.assertNoExit(stmt, l, env);
        k = next; continue;
      }
      if (ts.isTryStatement(stmt)) {
        const after = stmt.finallyBlock ? chain(stmt.finallyBlock.statements, env, ret, next) : next;
        const catchBound = stmt.catchClause ? l.bound.get(stmt.catchClause) : undefined;
        if (catchBound) return this.applyEnclosing(catchBound, ctx, {
          entered: chain(stmt.catchClause!.block.statements, env, ret, after), other: chain(stmt.tryBlock.statements, env, ret, after),
          enteredArm: "caught", otherArm: "not-thrown", cond: undefined,
        });
        k = chain(stmt.tryBlock.statements, env, ret, after); continue;
      }
      if (ts.isReturnStatement(stmt)) {
        const d = delegateOf(stmt, env.file);
        if (d && ret === ADMITTED && l.a.walked.has(d.fn)) {
          const fnEnv = siteEnv(d.call, env, () => newEnv(env.file, d.fn, bindParams(d.fn, d.call.arguments, env)));
          k = chain((d.fn.body as ts.Block).statements, fnEnv, ADMITTED, ADMITTED); continue;
        }
        k = ret; continue;
      }
      // Any other statement: constructs inside expressions (`.catch(...)` callbacks), applied in source order.
      const inner = this.innerConstructs(stmt, l);
      if (inner.length > 0) return this.applyInner(inner, 0, k, ctx);
      this.assertNoExit(stmt, l, env);
      k = next;
    }
  }

  /** A statement the walk skips must not hold an exit (the census guarantees it; this is the fail-closed check). */
  private assertNoExit(stmt: ts.Node, l: Loaded, env: Env) {
    let hit: ts.Node | undefined;
    const visit = (n: ts.Node) => {
      if (hit) return;
      if (l.bound.has(n) || l.a.coreExits.has(n)) { hit = n; return; }
      if (n !== stmt && ts.isFunctionLike(n)) return;
      ts.forEachChild(n, visit);
    };
    visit(stmt);
    if (hit) throw new PageGateError("UNSUPPORTED", `${env.file.file}:${lineOf(hit)}: an exit inside a statement the walk cannot enter`);
  }

  private innerConstructs(stmt: ts.Statement, l: Loaded): Bound[] {
    const out: Bound[] = [];
    const visit = (n: ts.Node) => {
      const b = n !== stmt ? l.bound.get(n) : undefined;
      if (b && b.construct.kind === "enclosing-.catch") { out.push(b); return; }
      if (b) throw new PageGateError("UNSUPPORTED", `${l.a.info.file}:${b.construct.line}: a ${b.construct.kind} inside an expression`);
      if (n !== stmt && ts.isFunctionLike(n)) return;
      ts.forEachChild(n, visit);
    };
    visit(stmt);
    return out;
  }

  private applyInner(inner: Bound[], i: number, k: Step, ctx: Ctx): boolean {
    if (i >= inner.length) return this.walk(k.next, ctx);
    const b = inner[i]!;
    const call = b.construct.node as ts.CallExpression;
    const cb = call.arguments[0];
    if (!cb || !isFnExpr(cb)) throw new PageGateError("UNSUPPORTED", `${b.construct.file}:${b.construct.line}: .catch without a callback`);
    const cbEnv = siteEnv(cb, k.env, () => newEnv(k.env.file, cb, new Map(), k.env));
    // The callback's normal completion (or its `return`) resumes after the statement.
    const continueAfter = (): boolean => this.applyInner(inner, i + 1, k, ctx);
    return this.applyEnclosingFns(b, ctx, {
      entered: () => {
        if (!ts.isBlock(cb.body)) return continueAfter(); // an expression body cannot hold an exit statement
        const resume: K = { tag: "run", run: continueAfter };
        return this.walk(chain(cb.body.statements, cbEnv, resume, resume), ctx);
      },
      other: continueAfter,
      enteredArm: "caught", otherArm: "not-thrown",
    });
  }

  private applyConstruct(b: Bound, k: Step, ctx: Ctx): boolean {
    const c = b.construct;
    const m = b.entry.meaning!;
    const { env, ret, next } = k;
    const tag = `${c.file}:${c.line} ${c.kind} (${m.kind})`;
    if (c.kind === "enclosing-if") {
      const s = c.node as ts.IfStatement;
      return this.applyEnclosing(b, ctx, {
        entered: chain(stmtsOf(s.thenStatement), env, ret, next), other: chain(stmtsOf(s.elseStatement), env, ret, next),
        enteredArm: "then", otherArm: "else", cond: cond3(s.expression, env, ctx),
      });
    }
    if (c.kind === "enclosing-loop") {
      const s = c.node as ts.IterationStatement;
      return this.applyEnclosing(b, ctx, { entered: chain(stmtsOf(s.statement), env, ret, next), other: next, enteredArm: "body", otherArm: "skip", cond: undefined });
    }
    if (c.kind.startsWith("enclosing-")) throw new PageGateError("UNSUPPORTED", `${tag}: the walk does not enter a ${c.kind}`);

    // An exit construct, with or without its own if.
    const own = c.ownIf;
    let firesArm: "then" | "else" = "then";
    let other: K = next;
    let c3: boolean | undefined = true;
    if (own) {
      const exitInThen = stmtsOf(own.thenStatement).includes(c.exit as ts.Statement);
      firesArm = exitInThen ? "then" : "else";
      other = chain(stmtsOf(exitInThen ? own.elseStatement : own.thenStatement), env, ret, next);
      const v = cond3(own.expression, env, ctx);
      c3 = v === undefined ? undefined : exitInThen ? v : !v;
    }
    const forced = this.forced(b, ctx);
    if (forced === "then" || forced === "else") c3 = forced === firesArm;
    switch (m.kind) {
      case "refuse":
        if (whenCond(m.when)!.get(ctx)) { ctx.trace.push(`${tag} refuses: ${m.when}`); return false; }
        ctx.trace.push(`${tag} does not refuse`);
        return this.walk(other, ctx);
      case "operational-error":
        return this.walk(other, ctx);
      case "admit": {
        const fires = () => this.admitExit(b, k, ctx);
        if (c3 === true) return fires();
        if (c3 === false) return this.walk(other, ctx);
        return fires() && this.walk(other, ctx);
      }
      case "success-redirect": {
        const fires = () => this.redirectTarget(b, m.target, ctx);
        if (c3 === true) return fires();
        if (c3 === false) return this.walk(other, ctx);
        return fires() && this.walk(other, ctx);
      }
    }
  }

  /** An admit exit fires: the page renders, or walks the function / component it delegates to. */
  private admitExit(b: Bound, k: Step, ctx: Ctx): boolean {
    const c = b.construct;
    const m = b.entry.meaning as Extract<Meaning, { kind: "admit" }>;
    const exit = c.exit!;
    if (ts.isReturnStatement(exit)) {
      const d = delegateOf(exit, k.env.file);
      if (d && k.ret === ADMITTED) {
        const fnEnv = siteEnv(d.call, k.env, () => newEnv(k.env.file, d.fn, bindParams(d.fn, d.call.arguments, k.env)));
        ctx.trace.push(`${c.file}:${c.line} admit: walks ${fnName(d.fn, k.env.file.sf)}`);
        return this.walk(chain((d.fn.body as ts.Block).statements, fnEnv, ADMITTED, ADMITTED), ctx);
      }
      if (m.enters) return this.enterComponent(exit, m.enters, k, ctx);
      ctx.trace.push(`${c.file}:${c.line} admit: renders`);
      return this.walk(k.ret, ctx);
    }
    if (c.kind === "standalone") {
      // A standalone call that never refuses: it runs and the page goes on.
      ctx.trace.push(`${c.file}:${c.line} admit: the call runs and the page continues`);
      return this.walk(k.next, ctx);
    }
    throw new PageGateError("UNSUPPORTED", `${c.file}:${c.line}: an admit meaning on a ${c.kind}`);
  }

  private enterComponent(exit: ts.ReturnStatement, enters: { file: string; fn: string }, k: Step, ctx: Ctx): boolean {
    let e = exit.expression ? strip(exit.expression) : undefined;
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    if (!e || !(ts.isJsxSelfClosingElement(e) || ts.isJsxElement(e))) throw new PageGateError("UNSUPPORTED", `${k.env.file.file}: admit.enters on a return that is not a component element`);
    const opening = ts.isJsxElement(e) ? e.openingElement : e;
    const tag = opening.tagName.getText(k.env.file.sf);
    const comp = COMPONENTS[tag];
    if (!comp || comp.file !== enters.file || comp.fn !== enters.fn || !importedAs(k.env.file, tag, { [tag]: comp.modules })) {
      throw new PageGateError("UNSUPPORTED", `${k.env.file.file}: <${tag}> is not the bound component ${enters.file}#${enters.fn}`);
    }
    const target = this.load(comp.file);
    const fn = target.a.info.fns.get(comp.fn);
    if (!fn || !fn.body || !ts.isBlock(fn.body)) throw new PageGateError("UNSUPPORTED", `${comp.file}: no ${comp.fn}`);
    const props = new Map<string, Binding>();
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
      const name = attr.name.getText(k.env.file.sf);
      const init = attr.initializer;
      const expr = ts.isJsxExpression(init) ? init.expression : ts.isStringLiteral(init) ? init : undefined;
      if (expr) props.set(name, { kind: "expr", expr, env: k.env });
    }
    const params = new Map<string, Binding>();
    const p = fn.parameters[0];
    if (p && ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const prop = el.propertyName ? el.propertyName.getText(target.a.info.sf) : el.name.text;
        const b = props.get(prop);
        if (b) params.set(el.name.text, b);
      }
    }
    ctx.trace.push(`enters ${comp.file}#${comp.fn}`);
    const env = siteEnv(exit, k.env, () => newEnv(target.a.info, fn, params));
    return this.walk(chain(fn.body.statements, env, ADMITTED, ADMITTED), ctx);
  }

  private redirectTarget(b: Bound, target: string, ctx: Ctx): boolean {
    const [route = "", query = ""] = target.split("?", 2);
    const page = this.pages.get(route);
    if (!page) throw new PageGateError("BAD_REDIRECT_TARGET", `${b.construct.file}:${b.construct.line}: ${target} is not a census page`);
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(query)) params[k] = v === "<S>" ? S : v === "<id>" ? INSTANCE_ID : v;
    ctx.trace.push(`${b.construct.file}:${b.construct.line} success-redirect: evaluates ${route}?${new URLSearchParams(params)}`);
    const saved = ctx.params;
    ctx.params = params;
    try {
      return this.evaluate(page, ctx);
    } finally {
      ctx.params = saved;
    }
  }

  /** A forced arm applies to the request under test only, never to a success-redirect's target request. */
  private forced(b: Bound, ctx: Ctx): Arm | undefined {
    if (ctx.stack.length > 1) return undefined;
    return ctx.forceArm.find((f) => f.file === b.entry.file && b.entry.text.startsWith(f.textStartsWith))?.arm;
  }

  /** An enclosing construct with continuations as K chains. */
  private applyEnclosing(b: Bound, ctx: Ctx, arms: { entered: K; other: K; enteredArm: Arm; otherArm: Arm; cond: boolean | undefined }): boolean {
    return this.applyEnclosingFns(b, ctx, {
      entered: () => this.walk(arms.entered, ctx), other: () => this.walk(arms.other, ctx),
      enteredArm: arms.enteredArm, otherArm: arms.otherArm, cond: arms.cond,
    });
  }

  private applyEnclosingFns(b: Bound, ctx: Ctx, arms: { entered: () => boolean; other: () => boolean; enteredArm: Arm; otherArm: Arm; cond?: boolean | undefined }): boolean {
    const m = b.entry.meaning!;
    const tag = `${b.construct.file}:${b.construct.line} ${b.construct.kind} (${m.kind})`;
    const forced = this.forced(b, ctx);
    let take = { entered: arms.cond !== false, other: arms.cond !== true };
    if (forced) take = { entered: forced === arms.enteredArm, other: forced === arms.otherArm };
    if (m.kind === "operational-error") take = { entered: false, other: true };
    const enteredResult = (): boolean => {
      if (m.kind === "refuse" && whenCond(m.when)!.get(ctx)) { ctx.trace.push(`${tag} refuses in the ${arms.enteredArm} arm: ${m.when}`); return false; }
      if (m.kind === "success-redirect") return this.redirectTarget(b, m.target, ctx);
      return arms.entered();
    };
    if (take.entered && take.other) ctx.trace.push(`${tag}: both arms, must-admit`);
    return (!take.entered || enteredResult()) && (!take.other || arms.other());
  }
}

function lineOf(n: ts.Node): number {
  const sf = n.getSourceFile();
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Census mode (4.4.10): the implemented reader's census IS the reviewed-entry list
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface CensusResult {
  /** One record per construct, in file order: an existing record keeps its meaning; a new one has meaning null. */
  records: ReviewedEntry[];
  unclassified: string[];
  stale: string[];
  ambiguous: string[];
  unreviewed: string[];
  problems: Problem[];
}

/** Run the census over the census files. Never writes or changes a meaning. */
export function runCensus(reader: Reader, files: readonly string[]): CensusResult {
  const records: ReviewedEntry[] = [];
  const problems: Problem[] = [];
  for (const file of files) {
    const { constructs, problems: p, bound } = reader.census(file);
    problems.push(...p);
    const byNode = new Map([...bound.values()].map((b) => [b.construct.node, b.entry]));
    for (const c of constructs) {
      const e = byNode.get(c.node);
      records.push(e
        ? { ...e, line: c.line }
        : { file: c.file, fn: c.fn, anchor: c.anchor, kind: c.kind, line: c.line, text: c.text, meaning: null });
    }
  }
  const pick = (code: PageGateCode) => problems.filter((p) => p.code === code).map((p) => `${p.file}:${p.line ?? "?"} ${p.detail}`);
  return {
    records,
    unclassified: records.filter((r) => r.meaning === null).map((r) => `${r.file}:${r.line} ${r.kind} ${r.text.slice(0, 100)}`),
    stale: [...pick("STALE_ENTRY"), ...pick("ENTRY_TEXT_MISMATCH")],
    ambiguous: pick("AMBIGUOUS_ENTRY"),
    unreviewed: pick("UNREVIEWED_CONSTRUCT"),
    problems,
  };
}

/** The census list: the 84 destination pages' files, the admin layout and PulseHome. */
export const LAYOUT_FILE = "app/admin/layout.tsx";
export const PULSE_HOME_FILE = "components/pulse/PulseHome.tsx";

/** The six switches, and all 64 combinations of them (bit i of the index = SWITCH_NAMES[i]). */
const SWITCH_NAMES: readonly SwitchName[] = ["pulseV2", "vault", "businessReport", "demandSignals", "marketingScorecard", "customerProfiles"];
export const SWITCH_COMBOS: readonly Switches[] = Array.from({ length: 64 }, (_, n) => Object.fromEntries(SWITCH_NAMES.map((s, i) => [s, ((n >> i) & 1) === 1])));

/**
 * The page's answer for one role and facts under all 64 switch combinations. The walk is deterministic in the switch
 * values it READS, so a combination agreeing with an earlier one on every switch that walk read reuses its answer.
 */
export function admitMatrix(reader: Reader, route: string, role: RoleCode, facts?: Facts): boolean[] {
  const seen: { read: Map<SwitchName, boolean>; admitted: boolean }[] = [];
  return SWITCH_COMBOS.map((switches) => {
    const hit = seen.find((s) => [...s.read].every(([k, v]) => (switches[k] === true) === v));
    if (hit) return hit.admitted;
    const v = reader.admits(route, { role, switches, facts });
    seen.push({ read: v.readSwitches, admitted: v.admitted });
    return v.admitted;
  });
}
