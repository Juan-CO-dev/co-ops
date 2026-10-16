import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = JSON.parse(readFileSync('assets/source-manifest.json', 'utf8'));
// Dynamic JS tool import keeps asset tooling outside the application dependency graph.
const inventoryPath = '../../scripts/assets/inventory.mjs';
const tools = await import(/* @vite-ignore */ inventoryPath);
describe('landing asset provenance', () => {
  it('pins eleven identities and ten eligible representatives', () => {
    expect(source.products).toHaveLength(11);
    expect(source.products.filter((p: {eligible:boolean}) => p.eligible)).toHaveLength(10);
    expect(source.products.map((p: {representative:string}) => p.representative)).toEqual(['001','005','011','014','018','024','029','033','037','040','047']);
  });
  it.each(['018','013','015','017','049','050','056','057','063'])('refuses held/unconfirmed %s', id => {
    expect(() => tools.approvedSource(source,id)).toThrow();
  });
  it('refuses traversal and absolute exports', () => {
    for (const p of ['../escape.webp','C:/escape.webp','/escape.webp','public/../../escape.webp']) expect(() => tools.safeOutput(process.cwd(),p)).toThrow();
  });
  it('requires complete provenance and size budget', () => {
    const entry = {id:'poster',sourceId:'014',mode:'crop-resize-only',quality:86,publicPath:'/media/a.webp',classification:'real-photo',sourcePath:'source.jpg',sourceSha256:'a'.repeat(64),sha256:'b'.repeat(64),bytes:10,maxBytes:100,width:10,height:10,sidecar:'assets/provenance/a.json'};
    expect(() => tools.validateEntry(entry)).not.toThrow();
    for (const key of ['sourcePath','sourceSha256','sha256','sidecar','classification','mode','quality']) expect(() => tools.validateEntry({...entry,[key]:''})).toThrow();
    expect(() => tools.validateEntry({...entry,classification:'unknown'})).toThrow();
    expect(() => tools.validateEntry({...entry,bytes:101})).toThrow();
    expect(() => tools.validateEntry({...entry,bytes:100001,maxBytes:100001})).toThrow();
  });
  it.each(['real-photo', 'real-edited'])('requires a photo identity for %s', classification => {
    const entry = { id: 'fixture', mode:'crop-resize-only', quality:86, publicPath: '/media/a.webp', classification, sourcePath: 'source.jpg', sourceSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), bytes: 10, maxBytes: 100, width: 1, height: 1, sidecar: 'assets/provenance/a.json' };
    for (const sourceId of [undefined, '', 14]) expect(() => tools.validateEntry({ ...entry, sourceId })).toThrow('Missing photo source identity');
    expect(() => tools.validateEntry({ ...entry, sourceId: '014' })).not.toThrow();
    for (const classification of ['drawn', 'brand']) expect(() => tools.validateEntry({ ...entry, classification })).toThrow('Missing photo source identity');
  });
  it('detects changed originals, changed exports and a missing sidecar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'landing-assets-'));
    try {
      mkdirSync(join(root, 'assets/provenance'), { recursive: true });
      mkdirSync(join(root, 'public/media'), { recursive: true });
      const original = join(root, 'original.jpg');
      const {default:sharp} = await import('sharp');
      const originalBytes = await sharp({create:{width:1,height:1,channels:3,background:'red'}}).jpeg().toBuffer();
      const output = join(root, 'public/media/test.webp');
      writeFileSync(original, originalBytes); writeFileSync(output, 'export');
      const entry = { id: 'fixture', sourceId: '014', mode:'crop-resize-only', quality:86, publicPath: '/media/test.webp', classification: 'real-photo', sourcePath: original, sourceSha256: tools.sha256(original), sha256: tools.sha256(output), bytes: 6, maxBytes: 100, width: 1, height: 1, sidecar: 'assets/provenance/fixture.json' };
      writeFileSync(join(root, 'assets/source-manifest.json'), JSON.stringify({ products: [{ representative: '014', confirmedIds: ['014'], eligible: true, hold: null, path: original, sha256: entry.sourceSha256 }] }));
      writeFileSync(join(root, 'assets/approved-media.json'), JSON.stringify({ media: [entry] }));
      writeFileSync(join(root, entry.sidecar), JSON.stringify(entry));
      await expect(tools.checkAssets(root)).resolves.toBe(1);
      // Forgery B: internally consistent hashes do not prove derivation.
      await expect(tools.checkAssets(root, { sources: true })).rejects.toThrow('Photo derivation mismatch');
      writeFileSync(original, 'changed');
      await expect(tools.checkAssets(root, { sources: true })).rejects.toThrow('Original source changed');
      writeFileSync(original, originalBytes); writeFileSync(output, 'tamper');
      await expect(tools.checkAssets(root)).rejects.toThrow('Export hash/size changed');
      writeFileSync(output, 'export'); unlinkSync(join(root, entry.sidecar));
      await expect(tools.checkAssets(root)).rejects.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  // Original masters are external local-only files, unavailable in CI. The release
  // command --sources additionally hashes originals and re-derives every photo.
  it('checks shipped bytes, sidecars and source identity records', async () => { await tools.checkAssets(process.cwd()); });
});

it('refuses forgery A: a drawn label cannot smuggle arbitrary media images', () => {
 const entry = {id:'forged',publicPath:'/media/training.webp',classification:'drawn',sourcePath:'training.png',sourceSha256:'a'.repeat(64),sha256:'b'.repeat(64),bytes:10,maxBytes:100,width:10,height:10,sidecar:'assets/provenance/forged.json'};
 expect(() => tools.validateEntry(entry)).toThrow();
});
it('hero and lineup reuse one 014 export and no shipped media hashes duplicate', () => {
 const manifest = JSON.parse(readFileSync('assets/approved-media.json','utf8'));
 const products = JSON.parse(readFileSync('config/tenant/landing-products.json','utf8'));
 const hero = manifest.media.find((e: {id:string}) => e.id === 'hero-poster');
 expect(products.find((e: {sourceId:string}) => e.sourceId === '014').image).toBe(hero.publicPath);
 const hashes = manifest.media.map((e: {sha256:string}) => e.sha256);
 expect(new Set(hashes).size).toBe(hashes.length);
});
it('registers the existing drawn SUBDEX frame without permitting photo relabeling', () => {
 const drawn = tools.approvedSource(source,'subdex-frame-17-5','drawn');
 expect(drawn.classification).toBe('drawn');
 expect(drawn.videoSha256).toBe('332643dcbff5eb90e1e862d20bc2b9aa9b09ca99f25376f7d92d11e5f5abad82');
 expect(() => tools.approvedSource(source,'subdex-frame-17-5','real-photo')).toThrow();
 expect(() => tools.approvedSource(source,'subdex-frame-17-5','real-edited')).toThrow();
 expect(() => tools.approvedSource(source,'unknown-drawn','drawn')).toThrow();
 for(const patch of [{videoSha256:'a'.repeat(64)},{cut:{...drawn.cut,poster:0}},{path:'assets/work/unapproved.png'}]) expect(() => tools.approvedSource({...source,drawnSources:[{...drawn,...patch}]},'subdex-frame-17-5','drawn')).toThrow('Unapproved drawn source recipe');
});
