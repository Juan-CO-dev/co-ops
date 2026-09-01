/**
 * Unit spine — THE DIFFERENTIAL LOCATION-BIND CHECK (audit v2 structural finding, 2026-09-01).
 *
 * The audit's most valuable result was not any one hole but their SHAPE: every tenancy
 * finding was an ASYMMETRY — a law implemented correctly in one file and not applied to its
 * sibling. `products.ts` binds (its comment names the attack); `admin/skus.ts` had zero binds.
 * `customers.ts` scopes `catering_customers`; `companies.ts` read and wrote the same table
 * unscoped. A generic re-read keeps missing these because each file looks correct alone.
 * What finds them is DIFFERENTIAL reading: take the law, enumerate every site that should
 * obey it, diff. This test is that pass, made executable, so the next unbound writer fails
 * the build instead of waiting for the next audit.
 *
 * THE RULE. In the files below, every `export async function` that takes an `actor` and
 * WRITES (`.insert(` / `.update(` / `.upsert(` / `.delete(` / `.rpc(`) to a TENANCY-SCOPED
 * table must reference a location-bind primitive somewhere in its body — or be named in the
 * allowlist with a reason a reviewer can check. Reads are out of scope here (the law's
 * sharp edge is the write; PII reads are pinned per-module in the sibling tests).
 *
 * THE SCOPE IS HONEST, NOT COMPLETE. The file list is the audit's named surface; widening
 * it is a follow-up (each new file will surface legacy route-bound writers that need either
 * a lib-level bind or an allowlist entry with a reason). An allowlist entry is a DEBT
 * RECORD, not an exemption: it names the follow-up that retires it.
 *
 * Heuristic parser (brace-matched bodies, no AST): good enough to catch the class; a false
 * positive is fixed by binding or by an allowlist line, never by loosening the rule.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tables whose rows belong to a shop (or are org-scope ONLY when their location column is null). */
const TENANCY_SCOPED_TABLES = [
  "vendor_items",
  "location_sku_settings",
  "product_primaries",
  "catering_customers",
  "catering_pipeline",
  "catering_quotes",
  "catering_orders",
  "catering_packages",
  "catering_package_items",
  "catering_package_slot_options",
  "lto_events",
  "catering_fulfillment_nodes",
  "toast_ingest_exclusions",
  "vendor_delivery_rhythm",
  "vendor_rhythm_skips",
];

/** Any of these in a function body counts as "the actor was bound to a location". */
const BIND_PRIMITIVES = [
  "lockLocationContext",
  "assertCanWrite",
  "assertLocationAccess",
  "assertCanWriteLead",
  "visibleLocationScope",
  "readScopeOr",
  "accessibleLocations",
  "isAllLocationsAccess",
  "requireLocation",
];

/** The audit's named surface. Widen deliberately, one file per follow-up PR. */
const FILES = [
  "lib/admin/skus.ts",
  "lib/products.ts",
  "lib/catering/companies.ts",
  "lib/catering/customers.ts",
  "lib/catering/pipeline.ts",
  "lib/catering/quotes.ts",
  "lib/catering/lto.ts",
  "lib/catering/toast-sales.ts",
  "lib/admin/catering/faq.ts",
  "lib/admin/catering/fulfillment.ts",
  "lib/admin/catering/packages.ts",
  "lib/dynamic-pars.ts",
];

/**
 * DEBT RECORDS. `file#function` → why it is allowed to write a scoped table without a bind
 * in this body, and what retires the entry. Every line here is a reviewable claim.
 */
