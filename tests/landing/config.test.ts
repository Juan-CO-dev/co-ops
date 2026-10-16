import { describe, expect, it } from "vitest";
import { loadLandingConfig } from "@/lib/landing/config";
import { getLandingLinks } from "@/lib/landing/links";

describe("central landing configuration", () => {
  it("has distinct official branch links without guessed promotion parameters", () => {
    const config = loadLandingConfig({});
    expect(config.landingHosts).toEqual([]);
    const urls = config.stores.map((s) => new URL(s.orderUrl));
    expect(new Set(urls.map((u) => u.searchParams.get("branchId"))).size).toBe(2);
    for (const url of urls) {
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("complimentsonlysubs.appfront.app");
      expect([...url.searchParams.keys()].sort()).toEqual(["branchId", "servingOptionType"]);
      expect(url.searchParams.get("servingOptionType")).toBe("a");
    }
  });
  it("resolves the inquiry on the existing main site and keeps catering dormant", () => {
    const config = loadLandingConfig({STAFF_ORIGIN: "https://staff.example.com"});
    expect(new URL(getLandingLinks(config).inquiry).hostname).toBe("complimentsonlysubs.com");
    expect(getLandingLinks(config).catering).toBe(config.cateringUrl);
    expect(getLandingLinks({...config, cateringPortalLive:true}).catering).toBe("https://staff.example.com/order");
    expect(() => getLandingLinks({...config, cateringPortalLive:true, staffOrigin:null})).toThrow();
  });
  it("does not invent unconfirmed footer destinations or store facts", () => {
    const config = loadLandingConfig({});
    expect(config.footerLinks).toEqual([]);
    expect(config.stores.every((s) => s.hours === null && s.coordinates === null)).toBe(true);
  });
});
