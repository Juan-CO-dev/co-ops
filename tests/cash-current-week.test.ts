/**
 * W03 follow-up (owner ruling, Juan 2026-11-15): who may file or edit a cash report for which date.
 *
 * Managers — GM (level 7) and above — file or edit a cash report for ANY date, as today. Everyone
 * below GM who can file cash (key holders, shift leads, the level-6 managers, an assignee) is
 * limited to report dates inside the CURRENT business week, Monday through Sunday, America/New_York.
 * The business day is the one the cash code already uses: the ET calendar date of the instant
 * (`etCalendarDate`, the /cash page's `today`). A date outside the week is refused by name
 * (`outside_current_week`) in the lib BEFORE any I/O; the route answers 403
 * `cash_outside_current_week` with an en + es message.
 */
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ has: vi.fn(async () => true) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: access.has, auditTaskOverride: vi.fn(async () => {}) }));

import {
  CASH_ANY_DATE_MIN_LEVEL,
  cashBusinessDay,
  cashDateRefusal,
  cashWeekOf,
} from "@/lib/cash-shared";
import { submitCashReport } from "@/lib/cash";

// Wed 2026-11-11, noon EST. The business week is Mon 2026-11-09 .. Sun 2026-11-15.
const WED_NOON = "2026-11-11T17:00:00.000Z";

describe("the current business week (Mon–Sun, ET)", () => {
  it("is Monday through Sunday around any day", () => {
    expect(cashWeekOf("2026-11-11")).toEqual({ monday: "2026-11-09", sunday: "2026-11-15" });
    expect(cashWeekOf("2026-11-09")).toEqual({ monday: "2026-11-09", sunday: "2026-11-15" });
    expect(cashWeekOf("2026-11-15")).toEqual({ monday: "2026-11-09", sunday: "2026-11-15" });
    expect(cashWeekOf("2026-11-16")).toEqual({ monday: "2026-11-16", sunday: "2026-11-22" });
    // Across a month and a year boundary.
    expect(cashWeekOf("2026-12-31")).toEqual({ monday: "2026-12-28", sunday: "2027-01-03" });
  });

  it("the business day is the cash code's existing one: the ET calendar date", () => {
    expect(cashBusinessDay(WED_NOON)).toBe("2026-11-11");
    // 22:30 EST on Wed is 03:30Z Thu — still Wednesday's business day.
    expect(cashBusinessDay("2026-11-12T03:30:00.000Z")).toBe("2026-11-11");
  });
});

describe("key holders: only the current week", () => {
  const KH = 4;
  it.each([
    ["Monday", "2026-11-09"],
    ["Wednesday (today)", "2026-11-11"],
    ["Sunday", "2026-11-15"],
  ])("inside the week: %s is allowed", (_label, date) => {
    expect(cashDateRefusal(KH, date, WED_NOON)).toBeNull();
  });

  it.each([
    ["last Sunday", "2026-11-08"],
    ["next Monday", "2026-11-16"],
    ["a month back", "2026-10-11"],
    ["next year", "2027-11-11"],
  ])("outside the week: %s is refused", (_label, date) => {
    expect(cashDateRefusal(KH, date, WED_NOON)).toBe("outside_current_week");
  });

  it("every level below GM is limited (shift lead, the level-6 managers, an assignee below KH)", () => {
    for (const level of [0, 1, 2, 3, 4, 5, 6]) {
      expect(cashDateRefusal(level, "2026-11-08", WED_NOON), `level ${level}`).toBe("outside_current_week");
      expect(cashDateRefusal(level, "2026-11-10", WED_NOON), `level ${level}`).toBeNull();
    }
  });

  it("a malformed or impossible date is refused, never waved through by string order", () => {
    for (const bad of ["2026-11-1", "2026-11-31", "2026-02-30", "", "2026/11/10", "2026-11-10T00:00:00Z"]) {
      expect(cashDateRefusal(4, bad, WED_NOON), bad).toBe("outside_current_week");
    }
  });

  it("an unknown level fails closed", () => {
    expect(cashDateRefusal(Number.NaN, "2026-11-08", WED_NOON)).toBe("outside_current_week");
  });
});

describe("managers (GM and above): any date", () => {
  it("GM is the line", () => {
    expect(CASH_ANY_DATE_MIN_LEVEL).toBe(7);
  });
  it.each([7, 8, 9, 10])("level %i files any past or future date", (level) => {
    for (const date of ["2026-11-08", "2026-11-16", "2026-01-01", "2025-06-30", "2027-03-01"]) {
      expect(cashDateRefusal(level, date, WED_NOON), `${level} ${date}`).toBeNull();
    }
  });
});

