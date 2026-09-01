/**
 * Unit spine — SILENT-READ FABRICATION (audit v2 Batch C; BC-032 / BC-033 / BC-034).
 *
 * AGENTS.md § Database & RLS: "Supabase JS .update() swallows constraint violations —
 * always check `error`, never infer success from `data`." The same law binds READS, and
 * ~40 sites broke it: they destructure `{ data }`, never bind `error`, and let `data ?? []`
 * turn a database failure into a FABRICATED value — an empty recipe graph, an empty
 * catering-due list, a zero note count, an item that reads "ready". A fabricated value is
 * worse than an error page, because nothing downstream can tell it from the truth.
 *
 * TWO KINDS OF TEST LIVE HERE, and the split is the house law (AGENTS.md § Module
 * boundaries & testing: the vitest spine is PURE modules only):
 *
 *   1. `selectAllRows` is genuinely pure — it takes the page-fetching callback as an
 *      argument — so its behaviour is tested for real, with a fake `build` that fails.
 *      This is the ROOT of the class: one function, ~110 call sites in 22 modules.
 *
 *   2. Every other site is DB-coupled (it calls getServiceRoleClient()), so the wiring is
 *      pinned by SOURCE ASSERTION — the same technique as tests/admin-sku-write-contracts.ts
 *      and tests/dynamic-pars-walker.test.ts, and for the same reason: when the guarantee is
 *      "no read in this function drops its error", the ABSENCE is what has to be asserted,
 *      and no test over the module's exports can see an absence.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { selectAllRows } from "@/lib/supabase-paginate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcOf = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// The source-assertion helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slice one function's body out of a module's source: from its declaration to the
 * start of the next top-level declaration. Deliberately textual — these assertions
 * exist precisely because the property is a textual absence in a DB-coupled module.
 */
function fnBody(src: string, declaration: string): string {
  const start = src.indexOf(declaration);
  if (start < 0) throw new Error(`declaration not found: ${declaration}`);
  const rest = src.slice(start + declaration.length);
  const nextDecl = rest.search(/\n(?:export )?(?:async )?function |\nexport (?:interface|const|type) /);
  return rest.slice(0, nextDecl < 0 ? rest.length : nextDecl);
}

/**
 * Every DESTRUCTURING of a PostgREST result in `body` that never binds `error` — i.e.
 * every site that can silently fabricate. A destructure is a `{ … data … }` group in a
 * binding position: followed by `=` (plain), or `,` / `]` (inside a Promise.all array
 * destructure). Producing positions — `Promise.resolve({ data: null })`, `return { data };`
 * — are followed by `)` or `;` and are correctly excluded, as are type annotations
 * (`PromiseLike<{ data: T[] | null }>`, followed by `>`).
 */
