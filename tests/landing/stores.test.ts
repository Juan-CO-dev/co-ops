import { expect, it } from "vitest";
import { PUBLIC_LOCATION_COLUMNS, projectLandingStores } from "@/lib/landing/stores";
it("projects only configured public locations without extra integration fields", () => {
  const rows = [{code:"MEP",name:"Shop A",address:"Public street",phone:"+12025550100",toast_restaurant_guid:"private"},{code:"OTHER",name:"Hidden shop",address:null,phone:null}];
  expect(PUBLIC_LOCATION_COLUMNS).toBe("code,name,address,phone");
  const stores = projectLandingStores(rows);
  expect(stores).toHaveLength(1);
  expect(stores[0]).toMatchObject({key:"capitol-hill",name:"Shop A",address:"Public street",phone:"+12025550100",hours:null,coordinates:null});
  expect(stores[0]).not.toHaveProperty("toast_restaurant_guid");
});
