import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import roster from '@/config/tenant/landing-products.json';
import en from '@/lib/i18n/en.json';
import es from '@/lib/i18n/es.json';
import { landingTenantConfig } from '@/config/tenant/landing';
import { closingToday, formatClock, shopWeekday } from '@/lib/landing/hours-shared';
import { orderDetail } from '@/lib/landing/order-details';
import { createLandingTracker } from '@/lib/landing/tracking-client';
import { LANDING_ITEMS, LANDING_PLACEMENTS, parseLandingEvent } from '@/lib/landing/tracking-schema-shared';
import { parseOrderClick } from '@/lib/landing/order-click-shared';
import { loadLandingConfig } from '@/lib/landing/config';
import { projectLandingStores } from '@/lib/landing/stores';
import { Shops } from '@/components/landing/Shops';

const daily = { days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], opens: '10:30', closes: '18:00' };
// 2026-10-19 is a Monday. 03:30 UTC Monday is still Sunday evening in Washington.
const mondayNoonEt = new Date('2026-10-19T16:00:00Z');
const sundayNightEt = new Date('2026-10-19T03:30:00Z');

describe('today\'s closing time (static hours, America/New_York)', () => {
  it('reads the weekday in the shops\' own time zone, not UTC', () => {
    expect(shopWeekday(mondayNoonEt)).toBe('Monday');
    expect(shopWeekday(sundayNightEt)).toBe('Sunday');
  });
  it('returns today\'s close only when the data says the shop opens today', () => {
    expect(closingToday(daily, mondayNoonEt)).toBe('18:00');
    expect(closingToday({ ...daily, days: ['Monday'] }, sundayNightEt)).toBeNull();
    expect(closingToday({ ...daily, days: ['Sunday'] }, sundayNightEt)).toBe('18:00');
    for (const closes of ['6pm', '24:00', '18:0', '']) expect(closingToday({ ...daily, closes }, mondayNoonEt)).toBeNull();
    expect(closingToday(null, mondayNoonEt)).toBeNull();
    expect(closingToday(daily, new Date('invalid'))).toBeNull();
  });
  it('formats the time in each language', () => {
    expect(formatClock('18:00', 'en')).toBe('6 PM');
    expect(formatClock('20:00', 'es')).toBe('8 p. m.');
    expect(formatClock('18:30', 'en')).toBe('6:30 PM');
    expect(formatClock('00:00', 'en')).toBe('12 AM');
    expect(formatClock('12:00', 'es')).toBe('12 p. m.');
  });
  it('builds the order-button line from config: street, then today\'s close (or the street alone)', () => {
    const [capitolHill, dupont] = landingTenantConfig.stores;
    expect(orderDetail(capitolHill!, 'en', mondayNoonEt).line).toBe('8th St SE · til 6 PM');
    expect(orderDetail(dupont!, 'en', mondayNoonEt).line).toBe('P St NW · til 8 PM');
    expect(orderDetail(dupont!, 'es', mondayNoonEt).line).toBe('P St NW · hasta las 8 p. m.');
    const closed = orderDetail({ ...capitolHill!, openingHours: { ...daily, days: [] } }, 'en', mondayNoonEt);
    expect(closed).toEqual({ street: '8th St SE', until: null, line: '8th St SE' });
  });
  it('every configured street is the street printed in that shop\'s address (no invented addresses)', () => {
    for (const store of landingTenantConfig.stores) {
      expect(store.street.length).toBeGreaterThan(0);
      expect(store.address).toContain(` ${store.street} `);
      expect(store.structuredAddress.streetAddress).toContain(store.street);
    }
  });
  it('shop cards show today\'s close under the hours and nothing on a closed day', () => {
    const config = loadLandingConfig({});
    const stores = projectLandingStores([{code:'MEP',name:'',address:null,phone:null},{code:'EM',name:'',address:null,phone:null}], config);
    const open = renderToStaticMarkup(createElement(Shops, { stores, language: 'en', now: mondayNoonEt }));
    expect(open).toContain('Today: til 6 PM'); expect(open).toContain('Today: til 8 PM');
    expect(open).toContain('Which shop is closer?');
    expect(open.indexOf('Today: til 6 PM')).toBeLessThan(open.indexOf('landing-v4-shop-order'));
    const closedStores = stores.map(store => ({ ...store, openingHours: { ...store.openingHours, days: [] } }));
    expect(renderToStaticMarkup(createElement(Shops, { stores: closedStores, language: 'es', now: mondayNoonEt }))).not.toContain('Hoy:');
  });
});

