import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({session:vi.fn(),act:vi.fn(),forward:vi.fn()}));
vi.mock("@/lib/session",()=>({requireSession:mocks.session}));
vi.mock("@/lib/vendor-mail-actions",()=>({actOnVendorMail:mocks.act}));
vi.mock("@/lib/vendor-mail-forward",()=>({forwardVendorMail:mocks.forward}));
import { POST as handle } from "@/app/api/operations/vendor-mail/[id]/handle/route";
import { POST as assign } from "@/app/api/operations/vendor-mail/[id]/assign/route";
import { POST as redrive } from "@/app/api/operations/vendor-mail/[id]/redrive/route";
import { POST as forward } from "@/app/api/operations/vendor-mail/[id]/forward/route";
import { VendorMailError } from "@/lib/vendor-mail";
const params={params:Promise.resolve({id:"11111111-1111-4111-8111-111111111111"})};
function request(body:unknown,origin="https://co.test") {return new NextRequest("https://co.test/api/operations/vendor-mail/id/handle",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({user:{id:"actor"}});mocks.act.mockResolvedValue({revision:2});mocks.forward.mockResolvedValue({revision:2,outcome:"accepted"});});
it.each([handle,assign,redrive,forward])("rejects cross origin before session/action",async route=>{
 expect((await route(request({},"https://other.test"),params)).status).toBe(403);
 expect(mocks.session).not.toHaveBeenCalled();expect(mocks.act).not.toHaveBeenCalled();expect(mocks.forward).not.toHaveBeenCalled();
});
it.each([handle,assign,redrive,forward])("rejects malformed payload",async route=>{
 expect((await route(request(null),params)).status).toBe(400);
});
it("forwards request/revision and reason without step-up",async()=>{
 const body={request_id:"22222222-2222-4222-8222-222222222222",expected_revision:1,reason:"Called vendor"};
 expect((await handle(request(body),params)).status).toBe(200);
 expect(mocks.act).toHaveBeenCalledWith(expect.anything(),expect.any(String),"handle",body,{reason:"Called vendor"});
});
it("returns named revision refusal",async()=>{
 mocks.act.mockRejectedValue(new VendorMailError(409,"stale_revision"));
 const response=await redrive(request({expected_revision:1,request_id:"request"}),params);
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:"stale_revision"});
});