describe("DST weeks", () => {
  // Fall back: Sun 2026-11-01 02:00 EDT → 01:00 EST. Week Mon 10-26 .. Sun 11-01.
  it("the last minutes of the fall-back Sunday are still that week", () => {
    const sun2330Est = "2026-11-02T04:30:00.000Z"; // 23:30 EST Sun 11-01
    expect(cashBusinessDay(sun2330Est)).toBe("2026-11-01");
    expect(cashDateRefusal(4, "2026-10-26", sun2330Est)).toBeNull();
    expect(cashDateRefusal(4, "2026-11-01", sun2330Est)).toBeNull();
    expect(cashDateRefusal(4, "2026-11-02", sun2330Est)).toBe("outside_current_week");
  });
  it("ET midnight after the fall-back Sunday starts the next week (05:00Z, not 04:00Z)", () => {
    const mon0000Est = "2026-11-02T05:00:00.000Z";
    expect(cashDateRefusal(4, "2026-11-01", mon0000Est)).toBe("outside_current_week");
    expect(cashDateRefusal(4, "2026-11-02", mon0000Est)).toBeNull();
    // 04:00Z is still 23:00 EST Sunday — a fixed −4 h offset would have flipped the week here.
    expect(cashDateRefusal(4, "2026-11-01", "2026-11-02T04:00:00.000Z")).toBeNull();
  });
  it("spring forward: the week turns at ET midnight after Sun 2026-03-08 (04:00Z)", () => {
    expect(cashWeekOf("2026-03-08")).toEqual({ monday: "2026-03-02", sunday: "2026-03-08" });
    expect(cashDateRefusal(4, "2026-03-08", "2026-03-09T03:59:00.000Z")).toBeNull();
    expect(cashDateRefusal(4, "2026-03-08", "2026-03-09T04:00:00.000Z")).toBe("outside_current_week");
    expect(cashDateRefusal(4, "2026-03-09", "2026-03-09T04:00:00.000Z")).toBeNull();
  });
  it("the DST Sunday itself is inside its own week from either side of the switch", () => {
    for (const at of ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]) { // 01:30 EDT, then 01:30 EST
      expect(cashBusinessDay(at)).toBe("2026-11-01");
      expect(cashDateRefusal(4, "2026-10-26", at)).toBeNull();
    }
  });
});

describe("the day-boundary edge (the existing business day turns at ET midnight; there is no 01:00 cutoff in the cash code)", () => {
  // Mon 2026-11-16 00:30 / 00:59 / 01:00 / 01:30 EST.
  const at = (hhmmZ: string) => `2026-11-16T${hhmmZ}:00.000Z`;
  it("Sunday 23:59 ET is still last week's Sunday", () => {
    const sun2359 = "2026-11-16T04:59:00.000Z";
    expect(cashBusinessDay(sun2359)).toBe("2026-11-15");
    expect(cashDateRefusal(4, "2026-11-15", sun2359)).toBeNull();
    expect(cashDateRefusal(4, "2026-11-16", sun2359)).toBe("outside_current_week");
  });
  it.each([["00:30", "05:30"], ["00:59", "05:59"], ["01:00", "06:00"], ["01:30", "06:30"]])(
    "Monday %s ET is Monday's business day: the new week",
    (_et, z) => {
      expect(cashBusinessDay(at(z))).toBe("2026-11-16");
      expect(cashDateRefusal(4, "2026-11-16", at(z))).toBeNull();
      expect(cashDateRefusal(4, "2026-11-15", at(z))).toBe("outside_current_week");
      expect(cashDateRefusal(7, "2026-11-15", at(z))).toBeNull();
    },
  );
});

describe("the /cash page only offers allowed dates", () => {
  it("the page's date is the shared business day, and that day is always allowed to a key holder", () => {
    const page = readFileSync("app/(authed)/cash/page.tsx", "utf8");
    expect(page).toContain("const today = cashBusinessDay(");
    // Every day of a year (DST both ways), on both sides of ET midnight (04:xxZ / 05:xxZ) and at
    // midday: today is always inside today's week.
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    for (let day = 0; day < 366; day++) {
      for (const offsetMin of [3 * 60 + 59, 4 * 60 + 30, 5 * 60 + 30, 17 * 60]) {
        const iso = new Date(start + day * 86_400_000 + offsetMin * 60_000).toISOString();
        if (cashDateRefusal(4, cashBusinessDay(iso), iso) !== null) throw new Error(`today refused at ${iso}`);
      }
    }
  });
});

/** A fake that records every table touched and every RPC; the closing is open, 0304 is installed. */
function recordingService() {
  const touched: string[] = [];
  const chain = (table: string) => {
    const done = () => Promise.resolve({ data: table === "checklist_instances" ? [] : null, error: null, count: 1 });
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b, maybeSingle: done, single: done,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => done().then(ok, bad),
    };
    return b;
  };
  const service = {
    from: (table: string) => { touched.push(table); return { select: () => chain(table), insert: () => chain(table), update: () => chain(table) }; },
    rpc: (name: string) => { touched.push(`rpc.${name}`); return Promise.resolve({ data: [{ new_id: "new-1", superseded_id: null }], error: null }); },
  };
  return { service: service as never, touched };
}

