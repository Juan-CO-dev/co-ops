import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { landingTenantConfig } from '@/config/tenant/landing';
import { products, validateProducts, type LandingProduct } from '@/lib/landing/products';
import { itemOrderUrl } from '@/lib/landing/item-order-url-shared';
import { OrderSheet } from '@/components/landing/OrderSheet';
import { LANDING_ITEM_PLACEMENTS } from '@/lib/landing/tracking-schema-shared';

describe('shop-specific item destinations', () => {
  it('builds all twenty pickup links with each shop origin and branch', () => {
    expect(products).toHaveLength(10);
    for (const product of products) for (const store of landingTenantConfig.stores) {
      const id = product.orderItems?.[store.key];
      expect(id).toMatch(/^[a-f0-9]{24}$/);
      const url = new URL(itemOrderUrl(store, product.id));
      expect(url.origin).toBe(new URL(store.orderUrl).origin);
      expect(url.pathname).toBe(`/order/items/${id}/`);
      expect([...url.searchParams]).toEqual([['branchId', store.branchId], ['servingOptionType', 'pickup']]);
      expect(product.orderItems?.['capitol-hill']).not.toBe(product.orderItems?.dupont);
    }
  });
  it('uses the menu when the item or its shop mapping is missing', () => {
    for (const store of landingTenantConfig.stores) {
      for (const item of [undefined, 'unknown']) expect(itemOrderUrl(store, item)).toBe(store.orderUrl);
      for (const orderItems of [undefined, {}, {[store.key === 'dupont' ? 'capitol-hill' : 'dupont']: products[0]!.orderItems![store.key]}]) {
        expect(itemOrderUrl(store, 'frex', [{id:'frex', orderItems}])).toBe(store.orderUrl);
      }
    }
  });
  it('rejects unknown store keys, malformed IDs and malformed mappings', () => {
    for (const orderItems of [null, [], 'bad', {'unknown-shop': products[0]!.orderItems!.dupont}, {dupont: 'xyz'}, {dupont: 'a'.repeat(23)}, {dupont: 'a'.repeat(25)}, {dupont: 123}, {dupont: undefined}]) {
      expect(() => validateProducts([{...products[0]!, orderItems} as LandingProduct])).toThrow('Invalid landing product order items');
    }
    expect(() => validateProducts([{...products[0]!, orderItems: {}}])).not.toThrow();
  });
  it('renders item links for every item placement, including the native no-JS fallback', () => {
    const shops = landingTenantConfig.stores.map(store => ({...store, label:store.name, detail:store.street}));
    for (const placement of LANDING_ITEM_PLACEMENTS) for (const eager of [false, true]) {
      const html = renderToStaticMarkup(createElement(OrderSheet, {shops, placement, item:'crunchy-boi', eager, triggerLabel:'Order', title:'Shop', closeLabel:'Close'}));
      for (const store of shops) expect(html).toContain(itemOrderUrl(store, 'crunchy-boi').replaceAll('&', '&amp;'));
    }
    const html = renderToStaticMarkup(createElement(OrderSheet, {shops, placement:'sticky', eager:true, triggerLabel:'Order', title:'Shop', closeLabel:'Close'}));
    for (const store of shops) expect(html).toContain(store.orderUrl.replaceAll('&', '&amp;'));
    expect(html).not.toContain('/order/items/');
  });
});
