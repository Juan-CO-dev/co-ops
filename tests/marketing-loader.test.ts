import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLES } from '@/lib/roles';
import { canReadMarketing, marketingTileVisible } from '@/lib/marketing/access-shared';
import { buildMarketingBaseline, loadMarketingScorecard, marketingHeads, marketingBaselineDrift, type MarketingDeps } from '@/lib/marketing/scorecard';
import { classifyLandingHost } from '@/lib/landing/host-shared';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';
import { computeScorecard } from '@/lib/marketing/scorecard-shared';

const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', MARKETING_SCORECARD: '1' };
const viewer = { role: 'moo' as const, level: 8, locations: [] };
function client(error: { code: string } | null = null) {
  const from = vi.fn(() => {
    const query = { select: () => query, order: () => query, range: vi.fn().mockResolvedValue({ data: [], error }) };
    return query;
  });
  return { from, rpc: vi.fn() };
}
afterEach(() => vi.unstubAllEnvs());
describe('marketing exact-role boundary', () => {
  it.each(Object.values(ROLES))('$code loader and hub visibility', async role => {
    const allowed = ['moo', 'owner', 'cgs'].includes(role.code);
    const db = client();
    expect(canReadMarketing(role.code)).toBe(allowed);
    expect(marketingTileVisible(role.code, '1')).toBe(allowed);
    expect(marketingTileVisible(role.code, undefined)).toBe(false);
    const work = loadMarketingScorecard({ ...viewer, role: role.code, level: role.level }, null, { client: db as unknown as MarketingDeps['client'], env: {} as NodeJS.ProcessEnv });
    if (allowed) expect(await work).toEqual({ state: 'unavailable', reason: 'not_switched_on' });
    else await expect(work).rejects.toThrow('role_not_allowed');
    expect(db.from).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(['42P01', '42883', 'PGRST202'])('missing deployment %s is unavailable', async code => {
    const db = client({ code });
    expect(await loadMarketingScorecard(viewer, null, { client: db as unknown as MarketingDeps['client'], env })).toEqual({ state: 'unavailable', reason: 'counter_not_installed' });
  });
  it('finds heads independent of UUID order', () => {
    expect(marketingHeads([{ id: 'new', corrects_id: 'old' }, { id: 'old', corrects_id: null }])).toEqual([{ id: 'new', corrects_id: 'old' }]);
  });
});

it('production identity keeps bare landing isolated from staff and www', async () => {
  const production = { LANDING_HOSTS: 'complimentsonlyoperations.com', SITE_ORIGIN: 'https://complimentsonlyoperations.com', STAFF_ORIGIN: 'https://co-ops-ashy.vercel.app' };
  for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
  for (const host of ['co-ops-ashy.vercel.app', 'www.complimentsonlyoperations.com']) expect(classifyLandingHost(new Headers({ host }), production)).toBe('staff');
  const host = 'complimentsonlyoperations.com';
  expect(classifyLandingHost(new Headers({ host }), production)).toBe('landing');
  for (const path of ['/admin/marketing', '/admin/marketing/ad-codes', '/api/admin/marketing/milestones', '/api/admin/marketing/entries', '/api/admin/marketing/baseline-snapshot']) {
    expect((await proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }))).status).toBe(404);
  }
});

