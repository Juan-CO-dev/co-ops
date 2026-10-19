import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { FRAME_ID, FRAME_PATH, SOURCE_SHA256, SOURCE, CUT } from './subdex-source.mjs';
import { TOUCH_RECIPES } from './touch-recipes.mjs';
import { SPIN_RECIPE, spinFrameStem } from './spin-recipe.mjs';
import { SPRITES, SPRITE_DIR, SPRITE_MAX_BYTES } from './sprite-recipe.mjs';
import { MAP_RECIPE, validateMapConfig, validateRenderedProjection } from './map-recipe.mjs';
export const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
// Reviewed r2 recipes. Manifest data cannot award itself a larger delivery budget.
export const PHOTO_DETAILS = Object.freeze({
 P013: '52a07051eeb065785ada32af719604c113bfe4605ceabcd895dd70069de9fbde',
 P016: '781031156a21799f1f16fc83f496d046056a23a72fae4eeae9b62d8df3da3eb2',
 L083: '4960db2947693c5e450b4c9752c7d16cea772640ea1b387c62638273b8840b0c',
 // Landing v3 catering (Juan's shoot, Lifestyle_Kitchen sm_118 / sm_082), full-frame 2667x4000 picks.
 L118: 'a5acbe06f8f99faa7e73f6aa3e0103e718ece0b075a4cccd02cb2e58bca47dd0',
 L082: 'a372beffd38dff0257373c5923642d39f79e581ad39539b018e01c583a23fc28',
});
export const V2_RECIPES = Object.freeze(Object.fromEntries([
 ['P013',78,'initial',[[320,20000],[480,35000],[640,50000],[960,90000],[1280,140000]]],
 ['P016',86,'lazy',[[480,70000],[720,135000],[960,205000]]],
 ['L083',86,'lazy',[[480,100000],[720,180000],[960,270000]]],
 ['L118',78,'lazy',[[480,100000],[720,180000],[960,270000]]],
 ['L082',72,'lazy',[[480,100000]]],
].flatMap(([sourceId,quality,load,sizes])=>sizes.map(([width,maxBytes])=>[
 `v2-${sourceId.toLowerCase()}-${width}`,Object.freeze({sourceId,quality,load,width,maxBytes})
]))));
export function approvedSource(manifest, id, classification='real-photo') {
 const lists=[manifest.products ?? [],manifest.photoDetails ?? [],manifest.drawnSources ?? [],manifest.decorativeSources ?? []];
 const seen=new Set();
 for(const list of lists) for(const entry of list) {
  for(const identity of new Set([entry.representative,...(entry.confirmedIds ?? [])])) {
   if(seen.has(identity))throw Error('Duplicate source identity');
   seen.add(identity);
  }
 }
 const candidates=classification==='real-photo' ? [...lists[0],...lists[1]] : classification==='drawn' ? [...lists[2],...lists[3]] : classification==='brand'?lists[3]:[];
 const p=candidates.find(p=>p.representative===id);
 if (!p || !p.eligible || p.hold || !p.confirmedIds?.includes(id)) throw new Error('Source is not an eligible representative');
 if((p.classification ?? 'real-photo')!==classification)throw Error('Source classification mismatch');
 if(lists[1].includes(p) && (!Object.hasOwn(PHOTO_DETAILS,id) || p.sha256!==PHOTO_DETAILS[id] || p.path!==`C:/Users/conta/co-chief-assets/picks-full/${id}.jpg` || p.classification!=='real-photo'))throw Error('Unapproved photo detail source');
 if(lists[3].includes(p)){
  const pin=TOUCH_RECIPES[id]?.source;
  if(!pin || Object.keys(pin).some(key=>JSON.stringify(p[key])!==JSON.stringify(pin[key])))throw Error('Unapproved decorative source');
 } else if(p.classification === 'drawn' && (p.representative !== FRAME_ID || p.path !== FRAME_PATH || p.videoSha256 !== SOURCE_SHA256 || p.videoPath !== SOURCE || JSON.stringify(p.cut) !== JSON.stringify(CUT))) throw Error('Unapproved drawn source recipe');
 return p;
}
export function safeOutput(root, relative) {
 if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\')) throw new Error('Invalid export path');
 const base=realpathSync(root), dest=path.resolve(base,relative);
 if (!dest.startsWith(base+path.sep)) throw new Error('Export escapes workspace');
 let existing=dest;
 while (!existsSync(existing)) existing=path.dirname(existing);
 const resolved=realpathSync(existing);
 if (resolved!==base && !resolved.startsWith(base+path.sep)) throw new Error('Symlink escapes workspace');
 return dest;
}
export const requiresRasterDerivation = e => e.classification === 'real-photo' || /^\/media\/.*\.(webp|png|jpe?g)$/i.test(e.publicPath ?? '');
function validateCrop(e) {
 const c=e.crop, s=e.orientedSource;
 if(!c || !s || !['left','top','width','height'].every(k=>Number.isInteger(c[k])) || c.left<0 || c.top<0 || c.width<=0 || c.height<=0 || ![s.width,s.height].every(n=>Number.isInteger(n)&&n>0) || c.left+c.width>s.width || c.top+c.height>s.height)throw Error('Invalid crop recipe');
 if(e.width>c.width || e.height>c.height || Math.abs(e.height-Math.round(e.width*c.height/c.width))>1)throw Error('Crop must resize uniformly without enlargement');
}
export function validateEntry(e) {
 if((typeof e.id==='string' && e.id.startsWith('touch-')) || (typeof e.sourceId==='string' && e.sourceId.startsWith('touch-')) || /^\/(?:media|brand)\/touch-/.test(e.publicPath??'')){
  const pin=TOUCH_RECIPES[e.sourceId??e.id]?.entry;
  if(!pin || Object.keys(pin).some(key=>JSON.stringify(e[key])!==JSON.stringify(pin[key])))throw Error('Unapproved decorative recipe');
 }
 for (const k of ['id','publicPath','sourcePath','sidecar']) if(typeof e[k]!=='string'||!e[k]) throw new Error('Missing '+k);
 if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(e.sourcePath)) throw Error('Absolute source path');
 for (const k of ['sourceSha256','sha256']) if (!/^[a-f0-9]{64}$/.test(e[k]??'')) throw new Error('Missing hash');
 if (!['real-photo','real-edited','drawn','brand'].includes(e.classification)) throw new Error('Unknown provenance');
 if ((requiresRasterDerivation(e) || e.classification === 'real-edited') && (typeof e.sourceId!=='string'||!e.sourceId)) throw new Error('Missing photo source identity');
 if (requiresRasterDerivation(e) && (!['resize-only','crop-resize-only'].includes(e.mode) || !Number.isInteger(e.quality) || e.quality < 1 || e.quality > 100)) throw new Error('Missing resize-only derivation');
 if(e.mode==='crop-resize-only') {
  validateCrop(e);
  const steps=['EXIF auto-orientation (.rotate())','integer crop in oriented-source coordinates','uniform resize without enlargement','WebP encode; metadata stripped'];
  if(e.effort!==6 || !['sharp','vips','webp'].every(k=>/^\d+\.\d+\.\d+$/.test(e.tool?.[k] ?? '')) || JSON.stringify(e.steps)!==JSON.stringify(steps))throw Error('Incomplete crop encoder recipe');
 }
 if (!/^\/(media|brand)\/[a-z0-9.-]+$/.test(e.publicPath)) throw new Error('Invalid public path');
 const recipe=Object.hasOwn(V2_RECIPES,e.id)?V2_RECIPES[e.id]:undefined;
 if(e.id.startsWith('v2-') && !recipe)throw Error('Unknown v2 recipe');
 if(recipe) {
  if(Object.entries(recipe).some(([key,value])=>e[key]!==value) || e.mode!=='resize-only' || e.classification!=='real-photo' || e.sourceSha256!==PHOTO_DETAILS[e.sourceId] || e.publicPath!==`/media/${e.id}-${e.sha256.slice(0,12)}.webp` || e.sidecar!==`assets/provenance/${e.id}.json` || e.sourcePath!==`source:${e.sourceId}`)throw Error('Unapproved v2 recipe');
  if(JSON.stringify(e.crop)!==JSON.stringify({left:0,top:0,width:2667,height:4000}) || e.orientedSource?.width!==2667 || e.orientedSource?.height!==4000)throw Error('V2 must preserve full frame');
  validateCrop(e);
  if(e.tool?.sharp!=='0.34.5' || e.tool?.vips!=='8.17.3' || e.tool?.webp!=='1.6.0' || e.effort!==6)throw Error('Unapproved v2 encoder');
 }
 const ceiling=recipe?.maxBytes ?? (/\.(mp4|webm)$/.test(e.publicPath)?1500000:e.classification==='brand'?500000:100000);
 if (![e.bytes,e.maxBytes,e.width,e.height].every(n=>Number.isInteger(n)&&n>0)||e.bytes>e.maxBytes||e.maxBytes>ceiling) throw new Error('Invalid dimensions or oversized asset');
}
/** Frame sequences are one reviewed recipe each; data cannot widen its own budget. */
export function validateSequence(e) {
 const r=SPIN_RECIPE;
 if(e.id!==r.id || e.classification!=='drawn' || e.sourcePath!==`source:${r.sourceId}` || e.sidecar!==`assets/provenance/${r.id}.json`)throw Error('Unapproved sequence');
 for(const key of ['count','step','width','height','quality','alphaQuality','effort','maxBytes'])if(e[key]!==r[key])throw Error('Unapproved sequence recipe');
 if(JSON.stringify(e.crop)!==JSON.stringify(r.crop))throw Error('Unapproved sequence crop');
 if(e.sourceSha256!==r.sourceSha256 || !['sharp','vips','webp'].every(k=>/^\d+\.\d+\.\d+$/.test(e.tool?.[k] ?? '')))throw Error('Unapproved sequence source');
 if(!Array.isArray(e.frames) || e.frames.length!==r.count)throw Error('Sequence frame count mismatch');
 let total=0;
 e.frames.forEach((f,i)=>{
  if(!/^[a-f0-9]{64}$/.test(f.sha256??'') || f.publicPath!==`/media/${spinFrameStem(i)}-${f.sha256.slice(0,12)}.webp` || !Number.isInteger(f.bytes) || f.bytes<=0 || f.bytes>r.frameMaxBytes)throw Error('Invalid sequence frame');
  total+=f.bytes;
 });
 if(total!==e.bytes || e.bytes>r.maxBytes)throw Error('Sequence over budget');
}
/** The shop map: one reviewed OSM-derived render, pinned extract + renderer. */
export function validateMap(e) {
 const r=MAP_RECIPE;
 if(e.id!==r.id || e.classification!=='brand' || e.sourcePath!==`source:${r.sourceId}` || e.sourceSha256!==r.osmSha256 || e.sidecar!==`assets/provenance/${r.id}.json`)throw Error('Unapproved map');
 if(!/^[a-f0-9]{64}$/.test(e.sha256??'') || !/^[a-f0-9]{64}$/.test(e.rasterSha256??'') || !/^[a-f0-9]{64}$/.test(e.rendererSha256??'') || e.publicPath!==`/media/${r.id}-${e.sha256.slice(0,12)}.webp`)throw Error('Invalid map entry');
 if(e.width!==r.width || e.height!==r.height || e.quality!==r.quality || e.effort!==r.effort || e.maxBytes!==r.maxBytes || !Number.isInteger(e.bytes) || e.bytes<=0 || e.bytes>r.maxBytes)throw Error('Unapproved map recipe');
}
/** Pixel sprites ship byte-for-byte from a pinned source list. */
export function validateSprite(e) {
 const sprite=SPRITES.find(s=>s.id===e.id);
 if(!sprite || e.classification!=='drawn' || e.sourcePath!==`pixel-bank:${sprite.source}` || e.sourceSha256!==sprite.sha256 || e.sha256!==sprite.sha256)throw Error('Unapproved sprite');
 if(e.publicPath!==`/media/${e.id}-${e.sha256.slice(0,12)}.png` || e.sidecar!==`assets/provenance/${e.id}.json` || e.maxBytes!==SPRITE_MAX_BYTES || !Number.isInteger(e.bytes) || e.bytes<=0 || e.bytes>e.maxBytes || e.width!==sprite.width || e.height!==sprite.height)throw Error('Invalid sprite entry');
}
/** Public files whose entry passes its kind's validator (structural checks only; hashes
 * and sources are checkAssets' job). Shared by repository guards outside the landing. */
