import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), written: vi.fn(), team: vi.fn(), ops: vi.fn(), service: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: mocks.auth }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("next/navigation", () => ({ redirect: (path:string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/written-reports", () => ({ listWrittenReports: mocks.written, WRITTEN_REPORT_WRITE_MIN_LEVEL: 3 }));
vi.mock("@/lib/team-metrics", () => ({ loadTeamOperatingHealth: mocks.team, TEAM_VIEW_LEVEL: 6 }));
vi.mock("@/lib/reports-trends", async (original) => ({ ...await original<typeof import("@/lib/reports-trends")>(), loadTrendSeries: mocks.ops }));
vi.mock("@/components/written-reports/WrittenReportsClient", () => ({ WrittenReportsClient: () => null }));
vi.mock("@/components/nav/BackLink", () => ({ BackLink: () => null }));
vi.mock("@/components/team/TrendsLanding", () => ({ TrendsLanding: () => null }));
vi.mock("@/components/trends/TrendShopPanels", () => ({ TrendShopPanels: () => null }));

import WrittenPage from "@/app/(authed)/reports/written/page";
import TrendsPage from "@/app/(authed)/reports/trends/page";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.auth.mockResolvedValue({ user:{id:"me",language:"en"},role:"employee",level:3,locations:["shop"] });
  mocks.service.mockReturnValue({});
});

describe("reports page review regressions", () => {
  it.each(["other-shop", "all", "invalid,location"])("redirects unauthorized written location %s before the loader", async location => {
    await expect(WrittenPage({searchParams:Promise.resolve({location})})).rejects.toThrow("REDIRECT:/reports/written");
    expect(mocks.written).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("redirects malformed location even for an all-shop viewer", async () => {
    mocks.auth.mockResolvedValue({ user:{id:"me",language:"en"},role:"owner",level:9,locations:[] });
    await expect(WrittenPage({searchParams:Promise.resolve({location:"invalid,location"})})).rejects.toThrow("REDIRECT:/reports/written");
    expect(mocks.written).not.toHaveBeenCalled();
  });
  it("always compares the landing team panel even when operations comparison is off", async () => {
    mocks.auth.mockResolvedValue({user:{id:"me",language:"en"},role:"agm",level:6,locations:["shop"]});
    mocks.ops.mockResolvedValue({totals:{par:{current:0},temps:{current:0}}});
    mocks.team.mockResolvedValue(null);
    await TrendsPage({searchParams:Promise.resolve({location:"shop",compare:"false"})});
    expect(mocks.ops).toHaveBeenCalledWith({},expect.objectContaining({compare:false,range:expect.objectContaining({compare:false})}));
    expect(mocks.team).toHaveBeenCalledWith({},expect.objectContaining({compare:true,range:expect.objectContaining({compare:true})}));
  });
});
