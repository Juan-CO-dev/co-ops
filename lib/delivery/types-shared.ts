/**
 * Catering delivery (D1, migration 0356) — the closed vocabularies and the row / DTO types. Read with AGENTS.md
 * "Catering delivery". Zero I/O. Client-safe.
 *
 * A delivery is a JOB hanging off a catering lead. Every list here is the database's own (a CHECK in 0356);
 * tests/delivery-0356-migration.test.ts pins the status list equal to the migration's.
 */
import type { PipelineStage } from "@/lib/catering/pipeline-shared";

/** 0356 `delivery_job_events.status`. One list, in this order, in the CHECK and here. */
export const DELIVERY_STATUSES = [
  "requested", "accepted", "driver_assigned", "en_route_pickup", "at_pickup", "picked_up", "en_route_dropoff", "at_dropoff",
  "delivered", "cancelled", "failed", "returned",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** How the job came to be. `co_ops_api` is vocabulary for the provider adapter (a later PR): NOTHING writes it today. */
export const DELIVERY_BOOKED_VIA = ["manual", "provider_native", "co_ops_api"] as const;
export type DeliveryBookedVia = (typeof DELIVERY_BOOKED_VIA)[number];

/** Courier COST components (a payable). There is deliberately no `tip`: a driver's share of the gratuity is not a cost. */
export const DELIVERY_COST_COMPONENTS = ["base", "adjustment", "wait_time", "cancellation_fee", "credit", "invoice_total"] as const;
export type DeliveryCostComponent = (typeof DELIVERY_COST_COMPONENTS)[number];
export const DELIVERY_COST_SEMANTICS = ["snapshot", "delta"] as const;
export type DeliveryCostSemantics = (typeof DELIVERY_COST_SEMANTICS)[number];
export const DELIVERY_COST_SOURCES = ["manual", "provider", "invoice"] as const;
export type DeliveryCostSource = (typeof DELIVERY_COST_SOURCES)[number];
export const DELIVERY_EVENT_SOURCES = ["manual", "system", "provider"] as const;
export type DeliveryEventSource = (typeof DELIVERY_EVENT_SOURCES)[number];

/** Juan's decision 4: 10% to the driver. A per-shop setting (`delivery_settings.gratuity_driver_bps`); this is its default. */
export const DEFAULT_GRATUITY_DRIVER_BPS = 1000;
/** The courier list a shop may hold, and a label's length (0356's writer refuses anything else). */
export const MAX_MANUAL_PROVIDERS = 12;
export const MAX_PROVIDER_LABEL = 40;
export const MAX_EXTERNAL_REF = 80;
export const MAX_DELIVERY_NOTE = 500;

/** The derived state of a lead's delivery (`deliveryStateOf`). `to_book_soon` = `to_book` inside the caller's window. */
export const DELIVERY_STATES = [
  "cancel_needed", "pickup_mismatch", "booked", "on_the_way", "delivered", "problem", "to_book", "to_book_soon", "provider_managed", "none",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export type DeliveryLeadStage = PipelineStage;

/** `catering_quotes.status` (0120). */
export type DeliveryQuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired";
/** A candidate of the order-quote selection: the LIVE revision of one of the lead's quote families. */
export interface QuoteCandidateBase {
  id: string;
  status: DeliveryQuoteStatus;
  isDelivery: boolean;
  createdAt: string;
}
/** ... with the money only a cost reader may select. */
export interface QuoteCandidate extends QuoteCandidateBase {
  gratuityCents: number;
  deliveryFeeCents: number;
}
/** THE order quote (`orderQuoteOf`; SQL twin `delivery_order_quote`). Only `accepted` is a fee / gratuity source. */
export type OrderQuoteOf<T extends QuoteCandidateBase> =
  | { kind: "accepted"; quote: T; isDelivery: boolean }
  | { kind: "ambiguous"; isDelivery: boolean }
  | { kind: "rejected"; isDelivery: false }
  | { kind: "pending"; quote: T; isDelivery: boolean }
  | { kind: "none"; isDelivery: null };
export type OrderQuote = OrderQuoteOf<QuoteCandidate>;
export type OrderQuoteKind = OrderQuote["kind"];

/** A job with its current status (the view `delivery_job_current`). */
export interface DeliveryJob {
  id: string;
  pipelineId: string;
  /** The PICKUP shop the job was recorded for (history). Scope follows the LEAD, never this. */
  locationId: string;
  quoteId: string | null;
  confirmEventId: string | null;
  bookedVia: DeliveryBookedVia;
  providerLabel: string;
  externalRef: string | null;
  /** The latest job of a lead is the one with the highest attemptNo — never a time. */
  attemptNo: number;
  pickupAt: string | null;
  dropoffAt: string | null;
  closedAt: string | null;
  createdBy: string;
  createdAt: string;
  /** The event with the highest seq. */
  status: DeliveryStatus;
  statusSeq: number;
  /** When it happened, as entered. Information only: never orders or decides anything. */
  statusAt: string;
}
export interface DeliveryJobEvent {
  id: string; jobId: string; seq: number; status: DeliveryStatus; occurredAt: string; recordedAt: string;
  source: DeliveryEventSource; actorId: string | null; note: string | null;
}
export interface DeliveryCostRow {
  id: string; jobId: string; component: DeliveryCostComponent; semantics: DeliveryCostSemantics; amountCents: number;
  moneyIdentity: string; source: DeliveryCostSource; providerRef: string | null; observedAt: string;
  correctsId: string | null; actorId: string | null; note: string | null;
}
/** One row of an order's gratuity chain. RECORDED ONLY: its payroll and legal treatment is UNVERIFIED. */
export interface DeliveryGratuitySplit {
  id: string; pipelineId: string; jobId: string | null; quoteId: string | null; kind: "split" | "void";
  gratuityCents: number; driverBps: number; driverCents: number; crewCents: number;
  recordedAt: string; recordedBy: string | null; reason: string | null; supersedesId: string | null;
}
export interface DeliveryPickupDecision {
  id: string; jobId: string; leadLocationId: string; decidedBy: string; decidedAt: string; note: string | null;
}
/** A shop's settings. No row = off, no couriers, the default share. */
export interface DeliveryShopSettings {
  locationId: string;
  enabled: boolean;
  manualProviders: string[];
  gratuityDriverBps: number;
  updatedAt: string | null;
}
