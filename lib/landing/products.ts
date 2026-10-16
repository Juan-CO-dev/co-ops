import roster from '@/config/tenant/landing-products.json';

export interface LandingProduct {
  id: string; name: string; sourceId: string; image: string; smallImage: string;
  width: number; height: number;
}
/** Fail closed on duplicates, held sources, or mismatched identities. */
export function validateProducts(items: readonly LandingProduct[]): void {
  const ids = new Set<string>(), sources = new Set<string>();
  for (const item of items) {
    const approved = roster.find(p => p.id === item.id);
    if (!approved || approved.sourceId !== item.sourceId || approved.image !== item.image || approved.smallImage !== item.smallImage ||
      approved.name !== item.name || ids.has(item.id) || sources.has(item.sourceId)) {
      throw new Error('Unapproved or duplicate lineup product');
    }
    ids.add(item.id); sources.add(item.sourceId);
  }
}
export const products: readonly LandingProduct[] = roster;
validateProducts(products);
