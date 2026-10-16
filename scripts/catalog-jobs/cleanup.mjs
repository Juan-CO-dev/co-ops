/** Shared F4 quarantine; recovery belongs to CC after catalog-history verification. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class CatalogDirtyWriteError extends Error {
  constructor() { super('Catalog DIRTY marker persistence failed; stop sim reuse'); }
}
export function markCatalogDirty(prefix) {
  const marker = resolve('scripts/sim/launch-readiness/.private/DIRTY');
  // Preserve previous failure evidence; a successful sibling cleanup never clears it.
  if (existsSync(marker)) return;
  const bytes = JSON.stringify({ status: 'catalog-cleanup-failed', prefix, recovery: 'CC-owned complete catalog cleanup verification required' });
  try {
    mkdirSync(dirname(marker), { recursive: true, mode: 0o700 });
    writeFileSync(marker, bytes, { mode: 0o600 });
    if (readFileSync(marker, 'utf8') !== bytes) throw new Error('readback');
  } catch { throw new CatalogDirtyWriteError(); }
}
