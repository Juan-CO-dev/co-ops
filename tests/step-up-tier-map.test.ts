/**
 * THE STEP-UP TIER MAP — pinned, repo-wide, so client/server drift fails the build.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
 * PR #297 found the CreateUserForm class: a client asking for Tier A in front of a route
 * that asserts Tier B. Its own test could only cover `app/api/admin/users`, and its flag
 * said so in as many words — "a repo-wide client↔server tier map would be the general
 * answer", with ~45 other `requestStepUp("A")` call sites spot-checked but never
 * individually traced. This is that map.
 *
 * ── WHY A PINNED SNAPSHOT AND NOT A COMPUTED JOIN ─────────────────────────────
 * The honest join is (client call site) → (the URL it fetches) → (the route file that
 * serves that URL) → (the tier that file asserts). Steps two and three are not decidable
 * from source text: URLs are template literals assembled from props, several lanes are
 * shared helpers taking the URL as a parameter, and two routes pick their tier from a
 * runtime `if`. A test that FAKED that join would be a test that lies.
 *
 * So the join was performed ONCE, by hand, against every one of the 100+ client call
 * sites and 118 route assertions (2026-08-30, this arc), and what is mechanised here is
 * the thing a machine can actually do: pin the two halves EXACTLY. Any new route, any
 * removed route, any new client call site, any changed tier literal fails these
 * assertions — which forces a human back through the join before the change can land.
 * That is the same posture `tests/dynamic-pars-write.test.ts` takes on route source.
 *
 * ── WHAT THE JOIN FOUND (2026-08-30) ──────────────────────────────────────────
 * Tier B implies Tier A (B = unlocked AND fresh; A = unlocked, any age), so the only
 * mismatch that BREAKS is a client asking A where the route asserts B, or asking nothing
 * at all. Every proactive call site agreed except two, both in RecipeBuilder.tsx, both
 * fixed in this arc and both pinned below:
 *   · `patchField`  → PATCH /api/admin/recipes/[id]   (asserts B) asked for nothing
 *   · `removeEdge`  → DELETE /api/admin/recipes/edges (asserts B) asked for nothing,
 *                     AND swallowed the refusal with no message at all
 *
 * ── THE SECOND, TIER-AGNOSTIC IDIOM ───────────────────────────────────────────
 * Not every surface pre-requests. Six components fire the request first and unlock only
 * when the server answers `step_up_required` / `step_up_stale`, then retry the pending
 * call. Those sites CANNOT mismatch — they never name a tier, they obey whatever the
 * route asked for — and one of them (CountForm) is outside /admin's StepUpProvider
 * entirely and carries its own modal. They are pinned as a set so that a component
 * LEAVING the reactive idiom, or a new one joining it, is a deliberate, reviewed act.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file under the given repo-relative roots, as forward-slashed relative paths. */
function filesUnder(...roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const entry of readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" })) {
      out.push(`${root}/${entry.split(sep).join("/")}`);
    }
  }
  return out.sort();
}

const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");

/** Distinct, sorted tier tokens in a source string for one call shape. */
function tiersIn(src: string, fn: "assertStepUp" | "requestStepUp"): string[] {
  const args = fn === "assertStepUp" ? String.raw`\s*ctx\s*,\s*` : String.raw`\s*`;
  const literals = [...src.matchAll(new RegExp(`${fn}\\(${args}"([AB])"`, "g"))].map((m) => m[1] as string);
  // A tier passed through a variable is recorded as `VAR:<name>` rather than dropped —
  // an unrecorded dynamic tier is exactly the hole a tier map exists to close.
  const vars = [...src.matchAll(new RegExp(`${fn}\\(${args}(?!")([A-Za-z_$][\\w$]*)`, "g"))].map(
    (m) => `VAR:${m[1] as string}`,
  );
  return [...new Set([...literals, ...vars])].sort();
}

function extract(fn: "assertStepUp" | "requestStepUp", keep: (rel: string) => boolean) {
  const map: Record<string, string[]> = {};
  for (const rel of filesUnder("app", "components")) {
    if (!keep(rel)) continue;
    const tiers = tiersIn(read(rel), fn);
    if (tiers.length > 0) map[rel] = tiers;
  }
  return map;
}

