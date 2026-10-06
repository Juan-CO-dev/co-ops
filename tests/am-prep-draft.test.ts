/**
 * Unit spine — THE AM PREP DRAFT (migration 0214, Wave 1 branch A).
 *
 * Juan's floor note: "the AM prep list resets whenever someone exits the am prep … It
 * should just hold its inputs, so that even if the 10 minute timer hits, they don't lose
 * all their work."
 *
 * Pinned here:
 *   1. SAVE — the shape round-trips, malformed rejects whole, and the patch/merge rule
 *      keeps a second person's lines when a stale tab saves one cell.
 *   2. RESTORE — the precedence (first submission of an open instance, matching instance,
 *      unconsumed, non-empty) and the loader's facts (consumed → nothing; saver's name).
 *   3. CLEAR-ON-SUBMIT — the consume write is location-bound and marks only an
 *      unconsumed row; the route half (consume after a successful submit, never after a
 *      failed one) is in tests/am-prep-draft-submit.test.ts, which needs module mocks.
 *   4. THE LOCATION BIND and the role gate — refused before any draft write, with the
 *      location and day taken from the instance, never the body.
 *
 * The lib takes its Supabase client as a parameter, so a hand-rolled fake stands in for
 * the database; nothing here reaches a real one.
 */
import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AM_PREP_DRAFT_MAX_ITEMS,
  AM_PREP_DRAFT_NUMERIC_MAX,
  AM_PREP_DRAFT_TEXT_MAX,
  amPrepDraftApplies,
  amPrepDraftRetryDelayMs,
  canWriteAmPrepDraft,
  diffAmPrepDraftItems,
  isRetryableAmPrepDraftFailure,
  mergeAmPrepDraftItems,
  normalizeAmPrepDraftItems,
  parseAmPrepDraft,
} from "@/lib/am-prep-draft-shared";
import {
  consumeAmPrepDraft,
  loadAmPrepDraft,
  loadRestorableAmPrepDraft,
  saveAmPrepDraft,
} from "@/lib/am-prep-draft";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const INSTANCE = "33333333-3333-4333-8333-333333333333";
const OTHER_INSTANCE = "44444444-4444-4444-8444-444444444444";
const ITEM_1 = "55555555-5555-4555-8555-555555555555";
const ITEM_2 = "66666666-6666-4666-8666-666666666666";
const ITEM_3 = "77777777-7777-4777-8777-777777777777";
const DAY = "2026-10-06";

// ─────────────────────────────────────────────────────────────────────────────
// A tiny fake of the supabase-js query builder: rows by table, writes recorded.
// ─────────────────────────────────────────────────────────────────────────────

interface Recorded {
  table: string;
  op: "upsert" | "update" | "rpc";
  payload: Record<string, unknown>;
  options?: unknown;
  filters: Array<[string, unknown]>;
}

type RpcImpl = (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const SAVED_AT = "2026-10-06T14:00:00.000Z";

function fakeService(
  rows: Partial<Record<string, Record<string, unknown> | null>>,
  rpcImpl: RpcImpl = async () => ({ data: SAVED_AT, error: null }),
) {
  const writes: Recorded[] = [];
  const reads: string[] = [];
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let write: Recorded | null = null;
    const api = {
      select: () => api,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return api;
      },
      is: (c: string, v: unknown) => {
        filters.push([c, v]);
        return api;
      },
      upsert: (payload: Record<string, unknown>, options?: unknown) => {
        write = { table, op: "upsert", payload, options, filters };
        writes.push(write);
        return api;
      },
      update: (payload: Record<string, unknown>) => {
        write = { table, op: "update", payload, filters };
        writes.push(write);
        return api;
      },
      maybeSingle: async () => {
        reads.push(table);
        return { data: rows[table] ?? null, error: null };
      },
      single: async () => ({
        data: write ? { saved_at: write.payload.saved_at } : null,
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: write && write.op === "update" ? [{ location_id: "x" }] : [],
          error: null,
        }).then(resolve),
    };
    return api;
  });
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    writes.push({ table: name, op: "rpc", payload: params, filters: [] });
    return rpcImpl(name, params);
  });
  return { service: { from, rpc } as unknown as SupabaseClient, from, rpc, writes, reads };
}

