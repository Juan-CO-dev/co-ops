/** URL state for the customer list. Pure; authorization is repeated by the server loader. */
import { CUSTOMER_ALL_SHOPS_MIN, CUSTOMER_CONTACT_MIN } from "./access-shared";

export const CUSTOMER_LIST_SORTS = ["recent", "visits", "spend", "avg_order", "cards", "catering", "newest", "quiet"] as const;
export const CUSTOMER_LIST_SEGMENTS = ["regulars", "lapsed", "one_time", "new", "both_shops", "catering"] as const;
export const CUSTOMER_LIST_CHANNELS = ["in_store", "online", "app", "delivery", "catering"] as const;
export type CustomerListSearchParams = Record<string, string | string[] | undefined>;
export interface CustomerListParams {
  search: string;
  page: number;
  sort: (typeof CUSTOMER_LIST_SORTS)[number];
  locationId: string | null;
  filters: {
    segment?: (typeof CUSTOMER_LIST_SEGMENTS)[number];
    channel?: (typeof CUSTOMER_LIST_CHANNELS)[number];
    min_visits?: number;
    min_spend_cents?: number;
    guests: boolean;
    only_guests?: true;
    reachable?: boolean;
    opted_in?: boolean;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scalar = (v: string | string[] | undefined) => typeof v === "string" ? v : undefined;
function choice<T extends string>(value: string | undefined, choices: readonly T[]): T | undefined {
  return choices.find((c) => c === value);
}
function integer(value: string | undefined, min: number, max: number): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}
function boolean(value: string | undefined): boolean | undefined {
  return value === "1" || value === "true" ? true : value === "0" || value === "false" ? false : undefined;
}

export function parseListParams(raw: CustomerListSearchParams, level: number): CustomerListParams {
  const location = scalar(raw.location);
  const filters: CustomerListParams["filters"] = { guests: boolean(scalar(raw.guests)) ?? false };
  const segment = choice(scalar(raw.segment), CUSTOMER_LIST_SEGMENTS);
  const channel = choice(scalar(raw.channel), CUSTOMER_LIST_CHANNELS);
  const minVisits = integer(scalar(raw.min_visits), 1, 1000);
  const minSpend = integer(scalar(raw.min_spend_cents), 0, Number.MAX_SAFE_INTEGER);
  if (segment) filters.segment = segment;
  if (channel) filters.channel = channel;
  if (minVisits !== undefined) filters.min_visits = minVisits;
  if (minSpend !== undefined) filters.min_spend_cents = minSpend;
  if (boolean(scalar(raw.only_guests))) filters.only_guests = true;
  if (level >= CUSTOMER_CONTACT_MIN) {
    const reachable = boolean(scalar(raw.reachable));
    const optedIn = boolean(scalar(raw.opted_in));
    if (reachable !== undefined) filters.reachable = reachable;
    if (optedIn !== undefined) filters.opted_in = optedIn;
  }
  return {
    search: (scalar(raw.q) ?? "").trim().slice(0, 80),
    // Keep the SQL integer offset bounded even for malicious URLs.
    page: integer(scalar(raw.page), 1, 1_000_000) ?? 1,
    sort: choice(scalar(raw.sort), CUSTOMER_LIST_SORTS) ?? "recent",
    locationId: level >= CUSTOMER_ALL_SHOPS_MIN && location && UUID.test(location) ? location : null,
    filters,
  };
}

/** Only recognized, authorized state is carried into links and form resets. */
export function listParamsQuery(params: CustomerListParams): URLSearchParams {
  const out = new URLSearchParams();
  if (params.search) out.set("q", params.search);
  if (params.page > 1) out.set("page", String(params.page));
  if (params.sort !== "recent") out.set("sort", params.sort);
  if (params.locationId) out.set("location", params.locationId);
  for (const [key, value] of Object.entries(params.filters)) {
    if (key === "guests" && !value) continue;
    if (value !== undefined) out.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  return out;
}

/** Explicit projection: RPC additions never silently expand the page's privacy boundary. */
export interface CustomerListDto {
  id: string;
  name: string | null;
  visits: number;
  spendCents: number | null;
  avgOrderCents: number | null;
  firstOrder: string | null;
  lastOrder: string | null;
  shops: string[];
  cateringOrders: number;
  cards: number;
  channels: string[];
  isGuest: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
  optedIn?: boolean;
}
