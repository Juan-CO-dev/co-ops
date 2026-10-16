import { describe, expect, it } from "vitest";

import docExample from "./fixtures/sevenshifts/assignments-doc-example.json";
import { SEVENSHIFTS_ENDPOINTS, SEVENSHIFTS_RESOURCES } from "@/lib/sevenshifts/endpoints-shared";
import {
  MAX_PAGES_PER_RESOURCE,
  assignmentsSnapshot,
  followPages,
  laborSettingsSnapshot,
  listUnpaginatedSnapshot,
  pageStep,
  wagesSnapshot,
  whoamiSnapshot,
} from "@/lib/sevenshifts/paginate-shared";

const page = (data: unknown[], next: unknown) => ({ data, meta: { cursor: { current: "c", prev: null, next, count: data.length } } });

describe("pageStep — `end` ONLY on an explicit meta.cursor.next === null (r1 P2-5)", () => {
  it("an explicit null is end", () => {
    expect(pageStep(page([1], null))).toEqual({ kind: "end" });
  });
  it("a non-empty string is next", () => {
    expect(pageStep(page([1], "abc"))).toEqual({ kind: "next", cursor: "abc" });
  });
  const malformed: Array<[string, unknown]> = [
    ["not an object", "nope"],
    ["null body", null],
    ["missing meta", { data: [] }],
    ["meta not an object", { data: [], meta: "x" }],
    ["missing cursor", { data: [], meta: {} }],
    ["cursor not an object", { data: [], meta: { cursor: "x" } }],
    ["next absent", { data: [], meta: { cursor: {} } }],
    ["next undefined", { data: [], meta: { cursor: { next: undefined } } }],
    ["next a number", page([], 5)],
    ["next an object", page([], {})],
    ["next an empty string", page([], "")],
    ["data not an array", { data: {}, meta: { cursor: { next: null } } }],
    ["data absent", { meta: { cursor: { next: null } } }],
  ];
  it.each(malformed)("%s → malformed", (_label, json) => {
    expect(pageStep(json)).toEqual({ kind: "malformed" });
  });
});

