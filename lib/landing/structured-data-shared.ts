import type { LandingStoreConfig } from '@/config/tenant/landing';

type PublicShopFacts = Pick<LandingStoreConfig, 'key' | 'name' | 'structuredAddress' | 'coordinates' | 'phone' | 'openingHours' | 'orderUrl'>;

export function structuredDataImage(inventory: readonly { id: string; path: string }[]): string | undefined {
  return inventory.find(asset => asset.id === 'v2-p013-1280')?.path;
}

/** Explicit public projection only. The caller supplies the same shops rendered visibly. */
export function shopStructuredData(origin: string, brand: string, image: string | undefined, stores: readonly PublicShopFacts[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': stores.map(store => ({
      '@type': 'Restaurant',
      '@id': new URL(`/#${store.key}`, origin).href,
      name: `${brand} — ${store.name}`,
      ...(image ? { image: new URL(image, origin).href } : {}),
      url: new URL(`/#${store.key}`, origin).href,
      address: {
        '@type': 'PostalAddress',
        streetAddress: store.structuredAddress.streetAddress,
        addressLocality: store.structuredAddress.addressLocality,
        addressRegion: store.structuredAddress.addressRegion,
        postalCode: store.structuredAddress.postalCode,
        addressCountry: store.structuredAddress.addressCountry,
      },
      ...(store.coordinates ? { geo: { '@type': 'GeoCoordinates', latitude: store.coordinates.latitude, longitude: store.coordinates.longitude } } : {}),
      telephone: store.phone,
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: [...store.openingHours.days], opens: store.openingHours.opens, closes: store.openingHours.closes }],
    })),
  };
}

export function serializeStructuredData(value: ReturnType<typeof shopStructuredData>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
