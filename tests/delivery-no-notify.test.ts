/**
 * Catering delivery D2 — NOTHING OUTBOUND, as a test (plan r6 section 7), built on the scheduling pin's import walker
 * (tests/fixtures/schedule/no-notify-closure.ts). CO-OPS books no courier, cancels no courier, texts and emails nobody
 * and pays nobody: a person records what happened on the courier's own site.
 *
 *  (a) SINKS. The TRANSITIVE import closure of lib/delivery/**, the delivery routes, the panel, the moved-order list,
 *      the settings card and the settings page reaches no notification / email / SMS / push module and no sending package.
 *  (b) OUTBOUND. Server code (lib/delivery/**, the delivery routes, the settings page) contains NO HTTP call at all
 *      (fetch / axios / http.request / a write-method literal). The client components may call ONLY the reviewed
 *      same-origin relative paths listed LITERALLY below — the delivery routes, the settings route, and the shared
 *      password modal's /api/auth/step-up. An absolute URL, a protocol-relative URL, a path that is not literally one
 *      of these, or a target built from a variable fails. The request helpers they go through are named one by one.
 *  (c) NO PAYROLL (Juan's decision 4: the gratuity split is RECORDED ONLY). The same closure imports no payroll,
 *      tip-pool, tips, payout, Stripe or payment module, and no payment package.
 *  The pin proves itself: a fake sender, an external fetch in the panel and a fake payroll import each turn it RED.
 *
 * D4 (economics): the economics lib files are in `lib/delivery/**` already; the gratuity correction route and the
 * report section (components/reports-hub/DeliveryEconomicsSection.tsx) join the entries. The panel gains ONE reviewed
 * target (POST .../delivery/gratuity). The gratuity split stays RECORDED ONLY: (c) holds over every new file.
 * The Sales catering PAGE that mounts the section is NOT an entry: it is the existing sales report, whose own closure
 * (mid-shift, ordering, the Toast client) is not delivery's. What it takes from delivery is pinned instead: exactly
 * the section and the bounded loader, both scanned here.
 */
import { join, normalize } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  chain, diskReader, importClosure, importSpecifiers, listFiles, outboundViolations, sinkViolations, stripComments, type Closure, type Reader,
} from "./fixtures/schedule/no-notify-closure";

const LIB = listFiles("lib/delivery");
const ROUTES = [...listFiles(join("app", "api", "catering", "pipeline", "[id]", "delivery")), ...listFiles(join("app", "api", "admin", "catering", "delivery"))];
const PAGE = listFiles(join("app", "admin", "catering", "delivery"));
const PANEL = join("components", "catering", "pipeline", "DeliveryPanel.tsx");
const MOVED = join("components", "catering", "pipeline", "DeliveryMovedList.tsx");
const CARD = join("components", "admin", "catering", "DeliverySettings.tsx");
/** D3: the pipeline card's state chip (a client component with no request of its own). */
const CHIP = join("components", "catering", "pipeline", "DeliveryStateChip.tsx");
const CLIENT = [PANEL, MOVED, CARD, CHIP, join("components", "catering", "pipeline", "delivery-format.ts")];
/**
 * D3: the passive surfaces that READ the delivery fact (the day plan, the Dashboard block and "Needs you", mid-shift, the
 * pulse, the pipeline page). They are not delivery modules — their own closures are other features' — so they are not
 * closure entries; what is pinned for them is the delivery code IN them: no request, and only the money-free delivery
 * modules imported (`lib/delivery/day.ts`, `day-shared.ts`, `bounded.ts`, `access-shared.ts`, all inside LIB above).
 */
