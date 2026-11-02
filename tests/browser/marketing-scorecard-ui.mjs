/** Isolated scorecard geometry with the real Tailwind stylesheet. No app server or credentials. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
// Optional module path lets a dedicated clone use the already-installed local browser harness.
const { chromium } = createRequire(import.meta.url)(process.argv[2] ?? "@playwright/test");

const root = process.cwd();
const bundled = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import ScorecardClient from "./app/admin/marketing/ScorecardClient";
    import { TranslationProvider } from "./lib/i18n/provider";
    import { data } from "./tests/fixtures/marketing-scorecard";
    export function render(language) { return renderToStaticMarkup(<TranslationProvider initialLanguage={language}><main className="min-w-0 p-4"><ScorecardClient data={data} lang={language}/></main></TranslationProvider>); }
  ` },
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "sandbox-files", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const request = args.path.startsWith("@/") ? path.join(root, args.path.slice(2)) : args.path;
      if (["util", "stream", "crypto", "async_hooks"].includes(request) || request.startsWith("node:")) return { path: request, external: true };
      const require = createRequire(path.join(args.resolveDir || root, "fixture-resolver.cjs"));
      for (const candidate of [request, `${request}.ts`, `${request}.tsx`]) {
        try { return { path: require.resolve(candidate), namespace: "local" }; } catch { /* Try TS extensions. */ }
      }
      throw new Error(`Cannot resolve fixture import ${request}`);
    });
    builder.onLoad({ filter: /.*/, namespace: "local" }, async args => ({ contents: await readFile(args.path, "utf8"),
      loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : args.path.endsWith(".json") ? "json" : "js", resolveDir: path.dirname(args.path) }));
  } }],
});
await mkdir("tmp", { recursive: true });
const renderPath = path.join(root, "tmp/marketing-browser-render.cjs");
await writeFile(renderPath, bundled.outputFiles[0].text);
const { render } = createRequire(import.meta.url)(renderPath);
const css = await postcss([tailwind({ base: root })]).process(await readFile("app/globals.css", "utf8"), { from: path.join(root, "app/globals.css") });
const browser = await chromium.launch({ headless: true, timeout: 15000 });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  for (const language of ["en", "es"]) {
    await page.setContent(`<!doctype html><html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body>${render(language)}</body></html>`);
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll("button")].map(b => ({ width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })),
    }));
    assert.equal(geometry.scroll, 375, `${language}: page overflow`);
    assert.ok(geometry.controls.length >= 2);
    for (const b of geometry.controls) assert.ok(b.width >= 44 && b.height >= 44, `${language}: small control ${JSON.stringify(b)}`);
    console.log(`${language}: 375px, scroll=${geometry.scroll}px, ${geometry.controls.length} controls >=44px; marketing scorecard fits`);
  }
} finally { await browser.close(); }
