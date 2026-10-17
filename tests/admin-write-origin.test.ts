import { readBoundaryViolations } from "./helpers/catalog-read-boundary";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import ts from "typescript";

// Every admin route is explicitly classified: mutations, reads, or inert stubs.
// List every exported HTTP method explicitly; additions require deliberate classification.
const mutationRoutes: Record<string, string> = {
  "catering/ezcater-review/route.ts": "POST",
  "vendors/[id]/import/route.ts": "POST",
  "vendors/[id]/order-guide/route.ts": "GET POST",
  "catalog/recipe/[id]/notices/dismiss/route.ts": "POST",
  "catalog/item-type/[id]/route.ts": "PATCH",
  "catalog/jobs/new-item/route.ts": "POST",
  "catalog/jobs/new-sandwich/route.ts": "POST",
  "catalog/menu-item/[id]/apply/route.ts": "POST",
  "catalog/menu-item/[id]/share/route.ts": "POST",
  "catalog/menu-item/[id]/shop/back-to-default/route.ts": "POST",
  "catalog/menu-item/[id]/shop/restore/route.ts": "POST",
  "catalog/menu-item/[id]/shop/route.ts": "POST",
  "catalog/menu-item/[id]/toast/route.ts": "POST GET",
  "catalog/recipe/[id]/apply/route.ts": "POST",
  "catalog/recipe/[id]/back-to-default/route.ts": "POST",
  "catalog/recipe/[id]/lines/route.ts": "POST",
  "catalog/recipe/[id]/restore/route.ts": "POST",
  "catalog/recipe/[id]/share/route.ts": "POST",
  "catalog/sku/[id]/pack-requests/[requestId]/dismiss/route.ts": "POST",
  "catalog/sku/[id]/pack/apply/route.ts": "POST",
  "catalog/sku/[id]/pack/back-to-default/route.ts": "POST",
  "catalog/sku/[id]/pack/restore/route.ts": "POST",
  "catalog/sku/[id]/pack/route.ts": "POST",
  "catalog/sku/[id]/price-basis/route.ts": "POST",
  "catalog/sku/[id]/price/apply/route.ts": "POST",
  "catalog/sku/[id]/price/back-to-default/route.ts": "POST",
  "catalog/sku/[id]/price/route.ts": "POST",
  "catalog/sku/[id]/setup/route.ts": "POST",
  "catalog/sku/[id]/share/route.ts": "POST",
  "catalog/sku/[id]/swap/route.ts": "POST GET",
  "catalog/swaps/[swapId]/back-to-normal/route.ts": "POST",
  "categories/route.ts": "GET POST",
  "catering/capacity/[id]/route.ts": "PATCH",
  "catering/capacity/route.ts": "GET POST",
  "catering/faq/[id]/route.ts": "PATCH",
  "catering/faq/route.ts": "GET POST",
  "catering/fulfillment/route.ts": "GET PATCH",
  "catering/item-sizes/[sizeId]/route.ts": "PATCH DELETE",
  "catering/lto/events/[id]/cancel/route.ts": "POST",
  "catering/lto/events/route.ts": "POST",
  "catering/menu/[id]/route.ts": "PATCH",
  "catering/menu/[id]/sizes/route.ts": "POST",
  "catering/packages/[id]/route.ts": "PATCH",
  "catering/packages/route.ts": "GET POST",
  "catering/pricing/[id]/route.ts": "PATCH",
  "catering/pricing/route.ts": "GET POST",
  "catering/rate-rules/[ruleId]/route.ts": "DELETE",
  "catering/rate-rules/route.ts": "GET POST",
  "catering/zones/[id]/route.ts": "PATCH",
  "catering/zones/route.ts": "GET POST",
  "checklist-templates/[id]/items/[itemId]/definition/route.ts": "PATCH",
  "checklist-templates/[id]/items/[itemId]/input-type/route.ts": "PATCH",
  "checklist-templates/[id]/items/[itemId]/min-role/route.ts": "PATCH",
  "checklist-templates/[id]/items/[itemId]/par/route.ts": "PATCH",
  "checklist-templates/[id]/items/[itemId]/promote/route.ts": "POST",
  "checklist-templates/[id]/items/[itemId]/route.ts": "PATCH DELETE",
  "checklist-templates/[id]/items/[itemId]/section/route.ts": "PATCH",
  "checklist-templates/[id]/items/[itemId]/unlink/route.ts": "POST",
  "checklist-templates/[id]/items/route.ts": "POST",
  "checklist-templates/enable/route.ts": "POST",
  "checklist-templates/item-questions/[id]/route.ts": "PATCH DELETE",
  "checklist-templates/item-questions/route.ts": "POST",
  "checklist-templates/needs-link/[lineId]/route.ts": "POST",
  "checklist-templates/registry/[itemId]/default/route.ts": "PATCH",
  "checklist-templates/registry/[itemId]/opening-verify/route.ts": "PATCH",
  "checklist-templates/registry/[itemId]/route.ts": "PATCH",
  "checklist-templates/registry/route.ts": "POST",
  "checklist-templates/section-questions/[id]/route.ts": "PATCH DELETE",
  "checklist-templates/section-questions/route.ts": "POST",
  "checklist-templates/sections/[slug]/disable/route.ts": "POST",
  "checklist-templates/sections/[slug]/reorder/route.ts": "PATCH",
  "checklist-templates/sections/[slug]/route.ts": "PATCH",
  "checklist-templates/sections/[slug]/shape/route.ts": "PATCH",
  "checklist-templates/sections/route.ts": "POST",
  "checklist-templates/units/route.ts": "POST",
  "customers/confirm/route.ts": "POST",
  "customers/export/route.ts": "POST",
  "customers/route.ts": "POST",
  "ezcater/location/route.ts": "POST",
  "items/[itemId]/sold-directly/route.ts": "PATCH",
  "menu-items/[id]/price/route.ts": "PATCH",
  "menu-items/route.ts": "POST",
  "order-types/route.ts": "GET POST",
  "products/[id]/active/route.ts": "POST",
  "products/[id]/members/route.ts": "POST DELETE",
  "products/[id]/primary/route.ts": "POST",
  "products/[id]/route.ts": "PATCH",
  "products/route.ts": "GET POST",
  "recipes/[id]/inputs/[inputId]/route.ts": "PATCH",
  "recipes/[id]/inputs/route.ts": "POST",
  "recipes/[id]/outputs/route.ts": "PATCH POST",
  "recipes/[id]/route.ts": "PATCH DELETE",
  "recipes/edges/route.ts": "DELETE",
  "recipes/full/route.ts": "POST",
  "recipes/route.ts": "POST",
  "recipes/yield-nudge/route.ts": "POST",
  "report-recipients/route.ts": "POST",
  "report-recipients/settings/route.ts": "POST",
  "sevenshifts/route.ts": "POST",
  "skus/[id]/location-settings/route.ts": "PUT",
  "skus/[id]/pack-chain/route.ts": "GET POST",
  "skus/[id]/price/route.ts": "POST",
  "skus/[id]/route.ts": "PATCH",
  "skus/measure-units/route.ts": "POST",
  "skus/pack-formats/route.ts": "POST",
  "skus/pending/route.ts": "GET POST",
  "skus/route.ts": "GET POST",
  "stations/route.ts": "POST",
  "stores/route.ts": "GET POST",
  "template-builder/[id]/items/[itemId]/spine-link/route.ts": "POST",
  "template-builder/[id]/items/[itemId]/translations/route.ts": "PATCH",
  "template-builder/[id]/publish/route.ts": "POST",
  "toast-employees/route.ts": "POST",
  "toast-map/[id]/route.ts": "POST",
  "toast-map/location/route.ts": "POST",
  "toast-map/manual/route.ts": "POST",
  "toast-map/match/route.ts": "POST",
  "toast-sales/exclusions/[id]/route.ts": "POST",
  "toast-sales/exclusions/route.ts": "POST",
  "toast-sales/pull/route.ts": "POST",
  "users/[id]/activate/route.ts": "POST",
  "users/[id]/deactivate/route.ts": "POST",
  "users/[id]/dormant/route.ts": "POST",
  "users/[id]/locations/route.ts": "POST",
  "users/[id]/reset-pin/route.ts": "POST",
  "users/[id]/role/route.ts": "POST",
  "users/[id]/route.ts": "GET PATCH",
  "users/[id]/set-password/route.ts": "POST",
  "users/[id]/wake/route.ts": "POST",
  "users/route.ts": "GET POST",
  "vendors/[id]/categories/route.ts": "PUT",
  "vendors/[id]/contacts/[contactId]/route.ts": "PATCH DELETE",
  "vendors/[id]/contacts/route.ts": "POST",
  "vendors/[id]/cutoffs/[cutoffId]/route.ts": "DELETE",
  "vendors/[id]/cutoffs/route.ts": "POST",
  "vendors/[id]/import/[batchId]/apply/route.ts": "POST",
  "vendors/[id]/order-types/route.ts": "PUT",
  "vendors/[id]/ordering-details/[detailId]/route.ts": "PATCH DELETE",
  "vendors/[id]/ordering-details/route.ts": "POST",
  "vendors/[id]/rhythm/route.ts": "POST DELETE",
  "vendors/[id]/rhythm/skips/route.ts": "POST DELETE",
  "vendors/[id]/route.ts": "GET PATCH",
  "vendors/[id]/schedule/route.ts": "PATCH",
  "vendors/[id]/transmission/route.ts": "PATCH",
  "vendors/route.ts": "GET POST",
  "weights/route.ts": "POST"
};

