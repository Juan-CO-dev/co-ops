import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { FRAME_ID, FRAME_PATH, SOURCE_SHA256, SOURCE, CUT } from './subdex-source.mjs';
export const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
export function approvedSource(manifest, id, classification='real-photo') {
 const p = manifest.products.find(p => p.representative === id) ?? (classification === 'drawn' ? manifest.drawnSources?.find(p => p.representative === id && p.classification === 'drawn') : undefined);
 if (!p || !p.eligible || p.hold || !p.confirmedIds?.includes(id)) throw new Error('Source is not an eligible representative');
 if(p.classification === 'drawn' && (p.representative !== FRAME_ID || p.path !== FRAME_PATH || p.videoSha256 !== SOURCE_SHA256 || p.videoPath !== SOURCE || JSON.stringify(p.cut) !== JSON.stringify(CUT))) throw Error('Unapproved drawn source recipe');
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
export function validateEntry(e) {
 for (const k of ['id','publicPath','sourcePath','sidecar']) if(typeof e[k]!=='string'||!e[k]) throw new Error('Missing '+k);
 for (const k of ['sourceSha256','sha256']) if (!/^[a-f0-9]{64}$/.test(e[k]??'')) throw new Error('Missing hash');
 if (!['real-photo','real-edited','drawn','brand'].includes(e.classification)) throw new Error('Unknown provenance');
 if ((requiresRasterDerivation(e) || e.classification === 'real-edited') && (typeof e.sourceId!=='string'||!e.sourceId)) throw new Error('Missing photo source identity');
 if (requiresRasterDerivation(e) && (e.mode !== 'crop-resize-only' || !Number.isInteger(e.quality) || e.quality < 1 || e.quality > 100)) throw new Error('Missing crop-resize-only derivation');
 if (!/^\/(media|brand)\/[a-z0-9.-]+$/.test(e.publicPath)) throw new Error('Invalid public path');
 const ceiling=/\.(mp4|webm)$/.test(e.publicPath)?1500000:e.classification==='brand'?500000:100000;
 if (![e.bytes,e.maxBytes,e.width,e.height].every(n=>Number.isInteger(n)&&n>0)||e.bytes>e.maxBytes||e.maxBytes>ceiling) throw new Error('Invalid dimensions or oversized asset');
}
export async function checkAssets(root, {sources=false}={}) {
 const manifest=JSON.parse(readFileSync(path.join(root,'assets/source-manifest.json'),'utf8'));
 const approved=JSON.parse(readFileSync(path.join(root,'assets/approved-media.json'),'utf8'));
 const ids=new Set(), hashes=new Set();
 if(!approved.media.length) throw new Error('No approved media');
 const publicPaths=new Set(approved.media.map(e=>e.publicPath));
 if(publicPaths.size!==approved.media.length) throw new Error('Duplicate public path');
 for(const file of readdirSync(path.join(root,'public/media'),{recursive:true})) {
  if(statSync(path.join(root,'public/media',file)).isFile()&&!publicPaths.has('/media/'+file.replaceAll('\\','/'))) throw new Error('Unapproved public media');
 }
 for(const e of approved.media){
  validateEntry(e); if(hashes.has(e.sha256)) throw new Error('Duplicate asset content'); hashes.add(e.sha256); if(ids.has(e.id)) throw new Error('Duplicate asset'); ids.add(e.id);
  const file=safeOutput(root,'public'+e.publicPath), side=safeOutput(root,e.sidecar);
  if(sha256(file)!==e.sha256 || statSync(file).size!==e.bytes) throw new Error('Export hash/size changed');
  const record=JSON.parse(readFileSync(side,'utf8'));
  if(record.sourceSha256!==e.sourceSha256 || record.sha256!==e.sha256 || record.classification!==e.classification || record.sourceId!==e.sourceId || record.mode!==e.mode || record.quality!==e.quality) throw new Error('Sidecar mismatch');
  if(e.sourceId){const src=approvedSource(manifest,e.sourceId,e.classification);if(src.path!==e.sourcePath||src.sha256!==e.sourceSha256)throw new Error('Source identity mismatch');}
  const sourcePath=path.resolve(root,e.sourcePath);
  if(sources && sha256(sourcePath)!==e.sourceSha256) throw new Error('Original source changed');
  if(sources && requiresRasterDerivation(e)) {
   const {default:sharp}=await import('sharp');
   const bytes=await sharp(readFileSync(sourcePath)).rotate().resize({width:e.width,withoutEnlargement:true}).webp({quality:e.quality,effort:6}).toBuffer();
   if(createHash('sha256').update(bytes).digest('hex')!==e.sha256) throw new Error('Photo derivation mismatch');
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
