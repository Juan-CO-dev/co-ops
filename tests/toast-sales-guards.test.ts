/**
 * Unit spine — the two front-door guarantees of lib/catering/toast-sales.ts
 * (wiring audit 2026-08-29). Both were MISSING, and one of them was already
 * costing production data.
 *
 *   THE LOCATION BIND   — the module's floors are level 7 (write) and 6 (read), and
 *                         neither is all-locations (lockLocationContext grants that at
 *                         9). Prod carries two GMs, each assigned to exactly ONE shop,
 *                         so "level 7" never said WHICH sales ledger may be written.
 *   THE PAGED LEDGER    — loadLatestVersions read toast_sales_events with no
 *                         .order()/.range(), so it silently stopped at 1000 rows. CO
 *                         crosses that on a busy day (1158 / 1062 / 1001 rows on three
 *                         real P-Street dates), and the truncation ABORTED those pulls.
 *
 * TWO POSTURES, EACH FOR ITS OWN REASON. The bind is a DECISION at the front door, so
 * it is exercised for real against the module (the vitest config's narrow `server-only`
 * alias exists precisely so a test can prove "refused before any I/O" — see
 * tests/dynamic-pars-write.test.ts, which this mirrors). The paging is an I/O
 * GUARANTEE whose whole content is an ABSENCE — no unpaged read — which no unit test
 * over the exports can see, so it is pinned at the source in the house style of
 * tests/loader-scale-ceilings.test.ts and tests/dynamic-pars-walker.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
  pullSales,
  salesConsumption,
  addExclusion,
  listExclusions,
  TOAST_SALES_READ_MIN,
  TOAST_SALES_WRITE_MIN,
} from "@/lib/catering/toast-sales";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "lib", "catering", "toast-sales.ts"), "utf8");

const LOCATION_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_B = "22222222-2222-4222-8222-222222222222";
const DATE = "2026-08-08"; // the real day the truncation aborted P Street's pull

// A GM (level 7) and an AGM (level 6), each assigned to shop A only — the actual shape
// of every non-owner manager in prod today.
const gmAtA = {
  user: { id: "u1", role: "gm" as const, language: "en" as const },
  locations: [LOCATION_A],
} as unknown as Parameters<typeof pullSales>[0];
const agmAtA = {
  user: { id: "u2", role: "agm" as const, language: "en" as const },
  locations: [LOCATION_A],
} as unknown as Parameters<typeof salesConsumption>[0];
// Level 9+ carries the all-locations grant, so the bind must let it straight through.
const ownerAnywhere = {
  user: { id: "u3", role: "owner" as const, language: "en" as const },
  locations: [],
} as unknown as Parameters<typeof pullSales>[0];

// ── THE BIND ────────────────────────────────────────────────────────────────────
//
// "IT NEVER REACHED THE DATABASE" IS PROVEN BY THE PAIR, not asserted by a mock. The
// refused call comes back as an AdminToastSalesError 403; the permitted call gets past
// the bind and dies on the absent test-env Supabase config. A 403 arriving where the
// env error would otherwise be can only mean the call was refused before any I/O — so
// no toast_sales_events row and no toast_ingest_exclusions row can exist.

describe("toast-sales binds the location, not just the level", () => {
  it("the floors are BELOW the all-locations grant — which is why a bind is needed", () => {
    expect(TOAST_SALES_WRITE_MIN).toBe(7);
    expect(TOAST_SALES_READ_MIN).toBe(6);
    expect(TOAST_SALES_WRITE_MIN).toBeLessThan(9);
  });

  it("refuses a GM at shop A pulling shop B's sales day — 403, before the ledger", async () => {
    await expect(pullSales(gmAtA, LOCATION_B, DATE)).rejects.toMatchObject({
      name: "AdminToastSalesError",
      status: 403,
      code: "forbidden",
    });
  });

  it("refuses an AGM at shop A reading shop B's consumption", async () => {
    await expect(salesConsumption(agmAtA, LOCATION_B, DATE)).rejects.toMatchObject({
      name: "AdminToastSalesError",
      status: 403,
      code: "forbidden",
    });
  });

  it("refuses a GM at shop A authoring an exclusion TARGETED at shop B", async () => {
    await expect(
      addExclusion(gmAtA, { locationId: LOCATION_B, kind: "menu_group", value: "Catering" }),
    ).rejects.toMatchObject({ name: "AdminToastSalesError", status: 403, code: "forbidden" });
  });

  it("lets the actor through for their OWN shop (it then reaches the DB boundary)", async () => {
    // Not a 403: the bind passed. What it hits next is the absent test-env Supabase
    // config — exactly the boundary the refused calls above never got to.
    for (const call of [
      () => pullSales(gmAtA, LOCATION_A, DATE),
      () => salesConsumption(agmAtA, LOCATION_A, DATE),
      () => addExclusion(gmAtA, { locationId: LOCATION_A, kind: "menu_group", value: "Catering" }),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as { name?: string }).name).not.toBe("AdminToastSalesError");
      expect(String((err as Error).message)).toMatch(/must be set/);
    }
  });

  it("lets an all-locations actor through the bind for ANY shop", async () => {
    const err = await pullSales(ownerAnywhere, LOCATION_B, DATE).catch((e: unknown) => e);
    expect((err as { name?: string }).name).not.toBe("AdminToastSalesError");
    expect(String((err as Error).message)).toMatch(/must be set/);
  });

  it("binds deactivateExclusion on the ROW's location, after loading it", () => {
    // This one cannot be exercised behaviourally: the id says nothing about the shop, so
    // the row must be READ before it can be bound, and the read is the same DB boundary
    // the tests above stop at. Pinned at the source instead.
    const at = src.indexOf("export async function deactivateExclusion");
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain('.select("id, location_id")');
    expect(body).toContain("assertLocationAccess(actor, row.location_id)");
    // …and the load must come BEFORE the update, or the bind guards nothing.
    expect(body.indexOf("assertLocationAccess")).toBeLessThan(body.indexOf('.update({ active: false }'));
    // The house rowcount check on a silent-denial UPDATE stays.
    expect(body).toContain('count: "exact"');
    expect(body).toContain("count === 0");
  });

  it("leaves the ACTOR-LESS cores unbound — the cron iterates every location by design", () => {
    // doPull / deriveSalesConsumption take no AuthContext at all. If a bind ever appears
    // in one of them it can only be binding a null actor, which would break the nightly.
    for (const fn of ["async function doPull", "export async function deriveSalesConsumption"]) {
      const at = src.indexOf(fn);
      expect(at).toBeGreaterThan(-1);
      expect(src.slice(at, src.indexOf("\n}", at))).not.toContain("assertLocationAccess");
    }
  });
});

// ── AN EXCLUSION IS PER-SHOP (Juan's ruling, 2026-08-31) ────────────────────────
//
// *"No… it def needs per shop."* The wiring audit (PR #301) flagged and left undecided
// that `location_id NULL` is the GLOBAL row while the only authoring surface always sent
// null — a shop-scoped GM writing business-wide ingest config. Juan decided; global
// authoring is now closed at the type AND at the wire, with no level-9 replacement.

describe("addExclusion authors for ONE shop", () => {
  it("refuses a null locationId — 400 location_required, before any I/O", async () => {
    // The type says `string`; this is the wire boundary where an untyped payload lands, and
    // the old behaviour of that null was "apply to every shop".
    await expect(
      addExclusion(gmAtA, {
        locationId: null as unknown as string,
        kind: "menu_group",
        value: "Catering",
      }),
    ).rejects.toMatchObject({
      name: "AdminToastSalesError",
      status: 400,
      code: "location_required",
    });
  });

  it("refuses an empty-string locationId the same way", async () => {
    await expect(
      addExclusion(gmAtA, { locationId: "", kind: "menu_group", value: "Catering" }),
    ).rejects.toMatchObject({ status: 400, code: "location_required" });
  });

  it("closes global authoring STRUCTURALLY: the parameter is `string`, not `string | null`", () => {
    // The runtime guard above is the wire's belt; this is the compiler's braces. A future
    // caller cannot re-open global authoring without changing this signature on purpose.
    const at = src.indexOf("export async function addExclusion");
    const sig = src.slice(at, src.indexOf("): Promise<{ id: string }>", at));
    expect(at).toBeGreaterThan(-1);
    expect(sig).toContain("locationId: string;");
    expect(sig).not.toContain("locationId: string | null");
    // …and the bind is now UNCONDITIONAL, where it used to hang off `!= null`.
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).toContain("assertLocationAccess(actor, input.locationId)");
    expect(body).not.toContain("if (input.locationId != null) assertLocationAccess");
  });

  it("does NOT mint a level-9 global-authoring path to replace it", () => {
    // The simpler honouring of the ruling: no second, higher-privileged spelling of a thing
    // Juan just said should not happen.
    expect(src).not.toMatch(/requireLevel\(actor,\s*9\)/);
    expect(src).not.toContain("GLOBAL_EXCLUSION_MIN");
  });

  it("leaves the two legacy GLOBAL rows matching — the matcher is untouched", () => {
    // Their disposition (keep-as-global vs split-per-shop) is Juan's, and is not this PR.
    const shared = readFileSync(join(ROOT, "lib", "catering", "toast-sales-shared.ts"), "utf8");
    expect(shared).toContain("if (ex.locationId != null && ex.locationId !== target.locationId) continue;");
    expect(shared).toContain("null = every location");
  });
});

describe("listExclusions is scoped to the shop being viewed", () => {
  it("binds the location — a GM at shop A cannot list shop B's ingest config", async () => {
    await expect(listExclusions(agmAtA, LOCATION_B)).rejects.toMatchObject({
      name: "AdminToastSalesError",
      status: 403,
      code: "forbidden",
    });
  });

  it("returns this shop's own rows PLUS the legacy global ones, and nothing else", () => {
    // The filter is one line inside a DB-touching function, so it is pinned at the source:
    // dropping the `== null` half would hide the two live global rows from both shops.
    const at = src.indexOf("export async function listExclusions");
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain("assertLocationAccess(actor, locationId)");
    expect(body).toContain("e.locationId == null || e.locationId === locationId");
  });

  it("leaves the actor-less ingest read UNFILTERED — the cron serves every shop", () => {
    // loadActiveExclusions feeds matchesExclusion, which does the location filtering itself
    // per target. Filtering there would silently drop the other shop's rules mid-pull.
    const at = src.indexOf("async function loadActiveExclusions");
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(at).toBeGreaterThan(-1);
    // Takes no location parameter at all, and never narrows the select by one.
    expect(body).toContain("async function loadActiveExclusions(): Promise<ExclusionView[]>");
    expect(body).not.toContain('.eq("location_id"');
    expect(body).not.toContain("assertLocationAccess");
  });
});

// ── THE PAGED LEDGER ────────────────────────────────────────────────────────────

describe("loadLatestVersions pages the sales ledger under a stable total order", () => {
  const at = src.indexOf("async function loadLatestVersions");
  const body = src.slice(at, src.indexOf("\n}", at));

  it("is paged at all — a location-day already crosses 1000 rows in production", () => {
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain("selectAllRows");
    expect(body).toContain(".range(from, to)");
  });

  it("orders by the PK — without a total order a row can land on two pages or none", () => {
    expect(body).toContain('.order("id", { ascending: true })');
  });

  it("THROWS on a page error instead of taking selectAllRows' silent `data ?? []`", () => {
    // An empty map does not degrade here: doPull reads "not in the map" as "never seen"
    // and re-inserts the whole day at snapshot_version 1, which the unique index refuses
    // — turning a read error into a 409 that skips the night's depletion and pars.
    expect(body).toContain("if (error) throw new Error(`toast-sales ledger read:");
  });

  it("keeps the latest-version reduction the pull's version arithmetic depends on", () => {
    expect(body).toContain("r.snapshot_version > cur.snapshot_version");
  });
});
