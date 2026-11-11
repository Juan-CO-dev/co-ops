// Build 2, A1: the PUBLIC /order/start intake parser never emits pipelineId (only the Meta worker may
// steer a draft onto an existing lead, on a token it mints itself).
import { expect, it } from "vitest";
import { parsePublicIntake } from "@/lib/portal/intake-parser";

const LOC = "11111111-1111-4111-8111-111111111111";
it("strips pipelineId (and every unknown key) from a public intake", () => {
  const parsed = parsePublicIntake({ locationId: LOC, contactName: " Guest ", pipelineId: "22222222-2222-4222-8222-222222222222", pipeline_id: "x", customerId: "y", headcount: 12, isDelivery: true });
  expect(parsed).toMatchObject({ locationId: LOC, contactName: "Guest", headcount: 12, isDelivery: true });
  expect(parsed).not.toHaveProperty("pipelineId");
  expect(Object.keys(parsed!).sort()).toEqual(["company", "contactName", "contactPhone", "deliveryAddress", "dietaryNotes", "dropoffDoor", "eventDate", "eventName", "eventType", "fulfillmentRouted", "geoLat", "geoLng", "headcount", "isDelivery", "locationId", "preselect", "timeWindow"]);
});
it("keeps today's shape rules: a missing location or name is null, caps and preselect unchanged", () => {
  expect(parsePublicIntake({ contactName: "Guest" })).toBeNull();
  expect(parsePublicIntake({ locationId: LOC })).toBeNull();
  expect(parsePublicIntake({ locationId: LOC, contactName: "x".repeat(300), company: "y".repeat(300), headcount: -1, geoLat: 95, preselect: [{ itemId: LOC, quantity: 2 }, { quantity: 1 }] }))
    .toMatchObject({ contactName: "x".repeat(200), company: "y".repeat(200), headcount: null, geoLat: null, preselect: [{ itemId: LOC, quantity: 2 }] });
});