export function approvedPublicFiles(approved, manifest) {
 const files=new Set();
 for(const e of approved.media){
  try {
   if(e.kind==='sequence'){validateSequence(e);for(const f of e.frames)files.add(f.publicPath);continue;}
   if(e.kind==='sprite')validateSprite(e);
   else if(e.kind==='map')validateMap(e);
   else {validateEntry(e);if(e.sourceId)approvedSource(manifest,e.sourceId,e.classification);}
   files.add(e.publicPath);
  } catch { /* unapproved entries contribute nothing */ }
 }
 return files;
}
export async function checkAssets(root, {sources=false}={}) {
 const manifest=JSON.parse(readFileSync(path.join(root,'assets/source-manifest.json'),'utf8'));
 const approved=JSON.parse(readFileSync(path.join(root,'assets/approved-media.json'),'utf8'));
 const ids=new Set(), hashes=new Set();
 if(!approved.media.length) throw new Error('No approved media');
 const allPaths=approved.media.flatMap(e=>e.kind==='sequence'?e.frames.map(f=>f.publicPath):[e.publicPath]);
 const publicPaths=new Set(allPaths);
 if(publicPaths.size!==allPaths.length) throw new Error('Duplicate public path');
 for(const file of readdirSync(path.join(root,'public/media'),{recursive:true})) {
  if(statSync(path.join(root,'public/media',file)).isFile()&&!publicPaths.has('/media/'+file.replaceAll('\\','/'))) throw new Error('Unapproved public media');
 }
 for(const e of approved.media){
  if(e.kind==='map'){
   validateMap(e); if(ids.has(e.id)) throw new Error('Duplicate asset'); ids.add(e.id);
   if(hashes.has(e.sha256)) throw new Error('Duplicate asset content'); hashes.add(e.sha256);
   const file=safeOutput(root,'public'+e.publicPath);
   if(sha256(file)!==e.sha256 || statSync(file).size!==e.bytes) throw new Error('Export hash/size changed');
   if(JSON.stringify(JSON.parse(readFileSync(safeOutput(root,e.sidecar),'utf8')))!==JSON.stringify(e))throw Error('Map sidecar mismatch');
   if(sha256(path.join(root,MAP_RECIPE.renderer))!==e.rendererSha256)throw Error('Map renderer changed');
   const ext=manifest.externalSources?.find(source=>`source:${source.id}`===e.sourcePath);
   if(!ext || ext.sha256!==e.sourceSha256 || ext.path!==MAP_RECIPE.osmPath)throw Error('Unknown map source');
   const runtimeMap=JSON.parse(readFileSync(path.join(root,'config/tenant/landing-map.json'),'utf8'));
   validateMapConfig(runtimeMap,e);
   if(sources){
    const {renderMap}=await import('./export-map.mjs');
    const {raster,bytes,projection}=await renderMap(root);
    validateRenderedProjection(projection);
    if(createHash('sha256').update(raster).digest('hex')!==e.rasterSha256 || createHash('sha256').update(bytes).digest('hex')!==e.sha256)throw Error('Map derivation mismatch');
   }
   continue;
  }
  if(e.kind==='sprite'){
   validateSprite(e); if(ids.has(e.id)) throw new Error('Duplicate asset'); ids.add(e.id);
   if(hashes.has(e.sha256)) throw new Error('Duplicate asset content'); hashes.add(e.sha256);
   const file=safeOutput(root,'public'+e.publicPath);
   if(sha256(file)!==e.sha256 || statSync(file).size!==e.bytes) throw new Error('Export hash/size changed');
   if(JSON.stringify(JSON.parse(readFileSync(safeOutput(root,e.sidecar),'utf8')))!==JSON.stringify(e))throw Error('Sprite sidecar mismatch');
   if(sources && sha256(`${SPRITE_DIR}/${SPRITES.find(s=>s.id===e.id).source}`)!==e.sourceSha256)throw Error('Original source changed');
   continue;
  }
  if(e.kind==='sequence'){
   validateSequence(e); if(ids.has(e.id)) throw new Error('Duplicate asset'); ids.add(e.id);
   for(const f of e.frames){
    if(hashes.has(f.sha256)) throw new Error('Duplicate asset content'); hashes.add(f.sha256);
    const file=safeOutput(root,'public'+f.publicPath);
    if(sha256(file)!==f.sha256 || statSync(file).size!==f.bytes) throw new Error('Export hash/size changed');
   }
   if(readFileSync(safeOutput(root,e.sidecar),'utf8')!==JSON.stringify(e,null,2)+'\n')throw Error('Sequence sidecar mismatch');
   const ext=manifest.externalSources?.find(source=>`source:${source.id}`===e.sourcePath);
   if(!ext || ext.sha256!==e.sourceSha256 || ext.path!==SPIN_RECIPE.dir)throw Error('Unknown sequence source');
   if(sources){
    const {default:sharp}=await import('sharp');
    const {spinSourceDigest,encodeSpinFrame}=await import('./spin-recipe.mjs');
    if(spinSourceDigest()!==e.sourceSha256)throw Error('Original source changed');
    if(['sharp','vips','webp'].some(k=>e.tool[k]!==sharp.versions[k]))throw Error('Sequence encoder version mismatch');
    for(let i=0;i<e.frames.length;i++)if(createHash('sha256').update(await encodeSpinFrame(sharp,i)).digest('hex')!==e.frames[i].sha256)throw Error('Sequence derivation mismatch');
   }
   continue;
  }
  validateEntry(e); if(hashes.has(e.sha256)) throw new Error('Duplicate asset content'); hashes.add(e.sha256); if(ids.has(e.id)) throw new Error('Duplicate asset'); ids.add(e.id);
  const file=safeOutput(root,'public'+e.publicPath), side=safeOutput(root,e.sidecar);
  if(sha256(file)!==e.sha256 || statSync(file).size!==e.bytes) throw new Error('Export hash/size changed');
  const record=JSON.parse(readFileSync(side,'utf8'));
  if(e.id.startsWith('touch-') && JSON.stringify(record)!==JSON.stringify(e))throw Error('Decorative sidecar mismatch');
  const compared=['sourceSha256','sha256','classification','sourceId','mode','quality'];
  if(requiresRasterDerivation(e))compared.push('sourcePath','crop','orientedSource','width','height','steps','tool','effort','publicPath','bytes','maxBytes','load','command','inspection');
  for(const key of compared)if(JSON.stringify(record[key])!==JSON.stringify(e[key]))throw new Error('Sidecar mismatch');
  if(e.sourceId){const src=approvedSource(manifest,e.sourceId,e.classification);if((e.sourcePath!==`source:${e.sourceId}` && src.path!==e.sourcePath)||src.sha256!==e.sourceSha256)throw new Error('Source identity mismatch');}
  const sourceRef=e.sourcePath.startsWith('source:') ? (e.sourceId ? approvedSource(manifest,e.sourceId,e.classification).path : manifest.externalSources?.find(source=>`source:${source.id}`===e.sourcePath)?.path) : e.sourcePath;
  if(!sourceRef)throw Error('Unknown source reference');
  const sourcePath=path.resolve(root,sourceRef);
  if(sources && sha256(sourcePath)!==e.sourceSha256) throw new Error('Original source changed');
  if(sources && e.id==='touch-mark-nod'){
   const {deriveMarkSvg}=await import('./mark-source.mjs');
   if(createHash('sha256').update(deriveMarkSvg(readFileSync(sourcePath),e.vectorTolerance)).digest('hex')!==e.sha256)throw Error('Mark derivation mismatch');
  }
  if(sources && requiresRasterDerivation(e)) {
   const {default:sharp}=await import('sharp');
   if(e.mode==='crop-resize-only' && ['sharp','vips','webp'].some(k=>e.tool[k]!==sharp.versions[k]))throw Error('Crop encoder version mismatch');
   const input=readFileSync(sourcePath);
   let pipeline=sharp(input).rotate();
   if(e.orientedSource) {
    const oriented=await sharp(await sharp(input).rotate().toBuffer()).metadata();
    if(oriented.width!==e.orientedSource.width || oriented.height!==e.orientedSource.height)throw Error('Oriented source dimensions changed');
   }
   if(e.mode==='crop-resize-only')pipeline=pipeline.extract(e.crop);
   const bytes=await pipeline.resize({width:e.width,withoutEnlargement:true}).webp({quality:e.quality,effort:6}).toBuffer();
   if(createHash('sha256').update(bytes).digest('hex')!==e.sha256) throw new Error('Photo derivation mismatch');
   const output=await sharp(bytes).metadata();
   if(output.width!==e.width || output.height!==e.height)throw Error('Output dimensions mismatch');
  }
 }
 if(sources) for(const source of manifest.drawnSources ?? []) {
  const {extractSubdexFrame,FRAME_ID,FRAME_PATH,SOURCE_SHA256,SOURCE,CUT}=await import('./subdex-source.mjs');
  if(source.representative!==FRAME_ID || source.path!==FRAME_PATH || source.videoSha256!==SOURCE_SHA256 || source.videoPath!==SOURCE || JSON.stringify(source.cut)!==JSON.stringify(CUT)) throw Error('Unapproved drawn source recipe');
  if(createHash('sha256').update(extractSubdexFrame()).digest('hex')!==source.sha256) throw Error('Drawn frame derivation mismatch');
 }
 if(sources) for(const p of manifest.products) if(sha256(p.path)!==p.sha256)throw new Error('Original source changed');
 return approved.media.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 checkAssets(process.cwd(),{sources:process.argv.includes('--sources')}).then(n=>console.log(`Asset check passed: ${n} assets`)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
