/**
 * Nav PR 9, N3: the people search's own narrow reads (plan r2 3.2, 4.4; lead ruling r1 F4).
 *
 * `searchPeopleFor` against a recording client: the exact queries per scope (table, columns, filters, order, ranges), no
 * `pm_reports` read, no contact column, each read's error thrown. lib/profiles.ts (whose helpers drop read errors) is
 * not reused and not changed: pinned by its blob hash at origin/main 98714874.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { LEADERSHIP_ROLES, loadPeopleDirectory, PeopleSearchRefused, searchPeopleFor } from "@/lib/nav/people-search";
import { describeCalls, recordingSupabase, type RecordingDb } from "./recording-supabase";

const A = "shop-a";
const B = "shop-b";
let db: RecordingDb;
beforeEach(() => {
  db = recordingSupabase({
    users: [
      { id: "u1", name: "Ana Crew", role: "employee", active: true },
      { id: "u2", name: "Bo Lead", role: "gm", active: true },
      { id: "u3", name: "Cy Boss", role: "moo", active: true },
      { id: "u4", name: "Di Other", role: "employee", active: true },
      { id: "u5", name: "Ed Owner", role: "owner", active: true },
    ],
    user_locations: [
      { user_id: "u1", location_id: A, active: true },
      { user_id: "u2", location_id: A, active: true },
      { user_id: "u3", location_id: A, active: true },
      { user_id: "u4", location_id: B, active: true },
    ],
  });
});
const viewer = (role: string, locations: string[]) => ({ role: role as never, level: ({ key_holder: 4, owner: 9, social_media_mgr: 6 } as Record<string, number>)[role]!, locations, language: "en" as const });

describe("the exact reads per scope", () => {
  it("memberships: the membership page, one users chunk, the leadership read", async () => {
    await searchPeopleFor(db.client, viewer("key_holder", [A]), {}, "an");
    expect(db.queries.map((q) => `${q.table} ${q.columns} ${describeCalls(q)}`)).toEqual([
      `user_locations user_id select("user_id") in("location_id",["${A}"]) eq("active",true) order("user_id",{"ascending":true}) range(0,999)`,
      `users id, name, role select("id, name, role") in("id",["u1","u2","u3"]) eq("active",true) order("id",{"ascending":true}) range(0,999)`,
      `users id, name, role select("id, name, role") eq("active",true) in("role",${JSON.stringify(LEADERSHIP_ROLES)}) order("id",{"ascending":true}) range(0,999)`,
    ]);
  });
  it("all shops (level 9+): one all-users read, split by level", async () => {
    const dir = await loadPeopleDirectory(db.client, { role: "owner", locations: [] });
    expect(db.queries.map((q) => `${q.table} ${describeCalls(q)}`)).toEqual([
      `users select("id, name, role") eq("active",true) order("id",{"ascending":true}) range(0,999)`,
    ]);
    expect(dir.staff.map((p) => p.userId)).toEqual(["u1", "u2", "u4"]); // a GM (7) is staff
    expect(dir.leadership.map((p) => p.userId)).toEqual(["u3", "u5"]);
  });
  it("no memberships: the leadership read only", async () => {
    const dir = await loadPeopleDirectory(db.client, { role: "key_holder", locations: [] });
    expect(db.queries).toHaveLength(1);
    expect(dir).toEqual({ staff: [], leadership: [
      { userId: "u3", name: "Cy Boss", role: "moo" }, { userId: "u5", name: "Ed Owner", role: "owner" },
    ] });
  });
  it("member staff is below level 8 (a GM is staff, a MoO member is leadership), sorted by name", async () => {
    const dir = await loadPeopleDirectory(db.client, { role: "key_holder", locations: [A] });
    expect(dir.staff.map((p) => p.name)).toEqual(["Ana Crew", "Bo Lead"]);
    expect(dir.leadership.map((p) => p.name)).toEqual(["Cy Boss", "Ed Owner"]);
  });
  it("no pm_reports read and no contact column, in every scope", async () => {
    for (const v of [viewer("key_holder", [A]), viewer("owner", []), viewer("key_holder", [])]) {
      db.queries.length = 0;
      await searchPeopleFor(db.client, v, {}, "zz");
      for (const q of db.queries) {
        expect(q.table).not.toBe("pm_reports");
        expect(q.columns ?? "").not.toMatch(/email|phone|blurb|\*/);
      }
    }
  });
});

describe("errors propagate", () => {
  it("each read's error throws (never an empty directory)", async () => {
    for (let i = 0; i < 3; i++) {
      db.queries.length = 0;
      let n = 0;
      db.fail = () => (n++ === i ? { message: "boom" } : null);
      await expect(searchPeopleFor(db.client, viewer("key_holder", [A]), {}, "an"), `read ${i}`).rejects.toThrow(/boom/);
    }
  });
  it("the SMM is refused before any read", async () => {
    await expect(searchPeopleFor(db.client, viewer("social_media_mgr", [A]), {}, "an")).rejects.toBeInstanceOf(PeopleSearchRefused);
    expect(db.queries).toEqual([]);
  });
});

describe("output", () => {
  it("exactly { userId, name, role } per person", async () => {
    const r = await searchPeopleFor(db.client, viewer("key_holder", [A]), {}, "a");
    for (const p of r.people) expect(Object.keys(p).sort()).toEqual(["name", "role", "userId"]);
    expect(r.people.map((p) => p.userId)).not.toContain("u4");
  });
});

describe("lib/profiles.ts is not changed by PR 9", () => {
  it("its blob equals origin/main's (98714874)", () => {
    const c = readFileSync("lib/profiles.ts");
    const sha = createHash("sha1").update(`blob ${c.length}\0`).update(c).digest("hex");
    expect(sha).toBe("8dfdbf6c1f0a3f3b4e5359ca03875fabb6dde7ba");
  });
});
