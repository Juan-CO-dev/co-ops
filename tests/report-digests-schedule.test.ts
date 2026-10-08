import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIGEST_SETTINGS,
  decideCatering,
  decideUnified,
  digestWatchAt,
  etDayRange,
  etWallTime,
  isStaleClaim,
  missingDeliveries,
  parseDigestSettings,
  parseHhMm,
  tickBusinessDays,
  type SendLogRow,
} from "@/lib/report-digests-shared";

const A = "loc-a";
const B = "loc-b";
const settings = { ...DEFAULT_DIGEST_SETTINGS, mode: "live" as const };

describe("settings", () => {
  it("ships OFF, and a malformed row falls back per key", () => {
    expect(DEFAULT_DIGEST_SETTINGS.mode).toBe("off");
    const s = parseDigestSettings([
      { key: "digest_delivery_mode", value: "preview" },
      { key: "catering_digest_time_et", value: "7am" },
      { key: "unified_fallback_time_et", value: "02:30" },
      { key: "digest_watch_grace_minutes", value: -5 },
    ]);
    expect(s).toEqual({ mode: "preview", cateringTimeEt: "07:00", unifiedFallbackTimeEt: "02:30", graceMinutes: 60 });
    expect(parseDigestSettings([{ key: "digest_delivery_mode", value: "loud" }]).mode).toBe("off");
  });

  it("parses HH:MM strictly", () => {
    expect(parseHhMm("07:00")).toBe(420);
    expect(parseHhMm("23:59")).toBe(1439);
    for (const bad of ["7:00", "24:00", "07:60", "", null, 700]) expect(parseHhMm(bad)).toBeNull();
  });
});

describe("unified: last shop finalizes, else the 03:00 ET fallback", () => {
  it("sends the moment the LAST active shop finalizes", () => {
    const d = decideUnified({ day: "2026-10-07", activeLocationIds: [A, B], finalizedLocationIds: new Set([A, B]), now: new Date("2026-10-08T02:30:00Z"), settings });
    expect(d).toEqual({ due: true, reason: "all_finalized", missing: [] });
  });

  it("waits while one shop is open, before the fallback", () => {
    const d = decideUnified({ day: "2026-10-07", activeLocationIds: [A, B], finalizedLocationIds: new Set([A]), now: new Date("2026-10-08T06:59:00Z"), settings });
    expect(d).toEqual({ due: false, reason: "waiting", missing: [B] });
  });

  it("at 03:00 ET (EDT = 07:00Z) the fallback sends and LISTS the unfinalized shops", () => {
    const d = decideUnified({ day: "2026-10-07", activeLocationIds: [A, B], finalizedLocationIds: new Set([A]), now: new Date("2026-10-08T07:00:00Z"), settings });
    expect(d).toEqual({ due: true, reason: "fallback", missing: [B] });
  });

  it("the fallback is 03:00 ET in winter too (EST = 08:00Z)", () => {
    const before = decideUnified({ day: "2026-12-07", activeLocationIds: [A], finalizedLocationIds: new Set(), now: new Date("2026-12-08T07:59:00Z"), settings });
    const at = decideUnified({ day: "2026-12-07", activeLocationIds: [A], finalizedLocationIds: new Set(), now: new Date("2026-12-08T08:00:00Z"), settings });
    expect([before.due, at.due, at.missing]).toEqual([false, true, [A]]);
  });

  it("a day with no shop finalized still sends at the fallback, listing every shop", () => {
    const d = decideUnified({ day: "2026-10-07", activeLocationIds: [A, B], finalizedLocationIds: new Set(), now: new Date("2026-10-08T12:00:00Z"), settings });
    expect(d).toEqual({ due: true, reason: "fallback", missing: [A, B] });
  });
});