describe('tracking: crave + guide placements and the item field', () => {
  it('the item vocabulary is exactly the approved roster', () => {
    expect([...LANDING_ITEMS].sort()).toEqual(roster.map(item => item.id).sort());
    expect(LANDING_PLACEMENTS).toContain('crave');
    expect(LANDING_PLACEMENTS).toContain('guide');
  });
  const fixture = () => {
    const post = vi.fn(), pixel = vi.fn();
    const tracker = createLandingTracker({ serverApproved: true, pixelId: '123456789', capiEnabled: true, sourceUrl: 'https://eat.example/', allowedStores: ['capitol-hill','dupont'], allowedAds: [], allowedPlacements: LANDING_PLACEMENTS },
      { post, pixel, loadPixel: vi.fn(), revokePixel: vi.fn(), uuid: () => '12345678-1234-4123-8123-123456789abc', now: () => 123000 });
    return { tracker, post, pixel };
  };
  it('sends the sub to Meta (Pixel + CAPI) but never to our own counter', () => {
    const { tracker, post, pixel } = fixture();
    tracker.setConsent(true);
    tracker.dispatch('OrderClick', { store: 'dupont', placement: 'crave', item: 'crunchy-boi' });
    expect(pixel).toHaveBeenCalledWith('trackCustom', 'OrderClick', { ad: 'unattributed', placement: 'crave', store: 'dupont', item: 'crunchy-boi' }, expect.any(String));
    const events = post.mock.calls.find(call => call[0] === '/api/landing/events')![1];
    expect(parseLandingEvent(events, 'https://eat.example', 123000)).toMatchObject({ placement: 'crave', item: 'crunchy-boi', store: 'dupont' });
    const counter = post.mock.calls.find(call => call[0] === '/api/landing/order-click')![1];
    expect(counter).toEqual({ store: 'dupont', ad: 'unattributed' });
    expect(parseOrderClick({ ...counter, item: 'crunchy-boi' })).toBeNull();
  });
  it('refuses an item outside the roster, on a non-item placement, with a vendor, or on a non-order event', () => {
    for (const details of [
      { store: 'dupont', placement: 'lineup', item: 'mystery-sub' },
      { store: 'dupont', placement: 'hero', item: 'crunchy-boi' },
      { store: 'dupont', placement: 'shops', vendor: 'ubereats', item: 'crunchy-boi' },
    ]) {
      const { tracker, post, pixel } = fixture();
      tracker.setConsent(true); tracker.dispatch('OrderClick', details);
      expect(pixel, JSON.stringify(details)).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
    }
    const { tracker, pixel } = fixture();
    tracker.setConsent(true); tracker.dispatch('Lead', { placement: 'guide', item: 'crunchy-boi' });
    expect(pixel).not.toHaveBeenCalled();
  });
  it('sends nothing at all without consent', () => {
    const { tracker, post, pixel } = fixture();
    tracker.dispatch('OrderClick', { store: 'dupont', placement: 'guide', item: 'crunchy-boi' });
    expect(pixel).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
  it('the server schema bounds item the same way', () => {
    const base = { event_name: 'OrderClick', event_id: '12345678-1234-4123-8123-123456789abc', event_time: 123, consent: 'accepted', source_url: 'https://eat.example/', store: 'capitol-hill', ad: 'unattributed', placement: 'lineup' };
    expect(parseLandingEvent({ ...base, item: 'frex' }, 'https://eat.example', 123000)).not.toBeNull();
    for (const patch of [{ item: 'not-a-sub' }, { item: 'frex', placement: 'sticky' }, { item: 'frex', event_name: 'CateringClick', store: undefined }, { item: 'frex', store: undefined }, { item: 7 }])
      expect(parseLandingEvent({ ...base, ...patch }, 'https://eat.example', 123000), JSON.stringify(patch)).toBeNull();
  });
});

describe('copy', () => {
  it('ships the new strings in English and Spanish and drops the cut ones', () => {
    for (const key of ['landing.hero.find-shop','landing.crave.order','landing.hours.until','landing.shops.today'] as const) {
      expect(en[key], key).toBeTruthy(); expect(es[key], key).toBeTruthy();
    }
    expect(en['landing.crave.body']).toBe('Turkey. Provolone. A fistful of ripple chips, inside.');
    expect(en['landing.shops.nearest']).toBe('Which shop is closer?');
    expect(en['landing.shops.body']).not.toContain('availability');
    for (const key of ['landing.hero.foot','landing.faq.question','landing.faq.answer']) { expect(key in en).toBe(false); expect(key in es).toBe(false); }
  });
});