const D3_READERS = [
  join("lib", "day-plan.ts"), join("lib", "day-plan-shared.ts"), join("lib", "day-plan-load-shared.ts"), join("lib", "midshift.ts"), join("lib", "midshift-shared.ts"),
  join("lib", "pulse", "sections.ts"), join("lib", "pulse", "types.ts"), join("components", "dashboard", "CateringBlock.tsx"), join("components", "dashboard", "NeedsYou.tsx"),
  join("components", "midshift", "CateringToday.tsx"), join("components", "pulse", "sections", "CateringSection.tsx"), join("app", "(authed)", "dashboard", "page.tsx"),
];
/** D4: the report section (a server component): server code, no HTTP call at all. */
const SECTION = join("components", "reports-hub", "DeliveryEconomicsSection.tsx");
const REPORT_PAGE = join("app", "(authed)", "reports", "sales", "catering", "page.tsx");
const SERVER = [...LIB, ...ROUTES, ...PAGE, SECTION];
const DELIVERY = [...SERVER, ...CLIENT];

/**
 * THE reviewed same-origin allowlist: every HTTP target a delivery screen may name, literally. `{}` stands for one
 * interpolated path segment (an id). Nothing else, on any origin.
 */
const HTTP_ALLOWLIST = [
  "/api/catering/pipeline/{}/delivery",
  "/api/catering/pipeline/{}/delivery/{}/status",
  "/api/catering/pipeline/{}/delivery/{}/cost",
  "/api/catering/pipeline/{}/delivery/{}/keep-pickup",
  "/api/catering/pipeline/{}/delivery/gratuity", // D4: recalculate / remove the recorded gratuity split (Tier A)
  "/api/admin/catering/delivery",
  "/api/auth/step-up", // the shared password modal (components/auth/PasswordModal.tsx), the way tests/schedule-no-notify.test.ts reviews it
] as const;
/**
 * Reviewed request helpers: they fetch ONLY the URL their caller passes, and every caller in this closure is scanned
 * below for a literal, allowlisted target. `lib/bounded-fetch.ts` is the password modal's deadline wrapper.
 */
const HTTP_WRAPPERS = [join("components", "admin", "vendors", "shared.ts"), join("components", "admin", "useStepUpPost.ts"), join("lib", "bounded-fetch.ts")].map((p) => normalize(p));
/** The calls that make a request, by the name they are called through. */
const HTTP_CALLS = new Set(["fetch", "post", "postJson", "fetchStatusWithin", "sendBeacon", "axios", "request", "get", "put", "patch", "delete"]);
const HTTP_CALL_OBJECTS = new Set(["axios", "http", "https", "navigator", "window", "globalThis", "self"]);

