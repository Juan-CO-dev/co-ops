import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(), create: vi.fn(), share: vi.fn(), swap: vi.fn(), journal: vi.fn(), extra: { setup: vi.fn(), sandwich: vi.fn(), sandwichPreview: vi.fn(), shareSku: vi.fn(), previewSku: vi.fn(), previewRecipe: vi.fn(), shareMenu: vi.fn(), previewMenu: vi.fn(), toast: vi.fn(), swapPreview: vi.fn(), back: vi.fn(), backPreview: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: mocks.step }));
vi.mock("@/lib/catalog/new-item", () => ({ createCatalogItem: mocks.create, setUpItemAtShop: mocks.extra.setup }));
vi.mock("@/lib/catalog/share", () => ({ shareRecipeWithAllShops: mocks.share, shareSkuWithAllShops:mocks.extra.shareSku, previewShareSku:mocks.extra.previewSku, previewShareRecipe:mocks.extra.previewRecipe, shareMenuItemWithAllShops:mocks.extra.shareMenu, previewShareMenuItem:mocks.extra.previewMenu }));
vi.mock("@/lib/catalog/swap-vendor", () => ({ startSkuSwap: mocks.swap, loadLiveSwapsForItem: mocks.journal, previewSkuSwap:mocks.extra.swapPreview, endSkuSwap:mocks.extra.back, previewBackToNormal:mocks.extra.backPreview }));
vi.mock("@/lib/catalog/new-sandwich",()=>({createNewSandwich:mocks.extra.sandwich,previewNewSandwich:mocks.extra.sandwichPreview}));
vi.mock("@/lib/admin/toast-map",async importOriginal=>({...await importOriginal<typeof import("@/lib/admin/toast-map")>(),confirmSandwichToastLink:mocks.extra.toast}));
const id = "11111111-1111-4111-8111-111111111111";
const shop = "22222222-2222-4222-8222-222222222222";
const actor = { level: 8, locations: [shop], user: { id, role: "moo", language: "en" } };
const req = (body: unknown, path = "jobs/new-item", origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/catalog/${path}`, { method: "POST", body: JSON.stringify(body), headers: { origin } });
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(actor); mocks.step.mockReturnValue({ ok: true }); });
describe("catalog jobs HTTP contracts", () => {
  it("requires a session before a job can write", async () => {
    const { POST } = await import("../app/api/admin/catalog/jobs/new-item/route");
    mocks.session.mockResolvedValue(Response.json({ code: "unauthorized" }, { status: 401 }));
    expect((await POST(req({}))).status).toBe(401); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires Tier E and preserves a refusal without calling the job", async () => {
    const { POST } = await import("../app/api/admin/catalog/jobs/new-item/route");
    mocks.step.mockReturnValue({ ok: false, code: "step_up_stale" });
    expect((await POST(req({}))).status).toBe(403); expect(mocks.step).toHaveBeenCalledWith(actor, "E"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires explicit share dependency baselines and owner", async () => {
    const { POST } = await import("../app/api/admin/catalog/recipe/[id]/share/route");
    const response = await POST(req({ expectedOwner: shop, previewToken: "token" }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400); expect(mocks.share).not.toHaveBeenCalled();
  });
  it("returns a plain share result and ignores forged route identities", async () => {
    const { POST } = await import("../app/api/admin/catalog/recipe/[id]/share/route");
    mocks.share.mockResolvedValue({ itemIds: [], skuIds: [] });
    const response = await POST(req({ recipeId: shop, expectedOwner: shop, previewToken: "token", shareItemIds: [], shareSkuIds: [] }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ itemIds: [], skuIds: [] });
    expect(mocks.share.mock.calls[0]?.[1].recipeId).toBe(id);
  });
  it("rejects a swap with omitted scope or token before the engine", async () => {
    const { POST } = await import("../app/api/admin/catalog/sku/[id]/swap/route");
    for (const body of [{ newSkuId: shop, mode: "for_good" }, { newSkuId: shop, mode: "for_good", scope: null }]) {
      expect((await POST(req(body), { params: Promise.resolve({ id }) })).status).toBe(400);
    }
    expect(mocks.swap).not.toHaveBeenCalled();
  });
  it("journal requires a UUID shop query and returns a plain scoped envelope", async () => {
    const { GET } = await import("../app/api/admin/catalog/sku/[id]/swap/route");
    mocks.journal.mockResolvedValue([]);
    expect((await GET(new NextRequest("http://localhost/api/admin/catalog/sku/x/swap"), { params: Promise.resolve({ id }) })).status).toBe(400);
    const response = await GET(new NextRequest(`http://localhost/api/admin/catalog/sku/${id}/swap?shopId=${shop}`), { params: Promise.resolve({ id }) });
    expect(await response.json()).toEqual({ swaps: [] }); expect(mocks.journal).toHaveBeenCalledWith(actor, id, shop); expect(mocks.step).not.toHaveBeenCalled();
  });
});

