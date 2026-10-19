// node scripts/assets/export-map.mjs
// Renders the OSM street raster (py renderer, pinned extract), encodes the shipped WebP,
// and writes the approval entry, sidecar, public projection config and runtime inventory.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { MAP_RECIPE, validateRenderedProjection } from './map-recipe.mjs';
import { writeRuntimeInventory } from './runtime-inventory.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Renders and encodes exactly as shipped; the inventory reuses it with --sources. */
export async function renderMap(root = process.cwd()) {
  const r = MAP_RECIPE;
  if (hash(readFileSync(r.osmPath)) !== r.osmSha256) throw Error('OSM extract changed');
  mkdirSync(resolve(root, 'assets/work'), { recursive: true });
  const png = resolve(root, 'assets/work/landing-map.png'), meta = resolve(root, 'assets/work/landing-map.json');
  execFileSync('py', [resolve(root, r.renderer), png, meta], { stdio: 'pipe' });
  const raster = readFileSync(png);
  const bytes = await sharp(raster).resize({ width: r.width }).webp({ quality: r.quality, effort: r.effort }).toBuffer();
  return { raster, bytes, projection: JSON.parse(readFileSync(meta, 'utf8')) };
}
export async function exportMap(root = process.cwd()) {
  const r = MAP_RECIPE;
  const { raster, bytes, projection } = await renderMap(root);
  validateRenderedProjection(projection);
  const { width, height } = await sharp(bytes).metadata();
  if (width !== r.width || height !== r.height || bytes.length > r.maxBytes) throw Error(`Unexpected map output ${width}x${height} ${bytes.length}`);
  const sha256 = hash(bytes);
  const publicPath = `/media/${r.id}-${sha256.slice(0, 12)}.webp`;
  writeFileSync(resolve(root, 'public' + publicPath), bytes);
  for (const file of readdirSync(resolve(root, 'public/media'))) if (/^landing-map-[a-f0-9]{12}\.webp$/.test(file) && `/media/${file}` !== publicPath) rmSync(resolve(root, 'public/media', file));
  const entry = { id: r.id, kind: 'map', classification: 'brand', publicPath, sourcePath: `source:${r.sourceId}`, sourceSha256: r.osmSha256,
    rasterSha256: hash(raster), rendererSha256: hash(readFileSync(resolve(root, r.renderer))), sha256, bytes: bytes.length, maxBytes: r.maxBytes, width, height,
    quality: r.quality, effort: r.effort, tool: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp },
    sidecar: `assets/provenance/${r.id}.json`, command: 'node scripts/assets/export-map.mjs',
    provenance: 'OpenStreetMap data (ODbL 1.0), pinned Overpass extract; own render (roads, water, parks; no labels); attribution shown under the map' };
  writeFileSync(resolve(root, entry.sidecar), JSON.stringify(entry, null, 2) + '\n');
  const config = { image: publicPath, width, height, lat0: projection.lat0, lon0: projection.lon0, kx: projection.kx, ky: projection.ky, halfMetres: projection.halfMetres, osmBase: projection.osmBase };
  writeFileSync(resolve(root, 'config/tenant/landing-map.json'), JSON.stringify(config, null, 2) + '\n');
  const manifestPath = resolve(root, 'assets/approved-media.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.media = [...manifest.media.filter(e => e.id !== r.id), entry];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const sourcesPath = resolve(root, 'assets/source-manifest.json');
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  sources.externalSources = [...sources.externalSources.filter(s => s.id !== r.sourceId), { id: r.sourceId, path: r.osmPath, sha256: r.osmSha256 }];
  writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + '\n');
  writeRuntimeInventory(root, manifest);
  return entry;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportMap().then(e => console.log(`Map: ${e.width}x${e.height} ${e.bytes} bytes`)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
