import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const toolPath='../../scripts/assets/inventory.mjs';
const tools=await import(/* @vite-ignore */ toolPath);
it('rejects a renamed decorative entry instead of bypassing its exact recipe',()=>{
 const media=JSON.parse(readFileSync('assets/approved-media.json','utf8')).media;
 const entry=media.find((item:{id:string})=>item.id==='touch-clay-bag');
 expect(()=>tools.validateEntry({...entry,id:'borrowed-brand'})).toThrow('Unapproved decorative recipe');
});
it('admits only inspected decorative sources and their pinned crops',()=>{
 const source=JSON.parse(readFileSync('assets/source-manifest.json','utf8'));
 const media=JSON.parse(readFileSync('assets/approved-media.json','utf8')).media;
 const touches=JSON.parse(readFileSync('config/tenant/landing-touches.json','utf8'));
 for(const id of ['clay-bag','lowpoly-prop','office-wave','doodle-chip','mark-nod']){
  const entry=media.find((e:{id:string})=>e.id===`touch-${id}`);
  expect(entry).toBeDefined();
  expect(touches.find((touch:{id:string})=>touch.id===id)).toMatchObject({path:entry.publicPath,width:entry.width,height:entry.height});
  expect(()=>tools.validateEntry(entry)).not.toThrow();
  const original=tools.approvedSource(source,entry.sourceId,entry.classification);
  for(const patch of [{sha256:'a'.repeat(64)},{path:'invented.png'},{inspection:'unreviewed'},{classification:'real-photo'}]){
   expect(()=>tools.approvedSource({...source,decorativeSources:source.decorativeSources.map((s:{representative:string})=>s.representative===original.representative?{...s,...patch}:s)},entry.sourceId,entry.classification)).toThrow();
  }
  expect(()=>tools.validateEntry({...entry,maxBytes:500000})).toThrow();
  if(entry.crop)expect(()=>tools.validateEntry({...entry,crop:{...entry.crop,left:entry.crop.left+1}})).toThrow();
  if(entry.mode==='vector-simplify')expect(()=>tools.validateEntry({...entry,vectorTolerance:0.5})).toThrow();
 }
});