const openInstance = (patch: Record<string, unknown> = {}) => ({
  id: INSTANCE,
  template_id: "tmpl",
  location_id: SHOP_A,
  date: DAY,
  status: "open",
  ...patch,
});
const amPrepTemplate = { type: "prep", prep_subtype: "am_prep" };

const keyHolderAtA = { user: { id: "u-kh" }, role: "key_holder" as const, level: 4, locations: [SHOP_A] };
const employeeAtA = { user: { id: "u-emp" }, role: "employee" as const, level: 3, locations: [SHOP_A] };
const ownerAnywhere = { user: { id: "u-own" }, role: "owner" as const, level: 10, locations: [] as string[] };

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAVE — shape, reject-whole, patch/merge
// ─────────────────────────────────────────────────────────────────────────────

describe("the draft shape round-trips and rejects malformed input whole", () => {
  it("keeps the typed strings exactly (partial decimals survive a restore)", () => {
    const draft = {
      version: 1,
      items: {
        [ITEM_1]: { onHand: "3.", backUp: "0.0", total: "3" },
        [ITEM_2]: { yesNo: false, freeText: "meatball mix not ready" },
      },
    };
    expect(parseAmPrepDraft(draft)).toEqual(draft);
  });

  it("drops empty strings and unknown fields, and caps lengths", () => {
    const parsed = parseAmPrepDraft({
      version: 1,
      items: {
        [ITEM_1]: { onHand: "", line: "9".repeat(100), extra: "x" },
        [ITEM_2]: { freeText: "a".repeat(AM_PREP_DRAFT_TEXT_MAX + 50) },
      },
    });
    expect(parsed?.items[ITEM_1]).toEqual({ line: "9".repeat(AM_PREP_DRAFT_NUMERIC_MAX) });
    expect(parsed?.items[ITEM_2]?.freeText).toHaveLength(AM_PREP_DRAFT_TEXT_MAX);
  });

  it.each([
    ["a non-object", "nope"],
    ["a wrong version", { version: 2, items: {} }],
    ["items as an array", { version: 1, items: [] }],
    ["a number where the typed string belongs", { version: 1, items: { [ITEM_1]: { onHand: 3 } } }],
    ["a non-boolean yesNo", { version: 1, items: { [ITEM_1]: { yesNo: "yes" } } }],
    ["a non-string note", { version: 1, items: { [ITEM_1]: { freeText: 7 } } }],
    ["an empty key", { version: 1, items: { "": { onHand: "1" } } }],
  ])("rejects %s", (_label, raw) => {
    expect(parseAmPrepDraft(raw)).toBeNull();
  });

  it("rejects a body with more lines than the cap", () => {
    const items: Record<string, unknown> = {};
    for (let i = 0; i <= AM_PREP_DRAFT_MAX_ITEMS; i++) items[`k${i}`] = { onHand: "1" };
    expect(parseAmPrepDraft({ version: 1, items })).toBeNull();
  });

  it("keeps an EMPTY row in a patch (it means: this line is blank now)", () => {
    expect(parseAmPrepDraft({ version: 1, items: { [ITEM_1]: {} } })?.items).toEqual({ [ITEM_1]: {} });
  });
});

describe("the patch/merge rule — a stale tab cannot erase a teammate's count", () => {
  it("the patch holds only the lines that changed, and a cleared line goes out empty", () => {
    const saved = normalizeAmPrepDraftItems({ [ITEM_1]: { onHand: "4" }, [ITEM_2]: { onHand: "2" } });
    const now = normalizeAmPrepDraftItems({ [ITEM_1]: { onHand: "4" }, [ITEM_2]: { onHand: "" }, [ITEM_3]: { line: "1" } });
    expect(diffAmPrepDraftItems(saved, now)).toEqual({ [ITEM_2]: {}, [ITEM_3]: { line: "1" } });
  });

  it("nothing changed → an empty patch (a page load that hydrates from the draft posts nothing)", () => {
    const items = normalizeAmPrepDraftItems({ [ITEM_1]: { onHand: "4", total: "4" } });
    expect(diffAmPrepDraftItems(items, normalizeAmPrepDraftItems({ ...items }))).toEqual({});
  });

  it("merging a one-line patch keeps every other stored line", () => {
    const stored = { [ITEM_1]: { onHand: "4" }, [ITEM_2]: { onHand: "2" } };
    expect(mergeAmPrepDraftItems(stored, { [ITEM_3]: { line: "1" } })).toEqual({
      [ITEM_1]: { onHand: "4" },
      [ITEM_2]: { onHand: "2" },
      [ITEM_3]: { line: "1" },
    });
  });

  it("an empty patch row removes the line; a filled one replaces it whole", () => {
    const stored = { [ITEM_1]: { onHand: "4", backUp: "1" }, [ITEM_2]: { onHand: "2" } };
    expect(mergeAmPrepDraftItems(stored, { [ITEM_1]: { onHand: "5" }, [ITEM_2]: {} })).toEqual({
      [ITEM_1]: { onHand: "5" },
    });
  });
});

