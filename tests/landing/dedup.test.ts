import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/landing/ad-codes-server', () => ({ createAdCodeResolver: () => async () => 'unattributed' }));
import { browserTransport, createLandingTracker, type LandingAction, type ActionDetails } from '@/lib/landing/tracking-client';
import { handleMetaEvent } from '@/lib/landing/meta-server';

const origin = 'https://landing.example';
const instant = Date.UTC(2026, 10, 1, 12, 30, 15, 789);
const paths: [LandingAction, ActionDetails][] = [
  ['Lead', { placement: 'hero' }], ['CateringClick', { placement: 'catering' }],
  ['OrderClick', { mode:'pickup', placement: 'hero', store: 'dupont' }],
  ['OrderClick', { mode:'pickup', placement: 'lineup', store: 'dupont', item: 'crunchy-boi' }],
  ['OrderClick', { placement: 'shops', store: 'dupont', vendor: 'ubereats' }],
  ['OrderClick', { placement: 'footer', vendor: 'ubereats' }],
  ['OrderClick', { placement: 'footer', vendor: 'doordash' }],
];
function fixture() {
  let clock = instant;
  const pixel = vi.fn(), post = vi.fn(), now = vi.fn(() => clock);
  const tracker = createLandingTracker({ serverApproved: true, pixelId: '123', capiEnabled: true, sourceUrl: `${origin}/`, allowedStores: ['dupont'], allowedAds: ['unattributed'], allowedPlacements: ['hero', 'catering', 'lineup', 'shops', 'footer'] }, { pixel, post, now, uuid: randomUUID, loadPixel: vi.fn(), revokePixel: vi.fn() });
  return { tracker, pixel, post, now, advance: () => { clock += 30_000; } };
}
async function upstream(payload: Record<string, unknown>) {
  const send = vi.fn(async () => new Response(null, { status: 200 }));
  const env = { LANDING_HOSTS: 'landing.example', SITE_ORIGIN: origin, STAFF_ORIGIN: 'https://staff.example', META_PIXEL_ID: '123', NEXT_PUBLIC_META_PIXEL_ID: '123', META_CAPI_ACCESS_TOKEN: randomBytes(32).toString('hex'), META_GRAPH_API_VERSION: 'v25.0', LANDING_CAPI_ENABLED: 'true', LANDING_META_UA_APPROVED: 'true', LANDING_WAF_STATE: 'active', LANDING_WAF_VERIFIED_AT: '2026-11-01', LANDING_WAF_RULE_IDS: 'ip,aggregate' };
  const response = await handleMetaEvent(new Request(`${origin}/api/landing/events`, { method: 'POST', headers: { host: 'landing.example', origin, cookie: 'landing_consent=accepted', 'content-type': 'application/json', 'user-agent': 'offline-test' }, body: JSON.stringify({ ...payload, fbp: `fb.1.${instant}.123` }) }), { env, now: () => instant + 30_000, send, resolveAd: async () => 'unattributed' });
  expect(response.status).toBe(204);
  expect(send).toHaveBeenCalledTimes(1);
  const calls = send.mock.calls as unknown as [string, RequestInit][];
  return JSON.parse(String(calls[0]![1].body)).data[0];
}
describe('pixel / CAPI dedup contract', () => {
  it.each(paths)('%s preserves identity and original instant through every dispatch form (%j)', async (name, details) => {
    for (const factory of [false, true]) for (const explicit of [false, true]) {
      const f = fixture(); f.tracker.setConsent(true);
      const event = explicit ? { id: randomUUID(), time: instant - 5000 } : undefined;
      f.tracker.dispatch(name, factory ? () => details : details, event);
      const payload = f.post.mock.calls.find(call => call[0] === '/api/landing/events')![1];
      const capi = await upstream(payload);
      expect(f.pixel).toHaveBeenCalledTimes(1);
      expect(f.pixel.mock.calls[0]?.[3]).toBe(capi.event_id);
      expect(f.pixel.mock.calls[0]?.[1]).toBe(capi.event_name);
      expect(capi.event_time).toBe(Math.floor((event?.time ?? instant) / 1000));
      expect(f.now).toHaveBeenCalledTimes(explicit ? 0 : 1);
    }
  });
  it('buffered Lead retains its capture instant after delayed resolution', async () => {
    const f = fixture(); f.tracker.beginResolution(); f.tracker.dispatch('Lead', () => ({ placement: 'hero' }));
    f.advance(); f.tracker.setConsent(true); f.tracker.flushPending('unattributed'); f.tracker.flushPending('unattributed');
    const capi = await upstream(f.post.mock.calls[0]![1]);
    expect(f.pixel).toHaveBeenCalledTimes(1);
    expect(f.pixel.mock.calls[0]?.[3]).toBe(capi.event_id);
    expect(f.pixel.mock.calls[0]?.[1]).toBe(capi.event_name);
    expect(capi.event_time).toBe(Math.floor(instant / 1000));
    expect(f.now).toHaveBeenCalledTimes(1);
  });
  it.each(['OrderClick', 'CateringClick'] as const)('navigating %s is server-only and retains supplied identity/time', async name => {
    for (const explicit of [false, true]) {
      const f = fixture(); f.tracker.beginResolution(); const event = explicit ? { id: randomUUID(), time: instant } : undefined;
      f.tracker.dispatch(name, () => ({ mode:name==='OrderClick'?'pickup':undefined, placement: 'hero', store: 'dupont' }), event);
      const capi = await upstream(f.post.mock.calls.find(call => call[0] === '/api/landing/events')![1]);
      expect(f.pixel).not.toHaveBeenCalled(); expect(capi.event_name).toBe(name);
      if (event) expect(capi.event_id).toBe(event.id);
      expect(capi.event_time).toBe(Math.floor(instant / 1000));
      f.tracker.setConsent(true); f.tracker.flushPending('unattributed'); expect(f.pixel).not.toHaveBeenCalled();
    }
  });
  it('PageView and ViewContent have no server counterpart', () => {
    const f = fixture(); f.tracker.setConsent(true); f.tracker.pageView(); f.tracker.sectionView('hero');
    expect(f.pixel.mock.calls.map(call => call[1])).toEqual(['PageView', 'ViewContent']); expect(f.post).not.toHaveBeenCalled();
  });
  it('browser adapter places the shared id in eventID', () => {
    const fbq = vi.fn(); vi.stubGlobal('window', { fbq });
    try { const id = randomUUID(); browserTransport().pixel('track', 'Lead', {}, id); expect(fbq).toHaveBeenCalledWith('track', 'Lead', {}, { eventID: id }); }
    finally { vi.unstubAllGlobals(); }
  });
});
