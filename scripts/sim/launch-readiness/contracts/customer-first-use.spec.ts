import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SIM_APP_ORIGIN } from "../../../../lib/sim-isolation-shared";
import { captureEmail } from "../../../../lib/sim-email";
import * as driver from "../../concurrency/driver.mjs";

export const CUSTOMER_A = "customer-a@sim.invalid", CUSTOMER_B = "customer-b@sim.invalid";
export const REQUEST = "/api/portal/magic-link/request", VERIFY = "/api/portal/magic-link/verify";
export const LINES = "/api/portal/order/draft/lines", SUBMIT = "/api/portal/order/draft/submit";
export const draftPath = (id: string) => `/api/portal/order/draft/${id}`;
export const payPath = (id: string) => `/api/portal/quote/${id}/pay`;
export type Mail = { to: string | string[]; subject: string; text: string; html: string; links: string[] };

// Only the parent's initialized SELECT-only oracle. No credentials, initialization or writes here.
export async function readRows<T>(table: string, columns: string, filters: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = driver.db.from(table).select(columns);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error } = await query.order("id").range(offset, offset + 499);
    assert(!error && Array.isArray(data), "customer.oracle-read");
    rows.push(...data as T[]);
    if (data.length < 500) return rows;
  }
}
export function mailDirectory(dir = process.env.LRA_MAIL_DIR, runId = process.env.LRA_RUN_ID): string {
  assert(dir && runId && /^[a-zA-Z0-9-]+$/.test(runId), "customer.private-mail-directory");
  const expected = resolve("scripts/sim/launch-readiness/.private", runId, "mail");
  assert.equal(resolve(dir), expected, "customer.private-mail-directory");
  return expected;
}
export async function mailFiles(dir = mailDirectory()) { return (await readdir(dir)).filter(name => /^\d+-[a-f0-9]{8}\.json$/.test(name)).sort(); }
export async function newMail(before: string[], email: string, dir = mailDirectory()): Promise<Mail[]> {
  const messages: Mail[] = [];
  for (const file of await mailFiles(dir)) {
    if (before.includes(file)) continue;
    const mail = JSON.parse(await readFile(resolve(dir, file), "utf8")) as Mail;
    if ((Array.isArray(mail.to) ? mail.to : [mail.to]).includes(email)) messages.push(mail);
  }
  return messages;
}
export async function capturedLink(before: string[], email: string, dir = mailDirectory()) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const mails = await newMail(before, email, dir);
    const links = mails.flatMap(mail => mail.links).filter(link => {
      try { const url = new URL(link); return url.origin === SIM_APP_ORIGIN && url.pathname === "/order/verify" && !!url.searchParams.get("token") && !url.username && !url.password; }
      catch { return false; }
    });
    if (links.length) { assert.equal(links.length, 1, "customer.one-captured-link"); return { link: links[0]!, mail: mails.find(mail => mail.links.includes(links[0]!))! }; }
    await delay(100);
  }
  throw new Error("customer.captured-link-missing");
}
export type Quote = { id: string; customer_id: string; pipeline_id: string; location_id: string; status: string; total_cents: number; subtotal_cents: number; deposit_cents: number };
export type Line = { item_id: string | null; menu_item_id: string | null; package_id: string | null; size_id: string | null; portion: string | null; quantity: number | string; unit_price_cents: number; line_total_cents: number };
export const customers = (email: string) => readRows<{ id: string }>("catering_customers", "id", { email });
export const quotes = (customerId: string, locationId?: string) => readRows<Quote>("catering_quotes", "id,customer_id,pipeline_id,location_id,status,total_cents,subtotal_cents,deposit_cents", { customer_id: customerId, ...(locationId ? { location_id: locationId } : {}) });
export const quoteLines = (id: string) => readRows<Line>("catering_quote_items", "item_id,menu_item_id,package_id,size_id,portion,quantity,unit_price_cents,line_total_cents", { quote_id: id });
export async function effects(quote: Quote) {
  const [ownedQuotes, pipeline, events, demand, payments] = await Promise.all([
    quotes(quote.customer_id, quote.location_id),
    readRows<{ id: string; stage: string; lead_source: string }>("catering_pipeline", "id,stage,lead_source", { customer_id: quote.customer_id, location_id: quote.location_id }),
    readRows<{ to_stage: string }>("catering_pipeline_events", "to_stage", { pipeline_id: quote.pipeline_id }),
    readRows<{ id: string }>("catering_prep_demand", "id", { quote_id: quote.id }),
    readRows<{ kind: string; status: string; amount_cents: number; provider: string | null; provider_ref: string | null; paid_at: string | null }>("catering_payments", "kind,status,amount_cents,provider,provider_ref,paid_at", { quote_id: quote.id }),
  ]);
  return { ownedQuotes, pipeline, events, demand, payments };
}

