import { expect, it, vi } from "vitest";
vi.mock("next/headers",()=>({headers:async()=>new Headers({host:"eat.example.test","x-landing-language":process.env.TEST_LANGUAGE ?? "en","x-landing-path":"/"})}));
import LandingLayout, { generateMetadata, viewport } from "@/app/eat/layout";
import * as hostPolicy from "@/lib/landing/host-shared";
it.each(["en","es"])("owns public metadata in %s",async language=>{
 vi.stubEnv("LANDING_HOSTS","eat.example.test");vi.stubEnv("SITE_ORIGIN","https://eat.example.test");vi.stubEnv("STAFF_ORIGIN","https://staff.example.test");vi.stubEnv("TEST_LANGUAGE",language);
 try {const result=await generateMetadata();expect(result.description).toBeTruthy();expect(result.openGraph).toHaveProperty("description",result.description);expect(new URL(result.metadataBase!.toString()).origin).toBe("https://eat.example.test");expect(result.alternates?.canonical).toBe(`https://eat.example.test/?lang=${language}`);expect(JSON.stringify(result)).not.toContain("Operations Platform");}finally{vi.unstubAllEnvs();}
});
it("refuses metadata and layout when the independently derived origin is invalid", async () => {
 vi.stubEnv("LANDING_HOSTS","eat.example.test");vi.stubEnv("SITE_ORIGIN","https://eat.example.test");vi.stubEnv("STAFF_ORIGIN","https://staff.example.test");
 const origin = vi.spyOn(hostPolicy, "configuredOrigin").mockReturnValue(null);
 try {
  await expect(generateMetadata()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  await expect(LandingLayout({children:null})).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
 } finally { origin.mockRestore(); vi.unstubAllEnvs(); }
});

it('uses the approved brand share card and landing-only theme', async () => {
 vi.stubEnv('LANDING_HOSTS','eat.example.test'); vi.stubEnv('SITE_ORIGIN','https://eat.example.test'); vi.stubEnv('STAFF_ORIGIN','https://staff.example.test');
 try {
  const result = await generateMetadata();
  expect(result.openGraph).toHaveProperty('images', [{url:'/brand/og-card.webp',width:1200,height:630}]);
  expect(result.twitter).toHaveProperty('images', ['/brand/og-card.webp']);
  expect(result.robots).toEqual({index:false,follow:false});
  expect(viewport).toEqual({themeColor:'#FFF9E4'});
 } finally { vi.unstubAllEnvs(); }
});
