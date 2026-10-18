import type { LandingStore } from '@/lib/landing/stores';
import inventory from '@/config/tenant/landing-assets.json';
import { shopStructuredData, serializeStructuredData } from '@/lib/landing/structured-data-shared';
import { TENANT_NAME } from '@/lib/tenant';

export function ShopStructuredData({ origin, stores }: { origin: string; stores: readonly LandingStore[] }) {
  const image = inventory.find(asset => asset.id === 'v2-p013-1280')!;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(shopStructuredData(origin, TENANT_NAME, image.path, stores)) }} />;
}