const routeImports = {
 'jobs/new-item': () => import("../app/api/admin/catalog/jobs/new-item/route"),
 'jobs/new-sandwich': () => import("../app/api/admin/catalog/jobs/new-sandwich/route"),
 'jobs/new-sandwich/preview': () => import("../app/api/admin/catalog/jobs/new-sandwich/preview/route"),
 'sku/[id]/setup': () => import("../app/api/admin/catalog/sku/[id]/setup/route"),
 'sku/[id]/share': () => import("../app/api/admin/catalog/sku/[id]/share/route"),
 'sku/[id]/share/preview': () => import("../app/api/admin/catalog/sku/[id]/share/preview/route"),
 'recipe/[id]/share': () => import("../app/api/admin/catalog/recipe/[id]/share/route"),
 'recipe/[id]/share/preview': () => import("../app/api/admin/catalog/recipe/[id]/share/preview/route"),
 'menu-item/[id]/share': () => import("../app/api/admin/catalog/menu-item/[id]/share/route"),
 'menu-item/[id]/share/preview': () => import("../app/api/admin/catalog/menu-item/[id]/share/preview/route"),
 'menu-item/[id]/toast': () => import("../app/api/admin/catalog/menu-item/[id]/toast/route"),
 'sku/[id]/swap': () => import("../app/api/admin/catalog/sku/[id]/swap/route"),
 'sku/[id]/swap/preview': () => import("../app/api/admin/catalog/sku/[id]/swap/preview/route"),
 'swaps/[swapId]/back-to-normal': () => import("../app/api/admin/catalog/swaps/[swapId]/back-to-normal/route"),
 'swaps/[swapId]/back-to-normal/preview': () => import("../app/api/admin/catalog/swaps/[swapId]/back-to-normal/preview/route"),
};
const endpoints = [
 ["jobs/new-item", "E"], ["jobs/new-sandwich", "E"], ["jobs/new-sandwich/preview", null],
 ["sku/[id]/setup", "E"], ["sku/[id]/share", "E"], ["sku/[id]/share/preview", null],
 ["recipe/[id]/share", "E"], ["recipe/[id]/share/preview", null],
 ["menu-item/[id]/share", "E"], ["menu-item/[id]/share/preview", null],
 ["menu-item/[id]/toast", "A"], ["sku/[id]/swap", "E"], ["sku/[id]/swap/preview", null],
 ["swaps/[swapId]/back-to-normal", "E"], ["swaps/[swapId]/back-to-normal/preview", null],
] as const;
const writeEndpoints = endpoints.filter((entry) => entry[1] !== null);
describe.each(writeEndpoints)("%s same-origin gate", (path) => {
 it("rejects cross-site before session or body work", async () => {
  const route = await routeImports[path]();
  const response = await route.POST(req({}, path, "https://attacker.invalid"), {params:Promise.resolve({id,swapId:id})});
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({error:"bad_origin"});
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.step).not.toHaveBeenCalled();
 });
});
describe.each(endpoints)("%s boundary", (path, tier) => {
 const invoke = async (body: unknown) => {
  const route = await routeImports[path]();
  return route.POST(req(body,path), {params:Promise.resolve({id,swapId:id})}) as Promise<Response>;
 };
 it("requires a session", async () => {
  mocks.session.mockResolvedValue(Response.json({code:"unauthorized"},{status:401}));
  expect((await invoke({})).status).toBe(401);
  expect(mocks.step).not.toHaveBeenCalled();
 });
 it("rejects a below-floor actor", async () => {
  mocks.session.mockResolvedValue({...actor,level:6});
  expect((await invoke({})).status).toBe(403);
 });
 it("rejects social-media role independently of numeric level", async () => {
  mocks.session.mockResolvedValue({...actor,user:{...actor.user,role:"social_media_mgr"}});
  expect((await invoke({})).status).toBe(403);
 });
 it("rejects non-object JSON and preserves the exact tier", async () => {
  expect((await invoke([])).status).toBe(400);
  if(tier) expect(mocks.step).toHaveBeenCalledWith(actor,tier);
  else expect(mocks.step).not.toHaveBeenCalled();
 });
 if(tier) it("does not write through an expired unlock", async () => {
  mocks.step.mockReturnValue({ok:false,code:"step_up_stale"});
  const response=await invoke({});
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("step_up_stale");
 });
});
describe("named route errors", () => {
 it("preserves ownership status, translated text and positional detail", async () => {
  const {ShopOwnedError}=await import("@/lib/catalog/shop-owned-shared");
  const {POST}=await import("../app/api/admin/catalog/recipe/[id]/share/route");
  mocks.share.mockRejectedValue(new ShopOwnedError(400,"line_other_shop","private SQL",{position:3,reason:"line_other_shop"}));
  const response=await POST(req({expectedOwner:shop,previewToken:"token",shareItemIds:[],shareSkuIds:[]}),{params:Promise.resolve({id})});
  const body=await response.json();
  expect(response.status).toBe(400);
  expect(body.code).toBe("line_other_shop");
  expect(body.line).toEqual({position:3,reason:"line_other_shop"});
  expect(body.error).not.toBe("private SQL");
  expect(body.error).not.toBe("line_other_shop");
 });
 it("does not turn an arbitrary status/code object into a public error",async()=>{
  const {catalogError}=await import("../app/api/admin/catalog/job-http");
  const logged=vi.spyOn(console,"error").mockImplementation(()=>{});
  const response=catalogError(actor as never,{status:400,code:"private",message:"secret"});
  expect(response.status).toBe(500); expect(await response.json()).toMatchObject({code:"generic"});
  expect(logged).toHaveBeenCalledWith("catalog request failed",{errorClass:"Object",message:"unexpected catalog failure"});
  expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  logged.mockRestore();
 });
});