const ARGS = {
  locationId: "loc-1",
  actor: { userId: "kh-1", role: "key_holder" as const, level: 4, locations: ["loc-1"] },
  projectedCents: 50_000, drawerTotalCents: 60_000, floatCents: 20_000,
  countMethod: "hand" as const, denominations: null,
  cashTipsCents: 0, onShift: [], overShortNote: null, toastProjected: null,
};

describe("submitCashReport enforces the week before any I/O", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(WED_NOON));
    access.has.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each(["2026-11-08", "2026-11-16"])("a key holder filing %s is refused outside_current_week, nothing read or written", async (date) => {
    const { service, touched } = recordingService();
    await expect(submitCashReport(service, { ...ARGS, date })).resolves.toEqual({ ok: false, reason: "outside_current_week" });
    expect(touched).toEqual([]);
    expect(access.has).not.toHaveBeenCalled();
  });

  it.each(["2026-11-09", "2026-11-15"])("a key holder filing %s (inside the week) writes", async (date) => {
    const { service, touched } = recordingService();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(submitCashReport(service, { ...ARGS, date })).resolves.toEqual({ ok: true, id: "new-1" });
    expect(touched).toContain("rpc.submit_cash_report_atomic");
  });

  it("a GM filing last month writes", async () => {
    const { service, touched } = recordingService();
    const gm = { ...ARGS.actor, userId: "gm-1", role: "gm" as const, level: 7 };
    await expect(submitCashReport(service, { ...ARGS, actor: gm, date: "2026-10-11" })).resolves.toEqual({ ok: true, id: "new-1" });
    expect(touched).toContain("rpc.submit_cash_report_atomic");
  });

  it("the location bind still answers first (a foreign shop is location_access_denied, whatever the date)", async () => {
    const { service } = recordingService();
    await expect(submitCashReport(service, { ...ARGS, locationId: "loc-2", date: "2026-11-08" }))
      .resolves.toEqual({ ok: false, reason: "location_access_denied" });
  });
});

describe("POST /api/cash names the refusal", () => {
  it("maps outside_current_week to 403 cash_outside_current_week with the ruling's message", () => {
    const route = readFileSync("app/api/cash/route.ts", "utf8");
    expect(route).toMatch(/result\.reason === "outside_current_week"[\s\S]{0,200}jsonError\(403, "cash_outside_current_week"/);
    expect(route).toContain("Key holders can only file cash for this week (Mon–Sun). Ask a manager.");
  });

  it("the client shows the translated message for that code, in en and es", () => {
    const client = readFileSync("app/(authed)/cash/cash-client.tsx", "utf8");
    expect(client).toMatch(/body\.error === "cash_outside_current_week"[\s\S]{0,120}t\("cash\.error\.outside_current_week"\)/);
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    expect(en["cash.error.outside_current_week"]).toBe("Key holders can only file cash for this week (Mon–Sun). Ask a manager.");
    expect(es["cash.error.outside_current_week"]).toBeTruthy();
    expect(es["cash.error.outside_current_week"]).not.toBe(en["cash.error.outside_current_week"]);
  });
});

describe("the route really answers 403 (live route, lib refusal)", () => {
  const SHOP = "11111111-1111-4111-8111-111111111111";
  it("a key holder's out-of-week post is 403 cash_outside_current_week", async () => {
    vi.resetModules();
    vi.doMock("@/lib/session", () => ({ requireSession: async () => ({ user: { id: "kh" }, session: { id: "s" }, role: "key_holder", level: 4, locations: [SHOP] }) }));
    vi.doMock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
    vi.doMock("@/lib/assignments", () => ({ hasTaskAccess: async () => true }));
    vi.doMock("@/lib/auth-reauth-pin", () => ({ verifyActorPinForSession: async () => "ok" }));
    vi.doMock("@/lib/cash-toast", () => ({ loadToastCashProjected: async () => null }));
    vi.doMock("@/lib/cash", async () => {
      const shared = await vi.importActual<typeof import("@/lib/cash-shared")>("@/lib/cash-shared");
      return { ...shared, submitCashReport: async () => ({ ok: false, reason: "outside_current_week" }) };
    });
    const { POST } = await import("@/app/api/cash/route");
    const res = await POST(new NextRequest("http://localhost/api/cash", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ locationId: SHOP, date: "2026-11-08", pin: "1234", projectedCents: 0, cashTipsCents: 0, countMethod: "hand", drawerTotalCents: 100 }),
    }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("cash_outside_current_week");
    expect(body.error).toBe("Key holders can only file cash for this week (Mon–Sun). Ask a manager.");
  });
});
