/**
 * Unit spine — THE FLAGS-LEDGER CLEANUP ARC.
 *
 * One file for the arc's smaller guarantees, each of which is a SHAPE rather than a
 * return value: a query that carries a scope, a floor that is a shared constant rather
 * than a coincidence of two literals, a mean that is bounded, a refusal that is typed.
 *
 * The two idioms here are the house pair, and which one each guarantee gets is decided by
 * whether the property is reachable without I/O:
 *   · BEHAVIOURAL, where the guard precedes every round trip — `listLtoEvents` binds the
 *     location before it ever asks for a client, so a single-shop actor naming the other
 *     store throws `forbidden` with no database anywhere near it. Same construction as
 *     tests/catering-authz.test.ts.
 *   · SOURCE ASSERTION, where the property lives in the shape of a query or the order of
 *     statements — the fallback tests/pm-report-submit-guard.test.ts and
 *     tests/loader-scale-ceilings.test.ts already use. No assertion over a module's
 *     exports can see that a select carries an `.or(...)`, or that a guard sits ahead of
 *     an insert.
 *
 * The repo-wide step-up tier map is big enough to own a file: tests/step-up-tier-map.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { listLtoEvents } from "@/lib/catering/lto";
import { MENU_PRICE_MIN } from "@/lib/recipes-shared";
import { lockLocationContext } from "@/lib/locations";
import { getRoleLevel } from "@/lib/roles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (rel: string): string => readFileSync(join(ROOT, ...rel.split("/")), "utf8");

/** Extract one function's body, so a match can't come from a sibling or a comment. */
function bodyOf(src: string, marker: string, end = "\n}"): string {
  const start = src.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const stop = src.indexOf(end, start);
  return src.slice(start, stop === -1 ? undefined : stop);
}

const LOCATION_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_B = "22222222-2222-4222-8222-222222222222";

/** A level-6 catering manager holding shop A only. */
const cateringMgrAtA = {
  user: { id: "u1", role: "catering_mgr" as const, language: "en" as const },
  locations: [LOCATION_A],
};
/** Level 9 carries the all-locations grant with an EMPTY assignment list. */
const ownerAnywhere = {
  role: "owner" as const,
  locations: [] as string[],
};

type LtoActor = Parameters<typeof listLtoEvents>[0];

// ─────────────────────────────────────────────────────────────────────────────
// 1. The shared catering location loader is scoped, and listLtoEvents is bound.
// ─────────────────────────────────────────────────────────────────────────────

