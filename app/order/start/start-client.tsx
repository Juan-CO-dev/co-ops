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
 */

import { useState } from "react";
import Link from "next/link";
import { GoodToKnow } from "@/components/portal/GoodToKnow";
import { GTK } from "@/components/portal/portal-content";

interface Location {
  id: string;
  name: string;
  code: string;
}

interface Props {
  locations: Location[];
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

export function OrderStartClient({ locations }: Props) {
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

  const set = (patch: Partial<FormState>) => setF((cur) => ({ ...cur, ...patch }));

  const canSubmit =
    mode === "returning"
      ? f.email.includes("@")
      : !!(f.name.trim() && f.email.includes("@") && f.date && f.locationId);

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

                    <Field label="Time window (optional)">
                      <input
                        value={f.timeWindow}
                        onChange={(e) => set({ timeWindow: e.target.value })}
                        className="inp"
                        placeholder="11:00–11:30 AM"
                      />
                    </Field>

                    {/* Delivery or pickup */}
                    <Field label="Delivery or pickup?">
                      <div className="flex gap-2">
                        {(["delivery", "pickup"] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => set({ fulfillment: opt })}
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

                    {/* Location chooser — shown for both delivery and pickup */}
                    <Field
                      label={f.fulfillment === "pickup" ? "Pickup location" : "Nearest shop"}
                      hint={
                        f.fulfillment === "delivery"
                          ? "Which of our locations will be fulfilling your order?"
                          : undefined
                      }
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

                    {/* Delivery-only fields */}
                    {f.fulfillment === "delivery" && (
                      <>
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
                          locationId: f.locationId,
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
