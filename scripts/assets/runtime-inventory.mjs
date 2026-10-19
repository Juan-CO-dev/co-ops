import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Public runtime inventory: only ids and public paths (plus already-used dimensions)
 * enter the edge/client graph, never master paths or provenance. Sequences expand to
 * one entry per frame, in order, so the proxy allowlist names every shipped file. */
export function runtimeEntries(manifest, dimensioned = new Set()) {
  return manifest.media.flatMap(e => e.kind === 'sequence'
    ? e.frames.map((frame, i) => ({ id: `${e.id}-f${String(i).padStart(2, '0')}`, path: frame.publicPath }))
    : [{ id: e.id, path: e.publicPath, ...(dimensioned.has(e.id) || e.kind === 'sprite' ? { width: e.width, height: e.height } : {}) }]);
}
export function writeRuntimeInventory(root, manifest) {
  const runtimePath = resolve(root, 'config/tenant/landing-assets.json');
  const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
  const dimensioned = new Set(runtime.filter(e => e.width !== undefined || e.height !== undefined).map(e => e.id));
  writeFileSync(runtimePath, JSON.stringify(runtimeEntries(manifest, dimensioned), null, 2) + '\n');
}