describe("created item replay and setup disclosure",()=>{
 const raw=()=>({request_id:id,scope:shop,vendorId:shop,name:"New item",itemNumber:"42",levels:[{label:"case",containsQty:16,containsIndex:null,containsMeasureUnit:"oz"}],unitPrice:12,priceDate:"2026-10-16"});
 it.each(["en","es"] as const)("surfaces replay plainly in %s with HTTP 200",async language=>{
  const {POST}=await import("../app/api/admin/catalog/jobs/new-item/route");
  const {serverT}=await import("@/lib/i18n/server");
  mocks.session.mockResolvedValue({...actor,user:{...actor.user,language}});
  mocks.create.mockResolvedValue({skuId:id,ownerLocationId:shop,replayed:true});
  const response=await POST(req(raw()));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({skuId:id,ownerLocationId:shop,replayed:true,message:serverT(language,"catalog.new_item.replayed")});
 });
 it("new creation is 201 with replayed false",async()=>{
  const {POST}=await import("../app/api/admin/catalog/jobs/new-item/route");
  mocks.create.mockResolvedValue({skuId:id,ownerLocationId:shop,replayed:false});
  const response=await POST(req(raw()));
  expect(response.status).toBe(201);expect(await response.json()).toEqual({skuId:id,ownerLocationId:shop,replayed:false});
 });
 it("does not infer absent recipe setup baselines as null",async()=>{
  const {POST}=await import("../app/api/admin/catalog/sku/[id]/setup/route");
  const response=await POST(req({shopId:shop,step:{kind:"use_in",recipeId:id,quantity:1,unit:"oz"}}),{params:Promise.resolve({id})});
  expect(response.status).toBe(400);expect((await response.json()).field).toBe("version");
 });
});

