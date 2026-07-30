/**
 * One-shot Toast credential probe (2026-07-31). Reads .env.local directly
 * (dotenv not installed), calls the auth endpoint exactly as lib/toast/client
 * does, and reports ONLY status — never a secret, never a token.
 * Run: npx tsx scripts/probe-toast-auth.ts
 */
import { readFileSync } from "node:fs";

const env = new Map<string, string>();
for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && m[1] && m[2] !== undefined) env.set(m[1], m[2].trim());
}

const hostname = env.get("TOAST_API_HOSTNAME") ?? "https://ws-api.toasttab.com";
const clientId = env.get("TOAST_CLIENT_ID");
const clientSecret = env.get("TOAST_CLIENT_SECRET");

async function main() {
  if (!clientId || !clientSecret) {
    console.log("RESULT: credentials NOT SET in .env.local");
    return;
  }
  console.log(`Probing ${hostname} ...`);
  const res = await fetch(`${hostname}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret, userAccessType: "TOAST_MACHINE_CLIENT" }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.log(`RESULT: AUTH FAILED — HTTP ${res.status}`);
    console.log(`Body (first 300 chars): ${text.slice(0, 300)}`);
    return;
  }
  const body = (await res.json()) as { token?: { accessToken?: string; expiresIn?: number; tokenType?: string } };
  const ok = Boolean(body.token?.accessToken) && Number.isFinite(body.token?.expiresIn);
  console.log(`RESULT: AUTH ${ok ? "SUCCESS" : "UNEXPECTED SHAPE"} — token received: ${ok}, expiresIn: ${body.token?.expiresIn ?? "?"}s`);
}

main().catch((e) => {
  console.log(`RESULT: NETWORK/ERROR — ${e instanceof Error ? e.message : String(e)}`);
});
