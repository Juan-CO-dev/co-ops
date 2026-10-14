import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #7 (sim walk 2026-10-14): the /catering "Admin & setup" card promised "pricing … & rate
// rules" to a GM who cannot open either. The card now names only what the viewer can open.

const hub = readFileSync("app/(authed)/catering/page.tsx", "utf8");
const admin = readFileSync("app/admin/catering/page.tsx", "utf8");
const floor = (id: string) => Number(new RegExp(`id: "${id}",[^}]*minLevel: ([0-9]+)`).exec(admin)?.[1]);

describe("B8 #7 catering hub admin card", () => {
  it("picks the description by the viewer's level", () => {
    expect(hub).toContain('level >= 8\n    ? "catering.hub.admin_link_desc"\n    : level >= 7 ? "catering.hub.admin_link_desc_gm" : "catering.hub.admin_link_desc_agm"');
  });
  it("the tiers match the admin hub's own floors (drift fails here)", () => {
    expect([floor("pricing"), floor("rate-rules")]).toEqual([8, 8]);
    expect([floor("menu"), floor("capacity"), floor("zones")]).toEqual([7, 7, 7]);
    expect([floor("packages"), floor("faq"), floor("prep-demand"), floor("lto")]).toEqual([6, 6, 6, 6]);
  });
  it("below 8 the copy never promises pricing or rate rules (en + es)", () => {
    for (const key of ["catering.hub.admin_link_desc_gm", "catering.hub.admin_link_desc_agm"] as const) {
      expect(en[key]).not.toMatch(/pricing|rate/i);
      expect(es[key]).not.toMatch(/precio|tarifa/i);
    }
    expect(en["catering.hub.admin_link_desc_agm"]).not.toMatch(/menu|zone|capacity/i);
    expect(es["catering.hub.admin_link_desc_agm"]).not.toMatch(/menú|zona|capacidad/i);
  });
});
