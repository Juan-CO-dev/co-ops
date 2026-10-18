import { expect, it } from 'vitest';
import { landingTenantConfig } from '@/config/tenant/landing';
import { shopStructuredData, serializeStructuredData } from '@/lib/landing/structured-data-shared';
it('projects only the exact public facts, two restaurants and seven-day hours', () => {
  const graph=shopStructuredData('https://eat.example.test','Brand','/media/hero.webp',landingTenantConfig.stores);
  expect(graph['@graph']).toHaveLength(2);
  for (const [i,node] of graph['@graph'].entries()) {
    const store=landingTenantConfig.stores[i]!;
    expect(node).toEqual({'@type':'Restaurant','@id':`https://eat.example.test/#${store.key}`,name:`Brand — ${store.name}`,image:'https://eat.example.test/media/hero.webp',url:`https://eat.example.test/#${store.key}`,address:{'@type':'PostalAddress',...store.structuredAddress},geo:{'@type':'GeoCoordinates',...store.coordinates},telephone:store.phone,openingHoursSpecification:[{'@type':'OpeningHoursSpecification',dayOfWeek:store.openingHours.days,opens:'10:30',closes:store.openingHours.closes}]});
    expect(node.openingHoursSpecification[0]!.dayOfWeek).toHaveLength(7);
  }
  expect(graph['@graph'].map(n=>n.telephone)).toEqual(['+12026218645','+12027944638']);
  expect(landingTenantConfig.stores.map(s=>s.phoneDisplay)).toEqual(['(202) 621-8645','(202) 794-4638']);
  expect(JSON.stringify(graph)).not.toMatch(/branchId"|locationCode|rating|price|active/);
});
it('escapes script termination and excludes unexpected input properties', () => {
  const store={...landingTenantConfig.stores[0]!,name:'</script><script>alert(1)</script>',secret:'never expose'};
  const graph=shopStructuredData('https://eat.example.test','Brand','/hero.webp',[store]);
  const encoded=serializeStructuredData(graph);
  expect(encoded).not.toContain('<'); expect(encoded).toContain('\\u003c/script>');
  expect(JSON.parse(encoded)).toEqual(graph); expect(encoded).not.toContain('secret');
});

it('uses the existing approved 1280 hero asset in rendered schema, without a preload',async()=>{
 const {ShopStructuredData}=await import('@/components/landing/ShopStructuredData');
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const {default:inventory}=await import('@/config/tenant/landing-assets.json');
 const {projectLandingStores}=await import('@/lib/landing/stores');
 const stores=projectLandingStores(landingTenantConfig.stores.map(store=>({code:store.locationCode,name:store.name,address:store.address,phone:store.phone,active:true})));
 const html=renderToStaticMarkup(createElement(ShopStructuredData,{origin:'https://eat.example.test',stores}));
 expect(html).not.toContain('preload');
 const image=inventory.find(asset=>asset.id==='v2-p013-1280')!;
 const graph=JSON.parse(html.match(/<script[^>]*>(.*)<\/script>/)![1]!);
 expect(graph['@graph'].map((node:{image:string})=>node.image)).toEqual(stores.map(()=>`https://eat.example.test${image.path}`));
});
