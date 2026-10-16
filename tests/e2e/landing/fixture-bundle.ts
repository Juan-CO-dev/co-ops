import { build, type Loader } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';

/** Resolve fixture imports through Node's permitted file reads. Native esbuild
 * directory discovery tries to enumerate the restricted workspace parent. */
export async function fixtureBundle(contents: string): Promise<string> {
  const root = process.cwd();
  const result = await build({
    absWorkingDir: root, stdin: { contents, loader: 'tsx', resolveDir: root },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'workspace-fixture-files', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const importer = isAbsolute(args.importer) ? args.importer : join(root, 'package.json');
        let target: string;
        if (args.path.startsWith('@/')) target = resolve(root, args.path.slice(2));
        else if (args.path.startsWith('.') || isAbsolute(args.path)) target = resolve(dirname(importer), args.path);
        else target = createRequire(importer).resolve(args.path);
        const file = ['', '.tsx', '.ts', '.js', '.json'].map(suffix => target + suffix).find(candidate => existsSync(candidate));
        if (!file) throw new Error(`Unresolved browser fixture import: ${args.path}`);
        return { path: file, namespace: 'fixture-file' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture-file' }, args => ({
        contents: readFileSync(args.path, 'utf8'),
        loader: ({ '.tsx':'tsx', '.ts':'ts', '.json':'json' } as Record<string, Loader>)[extname(args.path)] ?? 'js',
      }));
    }}],
  });
  return result.outputFiles![0]!.text;
}
