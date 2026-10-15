/**
 * Catalog Phase 3b — a shop switch remounts the page body; every preview goes through the guard; saves post the
 * preview's token. (Plan Task 8 Step 2; the menu item page's pins joined with Task 9; the ShopChangesClient pins
 * and the notices page joined with Task 10.)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RECIPE_PAGE = "app/admin/catalog/recipe/[id]/page.tsx";
const RECIPE_CLIENT = "components/catalog/RecipeItemClient.tsx";

describe("the recipe page remounts per (recipe, shop)", () => {
  it("keys the client by pageClientKey", () => {
    expect(readFileSync(RECIPE_PAGE, "utf8")).toContain('key={pageClientKey("recipe", view.recipe.id, view.scope)}');
  });
  it("reads ?location= through the one getter and the one resolver; 'global' is the default", () => {
    const src = readFileSync(RECIPE_PAGE, "utf8");
    expect(src).toContain("shopParamFor(`/admin/catalog/recipe/${id}`, searchParamValues(sp))");
    expect(src).toContain('explicit === "global" ? null');
    expect(src).toContain("await resolveShopId(mine, explicit)");
    // a refusal from the lib's own gate (the social media manager by role) lands on the dashboard, never a crash
    expect(src).toContain('e instanceof RecipeVersionError && e.status === 403) redirect("/dashboard")');
  });
});

describe("the recipe page's writes", () => {
  it("previews run through the guard; a save posts exactly the previewed change and its token", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toContain("guard.run(");
    expect(src).toContain("previewToken: preview.token");
    expect(src).toContain('requestStepUp("E")');
  });
  it("an edit submits the baseline captured at Edit, never the refreshed props (Astra 3b r5#1)", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toContain('op: { kind: "update", lineId: l.lineId, line: fieldsOf(d), expected: editing.expected }');
    expect(src).not.toContain('line: fieldsOf(d), expected: l.fields }');
    expect(src).toContain("lineEditStale(editing.expected, l.fields)");
  });
  it("lead decision: something moved underneath → the page refreshes (the draft and its baseline stay) and offers to look again", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toMatch(/const REFRESH_ON[^\n]*"line_changed"[^\n]*"preview_stale"[^\n]*"dependencies_changed"/);
    expect(src).toMatch(/const REPREVIEW_ON[^\n]*"preview_stale", "dependencies_changed"/);
    expect(src).toContain("router.refresh();");
    expect(src).toContain('onClick={() => void askPreview(pending)}>{t("catalog.recipe.see_changes")}');
  });
  it("D10: the ingredients section stays mounted and locked open while a line draft exists (Astra 3b r1#8)", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toContain('const linesDirty = editing !== null || pending?.kind === "lines";');
    expect(src).toContain('if (s === "lines" && linesDirty) return;');
    expect(src).toContain("open={open.lines || linesDirty}");
  });
  it("a refused line is NAMED — in the message and beside the line; a carried broken line is flagged (lead decision (b))", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toContain("fail(r.code, r.line)");
    expect(src).toContain('t("catalog.recipe.error.line_refused", { position: line.position, name: line.name, reason: t(errorKey(line.reason)) })');
    expect(src).toContain("{l.problem ? (");
    expect(readFileSync("components/catalog/RecipePreviewPanel.tsx", "utf8")).toContain("preview.flagged.map(");
    expect(readFileSync("components/admin/vendors/shared.ts", "utf8")).toContain("return line ? { ok: false, code, line } : { ok: false, code };");
  });
  it("Astra chunks 3-4 P2 #1: lines are matched and keyed by their source_line_id lineage, so a refresh never unmounts an open editor", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toContain("recipeLineKeys(view.lines)");
    expect(src).toContain("recipeLineMatches(l, editing.lineId)");
    expect(src).toContain("key={`edit-${editing.lineId}-${JSON.stringify(editing.expected)}`}");
    expect(src).not.toContain("<li key={l.lineId}");
  });
  it("Astra chunks 3-4 P2 #2: any edit after a preview drops pending AND preview (no stale Save) and asks to Preview again", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toContain("const dropPreview = () => { if (pending === null && preview === null) return; guard.invalidate(); setPending(null); setPreview(null); setRetry(null); setPreviewDropped(true); };");
    expect(src.split("onDraftChange={dropPreview}").length - 1).toBe(2); // the edit AND the add editor
    expect(readFileSync("components/admin/recipes/RecipeLineEditor.tsx", "utf8")).toContain("onDraftChange?.();");
  });
  it("Astra chunks 3-4 P3 #3: a restore for a shop says where it goes — on the Save button and in the preview", () => {
    const src = readFileSync(RECIPE_CLIENT, "utf8");
    expect(src).toContain('case "restore": return p.target.kind === "shop" ? t("catalog.recipe.restore_as_shop", { shop: shopName(p.target.shopId) })');
    expect(src).toContain('becomesShopVersion={pending.kind === "restore" && pending.target.kind === "shop" ? shopName(pending.target.shopId) : null}');
  });
  it("never keys on a location CODE — shops are ids and names", () => {
    for (const f of [RECIPE_PAGE, RECIPE_CLIENT, "components/catalog/RecipePreviewPanel.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/["'](EM|MEP)["']/);
    }
  });
});

// ── The menu item page (plan Task 9; the pins chunk 4 deferred) ───────────────
const MENU_CLIENT = "components/catalog/MenuItemClient.tsx";
const MENU_PAGE = "app/admin/catalog/menu-item/[id]/page.tsx";

describe("the menu item page remounts per (item, shop)", () => {
  it("keys the client by pageClientKey", () => {
    expect(readFileSync(MENU_PAGE, "utf8")).toContain('key={pageClientKey("menu", view.item.id, view.scope)}');
  });
  it("reads ?location= through the one getter and the one resolver; 'global' is the default; the lib's 403 / 404 never crash", () => {
    const src = readFileSync(MENU_PAGE, "utf8");
    expect(src).toContain("shopParamFor(`/admin/catalog/menu-item/${id}`, searchParamValues(sp))");
    expect(src).toContain('explicit === "global" ? null');
    expect(src).toContain("await resolveShopId(mine, explicit)");
    expect(src).toContain('e instanceof MenuShopError && e.status === 403) redirect("/dashboard")');
    expect(src).toContain("e instanceof MenuShopError && e.status === 404) notFound()");
    expect(src).not.toMatch(/["'](EM|MEP)["']/);
  });
});

describe("the menu item page's writes", () => {
  it("previews run through the guard; a save posts exactly the previewed change and its token (Tier E)", () => {
    const src = readFileSync(MENU_CLIENT, "utf8");
    expect(src).toContain("guard.run(");
    expect(src).toContain("previewToken: preview.token");
    expect(src).toContain('requestStepUp("E")');
  });
  it("the menu form resets to the committed row after every refresh (Astra 3b r1#6)", () => {
    const src = readFileSync(MENU_CLIENT, "utf8");
    expect(src).toContain("const revision = menuFormRevision(view);");
    expect(src).toContain("if (formRevision !== revision) {");
    expect(src).toContain("setSoldHere(view.here.soldHere);");
    expect(src).toContain('setPriceText(view.here.price === null ? "" : String(view.here.price));');
  });
  it("lead decision: a TYPED draft under a moved row keeps its original baseline, shows what moved, and offers Start over", () => {
    const src = readFileSync(MENU_CLIENT, "utf8");
    expect(src).toContain("if (!keepMenuDraft({ draft, was: baseline, now: view.here, follow })) {");
    expect(src).toContain("const moves = menuRowMoves(baseline, view.here);");
    expect(src).toContain("{stale ? <MenuStaleNotice moves={moves} busy={busy} onRebase={startOver} /> : null}");
    // their own act just saved → the form always follows the committed row
    expect(src).toContain('if (r.ok) { reset(); setFollow(true); setMessage(t("catalog.menu.saved")); router.refresh(); } else fail(r);');
  });
  it("Astra chunks 3-4 P2 #2 (mirrored): any edit after a preview drops pending AND preview, and the button asks to Preview again", () => {
    const src = readFileSync(MENU_CLIENT, "utf8");
    expect(src).toContain("const touched = () => { if (pending === null && preview === null) return; reset(); setPreviewDropped(true); };");
    expect(src.split("touched(); }}").length - 1).toBe(4); // price, sold here, name, Spanish name
    expect(src).toContain('t(previewDropped ? "catalog.menu.preview_again" : "catalog.menu.see_changes")');
  });
  it("CC note 2 #3: a promote refused after its Spanish name saved says so and reloads to show the new label", () => {
    const src = readFileSync(MENU_CLIENT, "utf8");
    expect(src).toContain("if (r.spanishNameSaved) {");
    expect(src).toContain("setFollow(true); router.refresh();");
    expect(src).toContain('t("catalog.menu.promote.es_saved_not_promoted", { shop })');
  });
  it("something moved underneath → the page refreshes and offers to look at the same change again", () => {
    const src = readFileSync(MENU_CLIENT, "utf8");
    expect(src).toMatch(/const REFRESH_ON[^\n]*"version_changed"[^\n]*"global_changed"[^\n]*"preview_stale"[^\n]*"dependencies_changed"/);
    expect(src).toContain('const REPREVIEW_ON: ReadonlySet<string> = new Set(["preview_stale", "dependencies_changed"]);');
    expect(src).toContain('onClick={() => void askPreview(pending)}>{t("catalog.menu.see_changes")}');
  });
  it("never keys on a location CODE — shops are ids and names", () => {
    for (const f of [MENU_CLIENT, "components/catalog/MenuPreviewPanel.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/["'](EM|MEP)["']/);
    }
  });
});

// ── The Shop changes list (plan Task 10; the pins chunk 2 and chunk 4 deferred to it) ──
const CHANGES_CLIENT = "components/catalog/ShopChangesClient.tsx";
const CHANGES_PAGE = "app/admin/catalog/shop-changes/page.tsx";

describe("the Shop changes list's writes", () => {
  it("previews run through the guard; a save posts exactly the previewed change and its token (Tier E)", () => {
    const src = readFileSync(CHANGES_CLIENT, "utf8");
    expect(src).toContain("guard.run(");
    expect(src).toContain("previewToken: preview.token");
    expect(src).toContain('requestStepUp("E")');
  });
  it("a refused line or code is NAMED, from the preview AND the save, through the pages' one refusal map (Astra 3b r3#3, CC note 5 #3)", () => {
    const src = readFileSync(CHANGES_CLIENT, "utf8");
    expect(src).toContain('t("catalog.recipe.error.line_refused", { position: r.line.position, name: r.line.name, reason: t(recipeErrorKey(r.line.reason)) })');
    expect(src).toContain("menuRefusalText(t, r, shopsOf(view))");
    expect(src.split("fail(p, r)").length - 1).toBeGreaterThanOrEqual(2); // preview and save
    expect(src).not.toMatch(/const KNOWN\b/); // no local key set that sends a named code to generic text
  });
  it("lead decision: the menu promote reuses the menu page's panel — truthful Spanish name, the optional Spanish field", () => {
    const src = readFileSync(CHANGES_CLIENT, "utf8");
    expect(src).toContain("<MenuPreviewPanel");
    expect(src).toContain("promoteNameEs={promoteNameEs}");
    expect(readFileSync("components/catalog/MenuPreviewPanel.tsx", "utf8")).toContain('t("catalog.menu.preview.name_es", { before: preview.before.nameEs ?? "—", after: preview.after.nameEs ?? "—" })');
  });
  it("CC note 2 #3: a promote refused after its Spanish name saved says so (menuRefusalText) and reloads the list", () => {
    const src = readFileSync(CHANGES_CLIENT, "utf8");
    expect(src).toContain("if (r.spanishNameSaved) {");
    expect(src).toMatch(/if \(r\.spanishNameSaved\) \{[^}]*router\.refresh\(\);/);
  });
  it("something moved underneath → the list refreshes and offers to look at the same change again", () => {
    const src = readFileSync(CHANGES_CLIENT, "utf8");
    expect(src).toContain('const REPREVIEW_ON: ReadonlySet<string> = new Set(["preview_stale", "dependencies_changed"]);');
    expect(src).toMatch(/const REFRESH_ON[^\n]*"version_changed"[^\n]*"global_changed"[^\n]*"not_live"/);
  });
  it("mirrors the pages: a preview whose row changed (or went away) after it is dropped — Save goes with it — Preview again", () => {
    const src = readFileSync(CHANGES_CLIENT, "utf8");
    expect(src).toContain("shopChangeRowRevision(");
    expect(src).toContain("if (pending && pendingRev !== null && pendingRev !== pending.rev) {");
  });
  it("Leave writes nothing: it folds the row away on this screen, and the folded rows can be shown again", () => {
    const src = readFileSync(CHANGES_CLIENT, "utf8");
    expect(src).not.toMatch(/leave[^\n]*postJson|postJson[^\n]*leave/i);
    expect(src).toContain('t("catalog.changes.show_left", { n:');
  });
  it("never keys on a location CODE — shops are ids and names", () => {
    for (const f of [CHANGES_CLIENT, CHANGES_PAGE]) expect(readFileSync(f, "utf8"), f).not.toMatch(/["'](EM|MEP)["']/);
  });
  it("the page: MoO+ before any read; the lib's refusal (the social media manager by role) lands on the dashboard", () => {
    const src = readFileSync(CHANGES_PAGE, "utf8");
    expect(src).toContain("if (auth.level < GLOBAL_VERSION_WRITE_MIN) redirect(");
    expect(src).toContain('e instanceof RecipeVersionError && e.status === 403) redirect("/dashboard")');
    expect(src).toContain("<ShopChangesClient view={view} />");
  });
});

describe("the admin hub card for Shop changes", () => {
  it("Shop changes is the Director of Operations' (MoO+, 8)", async () => {
    const { adminSectionsFor } = await import("@/lib/admin/sections");
    const ids = (level: number) => adminSectionsFor(level).map((s) => s.id);
    expect(ids(8)).toContain("shop-changes");
    expect(ids(7)).not.toContain("shop-changes");
    expect(adminSectionsFor(9).find((s) => s.id === "shop-changes")?.href).toBe("/admin/catalog/shop-changes");
  });
});