describe("retry policy — blips retry on a backoff, verdicts do not spin", () => {
  it("backs off 2 s, 4 s, 8 s, 16 s, then holds at 30 s", () => {
    expect([1, 2, 3, 4, 5, 9].map(amPrepDraftRetryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
  it.each([[null, true], [500, true], [503, true], [401, true], [429, true], [408, true], [409, false], [403, false], [400, false], [404, false]])(
    "status %s → retry %s",
    (status, expected) => {
      expect(isRetryableAmPrepDraftFailure(status)).toBe(expected);
    },
  );
});

/**
 * A model of the 0214 `save_am_prep_draft` RPC for the lib-level tests: calls are
 * SERIALIZED through a lock (the RPC's `for update` on the shop-day row), and each applies
 * exactly the SQL's rule: reset on a different (newer) instance — lines AND consumed_at —
 * else merge the patch per line. The SQL itself is source-pinned below; this model proves
 * the LIB sends a per-line patch (never a TS-merged whole draft) so concurrency is safe.
 */
interface ModelRow {
  instance_id: string;
  items: Record<string, Record<string, unknown>>;
  consumed_at: string | null;
}
function rpcModel(initial: ModelRow | null) {
  const store: { row: ModelRow | null } = { row: initial };
  let chain: Promise<unknown> = Promise.resolve();
  const impl: RpcImpl = (name, params) => {
    const run = async () => {
      expect(name).toBe("save_am_prep_draft");
      await new Promise((r) => setTimeout(r, 5)); // the RPC "works" while holding the lock
      const patch = params.p_patch as Record<string, Record<string, unknown>>;
      const row = store.row;
      const sameInstance = row !== null && row.instance_id === params.p_instance_id;
      const base = sameInstance && row.consumed_at === null ? row.items : {};
      store.row = {
        instance_id: params.p_instance_id as string,
        items: mergeAmPrepDraftItems(base, patch) as ModelRow["items"],
        consumed_at: sameInstance ? row.consumed_at : null,
      };
      return { data: SAVED_AT, error: null };
    };
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  };
  return { store, impl };
}

describe("saveAmPrepDraft — one atomic RPC merges the patch for the instance's shop-day", () => {
  it("calls save_am_prep_draft with the instance id, the PATCH and the saver; returns its saved_at", async () => {
    const f = fakeService({ checklist_instances: openInstance(), checklist_templates: amPrepTemplate });
    const res = await saveAmPrepDraft(f.service, {
      actor: keyHolderAtA,
      instanceId: INSTANCE,
      patch: { [ITEM_2]: { onHand: "2", total: "2" } },
    });
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.rpc).toHaveBeenCalledWith("save_am_prep_draft", {
      p_instance_id: INSTANCE,
      p_patch: { [ITEM_2]: { onHand: "2", total: "2" } },
      p_saved_by: "u-kh",
    });
    // No read-merge-write in TS any more: no draft read, no upsert.
    expect(f.reads).not.toContain("am_prep_drafts");
    expect(f.writes.filter((w) => w.op !== "rpc")).toEqual([]);
    expect(res.savedAt).toBe(SAVED_AT);
  });

  it("CONCURRENT saves of DIFFERENT lines from two devices both land", async () => {
    const m = rpcModel({ instance_id: INSTANCE, items: { [ITEM_1]: { onHand: "4" } }, consumed_at: null });
    const f = fakeService({ checklist_instances: openInstance(), checklist_templates: amPrepTemplate }, m.impl);
    await Promise.all([
      saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: { [ITEM_2]: { onHand: "2" } } }),
      saveAmPrepDraft(f.service, { actor: ownerAnywhere, instanceId: INSTANCE, patch: { [ITEM_3]: { line: "7" } } }),
    ]);
    expect(m.store.row?.items).toEqual({
      [ITEM_1]: { onHand: "4" },
      [ITEM_2]: { onHand: "2" },
      [ITEM_3]: { line: "7" },
    });
  });

  it("the SAME line saved twice: last write wins", async () => {
    const m = rpcModel(null);
    const f = fakeService({ checklist_instances: openInstance(), checklist_templates: amPrepTemplate }, m.impl);
    await Promise.all([
      saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: { [ITEM_1]: { onHand: "3" } } }),
      saveAmPrepDraft(f.service, { actor: ownerAnywhere, instanceId: INSTANCE, patch: { [ITEM_1]: { onHand: "5" } } }),
    ]);
    expect(m.store.row?.items).toEqual({ [ITEM_1]: { onHand: "5" } });
  });

  it("a NEW instance starting from a CONSUMED row resets the lines AND consumed_at", async () => {
    const m = rpcModel({ instance_id: OTHER_INSTANCE, items: { [ITEM_1]: { onHand: "9" } }, consumed_at: "2026-10-06T10:00:00Z" });
    const f = fakeService({ checklist_instances: openInstance(), checklist_templates: amPrepTemplate }, m.impl);
    await saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: { [ITEM_2]: { onHand: "1" } } });
    expect(m.store.row).toEqual({ instance_id: INSTANCE, items: { [ITEM_2]: { onHand: "1" } }, consumed_at: null });
  });

  it.each([
    ["am_prep_draft:prep_instance_not_open", 409, "prep_instance_not_open"],
    ["am_prep_draft:draft_superseded", 409, "draft_superseded"],
    ["am_prep_draft:instance_not_found", 404, "instance_not_found"],
    ["am_prep_draft:draft_too_large", 400, "invalid_payload"],
  ])("maps the RPC's %s to %i %s", async (message, status, code) => {
    const f = fakeService(
      { checklist_instances: openInstance(), checklist_templates: amPrepTemplate },
      async () => ({ data: null, error: { message } }),
    );
    await expect(saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: { [ITEM_1]: { onHand: "1" } } }))
      .rejects.toMatchObject({ name: "AmPrepDraftError", status, code });
  });

  it("refuses a submitted instance with 409 before calling the RPC", async () => {
    const f = fakeService({ checklist_instances: openInstance({ status: "confirmed" }), checklist_templates: amPrepTemplate });
    await expect(saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: {} }))
      .rejects.toMatchObject({ name: "AmPrepDraftError", status: 409, code: "prep_instance_not_open" });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("refuses an instance that is not an AM prep (404) and an unknown one (404)", async () => {
    const notPrep = fakeService({ checklist_instances: openInstance(), checklist_templates: { type: "opening", prep_subtype: null } });
    await expect(saveAmPrepDraft(notPrep.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: {} }))
      .rejects.toMatchObject({ status: 404, code: "instance_not_found" });
    const missing = fakeService({});
    await expect(saveAmPrepDraft(missing.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: {} }))
      .rejects.toMatchObject({ status: 404, code: "instance_not_found" });
    expect([...notPrep.writes, ...missing.writes]).toEqual([]);
  });
});

