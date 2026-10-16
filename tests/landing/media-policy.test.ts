import { expect, it } from "vitest";
import { shouldLoadMotion, shouldPlayMotion } from "@/lib/landing/media-policy-shared";
const ready={lcpReady:true,triggered:true,visible:true,documentVisible:true,reducedMotion:false,saveData:false,failed:false,paused:false};
it("requires LCP and a user/visibility trigger before download",()=>{
 expect(shouldLoadMotion(ready)).toBe(true);
 for(const key of ["lcpReady","triggered","visible","documentVisible"] as const)expect(shouldLoadMotion({...ready,[key]:false})).toBe(false);
 for(const key of ["reducedMotion","saveData","failed"] as const)expect(shouldLoadMotion({...ready,[key]:true})).toBe(false);
});
it("pauses offscreen, hidden and on explicit pause without discarding fallback",()=>{
 expect(shouldPlayMotion(ready)).toBe(true);
 for(const key of ["visible","documentVisible"] as const)expect(shouldPlayMotion({...ready,[key]:false})).toBe(false);
 expect(shouldPlayMotion({...ready,paused:true})).toBe(false);
});
