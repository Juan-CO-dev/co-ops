import { describe, expect, it } from "vitest";
import { assessProbe } from "../live/landing-links.probe";
describe("launch link evidence", () => {
  const baseline = {host:"orders.example.com",branchId:"branch-a",digest:"known"};
  const ok = {status:200,finalUrl:"https://orders.example.com/order/",redirected:false,challenged:false,branchIds:["branch-a","branch-b"],digest:"known"};
  it("requires branch payload evidence, never an HTTP 200 shell alone",()=>{
    expect(assessProbe(ok,baseline)).toEqual([]);
    expect(assessProbe({...ok,branchIds:[]},baseline)).toContain("missing-branch");
  });
  it.each([
    [{status:403},"http-status"], [{status:429},"http-status"], [{challenged:true},"challenge"], [{redirected:true},"redirect-review"], [{finalUrl:"https://foreign.example.com/"},"host-drift"], [{digest:"changed"},"digest-drift"],
  ])("refuses drift/challenge evidence %j",(mutation,reason)=>expect(assessProbe({...ok,...mutation},baseline)).toContain(reason));
});
