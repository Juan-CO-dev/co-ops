import roster from '@/config/tenant/landing-products.json';
import type { LandingProduct } from './products';

/** Use the chosen shop's origin and branch; Appfront item IDs are shop-specific. */
export function itemOrderUrl(
  store: {key: string; pickupUrl: string},
  item?: string,
  products: readonly Pick<LandingProduct, 'id' | 'orderItems'>[] = roster,
): string {
  const orderItems = products.find(product => product.id === item)?.orderItems;
  const id = orderItems && Object.hasOwn(orderItems, store.key)
    ? orderItems[store.key as keyof typeof orderItems] : undefined;
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return store.pickupUrl;
  const menu = new URL(store.pickupUrl);
  const branchId = menu.searchParams.get('branchId');
  if (!branchId) return store.pickupUrl;
  const url = new URL(`/order/items/${id}/`, menu.origin);
  url.searchParams.set('branchId', branchId);
  url.searchParams.set('servingOptionType', 'pickup');
  return url.href;
}
