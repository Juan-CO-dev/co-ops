import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import ts from 'typescript';
import inventory from './helpers/api-origin-inventory.json';
import rolloutPaths from './helpers/api-origin-rollout.json';
import stubSourcePaths from './helpers/api-origin-stubs.json';

const rollout: Record<string, string> = Object.fromEntries(Object.entries(rolloutPaths).map(([path, methods]) => ['app/api/' + path, methods]));
const stubSources = Object.fromEntries(Object.entries(stubSourcePaths).map(([path, text]) => ['app/api/' + path, text]));

// Exact path AND method exceptions. Directory membership never grants an exemption.
const exceptions: Record<string, { kind: string; reason: string }> = {
  'app/api/vault/entries/route.ts POST': { kind: 'wrapper', reason: 'guardVaultRequest with mutating:true checks Origin before session/body/I/O.' },
  'app/api/vault/entries/[id]/route.ts PATCH': { kind: 'wrapper', reason: 'Same vault guard; only pure parameter resolution precedes it.' },
  'app/api/vault/entries/[id]/deactivate/route.ts POST': { kind: 'wrapper', reason: 'Same vault mutation guard.' },
  'app/api/vault/entries/[id]/recover/route.ts POST': { kind: 'wrapper', reason: 'Same vault mutation guard, before PIN/rate-limit/storage.' },
  'app/api/vault/entries/[id]/reveal/route.ts POST': { kind: 'wrapper', reason: 'Same vault mutation guard, before PIN/rate-limit/storage.' },
  'app/api/landing/ad-code/route.ts POST': { kind: 'landing', reason: 'Delegated landing guard enforces configured origin, host, fetch metadata and consent.' },
  'app/api/landing/events/route.ts POST': { kind: 'landing', reason: 'Same landing guard before body/Meta delivery.' },
  'app/api/landing/order-click/route.ts POST': { kind: 'landing', reason: 'Same landing guard before body/tracking.' },
  'app/api/webhooks/stripe/route.ts POST': { kind: 'webhook', reason: 'Stripe signature over raw body; external provider has no browser Origin.' },
  'app/api/webhooks/stripe/[locationCode]/route.ts POST': { kind: 'webhook', reason: 'Same signature verifier with shop-specific credentials.' },
  'app/api/webhooks/ezcater/route.ts POST': { kind: 'webhook', reason: 'Configured HMAC verifier and delivery ledger authenticate provider.' },
  'app/api/webhooks/resend-inbound/route.ts POST': { kind: 'webhook', reason: 'Svix signature verifies inbound mail before payload processing.' },
  'app/api/webhooks/twilio-inbound/route.ts POST': { kind: 'webhook', reason: 'Twilio URL/form signature verifies external SMS.' },
  'app/api/auth/logout/route.ts POST': { kind: 'logout', reason: 'Unconditional cookie clearing/session termination; auth-pin-source-throttle.test.ts pins the ruling.' },
  'app/api/ai/route.ts POST': { kind: 'stub', reason: 'Inert 501 only; implementing requires reclassification.' },
  'app/api/notifications/route.ts POST': { kind: 'stub', reason: 'Alias to inert GET 501; full AST pinned.' },
  'app/api/shifts/route.ts POST': { kind: 'stub', reason: 'Alias to inert GET 501; full AST pinned.' },
  'app/api/toast/route.ts POST': { kind: 'stub', reason: 'Alias to inert GET 501, NOT a webhook.' },
  'app/api/sms/process-queue/route.ts POST': { kind: 'stub', reason: 'Inert 501; no implemented secret-auth lane.' },
  'app/api/views/mark-read/route.ts POST': { kind: 'stub', reason: 'Inert 501 only.' },
  'app/api/checklist/instances/[id]/route.ts PATCH': { kind: 'stub', reason: 'Inert 501 only.' },
  'app/api/checklist/prep/generate/route.ts POST': { kind: 'stub', reason: 'Inert 501 only.' },
};
const http = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
const writes = /^(POST|PUT|PATCH|DELETE)$/;
const mutations = Object.entries(inventory).flatMap(([path, methods]) => methods.split(' ').filter(m => writes.test(m)).map(method => ({ path, method })));
const source = (path: string) => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
type HandlerFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
const exportedHandler = (s: ts.SourceFile, method: string): HandlerFunction => {
  const bindings = new Map<string, ts.FunctionDeclaration | ts.Expression>();
  const exports = new Map<string, string>();
  for (const node of s.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      bindings.set(node.name.text, node);
      if (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) exports.set(node.name.text, node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.initializer) {
        bindings.set(decl.name.text, decl.initializer);
        if (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export) exports.set(decl.name.text, decl.name.text);
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && !node.moduleSpecifier
      && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) if (!spec.isTypeOnly) exports.set(spec.name.text, (spec.propertyName ?? spec.name).text);
    }
  }
  let name = exports.get(method);
  const seen = new Set<string>();
  while (name && !seen.has(name)) {
    seen.add(name);
    const binding = bindings.get(name);
    if (binding && (ts.isFunctionDeclaration(binding) || ts.isFunctionExpression(binding) || ts.isArrowFunction(binding))) {
      if (binding.body && ts.isBlock(binding.body)) return binding;
      break;
    }
    name = binding && ts.isIdentifier(binding) ? binding.text : undefined;
  }
  throw new Error(`${s.fileName} ${method}: exported binding must resolve to a local function with a block body`);
};
const handler = (path: string, method: string) => {
  const s = source(path);
  return { s, f: exportedHandler(s, method) };
};

