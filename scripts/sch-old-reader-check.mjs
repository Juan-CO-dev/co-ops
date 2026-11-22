#!/usr/bin/env node
/**
 * PR SCH (plan r5 20.9, ruling D9) — the OLD-READER CHECK. DEV ONLY: offline, no database, no network, writes nothing in the
 * repo (a temp directory, removed at the end).
 *
 * The question: if SCH-1 were reverted, could the pre-SCH code read what SCH wrote? It builds three POST-SCH snapshot
 * fixtures with the CURRENT code (scripts/sch-old-reader/new-snapshots.ts), extracts the PRE-SCH `lib` (the merge base, by
 * `git archive`) into a temp directory, and runs the OLD snapshot decoder, `checkScheduleRules` replay, `referenceStructureOf`
 * and `structureDeltaHours` over them (scripts/sch-old-reader/old-replay.ts, run there so `@/lib` is the old code):
 *   (a) stations, heavy and opened;  (b) crew, crewShift off, opened;  (c) crew, crewShift on, a day heavy only by total.
 * EXPECTED (plan 20.9): (a) and (b) replay identically — the old code reads the stored structure and need; (c) differs —
 * the old per-order `crewRequired` asks for fewer seats (why a revert needs no shop to have crewShift enabled); and the old
 * `referenceStructureOf` returns a heavy or opened day's DERIVED structure, which skews the budget's structure delta (its
 * size is printed).
 *
 * GATED (lead ruling H3, SCH-1 code review r1), each a FAIL line and counted: per case, (1) the old/new replay verdict above;
 * (2) the NEW replay equals the problems the generator recorded; (3) the NEW budget reference restores the base (its digest is
 * the date's `baseStructureOf`). INFO only, never counted: which structure the OLD reference returns, and the two budget
 * structure deltas (measurements, not expectations).
 *
 *   node scripts/sch-old-reader-check.mjs [pre-SCH base, default: git merge-base origin/main HEAD]
 * Exit 0 when every gated check holds, 1 otherwise (a failed step also exits non-zero).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const base = process.argv[2] ?? execFileSync("git", ["merge-base", "origin/main", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const tmp = mkdtempSync(join(tmpdir(), "sch-old-reader-"));
const tsx = join(repo, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const run = (args, opts) => {
  const r = spawnSync(tsx, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`tsx ${args.join(" ")} exited ${r.status}`);
};
const canonical = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`);

try {
  // 1. The post-SCH snapshots, with the current code.
  const snapshots = join(tmp, "snapshots.json");
  run([join(repo, "scripts", "sch-old-reader", "new-snapshots.ts"), snapshots], { cwd: repo });
  // 2. The pre-SCH lib, extracted from the base.
  const old = join(tmp, "old");
  execFileSync("git", ["archive", "--format=tar", `--output=${join(tmp, "old.tar")}`, base, "lib"], { cwd: repo });
  mkdirSync(old);
  // Relative paths with a cwd: GNU tar on Windows reads "C:\..." as a remote host.
  execFileSync("tar", ["-xf", "../old.tar"], { cwd: old });
  writeFileSync(join(old, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, target: "ES2022", strict: true } }));
  writeFileSync(join(old, "package.json"), JSON.stringify({ type: "module" }));
  cpSync(join(repo, "scripts", "sch-old-reader", "old-replay.ts"), join(old, "old-replay.ts"));
  // 3. The old readers over the new snapshots.
  const result = join(tmp, "old.json");
  run([join(old, "old-replay.ts"), snapshots, result], { cwd: old, env: { ...process.env, TSX_TSCONFIG_PATH: join(old, "tsconfig.json") } });
  const news = JSON.parse(readFileSync(snapshots, "utf8"));
  const olds = JSON.parse(readFileSync(result, "utf8"));
  let failed = 0;
  /** One gated check: a PASS / FAIL line, a FAIL counted. */
  const gate = (ok, text) => {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  };
  console.log(`SCH old-reader check — pre-SCH base ${base}\n`);
  if (olds.length !== news.length) gate(false, `the old replay returned ${olds.length} case(s) for ${news.length} snapshot(s)`);
  news.forEach((n, i) => {
    const o = olds[i] ?? { oldReplay: null, oldRefDigest: null, oldDelta: null };
    const same = canonical(o.oldReplay) === canonical(n.newReplay);
    const expectSame = !n.name.startsWith("(c)");
    const extra = (a, b) => (a ?? []).filter((p) => !(b ?? []).some((q) => canonical(q) === canonical(p))).map((p) => `${p.code}@${p.day}${p.q === undefined ? "" : `:${p.q}`}`);
    console.log(n.name);
    gate(same === expectSame, `replay: old ${same ? "IDENTICAL to" : "DIFFERS from"} new (expected ${expectSame ? "identical" : "a difference"})`);
    if (!same) console.log(`        only old: ${extra(o.oldReplay, n.newReplay).join(", ") || "-"} | only new: ${extra(n.newReplay, o.oldReplay).join(", ") || "-"}`);
    gate(canonical(n.newReplay) === canonical(n.recorded), "new replay = the problems the generator recorded");
    gate(n.newRefDigest === n.liveDigest, `budget reference on ${n.refDate}: the new reference restores the base (digest ${n.newRefDigest} vs base ${n.liveDigest})`);
    console.log(`  INFO  old budget reference = ${o.oldRefDigest === n.liveDigest ? "the base" : "the DERIVED day structure"}`);
    console.log(`  INFO  budget structure delta: new ${n.newDelta} h, old ${o.oldDelta} h\n`);
  });
  console.log(failed === 0 ? "OK: every gated check holds." : `${failed} gated check(s) FAILED.`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
