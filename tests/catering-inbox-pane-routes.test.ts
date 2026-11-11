import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { handleCateringInbox, reassignCateringInbox, CateringInboxError } from "@/lib/catering/inbox";
import { POST as handle } from "@/app/api/catering/inbox/[id]/handle/route";
import { POST as reassign } from "@/app/api/catering/inbox/[id]/reassign/route";
vi.mock("@/lib/session",()=>({requireSession:vi.fn()}));
vi.mock("@/lib/catering/inbox",async importOriginal=>{
 const actual=await importOriginal<typeof import("@/lib/catering/inbox")>();
 return {...actual,handleCateringInbox:vi.fn(),reassignCateringInbox:vi.fn()};
});
const ctx={user:{id:"actor",role:"gm",active:true},session:{id:"session"}};
const params={params:Promise.resolve({id:"message"})};
const body={expectedRevision:1,requestId:"request"};
function request(payload:unknown,origin="https://example.test") {return new NextRequest("https://example.test/api/catering/inbox/message/handle",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(payload)});}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(requireSession).mockResolvedValue(ctx as never);vi.mocked(handleCateringInbox).mockResolvedValue({revision:2});vi.mocked(reassignCateringInbox).mockResolvedValue({revision:2});});
describe("inbox mutation routes",()=>{
 it.each([handle,reassign])("refuses cross-origin mutation before authentication",async route=>{
  expect((await route(request(body,"https://attacker.test"),params)).status).toBe(403);expect(requireSession).not.toHaveBeenCalled();
 });
 it("passes revision and request ID to handle without step-up",async()=>{
  expect((await handle(request(body),params)).status).toBe(200);expect(handleCateringInbox).toHaveBeenCalledWith(ctx,"message",body);
 });
 it("requires an explicit nullable assignee for reassignment",async()=>{
  expect((await reassign(request(body),params)).status).toBe(400);
  expect((await reassign(request({...body,assignedTo:null}),params)).status).toBe(200);expect(reassignCateringInbox).toHaveBeenCalledWith(ctx,"message",{...body,assignedTo:null});
 });
 it.each([null,[],{}, {expectedRevision:"1",requestId:"request"}])("rejects malformed payload %j",async payload=>{
  expect((await handle(request(payload),params)).status).toBe(400);expect(handleCateringInbox).not.toHaveBeenCalled();
 });
 it("preserves SQL stale revision as conflict",async()=>{
  vi.mocked(handleCateringInbox).mockRejectedValue(new CateringInboxError(409,"stale_revision"));
  const result=await handle(request(body),params);expect(result.status).toBe(409);expect(await result.json()).toMatchObject({code:"stale_revision"});
 });
});
