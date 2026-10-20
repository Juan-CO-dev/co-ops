import { expect, it } from "vitest";
import { PUBLIC_LOCATION_COLUMNS, projectLandingStores } from "@/lib/landing/stores";
it("projects only configured public locations without extra integration fields", () => {
  const rows = [{code:"MEP",name:"Shop A",address:"Public street",phone:"+12025550100",toast_restaurant_guid:"private"},{code:"OTHER",name:"Hidden shop",address:null,phone:null}];
  expect(PUBLIC_LOCATION_COLUMNS).toBe("code,name,address,phone,active");
  const stores = projectLandingStores(rows);
  expect(stores).toHaveLength(1);
  expect(stores[0]).toMatchObject({key:"capitol-hill",name:"Capitol Hill",address:"526 8th St SE Ste A, Washington, DC 20003",phone:"+12026218645",coordinates:{latitude:38.8817492,longitude:-76.9947597}});
  expect(stores[0]).not.toHaveProperty("toast_restaurant_guid");
});

it("does not resurrect a missing or explicitly inactive shop", () => {
 expect(projectLandingStores([])).toEqual([]);
 expect(projectLandingStores([{code:"MEP",name:"inactive",address:null,phone:null,active:false}])).toEqual([]);
});

it("shares structured facts and complete address destinations with public rendering", () => {
 const stores=projectLandingStores([{code:"MEP",name:"old",address:null,phone:null},{code:"EM",name:"old",address:null,phone:null}]);
 expect(stores.map(s=>s.structuredAddress)).toEqual([
 {streetAddress:"526 8th St SE Ste A",addressLocality:"Washington",addressRegion:"DC",postalCode:"20003",addressCountry:"US"},
 {streetAddress:"2029 P St NW Front 1",addressLocality:"Washington",addressRegion:"DC",postalCode:"20036",addressCountry:"US"}
 ]);
 for (const store of stores) {
   expect(new URL(store.directionsUrl).searchParams.get("destination")).toBe(store.address);
   expect(store.hours?.en).toMatch(/^Daily 10:30am/);
   expect(store.hours?.es).toContain("10:30 a. m.");
   expect(Object.keys(store).sort()).toEqual(["key","name","orderLabel","address","street","phone","phoneDisplay","uberEatsUrl","structuredAddress","openingHours","directionsUrl","hours","coordinates","orderUrl"].sort());
 }
});
