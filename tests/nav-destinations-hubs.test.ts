/**
 * Nav PR 3 (plan r5, 4.10; lead decision 1): the hand-written hub links are CHECKED against the destination list.
 * They are not generated from it in PR 3 (three tests pin the Reports hub's source; PR 13 rewrites that page, PR 10
 * the catering workspace, PR 4 the Back office tiles). Every link names a destination route, and its label key is
 * that destination's name key or one of its surface labels (which guard (b) proves read the same name).
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { byRoute } from "@/lib/nav/destinations";
import type { Destination } from "@/lib/nav/types";

// The link regex of tests/nav-names.test.ts: <Link|a href="/route"...> followed directly by t("key") / serverT(lang, "key").
const LINK = /href=\{?["`](\/[a-z0-9\-/]*?)\/?(?=[?"`#])[^>]*>\s*\{?\s*(?:t|serverT\(\s*[a-zA-Z.]+\s*,\s*)\(?\s*"([a-zA-Z0-9_.-]+)"/g;

/** Labels that are not a destination's name, skipped by name: two counts (statuses: "Shift reports: 12", the vendor mail
 *  health line) and a job ("Open the business report"). */
const NOT_NAMES = new Set(["reports.hub.total", "vendorMail.health", "reports.business.hub_open"]);

const keysOf = (d: Destination) => [d.nameKey, ...Object.values(d.labels ?? {})];

function links(file: string): { route: string; key: string }[] {
  return [...readFileSync(file, "utf8").matchAll(LINK)].map(([, route = "", key = ""]) => ({ route, key })).filter((l) => !NOT_NAMES.has(l.key));
}

/** Every `{ href: "...", titleKey: "..." }` object literal in a file (the catering workspace's cards). */
function cardLiterals(file: string): { route: string; key: string }[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { route: string; key: string }[] = [];
  const prop = (o: ts.ObjectLiteralExpression, name: string) => {
    const p = o.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText(sf) === name) as ts.PropertyAssignment | undefined;
    if (!p) return undefined;
    let e = p.initializer;
    while (ts.isAsExpression(e)) e = e.expression;
    return ts.isStringLiteral(e) ? e.text : undefined;
  };
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const route = prop(n, "href");
      const key = prop(n, "titleKey");
      if (route && key) out.push({ route, key });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const SURFACES: { name: string; file: string; read: (f: string) => { route: string; key: string }[]; atLeast: number }[] = [
  { name: "Reports hub links", file: "app/(authed)/reports/page.tsx", read: links, atLeast: 12 },
  { name: "catering workspace cards", file: "app/(authed)/catering/page.tsx", read: cardLiterals, atLeast: 6 },
  { name: "Back office hand-written tiles", file: "app/admin/page.tsx", read: links, atLeast: 2 },
  { name: "catering setup hand-written cards", file: "app/admin/catering/page.tsx", read: links, atLeast: 2 },
];

describe("4.10 hub parity: hand-written hub links name their destination", () => {
  it.each(SURFACES)("$name: each link's route is a destination and its label is that destination's name", ({ file, read, atLeast }) => {
    const found = read(file);
    expect(found.length, `${file}: the scan is alive`).toBeGreaterThanOrEqual(atLeast);
    const wrong: string[] = [];
    for (const { route, key } of found) {
      const d = byRoute(route);
      if (!d) wrong.push(`${route}: not a destination`);
      else if (!keysOf(d).includes(key as Destination["nameKey"])) wrong.push(`${route}: labelled ${key}, not one of ${keysOf(d).join(", ")}`);
    }
    expect(wrong).toEqual([]);
  });

  it("the Reports hub's links cover the destinations it offers today", () => {
    const routes = new Set(links("app/(authed)/reports/page.tsx").map((l) => l.route));
    for (const route of ["/reports/operations", "/reports/trends/ops", "/reports/written", "/my-feedback", "/reports/trends/team",
      "/reports/sales", "/reports/sales/checks", "/reports/sales/catering", "/operations/counts", "/operations/receiving", "/ordering",
      "/catering/insights", "/admin/sandwiches"]) expect(routes, route).toContain(route);
  });
});