describe("catering due at the setting, DST-correct", () => {
  it("07:00 ET in EDT and in EST", () => {
    expect(decideCatering(new Date("2026-10-07T10:59:00Z"), settings)).toEqual({ due: false, day: "2026-10-07" });
    expect(decideCatering(new Date("2026-10-07T11:00:00Z"), settings)).toEqual({ due: true, day: "2026-10-07" });
    expect(decideCatering(new Date("2026-12-07T11:59:00Z"), settings).due).toBe(false);
    expect(decideCatering(new Date("2026-12-07T12:00:00Z"), settings).due).toBe(true);
  });

  it("on the spring-forward day (2027-03-14) 07:00 ET is 11:00Z", () => {
    expect(etWallTime("2027-03-14", 420).toISOString()).toBe("2027-03-14T11:00:00.000Z");
    expect(etWallTime("2026-11-01", 420).toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });

  it("a moved setting moves the send", () => {
    expect(decideCatering(new Date("2026-10-07T10:30:00Z"), { ...settings, cateringTimeEt: "06:30" }).due).toBe(true);
  });
});

describe("tick days, digest-watch and stale claims", () => {
  it("a tick looks at yesterday and today ET", () => {
    expect(tickBusinessDays(new Date("2026-10-08T03:30:00Z"))).toEqual(["2026-10-06", "2026-10-07"]);
  });

  it("watch deadlines: catering = time + grace; closing digests = next-day fallback + grace", () => {
    expect(digestWatchAt("catering", "2026-10-07", settings).toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(digestWatchAt("unified", "2026-10-07", settings).toISOString()).toBe("2026-10-08T08:00:00.000Z");
    expect(digestWatchAt("gm_shop", "2026-10-07", settings).toISOString()).toBe("2026-10-08T08:00:00.000Z");
  });

  it("missing = expected with no sent|skipped row in the same mode; failed and claimed do not count", () => {
    const row = (ref: string, outcome: string, mode = "live", location_id: string | null = null): SendLogRow =>
      ({ recipient_ref: ref, kind: "catering", business_day: "2026-10-07", location_id, revision: 1, mode, outcome, skip_reason: outcome === "skipped" ? "no_email" : null, attempted_at: "2026-10-07T11:00:00Z" });
    const expected = ["user:1", "user:2", "user:3", "user:4", "user:5"].map((ref) => ({ ref, locationId: null }));
    const log = [row("user:1", "sent"), row("user:2", "skipped"), row("user:3", "failed"), row("user:4", "claimed"), row("user:5", "sent", "preview")];
    expect(missingDeliveries(expected, log, "live").map((m) => m.ref)).toEqual(["user:3", "user:4", "user:5"]);
  });

  it("a claim is stale after 15 minutes", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(isStaleClaim({ outcome: "claimed", attempted_at: "2026-10-07T11:44:00Z" }, now)).toBe(true);
    expect(isStaleClaim({ outcome: "claimed", attempted_at: "2026-10-07T11:50:00Z" }, now)).toBe(false);
    expect(isStaleClaim({ outcome: "sent", attempted_at: "2026-10-07T10:00:00Z" }, now)).toBe(false);
  });
});

describe("P2 (Astra): an ET day is two independent Eastern midnights", () => {
  it("spring forward (2026-03-08) is 23 hours and never reaches into the next day", () => {
    expect(etDayRange("2026-03-08")).toEqual({ startIso: "2026-03-08T05:00:00.000Z", endExclusiveIso: "2026-03-09T04:00:00.000Z" });
  });
  it("fall back (2026-11-01) is 25 hours and keeps its own last hour", () => {
    expect(etDayRange("2026-11-01")).toEqual({ startIso: "2026-11-01T04:00:00.000Z", endExclusiveIso: "2026-11-02T05:00:00.000Z" });
  });
  it("an ordinary day is 24 hours", () => {
    expect(etDayRange("2026-10-06")).toEqual({ startIso: "2026-10-06T04:00:00.000Z", endExclusiveIso: "2026-10-07T04:00:00.000Z" });
  });
});

describe("P2 (Astra): a contention skip never satisfies digest-watch", () => {
  it("a race loser's already_sent beside a winner that died (failed claim) is still missing", () => {
    const base = { kind: "catering", business_day: "2026-10-07", location_id: null, revision: 1, mode: "live", attempted_at: "2026-10-07T11:00:00Z" };
    const log: SendLogRow[] = [
      { ...base, recipient_ref: "user:1", outcome: "failed", skip_reason: null },
      { ...base, recipient_ref: "user:1", outcome: "skipped", skip_reason: "already_sent" },
      { ...base, recipient_ref: "user:2", outcome: "skipped", skip_reason: "already_sent" },
      { ...base, recipient_ref: "user:2", outcome: "sent", skip_reason: null },
    ];
    expect(missingDeliveries([{ ref: "user:1", locationId: null }, { ref: "user:2", locationId: null }], log, "live")).toEqual([{ ref: "user:1", locationId: null }]);
  });
});
