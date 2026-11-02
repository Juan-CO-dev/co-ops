import type { TranslationKey } from '@/lib/i18n/types';
import roster from '@/config/tenant/landing-products.json';
import en from '@/lib/i18n/en.json';
import es from '@/lib/i18n/es.json';
import { landingTenantConfig, type LandingStoreConfig } from '@/config/tenant/landing';

export interface LandingProduct {
  id: string; name: string; sourceId: string; image: string; smallImage: string;
  width: number; height: number;
  /** The sub's vertical centre in the photo (0 top … 1 bottom); every crop frames on it. */
  focusY: number;
  orderItems?: Partial<Record<LandingStoreConfig['key'], string>>;
  ingredientsKey: Extract<TranslationKey, `landing.lineup.ingredients.${string}`>;
}
function isIngredientsKey(key: string): key is LandingProduct['ingredientsKey'] {
  return key.startsWith('landing.lineup.ingredients.') && Object.hasOwn(en,key) && Object.hasOwn(es,key);
}
/** Fail closed on duplicates, held sources, or mismatched identities. */
export function validateProducts(items: readonly LandingProduct[]): void {
  const ids = new Set<string>(), sources = new Set<string>();
  for (const item of items) {
    if (item.orderItems !== undefined && (item.orderItems === null || typeof item.orderItems !== 'object' || Array.isArray(item.orderItems) ||
      Object.entries(item.orderItems).some(([key, id]) => !landingTenantConfig.stores.some(store => store.key === key) || typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)))) {
      throw new Error('Invalid landing product order items');
    }
    const approved = roster.find(p => p.id === item.id);
    if (!isIngredientsKey(item.ingredientsKey) || !approved || !(Number.isFinite(item.focusY) && item.focusY > 0 && item.focusY < 1) || approved.focusY !== item.focusY || approved.sourceId !== item.sourceId || approved.image !== item.image || approved.smallImage !== item.smallImage ||
      approved.ingredientsKey !== item.ingredientsKey || approved.name !== item.name || ids.has(item.id) || sources.has(item.sourceId)) {
      throw new Error('Unapproved or duplicate lineup product');
    }
    ids.add(item.id); sources.add(item.sourceId);
  }
}
export const products: readonly LandingProduct[] = roster.map(item=>{
  const ingredientsKey=item.ingredientsKey;
  if (!isIngredientsKey(ingredientsKey)) throw new Error('Missing lineup ingredient translation');
  return {...item,ingredientsKey};
});
validateProducts(products);
