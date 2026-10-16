import { fingerprintAssets } from './fingerprint.mjs';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { sha256, safeOutput, approvedSource } from './inventory.mjs';
const root=process.cwd(), source=JSON.parse(readFileSync('assets/source-manifest.json','utf8'));
const src=approvedSource(source,'014');
if(sha256(src.path)!==src.sha256)throw new Error('Original source changed');
const metadata=await sharp(src.path).metadata();
const dest=safeOutput(root,'public/media/crunchy-boi-014.webp');
mkdirSync('public/media',{recursive:true});mkdirSync('public/brand',{recursive:true});mkdirSync('assets/provenance',{recursive:true});
let data,quality=86;
for(;quality>=60;quality-=2){data=await sharp(src.path).rotate().resize({width:750,withoutEnlargement:true}).webp({quality,effort:6}).toBuffer();if(data.length<=100000)break;}
if(data.length>100000)throw new Error('Poster budget failed');
writeFileSync(dest,data);
const out=await sharp(data).metadata();
const record={id:'hero-poster',sourceId:'014',publicPath:'/media/crunchy-boi-014.webp',classification:'real-photo',mode:'crop-resize-only',sourcePath:src.path,sourceSha256:src.sha256,sha256:sha256(dest),bytes:data.length,maxBytes:100000,width:out.width,height:out.height,sidecar:'assets/provenance/hero-poster.json',crop:[0,0,metadata.width,metadata.height],steps:['full-frame uniform resize','WebP encode; metadata stripped'],quality,tool:{sharp:sharp.versions.sharp,vips:sharp.versions.vips,scriptSha256:sha256('scripts/assets/export.mjs')},command:'node scripts/assets/export.mjs',review:'Full frame preserved; phone visual review remains required'};
writeFileSync(record.sidecar,JSON.stringify(record,null,2)+'\n');
const logo='C:/Users/conta/co-3d/logo-pack/vector/co-wordmark.svg';
const logoDest=safeOutput(root,'public/brand/co-wordmark.svg');copyFileSync(logo,logoDest);
const logoMeta=await sharp(logo).metadata();
const brand={id:'wordmark',publicPath:'/brand/co-wordmark.svg',classification:'brand',sourcePath:logo,sourceSha256:sha256(logo),sha256:sha256(logoDest),bytes:statSync(logoDest).size,maxBytes:500000,width:logoMeta.width,height:logoMeta.height,sidecar:'assets/provenance/wordmark.json',steps:['byte-identical copy']};
writeFileSync(brand.sidecar,JSON.stringify(brand,null,2)+'\n');
const manifest=JSON.parse(readFileSync('assets/approved-media.json','utf8'));manifest.media=manifest.media.filter(e=>!['hero-poster','wordmark'].includes(e.id));manifest.media.push(record,brand);writeFileSync('assets/approved-media.json',JSON.stringify(manifest,null,2)+'\n');
if(sha256(src.path)!==src.sha256)throw new Error('Original source changed');
console.log(JSON.stringify({width:out.width,height:out.height,bytes:data.length,quality}));

// Phase 1: original real frames only. V4 is a separate, deferred lane.
const lineup = [];
for (const product of source.products.filter(p => p.eligible)) {
 const src = approvedSource(source, product.representative);
 if (sha256(src.path) !== src.sha256) throw new Error('Original source changed');
 const meta = await sharp(src.path).metadata();
 const publicPath = src.representative === '014' ? record.publicPath : `/media/${product.id}-lineup-${src.representative}.webp`;
 const dest = safeOutput(root, 'public'+publicPath);
 let data, quality=86;
 for (;quality>=60;quality-=2) {
  data=await sharp(src.path).rotate().resize({width:750,withoutEnlargement:true}).webp({quality,effort:6}).toBuffer();
  if(data.length<=100000) break;
 }
 if(data.length>100000) throw new Error('Lineup budget failed');
 writeFileSync(dest,data);
 const out=await sharp(data).metadata();
 const entry={id:`lineup-${product.id}`,sourceId:src.representative,publicPath,classification:'real-photo',mode:'crop-resize-only',sourcePath:src.path,sourceSha256:src.sha256,sha256:sha256(dest),bytes:data.length,maxBytes:100000,width:out.width,height:out.height,sidecar:`assets/provenance/lineup-${product.id}.json`,crop:[0,0,meta.width,meta.height],steps:['full-frame uniform resize','WebP encode; metadata stripped'],quality,tool:{sharp:sharp.versions.sharp,vips:sharp.versions.vips,scriptSha256:sha256('scripts/assets/export.mjs')},command:'node scripts/assets/export.mjs',review:'Original framing retained, including any source-edge crops; phone approval pending'};
 manifest.media=manifest.media.filter(e=>e.id!==entry.id);
 if(src.representative !== '014') { writeFileSync(entry.sidecar,JSON.stringify(entry,null,2)+'\n'); manifest.media.push(entry); }
 const smallPath = `/media/${product.id}-lineup-${src.representative}-480.webp`;
 const smallDest = safeOutput(root,'public'+smallPath);
 const smallQuality = Math.min(quality,78);
 const smallData = await sharp(src.path).rotate().resize({width:480,withoutEnlargement:true}).webp({quality:smallQuality,effort:6}).toBuffer();
 if(smallData.length>100000) throw new Error('Small lineup budget failed');
 writeFileSync(smallDest,smallData);
 const smallMeta=await sharp(smallData).metadata();
 const small={...entry,quality:smallQuality,id:entry.id+'-480',publicPath:smallPath,sha256:sha256(smallDest),bytes:smallData.length,width:smallMeta.width,height:smallMeta.height,sidecar:entry.sidecar.replace('.json','-480.json')};
 writeFileSync(small.sidecar,JSON.stringify(small,null,2)+'\n');
 manifest.media=manifest.media.filter(e=>e.id!==small.id);manifest.media.push(small);
 lineup.push({id:product.id,name:product.name,sourceId:src.representative,image:publicPath,smallImage:smallPath,width:out.width,height:out.height});
 if(sha256(src.path)!==src.sha256) throw new Error('Original source changed');
}
writeFileSync('assets/approved-media.json',JSON.stringify(manifest,null,2)+'\n');
writeFileSync('config/tenant/landing-products.json',JSON.stringify(lineup,null,2)+'\n');

fingerprintAssets();