describe("0214 save_am_prep_draft — the SQL (source-pinned; applied only in the sim/prod gate)", () => {
  const sql = readFileSync("supabase/migrations/0214_am_prep_drafts.sql", "utf8").replace(/\r\n/g, "\n");
  const fn = sql.slice(
    sql.indexOf("create or replace function public.save_am_prep_draft"),
    sql.indexOf("revoke all on function"),
  );

  it("locks the instance FOR SHARE and rechecks it is open", () => {
    expect(fn).toMatch(/from public\.checklist_instances\s+where id = p_instance_id\s+for share/);
    expect(fn).toContain("if v_inst.status <> 'open' then");
  });
  it("creates the shop-day row race-safely, then locks it FOR UPDATE before merging", () => {
    const ins = fn.indexOf("on conflict (location_id, business_date) do nothing");
    const lock = fn.search(/from public\.am_prep_drafts\s+where location_id = v_inst\.location_id and business_date = v_inst\.date\s+for update/);
    const merge = fn.indexOf("am_prep_draft_merge_items(v_base, p_patch)");
    expect(ins).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(ins);
    expect(merge).toBeGreaterThan(lock);
  });
  it("a different instance: refuses an older one, else resets lines AND consumed_at", () => {
    expect(fn).toContain("if v_row.instance_id <> v_inst.id then");
    expect(fn).toMatch(/v_stored_created > v_inst\.created_at[\s\S]*draft_superseded/);
    expect(fn).toMatch(/draft_superseded[\s\S]*?v_base := '\{\}'::jsonb;\s*v_consumed := null;/);
    expect(fn).toContain("consumed_at = v_consumed");
  });
  it("the merge is per line: || for filled lines, key removal for empty ones", () => {
    const merge = sql.slice(
      sql.indexOf("create or replace function public.am_prep_draft_merge_items"),
      sql.indexOf("create or replace function public.save_am_prep_draft"),
    );
    expect(merge).toMatch(/\|\|\s*coalesce\(\s*\(select jsonb_object_agg\(e\.key, e\.value\)[\s\S]*?where e\.value <> '\{\}'::jsonb\)/);
    expect(merge).toMatch(/\)\s*-\s*coalesce\(\s*\(select array_agg\(e\.key\)[\s\S]*?where e\.value = '\{\}'::jsonb\)/);
  });
  it("grants: revoked from public/anon/authenticated, granted to service_role, asserted in a DO block", () => {
    expect(sql).toContain("revoke all on function public.save_am_prep_draft(uuid, jsonb, uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.save_am_prep_draft(uuid, jsonb, uuid) to service_role;");
    expect(sql).toContain("revoke all on function public.am_prep_draft_merge_items(jsonb, jsonb) from public, anon, authenticated;");
    expect(sql).toContain("raise exception '0214: unexpected am_prep_draft execute grant'");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = pg_catalog, public");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE LOCATION BIND + the role gate
// ─────────────────────────────────────────────────────────────────────────────

describe("the location bind — a draft write lands only in the actor's own shop", () => {
  it("refuses a key holder at shop A writing shop B's draft — 403 before any further read or write", async () => {
    const f = fakeService({ checklist_instances: openInstance({ location_id: SHOP_B }), checklist_templates: amPrepTemplate });
    await expect(saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: { [ITEM_1]: { onHand: "1" } } }))
      .rejects.toMatchObject({ name: "AmPrepDraftError", status: 403, code: "location_access_denied" });
    expect(f.reads).toEqual(["checklist_instances"]);
    expect(f.writes).toEqual([]);
  });

  it("lets an all-locations owner write any shop's draft", async () => {
    const f = fakeService({ checklist_instances: openInstance({ location_id: SHOP_B }), checklist_templates: amPrepTemplate });
    await saveAmPrepDraft(f.service, { actor: ownerAnywhere, instanceId: INSTANCE, patch: { [ITEM_1]: { onHand: "1" } } });
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.writes[0]!.payload).toMatchObject({ p_instance_id: INSTANCE });
  });

  it("consumeAmPrepDraft binds too: foreign shop refused before the UPDATE", async () => {
    const f = fakeService({});
    await expect(consumeAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, locationId: SHOP_B, businessDate: DAY }))
      .rejects.toMatchObject({ status: 403, code: "location_access_denied" });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("consumeAmPrepDraft stamps consumed_at only on the unconsumed row OF THIS INSTANCE", async () => {
    const f = fakeService({});
    await expect(consumeAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, locationId: SHOP_A, businessDate: DAY }))
      .resolves.toBe(1);
    const w = f.writes[0]!;
    expect(w).toMatchObject({ table: "am_prep_drafts", op: "update" });
    expect(Object.keys(w.payload)).toEqual(["consumed_at"]);
    expect(w.filters).toEqual([["location_id", SHOP_A], ["business_date", DAY], ["instance_id", INSTANCE], ["consumed_at", null]]);
  });

  it("source pin: both writers call lockLocationContext BEFORE their write", () => {
    const src = readFileSync("lib/am-prep-draft.ts", "utf8");
    for (const [fn, write] of [["saveAmPrepDraft", ".rpc("], ["consumeAmPrepDraft", ".update("]] as const) {
      const start = src.indexOf(`export async function ${fn}(`);
      const next = src.indexOf("\nexport ", start + 1);
      const body = src.slice(start, next === -1 ? undefined : next);
      const bind = body.indexOf("lockLocationContext(");
      expect(bind, `${fn} binds`).toBeGreaterThan(-1);
      expect(body.indexOf(write), `${fn} writes after the bind`).toBeGreaterThan(bind);
    }
  });

  it("the differential location-bind test covers this table and file", () => {
    const src = readFileSync("tests/location-bind-differential.test.ts", "utf8");
    expect(src).toContain('"am_prep_drafts"');
    expect(src).toContain('"lib/am-prep-draft.ts"');
    // saveAmPrepDraft writes through the RPC, so the RPC must be on the scoped list too.
    expect(src).toContain('"save_am_prep_draft"');
  });
});

