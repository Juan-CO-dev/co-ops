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
import { consumeAmPrepDraft, loadAmPrepDraft, saveAmPrepDraft } from "@/lib/am-prep-draft";

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
  op: "upsert" | "update";
  payload: Record<string, unknown>;
  options?: unknown;
  filters: Array<[string, unknown]>;
}

function fakeService(rows: Partial<Record<string, Record<string, unknown> | null>>) {
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
  return { service: { from } as unknown as SupabaseClient, from, writes, reads };
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

describe("saveAmPrepDraft — merges the patch into the shop's draft for the instance's day", () => {
  it("upserts on (location_id, business_date) taken from the INSTANCE, merging the stored lines", async () => {
    const f = fakeService({
      checklist_instances: openInstance(),
      checklist_templates: amPrepTemplate,
      am_prep_drafts: {
        instance_id: INSTANCE,
        consumed_at: null,
        draft: { version: 1, items: { [ITEM_1]: { onHand: "4" } } },
      },
    });
    const res = await saveAmPrepDraft(f.service, {
      actor: keyHolderAtA,
      instanceId: INSTANCE,
      patch: { [ITEM_2]: { onHand: "2", total: "2" } },
    });
    expect(f.writes).toHaveLength(1);
    const w = f.writes[0]!;
    expect(w.table).toBe("am_prep_drafts");
    expect(w.options).toEqual({ onConflict: "location_id,business_date" });
    expect(w.payload).toMatchObject({
      location_id: SHOP_A,
      business_date: DAY,
      instance_id: INSTANCE,
      saved_by: "u-kh",
      draft: { version: 1, items: { [ITEM_1]: { onHand: "4" }, [ITEM_2]: { onHand: "2", total: "2" } } },
    });
    // consumed_at is never written by a save: a consumed draft stays consumed.
    expect(w.payload).not.toHaveProperty("consumed_at");
    expect(res.savedAt).toBe(w.payload.saved_at);
  });

  it("does not merge into a CONSUMED draft or one left by another instance", async () => {
    for (const existing of [
      { instance_id: INSTANCE, consumed_at: "2026-10-06T10:00:00Z", draft: { version: 1, items: { [ITEM_1]: { onHand: "9" } } } },
      { instance_id: OTHER_INSTANCE, consumed_at: null, draft: { version: 1, items: { [ITEM_1]: { onHand: "9" } } } },
    ]) {
      const f = fakeService({ checklist_instances: openInstance(), checklist_templates: amPrepTemplate, am_prep_drafts: existing });
      await saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: { [ITEM_2]: { onHand: "1" } } });
      expect(f.writes[0]!.payload.draft).toEqual({ version: 1, items: { [ITEM_2]: { onHand: "1" } } });
    }
  });

  it("refuses a submitted instance with 409 and writes nothing", async () => {
    const f = fakeService({ checklist_instances: openInstance({ status: "confirmed" }), checklist_templates: amPrepTemplate });
    await expect(saveAmPrepDraft(f.service, { actor: keyHolderAtA, instanceId: INSTANCE, patch: {} }))
      .rejects.toMatchObject({ name: "AmPrepDraftError", status: 409, code: "prep_instance_not_open" });
    expect(f.writes).toEqual([]);
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
    expect(f.writes[0]!.payload).toMatchObject({ location_id: SHOP_B });
  });

  it("consumeAmPrepDraft binds too: foreign shop refused before the UPDATE", async () => {
    const f = fakeService({});
    await expect(consumeAmPrepDraft(f.service, { actor: keyHolderAtA, locationId: SHOP_B, businessDate: DAY }))
      .rejects.toMatchObject({ status: 403, code: "location_access_denied" });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("consumeAmPrepDraft at the actor's own shop stamps consumed_at on the unconsumed row only", async () => {
    const f = fakeService({});
    await expect(consumeAmPrepDraft(f.service, { actor: keyHolderAtA, locationId: SHOP_A, businessDate: DAY }))
      .resolves.toBe(1);
    const w = f.writes[0]!;
    expect(w).toMatchObject({ table: "am_prep_drafts", op: "update" });
    expect(Object.keys(w.payload)).toEqual(["consumed_at"]);
    expect(w.filters).toEqual([["location_id", SHOP_A], ["business_date", DAY], ["consumed_at", null]]);
  });

  it("source pin: both writers call lockLocationContext BEFORE their write", () => {
    const src = readFileSync("lib/am-prep-draft.ts", "utf8");
    for (const [fn, write] of [["saveAmPrepDraft", ".upsert("], ["consumeAmPrepDraft", ".update("]] as const) {
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

