/**
 * Post-build scan (password vault, GO 2026-10-08): the CLIENT bundle must not carry the master-key
 * env name, the crypto module, a decipher call, or a planted canary. Run after `next build`:
 *   node scripts/vault-bundle-scan.mjs [projectRoot]
 * Exit 0 = clean; exit 1 = a needle was found (prints file + needle). `.next/server` is not scanned:
 * the server bundle legitimately holds lib/vault-crypto.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
const staticDir = path.join(root, ".next", "static");
const NEEDLES = ["VAULT_MASTER_KEY", "vault-crypto", "createDecipheriv", "createCipheriv", "CANARY-", "vault_write_secret", "wrapped_key"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (!existsSync(staticDir)) {
  console.error(`vault bundle scan: ${staticDir} not found - run next build first`);
  process.exitCode = 1;
} else {
  const files = walk(staticDir).filter((f) => /\.(js|css|json|txt|map)$/.test(f));
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const n of NEEDLES) if (text.includes(n)) hits.push(`${path.relative(root, f)} :: ${n}`);
  }
  if (hits.length) {
    console.error(`vault bundle scan: FAILED (${hits.length} hit${hits.length === 1 ? "" : "s"})\n${hits.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`vault bundle scan: clean - ${files.length} client files under .next/static, none contain ${NEEDLES.map((n) => JSON.stringify(n)).join(", ")}.`);
  }
}
