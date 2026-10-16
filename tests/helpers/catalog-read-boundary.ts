import ts from "typescript";
export const catalogRouteFiles = (files: string[]) => files.map(p => p.replaceAll("\\", "/")).filter(p => /route\.(ts|tsx|js|jsx|mts)$/.test(p)).sort();
// Reviewed symbols, not module-wide exceptions: these modules also export writers.
const imports: Record<string, readonly string[]> = {
  "next/server": ["NextResponse"],
  "@/lib/session": ["requireSession"],
  "@/lib/api-helpers": ["jsonOk", "jsonError", "parseJsonBody"],
  "@/app/api/admin/catalog/job-http": ["uuid", "objectBody", "catalogError", "catalogRefusal"],
  "@/lib/catalog/new-sandwich": ["previewNewSandwich", "reconcileNewSandwich"],
  "@/lib/catalog/new-sandwich-shared": ["parseNewSandwichRequest"],
  "@/lib/catalog/menu-item-page": ["computeMenuPreview"],
  "@/lib/catalog/recipe-item-shared": ["parseMenuChange", "parseRecipeChange"],
  "@/lib/admin/menu-item-shop": ["MenuShopError"],
  "@/lib/menu-item-shop-shared": ["MENU_SHOP_WRITE_MIN"],
  "@/lib/catalog/job-preview-shared": ["publicShareMenuItemPreview", "publicShareRecipePreview", "publicShareSkuPreview", "publicSwapPreview", "publicBackToNormalPreview"],
  "@/lib/catalog/share": ["previewShareMenuItem", "previewShareRecipe", "previewShareSku"],
  "@/lib/pack-change-requests": ["PackChangeRequestError", "signPackRequestPhoto"],
  "@/lib/catalog/recipe-item": ["computeRecipePreview"],
  "@/lib/admin/recipe-versions": ["RecipeVersionError"],
  "@/lib/recipe-versions-shared": ["RECIPE_SHOP_WRITE_MIN"],
  "@/lib/catalog/sku-item": ["CatalogItemError", "computePackPreview", "computePricePreview"],
  "@/lib/catalog/sku-item-shared": ["parseLevels", "parseTarget"],
  "@/lib/i18n/server": ["serverT"],
  "@/lib/catalog/swap-vendor": ["previewSkuSwap", "previewBackToNormal", "loadLiveSwapsForItem"],
  "@/lib/catalog/swap-shared": ["parseSwapRequest"],
  "@/lib/catalog/toast-link": ["loadToastLinkChoices"],
};
const stableRpcs = new Set(["sku_swap_product_snapshot"]);
export function readBoundaryViolations(source: string, method?: string): string[] {
  const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];
  const root = method ? file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === method) : file;
  if (!root) return ["missing handler"];
  const used = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) used.add(node.text);
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      const name = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression) ? e.argumentExpression.text : ts.isIdentifier(e) ? e.text : "";
      if (["insert", "update", "delete", "upsert"].includes(name)) issues.push(`write:${name}`);
      if (name === "rpc") {
        const arg = node.arguments[0];
        if (!arg || !ts.isStringLiteral(arg) || !stableRpcs.has(arg.text)) issues.push("mutating/unknown rpc");
      }
      if (e.kind === ts.SyntaxKind.ImportKeyword || name === "require") issues.push("dynamic import");
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  for (const node of file.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const clause = node.importClause;
    if (clause?.isTypeOnly) continue;
    const moduleName = (node.moduleSpecifier as ts.StringLiteral).text;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) { issues.push(`unreviewed import:${moduleName}`); continue; }
    for (const symbol of clause.namedBindings.elements) {
      if (symbol.isTypeOnly || (method && !used.has(symbol.name.text))) continue;
      const original = (symbol.propertyName ?? symbol.name).text;
      if (!imports[moduleName]?.includes(original)) issues.push(`unreviewed import:${moduleName}:${original}`);
    }
  }
  return issues;
}