function droppedErrorReads(body: string): string[] {
  const out: string[] = [];
  const re = /\{[^{}]*\bdata\b[^{}]*\}(\s*)([=,\]])/g;
  for (const m of body.matchAll(re)) {
    const group = m[0].slice(0, m[0].length - (m[1] ?? "").length - (m[2] ?? "").length);
    if (!/\berror\b/.test(group)) out.push(group.replace(/\s+/g, " ").trim());
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ROOT — selectAllRows (pure; real behaviour)
// ─────────────────────────────────────────────────────────────────────────────

describe("selectAllRows — a page error is a FAILURE, never an empty table", () => {
  it("THROWS on a page-0 error instead of returning []", async () => {
    // The fabrication: `[]` from a failed read is indistinguishable from `[]` from an
    // empty table, and ~110 call sites go on to compute a cost, a par, a rank or a
    // readiness badge on it. The cousin of the P-Street truncation that hid for a month.
    await expect(
      selectAllRows<{ id: string }>(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow(/boom/);
  });

  it("THROWS on a LATER page's error — a partial read is never a whole one", async () => {
    // Worse than the page-0 case and easier to miss: page 0 succeeded, so the caller
    // gets a plausible, non-empty, WRONG list. Truncation with extra steps.
    const page0 = Array.from({ length: 2 }, (_, i) => ({ id: `a${i}` }));
    await expect(
      selectAllRows<{ id: string }>(
        async (from) =>
          from === 0 ? { data: page0, error: null } : { data: null, error: { message: "page 1 died" } },
        2,
      ),
    ).rejects.toThrow(/page 1 died/);
  });

  it("still returns every page's rows on success, stopping on the first short page", async () => {
    const rows = await selectAllRows<{ id: string }>(
      async (from) => ({ data: from === 0 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }], error: null }),
      2,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("a genuinely empty table is still an empty list, not an error", async () => {
    // The whole point of failing loud is to make THIS answer trustworthy.
    expect(await selectAllRows<{ id: string }>(async () => ({ data: [], error: null }))).toEqual([]);
  });

  it("tolerates a build that returns no `error` key at all (the wrapper call-site shape)", async () => {
    // ~38 call sites already check `error` inside their own build fn and return a bare
    // `{ data }`. Those must keep working unchanged.
    expect(await selectAllRows<{ id: string }>(async () => ({ data: [{ id: "x" }] }))).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. P1 — the recipe graph must fail loud, never partial
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/prep-consumption.ts — the inventory moat's foundation never builds a partial graph", () => {
  const src = srcOf("lib/prep-consumption.ts");

  it("loadRecipeGraph binds and throws on all three whole-graph reads", () => {
    const body = fnBody(src, "export async function loadRecipeGraph(");
    expect(droppedErrorReads(body)).toEqual([]);
    // The label-loop form loadCatalogView already uses for its twelve sibling reads.
    for (const label of ["recipes", "recipe_inputs", "recipe_outputs"]) {
      expect(body, label).toContain(`["${label}", `);
    }
    expect(body).toContain("throw new Error(`loadRecipeGraph ${label}: ${err.message}`)");
    // …and it throws BEFORE the graph is indexed, not after.
    expect(body.indexOf("loadRecipeGraph ${label}")).toBeLessThan(body.indexOf("const outputItemIds"));
  });

  it("every one of its four batch loaders throws too — a partial INPUT is a partial graph", () => {
    // A dropped measure registry silently zeroes conversion factors; a dropped pack row
    // silently drops a SKU's oz; a dropped par basis silently nulls fan-out weights. Each
    // one produces a graph that is quietly, plausibly wrong.
    for (const [decl, marker] of [
      ["export async function loadMeasures(", "loadMeasures:"],
      ["async function loadSkuPack(", "loadSkuPack:"],
      ["export async function loadSkuPackChains(", "loadSkuPackChains:"],
      ["async function loadItemParBasis(", "loadItemParBasis:"],
    ] as const) {
      const body = fnBody(src, decl);
      expect(droppedErrorReads(body), decl).toEqual([]);
      expect(body, decl).toContain(marker);
    }
  });

  it("keeps the batch shape — no read moved inside a loop (loadRecipeGraph law)", () => {
    // AGENTS.md: "Recipe flatten is batch-loaded: loadRecipeGraph() (6 fixed queries,
    // whole universe). Never reintroduce per-node queries." Failing loud must not cost
    // the property the batch rewrite bought.
    const body = fnBody(src, "export async function loadRecipeGraph(");
    expect(body).toContain("await Promise.all([");
    expect(/for \([^)]*\) \{[\s\S]{0,400}await sb\./.test(body)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. BC-034 — fabricated "ready" is the worst direction
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/admin/catalog.ts — a readiness-load failure never reads as READY", () => {
  const src = srcOf("lib/admin/catalog.ts");

  it("no longer defaults every item to ready when readiness fails to load", () => {
    // The old shape: `readinessLoaded ? readyItemIds.has(itemId) : true`. One DB blip and
    // every item in the catalog claims it can be made — the one direction an operator
    // cannot detect, because "ready" is what they expect to see.
    expect(src).not.toContain("readinessLoaded");
    expect(src).not.toContain("defaulting ready");
  });

  it("readiness failure is loud, like the twelve sibling reads in the same loader", () => {
    // loadCatalogView already throws on items / menu_items / packages / locations /
    // package_items / slot_options / toast_menu_map / template_items / item_sizes /
    // recipes / checklist_templates / vendor_items. The readiness swallow was the one
    // anomaly — and loadRecipeGraph, in the SAME Promise.all, now throws anyway.
    const body = fnBody(src, "export async function loadCatalogView(");
    expect(body).toContain("loadGraphReadiness(actor)");
    expect(body).not.toContain("catch");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The mid-shift pulse — a fabricated "nothing due today" is an operational lie
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/midshift.ts — the 6 AM pulse never invents an all-clear", () => {
  const src = srcOf("lib/midshift.ts");

  it("loadInstanceStatus throws rather than reporting a finished report as NOT STARTED", () => {
    const body = fnBody(src, "async function loadInstanceStatus(");
    expect(droppedErrorReads(body)).toEqual([]);
    expect(body).toContain("loadInstanceStatus checklist_templates:");
    expect(body).toContain("loadInstanceStatus checklist_instances:");
  });

  it("loadActiveToday throws rather than reporting a staffed shift as EMPTY", () => {
    const body = fnBody(src, "async function loadActiveToday(");
    expect(droppedErrorReads(body)).toEqual([]);
    expect(body).toContain("loadActiveToday checklist_instances:");
    expect(body).toContain("loadActiveToday cash_reports:");
    expect(body).toContain("loadActiveToday checklist_completions:");
    expect(body).toContain("loadActiveToday checklist_templates:");
  });

  it("loadCateringDueToday throws rather than reporting a catering day as CLEAR", () => {
    // The worst of the four: the kitchen reads "no events today", makes nothing, and the
    // order is late. There is no recovery from a fabricated empty here.
    const body = fnBody(src, "async function loadCateringDueToday(");
    expect(droppedErrorReads(body)).toEqual([]);
    expect(body).toContain("loadCateringDueToday catering_pipeline:");
  });

  it("the maintenance-notes HEAD count throws rather than fabricating zero", () => {
    const body = fnBody(src, "export async function loadMidShiftPulse(");
    expect(body).toContain("loadMidShiftPulse maintenance_notes:");
    // `?? 0` stays — a successful HEAD read with a null count is a real case. What matters
    // is that the error is read FIRST, so `?? 0` can only ever mean a real zero.
    expect(body.indexOf("notesRes.error")).toBeLessThan(body.indexOf("notesRes.count ?? 0"));
  });

  it("the two staff-NAME reads bind error too", () => {
    // Lower stakes (a missing name renders "—") but the same law, and leaving two
    // untouched drops in a fixed module is how the class grows back.
    expect(droppedErrorReads(fnBody(src, "export async function loadReportStatuses("))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Receiving / production — the remaining named sites
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/receiving.ts — loadDeliveryDetail never renders a delivery with invented lines", () => {
  it("binds error on the line read and the two name reads", () => {
    // A dropped vendor_delivery_items read renders the delivery with ZERO lines and a
    // lineCount of 0 — a receipt that looks reconciled and empty.
    const body = fnBody(srcOf("lib/receiving.ts"), "export async function loadDeliveryDetail(");
    expect(droppedErrorReads(body)).toEqual([]);
    expect(body).toContain("loadDeliveryDetail lines:");
  });
});

describe("lib/production.ts — the prep capture form's SKU→item map fails loud", () => {
  const src = srcOf("lib/production.ts");

  it("loadSkuToItems binds error on every read in its six-query chain", () => {
    // Fabricating here empties the output-item dropdown, so the operator cannot record a
    // prep they actually did — and the depletion lane goes dark with no message.
    const body = fnBody(src, "async function loadSkuToItems(");
    expect(droppedErrorReads(body)).toEqual([]);
    expect(body).toContain("loadSkuToItems recipe_inputs:");
  });

  it("loadRecentProductions binds error on its line and name reads", () => {
    const body = fnBody(src, "export async function loadRecentProductions(");
    expect(droppedErrorReads(body)).toEqual([]);
    expect(body).toContain("loadRecentProductions production_inputs:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. P2-13 — the cron heartbeat must read the cron it claims to report on
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/admin/ops-health.ts — loadCronHealth reads the TOAST cron, not the newest cron", () => {
  const src = srcOf("lib/admin/ops-health.ts");
  const body = fnBody(src, "export async function loadCronHealth(");

  it("filters BOTH audit reads on metadata->>job", () => {
    // Three crons write the same `cron.success` / `cron.failure` action with the same
    // resource_table. Only `metadata.job` distinguishes them, so the unfiltered
    // `.limit(1)` returns whichever ran last. When parse-receipts wakes (it needs
    // ANTHROPIC_API_KEY) it becomes the newest row nightly, and the toast cron's
    // per-location failure counters read all-zero forever — the exact P-Street blind
    // spot, re-opened through a new mechanism.
    const jobFilters = body.match(/\.eq\("metadata->>job", CRON_JOB\)/g) ?? [];
    expect(jobFilters).toHaveLength(2);
  });

  it("names the job string the toast cron actually writes", () => {
    // app/api/cron/toast-sales-pull/route.ts writes metadata: { job: "toast-sales-pull", … }
    // on BOTH its cron.success and its cron.failure rows.
    expect(srcOf("app/api/cron/toast-sales-pull/route.ts")).toContain('job: "toast-sales-pull"');
    expect(src).toContain('const CRON_JOB = "toast-sales-pull"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Comment rot — a stale comment is a wrong map
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/dynamic-pars.ts — the loadSkuUsageRank note matches the code it describes", () => {
  it("no longer claims loadSkuUsageRank spends the whole production-id list", () => {
    // PR #296 chunked it (lib/ordering.ts, PRODUCTION_ID_CHUNK). The stale note tells the
    // next reader a live 414 cliff exists on the par walk that does not.
    const src = srcOf("lib/dynamic-pars.ts");
    expect(src).not.toContain("still spends the whole list");
    expect(srcOf("lib/ordering.ts")).toContain("for (let i = 0; i < prodIds.length; i += PRODUCTION_ID_CHUNK)");
  });
});
