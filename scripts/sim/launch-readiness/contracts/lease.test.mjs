import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostname } from "node:os";
import { acquire, release, assertHeld, classifyOwner } from "../lease.mjs";

const moduleUrl = new URL("../lease.mjs", import.meta.url).href;
function temporary(t) {
  const root = resolve("scripts/sim/launch-readiness/.private/lease-test");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function child(source, dir) {
  const proc = spawn(process.execPath, ["--input-type=module", "-e", source], {
    env: { ...process.env, LRA_LEASE_DIR: dir }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  proc.stdout.on("data", chunk => { output += chunk; });
  proc.stderr.on("data", chunk => { output += chunk; });
  const done = new Promise((resolveDone, reject) => {
    proc.once("error", reject);
    proc.once("close", (code, signal) => resolveDone({ code, signal, output }));
  });
  return { proc, done, get output() { return output; } };
}
function line(proc) {
  return new Promise((resolveLine, reject) => {
    proc.stdout.once("data", data => resolveLine(String(data)));
    proc.once("error", reject);
    proc.once("exit", code => reject(new Error(`child exited before ready: ${code}`)));
  });
}

test("two simultaneous contenders: one acquires; loser cannot touch guarded file", { timeout: 15000 }, async t => {
  const root = temporary(t), dir = join(root, "lease"), guarded = join(root, "guarded");
  const children = ["first", "second"].map(runId => child(`
    import { acquire, release } from ${JSON.stringify(moduleUrl)};
    import { appendFileSync } from 'node:fs';
    console.log('ready');
    process.stdin.once('data', () => {
      try { acquire({ runId: ${JSON.stringify(runId)} }); }
      catch (e) { console.error(e.message); process.exit(2); }
      appendFileSync(${JSON.stringify(guarded)}, ${JSON.stringify(runId + "\n")});
      console.log('acquired');
      process.stdin.once('data', () => { release(${JSON.stringify(runId)}); process.exit(0); });
    });`, dir));
  t.after(() => children.forEach(({ proc }) => proc.kill()));
  await Promise.all(children.map(({ proc }) => line(proc)));
  const acquired = Promise.race(children.map(({ proc }) => new Promise(resolveAcquired => {
    proc.stdout.on("data", chunk => { if (String(chunk).includes("acquired")) resolveAcquired(); });
  })));
  children.forEach(({ proc }) => proc.stdin.write("go\n"));
  const loser = await Promise.race(children.map(c => c.done));
  await acquired;
  assert.equal(loser.code, 2);
  assert.match(loser.output, /Lease refused: owned by/);
  const owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"));
  assert.equal(readFileSync(guarded, "utf8"), `${owner.runId}\n`);
  children.forEach(({ proc }) => { if (proc.exitCode === null) proc.stdin.write("release\n"); });
  const results = await Promise.all(children.map(c => c.done));
  assert.deepEqual(results.map(r => r.code).sort(), [0, 2]);
  assert.equal(existsSync(dir), false);
});

test("wrong-owner release and assertion refuse while preserving the owner", t => {
  const dir = join(temporary(t), "lease");
  acquire({ runId: "owner", dir });
  assert.throws(() => release("wrong", { dir }), /owned by owner/);
  assert.throws(() => assertHeld("wrong", { dir }), /owned by owner/);
  assert.equal(assertHeld("owner", { dir }).pid, process.pid);
  release("owner", { dir });
  assert.throws(() => assertHeld("owner", { dir }), /Lease refused/);
});

test("dead PID is cleared with the required notice", { timeout: 10000 }, async t => {
  const dir = join(temporary(t), "lease");
  const dead = child("process.exit(0)", dir);
  await dead.done;
  mkdirSync(dir);
  writeFileSync(join(dir, "owner.json"), JSON.stringify({
    pid: dead.proc.pid, startedAt: new Date().toISOString(), runId: "dead-run", host: hostname(),
  }));
  const notices = [];
  acquire({ runId: "recovery", dir, log: notice => notices.push(notice) });
  assert.deepEqual(notices, ["clearing stale lease from dead-run"]);
  assert.equal(assertHeld("recovery", { dir }).runId, "recovery");
  release("recovery", { dir });
});

test("interrupted owner leaves its directory until recovery", { timeout: 10000 }, async t => {
  const dir = join(temporary(t), "lease");
  const owner = child(`import { acquire } from ${JSON.stringify(moduleUrl)};
    acquire({runId:'interrupted'}); console.log('ready'); process.stdin.resume();`, dir);
  t.after(() => owner.proc.kill());
  await line(owner.proc);
  assert.equal(assertHeld("interrupted", { dir }).pid, owner.proc.pid);
  owner.proc.kill("SIGKILL");
  await owner.done;
  assert.equal(existsSync(dir), true);
  const notices = [];
  acquire({ runId: "recovered", dir, log: notice => notices.push(notice) });
  assert.deepEqual(notices, ["clearing stale lease from interrupted"]);
  release("recovered", { dir });
});

test("missing or malformed owner record fails closed; pure classification validates host and PID", t => {
  const dir = join(temporary(t), "lease");
  mkdirSync(dir);
  assert.throws(() => acquire({ runId: "no-owner", dir }), /owner record incomplete/);
  writeFileSync(join(dir, "owner.json"), "{");
  assert.throws(() => acquire({ runId: "bad-owner", dir }), /owner record incomplete/);
  assert.equal(classifyOwner({ pid: -1 }, () => false), "unknown");
  const owner = { pid: 123, startedAt: new Date().toISOString(), runId: "run", host: "host" };
  assert.equal(classifyOwner(owner, () => false, "host"), "stale");
  assert.equal(classifyOwner(owner, () => true, "host"), "held");
  assert.equal(classifyOwner(owner, () => false, "other-host"), "unknown");
});