describe("listLtoEvents — the READ is location-bound (the deferred half of lto.ts:94)", () => {
  it("refuses a shop the actor does not hold, BEFORE any I/O", async () => {
    // The bind sits ahead of getServiceRoleClient(), so this rejects without a database.
    await expect(
      listLtoEvents(cateringMgrAtA as unknown as LtoActor, {
        locationId: LOCATION_B,
        activeOnly: true,
      }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("is a 403, not a silent empty list — 'not your board' is not 'no directives'", async () => {
    // An empty array would be indistinguishable from a shop with no live LTOs, which is
    // the failure mode that let the gap sit unnoticed in the first place.
    await expect(
      listLtoEvents(cateringMgrAtA as unknown as LtoActor, {
        locationId: LOCATION_B,
        activeOnly: false,
      }),
    ).rejects.toThrow();
  });

  it("the premise holds: the read floor is below the all-locations grant", () => {
    // LTO_READ_MIN is 5 and lockLocationContext grants all-locations at 9. If a renumber
    // ever lifted catering_mgr to 9 this bind would become a no-op and the tests above
    // would pass while asserting nothing.
    expect(getRoleLevel("catering_mgr")).toBe(6);
    expect(getRoleLevel("owner")).toBe(9);
  });

  it("the GRANT half is real — level 9 passes the same bind, with no assignments", () => {
    // Asserted on the pure predicate rather than by calling listLtoEvents: a permitted
    // call would run straight into I/O, and this spine does not touch a database.
    expect(lockLocationContext(ownerAnywhere, LOCATION_B)).toBe(true);
    expect(lockLocationContext({ role: "catering_mgr", locations: [LOCATION_A] }, LOCATION_B)).toBe(
      false,
    );
  });

  it("the stale in-code comment naming the blocker is gone", () => {
    // lto.ts used to document the gap and its dependency ("adding the bind here alone
    // would break two live pages"). That dependency is resolved; the comment must not
    // outlive it, or the next reader re-defers a fix that already landed.
    const src = srcOf("lib/catering/lto.ts");
    expect(src).not.toContain("KNOWN, DELIBERATE GAP");
    expect(bodyOf(src, "export async function listLtoEvents")).toContain("lockLocationContext");
  });
});

describe("loadPackageLocations — the tenant's shared catering location list is scoped", () => {
  const body = () =>
    bodyOf(srcOf("lib/admin/catering/packages.ts"), "export async function loadPackageLocations");

  it("filters the active-locations read through visibleLocationScope", () => {
    // Five surfaces ITERATE this list and issue a per-location read off it (both LTO
    // boards, the packages editor, the catering hub's surplus badge, prep-demand), so an
    // unscoped return was not a cosmetic over-offer.
    expect(body()).toContain("visibleLocationScope(actor)");
    expect(body()).toContain("scope.includes(l.id)");
  });

  it("returns everything unfiltered at the all-locations grant", () => {
    // visibleLocationScope returns null at >= 9; that branch must short-circuit.
    expect(body()).toContain("if (scope === null) return data ?? []");
  });
});

describe("the FAQ editor — rows and picker both scoped, GLOBAL lane untouched", () => {
  const src = () => srcOf("lib/admin/catering/faq.ts");

  it("loadFaqs scopes rows to own-locations OR global, the loadPackages spelling", () => {
    const body = bodyOf(src(), "export async function loadFaqs");
    expect(body).toContain("location_id.in.(${idList}),location_id.is.null");
    expect(body).toContain("visibleLocationScope(actor)");
  });

  it("an actor with NO assignments still sees the global rows", () => {
    // The empty-list branch must narrow to globals, never to "no filter at all".
    expect(bodyOf(src(), "export async function loadFaqs")).toContain(
      'query.is("location_id", null)',
    );
  });

  it("loadFaqLocations filters the picker by lockLocationContext", () => {
    expect(bodyOf(src(), "export async function loadFaqLocations")).toContain(
      "lockLocationContext(actorLoc(actor), l.id)",
    );
  });

  it("assertFaqLocationWritable still returns early on a NULL location", () => {
    // JUAN RULED 2026-08-29 that global FAQ authoring stays at level 6. Scoping the
    // picker must not touch that: FaqForm carries its own Global sentinel independently
    // of this list, and the write bind exempts a null location_id.
    expect(bodyOf(src(), "function assertFaqLocationWritable")).toContain(
      "if (locationId === null) return;",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. setCustomerActive / editCustomer are 23505-safe.
// ─────────────────────────────────────────────────────────────────────────────

describe("catering customers — a claimed email is a 409, not an unhandled 500", () => {
  const src = () => srcOf("lib/catering/customers.ts");

  it("setCustomerActive maps the unique violation before its generic throw", () => {
    const body = bodyOf(src(), "export async function setCustomerActive");
    const mapped = body.indexOf("PG_UNIQUE_VIOLATION");
    const generic = body.indexOf("throw new Error(`setCustomerActive update:");
    expect(mapped).toBeGreaterThan(-1);
    // Order is the whole point: a generic throw placed first would swallow the 409.
    expect(mapped).toBeLessThan(generic);
    expect(body).toContain('"email_taken"');
    expect(body).toContain("409");
  });

  it("editCustomer maps it too — the other way a row enters the constrained set", () => {
    const body = bodyOf(src(), "export async function editCustomer");
    expect(body).toContain("PG_UNIQUE_VIOLATION");
    expect(body).toContain('"email_taken"');
  });

  it("the code is renderable — the client resolver knows it and both languages have it", () => {
    // Without the KNOWN_ERROR_CODES entry the operator gets the generic "something went
    // wrong" and no hint that the remedy is a human one.
    expect(srcOf("components/catering/customers/shared.ts")).toContain('"email_taken"');
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(srcOf(`lib/i18n/${lang}.json`)) as Record<string, string>;
      expect(dict["catering.customers.error.email_taken"]).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. pm-report content writers refuse a submitted report.
// ─────────────────────────────────────────────────────────────────────────────

describe("pm-report — an eval or an MVP cannot be written into a submitted report", () => {
  const src = () => srcOf("lib/pm-report.ts");

  it("setMvp carries the guard IN the UPDATE and checks the rowcount", () => {
    // AGENTS.md § Database & RLS: "UPDATE denials are silent (UPDATE 0, no error). Every
    // UPDATE route must check rowcount." Without the count check the filtered UPDATE
    // would be un-observable and the client would render "Saved".
    const body = bodyOf(src(), "export async function setMvp");
    expect(body).toContain('.eq("status", "open")');
    expect(body).toContain('{ count: "exact" }');
    expect(body).toContain("const { error, count }");
    expect(body).toContain("if (count === 0) refuseClosedReport");
  });

  it("saveEmployeeEval checks status ahead of BOTH of its writes", () => {
    const body = bodyOf(src(), "export async function saveEmployeeEval");
    const guard = body.indexOf('if (status !== "open") refuseClosedReport(status)');
    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf("superseded_at")).toBeGreaterThan(guard);
    expect(body.indexOf(".insert({")).toBeGreaterThan(guard);
  });

  it("the refusal distinguishes a missing report from a closed one", () => {
    const body = bodyOf(src(), "function refuseClosedReport", "\n}");
    expect(body).toContain('PmReportError(404, "not_found"');
    expect(body).toMatch(/PmReportError\(\s*409,\s*"report_already_submitted"/);
  });

  it("the route answers 409 rather than letting it fall into the 500 catch-all", () => {
    const route = srcOf("app/api/pm-report/route.ts");
    // Both content actions, and the typed branch must precede the console.error catch-all.
    for (const action of ["save_eval", "set_mvp"]) {
      const arm = route.slice(route.indexOf(`b.action === "${action}"`));
      const typed = arm.indexOf("err instanceof PmReportError");
      const generic = arm.indexOf('jsonError(500, "internal_error"');
      expect(typed, action).toBeGreaterThan(-1);
      expect(typed, action).toBeLessThan(generic);
    }
  });

  it("the client can name the refusal, in both languages", () => {
    const client = srcOf("app/(authed)/pm-report/pm-report-client.tsx");
    expect(client).toContain("report_already_submitted");
    // The MVP card had no message slot at all before this arc.
    expect(client).toContain("mvpError");
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(srcOf(`lib/i18n/${lang}.json`)) as Record<string, string>;
      expect(dict["pm.error.already_submitted"]).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. items.menu_price has ONE floor, shared by both of its writers.
// ─────────────────────────────────────────────────────────────────────────────

describe("menu_price — two writers, one floor, and no coincidence of literals", () => {
  it("MENU_PRICE_MIN is 8 and both writers import it rather than spelling a number", () => {
    expect(MENU_PRICE_MIN).toBe(8);
    expect(srcOf("lib/recipes.ts")).toContain("MENU_PRICE_MIN");
    expect(srcOf("lib/admin/templates.ts")).toContain(
      'import { MENU_PRICE_MIN } from "@/lib/recipes-shared"',
    );
  });

  it("updateRegistryItemDefinition gates the field on MENU_PRICE_MIN", () => {
    const body = bodyOf(
      srcOf("lib/admin/templates.ts"),
      "export async function updateRegistryItemDefinition",
      "\n  const { data: item, error: rErr }",
    );
    expect(body).toContain("if (args.menuPrice != null)");
    expect(body).toContain("ROLES[actor.user.role].level < MENU_PRICE_MIN");
  });

  it("the predicate matches lib/recipes.ts exactly — `!= null`, not `!== undefined`", () => {
    // The clearing-skips-the-check asymmetry is a documented authorization decision of the
    // recipes cluster (PR #298). Aligning means adopting it, not silently tightening one
    // of the two writers — which would 403 a level-7 client that merely SENDS the field.
    expect(srcOf("lib/recipes.ts")).toContain(
      "if (input.menuPrice != null) requireLevel(actor, MENU_PRICE_MIN)",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The invoice-weight fold is bounded, and mirrors its stated precedent.
// ─────────────────────────────────────────────────────────────────────────────

describe("receiving — the observed-oz mean is bounded to a trailing window", () => {
  it("the window equals lib/weights.ts's USAGE_WINDOW_DAYS", () => {
    // The value is MIRRORED, not imported (lib/weights.ts is a heavy server-only board
    // module and this is the 6 AM receiving path), so the mirror needs a drift guard or
    // the two silently diverge.
    const receiving = /const OBSERVED_FOLD_WINDOW_DAYS = (\d+);/.exec(srcOf("lib/receiving.ts"));
    const weights = /export const USAGE_WINDOW_DAYS = (\d+);/.exec(srcOf("lib/weights.ts"));
    expect(receiving?.[1]).toBeDefined();
    expect(weights?.[1]).toBeDefined();
    expect(receiving?.[1]).toBe(weights?.[1]);
    expect(Number(weights?.[1])).toBe(30);
  });

  it("the fold's observation query carries the date bound", () => {
    const body = bodyOf(srcOf("lib/receiving.ts"), "export async function recordDelivery");
    expect(body).toContain('.gte("created_at", foldWindowStart)');
    // The bound must sit on the observation read, not on the line insert above it.
    expect(body.indexOf("foldWindowStart")).toBeGreaterThan(
      body.indexOf('.not("observed_oz_per_each", "is", null)') - 400,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The degraded lockout path counts nothing and decides honestly.
// ─────────────────────────────────────────────────────────────────────────────

describe("auth-flows — a broken counter RPC no longer abandons the lock decision", () => {
  const body = () =>
    bodyOf(srcOf("lib/auth-flows.ts"), "export async function recordFailedAttempt");

  it("the fallback READS the counter and never writes it", () => {
    // The RPC exists because a caller-side read-modify-write undercounted under
    // concurrency. A fallback that re-introduced that write would undo the fix it is
    // standing in for, so the derived value is a decision input only.
    const b = body();
    expect(b).toContain('.select("failed_login_count")');
    expect(b).toContain("derivedCount = storedCount === null ? null : storedCount + 1");
    // No UPDATE of the counter anywhere in this function — the read is a select and a
    // type annotation, never a write. (`persistLockout` writes locked_until only.)
    expect(b).not.toContain(".update({ failed_login_count");
    expect(b).not.toMatch(/update\([^)]*failed_login_count\s*:/);
  });

  it("the decision uses the derived lower bound, not the abandoned zero", () => {
    const b = body();
    expect(b).toContain("const decisionCount = counterError ? (derivedCount ?? 0) : newCount;");
    expect(b).toContain("if (decisionCount >= FAILURE_LIMIT)");
  });

  it("still never CLAIMS a counted attempt number on the degraded path", () => {
    // The audit row must stay distinguishable: counter_error instead of a fabricated
    // attempt_number of 0, which reads as "first attempt" in the trail.
    const b = body();
    expect(b).toContain("counter_error: true,");
    expect(b).toContain("newCount = 0;");
    expect(b).not.toContain("attempt_number: derivedCount");
  });

  it("names a distinguishable OUTCOME on both audit rows it can reach", () => {
    // The failure row AND the lockout row — a lock decided off the degraded lower bound
    // is a real lock, and `failed_count: 0` beside it would otherwise read as a bug.
    const b = body();
    expect((b.match(/outcome: "lockout_count_degraded"/g) ?? []).length).toBe(2);
    expect(b).toContain("stored_failed_login_count: degradedStoredCount");
    expect(b).toContain("decision_count: derivedCount");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The two gated migrations are authored, marked, and not wired.
// ─────────────────────────────────────────────────────────────────────────────

describe("0187 / 0188 — authored, gated, and NOT called by shipped code", () => {
  it("both carry the house NOT-YET-APPLIED gate line on line 2", () => {
    for (const f of [
      "supabase/migrations/0187_one_active_producer_backstop.sql",
      "supabase/migrations/0188_cash_report_atomic_supersede.sql",
    ]) {
      const line2 = srcOf(f).split("\n")[1] ?? "";
      expect(line2, f).toMatch(/^-- AUTHORED \d{4}-\d{2}-\d{2}\. NOT YET APPLIED — GATE \(LEAD\/JUAN\)\.$/);
    }
  });

  it("both re-assert the REVOKE-FROM-PUBLIC posture, including anon", () => {
    // AGENTS.md: Supabase's default ACLs grant EXECUTE to anon EXPLICITLY, so revoking
    // from public alone is not enough.
    for (const f of [
      "supabase/migrations/0187_one_active_producer_backstop.sql",
      "supabase/migrations/0188_cash_report_atomic_supersede.sql",
    ]) {
      const src = srcOf(f).toLowerCase();
      expect(src, f).toContain("from anon");
      expect(src, f).toContain("from authenticated");
      expect(src, f).toContain("to service_role");
    }
  });

  it("no shipped code calls either new RPC — an unapplied function has no callers", () => {
    // A CALL, not a mention: both files name the new functions in comments that explain
    // why the wiring is deferred, and a comment is exactly what should survive here.
    for (const rpc of ["add_recipe_output", "submit_cash_report_atomic"]) {
      for (const f of ["lib/recipes.ts", "lib/cash.ts"]) {
        expect(srcOf(f).includes(`.rpc("${rpc}"`), `${f} → ${rpc}`).toBe(false);
      }
    }
  });

  it("lib/cash.ts is untouched by the authoring — it still does its three round trips", () => {
    // 0188 removes the strand window only once the caller is swapped, which is the named
    // follow-up. Until then the #304 rollback/strand machinery is the live guarantee and
    // must not be deleted ahead of the function that makes it unnecessary.
    const src = srcOf("lib/cash.ts");
    expect(src).toContain("supersede_strand");
    expect(src).toContain("superseded_by: inserted.id");
  });

  it("createRecipeFull maps 0187's named refusal to the SAME 409 the app check returns", () => {
    // Ships ahead of the gate on purpose: pre-apply the RPC cannot raise what it does not
    // contain, so the branch is dead and correct; post-apply it prevents the opaque 500.
    const body = bodyOf(srcOf("lib/recipes.ts"), "export async function createRecipeFull");
    expect(body).toContain('error.code === "P0001"');
    expect(body).toContain('new RecipeError(409, "duplicate_active_producer")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. The eslint warning that was left for this batch.
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/dynamic-pars.ts — the dead rollupUsageByProduct import is gone", () => {
  it("the import is removed but the comment reference stays TRUE", () => {
    const src = srcOf("lib/dynamic-pars.ts");
    expect(src).not.toContain('import { rollupUsageByProduct } from "@/lib/products-shared"');
    // The rollup IS still applied here — through rollupPerDate — so the comment naming it
    // must survive, and must now name the path rather than implying a direct call.
    expect(src).toContain("rollupUsageByProduct");
    expect(src).toContain("rollupPerDate");
    expect(srcOf("lib/dynamic-pars-run-shared.ts")).toContain("rollupUsageByProduct(perSku");
  });
});