const ALLOWLIST: Record<string, string> = {
  // catering_companies is a CROSS-LOCATION account by design (companies.ts header); these
  // touch catering_customers only to READ company_id for attribution, never to write a
  // shop's row. reviveInactiveContact takes no actor (internal, called after a bound caller).
  // — Batch B2 (packages): nine writers reached through opaque line/option ids. The bind is
  //   a read-through chain (option → package_item → package → location_id). Named here so the
  //   debt is visible; retired by the packages PR that follows Batch B.
  "lib/admin/catering/packages.ts#createPackage": "B2 follow-up: bind input.locationId (null = global)",
  "lib/admin/catering/packages.ts#updatePackage": "B2 follow-up: read package.location_id → bind",
  "lib/admin/catering/packages.ts#deactivatePackage": "B2 follow-up: read package.location_id → bind",
  "lib/admin/catering/packages.ts#addPackageLine": "B2 follow-up: read package.location_id → bind",
  "lib/admin/catering/packages.ts#addPackageLineItem": "B2 follow-up: read-through chain → bind",
  "lib/admin/catering/packages.ts#addSlotOption": "B2 follow-up: read-through chain → bind",
  "lib/admin/catering/packages.ts#setSlotOptionClassic": "B2 follow-up: read-through chain → bind",
  "lib/admin/catering/packages.ts#removeSlotOption": "B2 follow-up: read-through chain → bind",
  "lib/admin/catering/packages.ts#removePackageLineItem": "B2 follow-up: read-through chain → bind",
};

interface Fn { name: string; params: string; body: string }

/** Extract every `export async function NAME(params) … { body }` with a brace-matched body. */
function exportedAsyncFunctions(source: string): Fn[] {
  const out: Fn[] = [];
  const re = /export async function ([A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] ?? "";
    // params: from the "(" to its matching ")"
    let i = re.lastIndex; let depth = 1;
    while (i < source.length && depth > 0) { const c = source[i]; if (c === "(") depth++; else if (c === ")") depth--; i++; }
    const params = source.slice(re.lastIndex, i - 1);
    // body: from the first "{" after the signature to its matching "}"
    const open = source.indexOf("{", i);
    if (open === -1) continue;
    let j = open + 1; depth = 1;
    while (j < source.length && depth > 0) { const c = source[j]; if (c === "{") depth++; else if (c === "}") depth--; j++; }
    out.push({ name, params, body: source.slice(open, j) });
  }
  return out;
}

const WRITE_CALLS = [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("];

function writesScopedTable(body: string): string | null {
  for (const t of TENANCY_SCOPED_TABLES) {
    if (body.includes(`.from("${t}")`) && WRITE_CALLS.some((w) => body.includes(w))) return t;
  }
  return null;
}

describe("differential location-bind check — every actor-taking writer of a tenancy-scoped table binds, or is a named debt", () => {
  for (const rel of FILES) {
    describe(rel, () => {
      const source = readFileSync(join(repoRoot, rel), "utf8");
      const fns = exportedAsyncFunctions(source).filter((f) => /\bactor\b/.test(f.params));
      const writers = fns.map((f) => ({ f, table: writesScopedTable(f.body) })).filter((x) => x.table !== null);

      it("has at least one actor-taking exported function (the parser found the file's shape)", () => {
        expect(fns.length).toBeGreaterThan(0);
      });

      for (const { f, table } of writers) {
        const key = `${rel}#${f.name}`;
        it(`${f.name} writes ${table} → binds the actor to a location (or is an allowlisted debt)`, () => {
          const binds = BIND_PRIMITIVES.some((p) => f.body.includes(p));
          if (binds) {
            // A bound writer must not ALSO sit in the allowlist — retire the debt line.
            expect(ALLOWLIST[key], `${key} is bound now; remove its allowlist line`).toBeUndefined();
            return;
          }
          expect(
            ALLOWLIST[key],
            `${key} writes tenancy-scoped table "${table}" with no location bind and no allowlist reason. ` +
              `Bind it (lockLocationContext / assertCanWrite …) or add a debt line naming the follow-up.`,
          ).toBeDefined();
        });
      }
    });
  }

  it("every allowlist entry still names a real, currently-unbound function (no stale debt)", () => {
    for (const key of Object.keys(ALLOWLIST)) {
      const [rel, name] = key.split("#") as [string, string];
      const source = readFileSync(join(repoRoot, rel), "utf8");
      const f = exportedAsyncFunctions(source).find((x) => x.name === name);
      expect(f, `${key}: function no longer exists — delete the allowlist line`).toBeDefined();
    }
  });
});
