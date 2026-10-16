import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/toast-sales/consumption/route";
const own = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/session", () => ({ requireSession: async () => ({ user: { role: "owner" }, level: 9, locations: [] }) }));
vi.mock("@/lib/catering/toast-sales", () => ({
  TOAST_SALES_READ_MIN: 6, AdminToastSalesError: class extends Error {},
  salesConsumption: async () => ({ rows: [] }), listExclusions: async () => [],
}));
vi.mock("@/lib/admin/toast-map", () => ({ listMappableEntities: async () => [
  { id: "shared", locationId: null },
  { id: "own", locationId: "11111111-1111-4111-8111-111111111111" },
  { id: "foreign", locationId: "22222222-2222-4222-8222-222222222222" },
] }));
it("the shop consumption API returns shared and own picker entities only", async () => {
  const response = await GET(new NextRequest(`http://localhost/api/admin/toast-sales/consumption?locationId=${own}&date=2026-10-15`));
  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json.entities.map((e: { id: string }) => e.id)).toEqual(["shared", "own"]);
});
