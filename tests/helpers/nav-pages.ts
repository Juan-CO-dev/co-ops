/**
 * Nav PR 3 (plan r5, 4.1): the page inventory and the short named list of pages that are neither a destination
 * nor a child of one. Shared by guard (a) and guard (c).
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** route pattern → its page file (route groups dropped, [dynamic] kept), as tests/nav-links-resolve.test.ts walks. */
export function pageFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of walk(join(ROOT, "app")).map((f) => relative(ROOT, f).split(sep).join("/"))) {
    if (!/(^|\/)page\.tsx?$/.test(file)) continue;
    const route = "/" + file.replace(/^app\//, "").replace(/(^|\/)page\.tsx?$/, "").split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/");
    out.set(route, file);
  }
  return out;
}

export type NamedCategory = "public" | "planned" | "redirect" | "print";

/** Pages that are not destinations and not children of one, each with its category and reason. */
export const NAMED_PAGES: Readonly<Record<string, { category: NamedCategory; reason: string }>> = {
  "/": { category: "public", reason: "the tile login" },
  "/reset-password": { category: "public", reason: "password reset from an emailed link" },
  "/verify": { category: "public", reason: "email confirmation from an emailed link" },
  "/eat": { category: "public", reason: "the public storefront" },
  "/eat/privacy": { category: "public", reason: "the storefront's privacy page" },
  "/order": { category: "public", reason: "the customer catering order funnel" },
  "/order/account": { category: "public", reason: "the customer order funnel" },
  "/order/build": { category: "public", reason: "the customer order funnel" },
  "/order/quote/[id]": { category: "public", reason: "the customer order funnel" },
  "/order/review": { category: "public", reason: "the customer order funnel" },
  "/order/sign-out-failed": { category: "public", reason: "the customer order funnel" },
  "/order/start": { category: "public", reason: "the customer order funnel" },
  "/order/verify": { category: "public", reason: "the customer order funnel" },
  "/tips": { category: "planned", reason: "spec 7.2: a planned page, in no menu or search" },
  "/announcements": { category: "planned", reason: "spec 7.2: a planned page, in no menu or search" },
  "/recipes": { category: "planned", reason: "spec 7.2: a planned page, in no menu or search" },
  "/feedback": { category: "planned", reason: "spec 7.2: a planned page, in no menu or search" },
  "/deep-cleaning": { category: "planned", reason: "spec 7.2: a planned page, in no menu or search" },
  "/comms": { category: "planned", reason: "spec 7.2: a planned page, in no menu or search" },
  "/written-reports": { category: "redirect", reason: "redirects to /reports/written" },
  "/admin/menu-costing": { category: "redirect", reason: "redirects to /admin/sandwiches (kept by decision)" },
  "/catering/quotes/[id]/label": { category: "print", reason: "a printable quote label" },
};
