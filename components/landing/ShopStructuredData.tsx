import type { LandingStore } from '@/lib/landing/stores';
import inventory from '@/config/tenant/landing-assets.json';
import { shopStructuredData, serializeStructuredData, structuredDataImage } from '@/lib/landing/structured-data-shared';
import { TENANT_NAME } from '@/lib/tenant';

export function ShopStructuredData({ origin, stores }: { origin: string; stores: readonly LandingStore[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(shopStructuredData(origin, TENANT_NAME, structuredDataImage(inventory), stores)) }} />;
}