/** Every HTTP target the source names, in order: a literal path (interpolations as `{}`), or `<dynamic>` for anything else. */
function httpTargets(src: string, path = "x.tsx"): string[] {
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const out: string[] = [];
  const target = (arg: ts.Expression | undefined): string => {
    if (!arg) return "<none>";
    if (ts.isStringLiteralLike(arg)) return arg.text;
    if (ts.isTemplateExpression(arg)) return arg.head.text + arg.templateSpans.map((s) => `{}${s.literal.text}`).join("");
    return "<dynamic>";
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && HTTP_CALLS.has(callee.text) && callee.text !== "get" && callee.text !== "request" && callee.text !== "put" && callee.text !== "patch" && callee.text !== "delete") {
        out.push(target(n.arguments[0]));
      } else if (ts.isPropertyAccessExpression(callee) && HTTP_CALLS.has(callee.name.text) && ts.isIdentifier(callee.expression) && HTTP_CALL_OBJECTS.has(callee.expression.text)) {
        out.push(target(n.arguments[0]));
      }
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && ["XMLHttpRequest", "WebSocket", "EventSource"].includes(n.expression.text)) {
      out.push("<dynamic>");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
/** Any absolute or protocol-relative URL written in the code (strings and templates; comments are not code). */
function absoluteUrls(src: string, path = "x.tsx"): string[] {
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  const out: string[] = [];
  const check = (text: string) => { if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim()) || text.trim().startsWith("//")) out.push(text); };
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n)) check(n.text);
    else if (ts.isTemplateExpression(n)) check(n.head.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** (b) for the client side: every request a non-wrapper file of the closure names is a literal on the allowlist. */
function clientOutboundViolations(closure: Closure, read: Reader = diskReader): string[] {
  const out: string[] = [];
  const server = new Set(SERVER.map((f) => normalize(f)));
  for (const f of closure.files) {
    if (server.has(f)) continue;
    const src = read(f);
    if (src === null) continue;
    const wrapper = HTTP_WRAPPERS.includes(f);
    for (const t of httpTargets(src, f)) {
      if (wrapper && t === "<dynamic>") continue;
      if (!(HTTP_ALLOWLIST as readonly string[]).includes(t)) out.push(`${f}: ${t}`);
    }
    if (CLIENT.map((c) => normalize(c)).includes(f)) for (const url of absoluteUrls(src, f)) out.push(`${f}: absolute URL ${url}`);
  }
  return out.sort();
}

/** (c) Modules and packages that pay, pool or run payroll. */
const PAY_PATH = /(^|[\\/_.-])(payroll\w*|tip-?pools?\w*|tips?|payouts?\w*|stripe\w*|payments?\w*|paychecks?\w*|wages?\w*)([\\/._-]|$)/i;
const PAY_PACKAGES = ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js", "square", "@adyen/api-library", "braintree", "plaid", "gusto", "@paypal/checkout-server-sdk"];
function payViolations(c: Closure, entries: readonly string[]): string[] {
  const out: string[] = [];
  const entrySet = new Set(entries.map((e) => normalize(e)));
  for (const f of c.files) if (!entrySet.has(f) && PAY_PATH.test(f.replace(/\.(ts|tsx)$/, ""))) out.push(`pay module reached: ${chain(c, f)}`);
  for (const [pkg, from] of c.packages) if (PAY_PACKAGES.includes(pkg)) out.push(`pay package ${pkg}: ${chain(c, from)}`);
  return out.sort();
}

const overlay = (over: Record<string, string>): Reader => (p) => over[p] ?? diskReader(p);
const withLine = (f: string, line: string) => ({ [f]: `${line}\n${diskReader(f)!}` });
const ROUTE = ROUTES.find((f) => f.endsWith(join("status", "route.ts")))!;
const LIB_FILE = join("lib", "delivery", "jobs.ts");

describe("catering delivery: the scope is real", () => {
  it("covers the lib, all six route files, the page, the three screens, and D4's report section and page", () => {
    expect(LIB.length).toBeGreaterThanOrEqual(15);
    expect(LIB).toContain(LIB_FILE);
    for (const d4 of ["economics.ts", "economics-shared.ts"]) expect(LIB).toContain(join("lib", "delivery", d4));
    expect(ROUTES).toHaveLength(6);
    expect(ROUTES).toContain(join("app", "api", "catering", "pipeline", "[id]", "delivery", "gratuity", "route.ts"));
    expect(PAGE).toHaveLength(1);
    for (const f of DELIVERY) expect(diskReader(f), f).not.toBeNull();
    const c = importClosure(DELIVERY);
    expect(c.files.size).toBeGreaterThan(DELIVERY.length + 20); // it really walked past the entries
    for (const reached of [join("lib", "session.ts"), join("components", "auth", "PasswordModal.tsx"), join("lib", "supabase-server.ts")]) expect(c.files.has(reached), reached).toBe(true);
  });
});

describe("D3: the status wiring is inside the pin", () => {
  it("the day fact, its bound and the chip are closure entries (lib/delivery/** and the client list)", () => {
    for (const f of [join("lib", "delivery", "day.ts"), join("lib", "delivery", "day-shared.ts"), join("lib", "delivery", "bounded.ts")]) expect(LIB, f).toContain(f);
    expect(CLIENT).toContain(CHIP);
    expect(httpTargets(diskReader(CHIP)!, CHIP)).toEqual([]);
    expect(absoluteUrls(diskReader(CHIP)!, CHIP)).toEqual([]);
  });
  it("the passive readers hold no request, and import from lib/delivery only the money-free modules", () => {
    const MONEY_FREE = ["@/lib/delivery/day", "@/lib/delivery/day-shared", "@/lib/delivery/bounded", "@/lib/delivery/access-shared"];
    for (const f of D3_READERS) {
      const src = diskReader(f);
      expect(src, f).not.toBeNull();
      expect([f, httpTargets(src!, f)]).toEqual([f, []]);
      const delivery = importSpecifiers(src!, f).filter((s) => s.startsWith("@/lib/delivery"));
      for (const s of delivery) expect(MONEY_FREE, `${f} imports ${s}`).toContain(s);
      expect(stripComments(src!), f).not.toMatch(/lib\/delivery\/(jobs|cost-shared|gratuity-shared|settings)"/);
    }
    // They do read it: the list is not vacuous.
    expect(D3_READERS.filter((f) => importSpecifiers(diskReader(f)!, f).some((s) => s.startsWith("@/lib/delivery"))).length).toBeGreaterThanOrEqual(8);
  });
  it("MUTATION: a request or a cost import in a passive reader turns it red", () => {
    const f = join("lib", "midshift.ts");
    expect(httpTargets(`void fetch("https://courier.example.invalid/eta");\n${diskReader(f)!}`, f)).toEqual(["https://courier.example.invalid/eta"]);
    expect(importSpecifiers(`import { orderCost } from "@/lib/delivery/cost-shared";\n${diskReader(f)!}`, f)).toContain("@/lib/delivery/cost-shared");
  });
});

describe("D4: what the Sales catering page takes from delivery", () => {
  it("exactly the report section and the bounded economics loader, both inside the scanned closure", () => {
    const specs = importSpecifiers(diskReader(REPORT_PAGE)!, REPORT_PAGE).filter((spec) => /deliver/i.test(spec)).sort();
    expect(specs).toEqual(["@/components/reports-hub/DeliveryEconomicsSection", "@/lib/delivery/economics"]);
    const c = importClosure(DELIVERY);
    for (const f of [SECTION, join("lib", "delivery", "economics.ts"), join("lib", "delivery", "economics-shared.ts")]) expect(c.files.has(normalize(f)), f).toBe(true);
  });
});

describe("(a) no notification, email, SMS or push: the transitive closure reaches no sink", () => {
  it("green on the real tree", () => {
    expect(sinkViolations(importClosure(DELIVERY), DELIVERY)).toEqual([]);
    for (const f of DELIVERY) expect(stripComments(diskReader(f)!), f).not.toMatch(/@\/lib\/notifications|@\/lib\/email|enqueueNotification|sendEmail\(|JOBS_REGISTRY/);
  });
  it("MUTATION: a fake sender imported from a route, the lib or the panel turns it red — directly, transitively, and by a channel-named path", () => {
    for (const target of [ROUTE, LIB_FILE, PANEL]) {
      for (const line of ['import { enqueueNotification } from "@/lib/notifications";', 'import { sendEmail } from "@/lib/email";', 'import { sendPoSms } from "@/lib/po-sms";',
        'import { Resend } from "resend";', 'import twilio from "twilio";', 'const sender = import ("@/lib/po-sms");']) {
        expect(sinkViolations(importClosure(DELIVERY, overlay(withLine(target, line))), DELIVERY).length, `${target} + ${line}`).toBeGreaterThan(0);
      }
    }
    const helper = join("lib", "zz-innocent-helper.ts"), sender = join("lib", "zz-courier-alerts.ts");
    const transitive = { ...withLine(ROUTE, 'import { helper } from "@/lib/zz-innocent-helper";'),
      [helper]: 'import { alertCourier } from "./zz-courier-alerts";\nexport const helper = () => alertCourier();\n',
      [sender]: 'import { sendEmail } from "@/lib/email";\nexport const alertCourier = () => sendEmail();\n' };
    expect(sinkViolations(importClosure(DELIVERY, overlay(transitive)), DELIVERY).some((v) => v.includes("zz-innocent-helper"))).toBe(true);
    const named = { ...withLine(LIB_FILE, 'import { x } from "@/lib/delivery-sms";'), [join("lib", "delivery-sms.ts")]: "export const x = 1;\n" };
    expect(sinkViolations(importClosure(DELIVERY, overlay(named)), DELIVERY).length).toBeGreaterThan(0);
  });
});

describe("(b) nothing outbound: server code makes no HTTP call; the screens call only the reviewed same-origin paths", () => {
  it("server code (lib/delivery, the routes, the settings page): no HTTP call at all", () => {
    expect(SERVER.length).toBeGreaterThanOrEqual(23);
    expect(outboundViolations(SERVER)).toEqual([]);
    for (const f of SERVER) expect([f, httpTargets(diskReader(f)!, f)]).toEqual([f, []]);
  });
  it("the screens name exactly these targets, each literally on the allowlist", () => {
    const targets = (f: string) => [...new Set(httpTargets(diskReader(f)!, f))].sort();
    expect(targets(PANEL)).toEqual(["/api/catering/pipeline/{}/delivery", "/api/catering/pipeline/{}/delivery/gratuity", "/api/catering/pipeline/{}/delivery/{}/cost",
      "/api/catering/pipeline/{}/delivery/{}/keep-pickup", "/api/catering/pipeline/{}/delivery/{}/status"].sort());
    expect(targets(SECTION)).toEqual([]);
    expect(targets(MOVED)).toEqual(["/api/catering/pipeline/{}/delivery"]);
    expect(targets(CARD)).toEqual(["/api/admin/catering/delivery"]);
    expect(targets(join("components", "auth", "PasswordModal.tsx"))).toEqual(["/api/auth/step-up"]);
    for (const path of HTTP_ALLOWLIST) expect(path).toMatch(/^\/api\/(catering\/pipeline\/\{\}\/delivery(\/\{\}\/(status|cost|keep-pickup)|\/gratuity)?|admin\/catering\/delivery|auth\/step-up)$/);
  });
  it("across the whole closure: every request is an allowlisted literal, and the files that hold an HTTP call are exactly the reviewed ones", () => {
    const c = importClosure(DELIVERY);
    expect(clientOutboundViolations(c)).toEqual([]);
    // The files of the closure that hold a raw HTTP call (the scheduling pin's scan): the two screens that read, the
    // password modal, and the two reviewed helpers. The settings card and the panel's writes go through `post`.
    expect(outboundViolations([...c.files])).toEqual([PANEL, MOVED, join("components", "admin", "vendors", "shared.ts"), join("lib", "bounded-fetch.ts"),
      join("components", "auth", "PasswordModal.tsx")].map((p) => normalize(p)).sort());
    // And by the syntax-aware scan: who names a request target at all.
    const callers = [...c.files].filter((f) => !SERVER.map((x) => normalize(x)).includes(f) && httpTargets(diskReader(f)!, f).length > 0).sort();
    expect(callers).toEqual([PANEL, MOVED, CARD, ...HTTP_WRAPPERS, join("components", "auth", "PasswordModal.tsx")].map((p) => normalize(p)).sort());
  });
  it("MUTATION: an external fetch in the panel turns it red — absolute, protocol-relative, unlisted, built from a variable, or through the post helper", () => {
    for (const line of [
      'void fetch("https://courier.example.invalid/book");',
      'void fetch("//courier.example.invalid/book");',
      'void fetch("/api/catering/pipeline/x/transfer");',
      'void fetch(`${process.env.NEXT_PUBLIC_COURIER}/api/catering/pipeline/1/delivery`);',
      'const anywhere = "/api/x"; void fetch(anywhere);',
      'declare const post: (u: string, b: unknown) => void; post("https://courier.example.invalid/book", {});',
      'void navigator.sendBeacon("https://courier.example.invalid/ping");',
      'new WebSocket("wss://courier.example.invalid");',
      'export const tracking = "https://courier.example.invalid/track";',
    ]) {
      for (const target of [PANEL, MOVED, CARD]) {
        expect(clientOutboundViolations(importClosure(DELIVERY, overlay(withLine(target, line))), overlay(withLine(target, line))).length, `${target} + ${line}`).toBeGreaterThan(0);
      }
    }
    // A comment that merely mentions a URL or fetch stays green (prose is allowed), and so does an allowlisted call.
    for (const line of ["// never fetch(\"https://courier.example.invalid\") from here", 'void fetch(`/api/catering/pipeline/${"x"}/delivery`);']) {
      expect(clientOutboundViolations(importClosure(DELIVERY, overlay(withLine(PANEL, line))), overlay(withLine(PANEL, line)))).toEqual([]);
    }
  });
  it("MUTATION: any HTTP call in server code turns it red, even a same-origin one", () => {
    for (const target of [ROUTE, LIB_FILE, PAGE[0]!]) {
      for (const line of ['void fetch("https://courier.example.invalid/book", { method: "POST" });', 'void fetch("/api/catering/pipeline");', 'export const opts = { method: "POST" };']) {
        expect(outboundViolations(SERVER, overlay(withLine(target, line))), `${target} + ${line}`).toContain(target);
      }
    }
    expect(outboundViolations(SERVER, overlay(withLine(ROUTE, "// never fetch( anything here")))).toEqual([]);
  });
});

describe("(c) recorded only: no payroll, tip-pool, payout, Stripe or payment module anywhere in the closure", () => {
  it("green on the real tree", () => {
    const c = importClosure(DELIVERY);
    expect(payViolations(c, DELIVERY)).toEqual([]);
    for (const f of DELIVERY) for (const spec of importSpecifiers(diskReader(f)!, f)) expect([f, spec, PAY_PATH.test(spec) || PAY_PACKAGES.includes(spec)]).toEqual([f, spec, false]);
  });
  it("the rule knows what it is looking for", () => {
    for (const hit of ["lib/payroll.ts", "lib/tip-pool.ts", "lib/tips/pool.ts", "lib/stripe/webhook.ts", "lib/catering/payments.ts", "lib/payouts-shared.ts", "lib/labor/wages.ts"]) expect([hit, PAY_PATH.test(hit.replace(/\.ts$/, ""))]).toEqual([hit, true]);
    for (const miss of ["lib/delivery/gratuity-shared.ts", "lib/delivery/cost-shared.ts", "lib/session.ts", "lib/catering/pipeline-shared.ts", "lib/i18n/format.ts"]) expect([miss, PAY_PATH.test(miss.replace(/\.ts$/, ""))]).toEqual([miss, false]);
  });
  it("MUTATION: a fake payroll import in the lib, a route or the panel turns it red — a module, a package, and a transitive one", () => {
    for (const target of [LIB_FILE, ROUTE, PANEL, join("lib", "delivery", "economics.ts"), join("lib", "delivery", "economics-shared.ts"), SECTION,
      ROUTES.find((f) => f.endsWith(join("gratuity", "route.ts")))!]) {
      const cases: Array<[string, Record<string, string>]> = [
        ['import { runPayroll } from "@/lib/payroll";', { [join("lib", "payroll.ts")]: "export const runPayroll = () => 1;\n" }],
        ['import { addToPool } from "@/lib/tip-pool";', { [join("lib", "tip-pool.ts")]: "export const addToPool = () => 1;\n" }],
        ['import Stripe from "stripe";', {}],
        ['import { charge } from "@/lib/zz-settle";', { [join("lib", "zz-settle.ts")]: 'import { pay } from "./zz-driver-payouts";\nexport const charge = () => pay();\n', [join("lib", "zz-driver-payouts.ts")]: "export const pay = () => 1;\n" }],
      ];
      for (const [line, extra] of cases) {
        const read = overlay({ ...withLine(target, line), ...extra });
        expect(payViolations(importClosure(DELIVERY, read), DELIVERY).length, `${target} + ${line}`).toBeGreaterThan(0);
      }
    }
    // The existing Stripe module is refused by its real path too.
    expect(payViolations(importClosure(DELIVERY, overlay(withLine(LIB_FILE, 'import { x } from "@/lib/stripe/webhook";'))), DELIVERY).length).toBeGreaterThan(0);
  });
});
