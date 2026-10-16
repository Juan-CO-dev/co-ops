import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
export function approvedSource(manifest, id) {
 const p = manifest.products.find(p => p.representative === id);
 if (!p || !p.eligible || p.hold) throw new Error('Source is not an eligible representative');
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
export function validateEntry(e) {
 for (const k of ['id','publicPath','sourcePath','sidecar']) if(typeof e[k]!=='string'||!e[k]) throw new Error('Missing '+k);
 for (const k of ['sourceSha256','sha256']) if (!/^[a-f0-9]{64}$/.test(e[k]??'')) throw new Error('Missing hash');
 if (!['real-photo','real-edited','drawn','brand'].includes(e.classification)) throw new Error('Unknown provenance');
 if (['real-photo','real-edited'].includes(e.classification) && (typeof e.sourceId!=='string'||!e.sourceId)) throw new Error('Missing photo source identity');
 if (!/^\/(media|brand)\/[a-z0-9.-]+$/.test(e.publicPath)) throw new Error('Invalid public path');
 const ceiling=/\.(mp4|webm)$/.test(e.publicPath)?1500000:e.publicPath.endsWith('.svg')?500000:100000;
 if (![e.bytes,e.maxBytes,e.width,e.height].every(n=>Number.isInteger(n)&&n>0)||e.bytes>e.maxBytes||e.maxBytes>ceiling) throw new Error('Invalid dimensions or oversized asset');
}
export async function checkAssets(root, {sources=false}={}) {
 const manifest=JSON.parse(readFileSync(path.join(root,'assets/source-manifest.json'),'utf8'));
 const approved=JSON.parse(readFileSync(path.join(root,'assets/approved-media.json'),'utf8'));
 const ids=new Set();
 if(!approved.media.length) throw new Error('No approved media');
 for(const e of approved.media){
  validateEntry(e); if(ids.has(e.id)) throw new Error('Duplicate asset'); ids.add(e.id);
  const file=safeOutput(root,'public'+e.publicPath), side=safeOutput(root,e.sidecar);
  if(sha256(file)!==e.sha256 || statSync(file).size!==e.bytes) throw new Error('Export hash/size changed');
  const record=JSON.parse(readFileSync(side,'utf8'));
  if(record.sourceSha256!==e.sourceSha256 || record.sha256!==e.sha256 || record.classification!==e.classification) throw new Error('Sidecar mismatch');
  if(e.sourceId){const src=approvedSource(manifest,e.sourceId);if(src.path!==e.sourcePath||src.sha256!==e.sourceSha256)throw new Error('Source identity mismatch');}
  if(sources && sha256(e.sourcePath)!==e.sourceSha256) throw new Error('Original source changed');
 }
 if(sources) for(const p of manifest.products) if(sha256(p.path)!==p.sha256)throw new Error('Original source changed');
 return approved.media.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 checkAssets(process.cwd(),{sources:process.argv.includes('--sources')}).then(n=>console.log(`Asset check passed: ${n} assets`)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
