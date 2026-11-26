/**
 * Catering delivery D2 — the strict request parsers (lib/delivery/parse-shared.ts). One rule for every body: exactly
 * the listed keys, ids made canonical lowercase, integer cents, trimmed text, an ET wall time turned into the instant
 * by the shared resolver (DST-correct). Anything else is null: the route answers 400 and never reaches the writer.
 */
import { describe, expect, it } from "vitest";
import {
  manualProvidersValid, MAX_DELIVERY_CENTS, parseDeliveryId, parseDeliverySettingsSave, parseKeepPickup, parseRecordCost, parseRecordJob, parseRecordStatus,
} from "@/lib/delivery/parse-shared";

const SHOP = "00000000-0000-4000-8000-00000000000a", ROW = "00000000-0000-4000-8000-0000000000f1";
const JOB = { expectedShopId: SHOP, providerLabel: "Courier A", bookedVia: "manual" };

describe("ids", () => {
  it("a uuid is made canonical lowercase; anything else is refused", () => {
    expect(parseDeliveryId(SHOP.toUpperCase())).toBe(SHOP);
    expect(parseDeliveryId(` ${SHOP} `)).toBe(SHOP);
    for (const bad of ["", "lead", SHOP.slice(1), `${SHOP}0`, null, undefined, 7, {}, SHOP.replace(/-/g, "")]) expect(parseDeliveryId(bad)).toBeNull();
  });
});

describe("record a job", () => {
  it("the smallest body: no reference, no times, cost UNKNOWN (null, never zero), no note", () => {
    expect(parseRecordJob(JOB)).toEqual({ expectedShopId: SHOP, providerLabel: "Courier A", externalRef: null, bookedVia: "manual", pickupAt: null, dropoffAt: null, costCents: null, note: null });
  });
  it("text is trimmed and an empty one is null; an explicit zero cost is a record", () => {
    expect(parseRecordJob({ ...JOB, providerLabel: "  Courier A ", externalRef: " ", note: "\n", costCents: 0 })).toMatchObject({ providerLabel: "Courier A", externalRef: null, note: null, costCents: 0 });
  });
  it("an ET wall time is the instant, in winter and in summer, and across the fall-back day", () => {
    const at = (date: string, time: string) => parseRecordJob({ ...JOB, pickupAt: { date, time } })?.pickupAt;
    expect(at("2026-11-25", "10:40")).toBe("2026-11-25T15:40:00.000Z"); // EST, UTC-5
    expect(at("2026-07-04", "10:40")).toBe("2026-07-04T14:40:00.000Z"); // EDT, UTC-4
    expect(at("2026-11-01", "11:00")).toBe("2026-11-01T16:00:00.000Z"); // the fall-back Sunday, after 2 AM: EST
    expect(at("2026-03-08", "11:00")).toBe("2026-03-08T15:00:00.000Z"); // the spring-forward Sunday, after 2 AM: EDT
  });
  it("a lead with no shop names null; a missing expectedShopId is not the same thing", () => {
    expect(parseRecordJob({ ...JOB, expectedShopId: null })?.expectedShopId).toBeNull();
    expect(parseRecordJob({ providerLabel: "Courier A", bookedVia: "manual" })).toBeNull();
  });
  it.each([
    ["an unknown key", { ...JOB, locationId: SHOP }],
    ["an API booking", { ...JOB, bookedVia: "co_ops_api" }],
    ["no courier", { ...JOB, providerLabel: "  " }],
    ["a courier name over 40 characters", { ...JOB, providerLabel: "x".repeat(41) }],
    ["a reference over 80 characters", { ...JOB, externalRef: "x".repeat(81) }],
    ["a note over 500 characters", { ...JOB, note: "x".repeat(501) }],
    ["a float cost", { ...JOB, costCents: 30.5 }],
    ["a negative cost", { ...JOB, costCents: -1 }],
    ["a cost as text", { ...JOB, costCents: "3000" }],
    ["a cost past the cap", { ...JOB, costCents: MAX_DELIVERY_CENTS + 1 }],
    ["an ISO string instead of a wall time", { ...JOB, pickupAt: "2026-11-25T10:40:00Z" }],
    ["a wall time with an extra key", { ...JOB, pickupAt: { date: "2026-11-25", time: "10:40", zone: "UTC" } }],
    ["a day that does not exist", { ...JOB, pickupAt: { date: "2026-02-30", time: "10:40" } }],
    ["an hour that does not exist", { ...JOB, dropoffAt: { date: "2026-11-25", time: "24:00" } }],
    ["a time with seconds", { ...JOB, dropoffAt: { date: "2026-11-25", time: "10:40:00" } }],
    ["an array", [JOB]],
    ["null", null],
  ])("refuses %s", (_name, body) => { expect(parseRecordJob(body)).toBeNull(); });
});

