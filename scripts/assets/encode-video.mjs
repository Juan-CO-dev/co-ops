import { fingerprintAssets } from './fingerprint.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Existing approved DRAWN source only. Never generates or substitutes food.
const source = process.argv[2];
const control = process.argv[3];
if (!source || !control) throw new Error('Usage: node scripts/assets/encode-video.mjs <spin-alpha.webm> <known-alpha-control.webm>');
const work = resolve('assets/work/video');
const output = resolve('public/media/crunchy-boi-spin.mp4');
mkdirSync(work, { recursive: true });
mkdirSync(resolve('public/media'), { recursive: true });
const commands = [];
function run(tool, args) {
  commands.push({tool,args});
  const result = spawnSync(tool, args, {maxBuffer:64*1024*1024, windowsHide:true});
  if (result.error || result.status !== 0) throw new Error(`${tool}: ${result.error ?? result.stderr.toString()}`);
  return result.stdout;
}
const ffmpeg = args => run('ffmpeg', ['-hide_banner','-loglevel','error','-y',...args]);
const probe = path => JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path]).toString());
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function alpha(path, decoder = true, time = 0) {
  const bytes = ffmpeg([...(decoder?['-c:v','libvpx-vp9']:[]),'-i',path,'-ss',String(time),'-vf','format=rgba,alphaextract','-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1']);
  let min = 255, max = 0;
  for (const byte of bytes) {min=Math.min(min,byte);max=Math.max(max,byte);}
  return {min,max,bytes:bytes.length,nonconstant:bytes.length>0&&min<max};
}
const sourceHash = hash(source), controlHash = hash(control);
const sourceInfo = probe(source);
const video = sourceInfo.streams.find(stream => stream.codec_type === 'video');
if (video?.codec_name !== 'vp9') throw new Error('Expected approved VP9 alpha source');
const controlAlpha = alpha(control);
const sourceAlpha = [0,2,4,6].map(time => ({time,...alpha(source,true,time)}));
if (!controlAlpha.nonconstant || sourceAlpha.some(sample => !sample.nonconstant)) throw new Error('Alpha decoder verification failed');
// A real opaque clip is the negative control; a constant plane must fail the alpha criterion.
const negative = `${work}/opaque-control.mp4`;
ffmpeg(['-f','lavfi','-i','color=c=white:s=64x64:r=30:d=0.1','-c:v','libx264','-pix_fmt','yuv420p',negative]);
const opaqueAlpha = alpha(negative,false);
if (opaqueAlpha.nonconstant || opaqueAlpha.min !== 255) throw new Error('Opaque negative control unexpectedly passed');
const width = Math.floor(video.width*Math.min(1,720/Math.max(video.width,video.height))/2)*2;
const height = Math.floor(video.height*Math.min(1,720/Math.max(video.width,video.height))/2)*2;
const duration = Number(sourceInfo.format.duration);
function composite(path, color, destination, frame = false) {
  const graph = `[0:v]format=rgba,scale=${width}:${height}:flags=lanczos,setsar=1[fg];color=c=${color}:s=${width}x${height}:r=30,format=rgba[bg];[bg][fg]overlay=shortest=1:format=rgb,format=${frame?'rgb24':'yuv420p'}[out]`;
  ffmpeg(['-c:v','libvpx-vp9','-i',path,'-filter_complex',graph,'-map','[out]',...(frame?['-frames:v','1']:['-t',String(duration),'-r','30','-c:v','libx264','-crf','23','-preset','slow','-pix_fmt','yuv420p','-movflags','+faststart']),'-an',destination]);
}
const comparisons=[];
for (const [name,color] of [['yellow','0xFFE560'],['ink','0x141414']]) {
  const mp4=name==='yellow'?output:`${work}/spin-${name}.mp4`;
  composite(source,color,mp4);
  composite(source,color,`${work}/spin-${name}-reference.png`,true);
  ffmpeg(['-i',mp4,'-frames:v','1',`${work}/spin-${name}-decoded.png`]);
  composite(control,color,`${work}/control-${name}-reference.png`,true);
  const controlMp4=`${work}/control-${name}.mp4`;
  composite(control,color,controlMp4);
  ffmpeg(['-i',controlMp4,'-frames:v','1',`${work}/control-${name}-decoded.png`]);
  comparisons.push({name,color,mp4,reference:`${work}/spin-${name}-reference.png`,decoded:`${work}/spin-${name}-decoded.png`});
}
const exported = probe(output);
const encoded = exported.streams.find(stream=>stream.codec_type==='video');
const bytes=statSync(output).size;
if (bytes>1500000 || encoded?.codec_name!=='h264' || encoded.pix_fmt!=='yuv420p' || exported.streams.some(stream=>stream.codec_type==='audio') || Math.abs(Number(exported.format.duration)-duration)>1/30 || encoded.width!==width || encoded.height!==height) throw new Error('Export contract failed');
if (hash(source)!==sourceHash || hash(control)!==controlHash) throw new Error('Original source changed');
const entry={id:'crunchy-boi-spin',publicPath:'/media/crunchy-boi-spin.mp4',classification:'drawn',sourcePath:'source:hero-spin-original',sourceSha256:sourceHash,sha256:hash(output),width,height,bytes,maxBytes:1500000,sidecar:'assets/provenance/hero-spin.json',duration,background:'#FFE560',codec:'h264',provenance:'DRAWN (AI REFERENCE), supplied approved spin; decode/composite/encode only'};
writeFileSync(`${work}/verification.json`,JSON.stringify({toolVersion:run('ffmpeg',['-version']).toString().split('\n')[0],entry,control:{path:control,sha256:controlHash,alpha:controlAlpha},sourceAlpha,opaqueAlpha,comparisons,commands},null,2)+'\n');
mkdirSync('assets/provenance', {recursive:true});
writeFileSync('assets/provenance/hero-spin.json',JSON.stringify({...entry,toolVersion:'ffmpeg 8.1.1',steps:['libvpx-vp9 alpha decode','RGBA composite over #FFE560','uniform resize; full 8-second loop','H264 CRF23 slow yuv420p faststart; audio removed'],verification:'assets/verification/hero/provenance.json'},null,2)+'\n');
writeFileSync('assets/work/video-entry.json',JSON.stringify(entry,null,2)+'\n');
console.log(JSON.stringify({bytes,width,height,duration,sha256:entry.sha256,alphaVerified:true,opaqueNegativeRejected:true}));