const readOnlyRoutes: Record<string, string> = {
  "checklist-templates/route.ts": "GET",
  "checklist-templates/[id]/route.ts": "GET",
  // Read-time classifier: driftReport may audit confirmed-to-stale observations; no operator mutation.
  "toast-map/drift/route.ts": "GET",
  "toast-sales/consumption/route.ts": "GET",
  "catalog/jobs/new-sandwich/preview/route.ts": "POST",
  "catalog/jobs/new-sandwich/reconcile/route.ts": "POST",
  "catalog/menu-item/[id]/preview/route.ts": "POST",
  "catalog/pack-requests/[requestId]/photo/route.ts": "GET",
  "catalog/recipe/[id]/preview/route.ts": "POST",
  "catalog/sku/[id]/preview/route.ts": "POST",
  "catering/packages/[id]/recommend/route.ts": "GET",
  "vendors/[id]/import/[batchId]/route.ts": "GET",
  "catalog/menu-item/[id]/share/preview/route.ts": "POST",
  "catalog/recipe/[id]/share/preview/route.ts": "POST",
  "catalog/sku/[id]/share/preview/route.ts": "POST",
  "catalog/sku/[id]/swap/preview/route.ts": "POST",
  "catalog/swaps/[swapId]/back-to-normal/preview/route.ts": "POST",
  "catalog/pack-requests/[requestId]/additions/[additionId]/photo/route.ts": "GET"
};

