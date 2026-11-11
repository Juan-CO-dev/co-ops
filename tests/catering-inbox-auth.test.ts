import { expect, it } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import { canReadCateringInbox, canAssignCateringInbox, inboxGroup } from "@/lib/catering/inbox-shared";
it("J1/J2 gate covers every role, null shops, foreign shops and inactive staff", () => {
  for (const role of Object.keys(ROLES) as RoleCode[]) {
    const global = ["catering_mgr", "moo", "owner", "cgs"].includes(role);
    const actor = { role, active: true, locations: ["mine"] };
    expect(canReadCateringInbox(actor, "mine"), role).toBe(global || role === "gm");
    expect(canReadCateringInbox(actor, "other"), role).toBe(global);
    expect(canReadCateringInbox(actor, null), role).toBe(global);
    expect(canAssignCateringInbox({ ...actor, active: false }, "mine"), role).toBe(false);
    expect(canReadCateringInbox({ ...actor, locations: [] }, "mine"), role).toBe(global);
  }
});
it("recorded work stays visible with human work", () => {
  expect(inboxGroup("recorded")).toBe("needs_reply"); expect(inboxGroup("needs_human")).toBe("needs_reply");
  expect(inboxGroup("notification")).toBe("notifications"); expect(inboxGroup("handled")).toBe("handled");
});