it('normalizes SQL aggregates and keeps the global read concurrency at two', async () => {
  let active = 0, peak = 0;
  const shops = [{ id: 'one', name: 'One', code: 'one' }, { id: 'two', name: 'Two', code: 'two' }, { id: 'three', name: 'Three', code: 'three' }];
  const from = vi.fn((table: string) => {
    const query = { select: () => query, order: () => query, range: async () => ({ data: table === 'locations' ? shops : [], error: null }) };
    return query;
  });
  const rpc = vi.fn(async (name: string, args: { p_from: string; p_to: string }) => {
    active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
    expect((Date.parse(args.p_to) - Date.parse(args.p_from)) / 86400000).toBeLessThanOrEqual(27);
    if (name === 'marketing_order_tap_intents') return { data: [], error: null };
    if (name === 'sales_report_catering_values') return { data: { completed_events: 2, completed_value_cents: 300, completed_unvalued: 0 }, error: null };
    return { data: { channels: [{ business_date: args.p_from, channel: 'online', provider: null, checks: '1', orders: '1', cents: '500', amount_missing: '0' }], direct_online_orders: [{ business_date: args.p_from, orders: '1' }], large_checks: [], unknown_labels: [], ezcater: [], captured_days: [args.p_from] }, error: null };
  });
  const data = await loadMarketingScorecard(viewer, null, { client: { from, rpc } as unknown as MarketingDeps['client'], env, now: new Date('2026-11-01T17:00:00Z') });
  expect(data.state).toBe('ok');
  if (data.state !== 'ok') throw new Error('missing scorecard');
  expect(data.series).toHaveLength(4);
  expect(data.series[0]!.score.classifiedCents.value).toBe(1500);
  expect(data.series[0]!.score.directOnlineOrders.value).toBe(3);
  expect(data.series[0]!.score.pipeline.events.value).toBe(6);
  expect(data.series[0]!.score.coverage.capturedDays).toBe(3);
  expect(peak).toBeLessThanOrEqual(2);
});

it('uses the frozen baseline, flags live drift, and excludes future days from current coverage', async () => {
  const frozen = computeScorecard({ window: { from: '2026-09-21', to: '2026-10-18' }, locationIds: ['one'],
    channels: [{ locationId: 'one', day: '2026-09-21', channel: 'online', provider: null, checks: 1, orders: 1, cents: 2500, amountMissing: false }],
    capturedDays: [{ locationId: 'one', day: '2026-09-21' }], directOnlineOrders: [], ezcater: [], unknownLabels: [], largeChecks: [], pipeline: [] });
  expect(marketingBaselineDrift({ ...frozen, onlineDirectShare: { state: 'ok', value: 0.9 } }, frozen)).toBe(true);
  const tables: Record<string, unknown[]> = {
    locations: [{ id: 'one', name: 'One', code: 'one' }],
    marketing_milestones: [{ id: 'first', kind: 'first_ad_spend', milestone_date: '2026-10-19', corrects_id: null }],
    marketing_baseline_snapshots: [{ id: 'snapshot', milestone_id: 'first', payload: { ...frozen, byLocation: { one: frozen } }, coverage: frozen.coverage, corrects_id: null }],
  };
  const from = (table: string) => { const query = { select: () => query, order: () => query, range: async () => ({ data: tables[table] ?? [], error: null }) }; return query; };
  const rpc = async (name: string, args: { p_from: string }) => ({ error: null, data: name === 'marketing_order_tap_intents' ? [] : name === 'sales_report_catering_values' ? null : {
    channels: [{ business_date: args.p_from, channel: 'online', provider: null, checks: 1, orders: 1, cents: 500, amount_missing: 0 }], direct_online_orders: [], captured_days: [args.p_from], large_checks: [], unknown_labels: [], ezcater: [],
  } });
  const data = await loadMarketingScorecard(viewer, 'one', { client: { from, rpc } as unknown as MarketingDeps['client'], env, now: new Date('2026-10-28T17:00:00Z') });
  expect(data.state).toBe('ok');
  if (data.state !== 'ok') throw new Error('missing scorecard');
  expect(data.baseline?.classifiedCents.value).toBe(2500);
  expect(data.baselineDrift).toBe(true);
  const current = data.series.at(-1)!;
  expect(current.window.daysSoFar).toBe(3);
  expect(current.score.coverage.expectedDays).toBe(2);
  expect(current.costPerExtraOrder.value).toBeNull();
});