// Phase 5 placeholders: constant 501 responses, no authentication, body parsing, or I/O.
// Implementing any of these requires reclassification; their exact bodies are pinned below.
const stubRoutes: Record<string, string> = {
  "locations/route.ts": "GET POST",
  "pars/route.ts": "GET POST",
  "vendors/[id]/items/route.ts": "GET POST"
};
const inventory = { ...mutationRoutes, ...readOnlyRoutes, ...stubRoutes };

const mocks = vi.hoisted(() => ({ session: vi.fn(), step: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: mocks.session }));
vi.mock('@/lib/admin/step-up', () => ({ assertStepUp: mocks.step }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: mocks.db }));
const id = '11111111-1111-4111-8111-111111111111';
const params = { params: Promise.resolve({ id, itemId: id, inputId: id, sizeId: id, ruleId: id, contactId: id, cutoffId: id, detailId: id, batchId: id, requestId: id, swapId: id, slug: 'test' }) };
type Handler = (req: NextRequest, context: typeof params) => Promise<Response>;
const load = async (path: string): Promise<Record<string, Handler>> => import(/* @vite-ignore */ '../app/api/admin/' + path);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(Response.json({ code: 'unauthorized' }, { status: 401 }));
  mocks.db.mockImplementation(() => { throw new Error('Unexpected database access'); });
});
it('classifies every admin route and every exported HTTP handler, including mixed reads', async () => {
  const files = readdirSync('app/api/admin', { recursive: true }).map(String).map(p => p.replaceAll('\\', '/'))
    .filter(p => /(^|\/)route\.(ts|tsx|js|jsx|mts)$/.test(p)).sort();
  const classified = [...Object.keys(mutationRoutes), ...Object.keys(readOnlyRoutes), ...Object.keys(stubRoutes)];
  expect(new Set(classified).size).toBe(classified.length);
  expect(files).toEqual(Object.keys(inventory).sort());
  for (const path of files) {
    const route = await load(path);
    expect(Object.keys(route).filter(k => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k)).sort(), path)
      .toEqual(inventory[path]!.split(' ').sort());
  }
}, 120_000);
const mutations = Object.entries(mutationRoutes).flatMap(([path, methods]) => methods.split(' ')
  .filter(method => /^(POST|PUT|PATCH|DELETE)$/.test(method)).map(method => ({ path, method })));
