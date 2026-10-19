import { describe, expect, it } from "vitest";
import { loadLandingConfig } from "@/lib/landing/config";
import { getLandingLinks } from "@/lib/landing/links";
import { landingTenantConfig } from '@/config/tenant/landing';

describe("central landing configuration", () => {
  it('filters config-inactive shops before deriving public links or geolocation',()=>{
    const config=loadLandingConfig({}, {...landingTenantConfig,stores:landingTenantConfig.stores.map(store=>({...store,active:store.key==='capitol-hill'}))});
    expect(config.stores.map(store=>store.key)).toEqual(['capitol-hill']);
    expect(config.nearbyEnabled).toBe(false);
  });
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
  it("pins verified public facts and official footer links", () => {
    const config = loadLandingConfig({});
    expect(config.footerLinks).toEqual([
 {key:"app",url:"https://order.complimentsonlysubs.com/"},
 {key:"instagram",url:"https://www.instagram.com/complimentsonlysubs/"},
 {key:"careers",url:"https://tmt.spotapps.co/job-listings?spot_id=401740"},
 {key:"doordash",url:"https://order.online/business/compliments-only-11187127"},
 {key:"uber-eats",url:"https://www.ubereats.com/store/compliments-only-dupont-circle/gEXGz9LhW5K7vNG69G9aDQ"}
 ]);
    expect(config.stores.map(store=>[store.active,store.phoneDisplay])).toEqual([[true,'(202) 621-8645'],[true,'(202) 794-4638']]);
    expect(config.stores.map(s=>[s.phone,s.openingHours,s.coordinates])).toEqual([
 ["+12026218645",{days:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],opens:"10:30",closes:"18:00"},{latitude:38.8817492,longitude:-76.9947597}],
 ["+12027944638",{days:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],opens:"10:30",closes:"20:00"},{latitude:38.9098292,longitude:-77.0462506}]
 ]);
 expect(config.nearbyEnabled).toBe(true);
  });
});