// Exercise export syntax independently of whichever syntax today's route files use.
it.each([
  'export async function POST(req: Request) { return guarded; }',
  'export const POST = async (req: Request) => { return guarded; };',
  'export const POST = async function(req: Request) { return guarded; };',
  'function x(req: Request) { return guarded; } export { x as POST };',
  'const x = (req: Request) => { return guarded; }; export const POST = x;',
])('resolves the exported binding: %s', text => {
  const s = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true);
  expect(exportedHandler(s, 'POST').body?.getText(s)).toBe('{ return guarded; }');
});
it.each([
  'function POST() {}',
  'export { POST } from "./elsewhere";',
  'const x = y; const y = x; export { x as POST };',
  'export const POST = () => response;',
])('fails closed for an unresolved body: %s', text => {
  const s = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true);
  expect(() => exportedHandler(s, 'POST')).toThrow('exported binding');
});

const mocks = vi.hoisted(() => ({ session: vi.fn(), customerSession: vi.fn(), db: vi.fn(), rate: vi.fn(), audit: vi.fn(), mail: vi.fn(), fetch: vi.fn(), stripeEvent: vi.fn(), ezDelivery: vi.fn() }));
vi.mock('@/lib/session', async original => ({ ...await original<typeof import('@/lib/session')>(), requireSession: mocks.session }));
vi.mock('@/lib/portal/session', async original => ({ ...await original<typeof import('@/lib/portal/session')>(), requireCustomerSession: mocks.customerSession }));
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: mocks.db, createAuthedClient: mocks.db }));
vi.mock('@/lib/portal/rate-limit', () => ({ checkAndRecord: mocks.rate }));
vi.mock('@/lib/email', async original => ({ ...await original<typeof import('@/lib/email')>(), sendEmail: mocks.mail }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit, auditChecked: mocks.audit }));
vi.mock('@/lib/stripe/webhook', async original => ({ ...await original<typeof import('@/lib/stripe/webhook')>(),
  resolveWebhookLocation: vi.fn(async () => ({ ok: true, locationId: null, locationCode: null })), processStripeEvent: mocks.stripeEvent,
}));
vi.mock('@/lib/catering/ezcater-intake', async original => ({ ...await original<typeof import('@/lib/catering/ezcater-intake')>(), processEzcaterDelivery: mocks.ezDelivery }));
const id = '11111111-1111-4111-8111-111111111111';
const params = { params: Promise.resolve({ id, locationCode: 'test' }) };
type Handler = (req: NextRequest, context: typeof params) => Promise<Response>;
const load = async (path: string): Promise<Record<string, Handler>> => import(/* @vite-ignore */ '../' + path);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockImplementation(() => { throw new Error('Unexpected network access'); });
  mocks.session.mockResolvedValue(Response.json({ code: 'unauthorized' }, { status: 401 }));
  mocks.customerSession.mockResolvedValue(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
  mocks.db.mockImplementation(() => { throw new Error('Unexpected database/storage access'); });
  mocks.rate.mockImplementation(() => { throw new Error('Unexpected rate-limit access'); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('classifies every route and runtime HTTP export, including aliases and re-exports', async () => {
  const files = readdirSync('app', { recursive: true }).map(String).map(p => p.replaceAll('\\', '/'))
    .map(p => 'app/' + p).filter(p => /(^|\/)route\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(p)).sort();
  // Reuse the admin test's adjudicated maps, parsed as AST (do not run its tests twice).
  const admin = ts.createSourceFile('admin', readFileSync('tests/admin-write-origin.test.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const adminInventory: Record<string, string> = {};
  for (const n of admin.statements) if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) {
    if (!['mutationRoutes', 'readOnlyRoutes', 'stubRoutes'].includes(d.name.getText(admin))) continue;
    expect(d.initializer && ts.isObjectLiteralExpression(d.initializer)).toBe(true);
    for (const p of (d.initializer as ts.ObjectLiteralExpression).properties) {
      expect(ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && ts.isStringLiteral(p.initializer)).toBe(true);
      const prop = p as ts.PropertyAssignment;
      adminInventory['app/api/admin/' + (prop.name as ts.StringLiteral).text] = (prop.initializer as ts.StringLiteral).text;
    }
  }
  expect(Object.keys(adminInventory).length).toBeGreaterThan(0);
  const all = { ...inventory, ...adminInventory };
  expect(files).toEqual(Object.keys(all).sort());
  for (const path of files) {
    const route = await load(path);
    expect(Object.keys(route).filter(k => http.test(k)).sort(), path).toEqual(all[path as keyof typeof all]!.split(' ').sort());
  }
  for (const [key, entry] of Object.entries(exceptions)) {
    expect(mutations.some(e => `${e.path} ${e.method}` === key), key).toBe(true);
    expect(entry.reason.length).toBeGreaterThanOrEqual(15);
  }
  expect(mutations.length).toBe(105);
  expect(mutations.filter(e => !exceptions[`${e.path} ${e.method}`])).toHaveLength(83);
}, 120_000);

// Full parsed stub source includes alias targets and module initializers: an implemented
// GET behind POST = GET or a new side effect must fail, even if POST still returns 501.
it.each(Object.entries(stubSources))('%s stays inert', (path, expected) => {
  expect(ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(source(path))).toBe(expected);
});
const direct = mutations.filter(e => !exceptions[`${e.path} ${e.method}`]);
describe.each(direct)('$path $method guard placement', ({ path, method }) => {
  it('imports the real guard and refuses before any other statement', () => {
    const { s, f } = handler(path, method);
    const imported = s.statements.filter(ts.isImportDeclaration).some(n => ts.isStringLiteral(n.moduleSpecifier)
      && n.moduleSpecifier.text === '@/lib/portal/csrf' && n.importClause?.namedBindings
      && ts.isNamedImports(n.importClause.namedBindings) && n.importClause.namedBindings.elements.some(e => e.name.text === 'assertSameOrigin' && !e.propertyName));
    expect(imported).toBe(true);
    const statements = [...(f.body as ts.Block).statements];
    const first = statements[0]!;
    expect(ts.isVariableStatement(first)).toBe(true);
    const declaration = (first as ts.VariableStatement).declarationList.declarations[0]!;
    expect(declaration.initializer?.getText(s)).toBe('assertSameOrigin(req)');
    const name = declaration.name.getText(s);
    expect(statements[1]!.getText(s)).toBe('if (' + name + ') return ' + name + ';');
    if (rollout[path] || path === 'app/api/schedule/route.ts' || path === 'app/api/schedule/settings/route.ts') {
      expect(first.getText(s)).toBe('const origin = assertSameOrigin(req);');
    }
  });
});

const covered = mutations.filter(e => !exceptions[`${e.path} ${e.method}`] || exceptions[`${e.path} ${e.method}`]?.kind === 'wrapper');
const refusals = [undefined, 'https://attacker.invalid', 'null', 'not-a-url', 'cross-site'] as const;
describe.each(covered)('$path $method real guard', ({ path, method }) => {
  it.each(refusals)('refuses %s before parsing/auth/rate-limit/storage/audit', async origin => {
    const route = await load(path);
    const headers: Record<string, string> = origin === undefined ? {} : origin === 'cross-site' ? { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' } : { origin };
    const formData = new FormData(); formData.set('file', new File(['test'], 'test.png', { type: 'image/png' }));
    const req = new NextRequest('http://localhost/' + path.replace(/^app\//, ''), { method, headers, body: path === 'app/api/photos/route.ts' || (path === 'app/api/operations/receiving/email-receipts/route.ts' && method === 'POST') ? formData : '{' });
    const json = vi.spyOn(req, 'json'), form = vi.spyOn(req, 'formData'), text = vi.spyOn(req, 'text');
    const resolveParams = vi.fn(() => { throw new Error('Unexpected parameter resolution'); });
    const context = exceptions[`${path} ${method}`]?.kind === 'wrapper' ? params
      : { params: { then: resolveParams } as unknown as typeof params.params };
    const response = await route[method]!(req, context);
    expect(resolveParams).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'bad_origin' });
    for (const spy of [json, form, text, ...Object.values(mocks)]) expect(spy).not.toHaveBeenCalled();
  });
  it('matching Origin reaches the existing parser or session gate', async () => {
    const route = await load(path);
    const req = new NextRequest('http://localhost/' + path.replace(/^app\//, ''), { method, headers: { origin: 'http://localhost' }, body: '{' });
    const json = vi.spyOn(req, 'json');
    const response = await route[method]!(req, params);
    if (mocks.session.mock.calls.length) {
      expect(response.status).toBe(401);
      expect(mocks.session).toHaveBeenCalledOnce();
    } else if (mocks.customerSession.mock.calls.length) {
      expect(response.status).toBe(401);
      expect(mocks.customerSession).toHaveBeenCalledOnce();
      expect(json).not.toHaveBeenCalled();
    } else {
      expect(json).toHaveBeenCalledOnce();
      // Password reset and magic-link requests return constant success to prevent enumeration.
      expect(response.status).toBe(['app/api/auth/password-reset-request/route.ts', 'app/api/portal/magic-link/request/route.ts'].includes(path) ? 200 : 400);
    }
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });
});

it.each(mutations.filter(e => exceptions[`${e.path} ${e.method}`]?.kind === 'wrapper'))('$path explicitly opts into the vault mutation guard', ({ path, method }) => {
  const { s, f } = handler(path, method);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(s) === 'guardVaultRequest') calls.push(n); ts.forEachChild(n, visit); };
  visit(f);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.arguments[2]!.getText(s)).toBe('{ mutating: true }');
});

it.each(['app/api/landing/ad-code/route.ts', 'app/api/landing/events/route.ts', 'app/api/landing/order-click/route.ts'])('%s retains its configured-origin guard before payload processing', async path => {
  vi.stubEnv('LANDING_HOSTS', 'landing.example'); vi.stubEnv('SITE_ORIGIN', 'https://landing.example'); vi.stubEnv('STAFF_ORIGIN', 'https://staff.example');
  const route = await load(path);
  for (const origin of refusals) {
    const headers: Record<string, string> = { host: 'landing.example', cookie: 'landing_consent=accepted', 'content-type': 'application/json' };
    if (origin !== undefined) headers.origin = origin === 'cross-site' ? 'https://landing.example' : origin;
    if (origin === 'cross-site') headers['sec-fetch-site'] = 'cross-site';
    const req = new NextRequest('https://landing.example/' + path.replace(/^app\//, ''), { method: 'POST', headers, body: '{' });
    const reader = vi.spyOn(req.body!, 'getReader');
    expect((await route.POST!(req, params)).status).toBe(403);
    expect(reader).not.toHaveBeenCalled();
  }
  expect(mocks.db).not.toHaveBeenCalled();
});

// GET-only cron endpoints are not mutation-method exemptions. Their external callers
// authenticate with secrets, and adding a POST still changes the exact export inventory.
const cronGet = [
  'app/api/cron/digest-tick/route.ts', 'app/api/cron/job-watch/route.ts', 'app/api/cron/parse-receipts/route.ts',
  'app/api/cron/prune-sessions/route.ts', 'app/api/cron/schedule-draft/route.ts', 'app/api/cron/sevenshifts-sync/route.ts',
  'app/api/cron/toast-catering-scan/route.ts', 'app/api/cron/toast-sales-pull/route.ts', 'app/api/cron/toast-sales-today/route.ts',
];
it.each(cronGet)('%s refuses a missing or wrong secret before work, even with browser Origin', async path => {
  vi.stubEnv('CRON_SECRET', 'test-only-cron-secret');
  vi.stubEnv('CATERING_SCAN_SECRET', 'test-only-scan-secret');
  const route = await load(path);
  const attempts: Record<string, string>[] = [{ origin: 'http://localhost' }, { origin: 'http://localhost', authorization: 'Bearer wrong' }];
  for (const headers of attempts) {
    const response = await route.GET!(new NextRequest('http://localhost/' + path.replace(/^app\//, ''), { headers }), params);
    expect(response.status).toBe(401);
  }
  for (const spy of Object.values(mocks)) expect(spy).not.toHaveBeenCalled();
});

it.each(mutations.filter(e => exceptions[`${e.path} ${e.method}`]?.kind === 'webhook'))('$path requires provider authentication, not browser Origin', async ({ path, method }) => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'test-only-stripe-key');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test-only-stripe-webhook');
  vi.stubEnv('EZCATER_WEBHOOK_SECRET', 'test-only-ez-secret');
  vi.stubEnv('EZCATER_API_TOKEN', 'test-only-ez-token');
  vi.stubEnv('RESEND_INBOUND_SECRET', ['whsec', Buffer.from('test-only-svix-key').toString('base64')].join('_'));
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-only-twilio-token');
  mocks.rate.mockResolvedValue(true);
  mocks.db.mockReturnValue({}); // Stripe shop resolution is an explicit mocked read, never a live DB.
  mocks.ezDelivery.mockResolvedValue({ result: 'invalid_signature' });
  const route = await load(path);
  const req = new NextRequest('http://localhost/' + path.replace(/^app\//, ''), { method, body: '{}', headers: { origin: 'http://localhost' } });
  const response = await route[method]!(req, params);
  expect(response.status).toBe(401);
  expect((await response.json()).code).toBe('invalid_signature');
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.stripeEvent).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  if (path === 'app/api/webhooks/ezcater/route.ts') {
    // Invalid deliveries are ledgered by design, but the real HMAC result must be false.
    expect(mocks.ezDelivery).toHaveBeenCalledExactlyOnceWith('{}', false);
  } else expect(mocks.ezDelivery).not.toHaveBeenCalled();
});

it.each(['app/api/photos/route.ts', 'app/api/operations/receiving/email-receipts/route.ts'])('%s accepts same-origin multipart through the existing session gate', async path => {
  const route = await load(path);
  const form = new FormData(); form.set('file', new File(['test'], 'receipt.png', { type: 'image/png' }));
  const response = await route.POST!(new NextRequest('http://localhost/' + path.replace(/^app\//, ''), { method: 'POST', headers: { origin: 'http://localhost' }, body: form }), params);
  expect(response.status).toBe(401);
  expect(mocks.session).toHaveBeenCalledOnce();
  expect(mocks.db).not.toHaveBeenCalled();
});
