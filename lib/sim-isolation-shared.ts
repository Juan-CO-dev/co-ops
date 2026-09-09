/** Pure, fixed-target policy. No process.env, filesystem, or server imports. */
export const SIM_PROJECT_REF = "jepgzucrvklhqpthowsc";
export const SIM_APP_ORIGIN = "http://localhost:3100";
const DB_ORIGIN = `https://${SIM_PROJECT_REF}.supabase.co`;
export const SIM_PORTAL_ALLOWLIST = "customer-a@sim.invalid,customer-b@sim.invalid";

export type SimTarget = {
  appOrigin: string;
  dbOrigin: string;
  storageOrigin: string;
  policyVersion: "f1-v1";
};
type Env = Record<string, string | undefined>;
type Validation = { ok: true } | { ok: false; reasons: string[] };

function parsedUrl(value: string): URL | undefined {
  // Do not let URL's forgiving whitespace/backslash normalization hide input.
  if (/[\s\\]/.test(value) || value.startsWith("//")) return;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hostname.endsWith(".")) return;
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    // Also reject empty userinfo, which URL.username cannot distinguish.
    if (/^https?:\/\/[^/]*@/i.test(value)) return;
    return url;
  } catch { return; }
}

function isOrigin(value: string | undefined, expected: string): boolean {
  if (!value || /[?#]/.test(value)) return false;
  const url = parsedUrl(value);
  return !!url && url.origin === expected && url.pathname === "/" &&
    /^https?:\/\/[^/]+\/?$/i.test(value);
}

export function assertSimTarget(url: string | undefined): void {
  if (!isOrigin(url, DB_ORIGIN)) throw new Error("NEXT_PUBLIC_SUPABASE_URL: invalid sim target");
}

export function parseAllowedTarget(env: Env): { ok: true; target: SimTarget } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!isOrigin(env.NEXT_PUBLIC_SUPABASE_URL, DB_ORIGIN)) reasons.push("NEXT_PUBLIC_SUPABASE_URL: invalid sim origin");
  if (env.NEXT_PUBLIC_APP_URL !== undefined && !isOrigin(env.NEXT_PUBLIC_APP_URL, SIM_APP_ORIGIN)) reasons.push("NEXT_PUBLIC_APP_URL: invalid sim origin");
  return reasons.length ? { ok: false, reasons } : {
    ok: true, target: { appOrigin: SIM_APP_ORIGIN, dbOrigin: DB_ORIGIN, storageOrigin: DB_ORIGIN, policyVersion: "f1-v1" },
  };
}

export function isAllowedRequestUrl(value: string, target: SimTarget, phase: "build" | "runtime"): boolean {
  // A forged/stale target cannot widen the fixed policy.
  if (target.appOrigin !== SIM_APP_ORIGIN || target.dbOrigin !== DB_ORIGIN || target.storageOrigin !== DB_ORIGIN) return false;
  if (value.startsWith("//") || /[\s\\]/.test(value)) return false;
  let absolute = value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try { absolute = new URL(value, SIM_APP_ORIGIN).href; } catch { return false; }
  }
  const url = parsedUrl(absolute);
  if (!url) return false;
  if (url.origin === SIM_APP_ORIGIN) return true;
  if (url.origin === DB_ORIGIN) {
    // Custom JWT auth: the app does not use Supabase Auth endpoints.
    return url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/storage/v1/");
  }
  // CC's documented exception: next/font downloads only, never runtime.
  return phase === "build" && (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com");
}

/** Keys that reach an EXTERNAL provider. Must be empty in sim (a blank key disables the leg).
 * CRON_SECRET / CATERING_SCAN_SECRET / EMAIL_FROM* are deliberately NOT here (CC review 2026-09-09):
 * they are sim-local values that gate our own routes or label our own mail; with RESEND_API_KEY empty
 * nothing leaves the box, and the journeys need the cron routes callable. */
export const PROVIDER_KEYS_CLOSED_INVENTORY = [
  "RESEND_API_KEY", "RESEND_INBOUND_SECRET",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_WEBHOOK_URL",
  "ANTHROPIC_API_KEY", "TOAST_API_HOSTNAME", "TOAST_CLIENT_ID", "TOAST_CLIENT_SECRET",
  "SEVENSHIFTS_API_KEY", "EZCATER_API_HOSTNAME", "EZCATER_API_TOKEN", "EZCATER_WEBHOOK_SECRET",
] as const;