describe("positive route contracts",()=>{
 const sandwich={locationId:shop,name:"New",menuPrice:12,inputs:[{componentSkuId:id,componentItemId:null,componentProductId:null,quantity:1,unit:"oz",eachContainerLabel:null,portioned:false}]};
 const sharing={expectedOwner:shop,previewToken:"token",shareItemIds:[],shareSkuIds:[]};
 const swapping={newSkuId:shop,scope:shop,mode:"for_now",previewToken:"token"};
 const cases=[
  ["jobs/new-sandwich",sandwich,"sandwich",201,false],
  ["jobs/new-sandwich/preview",sandwich,"sandwichPreview",200,true],
  ["sku/[id]/setup",{shopId:shop,step:{kind:"par",weekdayPar:2,weekendPar:3}},"setup",200,false],
  ["sku/[id]/share",sharing,"shareSku",200,false],
  ["sku/[id]/share/preview",{},"previewSku",200,true],
  ["recipe/[id]/share/preview",{},"previewRecipe",200,true],
  ["menu-item/[id]/share",sharing,"shareMenu",200,false],
  ["menu-item/[id]/share/preview",{},"previewMenu",200,true],
  ["menu-item/[id]/toast",{locationId:shop,toastItemGuid:shop,confirmed:true},"toast",200,false],
  ["sku/[id]/swap/preview",swapping,"swapPreview",200,true],
  ["swaps/[swapId]/back-to-normal",{previewToken:"token"},"back",200,false],
  ["swaps/[swapId]/back-to-normal/preview",{},"backPreview",200,true],
 ] as const;
 it.each(cases)("%s delegates a valid normalized request",async(path,body,name,status,preview)=>{
  const engine=mocks.extra[name];
  const result=name==="setup"?{step:"par",ok:true,detail:{}}:name==="swapPreview"?{ordering:{scope:shop,primarySkuId:shop,parsChanged:false,messageKey:"catalog.swap.ordering_consequence"}}:{marker:true};
  engine.mockResolvedValue(result);
  const route=await routeImports[path]();
  const response=await route.POST(req({...body,id:shop},path),{params:Promise.resolve({id,swapId:id})});
  expect(response.status).toBe(status);
  const actual=await response.json();
  if(name==="shareSku")expect(actual).toEqual({shared:true});
  else if(name==="swapPreview")expect(actual.preview.ordering).toMatchObject({...result.ordering,message:expect.any(String)});
  else expect(actual).toEqual(preview?{preview:result}:result);
  expect(engine).toHaveBeenCalledOnce();expect(engine.mock.calls[0]?.[0]).toEqual(actor);
  if(name==="setup")expect(engine.mock.calls[0]?.[1]).toMatchObject({skuId:id,shopId:shop});
  if(name==="shareSku")expect(engine.mock.calls[0]?.[1]).toMatchObject({skuId:id,expectedOwner:shop});
  if(name==="shareMenu")expect(engine.mock.calls[0]?.[1]).toMatchObject({menuItemId:id,expectedOwner:shop});
  if(name==="toast")expect(engine.mock.calls[0]?.[1]).toEqual({menuItemId:id,locationId:shop,toastItemGuid:shop,confirmed:true});
  if(name==="back")expect(engine).toHaveBeenCalledWith(actor,id,"token");
 });
 it("starts the path SKU and passes the preview token separately",async()=>{
  const {POST}=await routeImports["sku/[id]/swap"]();mocks.swap.mockResolvedValue({swapId:id,productId:shop,versions:[]});
  const response=await POST(req({...swapping,oldSkuId:shop}),{params:Promise.resolve({id})});
  expect(response.status).toBe(201);expect(await response.json()).toEqual({swapId:id,productId:shop,versions:[]});
  expect(mocks.swap).toHaveBeenCalledWith(actor,expect.objectContaining({oldSkuId:id,newSkuId:shop,scope:shop}),"token");
 });
 it("preserves unknown guide-save outcome and translates its disclosure",async()=>{
  const {POST}=await routeImports["sku/[id]/setup"]();
  const result={step:"guide_line",ok:false,detail:{guideId:id,guideCreated:true,lineSaved:null,refreshRequired:true,status:500,code:"generic"}};
  mocks.extra.setup.mockResolvedValue(result);
  const response=await POST(req({shopId:shop,step:{kind:"guide_line",sectionId:id,newSectionName:null}}),{params:Promise.resolve({id})});
  expect(await response.json()).toMatchObject({...result,messageKey:"catalog.setup.guide_unconfirmed",message:expect.any(String)});
 });
 it("returns a message key for every per-day setup refusal",async()=>{
  const {POST}=await routeImports["sku/[id]/setup"]();
  mocks.extra.setup.mockResolvedValue({step:"order_days",ok:false,detail:{outcomes:[{orderDow:1,leadDays:2,ok:false,status:409,code:"rhythm_pair_conflict",refreshRequired:false,messageKey:"admin.vendors.error.rhythm_pair_conflict"}]}});
  const response=await POST(req({shopId:shop,step:{kind:"order_days",days:[{orderDow:1,leadDays:2}]}},"sku/[id]/setup"),{params:Promise.resolve({id})});
  expect(await response.json()).toMatchObject({detail:{outcomes:[{code:"rhythm_pair_conflict",messageKey:"admin.vendors.error.rhythm_pair_conflict"}]}});
 });
});

