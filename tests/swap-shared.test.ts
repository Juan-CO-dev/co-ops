import { expect, it } from "vitest";
import { parseSwapRequest, swapLine, SwapError, swapErrorFromRpc } from "@/lib/catalog/swap-shared";
const old = "00000000-0000-4000-8000-000000000001", neu = "00000000-0000-4000-8000-000000000002";
const line = { componentSkuId: old, componentItemId: null, componentProductId: null, quantity: 2, unit: "jar", eachContainerLabel: "jar", portioned: false };
const ctx = { isMeasure: (u: string) => u === "oz", oldOz: () => 32, newOz: () => 16 };
it("carries measures and compatible packs, converts incompatible packs using OLD ounces", () => {
 expect(swapLine({...line, unit:"oz"},neu,ctx)).toMatchObject({ok:true,converted:false,line:{quantity:2,unit:"oz"}});
 expect(swapLine(line,neu,{...ctx,newOz:()=>32})).toMatchObject({ok:true,converted:false});
 expect(swapLine(line,neu,ctx)).toMatchObject({ok:true,converted:true,line:{componentSkuId:neu,quantity:64,unit:"oz",eachContainerLabel:null}});
});
it("refuses unweighable, nonfinite and underflowing pack quantities", () => {
 for (const oz of [null,0,Infinity,NaN,1e-20]) expect(swapLine(line,neu,{...ctx,oldOz:()=>oz})).toEqual({ok:false,reason:"unit_unknown"});
});
it("requires explicit valid scope, IDs and temporary shop scope",()=>{
 expect(parseSwapRequest({newSkuId:neu,mode:"for_good"},old).ok).toBe(false);
 expect(parseSwapRequest({newSkuId:neu,mode:"for_now",scope:null},old).ok).toBe(false);
 expect(parseSwapRequest({newSkuId:neu,mode:"for_good",scope:null},"bad").ok).toBe(false);
 expect(parseSwapRequest({newSkuId:neu,mode:"for_good",scope:null,note:" hi "},old)).toMatchObject({ok:true,request:{note:"hi"}});
});
it("maps exact product_changed to a named 409 and leaves unknown SQL failures internal",()=>{
 expect(()=>swapErrorFromRpc("swap:product_changed")).toThrow(SwapError);
 try {swapErrorFromRpc("swap:product_changed")} catch(e) {expect(e).toMatchObject({status:409,code:"product_changed"})}
 expect(()=>swapErrorFromRpc("swap:unknown")).toThrow("swap RPC failed");
});