/** JWT is an additional either/or requirement, validated separately below. */
export const REQUIRED_SIM_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_PIN_PEPPER", "AUTH_PASSWORD_PEPPER", "NEXT_PUBLIC_STOREFRONT_LOCATION_ID",
] as const;
export const ALLOWED_PREFERENCE_KEYS = [
  "NEXT_PUBLIC_TENANT_NAME", "ADMIN_STEP_UP_FRESH_SECONDS", "SESSION_IDLE_MINUTES", "SELF_EDIT_WINDOW_HOURS",
  // sim-local secrets for OUR routes (cron + pinger auth) and our own mail labels — see the inventory note above
  "CRON_SECRET", "CATERING_SCAN_SECRET", "EMAIL_FROM", "EMAIL_FROM_TEAM",
] as const;
const OPTIONAL_KEYS = ["AUTH_JWT_SECRET", "SIM_LEGACY_JWT_SECRET", "NEXT_PUBLIC_APP_URL", "PORTAL_MAGIC_LINK_ALLOWLIST", "TOAST_ENABLED", "TWILIO_ENABLED"];
/** Runner-owned sim credentials (the seed's deliberately-public sim PINs). Recognised in `.env.sim`
 * so the file validates, but NEVER passed to the app child — the F4 runner lifts them into its
 * private process env for the real-UI login specs. */
export const RUNNER_PRIVATE_KEYS = ["SIM_PIN_MARCUS", "SIM_PIN_ROSA", "SIM_PIN_ANGEL"] as const;
const knownKeys = new Set<string>([...REQUIRED_SIM_KEYS, ...ALLOWED_PREFERENCE_KEYS, ...PROVIDER_KEYS_CLOSED_INVENTORY, ...OPTIONAL_KEYS, ...RUNNER_PRIVATE_KEYS]);

function legacyHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateSimEnvFile(parsed: Record<string, string>): Validation {
  const reasons: string[] = [];
  for (const key of Object.keys(parsed)) {
    // Never echo a malformed key that could actually be a pasted value.
    if (!knownKeys.has(key)) reasons.push(`${/^[A-Z][A-Z0-9_]*$/.test(key) ? key : "UNKNOWN_KEY"}: unknown key`);
  }
  for (const key of REQUIRED_SIM_KEYS) if (!parsed[key]?.trim()) reasons.push(`${key}: required`);
  for (const key of PROVIDER_KEYS_CLOSED_INVENTORY) if (parsed[key]) reasons.push(`${key}: must be empty`);
  for (const key of ["TOAST_ENABLED", "TWILIO_ENABLED"]) {
    if (parsed[key] !== undefined && parsed[key] !== "" && parsed[key] !== "false") reasons.push(`${key}: must be disabled`);
  }
  const hex = parsed.AUTH_JWT_SECRET;
  const legacy = parsed.SIM_LEGACY_JWT_SECRET;
  if (!hex && !legacy) reasons.push("AUTH_JWT_SECRET or SIM_LEGACY_JWT_SECRET: required");
  if (hex && !/^(?:[a-fA-F0-9]{2})+$/.test(hex)) reasons.push("AUTH_JWT_SECRET: invalid hex");
  if (hex && legacy && hex.toLowerCase() !== legacyHex(legacy)) reasons.push("AUTH_JWT_SECRET and SIM_LEGACY_JWT_SECRET: conflict");
  if (parsed.NEXT_PUBLIC_STOREFRONT_LOCATION_ID && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(parsed.NEXT_PUBLIC_STOREFRONT_LOCATION_ID)) reasons.push("NEXT_PUBLIC_STOREFRONT_LOCATION_ID: invalid UUID");
  if (parsed.PORTAL_MAGIC_LINK_ALLOWLIST !== undefined && parsed.PORTAL_MAGIC_LINK_ALLOWLIST !== SIM_PORTAL_ALLOWLIST) reasons.push("PORTAL_MAGIC_LINK_ALLOWLIST: fixture recipients required");
  const target = parseAllowedTarget(parsed);
  if (!target.ok) reasons.push(...target.reasons);
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export function buildChildEnv(parentEnv: Env, simFile: Record<string, string>): Record<string, string> {
  const validation = validateSimEnvFile(simFile);
  if (!validation.ok) throw new Error(validation.reasons.join("; "));
  const child: Record<string, string> = {};
  const providers = new Set<string>(PROVIDER_KEYS_CLOSED_INVENTORY);
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    // Case-insensitive to cover Windows environment names as well.
    child[key] = /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|AUTH_)/i.test(key) || providers.has(key.toUpperCase()) ? "" : value;
  }
  for (const key of PROVIDER_KEYS_CLOSED_INVENTORY) child[key] = "";
  Object.assign(child, simFile);
  for (const key of RUNNER_PRIVATE_KEYS) delete child[key]; // runner-owned; the app never sees them
  child.AUTH_JWT_SECRET = simFile.AUTH_JWT_SECRET || legacyHex(simFile.SIM_LEGACY_JWT_SECRET!);
  child.SIM_LEGACY_JWT_SECRET = "";
  Object.assign(child, {
    NODE_ENV: "production", SIM_MODE: "1", NEXT_TELEMETRY_DISABLED: "1",
    TOAST_ENABLED: "false", TWILIO_ENABLED: "false", TOAST_FIXTURES: "1", EZCATER_FIXTURES: "1",
    NEXT_PUBLIC_APP_URL: SIM_APP_ORIGIN, PORTAL_MAGIC_LINK_ALLOWLIST: SIM_PORTAL_ALLOWLIST,
  });
  return child;
}