it("bounds UUID dependency lists",async()=>{
 const {uuidList}=await import("../app/api/admin/catalog/job-http");
 expect(uuidList(Array.from({length:500},()=>id))).toBe(true);
 expect(uuidList(Array.from({length:501},()=>id))).toBe(false);
 const {POST}=await routeImports["recipe/[id]/share"]();
 const response=await POST(req({expectedOwner:shop,previewToken:"token",shareItemIds:Array.from({length:501},()=>id),shareSkuIds:[]},"recipe/[id]/share"),{params:Promise.resolve({id})});
 expect(response.status).toBe(400);
 expect(await response.json()).toMatchObject({code:"invalid_payload"});
 expect(mocks.share).not.toHaveBeenCalled();
});

describe("HTTP namespace mapping",()=>{
 it.each(["en","es"] as const)("preserves every ownership and swap mapper status and translated code in %s",async language=>{
  const owned=await import("@/lib/catalog/shop-owned-shared");
  const swaps=await import("@/lib/catalog/swap-shared");
  const {catalogError}=await import("../app/api/admin/catalog/job-http");
  const {serverT}=await import("@/lib/i18n/server");
  for(const [codes,mapper,statuses,prefix] of [
   [owned.SHOP_OWNED_ERROR_CODES,owned.shopOwnedErrorFromRpc,owned.RPC_STATUS,"shop_owned"],
   [swaps.SWAP_ERROR_CODES,swaps.swapErrorFromRpc,swaps.SWAP_RPC_STATUS,"swap"],
  ] as const){
   for(const code of codes){
    let error:unknown;try{mapper(`${prefix}:${code}`);}catch(e){error=e;}
    const response=catalogError({...actor,user:{...actor.user,language}} as never,error);
    expect(response.status).toBe((statuses as Record<string,number>)[code]);
    expect(await response.json()).toMatchObject({code,error:serverT(language,`catalog.error.${code}` as never)});
   }
  }
 });
 it("uses the existing vendor namespace for a rhythm refusal",async()=>{
  const {VendorRhythmError}=await import("@/lib/vendor-rhythm");
  const {catalogError}=await import("../app/api/admin/catalog/job-http");
  const {serverT}=await import("@/lib/i18n/server");
  const response=catalogError({...actor,user:{...actor.user,language:"es"}} as never,new VendorRhythmError(409,"rhythm_pair_conflict","private"));
  expect(await response.json()).toMatchObject({code:"rhythm_pair_conflict",error:serverT("es","admin.vendors.error.rhythm_pair_conflict")});
 });
});

it("localizes malformed JSON without exposing parser details",async()=>{
 const {POST}=await routeImports["jobs/new-item"]();
 const {serverT}=await import("@/lib/i18n/server");
 mocks.session.mockResolvedValue({...actor,user:{...actor.user,language:"es"}});
 const response=await POST(new NextRequest("http://localhost/api/admin/catalog/jobs/new-item",{method:"POST",body:"{",headers:{origin:"http://localhost"}}));
 expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"invalid_json",error:serverT("es","catalog.error.invalid_json")});
});