describe("the role gate is AM prep submit's: level >= 4 OR an active assignment", () => {
  it("the predicate", () => {
    expect(canWriteAmPrepDraft({ actorLevel: 4, baseLevel: 4, hasAssignment: false })).toBe(true);
    expect(canWriteAmPrepDraft({ actorLevel: 3, baseLevel: 4, hasAssignment: true })).toBe(true);
    expect(canWriteAmPrepDraft({ actorLevel: 3, baseLevel: 4, hasAssignment: false })).toBe(false);
  });

  it("an employee with no assignment is refused 403 prep_role_violation, nothing written", async () => {
    const f = fakeService({ checklist_instances: openInstance(), checklist_templates: amPrepTemplate, report_assignments: null });
    await expect(saveAmPrepDraft(f.service, { actor: employeeAtA, instanceId: INSTANCE, patch: { [ITEM_1]: { onHand: "1" } } }))
      .rejects.toMatchObject({ status: 403, code: "prep_role_violation" });
    expect(f.writes).toEqual([]);
  });

  it("an employee WITH today's am_prep assignment may save", async () => {
    const f = fakeService({
      checklist_instances: openInstance(),
      checklist_templates: amPrepTemplate,
      report_assignments: { id: "asg", note: null, assigner_id: "u-gm" },
    });
    await saveAmPrepDraft(f.service, { actor: employeeAtA, instanceId: INSTANCE, patch: { [ITEM_1]: { onHand: "1" } } });
    expect(f.writes).toHaveLength(1);
  });

  it("the gate uses the same constant as submitAmPrep", () => {
    const src = readFileSync("lib/am-prep-draft.ts", "utf8");
    expect(src).toMatch(/import \{ AM_PREP_BASE_LEVEL, loadAssignmentForToday \} from "\.\/prep"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RESTORE
// ─────────────────────────────────────────────────────────────────────────────

describe("restore precedence — submitted values always outrank the draft", () => {
  const base = {
    mode: "submit" as const,
    instanceStatus: "open",
    instanceId: INSTANCE,
    draftInstanceId: INSTANCE,
    consumed: false,
    itemCount: 3,
  };
  it("applies on a first submission of an open instance", () => {
    expect(amPrepDraftApplies(base)).toBe(true);
  });
  it.each([
    ["edit mode", { mode: "edit" as const }],
    ["read-only mode", { mode: "read_only" as const }],
    ["a confirmed instance", { instanceStatus: "confirmed" }],
    ["a consumed draft", { consumed: true }],
    ["another instance's draft", { draftInstanceId: OTHER_INSTANCE }],
    ["an empty draft", { itemCount: 0 }],
  ])("does not apply to %s", (_label, patch) => {
    expect(amPrepDraftApplies({ ...base, ...patch })).toBe(false);
  });
});

describe("loadAmPrepDraft — the facts the restore line needs", () => {
  it("returns the draft, the server time and the saver's name", async () => {
    const f = fakeService({
      am_prep_drafts: {
        instance_id: INSTANCE,
        consumed_at: null,
        saved_by: "u-maria",
        saved_at: "2026-10-06T13:42:00Z",
        draft: { version: 1, items: { [ITEM_1]: { onHand: "4" } } },
      },
      users: { name: "Maria" },
    });
    await expect(loadAmPrepDraft(f.service, { locationId: SHOP_A, businessDate: DAY })).resolves.toEqual({
      instanceId: INSTANCE,
      draft: { version: 1, items: { [ITEM_1]: { onHand: "4" } } },
      savedAt: "2026-10-06T13:42:00Z",
      savedByName: "Maria",
    });
  });

  it("a consumed draft is never restored", async () => {
    const f = fakeService({
      am_prep_drafts: { instance_id: INSTANCE, consumed_at: "2026-10-06T14:00:00Z", saved_by: null, saved_at: "x", draft: { version: 1, items: {} } },
    });
    await expect(loadAmPrepDraft(f.service, { locationId: SHOP_A, businessDate: DAY })).resolves.toBeNull();
  });

  it("an unparseable stored draft reads as absent (never half-hydrates)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeService({
      am_prep_drafts: { instance_id: INSTANCE, consumed_at: null, saved_by: null, saved_at: "x", draft: { version: 1, items: { [ITEM_1]: { onHand: 4 } } } },
    });
    await expect(loadAmPrepDraft(f.service, { locationId: SHOP_A, businessDate: DAY })).resolves.toBeNull();
    spy.mockRestore();
  });

  it("the restore line ships in English and Spanish", () => {
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    expect(en["am_prep.draft.restored"]).toBe("Picked up where you left off at {time} ({name})");
    for (const key of Object.keys(en).filter((k) => k.startsWith("am_prep.draft."))) {
      expect(es[key], `es.json is missing ${key}`).toBeTruthy();
      expect(es[key]).not.toBe(en[key]);
    }
  });
});


describe("the PAGE's draft read never takes AM prep down (0214 unapplied, or a blip)", () => {
  const args = { mode: "submit" as const, instance: { id: INSTANCE, status: "open" }, locationId: SHOP_A, businessDate: DAY };

  it("a draft read error degrades to no draft (logged with [am-prep]), never a throw", async () => {
    const api = {
      select: () => api,
      eq: () => api,
      maybeSingle: async () => ({ data: null, error: { message: 'relation "public.am_prep_drafts" does not exist' } }),
    };
    const service = { from: () => api } as unknown as SupabaseClient;
    // The lib's own loader still throws, so an API caller would surface the error…
    await expect(loadAmPrepDraft(service, { locationId: SHOP_A, businessDate: DAY })).rejects.toThrow(/does not exist/);
    // …but the page path renders the form with no draft.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadRestorableAmPrepDraft(service, args)).resolves.toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[am-prep]"));
    spy.mockRestore();
  });

  it("a thrown client (not just an error result) also degrades to no draft", async () => {
    const service = { from: () => { throw new Error("socket hang up"); } } as unknown as SupabaseClient;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadRestorableAmPrepDraft(service, args)).resolves.toBeNull();
    spy.mockRestore();
  });

  it("returns the restore when the draft applies, and reads nothing outside a first submission", async () => {
    const f = fakeService({
      am_prep_drafts: { instance_id: INSTANCE, consumed_at: null, saved_by: null, saved_at: "2026-10-06T13:42:00Z", draft: { version: 1, items: { [ITEM_1]: { onHand: "4" } } } },
    });
    await expect(loadRestorableAmPrepDraft(f.service, args)).resolves.toEqual({
      draft: { version: 1, items: { [ITEM_1]: { onHand: "4" } } },
      savedAt: "2026-10-06T13:42:00Z",
      savedByName: null,
    });
    const g = fakeService({});
    await expect(loadRestorableAmPrepDraft(g.service, { ...args, mode: "edit" })).resolves.toBeNull();
    expect(g.from).not.toHaveBeenCalled();
  });

  it("source pin: the page uses the non-throwing read, never the raw loader", () => {
    const page = readFileSync("app/(authed)/operations/am-prep/page.tsx", "utf8");
    expect(page).toContain("loadRestorableAmPrepDraft(");
    expect(page).not.toMatch(/\bloadAmPrepDraft\(/);
  });
});
