/** Local component smoke: no credentials, food assets, app server or production access.
 * Native playback methods are instrumented; decoding and Safari seeking remain preview gates.
 * Run: node tests/browser/training-video-ui.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { chromium, webkit } from "@playwright/test";

const fixture = await build({
  stdin: {
    resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {LearnTheBuild} from "./components/training/LearnTheBuild";
      import {TranslationProvider} from "./lib/i18n/provider";
      const step = {n:1,key:"one",action:"First step",label:"First step",ingredient:null,amount:null,drawn:false};
      createRoot(document.getElementById("root")).render(
        <TranslationProvider initialLanguage="en"><LearnTheBuild item="Fixture" steps={{en:[step],es:[{...step,label:"Primer paso"}]}} /></TranslationProvider>
      );`,
  },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "held-scene", setup(builder) {
    builder.onResolve({ filter: /co-scenes-shared$/ }, () => ({ path: "fixture-scene", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export const CO_SCENES_DATA_URL="/fixture-data.json";
      export const CO_SCENES_VIDEO={src:"/fixture.mp4",poster:"/fixture.svg"};
      const mod = {
        defineTrainingElement() {
          if (customElements.get("crunchy-build")) return;
          customElements.define("crunchy-build", class extends HTMLElement {
            connectedCallback(){ this.innerHTML="<button>Scene control</button>"; }
            ready(){ return new Promise(resolve => window.sceneResolves.push(resolve)); }
            setStep(){}
          });
        },
        trainingSceneFactory(){return ()=>null;}
      };
      export function loadCoScenesTraining(){
        return new Promise(resolve => window.importResolves.push(()=>resolve(mod)));
      }
    ` }));
  } }, { name: "sandbox-files", setup(builder) {
    // Resolve/read via Node: Windows sandbox permits these file reads but can
    // deny esbuild's native parent-directory traversal.
    builder.onResolve({ filter: /.*/ }, args => {
      const request = args.path.startsWith("@/") ? path.join(process.cwd(), args.path.slice(2)) : args.path;
      const require = createRequire(path.join(args.resolveDir || process.cwd(), "fixture-resolver.cjs"));
      for (const candidate of [request, `${request}.ts`, `${request}.tsx`]) {
        try { return { path: require.resolve(candidate), namespace: "local" }; } catch { /* Try TS extensions. */ }
      }
      throw new Error(`Cannot resolve fixture import ${request}`);
    });
    builder.onLoad({ filter: /.*/, namespace: "local" }, async args => ({
      contents: await readFile(args.path, "utf8"),
      loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : args.path.endsWith(".json") ? "json" : "js",
      resolveDir: path.dirname(args.path),
    }));
  } }],
});
const js = fixture.outputFiles[0].text;
console.log("Training UI fixture bundled");
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
  if (req.url === "/fixture.mp4") return; // Held media: exercises the initial poster state.
  if (req.url === "/fixture.svg") { res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="128"><rect width="72" height="128" fill="black"/></svg>'); return; }
  res.setHeader("Content-Type", "text/html");
  res.end('<div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}`;
try {
  for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
    const browser = await engine.launch({ headless: true, timeout: 15000 });
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      page.setDefaultTimeout(10000);
      await page.addInitScript(() => {
        window.importResolves=[]; window.sceneResolves=[]; window.playCount=0; window.pauseCount=0;
        HTMLMediaElement.prototype.play=function(){window.playCount++;return Promise.resolve();};
        HTMLMediaElement.prototype.pause=function(){window.pauseCount++;};
      });
      await page.route("**/api/users/me/language", route => route.fulfill({ status:200, contentType:"application/json", body:"{}" }));
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const video = page.locator("video");
      await video.waitFor();
      assert.equal(await video.getAttribute("playsinline"), "");
      assert.equal(await video.evaluate(el => el.muted), true);
      assert.equal(await video.getAttribute("controls"), "");
      assert.equal(await video.getAttribute("autoplay"), null);
      assert.equal(await video.getAttribute("src"), "/fixture.mp4");
      assert.equal(await video.getAttribute("poster"), "/fixture.svg");
      assert.equal(await page.getByRole("status").textContent(), "Loading the build video…");
      assert.equal(await page.evaluate(() => window.playCount), 0);
      await video.dispatchEvent("loadeddata");
      await page.getByRole("status").waitFor({state:"detached"});
      assert.equal(await page.getByRole("status").count(), 0);
      await page.evaluate(() => window.importResolves.shift()());
      await page.locator("crunchy-build").waitFor({ state:"attached" });
      assert.equal(await page.locator("crunchy-build").evaluate(el => el.parentElement.inert), true);
      await page.locator("crunchy-build button").evaluate(el => el.focus());
      assert.equal(await page.evaluate(() => document.activeElement?.textContent === "Scene control"), false);
      assert.equal(await video.count(), 1);
      const before = await page.evaluate(() => window.pauseCount);
      await page.evaluate(() => window.sceneResolves.shift()({status:"ready"}));
      await video.waitFor({state:"detached"});
      assert.ok(await page.evaluate(() => window.pauseCount) > before);
      assert.equal(await page.locator("crunchy-build").evaluate(el => el.parentElement.inert), false);

      await page.getByRole("radio", {name:"Select language: Español"}).click();
      await video.waitFor();
      assert.equal(await video.getAttribute("aria-label"), "Video del armado: Fixture");
      await page.evaluate(() => window.importResolves.shift()());
      await page.waitForFunction(() => window.sceneResolves.length === 1);
      await page.evaluate(() => window.sceneResolves.shift()({status:"failed",error:"fixture"}));
      await page.locator("crunchy-build").waitFor({state:"detached"});
      assert.equal(await video.count(), 1);
      await video.dispatchEvent("error");
      await video.waitFor({state:"detached"});
      assert.ok(await page.getByText("1. Primer paso", {exact:true}).isVisible());

      await page.emulateMedia({ reducedMotion:"no-preference" });
      await page.reload({waitUntil:"domcontentloaded"});
      await page.waitForFunction(() => window.playCount === 1);
      // A stale ready result from en cannot replace a fresh es mount.
      await page.evaluate(() => window.importResolves.shift()());
      await page.waitForFunction(() => window.sceneResolves.length === 1);
      await page.getByRole("radio", {name:"Select language: Español"}).click();
      await page.waitForFunction(() => document.querySelector("video")?.getAttribute("aria-label") === "Video del armado: Fixture");
      await page.evaluate(() => window.sceneResolves.shift()({status:"ready"}));
      assert.equal(await video.count(), 1);
      console.log(`${name}: first render, reduced motion, ready swap/pause, inert focus, language remount, stale ready, scene failure, video failure passed`);
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
