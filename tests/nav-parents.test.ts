/**
 * Unit spine — lib/nav-parents.ts (pure; the route→parent registry that powers
 * <BackLink/>). Pins the longest-prefix matcher across the disease it fixes:
 * nested admin, catering sub-hub, dynamic segments, unknown → /dashboard,
 * /admin root → /dashboard, query-agnostic matching.
 */
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
    expect(p.href).toBe("/reports");
    expect(p.labelKey).toBe("reports.page.title");
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
    expect(parentFor("/operations/prep").href).toBe("/dashboard");
    expect(parentFor("/operations/overlay").href).toBe("/dashboard");
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
    expect(parentFor("/reports/opening/id#section").href).toBe("/reports");
  });

  it("ignores a trailing slash", () => {
    expect(parentFor("/admin/catering/").href).toBe("/admin");
    expect(parentFor("/admin/catering/menu/").href).toBe("/admin/catering");
  });
});
