// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FighterSelect } from '@/components/landing/FighterSelect';
import { products } from '@/lib/landing/products';
import { landingTenantConfig } from '@/config/tenant/landing';
import { itemOrderUrl } from '@/lib/landing/item-order-url-shared';

const { dispatch } = vi.hoisted(() => ({dispatch:vi.fn()}));
vi.mock('@/components/landing/TrackingProvider', () => ({useLandingTracking:() => ({dispatch})}));
vi.mock('@/components/landing/SpinCanvas', () => ({SpinCanvas:() => null}));
vi.mock('@/components/landing/LineupPhoto', () => ({LineupPhoto:() => null}));
vi.mock('@/lib/landing/hop-shared', () => ({hop:() => {}}));
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({matches:true, addEventListener(){}, removeEventListener(){}}));
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function(){this.open=true;};
  HTMLDialogElement.prototype.close = function(){this.open=false;this.dispatchEvent(new Event('close'));};
  dispatch.mockClear();
});
afterEach(() => {cleanup();vi.unstubAllGlobals();});

it('selects every fighter and orders its own item at either shop without changing dispatch fields', async () => {
  const sprite = {src:'/sprite.png', width:1, height:1};
  const shops = landingTenantConfig.stores.map(store => ({...store, detail:store.street}));
  render(createElement(FighterSelect, {
    fighters:products.map(product => ({...product, ingredients:'Ingredients', photoAlt:product.name})),
    shops, spin:{frames:[],width:1,height:1}, sprites:{idle:sprite,jump:sprite,selected:sprite},
    labels:{order:'Order {name}',sheetTitle:'Pick a shop for {name}',close:'Close',auto:'Auto',p1:'P1',spin:'Spin',spinValue:'{degrees}',browse:'Browse'},
  }));
  for (const product of products) {
    fireEvent.click(screen.getByRole('button', {name:`${product.name} Ingredients`}));
    fireEvent.click(await screen.findByRole('button', {name:`Order ${product.name}`}));
    const dialog = screen.getByRole('dialog', {name:`Pick a shop for ${product.name}`});
    for (const store of shops) {
      const link = within(dialog).getByRole('link', {name:new RegExp(store.orderLabel)});
      expect(link.getAttribute('href')).toBe(itemOrderUrl(store, product.id));
      // Cancel only jsdom's unsupported navigation; the production click stays native.
      link.addEventListener('click', event => event.preventDefault(), {once:true});
      fireEvent.click(link);
      expect(dispatch).toHaveBeenLastCalledWith('OrderClick', {store:store.key, placement:'lineup', vendor:undefined, item:product.id});
    }
    fireEvent.click(within(dialog).getByRole('button', {name:'Close'}));
  }
  expect(dispatch).toHaveBeenCalledTimes(20);
});