it.each(['42501', '57014', 'PGRST000'])('reports unexpected loader error %s without logging source details', async code => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const db = client({ code });
    expect(await loadMarketingScorecard(viewer, null, { client: db as unknown as MarketingDeps['client'], env })).toEqual({ state: 'load_failed' });
    expect(log).toHaveBeenCalledWith('marketing_scorecard_load_failed');
  } finally { log.mockRestore(); }
});

function baselineDb(first: string | null = '2026-10-19') {
  const from = vi.fn((table: string) => {
    const data = table === 'locations' ? [{ id: 'one', name: 'One', code: 'one' }] : table === 'marketing_milestones' && first ? [{ id: 'first', kind: 'first_ad_spend', milestone_date: first, corrects_id: null }] : [];
    const query = { select: () => query, order: () => query, range: async () => ({ data, error: null }) }; return query;
  });
  const rpc = vi.fn(async (name: string, args: { p_from: string; p_to: string }) => ({ error: null, data: name === 'marketing_order_tap_intents' ? [] : name === 'sales_report_catering_values' ? { completed_events: 1, completed_value_cents: 100, completed_unvalued: 0 } : {
    channels: [], direct_online_orders: [], captured_days: [args.p_from], large_checks: [], unknown_labels: [], ezcater: [],
  } }));
  return { from, rpc };
}
it('reads baseline sales once and slices four weeks without rereading sales', async () => {
  const db = baselineDb();
  const data = await loadMarketingScorecard(viewer, null, { client: db as unknown as MarketingDeps['client'], env, now: new Date('2026-10-28T17:00:00Z') });
  if (data.state !== 'ok') throw new Error('missing scorecard');
  const baselineCalls = db.rpc.mock.calls.filter(([name, args]) => name === 'marketing_scorecard_days' && args.p_from < '2026-10-19');
  expect(baselineCalls).toEqual([['marketing_scorecard_days', { p_location_id: 'one', p_from: '2026-09-21', p_to: '2026-10-18' }]]);
  expect(data.baselineSeries).toHaveLength(4);
  expect(data.baselineSeries.map(row => row.score.coverage.capturedDays)).toEqual([1, 0, 0, 0]);
  expect(data.baseline?.pipeline.events.value).toBe(4);
  expect(data.baselineSeries.map(row => row.score.pipeline.events.value)).toEqual([1, 1, 1, 1]);
});
it('builds only the baseline and reuses its data for per-shop snapshots', async () => {
  const db = baselineDb();
  const result = await buildMarketingBaseline(viewer, { client: db as unknown as MarketingDeps['client'], env });
  expect(result.payload.byLocation.one?.coverage).toEqual(result.coverage);
  expect(db.from.mock.calls.map(([table]) => table)).toEqual(['marketing_milestones', 'locations']);
  // One 28-day sales read; catering values per baseline week, exactly like the live loader (no drift).
  expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(['marketing_scorecard_days', ...Array(4).fill('sales_report_catering_values')]);
  expect(result.payload.pipeline.events.value).toBe(4);
});
it('refuses a snapshot without D before reading sales', async () => {
  const db = baselineDb(null);
  await expect(buildMarketingBaseline(viewer, { client: db as unknown as MarketingDeps['client'], env })).rejects.toThrow('no_first_ad_spend');
  expect(db.rpc).not.toHaveBeenCalled();
});
it('has zero eligible capture days on D and never queries a reversed sales window', async () => {
  const db = baselineDb();
  const data = await loadMarketingScorecard(viewer, null, { client: db as unknown as MarketingDeps['client'], env, now: new Date('2026-10-19T17:00:00Z') });
  if (data.state !== 'ok') throw new Error('missing scorecard');
  expect(data.series[0]?.score.coverage.expectedDays).toBe(0);
  expect(data.series[0]?.score.directOnlineOrders.value).toBeNull();
  expect(db.rpc.mock.calls.every(([, args]) => args.p_from <= args.p_to)).toBe(true);
});
