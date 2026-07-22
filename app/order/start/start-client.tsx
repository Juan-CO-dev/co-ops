"use client";
/**
 * /order/start — Catering ENTRY FLOW, client form (real-data pass).
 *
 * Receives locations from the server wrapper (page.tsx → loadPublicLocations).
 *
 * - New client → intake form (name, email, phone, company, event details,
 *   delivery/pickup, location, optional extras) → POSTs to
 *   /api/portal/magic-link/request with full intake payload → "check your email".
 * - Returning client → sign-in (email → magic-link) → builder.
 *
 * sessionStorage write REMOVED — intake now flows server-side via the magic-link
 * request body, not the client store.
 *
 * FR-b integration: when deliveryNodesExist=true, the delivery path shows a
 * Nominatim geocode → Leaflet map pin → routeDeliveryAction flow; the pickup path
 * shows the pickupNodes chooser instead of the generic locations list. When
 * deliveryNodesExist=false the original legacy flow renders unchanged.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { GoodToKnow } from "@/components/portal/GoodToKnow";
import { GTK } from "@/components/portal/portal-content";
import { routeDeliveryAction } from "./actions";
import {
  CATERING_DELIVERY_WINDOWS,
  type DeliveryRouteResult,
} from "@/lib/catering/fulfillment-routing";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

// Dynamic import: ssr:false is REQUIRED — Leaflet is browser-only.
const DeliveryRouteMap = dynamic(
  () => import("@/components/order/DeliveryRouteMap"),
  { ssr: false },
);

interface Location {
  id: string;
  name: string;
  code: string;
}

interface PickupNode {
  locationId: string;
  locationName: string;
}

interface Props {
  locations: Location[];
  deliveryNodesExist: boolean;
  pickupNodes: PickupNode[];
}

type Fulfillment = "delivery" | "pickup";

interface FormState {
  name: string;
  email: string;
  company: string;
  date: string;
  guests: string;
  fulfillment: Fulfillment;
  locationId: string;
  address: string;
  phone: string;
  timeWindow: string;
  eventType: string;
  dietary: string;
  eventName: string;
  door: string;
}

export function OrderStartClient({ locations, deliveryNodesExist, pickupNodes }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"new" | "returning">("new");
  const [sent, setSent] = useState(false);
  const [f, setF] = useState<FormState>({
    name: "",
    email: "",
    company: "",
    date: "",
    guests: "20",
    fulfillment: "delivery",
    locationId: locations[0]?.id ?? "",
    address: "",
    phone: "",
    timeWindow: "",
    eventType: "",
    dietary: "",
    eventName: "",
    door: "",
  });

  // FR-b routing state
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [route, setRoute] = useState<DeliveryRouteResult | null>(null);
  const [locating, setLocating] = useState(false);

  // ⑤ carry-through: pick up the storefront selection (co_order_preselect) once on mount, then
  // clear it so a back-nav/refresh doesn't re-apply it. Folded into the new-client intake payload.
  const [preselect, setPreselect] = useState<Array<{ menuItemId?: string; itemId?: string; quantity: number }>>([]);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("co_order_preselect");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setPreselect(parsed);
        window.sessionStorage.removeItem("co_order_preselect");
      }
    } catch {
      /* private mode / malformed — no carry-through, order still works */
    }
  }, []);
  const preselectCount = preselect.reduce((s, p) => s + (Number(p.quantity) || 0), 0);

  const set = (patch: Partial<FormState>) => setF((cur) => ({ ...cur, ...patch }));

  // runRoute: call the server action with current coords + form state.
  const runRoute = async (lat: number, lng: number) => {
    setLocating(true);
    try {
      const res = await routeDeliveryAction({
        lat,
        lng,
        eventDate: f.date || null,
        headcount: Number(f.guests) || null,
      });
      setRoute(res);
    } finally {
      setLocating(false);
    }
  };

  // locate: button-triggered Nominatim geocode then route. One request, no per-keystroke.
  const locate = async () => {
    if (!f.address.trim() || locating) return;
    setLocating(true);
    try {
      const resp = await fetch(
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
          encodeURIComponent(f.address),
      );
      const arr = (await resp.json()) as unknown[];
      const first = Array.isArray(arr) ? (arr[0] as { lat?: string; lon?: string } | undefined) : null;
      if (first && first.lat && first.lon) {
        const lat = Number(first.lat);
        const lng = Number(first.lon);
        setGeo({ lat, lng });
        const res = await routeDeliveryAction({
          lat,
          lng,
          eventDate: f.date || null,
          headcount: Number(f.guests) || null,
        });
        setRoute(res);
      }
    } catch {
      /* non-fatal: user can drag the pin */
    } finally {
      setLocating(false);
    }
  };

  // Derive the fulfilling locationId for the new-flow delivery path.
  const routedLocationId =
    deliveryNodesExist && f.fulfillment === "delivery" && route?.status === "routed"
      ? route.locationId
      : null;

  // canSubmit: for the new delivery flow, block if no routed node yet.
  const deliveryBlocked =
    deliveryNodesExist && f.fulfillment === "delivery" && route?.status !== "routed";

  const canSubmit =
    mode === "returning"
      ? f.email.includes("@")
      : !!(
          f.name.trim() &&
          f.email.includes("@") &&
          f.date &&
          (deliveryNodesExist ? !deliveryBlocked : !!f.locationId)
        );

  // The locationId to send in the intake payload.
  const effectiveLocationId =
    deliveryNodesExist
      ? f.fulfillment === "delivery"
        ? (routedLocationId ?? "")
        : (f.locationId) // pickup: chosen node id stored in locationId via set()
      : f.locationId;

  return (
    <div className="flex min-h-screen flex-col bg-co-bg text-co-text">
      <header className="border-b border-co-border/50 bg-co-text text-co-bg">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
          <Link href="/order" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Back</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Compliments Only</span>
          <span className="w-10" />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-lg">
          {sent ? (
            <div className="rounded-3xl border border-co-border/70 bg-co-surface p-8 text-center shadow-sm sm:p-10">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-co-gold/40 text-3xl">✉️</div>
              <h1 className="mt-5 text-2xl font-extrabold text-co-text">Check your email</h1>
              <p className="mx-auto mt-2 max-w-sm text-co-text-muted">
                We sent a link to{" "}
                <span className="font-bold text-co-text">{f.email || "your inbox"}</span>{" "}
                to {mode === "new" ? "confirm your order and set up your account" : "sign you in"}.
                Click it and you&apos;ll pick up right where you left off.
              </p>
              <p className="mt-4 text-sm text-co-text-dim">The link works once and expires in 30 minutes.</p>
            </div>
          ) : (
            <div className="rounded-3xl border border-co-border/70 bg-co-surface p-8 shadow-sm sm:p-10">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">
                {mode === "new" ? "Start your order" : "Welcome back"}
              </p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text">
                {mode === "new" ? "Let's cater your event." : "Sign in to keep ordering."}
              </h1>

              <div className="mt-6 flex flex-col gap-4">
                {mode === "new" && (
                  <Field label="Your name">
                    <input
                      value={f.name}
                      onChange={(e) => set({ name: e.target.value })}
                      className="inp"
                      placeholder="Jane Rivera"
                    />
                  </Field>
                )}

                <Field label="Email" hint="This is your login — we'll email a link to confirm.">
                  <input
                    type="email"
                    value={f.email}
                    onChange={(e) => set({ email: e.target.value })}
                    className="inp"
                    placeholder="jane@company.com"
                  />
                </Field>

                {mode === "new" && (
                  <>
                    {/* Contact info */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Company (optional)">
                        <input
                          value={f.company}
                          onChange={(e) => set({ company: e.target.value })}
                          className="inp"
                          placeholder="Acme Co."
                        />
                      </Field>
                      <Field label="Contact phone (optional)">
                        <input
                          type="tel"
                          value={f.phone}
                          onChange={(e) => set({ phone: e.target.value })}
                          className="inp"
                          placeholder="(202) 555-0100"
                        />
                      </Field>
                    </div>

                    {/* Event basics */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Event date">
                        <input
                          type="date"
                          value={f.date}
                          onChange={(e) => set({ date: e.target.value })}
                          className="inp"
                        />
                      </Field>
                      <Field label="Guests">
                        <input
                          type="number"
                          min={1}
                          value={f.guests}
                          onChange={(e) => set({ guests: e.target.value })}
                          className="inp"
                        />
                      </Field>
                    </div>

                    {/* Optional event details */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Event / order name (optional)">
                        <input
                          value={f.eventName}
                          onChange={(e) => set({ eventName: e.target.value })}
                          className="inp"
                          placeholder="Team lunch, Q3 kickoff…"
                        />
                      </Field>
                      <Field label="Event type / occasion (optional)">
                        <input
                          value={f.eventType}
                          onChange={(e) => set({ eventType: e.target.value })}
                          className="inp"
                          placeholder="Corporate, birthday…"
                        />
                      </Field>
                    </div>

                    {/* Time window — select if nodes exist, free-text fallback */}
                    {deliveryNodesExist ? (
                      <Field label={t("order.route.window_label" as TranslationKey)}>
                        <select
                          value={f.timeWindow}
                          onChange={(e) => set({ timeWindow: e.target.value })}
                          className="inp"
                        >
                          <option value="">{t("order.route.window_any" as TranslationKey)}</option>
                          {CATERING_DELIVERY_WINDOWS.map((w) => (
                            <option key={w} value={w}>{w}</option>
                          ))}
                        </select>
                      </Field>
                    ) : (
                      <Field label="Time window (optional)">
                        <input
                          value={f.timeWindow}
                          onChange={(e) => set({ timeWindow: e.target.value })}
                          className="inp"
                          placeholder="11:00–11:30 AM"
                        />
                      </Field>
                    )}

                    {/* Delivery or pickup */}
                    <Field label="Delivery or pickup?">
                      <div className="flex gap-2">
                        {(["delivery", "pickup"] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              set({ fulfillment: opt });
                              // Reset routing state when switching modes
                              setGeo(null);
                              setRoute(null);
                            }}
                            className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-bold capitalize transition ${
                              f.fulfillment === opt
                                ? "border-co-text bg-co-text text-co-bg"
                                : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </Field>

                    {/* ── DELIVERY BLOCK ─────────────────────────────────────── */}
                    {f.fulfillment === "delivery" && (
                      <>
                        {deliveryNodesExist ? (
                          /* NEW: geocode + map flow */
                          <div className="flex flex-col gap-3">
                            <Field label="Delivery address">
                              <div className="flex gap-2">
                                <input
                                  value={f.address}
                                  onChange={(e) => set({ address: e.target.value })}
                                  className="inp flex-1"
                                  placeholder="Street, city, ZIP"
                                />
                                <button
                                  type="button"
                                  disabled={locating || !f.address.trim()}
                                  onClick={() => void locate()}
                                  className="min-h-[48px] rounded-xl border-2 border-co-border-2 bg-co-surface px-4 text-sm font-bold text-co-text transition hover:bg-co-gold/10 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {locating
                                    ? "…"
                                    : t("order.route.locate" as TranslationKey)}
                                </button>
                              </div>
                            </Field>

                            {geo && (
                              <>
                                <DeliveryRouteMap
                                  mapKey="pin"
                                  lat={geo.lat}
                                  lng={geo.lng}
                                  onPinChange={(lat, lng) => {
                                    setGeo({ lat, lng });
                                    void runRoute(lat, lng);
                                  }}
                                />
                                <p className="text-xs text-co-text-muted">
                                  {t("order.route.drag_hint" as TranslationKey)}
                                </p>
                                {route && (
                                  <p className={`text-sm font-semibold ${
                                    route.status === "routed"
                                      ? "text-co-text"
                                      : "text-co-cta"
                                  }`}>
                                    {route.status === "routed"
                                      ? t("order.route.in_zone" as TranslationKey, { location: route.locationName })
                                      : route.status === "out_of_zone"
                                      ? t("order.route.out_of_zone" as TranslationKey)
                                      : t("order.route.no_capacity" as TranslationKey)}
                                  </p>
                                )}
                              </>
                            )}

                            <Field label="Preferred drop-off door (optional)">
                              <input
                                value={f.door}
                                onChange={(e) => set({ door: e.target.value })}
                                className="inp"
                                placeholder="Lobby, loading dock, suite 4…"
                              />
                            </Field>
                          </div>
                        ) : (
                          /* LEGACY: manual location chooser + free-text address (deliveryNodesExist=false) */
                          <>
                            <Field
                              label="Nearest shop"
                              hint="Which of our locations will be fulfilling your order?"
                            >
                              <div className="flex flex-wrap gap-2">
                                {locations.map((loc) => (
                                  <button
                                    key={loc.id}
                                    type="button"
                                    onClick={() => set({ locationId: loc.id })}
                                    className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-bold transition ${
                                      f.locationId === loc.id
                                        ? "border-co-text bg-co-text/10 text-co-text"
                                        : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"
                                    }`}
                                  >
                                    {loc.name}
                                  </button>
                                ))}
                              </div>
                            </Field>
                            <Field label="Delivery address">
                              <input
                                value={f.address}
                                onChange={(e) => set({ address: e.target.value })}
                                className="inp"
                                placeholder="Street, city, ZIP"
                              />
                            </Field>
                            <Field label="Preferred drop-off door (optional)">
                              <input
                                value={f.door}
                                onChange={(e) => set({ door: e.target.value })}
                                className="inp"
                                placeholder="Lobby, loading dock, suite 4…"
                              />
                            </Field>
                          </>
                        )}
                      </>
                    )}

                    {/* ── PICKUP BLOCK ───────────────────────────────────────── */}
                    {f.fulfillment === "pickup" && (
                      <Field label="Pickup location">
                        {deliveryNodesExist ? (
                          /* NEW: pickupNodes chooser */
                          <div className="flex flex-wrap gap-2">
                            {pickupNodes.map((node) => (
                              <button
                                key={node.locationId}
                                type="button"
                                onClick={() => set({ locationId: node.locationId })}
                                className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-bold transition ${
                                  f.locationId === node.locationId
                                    ? "border-co-text bg-co-text/10 text-co-text"
                                    : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"
                                }`}
                              >
                                {node.locationName}
                              </button>
                            ))}
                          </div>
                        ) : (
                          /* LEGACY: all locations chooser */
                          <div className="flex flex-wrap gap-2">
                            {locations.map((loc) => (
                              <button
                                key={loc.id}
                                type="button"
                                onClick={() => set({ locationId: loc.id })}
                                className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-bold transition ${
                                  f.locationId === loc.id
                                    ? "border-co-text bg-co-text/10 text-co-text"
                                    : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"
                                }`}
                              >
                                {loc.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </Field>
                    )}

                    {/* Dietary notes */}
                    <Field label="Dietary & allergen notes (optional)">
                      <textarea
                        value={f.dietary}
                        onChange={(e) => set({ dietary: e.target.value })}
                        rows={3}
                        className="inp resize-none pt-3"
                        placeholder="Nut-free, gluten-free, vegan options needed…"
                      />
                    </Field>
                  </>
                )}
              </div>

              {mode === "new" && preselectCount > 0 && (
                <p className="mt-6 rounded-xl bg-co-gold/15 px-4 py-3 text-center text-sm font-semibold text-co-text">
                  {t("order.start.preselect_note" as TranslationKey, { count: String(preselectCount) })}
                </p>
              )}

              <button
                type="button"
                disabled={!canSubmit}
                onClick={async () => {
                  // Fire the magic-link request; response is always {ok:true} — don't block UX on failure.
                  if (mode === "new") {
                    await fetch("/api/portal/magic-link/request", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        email: f.email,
                        name: f.name,
                        intake: {
                          locationId: effectiveLocationId,
                          contactName: f.name,
                          company: f.company || null,
                          eventDate: f.date,
                          headcount: Number(f.guests) || null,
                          isDelivery: f.fulfillment === "delivery",
                          deliveryAddress:
                            f.fulfillment === "delivery" ? (f.address || null) : null,
                          contactPhone: f.phone || null,
                          timeWindow: f.timeWindow || null,
                          eventType: f.eventType || null,
                          dietaryNotes: f.dietary || null,
                          eventName: f.eventName || null,
                          dropoffDoor:
                            f.fulfillment === "delivery" ? (f.door || null) : null,
                          // FR-b geo + routing fields
                          geoLat: geo?.lat ?? null,
                          geoLng: geo?.lng ?? null,
                          fulfillmentRouted: route?.status === "routed",
                          // ⑤ storefront carry-through (item + qty; server re-resolves + re-prices)
                          preselect: preselect.length > 0 ? preselect : null,
                        },
                      }),
                    }).catch(() => {
                      /* non-fatal */
                    });
                  } else {
                    await fetch("/api/portal/magic-link/request", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email: f.email }),
                    }).catch(() => {
                      /* non-fatal */
                    });
                  }
                  setSent(true);
                }}
                className={`mt-7 flex min-h-[52px] w-full items-center justify-center rounded-full text-base font-bold uppercase tracking-[0.08em] transition ${
                  canSubmit
                    ? "bg-co-text text-co-cta hover:bg-co-text/90"
                    : "cursor-not-allowed bg-co-border text-co-text-dim"
                }`}
              >
                {mode === "new" ? "Continue →" : "Send me a sign-in link →"}
              </button>

              <p className="mt-5 text-center text-sm text-co-text-muted">
                {mode === "new" ? (
                  <>
                    Ordered with us before?{" "}
                    <button
                      type="button"
                      onClick={() => setMode("returning")}
                      className="font-bold text-co-text underline decoration-co-gold decoration-2 underline-offset-4"
                    >
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    New here?{" "}
                    <button
                      type="button"
                      onClick={() => setMode("new")}
                      className="font-bold text-co-text underline decoration-co-gold decoration-2 underline-offset-4"
                    >
                      Start an order
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
          <div className="mt-6">
            <GoodToKnow items={GTK.start} />
          </div>
          <p className="mt-4 text-center text-xs text-co-text-dim">
            No passwords to remember — your email is your account.
          </p>
        </div>
      </main>

      <style>{`.inp{min-height:48px;width:100%;border-radius:0.75rem;border:2px solid var(--co-border-2,#e6ddc0);background:var(--co-surface,#fffdf5);padding:0 0.85rem;font-size:0.95rem;color:var(--co-text,#141414)}`}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-co-text-dim">{hint}</span>}
    </label>
  );
}