// ── THE SERVER HALF: route file → the tiers it asserts ────────────────────────
const SERVER_TIER_MAP: Record<string, string[]> = {
  "app/api/admin/catalog/item-type/[id]/route.ts": ["A"],
  "app/api/admin/categories/route.ts": ["B"],
  "app/api/admin/catering/capacity/[id]/route.ts": ["A", "B"],
  "app/api/admin/catering/capacity/route.ts": ["A", "B"],
  "app/api/admin/catering/faq/[id]/route.ts": ["A", "B"],
  "app/api/admin/catering/faq/route.ts": ["B"],
  "app/api/admin/catering/fulfillment/route.ts": ["A"],
  "app/api/admin/catering/item-sizes/[sizeId]/route.ts": ["A"],
  "app/api/admin/catering/lto/events/[id]/cancel/route.ts": ["A"],
  "app/api/admin/catering/lto/events/route.ts": ["A"],
  "app/api/admin/catering/menu/[id]/route.ts": ["A"],
  "app/api/admin/catering/menu/[id]/sizes/route.ts": ["A"],
  // The one runtime-chosen tier in the repo: `hasActive ? "B" : "A"`.
  "app/api/admin/catering/packages/[id]/route.ts": ["VAR:tier"],
  "app/api/admin/catering/packages/route.ts": ["B"],
  "app/api/admin/catering/pricing/[id]/route.ts": ["B"],
  "app/api/admin/catering/pricing/route.ts": ["B"],
  "app/api/admin/catering/rate-rules/[ruleId]/route.ts": ["B"],
  "app/api/admin/catering/rate-rules/route.ts": ["B"],
  "app/api/admin/catering/zones/[id]/route.ts": ["A", "B"],
  "app/api/admin/catering/zones/route.ts": ["B"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/definition/route.ts": ["B"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/input-type/route.ts": ["B"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/min-role/route.ts": ["B"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/par/route.ts": ["A"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/promote/route.ts": ["B"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/route.ts": ["A", "B"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/section/route.ts": ["B"],
  "app/api/admin/checklist-templates/[id]/items/[itemId]/unlink/route.ts": ["B"],
  "app/api/admin/checklist-templates/[id]/items/route.ts": ["B"],
  "app/api/admin/checklist-templates/enable/route.ts": ["A"],
  "app/api/admin/checklist-templates/item-questions/[id]/route.ts": ["B"],
  "app/api/admin/checklist-templates/item-questions/route.ts": ["B"],
  "app/api/admin/checklist-templates/needs-link/[lineId]/route.ts": ["A"],
  "app/api/admin/checklist-templates/registry/[itemId]/default/route.ts": ["B"],
  "app/api/admin/checklist-templates/registry/[itemId]/opening-verify/route.ts": ["B"],
  "app/api/admin/checklist-templates/registry/[itemId]/route.ts": ["B"],
  "app/api/admin/checklist-templates/registry/route.ts": ["B"],
  "app/api/admin/checklist-templates/section-questions/[id]/route.ts": ["B"],
  "app/api/admin/checklist-templates/section-questions/route.ts": ["B"],
  "app/api/admin/checklist-templates/sections/[slug]/disable/route.ts": ["B"],
  "app/api/admin/checklist-templates/sections/[slug]/reorder/route.ts": ["B"],
  "app/api/admin/checklist-templates/sections/[slug]/route.ts": ["B"],
  "app/api/admin/checklist-templates/sections/[slug]/shape/route.ts": ["B"],
  "app/api/admin/checklist-templates/sections/route.ts": ["B"],
  "app/api/admin/checklist-templates/units/route.ts": ["B"],
  "app/api/admin/ezcater/location/route.ts": ["A"],
  "app/api/admin/items/[itemId]/sold-directly/route.ts": ["B"],
  "app/api/admin/menu-items/route.ts": ["B"],
  "app/api/admin/order-types/route.ts": ["B"],
  "app/api/admin/products/[id]/active/route.ts": ["B"],
  "app/api/admin/products/[id]/members/route.ts": ["A"],
  "app/api/admin/products/[id]/primary/route.ts": ["A"],
  "app/api/admin/products/[id]/route.ts": ["A"],
  "app/api/admin/products/route.ts": ["B"],
  "app/api/admin/recipes/[id]/inputs/route.ts": ["B"],
  "app/api/admin/recipes/[id]/outputs/route.ts": ["B"],
  "app/api/admin/recipes/[id]/route.ts": ["B"],
  "app/api/admin/recipes/edges/route.ts": ["B"],
  "app/api/admin/recipes/full/route.ts": ["B"],
  "app/api/admin/recipes/route.ts": ["B"],
  "app/api/admin/skus/[id]/location-settings/route.ts": ["A"],
  "app/api/admin/skus/[id]/pack-chain/route.ts": ["A"],
  "app/api/admin/skus/[id]/price/route.ts": ["A"],
  "app/api/admin/skus/[id]/route.ts": ["A"],
  "app/api/admin/skus/measure-units/route.ts": ["B"],
  "app/api/admin/skus/pack-formats/route.ts": ["B"],
  "app/api/admin/skus/route.ts": ["B"],
  "app/api/admin/template-builder/[id]/items/[itemId]/spine-link/route.ts": ["A"],
  "app/api/admin/template-builder/[id]/items/[itemId]/translations/route.ts": ["A"],
  "app/api/admin/template-builder/[id]/publish/route.ts": ["A"],
  "app/api/admin/toast-map/[id]/route.ts": ["A"],
  "app/api/admin/toast-map/location/route.ts": ["A"],
  "app/api/admin/toast-map/manual/route.ts": ["A"],
  "app/api/admin/toast-map/match/route.ts": ["A"],
  "app/api/admin/toast-sales/exclusions/[id]/route.ts": ["A"],
  "app/api/admin/toast-sales/exclusions/route.ts": ["A"],
  "app/api/admin/toast-sales/pull/route.ts": ["A"],
  "app/api/admin/users/[id]/activate/route.ts": ["B"],
  "app/api/admin/users/[id]/deactivate/route.ts": ["B"],
  "app/api/admin/users/[id]/locations/route.ts": ["B"],
  "app/api/admin/users/[id]/reset-pin/route.ts": ["B"],
  "app/api/admin/users/[id]/role/route.ts": ["B"],
  "app/api/admin/users/[id]/route.ts": ["B"],
  "app/api/admin/users/[id]/set-password/route.ts": ["B"],
  "app/api/admin/users/route.ts": ["B"],
  "app/api/admin/vendors/[id]/categories/route.ts": ["A"],
  "app/api/admin/vendors/[id]/contacts/[contactId]/route.ts": ["A"],
  "app/api/admin/vendors/[id]/contacts/route.ts": ["A"],
  "app/api/admin/vendors/[id]/cutoffs/[cutoffId]/route.ts": ["A"],
  "app/api/admin/vendors/[id]/cutoffs/route.ts": ["A"],
  "app/api/admin/vendors/[id]/order-types/route.ts": ["A"],
  "app/api/admin/vendors/[id]/ordering-details/[detailId]/route.ts": ["A"],
  "app/api/admin/vendors/[id]/ordering-details/route.ts": ["A"],
  "app/api/admin/vendors/[id]/rhythm/route.ts": ["A"],
  "app/api/admin/vendors/[id]/rhythm/skips/route.ts": ["A"],
  "app/api/admin/vendors/[id]/route.ts": ["A", "B"],
  "app/api/admin/vendors/[id]/schedule/route.ts": ["A"],
  "app/api/admin/vendors/[id]/transmission/route.ts": ["A"],
  "app/api/admin/vendors/route.ts": ["B"],
  "app/api/admin/weights/route.ts": ["B"],
  // Not under /admin, but step-up-gated all the same.
  "app/api/catering/quotes/[id]/send/route.ts": ["B"],
  "app/api/operations/counts/route.ts": ["A"],
};

// ── THE CLIENT HALF: component → the tiers it requests ────────────────────────
const CLIENT_TIER_MAP: Record<string, string[]> = {
  "app/admin/catering/rate-rules/rate-rules-client.tsx": ["B"],
  // The provider itself — the parameter, not a call site.
  "components/admin/StepUpProvider.tsx": ["VAR:tier"],
  "components/admin/UnitSelect.tsx": ["B"],
  "components/admin/catering/capacity/CapacityClient.tsx": ["A", "B", "VAR:tier"],
  "components/admin/catering/faq/FaqClient.tsx": ["A", "B"],
  "components/admin/catering/fulfillment/FulfillmentClient.tsx": ["A"],
  "components/admin/catering/lto/LtoClient.tsx": ["A"],
  "components/admin/catering/packages/PackagesClient.tsx": ["A", "B", "VAR:tier"],
  "components/admin/catering/pricing/PricingClient.tsx": ["B"],
  "components/admin/catering/zones/ZonesClient.tsx": ["A", "B"],
  "components/admin/items/AddItemForm.tsx": ["B"],
  "components/admin/items/ItemQuestions.tsx": ["B"],
  "components/admin/items/ItemRow.tsx": ["B"],
  // Shared `mutate(tier, …)` lane; every caller passes a literal — see the join note.
  "components/admin/products/ProductsClient.tsx": ["VAR:tier"],
  "components/admin/recipes/RecipeBuilder.tsx": ["B"],
  "components/admin/recipes/RecipeCateringFlags.tsx": ["A"],
  "components/admin/skus/MeasureUnitSelect.tsx": ["B"],
  "components/admin/skus/RegistrySelect.tsx": ["B"],
  "components/admin/skus/SkuCatalogClient.tsx": ["A", "B"],
  "components/admin/skus/SkuCostPanel.tsx": ["A"],
  "components/admin/skus/SkuLocationOverlay.tsx": ["A"],
  "components/admin/skus/SkuPackChainPanel.tsx": ["A"],
  "components/admin/skus/VendorSkusCard.tsx": ["A", "B"],
  "components/admin/template-builder/TemplateBuilderClient.tsx": ["A"],
  "components/admin/templates/AddPrepItemForm.tsx": ["B"],
  "components/admin/templates/LocationChecklistTab.tsx": ["A", "B"],
  "components/admin/templates/NeedsLinkQueue.tsx": ["A"],
  "components/admin/templates/ParGrid.tsx": ["A"],
  "components/admin/templates/SectionsTab.tsx": ["B"],
  "components/admin/users/CreateUserForm.tsx": ["B"],
  // Shared `run(tier)` lane; all seven action branches pass "B" (pinned by PR #297).
  "components/admin/users/UserActions.tsx": ["VAR:tier"],
  "components/admin/vendors/CategoryListClient.tsx": ["B"],
  "components/admin/vendors/OrderTypeListClient.tsx": ["B"],
  "components/admin/vendors/VendorDetailClient.tsx": ["A", "B"],
  "components/admin/vendors/VendorListClient.tsx": ["B"],
  "components/admin/vendors/VendorRhythmCard.tsx": ["A"],
  "components/admin/weights/WeightBoardClient.tsx": ["B"],
};

/**
 * The reactive idiom: fire, and unlock only if the server says so. Tier-agnostic by
 * construction, so structurally immune to the mismatch this file guards.
 */
const REACTIVE_STEP_UP_COMPONENTS = [
  "components/admin/catalog/CatalogClient.tsx",
  "components/admin/catering/menu/MenuClient.tsx",
  "components/admin/catering/menu/ToastTab.tsx",
  "components/admin/catering/prep-demand/SalesTab.tsx",
  "components/catering/quotes/QuotesClient.tsx",
  // Outside /admin's StepUpProvider — carries its own PasswordModal.
  "components/counts/CountForm.tsx",
];

describe("step-up tier map — the server half", () => {
  it("every route's asserted tiers match the pinned map", () => {
    expect(extract("assertStepUp", (rel) => rel.endsWith("route.ts"))).toEqual(SERVER_TIER_MAP);
  });

  it("the map is not vacuous", () => {
    expect(Object.keys(SERVER_TIER_MAP).length).toBeGreaterThanOrEqual(100);
  });

  it("exactly one route picks its tier at runtime, and it is the packages editor", () => {
    const dynamic = Object.entries(SERVER_TIER_MAP)
      .filter(([, tiers]) => tiers.some((t) => t.startsWith("VAR:")))
      .map(([file]) => file);
    expect(dynamic).toEqual(["app/api/admin/catering/packages/[id]/route.ts"]);
  });
});

describe("step-up tier map — the client half", () => {
  it("every component's requested tiers match the pinned map", () => {
    expect(extract("requestStepUp", (rel) => rel.endsWith(".tsx") || rel.endsWith(".ts"))).toEqual(
      CLIENT_TIER_MAP,
    );
  });

  it("the reactive-idiom set is exactly the pinned list", () => {
    const reactive = filesUnder("app", "components").filter((rel) => {
      if (!rel.endsWith(".tsx")) return false;
      const src = read(rel);
      return src.includes("setStepUpOpen") && !src.includes("requestStepUp(");
    });
    expect(reactive.sort()).toEqual([...REACTIVE_STEP_UP_COMPONENTS].sort());
  });

  it("no component both pre-requests a tier AND runs the reactive modal", () => {
    // Two mechanisms on one surface means two answers to "am I unlocked?", which is how
    // a retry loop starts prompting twice for one action.
    for (const rel of Object.keys(CLIENT_TIER_MAP)) {
      expect(read(rel).includes("setStepUpOpen"), `${rel} mixes both idioms`).toBe(false);
    }
  });
});

describe("RecipeBuilder — the two lanes that asked for nothing (fixed here)", () => {
  const src = () => read("components/admin/recipes/RecipeBuilder.tsx");

  it("patchField requests Tier B before PATCHing the recipe header", () => {
    // /api/admin/recipes/[id] asserts Tier B; this lane asked for nothing at all.
    const lane = src().slice(src().indexOf("const patchField"));
    const body = lane.slice(0, lane.indexOf("};"));
    expect(body).toContain('requestStepUp("B")');
    expect(body.indexOf('requestStepUp("B")')).toBeLessThan(body.indexOf("postJson"));
  });

  it("removeEdge requests Tier B and surfaces its refusal", () => {
    // /api/admin/recipes/edges asserts Tier B; this lane asked for nothing AND dropped
    // the failure on the floor — no refresh, no message, the row just stayed.
    const lane = src().slice(src().indexOf("const removeEdge"));
    const body = lane.slice(0, lane.indexOf("\n  };"));
    expect(body).toContain('requestStepUp("B")');
    expect(body).toContain("setPatchError");
    expect(body.indexOf('requestStepUp("B")')).toBeLessThan(body.indexOf("postJson"));
  });
});
