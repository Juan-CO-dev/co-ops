/**
 * Toast API client (read-track 1). SERVER-ONLY — OAuth2 client-credentials per
 * Toast's auth docs, module-scope token cache with a proactive expiry buffer,
 * one silent re-auth on 401, and FIXTURE MODE so everything upstream builds,
 * tests, and demos before credentials exist.
 *
 * Env (documented in .env.local.example; values never logged):
 *   TOAST_API_HOSTNAME (default https://ws-api.toasttab.com)
 *   TOAST_CLIENT_ID / TOAST_CLIENT_SECRET
 * Fixture mode: active when !toastConfigured() OR TOAST_FIXTURES=1 — toastGet
 * resolves from tests/fixtures/toast/<key>.json via resolveFixtureKey.
 *
 * Error doctrine: typed ToastApiError only; callers degrade to advisory UI
 * states. No retry storms — actions are on-demand; exactly one re-auth on 401.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { tokenIsFresh, resolveFixtureKey } from "./client-shared";

export class ToastApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "ToastApiError";
  }
}

function hostname(): string {
  return process.env.TOAST_API_HOSTNAME ?? "https://ws-api.toasttab.com";
}

export function toastConfigured(): boolean {
  return Boolean(process.env.TOAST_CLIENT_ID && process.env.TOAST_CLIENT_SECRET);
}

function fixtureMode(): boolean {
  return !toastConfigured() || process.env.TOAST_FIXTURES === "1";
}

// Module-scope token cache (per server instance; Toast tokens are short-lived).
let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

async function getToastToken(force = false): Promise<string> {
  if (!force && cachedToken && tokenIsFresh(cachedToken.expiresAtMs, Date.now())) {
    return cachedToken.accessToken;
  }
  const res = await fetch(`${hostname()}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ToastApiError(res.status, "auth_failed", `Toast auth failed (${res.status})`);
  }
  const body = (await res.json()) as { token?: { accessToken?: string; expiresIn?: number } };
  const accessToken = body.token?.accessToken;
  const expiresIn = body.token?.expiresIn;
  if (!accessToken || !Number.isFinite(expiresIn)) {
    throw new ToastApiError(502, "bad_payload", "Toast auth returned an unexpected shape");
  }
  cachedToken = { accessToken, expiresAtMs: Date.now() + (expiresIn as number) * 1000 };
  return accessToken;
}

async function readFixture(key: string): Promise<unknown> {
  const p = path.join(process.cwd(), "tests", "fixtures", "toast", `${key}.json`);
  try {
    return JSON.parse(await readFile(p, "utf-8")) as unknown;
  } catch {
    throw new ToastApiError(500, "bad_payload", `Toast fixture missing/unreadable: ${key}`);
  }
}

/** GET a Toast API path scoped to one restaurant. Fixture-mode aware. */
export async function toastGet<T>(apiPath: string, restaurantGuid: string): Promise<T> {
  if (fixtureMode()) {
    const key = resolveFixtureKey(apiPath);
    if (!key) throw new ToastApiError(500, "not_configured", `No fixture for ${apiPath}`);
    return (await readFixture(key)) as T;
  }
  if (!restaurantGuid) throw new ToastApiError(400, "not_configured", "Location has no Toast restaurant GUID");

  const call = async (token: string) =>
    fetch(`${hostname()}${apiPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Toast-Restaurant-External-ID": restaurantGuid,
      },
      cache: "no-store",
    });

  let res = await call(await getToastToken());
  if (res.status === 401) {
    res = await call(await getToastToken(true)); // one silent re-auth, then fail typed
  }
  if (res.status === 429) throw new ToastApiError(429, "rate_limited", "Toast rate limit — try again shortly");
  if (!res.ok) throw new ToastApiError(res.status, `http_${res.status}`, `Toast GET ${apiPath} failed`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ToastApiError(502, "bad_payload", `Toast GET ${apiPath}: non-JSON body`);
  }
}