describe.each(mutations)('$path $method', ({ path, method }) => {
  it('starts with the origin guard and immediate refusal before any other statement', () => {
    const source = ts.createSourceFile(path, readFileSync('app/api/admin/' + path, 'utf8'), ts.ScriptTarget.Latest, true);
    const handler = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === method) as ts.FunctionDeclaration;
    const statements = handler.body!.statements.map(n => n.getText(source));
    // Existing pure parameter resolution is allowed only at this reviewed site.
    if (path === 'vendors/[id]/order-guide/route.ts') {
      expect(statements.shift()).toBe('const { id } = await params;');
    }
    expect(statements.slice(0, 2)).toEqual([
      'const origin = assertSameOrigin(req);', 'if (origin) return origin;',
    ]);
  });
  it.each([undefined, 'https://attacker.invalid', 'null', 'not-a-url'])('rejects origin %s before session, body, step-up or database', async origin => {
    const route = await load(path);
    const request = new NextRequest('http://localhost/api/admin/' + path, { method, body: '{', headers: origin === undefined ? {} : { origin } });
    const body = vi.spyOn(request, 'json');
    const form = vi.spyOn(request, 'formData');
    const response = await route[method]!(request, params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'bad_origin' });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    expect(form).not.toHaveBeenCalled();
    expect(mocks.step).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('lets a same-origin request reach the existing session gate', async () => {
    const route = await load(path);
    const form = new FormData();
    form.set('file', new File(['test'], 'test.csv', { type: 'text/csv' }));
    const response = await route[method]!(new NextRequest('http://localhost/api/admin/' + path, {
      method, body: path === 'vendors/[id]/import/route.ts' ? form : '{}', headers: { origin: 'http://localhost' },
    }), params);
    expect(response.status).toBe(401);
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.step).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });
});

it.each(Object.keys(stubRoutes))('%s remains an inert 501 placeholder', path => {
  const source = ts.createSourceFile(path, readFileSync('app/api/admin/' + path, 'utf8'), ts.ScriptTarget.Latest, true);
  expect(source.statements).toHaveLength(4);
  expect(source.statements[0]!.getText(source)).toBe('import { NextResponse } from "next/server";');
  expect(source.statements[1]!.getText(source)).toMatch(/^const NOT_IMPLEMENTED = NextResponse\.json\(\s*\{ error: "[^"\n]+" \},\s*\{ status: 501 \},?\s*\);$/);
  for (const statement of source.statements.slice(2)) {
    expect(ts.isFunctionDeclaration(statement)).toBe(true);
    const handler = statement as ts.FunctionDeclaration;
    expect(handler.parameters).toHaveLength(0);
    expect(handler.body!.statements.map(n => n.getText(source))).toEqual(['return NOT_IMPLEMENTED;']);
  }
});

// POST previews are exceptions only while their reviewed read boundary remains intact.
it.each(Object.entries(readOnlyRoutes).filter(([, methods]) => methods.includes("POST")))('%s is a reviewed read-only POST', path => {
  expect(readBoundaryViolations(readFileSync('app/api/admin/' + path, 'utf8'))).toEqual([]);
});
