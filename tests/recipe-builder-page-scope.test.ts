import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
vi.mock("next/navigation",()=>({redirect:()=>{throw new Error("redirect")},notFound:()=>{throw new Error("not found")}}));
vi.mock("@/lib/session",()=>({requireSessionFromHeaders:vi.fn(async()=>({user:{role:"gm",language:"en"},locations:["shop"]}))}));
vi.mock("@/lib/recipes",()=>({RECIPE_READ_MIN:6,loadRecipe:vi.fn(async()=>({id:"recipe",ownerLocationId:"owner",outputs:[]}))}));
vi.mock("@/lib/admin/readiness-load",()=>({loadGraphReadiness:async()=>({recipeReadiness:new Map()})}));
vi.mock("@/lib/admin/recipe-builder-data",()=>({loadRecipeBuilderScope:vi.fn(async(_a,requested,_create,owner)=>({scope:owner??requested,shops:[],allowGlobal:false})),loadRecipeBuilderCatalog:vi.fn(async()=>({skus:[],items:[],outputItems:[],products:[],unitOptions:[],measures:new Map(),activeMeasureLabels:[]}))}));
vi.mock("@/lib/supabase-server",()=>({getServiceRoleClient:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,returns:async()=>({data:[{id:"shop-a",name:"Shop A"},{id:"shop-b",name:"Shop B"}],error:null})};return {from:()=>q};}}));
vi.mock("@/components/admin/recipes/RecipeBuilder",()=>({RecipeBuilder:()=>null}));
import {requireSessionFromHeaders} from "@/lib/session";
import NewPage from "@/app/admin/recipes/new/page";
import DetailPage from "@/app/admin/recipes/[id]/page";
import {loadRecipeBuilderCatalog} from "@/lib/admin/recipe-builder-data";
function builder(tree:ReactElement){return (tree.props as {children:ReactElement[]}).children.find(e=>e?.key?.includes(":"))!;}
describe("builder server scope navigation",()=>{
 it("renders explicit choices before loading any catalog for an ambiguous creation scope",async()=>{
  vi.mocked(requireSessionFromHeaders).mockResolvedValueOnce({user:{role:"gm",language:"en"},locations:["shop-a","shop-b"]} as never);
  vi.mocked(loadRecipeBuilderCatalog).mockClear();
  const tree=await NewPage({searchParams:Promise.resolve({})});
  const children=(tree.props as {children:ReactElement[]}).children;
  const choices=(children[1]!.props as {children:ReactElement[]}).children[0] as unknown as ReactElement[];
  expect(choices.map(e=>(e.props as {href:string}).href)).toEqual(["/admin/recipes/new?location=shop-a&type=production","/admin/recipes/new?location=shop-b&type=production"]);
  expect(loadRecipeBuilderCatalog).not.toHaveBeenCalled();
 });
 it("reloads new props with a different key so drafts and inline state remount",async()=>{
 const a=builder(await NewPage({searchParams:Promise.resolve({location:"shop-a"})}));
 const b=builder(await NewPage({searchParams:Promise.resolve({location:"shop-b"})}));
 expect(a.key).toBe("new:shop-a");expect(b.key).toBe("new:shop-b");expect((b.props as {locationId:string}).locationId).toBe("shop-b");
 expect(loadRecipeBuilderCatalog).toHaveBeenLastCalledWith(expect.anything(),"shop-b","shop-b");
 });
 it("detail loads owner scope rather than an unrelated requested shop",async()=>{
 const result=builder(await DetailPage({params:Promise.resolve({id:"recipe"}),searchParams:Promise.resolve({location:"foreign"})}));expect(result.key).toBe("recipe:owner");expect(loadRecipeBuilderCatalog).toHaveBeenLastCalledWith(expect.anything(),"owner","owner");
 });
 it("scope selection navigates and locks the entire form until the server remount",()=>{
 const src=readFileSync("components/admin/recipes/RecipeBuilder.tsx","utf8");expect(src).toContain("setScopePending(true)");expect(src).toContain('router.push(`${path}?location=');expect(src).toContain('<fieldset disabled={scopePending}');expect(src).toContain('disabled={scopePending || saveBusy || !draftSaveEnabled}');
 });
});
