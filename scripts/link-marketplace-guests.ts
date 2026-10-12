/** CC-operated advisory link backlog. No capture hook; no credentials or customer data in output.
 * CUSTOMER_PROFILES=1 npx tsx scripts/link-marketplace-guests.ts plan --location <uuid> --out <file>
 * CUSTOMER_PROFILES=1 npx tsx scripts/link-marketplace-guests.ts apply --in <reviewed-file>
 * Supply credentials through the process environment; this script does not load env files.
 */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { marketplaceLinkVerdict, MARKETPLACE_LINK_REASONS, type MarketplaceLinkReason } from "../lib/customers/marketplace-link-shared";
import { assertSimTarget } from "../lib/sim-isolation-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (): never => { throw new Error("Invalid marketplace link input"); };
const object = (raw: unknown): Record<string, unknown> => raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : fail();
const id = (raw: unknown): string => typeof raw === "string" && UUID.test(raw) ? raw : fail();
// Decisions carry name keys only. Refuse contact-shaped strings, including numeric names.
const safeKey = (raw: unknown): raw is string => typeof raw === "string" && raw.length > 0 && raw.length <= 200 && /^[\p{L}\p{M}.' -]+$/u.test(raw);
const key = (raw: unknown): string => safeKey(raw) ? raw : fail();
const strings = (raw: unknown): string[] => Array.isArray(raw) && raw.every((v) => typeof v === "string") ? raw : fail();

export interface MarketplaceDecision {
  guest_id: string;
  customer_id: string;
  guest_name_key: string;
  customer_name_key: string;
  confidence: number;
  reasons: MarketplaceLinkReason[];
}

export function parseMarketplaceDecision(raw: unknown): MarketplaceDecision {
  const row = object(raw);
  const fields = ["guest_id", "customer_id", "guest_name_key", "customer_name_key", "confidence", "reasons"];
  if (Object.keys(row).length !== fields.length || Object.keys(row).some((field) => !fields.includes(field))) fail();
  const guestId = id(row.guest_id);
  const customerId = id(row.customer_id);
  const reasons = strings(row.reasons);
  if (guestId === customerId || new Set(reasons).size !== reasons.length || reasons.some((r) => !(MARKETPLACE_LINK_REASONS as readonly string[]).includes(r))) fail();
  const sameName = reasons.includes("same_name");
  const sharedItems = reasons.includes("shared_items");
  if (!reasons.includes("same_shop") || sameName === reasons.includes("same_initial") || (!sameName && !sharedItems)) fail();
  const confidence = sameName ? (sharedItems ? 0.9 : 0.8) : 0.7;
  if (row.confidence !== confidence) fail();
  return { guest_id: guestId, customer_id: customerId, guest_name_key: key(row.guest_name_key), customer_name_key: key(row.customer_name_key), confidence, reasons: reasons as MarketplaceLinkReason[] };
}

export interface LinkClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Each RPC row contains the COMPLETE candidate set for one guest. Never page candidate pairs. */
/** `revoked` holds "guest:customer" pairs a person rejected (0250); they are never proposed again. */
export async function planMarketplaceLinks(client: LinkClient, locationId: string, revoked: ReadonlySet<string> = new Set()): Promise<MarketplaceDecision[]> {
  id(locationId);
  const decisions: MarketplaceDecision[] = [];
  let after: string | null = null;
  const seen = new Set<string>();
  for (;;) {
    const { data, error } = await client.rpc("customer_marketplace_candidates", { p_location_id: locationId, p_after: after, p_limit: 100 });
    if (error || !Array.isArray(data)) throw new Error("Marketplace candidate read failed");
    if (!data.length) break;
    for (const raw of data) {
      const row = object(raw);
      const guestId = id(row.guest_id);
      if (seen.has(guestId) || row.location_id !== locationId) fail();
      seen.add(guestId);
      after = guestId;
      if (!Array.isArray(row.candidates)) fail();
      const candidateRows = (row.candidates as unknown[]).map(object);
      // Skip the whole guest when ANY name is unsafe for the decisions file. Never remove a
      // candidate then score the remaining set: doing so could manufacture a unique match.
      if (!safeKey(row.guest_name_key) || candidateRows.some((candidate) => !safeKey(candidate.name_key))) continue;
      const guestName = row.guest_name_key;
      const candidates = candidateRows.map((candidate) => {
        return { customerId: id(candidate.customer_id), nameKey: key(candidate.name_key), locationId, items: strings(candidate.items), dates: strings(candidate.dates) };
      });
      const verdict = marketplaceLinkVerdict({ guest: { nameKey: guestName, locationId, items: strings(row.guest_items), dates: strings(row.guest_dates) }, candidates });
      if (verdict && !revoked.has(`${guestId}:${verdict.customerId}`)) decisions.push(parseMarketplaceDecision({ guest_id: guestId, customer_id: verdict.customerId, guest_name_key: guestName, customer_name_key: candidates.find((c) => c.customerId === verdict.customerId)!.nameKey, confidence: verdict.confidence, reasons: verdict.reasons }));
    }
  }
  return decisions;
}

/** Validate the WHOLE reviewed file before the first mutation; SQL rechecks live evidence. */
export async function applyMarketplaceLinks(client: LinkClient, content: string): Promise<number> {
  const decisions = content.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    try { return parseMarketplaceDecision(JSON.parse(line)); } catch { return fail(); }
  });
  if (new Set(decisions.map((d) => d.guest_id)).size !== decisions.length) fail();
  for (const decision of decisions) {
    const { data, error } = await client.rpc("customer_probable_link_upsert", {
      p_guest_id: decision.guest_id, p_customer_id: decision.customer_id, p_confidence: decision.confidence,
      p_reasons: decision.reasons, p_decided_by: "rule",
    });
    // false means the identical active link already existed: a successful idempotent replay.
    if (error || typeof data !== "boolean") throw new Error("Marketplace link apply refused");
  }
  return decisions.length;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (process.env.CUSTOMER_PROFILES !== "1") throw new Error("CUSTOMER_PROFILES must be enabled");
  const [mode, ...flags] = args;
  const allowed = mode === "plan" ? ["--location", "--out"] : mode === "apply" ? ["--in"] : fail();
  if (flags.length !== allowed.length * 2) fail();
  const options = new Map<string, string>();
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i]!;
    const value = flags[i + 1];
    if (!allowed.includes(flag) || options.has(flag) || !value) fail();
    options.set(flag, value!);
  }
  if (mode === "plan") id(options.get("--location"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Database environment is incomplete");
  if (process.env.SIM_MODE) assertSimTarget(url);
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  if (mode === "plan") {
    const { data: rejected, error } = await client.from("customer_probable_links").select("guest_id,customer_id").not("revoked_at", "is", null).limit(10000);
    if (error || !rejected || rejected.length >= 10000) throw new Error("Revoked link read failed");
    const revoked = new Set(rejected.map((r: { guest_id: string; customer_id: string }) => `${r.guest_id}:${r.customer_id}`));
    const decisions = await planMarketplaceLinks(client, options.get("--location")!, revoked);
    await writeFile(options.get("--out")!, decisions.map((decision) => JSON.stringify(decision)).join("\n") + (decisions.length ? "\n" : ""), { flag: "wx", mode: 0o600 });
    console.log(`Planned ${decisions.length} advisory links`);
  } else {
    const count = await applyMarketplaceLinks(client, await readFile(options.get("--in")!, "utf8"));
    console.log(`Applied ${count} advisory links`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Marketplace linking failed; no customer data printed"); process.exitCode = 1; });
}
