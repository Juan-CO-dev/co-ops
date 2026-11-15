// Audit W01/B002: per-item allergen chips and a notes box on /order/build were local display state —
// never saved, never seen by staff. They are gone; the order-level note lives on /order/review, rides
// the submit, and shows on the staff lead card. Source pins (the pages are client components).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const build = readFileSync("app/order/build/page.tsx", "utf8");
const review = readFileSync("app/order/review/page.tsx", "utf8");
const route = readFileSync("app/api/portal/order/draft/submit/route.ts", "utf8");
const drawer = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;

describe("the order note goes somewhere real", () => {
  it("the build page offers no allergen chips or per-item notes box that would be dropped", () => {
    expect(build).not.toMatch(/Allergen alert/);
    expect(build).not.toMatch(/Special instructions/);
    expect(build).not.toMatch(/const ALLERGENS\b/);
    expect(build).not.toMatch(/allergens:/);
    expect(build).toContain('t("order.build.notes_on_review")');
  });
  it("the review page edits the lead's note and posts it with the submit", () => {
    expect(review).toContain("setDietaryNotes(json.draft.lead?.dietaryNotes ?? \"\")");
    expect(review).toMatch(/body: JSON\.stringify\(\{[\s\S]*?dietaryNotes,[\s\S]*?\}\)/);
    expect(review).toContain('maxLength={2000}');
    expect(route).toContain("dietaryNotes");
  });
  it("staff see it on the lead card", () => {
    expect(drawer).toContain('t("catering.pipeline.field.dietary_notes")');
    expect(drawer).toContain("lead.dietaryNotes");
  });
  it("every new string ships en + es", () => {
    for (const k of ["order.build.notes_on_review", "order.review.notes_heading", "order.review.notes_help", "order.review.notes_placeholder", "catering.pipeline.field.dietary_notes"]) {
      expect(en[k], k).toBeTruthy();
      expect(es[k], k).toBeTruthy();
      expect(es[k]).not.toBe(en[k]);
    }
  });
});
