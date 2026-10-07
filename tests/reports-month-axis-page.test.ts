import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks=vi.hoisted(()=>({auth:vi.fn(),load:vi.fn()}));
vi.mock("@/lib/session",()=>({requireSessionFromHeaders:mocks.auth}));
vi.mock("@/lib/supabase-server",()=>({getServiceRoleClient:()=>({})}));
vi.mock("@/lib/reports-trends",async original=>({...await original<typeof import("@/lib/reports-trends")>(),loadTrendSeries:mocks.load}));
vi.mock("@/components/nav/BackLink",()=>({BackLink:()=>null}));

import OpsTrendsPage from "@/app/(authed)/reports/trends/ops/page";

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({user:{id:"owner",language:"en"},role:"owner",level:9,locations:[]});
  const bucket=(key:string)=>({key,hasData:true,underPar:1,overPar:0,tempFlags:0,cashOverShortCents:0,completionPct:100});
  const total={current:1,previous:null,delta:null};
  mocks.load.mockResolvedValue({granularity:"month",current:[bucket("2025-12-01"),bucket("2026-01-01")],previous:null,
    totals:{par:total,temps:total,cash:total,completion:total},cashVisible:true});
});

it("renders localized month and year labels beneath every month chart",async()=>{
  const page=await OpsTrendsPage({searchParams:Promise.resolve({location:"shop",g:"month",range:"custom",from:"2025-12-15",to:"2026-01-07"})});
  const html=renderToStaticMarkup(page);
  expect((html.match(/Dec 2025/g)??[])).toHaveLength(4);
  expect((html.match(/Jan 2026/g)??[])).toHaveLength(4);
  expect((html.match(/class="block">partial/g)??[])).toHaveLength(8);
});
