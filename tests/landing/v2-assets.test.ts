import {describe, expect, it} from 'vitest';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,cpSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const inventoryPath = '../../scripts/assets/inventory.mjs';
const tools = await import(/* @vite-ignore */ inventoryPath);
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const fixture = {id:'fixture',sourceId:'P013',classification:'real-photo',mode:'crop-resize-only',quality:78,publicPath:'/media/fixture.webp',sourcePath:'source:P013',sourceSha256:'a'.repeat(64),sha256:'b'.repeat(64),bytes:10,maxBytes:100,width:20,height:30,sidecar:'assets/provenance/fixture.json',crop:{left:10,top:20,width:40,height:60},orientedSource:{width:100,height:120},effort:6,tool:{sharp:'0.34.5',vips:'8.17.3',webp:'1.6.0'},steps:['EXIF auto-orientation (.rotate())','integer crop in oriented-source coordinates','uniform resize without enlargement','WebP encode; metadata stripped']};
describe('v2 bounded photo recipes', () => {
  it('retains responsive runtime dimensions when fingerprinting again', async () => {
    const root=mkdtempSync(join(tmpdir(),'landing-v2-fingerprint-'));
    try {
      for(const dir of ['assets','config/tenant','public/media']) cpSync(dir,join(root,dir),{recursive:true});
      const before=read('config/tenant/landing-assets.json');
      const modulePath='../../scripts/assets/fingerprint.mjs';
      const {fingerprintAssets}=await import(/* @vite-ignore */ modulePath);
      fingerprintAssets(root);
      expect(read(join(root,'config/tenant/landing-assets.json'))).toEqual(before);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it.skipIf(!existsSync('C:/Users/conta/co-chief-assets/picks-full/P013.jpg'))('preserves inspected verdicts on a byte-identical exporter rerun', async () => {
    const root=mkdtempSync(join(tmpdir(),'landing-v2-rerun-'));
    try {
      for(const dir of ['assets','config/tenant','scripts/assets']) cpSync(dir,join(root,dir),{recursive:true});
      mkdirSync(join(root,'public/media'),{recursive:true});
      const before=read('assets/approved-media.json').media.filter((e:{id:string})=>e.id.startsWith('v2-'));
      const exporterPath='../../scripts/assets/export-landing-v2.mjs';
      const {exportLandingV2}=await import(/* @vite-ignore */ exporterPath);
      await exportLandingV2(root);
      const after=read(join(root,'assets/approved-media.json')).media;
      for(const entry of before) expect(after.find((e:{id:string})=>e.id===entry.id).inspection).toEqual(entry.inspection);
    } finally {rmSync(root,{recursive:true,force:true});}
  },30000);
  it('reconstructs a crop from an EXIF-oriented source and refuses recipe, identity and byte tampering', async () => {
    const root=mkdtempSync(join(tmpdir(),'landing-v2-crop-'));
    try {
      mkdirSync(join(root,'assets/provenance'),{recursive:true});
      mkdirSync(join(root,'public/media'),{recursive:true});
      const {default:sharp}=await import('sharp');
      const source=join(root,'original.jpg');
      // Orientation 6 swaps 120x100 into 100x120 before crop coordinates apply.
      const pixels=Buffer.from(Array.from({length:120*100*3},(_,i)=>(i*37+Math.floor(i/360)*13)%256));
      writeFileSync(source,await sharp(pixels,{raw:{width:120,height:100,channels:3}}).jpeg().withMetadata({orientation:6}).toBuffer());
      const bytes=await sharp(source).rotate().extract(fixture.crop).resize({width:fixture.width,withoutEnlargement:true}).webp({quality:fixture.quality,effort:6}).toBuffer();
      const output=join(root,'public/media/fixture.webp');
      writeFileSync(output,bytes);
      const entry={...fixture,sourceId:'014',sourcePath:'source:014',sourceSha256:tools.sha256(source),sha256:tools.sha256(output),bytes:bytes.length,maxBytes:10000,tool:{sharp:sharp.versions.sharp,vips:sharp.versions.vips,webp:sharp.versions.webp}};
      const manifest={products:[{representative:'014',confirmedIds:['014'],eligible:true,hold:null as string|null,path:source,sha256:entry.sourceSha256}]};
      const save=(e=entry,side=e,m=manifest)=>{
        writeFileSync(join(root,'assets/source-manifest.json'),JSON.stringify(m));
        writeFileSync(join(root,'assets/approved-media.json'),JSON.stringify({media:[e]}));
        writeFileSync(join(root,entry.sidecar),JSON.stringify(side));
      };
      save();
      await expect(tools.checkAssets(root,{sources:true})).resolves.toBe(1);
      for(const patch of [{crop:{...entry.crop,left:11}},{orientedSource:{width:101,height:120}},{quality:77},{steps:['retouch']},{tool:{...entry.tool,sharp:'0.0.0'}},{width:19}]) {
        save(entry,{...entry,...patch});
        await expect(tools.checkAssets(root)).rejects.toThrow('Sidecar mismatch');
      }
      save({...entry,crop:{...entry.crop,left:11}});
      await expect(tools.checkAssets(root,{sources:true})).rejects.toThrow('Photo derivation mismatch');
      save({...entry,orientedSource:{width:101,height:120}});
      await expect(tools.checkAssets(root,{sources:true})).rejects.toThrow('Oriented source dimensions changed');
      save({...entry,height:31});
      await expect(tools.checkAssets(root,{sources:true})).rejects.toThrow('Output dimensions mismatch');
      for(const patch of [{sourceSha256:'a'.repeat(64)},{sourcePath:'substitute.jpg'},{classification:'drawn'},{sourceId:'013'}]) {
        save({...entry,...patch});
        await expect(tools.checkAssets(root)).rejects.toThrow();
      }
      save(entry,entry,{products:[{...manifest.products[0]!,hold:'legal'}]});
      await expect(tools.checkAssets(root)).rejects.toThrow();
      save();
      writeFileSync(output,Buffer.alloc(bytes.length));
      await expect(tools.checkAssets(root)).rejects.toThrow('Export hash/size changed');
      writeFileSync(output,bytes);
      writeFileSync(source,'changed');
      await expect(tools.checkAssets(root,{sources:true})).rejects.toThrow('Original source changed');
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it('admits a complete integer uniform crop and rejects malformed or stretched crops', () => {
    expect(() => tools.validateEntry(fixture)).not.toThrow();
    for (const crop of [undefined, {}, {left:-1,top:0,width:40,height:60}, {left:0.5,top:0,width:40,height:60}, {left:80,top:0,width:40,height:60}, {left:0,top:100,width:40,height:60}, {left:0,top:0,width:0,height:60}]) expect(() => tools.validateEntry({...fixture,crop})).toThrow();
    expect(() => tools.validateEntry({...fixture,height:20})).toThrow();
    expect(() => tools.validateEntry({...fixture,width:80,height:120})).toThrow();
    expect(() => tools.validateEntry({...fixture,orientedSource:undefined})).toThrow();
    for(const patch of [{tool:undefined},{steps:[]},{effort:5}]) expect(()=>tools.validateEntry({...fixture,...patch})).toThrow();
  });
  it('keeps photo details separate from held product identities and other classes', () => {
    const source=read('assets/source-manifest.json');
    expect(source.products).toHaveLength(11);
    expect(source.products.filter((p: {eligible:boolean})=>p.eligible)).toHaveLength(10);
    expect(source.photoDetails.map((p: {representative:string})=>p.representative)).toEqual(['P013','P016','L083']);
    for(const id of ['P013','P016','L083']) {
      expect(tools.approvedSource(source,id).classification).toBe('real-photo');
      for(const classification of ['drawn','brand','real-edited']) expect(()=>tools.approvedSource(source,id,classification)).toThrow();
      const selected=tools.approvedSource(source,id);
      for(const patch of [{hold:'held'},{eligible:false},{classification:'drawn'},{sha256:'a'.repeat(64)},{path:'substitute.jpg'}]) expect(()=>tools.approvedSource({...source,photoDetails:[{...selected,...patch}]},id)).toThrow();
      expect(()=>tools.approvedSource({...source,products:[...source.products,selected]},id)).toThrow();
    }
    for(const id of ['013','018','unknown']) expect(()=>tools.approvedSource(source,id)).toThrow();
    expect(()=>tools.approvedSource(source,'014','drawn')).toThrow();
  });
  it('registers exactly eleven responsive recipes with bounded budgets and portable runtime records', async () => {
    const manifest=read('assets/approved-media.json');
    const runtime=read('config/tenant/landing-assets.json');
    const recipes=[['p013',78,[320,480,640,960,1280]],['p016',86,[480,720,960]],['l083',86,[480,720,960]]] as const;
    const entries=manifest.media.filter((e: {id:string})=>e.id.startsWith('v2-'));
    expect(entries).toHaveLength(11);
    expect(entries.map((e: {bytes:number;maxBytes:number})=>[e.bytes,e.maxBytes])).toEqual([
      [16744,20000],[30088,35000],[46798,50000],[84742,90000],[130616,140000],
      [67070,70000],[127440,135000],[196008,205000],
      [96506,100000],[172414,180000],[260624,270000],
    ]);
    const {default:sharp}=await import('sharp');
    for(const [source,quality,widths] of recipes) for(const width of widths) {
      const id=`v2-${source}-${width}`;
      const e=entries.find((e: {id:string})=>e.id===id);
      expect(e).toMatchObject({sourceId:source.toUpperCase(),mode:'resize-only',classification:'real-photo',width,quality,load:source==='p013'?'initial':'lazy'});
      expect(e.publicPath).toBe(`/media/${id}-${e.sha256.slice(0,12)}.webp`);
      expect(read(e.sidecar)).toEqual(e);
      expect(e.inspection.verdict).toMatch(/^PASS/);
      expect(e.inspection.reviewer).toBeTruthy();
      expect(e.inspection.date).toBeTruthy();
      const meta=await sharp(readFileSync('public'+e.publicPath)).metadata();
      expect([meta.width,meta.height]).toEqual([e.width,e.height]);
      // JPEG shrink-on-load can differ by one pixel from the rounded ideal height.
      expect(Math.abs(e.height-Math.round(width*4000/2667))).toBeLessThanOrEqual(1);
      expect(runtime.find((r: {id:string})=>r.id===id)).toEqual({id,path:e.publicPath,width:e.width,height:e.height});
      expect(()=>tools.validateEntry(e)).not.toThrow();
      for(const patch of [{maxBytes:e.maxBytes+1},{bytes:e.maxBytes+1},{quality:quality-1},{sourceId:'014'},{load:e.load==='lazy'?'initial':'lazy'}]) expect(()=>tools.validateEntry({...e,...patch})).toThrow();
      expect(()=>tools.validateEntry({...e,id:'unrelated',bytes:140000,maxBytes:140000})).toThrow();
    }
    expect(readFileSync('docs/landing-v2-BUILD.md','utf8')).toContain('818,778-byte initial transfer are experiments');
  });
});
