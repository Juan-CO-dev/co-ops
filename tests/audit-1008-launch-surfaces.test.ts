import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { navDestinationsFor } from "@/lib/nav-links";
import { RECIPE_READ_MIN } from "@/lib/recipes-shared";

const read = (path: string) => readFileSync(path, "utf8");

describe("launch entry points", () => {
  it("shows Recipes only to roles allowed into the working recipe hub", () => {
    for (let level = 1; level <= 10; level++) {
      const recipe = navDestinationsFor(level).find((link) => link.key === "nav.recipes");
      if (level < RECIPE_READ_MIN) expect(recipe).toBeUndefined();
      else expect(recipe?.href).toBe("/admin/recipes");
    }
    const hub = read("app/admin/recipes/page.tsx");
    expect(hub).toContain("<RecipesClient");
    expect(hub).toContain("level < RECIPE_READ_MIN");
  });
  it("Raise par reaches the live checklist editor and its saving ParGrid", () => {
    const demand = read("components/admin/catering/prep-demand/PrepDemandClient.tsx");
    expect(demand).toContain('href="/admin/checklist-templates/am_prep"');
    expect(demand).not.toContain("/admin/pars");
    expect(read("app/admin/checklist-templates/[subtype]/page.tsx")).toContain("<ChecklistTabs");
    expect(read("components/admin/templates/ChecklistTabs.tsx")).toContain("<LocationChecklistTab");
    expect(read("components/admin/templates/LocationChecklistTab.tsx")).toContain("<ParGrid");
    expect(read("components/admin/templates/ParGrid.tsx")).toContain('"PATCH"');
  });
  it("Opening keeps discrepancy notes without advertising unavailable photo upload", () => {
    const opening = read("components/opening/OpeningItemAddon.tsx");
    expect(opening).toContain("<textarea");
    expect(opening).toContain("onNotesChange(");
    expect(opening).not.toContain("<button");
    expect(opening).not.toContain("photo_pending");
  });
  it("LTO retains the working surplus board without the performance placeholder", () => {
    const lto = read("app/(authed)/lto/page.tsx");
    expect(lto).toContain("surplusItems.map");
    expect(lto).not.toContain("PlaceholderCard");
    expect(lto).not.toContain("lto.ph.");
  });
  it("Settings retains language and profile without the follow-up card", () => {
    const settings = read("app/(authed)/settings/page.tsx");
    expect(settings).toContain("<LanguageSettingCard");
    expect(settings).toContain('href="/profile"');
    expect(settings).not.toContain("settings.more.");
  });
});
