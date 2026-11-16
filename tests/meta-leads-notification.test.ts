import { describe, expect, it } from "vitest";
import { parseMetaNotifications } from "@/lib/meta-leads/notification-shared";

/** Item 1: the leadgen webhook's ad_id / adgroup_id ride along as ATTRIBUTION, never as identity. */
const body = (value: Record<string, unknown>) => ({ object: "page", entry: [{ id: "22", changes: [{ field: "leadgen", value: {
  leadgen_id: "101", page_id: "22", form_id: "33", created_time: 1_800_000_000, ...value,
} }] }] });
const base = { leadgenId: "101", pageId: "22", formId: "33", createdAt: "2027-01-15T08:00:00.000Z" };

describe("Meta notification ad refs", () => {
  it("keeps numeric ad_id and adgroup_id", () => {
    expect(parseMetaNotifications(body({ ad_id: "555", adgroup_id: "666" }))).toEqual([{ ...base, adId: "555", adgroupId: "666" }]);
  });
  it("leaves both keys out when the webhook carries none (organic leads)", () => {
    const [item] = parseMetaNotifications(body({}))!;
    expect(item).toEqual(base);
    expect("adId" in item! || "adgroupId" in item!).toBe(false);
  });
  it.each(["abc", "", 555, { id: "1" }, "1".repeat(31), " 555", null, true])("a malformed id %j is left out and never fails the notification", bad => {
    const parsed = parseMetaNotifications(body({ ad_id: bad, adgroup_id: bad }));
    expect(parsed).toEqual([base]);
  });
  it("one malformed id does not drop the other", () => {
    expect(parseMetaNotifications(body({ ad_id: "abc", adgroup_id: "666" }))).toEqual([{ ...base, adgroupId: "666" }]);
    expect(parseMetaNotifications(body({ ad_id: "555", adgroup_id: 1 }))).toEqual([{ ...base, adId: "555" }]);
  });
  it("keeps 30 digits, the widest the ledger stores", () => {
    expect(parseMetaNotifications(body({ ad_id: "9".repeat(30) }))).toEqual([{ ...base, adId: "9".repeat(30) }]);
  });
  it("identity checks are unchanged: a bad leadgen, form or page id still refuses the whole payload", () => {
    for (const bad of [{ leadgen_id: "x" }, { form_id: "" }, { page_id: "23" }, { created_time: "soon" }]) {
      expect(parseMetaNotifications(body({ ad_id: "555", ...bad }))).toBeNull();
    }
  });
});
