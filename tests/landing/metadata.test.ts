import { expect, it, vi } from "vitest";
vi.mock("next/headers",()=>({headers:async()=>new Headers({host:"eat.example.test","x-landing-language":process.env.TEST_LANGUAGE ?? "en","x-landing-path":"/"})}));
import { generateMetadata } from "@/app/eat/layout";
it.each(["en","es"])("owns public metadata in %s",async language=>{
 vi.stubEnv("LANDING_HOSTS","eat.example.test");vi.stubEnv("SITE_ORIGIN","https://eat.example.test");vi.stubEnv("STAFF_ORIGIN","https://staff.example.test");vi.stubEnv("TEST_LANGUAGE",language);
 try {const result=await generateMetadata();expect(result.description).toBeTruthy();expect(result.openGraph).toHaveProperty("description",result.description);expect(new URL(result.metadataBase!.toString()).origin).toBe("https://eat.example.test");expect(result.alternates?.canonical).toBe(`https://eat.example.test/?lang=${language}`);expect(JSON.stringify(result)).not.toContain("Operations Platform");}finally{vi.unstubAllEnvs();}
});
