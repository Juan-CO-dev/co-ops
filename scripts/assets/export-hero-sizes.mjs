import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {approvedSource,sha256,safeOutput} from './inventory.mjs';

// Bounded, full-frame derivatives of the approved original; never transcode a derivative.
const manifest=JSON.parse(readFileSync('assets/source-manifest.json','utf8'));
const source=approvedSource(manifest,'014');
if(sha256(source.path)!==source.sha256)throw Error('Original source changed');
const metadata=await sharp(source.path).metadata();
const approved=JSON.parse(readFileSync('assets/approved-media.json','utf8'));
const records=[];
for(const width of [320,640,960]) {
 const quality=86;
 const bytes=await sharp(source.path).rotate().resize({width,withoutEnlargement:true}).webp({quality,effort:6}).toBuffer();
 const dimensions=await sharp(bytes).metadata();
 if(dimensions.width!==width || bytes.length>100000)throw Error('Hero dimensions/budget failed');
 const hash=createHash('sha256').update(bytes).digest('hex');
 const publicPath=`/media/crunchy-boi-014-${width}-${hash.slice(0,12)}.webp`;
 const record={id:`hero-poster-${width}`,sourceId:'014',publicPath,classification:'real-photo',mode:'resize-only',sourcePath:'source:014',sourceSha256:source.sha256,sha256:hash,bytes:bytes.length,maxBytes:100000,width:dimensions.width,height:dimensions.height,sidecar:`assets/provenance/hero-poster-${width}.json`,crop:[0,0,metadata.width,metadata.height],steps:['EXIF auto-orientation (.rotate())','full-frame uniform resize','WebP encode; metadata stripped'],quality,tool:{sharp:sharp.versions.sharp,vips:sharp.versions.vips,scriptSha256:sha256('scripts/assets/export-hero-sizes.mjs')},command:'node scripts/assets/export-hero-sizes.mjs'};
 records.push({record,bytes});
}
if(sha256(source.path)!==source.sha256)throw Error('Original source changed');
for(const {record,bytes} of records) {
 const previous=approved.media.find(entry=>entry.id===record.id);
 if(previous && previous.sha256!==record.sha256)throw Error('Existing derivative differs; review inventory before replacement');
 writeFileSync(safeOutput(process.cwd(),'public'+record.publicPath),bytes);
 writeFileSync(safeOutput(process.cwd(),record.sidecar),JSON.stringify(record,null,2)+'\n');
 approved.media=approved.media.filter(entry=>entry.id!==record.id);
 approved.media.push(record);
}
writeFileSync('assets/approved-media.json',JSON.stringify(approved,null,2)+'\n');
writeFileSync('config/tenant/landing-assets.json',JSON.stringify(approved.media.map(entry=>({id:entry.id,path:entry.publicPath})),null,2)+'\n');
console.log(records.map(({record})=>({width:record.width,bytes:record.bytes,sha256:record.sha256})));
