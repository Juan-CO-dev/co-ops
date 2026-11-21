/**
 * Nav PR 3, guard (f) (plan r5, 4.6; spec 8.1): the social media manager resolves to exactly Dashboard, Training,
 * My performance and Me, whatever level a session claims and whatever switches are on, and never to a page tagged
 * `numbers`.
 *
 * Scope, stated: this is a property of the LIST. Today's chip row (navDestinationsFor, level only) still shows a
 * level-6 social media manager every level-6 chip, including Reports, Trends and Written reports, which nav S1 now
 * refuses at the page. PR 3 changes nothing visible; by lead decision 5 the chip fix is PR 4's own commit (the chip
 * row applies reportsRoleAllowed), and PR 3's legacy snapshot records today's rows so that diff shows exactly them.
 */
import { describe, expect, it } from "vitest";
import { DESTINATIONS, byId } from "@/lib/nav/destinations";
import { ROLE_MENUS, destinationsFor } from "@/lib/nav/resolve";
import type { SwitchName, Switches } from "@/lib/nav/types";

const SWITCH_NAMES: SwitchName[] = ["pulseV2", "vault", "businessReport", "demandSignals", "marketingScorecard", "customerProfiles"];
const SWITCH_COMBOS: Switches[] = Array.from({ length: 64 }, (_, n) => Object.fromEntries(SWITCH_NAMES.map((s, i) => [s, ((n >> i) & 1) === 1])));
const FOUR = ["dashboard", "me", "my-feedback", "training"];

describe("guard (f): the social media manager's list", () => {
  it("exactly the four, at every level 0..10 and every one of the 64 switch combinations", () => {
    for (let level = 0; level <= 10; level++) for (const switches of SWITCH_COMBOS) {
      const ids = destinationsFor({ role: "social_media_mgr", level, switches }).map((d) => d.id).sort();
      expect(ids, `level ${level} ${JSON.stringify(switches)}`).toEqual(FOUR);
    }
  });

  it("Vault is absent even with the vault switch on (spec 8.1: exactly four; Vault is a row inside Me after M4)", () => {
    const ids = destinationsFor({ role: "social_media_mgr", level: 6, switches: { vault: true } }).map((d) => d.id);
    expect(ids).not.toContain("vault");
  });

  it("none of the four, and nothing in the role's menu, is tagged numbers", () => {
    for (const id of ROLE_MENUS.social_media_mgr ?? []) expect(byId(id).numbers, id).toBe(false);
  });

  it("the numbers line holds on its own: a menu widened to Reports and Cash still yields the four", () => {
    const menus = { social_media_mgr: [...FOUR, "reports", "cash"] };
    const ids = destinationsFor({ role: "social_media_mgr", level: 10, switches: {} }, DESTINATIONS, menus).map((d) => d.id).sort();
    expect(ids).toEqual(FOUR);
  });

  it("and a list where Training is retagged numbers drops Training", () => {
    const list = DESTINATIONS.map((d) => (d.id === "training" ? { ...d, numbers: true } : d));
    const ids = destinationsFor({ role: "social_media_mgr", level: 6, switches: {} }, list).map((d) => d.id).sort();
    expect(ids).toEqual(["dashboard", "me", "my-feedback"]);
  });

  it("ROLE_MENUS is closed: one key, the social media manager", () => {
    expect(Object.keys(ROLE_MENUS)).toEqual(["social_media_mgr"]);
  });

  it("'Me' is the destination at /settings; its key still reads Settings until merge M4 (nav PR 10)", () => {
    // The destination is asserted, never the word: M4 changes the key's value and tests/nav-names.test.ts's
    // DEFERRED entry, and this test does not change.
    expect(byId("me").route).toBe("/settings");
    expect(byId("me").nameKey).toBe("nav.settings");
  });

  it("the Dashboard is in the list by spec and tagged numbers: false", () => {
    // That tag is true of the page the role gets from nav PR 7 (its own lens, spec 3.3.6; PR 7's payload test, spec
    // 3.7 group 13), not of today's Dashboard for a level-6 viewer. The tag is not the protection; the lens and S1/S2 are.
    expect(byId("dashboard").numbers).toBe(false);
  });
});
