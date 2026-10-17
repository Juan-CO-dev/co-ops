import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {approvedSource,sha256,safeOutput,validateEntry,PHOTO_DETAILS,V2_RECIPES} from './inventory.mjs';

/** An identical derivative keeps its review; changed bytes require a new review. */
export function inspectionForDerivative(previous,hash) {
 if(previous && previous.sha256!==hash)throw Error('Existing derivative differs; review before replacement');
 return previous?.inspection??{verdict:'pending final visual inspection',reviewer:'Astra'};
}

// Full-frame delivery transforms only; always start from the pinned original.
export async function exportLandingV2(root=process.cwd()) {
 const read=p=>JSON.parse(readFileSync(path.join(root,p),'utf8'));
 const manifest=read('assets/source-manifest.json');
 const approved=read('assets/approved-media.json');
 const runtime=read('config/tenant/landing-assets.json');
 const records=[];
 const tool={sharp:sharp.versions.sharp,vips:sharp.versions.vips,webp:sharp.versions.webp,scriptSha256:sha256(path.join(root,'scripts/assets/export-landing-v2.mjs'))};
 for(const [id,recipe] of Object.entries(V2_RECIPES)) {
  const source=approvedSource(manifest,recipe.sourceId);
  if(sha256(source.path)!==PHOTO_DETAILS[recipe.sourceId])throw Error('Original source changed');
  const input=readFileSync(source.path);
  const meta=await sharp(input).metadata();
  if(meta.width!==2667 || meta.height!==4000 || (meta.orientation && meta.orientation!==1))throw Error('Unexpected source geometry');
  const bytes=await sharp(input).rotate().resize({width:recipe.width,withoutEnlargement:true}).webp({quality:recipe.quality,effort:6}).toBuffer();
  const dimensions=await sharp(bytes).metadata();
  const hash=createHash('sha256').update(bytes).digest('hex');
  const record={id,...recipe,publicPath:`/media/${id}-${hash.slice(0,12)}.webp`,classification:'real-photo',mode:'resize-only',sourcePath:`source:${recipe.sourceId}`,sourceSha256:source.sha256,sha256:hash,bytes:bytes.length,height:dimensions.height,sidecar:`assets/provenance/${id}.json`,crop:{left:0,top:0,width:2667,height:4000},orientedSource:{width:2667,height:4000},steps:['EXIF auto-orientation (.rotate())','full-frame uniform resize','WebP encode; metadata stripped'],effort:6,tool,command:'node scripts/assets/export-landing-v2.mjs',inspection:{verdict:'pending final visual inspection',reviewer:'Astra'}};
  validateEntry(record);
  const previous=approved.media.find(e=>e.id===id);
  record.inspection=inspectionForDerivative(previous,hash);
  records.push({record,bytes});
 }
 // Validate every source again before any persistent writes.
 for(const id of Object.keys(PHOTO_DETAILS))if(sha256(approvedSource(manifest,id).path)!==PHOTO_DETAILS[id])throw Error('Original source changed');
 for(const {record,bytes} of records) {
  writeFileSync(safeOutput(root,'public'+record.publicPath),bytes);
  writeFileSync(safeOutput(root,record.sidecar),JSON.stringify(record,null,2)+'\n');
 }
 const ids=new Set(records.map(({record})=>record.id));
 approved.media=[...approved.media.filter(e=>!ids.has(e.id)),...records.map(({record})=>record)];
 const publicRecords=[...runtime.filter(e=>!ids.has(e.id)),...records.map(({record:e})=>({id:e.id,path:e.publicPath,width:e.width,height:e.height}))];
 writeFileSync(safeOutput(root,'assets/approved-media.json'),JSON.stringify(approved,null,2)+'\n');
 writeFileSync(safeOutput(root,'config/tenant/landing-assets.json'),JSON.stringify(publicRecords,null,2)+'\n');
 return records.map(({record:e})=>({id:e.id,width:e.width,height:e.height,bytes:e.bytes,sha256:e.sha256}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 exportLandingV2().then(records=>console.log(JSON.stringify(records,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
