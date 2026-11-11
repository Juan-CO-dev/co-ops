import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('0297 real-DDL vendor ledger, trigger, privilege and RPC contract proof', () => {
  const output = execFileSync(process.execPath, ['scripts/sql-harness-0297.mjs'], { encoding: 'utf8', timeout: 240_000 });
  for (const pin of [
    'PASS 0297:', 'broken permissive ACL variant detected', 'references backfilled in received order',
    'exact inbound worker UPDATE grant list', 'vendor_mail_events: SELECT-only table and column ceiling',
    'vendor_mail_read: SELECT-only table and column ceiling', 'receipt INSERT trigger',
    'all catering insert/update transitions excluded', 'machine observations have system actor',
    'handle payload fingerprint conflict', 'replay rechecks revoked session', 'replay rechecks membership',
    'different actor session refused', 'expired session refused', 'GM null-shop refused', 'level 8+ null-shop access',
    'assignment refuses worker lease', 'assignment refuses linked PO/delivery', 'redrive replay',
    'forward claim replay', 'forward result replay', 'forward claim has one result',
    'event failure rolls back projection', 'event failure rolls back machine state',
    'service INSERT cannot forge human projection', 'manual assignment survives later receipt INSERT',
    'receipt null shop overrides transport shop for GM access', 'replay rechecks active actor',
    'invalid assignment JSON/UUID refused', 'old forward claim result replays without duplicate',
    'forward result replay fingerprints original UUID spelling', 'forward claim UUID casing cannot bypass one result',
    'concurrency requires separate sim proof',
  ]) expect(output).toContain(pin);
}, 250_000);