async function call(path: string, body: unknown) {
  const res = await fetch(`${SIM_APP_ORIGIN}${path}`, { method: "POST", headers: { Origin: SIM_APP_ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(15_000) });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}
const constant = async (email: string, intake?: unknown) => {
  assert.deepEqual(await call(REQUEST, { email, name: "Synthetic Customer", intake }), { status: 200, json: { ok: true } }, "customer.link.constant-shape");
};

/** Resolve the current build's action ID by export AND worker, never a copied build hash. */
export async function deliveryActionId() {
  const manifest = JSON.parse(await readFile(resolve(".next-sim-launch/server/server-reference-manifest.json"), "utf8")) as {
    node: Record<string, { exportedName?: string; workers: Record<string, { exportedName?: string; filename?: string }> }>;
  };
  const entries = Object.entries(manifest.node).filter(([, action]) => {
    const worker = action.workers["app/order/start/page"];
    return worker?.filename === "app/order/start/actions.ts" && (worker.exportedName ?? action.exportedName) === "routeDeliveryAction";
  });
  assert.equal(entries.length, 1, "customer.delivery.action-identity");
  return entries[0]![0];
}

export async function runCustomerContracts(controls: Record<string, string | undefined>) {
  const dir = mailDirectory(controls.LRA_MAIL_DIR, controls.LRA_RUN_ID);
  const results: { id: string; assertionIds: string[]; status: "passed" | "failed"; failedAssertionIds: string[]; findingIds: string[]; observations: Record<string, number | boolean | string> }[] = [];
  const check = async (id: string, findingIds: string[], fn: (observation: Record<string, number | boolean | string>) => Promise<void>) => {
    const result = { id, assertionIds: [id], status: "passed" as "passed" | "failed", failedAssertionIds: [] as string[], findingIds: [] as string[], observations: {} };
    results.push(result);
    try { await fn(result.observations); }
    catch { result.status = "failed"; result.failedAssertionIds.push(id); if ((result.observations as Record<string, unknown>).reproduced === true) result.findingIds.push(...findingIds); }
  };
  await check("customer.link.latest-wins", [], async () => {
    assert.deepEqual(await customers(CUSTOMER_A), []);
    const before = await mailFiles(dir); await constant(CUSTOMER_A);
    const first = await capturedLink(before, CUSTOMER_A, dir);
    const middle = await mailFiles(dir); await constant(CUSTOMER_A);
    await capturedLink(middle, CUSTOMER_A, dir);
    assert.deepEqual(await call(VERIFY, { token: new URL(first.link).searchParams.get("token") }), { status: 400, json: { ok: false } });
    assert.deepEqual(await customers(CUSTOMER_A), []);
  });
  await check("customer.link.throttle", [], async observations => {
    // Count actual preceding requests, including a partially failed latest-wins test.
    const buckets = await readRows<{ bucket_key: string; count: number; window_start: string }>("catering_portal_rate_limits", "bucket_key,count,window_start", { bucket_key: `magic_link_email:${CUSTOMER_A}` });
    const window = Math.floor(Date.now() / 900_000);
    const current = buckets.find(row => Math.floor(Date.parse(row.window_start) / 900_000) === window);
    const count = current?.count ?? 0; assert(count <= 5);
    for (let n = count; n < 5; n++) await constant(CUSTOMER_A);
    const before = await mailFiles(dir); await constant(CUSTOMER_A);
    assert.equal(Math.floor(Date.now() / 900_000), window, "customer.throttle-window-rolled-over");
    assert.deepEqual(await mailFiles(dir), before);
    let audited = false;
    for (let n = 0; n < 30 && !audited; n++) {
      const rows = await readRows<{ metadata: { email?: string } }>("audit_log", "metadata", { action: "portal.magic_link_throttled" });
      audited = rows.some(row => row.metadata.email === CUSTOMER_A); if (!audited) await delay(100);
    }
    assert(audited, "customer.throttle-audit-readback"); observations.requestOrdinal = 6; observations.audited = audited;
  });
  await check("customer.link.foreign-refused", [], async observations => {
    const before = await mailFiles(dir);
    await constant("foreign@sim.invalid");
    assert.deepEqual(await mailFiles(dir), before);
    // App allowlist intentionally skips sendEmail. Exercise the seam refusal separately.
    const oldMode = process.env.SIM_MODE, oldDir = process.env.SIM_EMAIL_CAPTURE_DIR;
    try {
      process.env.SIM_MODE = "1"; process.env.SIM_EMAIL_CAPTURE_DIR = dir;
      assert.deepEqual(await captureEmail({ to: "foreign@sim.invalid", subject: "Synthetic refusal", text: "Synthetic", html: "<p>Synthetic</p>" }), { error: "sim_recipient_refused" });
    } finally {
      if (oldMode === undefined) delete process.env.SIM_MODE; else process.env.SIM_MODE = oldMode;
      if (oldDir === undefined) delete process.env.SIM_EMAIL_CAPTURE_DIR; else process.env.SIM_EMAIL_CAPTURE_DIR = oldDir;
    }
    assert.deepEqual(await mailFiles(dir), before); observations.appAllowlistSkipped = true; observations.seamRefused = true;
  });
  await check("customer.intake.failure-visible", ["LRA-006"], async observations => {
    const locationId = "00000000-0000-4000-8000-000000000000";
    assert.deepEqual(await readRows("locations", "id", { id: locationId }), []);
    const before = await mailFiles(dir);
    await constant(CUSTOMER_B, { locationId, contactName: "Synthetic Customer B", isDelivery: false, headcount: 20 });
    const { link } = await capturedLink(before, CUSTOMER_B, dir);
    const verified = await call(VERIFY, { token: new URL(link).searchParams.get("token") });
    const customer = await customers(CUSTOMER_B); assert.equal(customer.length, 1);
    assert.deepEqual(await quotes(customer[0]!.id), []);
    observations.injectionConsumed = true; observations.silentAccountRedirect = verified.json.ok === true && verified.json.next === "/order/account";
    observations.reproduced = observations.silentAccountRedirect;
    assert.equal(observations.silentAccountRedirect, false, "LRA-006 draft creation failed but sign-in claimed success");
  });
  await check("customer.delivery.throttle", ["LRA-053"], async observations => {
    const action = await deliveryActionId(); let routed = 0, throttled = 0;
    for (let n = 0; n < 12; n++) {
      const res = await fetch(`${SIM_APP_ORIGIN}/order/start`, { method: "POST", headers: { Origin: SIM_APP_ORIGIN, "Content-Type": "text/plain;charset=UTF-8", "Next-Action": action, Accept: "text/x-component" }, body: JSON.stringify([{ lat: 38.9, lng: -77.03, eventDate: null, headcount: 20 }]), redirect: "manual", signal: AbortSignal.timeout(15_000) });
      const flight = await res.text();
      if (res.status === 429 || /"status":"throttled"/.test(flight)) throttled++;
      else { assert.equal(res.status, 200); assert(/"status":"(?:routed|out_of_zone|no_capacity)"/.test(flight), "customer.delivery.real-action-result"); routed++; }
    }
    observations.requests = 12; observations.routingResults = routed; observations.throttled = throttled; observations.reproduced = throttled === 0;
    assert(throttled > 0, "LRA-053 twelve anonymous routing calls without throttle");
  });
  return results;
}