// Keep small derived browser controls portable; originals never enter the repository.
const fixtureRoot = 'assets/verification/hero';
mkdirSync(fixtureRoot,{recursive:true});
const fixtureNames=['spin-yellow-reference.png','spin-ink-reference.png','spin-ink.mp4','control-yellow-reference.png','control-ink-reference.png','control-yellow.mp4','control-ink.mp4'];
const fixtureFiles=fixtureNames.map(name=>{
  const path=fixtureRoot+'/'+name;
  copyFileSync(work+'/'+name,path);
  return {path,bytes:statSync(path).size,sha256:hash(path)};
});
if(fixtureFiles.reduce((sum,file)=>sum+file.bytes,0)>5000000) throw new Error('Browser verification fixture budget exceeded');
writeFileSync(fixtureRoot+'/provenance.json',JSON.stringify({...JSON.parse(readFileSync(work+'/verification.json','utf8')),fixtureFiles,note:'Derived verification fixtures only; never served publicly. Full master originals remain external.'},null,2)+'\n');

const approved = JSON.parse(readFileSync('assets/approved-media.json', 'utf8'));
approved.media = [...approved.media.filter(asset => asset.id !== entry.id), entry];
writeFileSync('assets/approved-media.json', JSON.stringify(approved, null, 2) + '\n');
fingerprintAssets();
