import { randomUUID } from 'node:crypto';
import * as driver from '../concurrency/driver.mjs';
import { createManagementClient, SIM_REF, lit, one, joined } from '../../catalog-jobs/management-api.mjs';
import { runCatalogApiEvidence } from '../../catalog-jobs/concurrency.mjs';

/** No main(): the actual F4 runner owns reset, server identity, lease and evidence. */
export async function runCatalogContracts(options: {
  assertLease: () => void; verifiedServer: boolean; pin: string; password: string;
}) {
  options.assertLease();
  if (!options.verifiedServer || !/^\d{4}$/.test(options.pin) || !options.password) throw new Error('Catalog private controls missing');
  const report = driver.makeReport('Catalog Phase 4a');
  const q = createManagementClient({ ref: SIM_REF, assertLease: options.assertLease, verifiedServer: options.verifiedServer });
  const user = await driver.findUser(driver.LOC.EM, 'gm', 'Marcus Webb');
  const session = await new driver.Session(user, options.pin).login(driver.LOC.EM);
  const unlock = await session.call('POST', '/api/auth/step-up', { password: options.password, catalogWindow: true });
  report.check('catalog.session-tier-e-unlock', unlock.status === 200);
  if (unlock.status !== 200) return report.done();
  const prefix = `F4-http-${randomUUID()}`;
  report.check('catalog.http-fixture-prefix', true, prefix);
  try {
    const vendor = await one(q, 'select id from vendors where active order by id limit 1');
    const request = { request_id: randomUUID(), scope: driver.LOC.EM, vendorId: vendor.id,
      name: prefix, itemNumber: prefix, levels: [{ label: 'case', containsQty: 16, containsIndex: null, containsMeasureUnit: 'oz' }],
      unitPrice: 8, priceDate: '2020-01-01', avgOzPerEach: null, skuClass: 'raw' };
    const responses = await joined([session.call('POST', '/api/admin/catalog/jobs/new-item', request), session.call('POST', '/api/admin/catalog/jobs/new-item', request)]);
    report.check('catalog.http-replay-one-create', responses.filter((r: { status: number }) => r.status === 201).length === 1 && responses.filter((r: { status: number; json?: { replayed?: boolean } }) => r.status === 200 && r.json?.replayed).length === 1);
    report.check('catalog.http-replay-same-identity', Boolean(responses[0]?.json?.skuId) && responses[0]?.json?.skuId === responses[1]?.json?.skuId);
    const persisted = await one(q, `select count(*)::int n from vendor_items where request_id=${lit(request.request_id)}`);
    report.check('catalog.http-replay-persisted-one', persisted.n === 1);
    await runCatalogApiEvidence({ q, actor: user.id, shop: driver.LOC.EM, check: report.check,
      primaryRequest: (product: string, primarySkuId: string) => session.call('POST', `/api/admin/products/${product}/primary`, { locationId: driver.LOC.EM, primarySkuId }) });
  } catch (error) {
    const code = error instanceof Error ? error.message.match(/(?:shop_owned|recipe_version|swap):[a-z_]+/)?.[0] : undefined;
    report.check('catalog.scenarios-completed', false, code ?? 'scenario or retirement failed');
  } finally {
    const retired = await q(`update vendor_items set active=false where name=${lit(prefix)}`);
    report.check('catalog.http-fixture-retired', retired.ok);
  }
  return report.done();
}
