import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

/** A separate production build with fictional delivery destinations. Never
 * mutate the real tenant config or add a production environment/test switch. */
export async function prepareNearbyFixture(runtime) {
  const root = process.cwd();
  pruneNearbyFixtures(resolve(root, 'tmp'));
  // Fresh directory each run: no stale compiled modules or removed source files.
  const dir = resolve(root, 'tmp', `landing-nearby-${Date.now()}`);
  mkdirSync(dir, { recursive:true });
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding:'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    if (/^(?:\.env|\.github\/)/.test(file) || !existsSync(file)) continue;
    const target = join(dir, file);
    mkdirSync(dirname(target), {recursive:true});
    copyFileSync(file, target);
  }
  // The normal production build/typecheck covers tests and tools. This build
  // checks the application and follows every imported dependency as usual.
  const tsconfigPath = join(dir, 'tsconfig.json');
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  tsconfig.exclude = [...tsconfig.exclude, 'tests/', 'scripts/'];
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  symlinkSync(resolve(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const tenantPath = join(dir, 'config/tenant/landing.ts');
  const original = readFileSync(tenantPath, 'utf8');
  const footerBlock = /footerLinks: \[[\s\S]*?\],/;
  if (!footerBlock.test(original)) throw new Error('Update the nearby fixture for the changed tenant config');
  writeFileSync(tenantPath, original.replace(footerBlock,
    'footerLinks: [{key:"uber-eats",url:"https://example.test/uber"},{key:"doordash",url:"https://example.test/dash"}],'));
  // Exercise Next's real notFound boundary without a production test hook.
  const pagePath = join(dir, 'app/eat/page.tsx');
  const page = readFileSync(pagePath, 'utf8');
  const queryRead = 'const query = await searchParams;';
  if (!page.includes(queryRead)) throw new Error('Update the not-found fixture for the changed page');
  const footerRender='key === "footer" && <Footer';
  if(!page.includes(footerRender))throw new Error('Update the missing-footer fixture for the changed page');
  writeFileSync(pagePath, page.replace(queryRead, queryRead + '\n  if (query.__fixture_not_found === "1") notFound();')
    .replace(footerRender,'key === "footer" && query.__fixture_no_footer !== "1" && <Footer'));
  // Webpack supports the dependency junction; Turbopack forbids outside-root links.
  const build = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {cwd:dir, env:runtime, stdio:'inherit'});
  const code = await new Promise((resolve, reject) => {build.once('error', reject);build.once('exit', resolve);});
  if (code !== 0) throw new Error(`Nearby fixture production build failed (${code})`);
  return dir;
}

/** Each run leaves a full app copy (~1 GB with its build). Remove earlier copies before
 * making a new one. The node_modules junction is unlinked FIRST and verified gone, so a
 * recursive delete can never follow it into the real dependency tree. */
export function pruneNearbyFixtures(tmp) {
  if (!existsSync(tmp)) return;
  for (const name of readdirSync(tmp)) {
    if (!/^landing-nearby-\d+$/.test(name)) continue;
    const dir = join(tmp, name), link = join(dir, 'node_modules');
    let stat = null;
    try { stat = lstatSync(link); } catch { /* no link */ }
    if (stat) {
      if (!stat.isSymbolicLink()) throw new Error(`Refusing to prune ${dir}: node_modules is not a link`);
      // POSIX symlink: unlink. Windows junction: unlink fails (EPERM), rmdir removes the link.
      try { unlinkSync(link); } catch { rmdirSync(link); }
      let still = true;
      try { lstatSync(link); } catch { still = false; }
      if (still) throw new Error(`Refusing to prune ${dir}: link survived unlink`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
