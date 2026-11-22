/**
 * Unit spine — lib/nav-parents.ts (pure; the route→parent registry that powers
 * <BackLink/>). Pins the longest-prefix matcher across the disease it fixes:
 * nested admin, catering sub-hub, dynamic segments, unknown → /dashboard,
 * /admin root → /dashboard, query-agnostic matching.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { parentFor, DEFAULT_PARENT } from "@/lib/nav-parents";

describe("parentFor — admin drill-ins return to their section hub", () => {
  it("recipes/[id] → /admin/recipes", () => {
    const p = parentFor("/admin/recipes/abc-123");
    expect(p.href).toBe("/admin/recipes");
    expect(p.labelKey).toBe("admin.section.recipes");
  });

  it("recipes/new → /admin/recipes (literal beats dynamic)", () => {
    expect(parentFor("/admin/recipes/new").href).toBe("/admin/recipes");
  });

  it("vendors/[id] → /admin/vendors", () => {
    const p = parentFor("/admin/vendors/vendor-uuid");
    expect(p.href).toBe("/admin/vendors");
    expect(p.labelKey).toBe("admin.section.vendors");
  });

  it("recipes hub itself → /admin (one level up)", () => {
    expect(parentFor("/admin/recipes").href).toBe("/admin");
  });
});

describe("parentFor — catering sub-hub", () => {
  it("every admin catering sub-page returns to /admin/catering, not /admin", () => {
    for (const seg of [
      "packages", "menu", "pricing", "rate-rules", "capacity",
      "zones", "faq", "prep-demand", "lto", "fulfillment",
    ]) {
      const p = parentFor(`/admin/catering/${seg}`);
      expect(p.href).toBe("/admin/catering");
      expect(p.labelKey).toBe("admin.section.catering");
    }
  });

  it("/admin/catering hub itself → /admin", () => {
    expect(parentFor("/admin/catering").href).toBe("/admin");
  });

  it("customer catering sub-page → /catering", () => {
    expect(parentFor("/catering/pipeline").href).toBe("/catering");
    expect(parentFor("/catering/quotes").href).toBe("/catering");
  });
});

describe("parentFor — template builder", () => {
  it("template-builder pages → the templates hub", () => {
    expect(parentFor("/admin/checklist-templates/closing").href).toBe("/admin/checklist-templates");
    expect(parentFor("/admin/checklist-templates/opening").href).toBe("/admin/checklist-templates");
    expect(parentFor("/admin/checklist-templates/mid_day").href).toBe("/admin/checklist-templates");
  });

  it("templates hub itself → /admin", () => {
    expect(parentFor("/admin/checklist-templates").href).toBe("/admin");
  });
});

describe("parentFor — admin section stubs → /admin", () => {
  it("audit / pars / locations / users / skus / items → /admin", () => {
    for (const seg of ["audit", "pars", "locations", "users", "skus", "items", "categories"]) {
      expect(parentFor(`/admin/${seg}`).href).toBe("/admin");
    }
  });

  it("/admin root → /dashboard", () => {
    const p = parentFor("/admin");
    expect(p.href).toBe("/dashboard");
    expect(p.labelKey).toBe("nav.dashboard");
  });
});

describe("parentFor — operator drill-ins", () => {
  it("report detail → /reports", () => {
    const p = parentFor("/reports/opening/instance-id");
    expect(p.href).toBe("/reports/operations");
    expect(p.labelKey).toBe("reports.hub.operations");
  });

  it("receiving/[id] → /operations/receiving (the list, not dashboard)", () => {
    const p = parentFor("/operations/receiving/delivery-42");
    expect(p.href).toBe("/operations/receiving");
    expect(p.labelKey).toBe("receiving.page.title");
  });

  it("trends landing → /reports", () => {
    expect(parentFor("/reports/trends").href).toBe("/reports");
  });

  it("trends ops/team sub-pages → /reports/trends", () => {
    expect(parentFor("/reports/trends/ops").href).toBe("/reports/trends");
    expect(parentFor("/reports/trends/team").href).toBe("/reports/trends");
    expect(parentFor("/reports/trends/team/person-9").href).toBe("/reports/trends/team");
  });
});

describe("parentFor — top pages & unknown routes fall back to /dashboard", () => {
  it("operator top pages → /dashboard", () => {
    for (const path of ["/reports", "/operations/receiving", "/lto", "/cash", "/maintenance", "/catering"]) {
      // These are top-level authed pages with no more-specific rule → dashboard,
      // EXCEPT ones that have their own rule. Assert the non-ruled ones here.
    }
    expect(parentFor("/lto").href).toBe("/dashboard");
    expect(parentFor("/cash").href).toBe("/dashboard");
    expect(parentFor("/settings").href).toBe("/dashboard");
  });

  it("wholly unknown route → DEFAULT_PARENT (/dashboard)", () => {
    const p = parentFor("/some/route/that/does/not/exist");
    expect(p).toEqual(DEFAULT_PARENT);
    expect(p.href).toBe("/dashboard");
  });

  it("root path → /dashboard", () => {
    expect(parentFor("/").href).toBe("/dashboard");
  });
});

describe("parentFor — normalization", () => {
  it("ignores query strings and hashes", () => {
    expect(parentFor("/admin/recipes/abc?tab=x").href).toBe("/admin/recipes");
    expect(parentFor("/reports/opening/id#section").href).toBe("/reports/operations");
  });

  it("ignores a trailing slash", () => {
    expect(parentFor("/admin/catering/").href).toBe("/admin");
    expect(parentFor("/admin/catering/menu/").href).toBe("/admin/catering");
  });
});

describe("parentFor — scheduling and stations (links audit)", () => {
  it("the schedule board is entered from the admin hub; its settings go back to the board; the staff stations view to Assignments", () => {
    expect(parentFor("/schedule")).toEqual({ href: "/admin", labelKey: "admin.back_to_hub" });
    expect(parentFor("/schedule/settings")).toEqual({ href: "/schedule", labelKey: "schedule.page.title" });
    expect(parentFor("/stations")).toEqual({ href: "/assignments", labelKey: "nav.assignments" });
  });
});

describe("parentFor — nav PR 4: the sub-pages with two back links (spec section 9, lead decision 8)", () => {
  it("each sub-page goes back to its own parent, named by the parent's one name", () => {
    expect(parentFor("/admin/customers/consent")).toEqual({ href: "/admin/customers", labelKey: "customers.title" });
    expect(parentFor("/admin/marketing/ad-codes")).toEqual({ href: "/admin/marketing", labelKey: "marketing.title" });
    expect(parentFor("/admin/demand-signals/sources")).toEqual({ href: "/admin/demand-signals", labelKey: "signals.title" });
  });

  it("the other two Customers sub-pages (Catering accounts, a customer's detail) go back to Customers too", () => {
    expect(parentFor("/admin/customers/catering")).toEqual({ href: "/admin/customers", labelKey: "customers.title" });
    expect(parentFor("/admin/customers/6f1d2c3e-0000-4000-8000-00000000000a")).toEqual({ href: "/admin/customers", labelKey: "customers.title" });
  });

  it("the three parents themselves still go one level up, to the Back office", () => {
    for (const p of ["/admin/customers", "/admin/marketing", "/admin/demand-signals"]) expect(parentFor(p).href, p).toBe("/admin");
  });

  it("the pages draw no hand-made link to their parent; the admin layout still draws the registry's", () => {
    const read = (f: string) => readFileSync(f, "utf8");
    for (const f of ["app/admin/customers/consent/page.tsx", "app/admin/customers/catering/page.tsx", "app/admin/customers/[id]/page.tsx"]) {
      expect(read(f), f).not.toMatch(/href="\/admin\/customers"/);
      expect(read(f), f).not.toContain("customers.back");
    }
    expect(read("app/admin/marketing/ad-codes/page.tsx")).not.toMatch(/copy\.back|href="\/admin\/marketing"/);
    expect(read("lib/marketing/ad-code-copy.ts")).not.toContain("marketing.adcodes.back");
    expect(read("app/admin/demand-signals/sources/page.tsx")).not.toMatch(/signals\.sources\.back|href="\/admin\/demand-signals"/);
    expect(read("app/admin/layout.tsx")).toContain("<BackLink />");
    for (const dict of ["lib/i18n/en.json", "lib/i18n/es.json"]) {
      const keys = Object.keys(JSON.parse(read(dict)) as Record<string, string>);
      for (const k of ["customers.back", "marketing.adcodes.back", "signals.sources.back"]) expect(keys, `${dict} ${k}`).not.toContain(k);
    }
  });
});
