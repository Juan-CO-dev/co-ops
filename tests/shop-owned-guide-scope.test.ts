import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { GET } from "@/app/api/admin/vendors/[id]/order-guide/route";
import { loadOrderGuide } from "@/lib/order-guides";
vi.mock("@/lib/supabase-server",()=>({getServiceRoleClient:vi.fn()}));
vi.mock("@/lib/audit",()=>({audit:vi.fn()}));
vi.mock("@/lib/ordering-sources",()=>({loadStoreVendorIds:async()=>new Set()}));
vi.mock("@/lib/session",()=>({requireSession:async()=>({user:{role:"gm"},locations:["11111111-1111-4111-8111-111111111111"]})}));
const own="11111111-1111-4111-8111-111111111111", foreign="22222222-2222-4222-8222-222222222222";
function setup(){const db=createFakeDb({locations:[{id:own,name:"Own shop",active:true},{id:foreign,name:"Other shop",active:true}],
 vendor_order_guides:[{id:"g",vendor_id:"v",name:"Guide",updated_at:"now"}],order_guide_sections:[{id:"s",guide_id:"g",name:"Section",position:1}],
 vendor_items:[null,own,foreign].map((location_id,i)=>({id:`sku-${i}`,name:`SKU ${i}`,vendor_id:"v",location_id,active:true,item_number:null})),
 order_guide_lines:[0,1,2].map(i=>({id:`line-${i}`,section_id:"s",position:i+1,sku_id:`sku-${i}`,label:`SKU ${i}`,item_number:null,note:null}))});vi.mocked(getServiceRoleClient).mockReturnValue(db.client);return db;}
describe("wired shop guide read",()=>{
 it("GET projects the selected authorized shop and editor reads remain whole",async()=>{setup();const response=await GET(new NextRequest(`https://example.com/api/admin/vendors/v/order-guide?location=${own}`),{params:Promise.resolve({id:"v"})});expect(response.status).toBe(200);const body=await response.json();expect(body.guide.sections[0].lines.map((l:{skuId:string})=>l.skuId)).toEqual(["sku-0","sku-1"]);expect((await loadOrderGuide("v"))!.sections[0]!.lines).toHaveLength(3);});
 it("editor GET includes ownership names and refuses foreign shop request",async()=>{setup();const base="https://example.com/api/admin/vendors/v/order-guide";const response=await GET(new NextRequest(base),{params:Promise.resolve({id:"v"})});expect((await response.json()).ownership).toEqual({"sku-1":"Own shop","sku-2":"Other shop"});const denied=await GET(new NextRequest(`${base}?location=${foreign}`),{params:Promise.resolve({id:"v"})});expect(denied.status).toBe(404);});
});
