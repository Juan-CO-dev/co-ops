import { describe, it, expect, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import type { AuthContext } from "@/lib/session";
vi.mock("@/lib/supabase-server", () => ({getServiceRoleClient:vi.fn()}));
vi.mock("@/lib/products", () => ({loadProductIndex:vi.fn(async () => ({index:{resolution:new Map([["visible-product",{skuId:"own"}]])}}))}));
vi.mock("@/lib/prep-consumption", () => ({loadSkuPackChains:vi.fn(async () => new Map())}));
vi.mock("@/lib/admin/cost", () => ({loadCurrentSkuPrices:vi.fn(async () => new Map())}));
const own="11111111-1111-4111-8111-111111111111", foreign="22222222-2222-4222-8222-222222222222";
const actor={user:{role:"gm"},level:7,locations:[own]} as AuthContext;
function setup(){
 const leaves=[null,own,foreign].map((location_id,i)=>({id:["shared","own","foreign"][i],name:`Item ${i}`,location_id,active:true,inventory_only:false}));
 const db=createFakeDb({locations:[{id:own,active:true}],vendor_items:leaves,items:leaves,products:[{id:"visible-product",name:"Visible",active:true},{id:"hidden-product",name:"Hidden",active:true}],units:[],measure_units:[],vendors:[]});
 vi.mocked(getServiceRoleClient).mockReturnValue(db.client);return db;
}
describe("legacy builder scoped picker",()=>{
 it("filters ingredients and resolves product eligibility; owned outputs are stricter",async()=>{
  setup(); const catalog=await loadRecipeBuilderCatalog(actor,own,own);
  expect(catalog.skus.map(s=>s.id)).toEqual(["shared","own"]);
  expect(catalog.items.map(s=>s.id)).toEqual(["shared","own"]);
  expect(catalog.products.map(s=>s.id)).toEqual(["visible-product"]);
  expect(catalog.outputItems.map(s=>s.id)).toEqual(["own"]);
 });
 it("refuses a foreign scope before reading catalog leaves",async()=>{
  const db=setup();await expect(loadRecipeBuilderCatalog(actor,foreign)).rejects.toThrow();expect(db.log).toHaveLength(0);
 });
});
