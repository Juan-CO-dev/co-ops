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
    const entry = {id:'poster',sourceId:'014',publicPath:'/media/a.webp',classification:'real-photo',sourcePath:'source.jpg',sourceSha256:'a'.repeat(64),sha256:'b'.repeat(64),bytes:10,maxBytes:100,width:10,height:10,sidecar:'assets/provenance/a.json'};
    expect(() => tools.validateEntry(entry)).not.toThrow();
    for (const key of ['sourcePath','sourceSha256','sha256','sidecar','classification']) expect(() => tools.validateEntry({...entry,[key]:''})).toThrow();
    expect(() => tools.validateEntry({...entry,classification:'unknown'})).toThrow();
    expect(() => tools.validateEntry({...entry,bytes:101})).toThrow();
    expect(() => tools.validateEntry({...entry,bytes:100001,maxBytes:100001})).toThrow();
  });
  it.each(['real-photo', 'real-edited'])('requires a photo identity for %s', classification => {
    const entry = { id: 'fixture', publicPath: '/media/a.webp', classification, sourcePath: 'source.jpg', sourceSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), bytes: 10, maxBytes: 100, width: 1, height: 1, sidecar: 'assets/provenance/a.json' };
    for (const sourceId of [undefined, '', 14]) expect(() => tools.validateEntry({ ...entry, sourceId })).toThrow('Missing photo source identity');
    expect(() => tools.validateEntry({ ...entry, sourceId: '014' })).not.toThrow();
    for (const classification of ['drawn', 'brand']) expect(() => tools.validateEntry({ ...entry, classification })).not.toThrow();
  });
  it('detects changed originals, changed exports and a missing sidecar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'landing-assets-'));
    try {
      mkdirSync(join(root, 'assets/provenance'), { recursive: true });
      mkdirSync(join(root, 'public/media'), { recursive: true });
      const original = join(root, 'original.jpg');
      const output = join(root, 'public/media/test.webp');
      writeFileSync(original, 'original'); writeFileSync(output, 'export');
      const entry = { id: 'fixture', sourceId: '014', publicPath: '/media/test.webp', classification: 'real-photo', sourcePath: original, sourceSha256: tools.sha256(original), sha256: tools.sha256(output), bytes: 6, maxBytes: 100, width: 1, height: 1, sidecar: 'assets/provenance/fixture.json' };
      writeFileSync(join(root, 'assets/source-manifest.json'), JSON.stringify({ products: [{ representative: '014', eligible: true, hold: null, path: original, sha256: entry.sourceSha256 }] }));
      writeFileSync(join(root, 'assets/approved-media.json'), JSON.stringify({ media: [entry] }));
      writeFileSync(join(root, entry.sidecar), JSON.stringify(entry));
      await expect(tools.checkAssets(root, { sources: true })).resolves.toBe(1);
      writeFileSync(original, 'changed');
      await expect(tools.checkAssets(root, { sources: true })).rejects.toThrow('Original source changed');
      writeFileSync(original, 'original'); writeFileSync(output, 'tamper');
      await expect(tools.checkAssets(root)).rejects.toThrow('Export hash/size changed');
      writeFileSync(output, 'export'); unlinkSync(join(root, entry.sidecar));
      await expect(tools.checkAssets(root)).rejects.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('checks shipped bytes, sidecars and source identity records', async () => { await tools.checkAssets(process.cwd()); });
});
