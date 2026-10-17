import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import en from '@/lib/i18n/en.json';
import es from '@/lib/i18n/es.json';
import {validVendorPlacement} from '@/lib/landing/tracking-schema-shared';
import {formatDistanceMiles} from '@/lib/landing/nearby-shared';

it('keeps permission, conditional sharing and advertising purpose in both consent notices',()=>{
  for(const phrase of ['With your permission','when configured','to understand our ads','Ordering works either way']) expect(en['landing.consent.notice']).toContain(phrase);
  for(const phrase of ['Con tu permiso','si está configurado','para entender nuestros anuncios','Puedes pedir con cualquier opción']) expect(es['landing.consent.notice']).toContain(phrase);
});
it('never invents a store on a footer vendor event',()=>{
  for(const vendor of ['ubereats','doordash']) {
    expect(validVendorPlacement(vendor,'footer',undefined)).toBe(true);
    for(const store of ['dupont','capitol-hill','other',null]) expect(validVendorPlacement(vendor,'footer',store)).toBe(false);
  }
  expect(validVendorPlacement('ubereats','shops','dupont')).toBe(true);
});
it('pluralizes the displayed rounded mile value in both languages',()=>{
  for(const [km,enText,esText] of [[0,'0 miles away in a straight line','A 0 millas en línea recta'],[1.609344,'1 mile away in a straight line','A 1 milla en línea recta'],[1.62,'1 mile away in a straight line','A 1 milla en línea recta'],[3.218688,'2 miles away in a straight line','A 2 millas en línea recta']] as const) {
    expect(formatDistanceMiles(km,'en',en['landing.shops.distance'],en['landing.shops.distance-one'])).toBe(enText);
    expect(formatDistanceMiles(km,'es',es['landing.shops.distance'],es['landing.shops.distance-one'])).toBe(esText);
  }
});
it('does not lazy-load the above-fold wordmark',()=>{
  const page=readFileSync('app/eat/page.tsx','utf8');
  expect(page).toMatch(/<img loading="eager" src="\/brand\/co-wordmark.svg"/);
});
