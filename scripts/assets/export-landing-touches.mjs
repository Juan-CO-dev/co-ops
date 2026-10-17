import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { TOUCH_RECIPES } from './touch-recipes.mjs';
import { deriveMarkSvg } from './mark-source.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
export async function exportLandingTouches(){
const base='C:/Users/conta/co-3d/';
const recipes=[
 {id:'clay-bag',file:'kid-again/03-hero/alts/prop-clay-to-go-bag-blank-AI-DRAWN.png',crop:{left:0,top:0,width:880,height:1120},width:256,maxBytes:35000,inspection:'Approved: opaque stylized empty bag; bottom AI tag excluded by crop; no food'},
 {id:'lowpoly-prop',file:'lowpoly-bank/pilgrim/rgba/pilgrim-idle-rgba-AI-DRAWN.png',crop:{left:455,top:105,width:115,height:120},width:115,maxBytes:25000,inspection:'Approved: isolated upper staff head only, no face/body/food'},
 {id:'office-wave',file:'clay-bank/office-worker/office-worker-wave-rgba-AI-DRAWN.png',crop:{left:0,top:0,width:1536,height:2720},width:256,maxBytes:45000,inspection:'Approved: empty-handed clay worker; no food; one character slot'},
];
const native='assets/sources/touch-doodle-chip.svg';
recipes.push({id:'doodle-chip',file:native,local:true,maxBytes:5000,inspection:'Approved: code-native illustrated outline and ridges; no photo input'});
recipes.push({id:'mark-nod',file:'logo-pack/vector/co-icon-flat.svg',classification:'brand',maxBytes:30000,inspection:'Approved: authentic original mark; original paths and cutouts retained; bounded subpixel vector simplification, no redraw'});
const manifest=JSON.parse(readFileSync('assets/source-manifest.json','utf8'));
const approved=JSON.parse(readFileSync('assets/approved-media.json','utf8'));
const runtime=JSON.parse(readFileSync('config/tenant/landing-assets.json','utf8'));
const touches=JSON.parse(readFileSync('config/tenant/landing-touches.json','utf8'));
manifest.decorativeSources=(manifest.decorativeSources??[]).filter(s=>!recipes.some(r=>`touch-${r.id}`===s.representative));
const staged=[];
for(const recipe of recipes){
 const path=recipe.local?recipe.file:base+recipe.file,input=readFileSync(path),meta=await sharp(input).metadata();
 if(hash(input)!==TOUCH_RECIPES[`touch-${recipe.id}`]?.source.sha256)throw Error('Original decorative source changed');
 const raster=!!recipe.crop,mark=recipe.id==='mark-nod',bytes=raster?await sharp(input).rotate().extract(recipe.crop).resize({width:recipe.width,withoutEnlargement:true}).webp({quality:85,effort:6}).toBuffer():mark?deriveMarkSvg(input,0.4):input;
 const output=await sharp(bytes).metadata(),sha256=hash(bytes),id=`touch-${recipe.id}`,classification=recipe.classification??'drawn';
 const publicPath=`/${raster?'media':'brand'}/${id}-${sha256.slice(0,12)}.${raster?'webp':'svg'}`;
 const source={representative:id,confirmedIds:[id],eligible:true,hold:null,path,sha256:hash(input),classification,inspection:recipe.inspection};
 manifest.decorativeSources.push(source);
 const entry={id,sourceId:id,sourcePath:`source:${id}`,sourceSha256:source.sha256,classification,publicPath,sidecar:`assets/provenance/${id}.json`,sha256,bytes:bytes.length,maxBytes:recipe.maxBytes,width:output.width,height:output.height,load:'lazy',mode:raster?'crop-resize-only':mark?'vector-simplify':'code-native',...(raster?{crop:recipe.crop,orientedSource:{width:meta.width,height:meta.height},quality:85,effort:6,steps:['EXIF auto-orientation (.rotate())','integer crop in oriented-source coordinates','uniform resize without enlargement','WebP encode; metadata stripped'],tool:{sharp:sharp.versions.sharp,vips:sharp.versions.vips,webp:sharp.versions.webp}}:{}),...(mark?{vectorTolerance:0.4,flattenTolerance:0.05,steps:['adaptive Bezier flattening within 0.05 source pixels','per-contour RDP simplification within 0.4 source pixels','round coordinates to 0.01 source pixels; preserve paths, winding, fill and viewBox'],tool:{vectorRecipe:'mark-source-v1'}}:{}),command:'node scripts/assets/export-landing-touches.mjs',inspection:recipe.inspection,reviewer:'Astra visual inspection 2026-10-17'};
 if(bytes.length>recipe.maxBytes)throw Error(`Oversized ${id}`);
 if(JSON.stringify(entry)!==JSON.stringify(TOUCH_RECIPES[id].entry))throw Error('Decorative recipe changed');
 staged.push({entry,bytes});
 approved.media=approved.media.filter(e=>e.id!==id);approved.media.push(entry);
 const runtimeEntry={id,path:publicPath,width:entry.width,height:entry.height};
 const index=runtime.findIndex(e=>e.id===id);if(index>=0)runtime[index]=runtimeEntry;else runtime.push(runtimeEntry);
 Object.assign(touches.find(t=>t.id===recipe.id),{path:publicPath,width:entry.width,height:entry.height});
 console.log(id,bytes.length);
}
for(const {entry,bytes} of staged){writeFileSync('public'+entry.publicPath,bytes);save(entry.sidecar,entry);}
save('assets/source-manifest.json',manifest);save('assets/approved-media.json',approved);save('config/tenant/landing-assets.json',runtime);save('config/tenant/landing-touches.json',touches);
save('assets/provenance/touch-checker-peek.json',{id:'checker-peek',classification:'brand',mode:'code-native',recipe:'48x32 CSS conic-gradient black/cream checker; one 600ms transform; reserved 80px slot',inspection:'Approved: code-native motif, no food or image bytes',reviewer:'Astra 2026-10-17'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 exportLandingTouches().catch(error=>{console.error(error.message);process.exitCode=1;});
}
