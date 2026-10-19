import {expect,it} from 'vitest';
import map from '@/config/tenant/landing-map.json';
import {landingTenantConfig} from '@/config/tenant/landing';
import {directionsHref,edgeMarker,fitView,insideMap,projectPoint} from '@/lib/landing/map-shared';

it('places both shops inside the rendered map, matching the renderer projection',()=>{
  for(const store of landingTenantConfig.stores){
    const point=projectPoint(map,store.coordinates!);
    expect(insideMap(point,.05),store.key).toBe(true);
  }
  // The projection origin is the midpoint between the two shops.
  const [a,b]=landingTenantConfig.stores.map(store=>projectPoint(map,store.coordinates!));
  expect((a!.x+b!.x)/2).toBeCloseTo(.5,1);expect((a!.y+b!.y)/2).toBeCloseTo(.5,1);
});
it('fits the visitor and a shop without showing past the map edge',()=>{
  const view=fitView([{x:.2,y:.3},{x:.3,y:.35}]);
  expect(view.scale).toBeGreaterThan(1);
  for(const p of [{x:.2,y:.3},{x:.3,y:.35}]){
    const sx=view.x+p.x*view.scale,sy=view.y+p.y*view.scale;
    expect(sx).toBeGreaterThan(0);expect(sx).toBeLessThan(1);expect(sy).toBeGreaterThan(0);expect(sy).toBeLessThan(1);
  }
  expect(view.x).toBeLessThanOrEqual(0);expect(view.x).toBeGreaterThanOrEqual(1-view.scale);
  expect(fitView([{x:.01,y:.01},{x:.99,y:.99}]).scale).toBe(1);
});
it('points an off-map visitor arrow from the shop toward them, on the frame',()=>{
  const marker=edgeMarker({x:.5,y:.5},{x:3,y:.5});
  expect(marker.x).toBe(.94);expect(marker.degrees).toBe(0);
  expect(edgeMarker({x:.5,y:.5},{x:.5,y:-4}).degrees).toBe(-90);
});
it('builds destination-only directions links',()=>{
  expect(directionsHref('526 8th St SE','apple'.length>0)).toBe('https://maps.apple.com/?daddr=526%208th%20St%20SE');
  expect(directionsHref('2029 P St NW',false)).toBe('https://www.google.com/maps/dir/?api=1&destination=2029%20P%20St%20NW');
});
it('refuses a runtime map config whose projection drifts from the reviewed contract',async()=>{
  const modulePath='../../scripts/assets/map-recipe.mjs';
  const {validateMapConfig}=await import(/* @vite-ignore */ modulePath);
  const approved=(await import('@/assets/approved-media.json')).default as {media:{id:string;publicPath?:string;width?:number;height?:number}[]};
  const entry=approved.media.find(e=>e.id==='landing-map')!;
  expect(()=>validateMapConfig(map,entry)).not.toThrow();
  for(const key of ['lat0','lon0','kx','ky','halfMetres'] as const)expect(()=>validateMapConfig({...map,[key]:(map[key] as number)*1.01},entry)).toThrow(/projection/);
  expect(()=>validateMapConfig({...map,image:'/media/other.webp'},entry)).toThrow(/config/);
});