describe("a status, a cost, keep-pickup", () => {
  it("a status names the status the person saw and one a PERSON may record", () => {
    expect(parseRecordStatus({ expectedShopId: SHOP, expectedStatus: "accepted", status: "delivered" }))
      .toEqual({ expectedShopId: SHOP, expectedStatus: "accepted", status: "delivered", occurredAt: null, note: null });
    expect(parseRecordStatus({ expectedShopId: SHOP, expectedStatus: "accepted", status: "at_dropoff" })).toBeNull(); // a provider's status
    expect(parseRecordStatus({ expectedShopId: SHOP, expectedStatus: "sent", status: "delivered" })).toBeNull();
    expect(parseRecordStatus({ expectedShopId: SHOP, status: "delivered" })).toBeNull();
    expect(parseRecordStatus({ expectedShopId: SHOP, expectedStatus: "accepted", status: "delivered", jobId: ROW })).toBeNull();
  });
  it("a first cost has no correctsId; a correction names the row; a credit may be negative; cents are integers", () => {
    expect(parseRecordCost({ expectedShopId: SHOP, component: "base", amountCents: 0 })).toEqual({ expectedShopId: SHOP, component: "base", amountCents: 0, correctsId: null, note: null });
    expect(parseRecordCost({ expectedShopId: SHOP, component: "credit", amountCents: -500, correctsId: ROW.toUpperCase(), note: " refund " }))
      .toEqual({ expectedShopId: SHOP, component: "credit", amountCents: -500, correctsId: ROW, note: "refund" });
    for (const bad of [{ component: "tip", amountCents: 100 }, { component: "base", amountCents: 1.5 }, { component: "base" }, { component: "base", amountCents: 100, correctsId: "x" },
      { component: "base", amountCents: 100, semantics: "delta" }]) expect(parseRecordCost({ expectedShopId: SHOP, ...bad })).toBeNull();
  });
  it("keep-pickup names the shop the person saw and nothing else", () => {
    expect(parseKeepPickup({ expectedShopId: SHOP })).toEqual({ expectedShopId: SHOP, note: null });
    expect(parseKeepPickup({ expectedShopId: SHOP, note: "they insisted" })?.note).toBe("they insisted");
    expect(parseKeepPickup({})).toBeNull();
    expect(parseKeepPickup({ expectedShopId: SHOP, leadLocationId: SHOP })).toBeNull();
  });
});

describe("the settings save", () => {
  const body = { locationId: SHOP, values: { enabled: true, manualProviders: ["Courier A", "Courier B"], gratuityDriverBps: 1000 }, expectedUpdatedAt: "2026-11-22T10:00:00.123456+00:00" };
  it("one shop's whole row; the updated_at the person saw rides back UNTOUCHED (its microseconds are the compare-and-set)", () => {
    expect(parseDeliverySettingsSave(body)).toEqual(body);
    expect(parseDeliverySettingsSave({ ...body, expectedUpdatedAt: null })?.expectedUpdatedAt).toBeNull();
  });
  it("the courier list is the database's rule: at most 12, each trimmed, 1 to 40 characters, distinct ignoring case", () => {
    expect(manualProvidersValid([])).toBe(true);
    expect(manualProvidersValid(Array.from({ length: 12 }, (_, i) => `c${i}`))).toBe(true);
    for (const bad of [Array.from({ length: 13 }, (_, i) => `c${i}`), ["a", "A"], ["a "], [""], ["x".repeat(41)], [1], "a", null]) expect(manualProvidersValid(bad)).toBe(false);
  });
  it.each([
    ["a missing head", { locationId: SHOP, values: body.values }],
    ["a head that is not a time", { ...body, expectedUpdatedAt: "yesterday" }],
    ["a share over 100%", { ...body, values: { ...body.values, gratuityDriverBps: 10_001 } }],
    ["a fractional share", { ...body, values: { ...body.values, gratuityDriverBps: 999.5 } }],
    ["a missing value", { ...body, values: { enabled: true, manualProviders: [] } }],
    ["a value that could widen the row", { ...body, values: { ...body.values, updatedBy: SHOP } }],
    ["a shop that is not a uuid", { ...body, locationId: "shop" }],
  ])("refuses %s", (_name, bad) => { expect(parseDeliverySettingsSave(bad)).toBeNull(); });
});