describe("followPages — failures are failures, never a successful end", () => {
  function pages(...bodies: unknown[]) {
    const calls: Array<string | null> = [];
    let i = 0;
    return { calls, fetchPage: async (cursor: string | null) => { calls.push(cursor); return bodies[i++]; } };
  }

  it("follows cursors to an explicit null on page 3 → complete", async () => {
    const p = pages(page([1, 2], "a"), page([3], "b"), page([4], null));
    const r = await followPages(p.fetchPage);
    expect(r).toEqual({ rows: [1, 2, 3, 4], pages: 3, complete: true, error: null });
    expect(p.calls).toEqual([null, "a", "b"]);
  });

  it.each([
    ["missing meta", { data: [1] }],
    ["next absent", { data: [1], meta: { cursor: {} } }],
    ["data not an array", { data: "x", meta: { cursor: { next: null } } }],
  ])("a malformed page 1 (%s) → bad_pagination, nothing complete", async (_l, body) => {
    const r = await followPages(pages(body).fetchPage);
    expect(r.error).toBe("bad_pagination");
    expect(r.complete).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it("a valid page 1 followed by a malformed page 2 → bad_pagination, page 1's rows returned, complete: false", async () => {
    const r = await followPages(pages(page([1, 2], "a"), { data: [3] }).fetchPage);
    expect(r).toEqual({ rows: [1, 2], pages: 1, complete: false, error: "bad_pagination" });
  });

  it("a repeated cursor → cursor_loop", async () => {
    const r = await followPages(pages(page([1], "a"), page([2], "b"), page([3], "a")).fetchPage);
    expect(r.error).toBe("cursor_loop");
    expect(r.complete).toBe(false);
    expect(r.rows).toEqual([1, 2, 3]);
  });

  it("the page cap → page_cap, a failure", async () => {
    let n = 0;
    const r = await followPages(async () => page([n], `c${++n}`));
    expect(MAX_PAGES_PER_RESOURCE).toBe(200);
    expect(r.error).toBe("page_cap");
    expect(r.complete).toBe(false);
    expect(r.pages).toBe(200);
  });

  it("a thrown fetch propagates (the client maps HTTP failures to its own codes)", async () => {
    await expect(followPages(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("singleton snapshots (r2 #1)", () => {
  it("the documented assignments example is ACCEPTED with no cursor", () => {
    const r = assignmentsSnapshot(docExample);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.roles).toHaveLength(1);
  });
  it("a singleton carrying a meta.cursor anyway is still accepted (no follow)", () => {
    expect(assignmentsSnapshot({ ...docExample, meta: { cursor: { next: "zzz" } } }).ok).toBe(true);
  });
  it.each([
    ["roles missing", { data: { locations: [], departments: [] } }],
    ["roles an object", { data: { locations: [], departments: [], roles: {} } }],
    ["locations missing", { data: { departments: [], roles: [] } }],
    ["departments null", { data: { locations: [], departments: null, roles: [] } }],
    ["data an array", { data: [] }],
    ["no data", {}],
    ["wrong object tag", { object: "users", data: { locations: [], departments: [], roles: [] } }],
    ["not an object", "x"],
  ])("assignments: %s → bad_snapshot", (_l, json) => {
    expect(assignmentsSnapshot(json)).toEqual({ ok: false, code: "bad_snapshot" });
  });
  it("assignments without the optional object tag is accepted", () => {
    expect(assignmentsSnapshot({ data: { locations: [], departments: [], roles: [] } }).ok).toBe(true);
  });

  it("wages: both arrays required", () => {
    expect(wagesSnapshot({ data: { current_wages: [], upcoming_wages: [] } }).ok).toBe(true);
    expect(wagesSnapshot({ data: { current_wages: [] } })).toEqual({ ok: false, code: "bad_snapshot" });
    expect(wagesSnapshot({ data: { current_wages: {}, upcoming_wages: [] } })).toEqual({ ok: false, code: "bad_snapshot" });
    expect(wagesSnapshot({ data: [] })).toEqual({ ok: false, code: "bad_snapshot" });
  });

  it("labor settings: data is an object", () => {
    expect(laborSettingsSnapshot({ object: "labor_settings", data: { overtime_enabled: true } }).ok).toBe(true);
    expect(laborSettingsSnapshot({ data: [] })).toEqual({ ok: false, code: "bad_snapshot" });
    expect(laborSettingsSnapshot({ data: null })).toEqual({ ok: false, code: "bad_snapshot" });
  });

  it("whoami: one company, two companies, and malformed", () => {
    const one = whoamiSnapshot({ object: "whoami", data: { identity_id: 9, users: [{ company_id: 1234 }, { company_id: 1234 }] } });
    expect(one).toEqual({ ok: true, value: { companyIds: ["1234"] } });
    const two = whoamiSnapshot({ data: { users: [{ company_id: 1234 }, { company_id: "5678" }] } });
    expect(two).toEqual({ ok: true, value: { companyIds: ["1234", "5678"] } });
    expect(whoamiSnapshot({ data: { users: {} } })).toEqual({ ok: false, code: "bad_snapshot" });
    expect(whoamiSnapshot({ data: { users: [{ company_id: "abc" }] } })).toEqual({ ok: false, code: "bad_snapshot" });
    expect(whoamiSnapshot({ data: { users: [{}] } })).toEqual({ ok: false, code: "bad_snapshot" });
  });
});

describe("list-unpaginated", () => {
  it("an array with no meta is accepted; a non-array is refused", () => {
    expect(listUnpaginatedSnapshot({ data: [1, 2] })).toEqual({ ok: true, value: [1, 2] });
    expect(listUnpaginatedSnapshot({ data: {} })).toEqual({ ok: false, code: "bad_snapshot" });
    expect(listUnpaginatedSnapshot("x")).toEqual({ ok: false, code: "bad_snapshot" });
  });
});

describe("every endpoint declares a shape, and the table is pinned", () => {
  it("one entry per resource, each with a shape", () => {
    expect(Object.keys(SEVENSHIFTS_ENDPOINTS).sort()).toEqual([...SEVENSHIFTS_RESOURCES].sort());
    for (const r of SEVENSHIFTS_RESOURCES) {
      expect(["paginated", "singleton", "list-unpaginated"]).toContain(SEVENSHIFTS_ENDPOINTS[r].shape);
    }
  });
  it("assignments, wages, labor_settings and whoami are singletons; the rest are paginated", () => {
    const shapes = Object.fromEntries(SEVENSHIFTS_RESOURCES.map((r) => [r, SEVENSHIFTS_ENDPOINTS[r].shape]));
    expect(shapes).toEqual({
      whoami: "singleton", locations: "paginated", departments: "paginated", roles: "paginated",
      users: "paginated", assignments: "singleton", wages: "singleton", availabilities: "paginated",
      time_off: "paginated", shifts: "paginated", time_punches: "paginated", labor_settings: "singleton",
    });
  });
});
