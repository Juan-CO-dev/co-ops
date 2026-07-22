"use client";
/**
 * /order/build — Catering ORDER BUILDER (3a-core: server-backed real-data build).
 *
 * SERVER-BACKED. Drives the whole surface from the customer's OWNED draft:
 *   ?draft=<quoteId>  →  GET /api/portal/order/draft/[quoteId]  →  { draft }
 * The draft carries the real catering menu (draft.menu, napkins add-on filtered out), the lead's
 * intake fields (draft.lead — the authoritative headcount, the 24→20 fix), and the current cart
 * lines + server-authoritative charge stack (draft.stack). No draft param → an empty "start your
 * order" state; a 404 → the same.
 *
 * CART PERSISTENCE (D20 — client sends REFERENCES only, never prices): every cart change debounces
 * ~400ms then POSTs /api/portal/order/draft/lines with
 *   subs   (menu_item) → { menuItemId, portion, quantity }
 *   extras (item)      → { itemId, quantity, sizeId? }
 * The returned `stack` is the server-authoritative subtotal shown in the cart. "Continue" navigates
 * to /order/review?draft=<draftId>.
 *
 * HEADCOUNT (the 24→20 FIX): coverage headcount seeds from draft.lead.headcount — never a hardcoded
 * 20, never ?guests=. The guests input adjusts the coverage VIEW locally; the lead's headcount is
 * authoritative.
 *
 * PORTIONS (W1a): a portionable menu_item shows the ¼/½/whole selector priced from
 * portionPricesCents (cents). Everything else is quantity-only.
 *
 * SIZES (W1a extension): a sized item (kind:"item", sizes non-empty) expands into one MENU ROW per
 * size (each independently orderable, keyed by `item:id:sizeId`), so two sizes coexist as distinct
 * cart lines. Size is identity here, not a switchable attribute. An item is portionable XOR sized
 * XOR plain — never both.
 *
 * COVERAGE is best-effort: real menu rows have no explicit `serves`/`cat`, so category is derived
 * heuristically from `section`. With 0 catering data the menu is empty (correct dormant behavior).
 *
 * Per-line customization (allergens / notes / subs / drink) has no server home in 3a — kept as
 * local display-only state in the modal; it is NEVER part of the persisted payload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CateringMenuItem } from "@/lib/catering/menu";

type Cat = "main" | "side" | "sweet" | "drink";
/** Portion selector for portionable subs. Matches the draft-lines API portion values. */
type Portion = "quarter" | "half" | "whole";

/** The draft shape returned by GET /api/portal/order/draft/[quoteId]. Mirrors lib/portal/draft.ts DraftLoad. */
interface DraftStack {
  subtotalCents: number; deliveryFeeCents: number; serviceChargeCents: number;
  gratuityCents: number; taxCents: number; totalCents: number; depositCents: number;
}
interface DraftLead {
  contactName: string; company: string | null; eventDate: string | null; headcount: number | null;
  contactPhone: string | null; deliveryAddress: string | null; timeWindow: string | null;
  eventType: string | null; dietaryNotes: string | null; eventName: string | null; dropoffDoor: string | null;
}
/** One persisted cart line (only the reference fields the build page needs to hydrate the cart). */
interface DraftItem {
  itemId: string | null; menuItemId: string | null; portion: Portion | null; quantity: number;
  sizeId: string | null;
}
interface DraftLoad {
  quoteId: string; pipelineId: string | null; locationId: string; status: string;
  isDelivery: boolean; deliveryZoneId: string | null;
  stack: DraftStack;
  items: DraftItem[];
  lead: DraftLead | null;
  menu: CateringMenuItem[];
  addonNapkins: CateringMenuItem | null;
}

/** Local-only line state. Only { portion, qty, sizeId } drive the persisted payload; the rest is display-only. */
interface Line { qty: number; portion: Portion; sizeId: string | null; notes: string; allergens: string[]; subs: string[]; sub: string; drink: string }
/** A cart entry keyed by its stable cart key. line.sizeId carries the chosen size for a sized item. */
interface CartEntry { key: string; item: CateringMenuItem; line: Line }
/** A single sellable menu row. A sized item expands into one card per size (each independently
 *  orderable, its own quick-add); everything else is one card. The key includes sizeId so two sizes
 *  of the same item are distinct cart lines. */
interface MenuCard { key: string; item: CateringMenuItem; sizeId: string | null; sizeLabel: string | null; label: string; priceCents: number; serves: number | null }

/** Portion fractions for coverage counting (¼=0.25, ½=0.5, whole=1). */
const PORTION_FRACTION: Record<Portion, number> = { quarter: 0.25, half: 0.5, whole: 1 };
const PORTION_LABELS: Record<Portion, { label: string; aria: string; symbol: string }> = {
  quarter: { label: "¼", aria: "Quarter portion", symbol: "¼" },
  half:    { label: "½", aria: "Half portion",    symbol: "½" },
  whole:   { label: "Whole", aria: "Whole portion", symbol: "Whole" },
};

const ALLERGENS = ["Peanuts", "Tree nuts", "Dairy", "Eggs", "Gluten", "Soy", "Shellfish", "Sesame"];
/** Generic house facts. Real menu ids are UUIDs (won't match the mock ITEM_FACTS keys) so the ticker
 *  falls back to these house facts — item-keyed facts return once the config tables are authored. */
const FACTS = [
  "Everything's built the morning of your event — never the night before.",
  "48 hours notice keeps things smooth. The 3-footer needs 48, the six-footer 72.",
  "Allergen info is on every item — flag anything and we'll confirm.",
  "Delivery across DC, or free pickup at Capitol Hill or Dupont.",
  "“The Crunchy Boi is my go-to — it’s just perfect.” — a real regular.",
  "House-made ingredients, sliced and built face-to-face.",
];

/** Money helper — takes CENTS (the whole page is in the cents model; the draft + menu are cents). */
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const emptyLine = (): Line => ({ qty: 1, portion: "whole", sizeId: null, notes: "", allergens: [], subs: [], sub: "", drink: "" });
/** Cart key. Sized items key by item+size so two sizes coexist as distinct lines; subs/plain by kind:id. */
const keyFor = (item: CateringMenuItem, sizeId: string | null) =>
  item.kind === "item" && sizeId ? `item:${item.id}:${sizeId}` : `${item.kind}:${item.id}`;
const isPortionable = (item: CateringMenuItem) => item.kind === "menu_item" && item.portionable === true;

// ── Size helpers ─────────────────────────────────────────────────────────────
/** A sized item is a kind:"item" with a non-empty sizes array. Mutually exclusive with portionable. */
const isSized = (item: CateringMenuItem) => item.sizes != null && item.sizes.length > 0;
/** Resolve the currently-selected size object for a line; falls back to sizes[0]. */
const selectedSize = (item: CateringMenuItem, line: Line) =>
  item.sizes?.find((s) => s.id === line.sizeId) ?? item.sizes?.[0] ?? null;

/** Per-line unit price in cents. Dispatches: sized → chosen size price; portionable → portion price; else → flat price. */
function unitCents(item: CateringMenuItem, line: Line): number {
  if (isSized(item)) return selectedSize(item, line)?.unitPriceCents ?? item.unitPriceCents;
  if (isPortionable(item) && item.portionPricesCents) return item.portionPricesCents[line.portion];
  return item.unitPriceCents;
}

/** Expand the menu into sellable cards: a sized item → one card per size; else one card. */
function expandCards(menu: CateringMenuItem[]): MenuCard[] {
  const cards: MenuCard[] = [];
  for (const item of menu) {
    if (isSized(item) && item.sizes) {
      for (const sz of item.sizes) {
        cards.push({ key: keyFor(item, sz.id), item, sizeId: sz.id, sizeLabel: sz.label, label: `${item.name} · ${sz.label}`, priceCents: sz.unitPriceCents, serves: sz.serves });
      }
    } else {
      const priceCents = isPortionable(item) && item.portionPricesCents ? item.portionPricesCents.whole : item.unitPriceCents;
      cards.push({ key: keyFor(item, null), item, sizeId: null, sizeLabel: null, label: item.name, priceCents, serves: null });
    }
  }
  return cards;
}

/** Derive a coverage category from the row's section (best-effort — the real menu has no `cat`). */
function catFor(item: CateringMenuItem): Cat {
  const s = (item.section ?? "").toLowerCase();
  if (/(side|chip|salad)/.test(s)) return "side";
  if (/(sweet|cookie|dessert|cannoli|treat)/.test(s)) return "sweet";
  if (/(drink|soda|water|beverage)/.test(s)) return "drink";
  // subs/platters/sandwiches and anything unclassified count as mains.
  return "main";
}

/** Human summary of a customized line (portion / size / subs / drink / allergen holds / notes) — display only. */
function lineSummary(e: CartEntry): string {
  const bits: string[] = [];
  if (isPortionable(e.item) && e.line.portion !== "whole") bits.push(PORTION_LABELS[e.line.portion].symbol);
  if (isSized(e.item)) {
    const sz = selectedSize(e.item, e.line);
    if (sz) bits.push(sz.label);
  }
  if (e.line.subs.length) bits.push(e.line.subs.join(", "));
  if (e.line.sub) bits.push(e.line.sub);
  if (e.line.drink) bits.push(e.line.drink);
  if (e.line.allergens.length) bits.push(`no ${e.line.allergens.join(", ").toLowerCase()}`);
  if (e.line.notes) bits.push(e.line.notes);
  return bits.join(" · ");
}

export default function OrderBuild() {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLoad | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "empty" | "ready">("loading");

  const [cart, setCart] = useState<Record<string, Line>>({});
  const [headcount, setHeadcount] = useState(0);
  const [modalKey, setModalKey] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false); // mobile bottom-sheet toggle
  const [hintIdx, setHintIdx] = useState(0);
  // Server-authoritative subtotal (cents) from the last persisted lines POST. Falls back to draft.stack.
  const [subtotalCents, setSubtotalCents] = useState(0);

  // ── Load the draft (Next 16: read ?draft from window.location.search in an effect, not useSearchParams). ──
  useEffect(() => {
    let cancelled = false;
    // All setState runs inside the async IIFE (never synchronously in the effect body) so the
    // no-id early-out doesn't trigger a cascading synchronous re-render.
    void (async () => {
      const id = new URLSearchParams(window.location.search).get("draft");
      if (!id) { if (!cancelled) setLoadState("empty"); return; }
      setDraftId(id);
      try {
        const res = await fetch(`/api/portal/order/draft/${id}`, { headers: { accept: "application/json" } });
        if (!res.ok) { if (!cancelled) setLoadState("empty"); return; }
        const body = (await res.json()) as { ok?: boolean; draft?: DraftLoad };
        if (!body?.ok || !body.draft) { if (!cancelled) setLoadState("empty"); return; }
        if (cancelled) return;
        const d = body.draft;
        setDraft(d);
        setSubtotalCents(d.stack.subtotalCents);
        setHeadcount(d.lead?.headcount ?? 0); // 24→20 FIX: seed from the lead, never a hardcoded 20.
        // Hydrate the cart from the draft's persisted lines (a returning customer keeps their cart).
        const cardsByKey = new Map(expandCards(d.menu).map((c) => [c.key, c] as const));
        const initial: Record<string, Line> = {};
        for (const it of d.items) {
          // Reconstruct the sellable-card key from the persisted reference (incl. sizeId for sized items).
          const key = it.menuItemId
            ? `menu_item:${it.menuItemId}`
            : it.itemId
              ? (it.sizeId ? `item:${it.itemId}:${it.sizeId}` : `item:${it.itemId}`)
              : null;
          if (!key) continue;
          const card = cardsByKey.get(key);
          if (!card) continue; // references something not in the shopping menu (e.g. napkins / retired size) — skip.
          const prev = initial[key];
          initial[key] = {
            ...emptyLine(),
            qty: (prev?.qty ?? 0) + it.quantity,
            portion: it.portion ?? "whole",
            sizeId: card.sizeId,
          };
        }
        setCart(initial);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("empty");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const menu = useMemo(() => draft?.menu ?? [], [draft]);
  const cards = useMemo(() => expandCards(menu), [menu]);
  const menuByKey = useMemo(() => new Map(cards.map((c) => [c.key, c] as const)), [cards]);
  // Group the sellable cards by section (section as heading). A sized item shows one row per size.
  const groups = useMemo(() => {
    const map = new Map<string, MenuCard[]>();
    for (const c of cards) {
      const section = c.item.section ?? "More";
      const arr = map.get(section) ?? [];
      arr.push(c);
      map.set(section, arr);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [cards]);

  // ── Cart mutations ──────────────────────────────────────────────────────────────
  const quickAdd = useCallback((key: string) => setCart((c) => {
    const prev = c[key];
    if (prev) return { ...c, [key]: { ...prev, qty: prev.qty + 1 } };
    // Fresh line — stamp the card's size (the key already encodes which size for a sized item).
    const card = menuByKey.get(key);
    return { ...c, [key]: { ...emptyLine(), sizeId: card?.sizeId ?? null } };
  }), [menuByKey]);
  const dec = useCallback((key: string) => setCart((c) => {
    const prev = c[key];
    const next = (prev?.qty ?? 0) - 1;
    const copy = { ...c };
    if (next <= 0 || !prev) delete copy[key]; else copy[key] = { ...prev, qty: next };
    return copy;
  }), []);
  const applyCustom = useCallback((key: string, line: Line) => setCart((c) => ({ ...c, [key]: line })), []);

  const lines: CartEntry[] = useMemo(
    () => Object.entries(cart)
      .map(([key, line]) => { const card = menuByKey.get(key); return card ? { key, item: card.item, line } : null; })
      .filter((e): e is CartEntry => e !== null),
    [cart, menuByKey],
  );

  // Local subtotal (cents) — an instant echo while the debounced POST is in flight; the server's
  // returned subtotalCents is authoritative once it lands.
  const localSubtotalCents = lines.reduce((s, e) => s + unitCents(e.item, e.line) * e.line.qty, 0);
  const count = lines.reduce((s, e) => s + e.line.qty, 0);

  // Coverage: portionable subs count by portion fraction; sized items count by serves (or 1);
  // everything else counts its quantity.
  const servedBy = (cat: Cat) => lines
    .filter((e) => catFor(e.item) === cat)
    .reduce((s, e) => {
      if (isPortionable(e.item)) return s + e.line.qty * PORTION_FRACTION[e.line.portion];
      if (isSized(e.item)) return s + e.line.qty * (selectedSize(e.item, e.line)?.serves ?? 1);
      return s + e.line.qty;
    }, 0);
  const coverage = { main: servedBy("main"), side: servedBy("side"), sweet: servedBy("sweet"), drink: servedBy("drink") };

  const hints = coverageHints(lines, coverage, headcount);
  useEffect(() => {
    if (hints.length <= 1) return;
    const t = window.setInterval(() => setHintIdx((i) => i + 1), 3800);
    return () => window.clearInterval(t);
  }, [hints.length]);

  // ── Debounced persistence (D20 — references + qty + portion + sizeId only, never prices) ──
  const persistTimer = useRef<number | null>(null);
  // Serialize the reference payload so the effect only fires when the persisted shape actually changes
  // (not on a display-only customization edit). sizeId is included so a size change re-triggers POST.
  const linesPayload = useMemo(
    () => lines.map((e) => e.item.kind === "menu_item"
      ? { menuItemId: e.item.id, portion: e.line.portion, quantity: e.line.qty }
      : { itemId: e.item.id, quantity: e.line.qty, ...(e.line.sizeId ? { sizeId: e.line.sizeId } : {}) }),
    [lines],
  );
  const payloadKey = JSON.stringify(linesPayload);
  const didHydrate = useRef(false);
  useEffect(() => {
    if (!draftId || loadState !== "ready") return;
    // Skip the first ready-render (the cart was just hydrated from the server — no re-POST needed).
    if (!didHydrate.current) { didHydrate.current = true; return; }
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/portal/order/draft/lines", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ quoteId: draftId, lines: linesPayload }),
          });
          if (!res.ok) return; // server rejected (e.g. no longer a draft) — keep the local echo.
          const body = (await res.json()) as { ok?: boolean; stack?: DraftStack };
          if (body?.ok && body.stack) setSubtotalCents(body.stack.subtotalCents);
        } catch { /* transient — the local subtotal echo still shows the customer their cart */ }
      })();
    }, 400);
    return () => { if (persistTimer.current !== null) window.clearTimeout(persistTimer.current); };
    // payloadKey captures the persisted-reference shape (incl. sizeId); linesPayload/draftId/loadState are stable deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey, draftId, loadState]);

  // The subtotal shown in the cart. The local echo (computed synchronously from the same
  // server-derived per-portion prices) is the freshest figure while the debounced POST is in flight;
  // the server's returned subtotal (`subtotalCents`) is the source of truth once the cart settles.
  // Prefer the local echo whenever the cart is non-empty so the customer never sees a stale value
  // mid-debounce; fall back to the server value (e.g. cart just hydrated, no local recompute yet).
  const displaySubtotalCents = count === 0 ? 0 : (localSubtotalCents || subtotalCents);

  const goToReview = () => {
    if (lines.length === 0 || !draftId) return;
    router.push(`/order/review?draft=${draftId}`);
  };

  // Facts ticker — generic house facts (real ids are UUIDs; item-keyed facts return with the config tables).
  const facts = FACTS;
  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setFactIdx((i) => (i + 1) % facts.length), 4500); return () => window.clearInterval(t); }, [facts.length]);

  const modalCard = modalKey ? menuByKey.get(modalKey) ?? null : null;

  // ── Empty / loading states ──────────────────────────────────────────────────────
  if (loadState === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg text-co-text-dim">
        <p className="text-sm">Loading your order…</p>
      </div>
    );
  }
  if (loadState === "empty" || !draft) {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg px-6 text-center text-co-text">
        <div className="max-w-md">
          <h1 className="text-2xl font-extrabold tracking-tight">Start your order</h1>
          <p className="mt-2 text-co-text-muted">We couldn&apos;t find an order to build. Start a new one and we&apos;ll email you a link to pick up right where you left off.</p>
          <Link href="/order/start" className="mt-6 inline-flex min-h-[52px] items-center justify-center rounded-full bg-co-text px-8 text-sm font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90">Start your order →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-co-bg pb-28 text-co-text lg:pb-0">
      <div className="sticky top-0 z-30">
        <header className="border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
            <Link href="/order" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Menu</Link>
            <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Build your order</span>
            <span className="text-sm font-bold text-co-gold">{count > 0 ? `${count} item${count > 1 ? "s" : ""}` : " "}</span>
          </div>
        </header>
        {/* Mobile "good to know" — pinned under the header (desktop shows it beside the cart). */}
        <div className="border-b border-co-border/50 bg-co-bg/95 backdrop-blur lg:hidden">
          <div key={factIdx} className="mx-auto max-w-6xl px-5 py-2 text-center text-sm text-co-text-muted transition-opacity duration-500"><span className="mr-2" aria-hidden>💡</span>{facts[factIdx % facts.length]}</div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-10">
          {groups.length === 0 ? (
            <div className="rounded-2xl border border-co-border/70 bg-co-surface px-6 py-10 text-center">
              <p className="text-sm font-semibold text-co-text">Our catering menu is being finalized.</p>
              <p className="mt-1 text-sm text-co-text-muted">Check back shortly, or reach out and we&apos;ll build a custom quote for you.</p>
            </div>
          ) : groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-co-text-dim">{g.label}</h2>
              <div className="flex flex-col divide-y divide-co-border/60 overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface">
                {g.items.map((card) => {
                  const it = card.item;
                  const portionable = isPortionable(it);
                  // Sized card: its own size price (each size is a distinct row). Portionable: "from" whole. Plain: flat.
                  const priceDisplay = portionable ? `from ${money(card.priceCents)}` : money(card.priceCents);
                  const affordanceText = portionable ? "Choose portion →" : "Customize →";
                  return (
                    <div key={card.key} className="flex items-center justify-between gap-4">
                      <button type="button" onClick={() => setModalKey(card.key)} className="flex-1 p-4 text-left transition hover:bg-co-bg/40">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-extrabold text-co-text">{card.label}</h3>
                          {it.cateringOnly && <span className="rounded-full bg-co-gold/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">Catering</span>}
                        </div>
                        <span className="mt-1 inline-block text-[11px] font-bold uppercase tracking-wide text-co-text-dim">{affordanceText}</span>
                      </button>
                      <div className="flex shrink-0 items-center gap-3 pr-4">
                        <span className="text-sm font-bold text-co-cta">{priceDisplay}</span>
                        <button type="button" onClick={() => quickAdd(card.key)} aria-label={`Quick add ${card.label}`} className="grid h-9 w-9 place-items-center rounded-full bg-co-text text-xl font-bold text-co-cta transition hover:bg-co-text/90">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="hidden lg:block"><div className="sticky top-24 flex flex-col gap-4">
          {/* "Good to know" rides with the sticky cart. */}
          <div className="rounded-2xl border border-co-border/70 bg-co-surface px-5 py-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-co-text-dim">💡 Good to know</p>
            <p key={factIdx} className="mt-1.5 min-h-[2.75em] text-sm leading-snug text-co-text-muted transition-opacity duration-500">{facts[factIdx % facts.length]}</p>
          </div>
          <Cart lines={lines} subtotalCents={displaySubtotalCents} headcount={headcount} setHeadcount={setHeadcount} coverage={coverage} onCustomize={setModalKey} dec={dec} add={quickAdd} onContinue={goToReview} />
        </div></aside>
      </div>

      {/* Mobile bottom bar — the coverage guide surfaces here as an expandable sheet. */}
      <div className="lg:hidden">
        <button
          type="button"
          aria-hidden={!coverageOpen}
          tabIndex={coverageOpen ? 0 : -1}
          onClick={() => setCoverageOpen(false)}
          className={`fixed inset-0 z-20 bg-co-text/40 backdrop-blur-sm motion-safe:transition-opacity motion-safe:duration-300 ${coverageOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        />

        <div className="fixed inset-x-0 bottom-0 z-30">
          <div className={`overflow-hidden px-3 motion-safe:transition-[max-height,opacity] motion-safe:duration-300 ${coverageOpen ? "max-h-[70vh] opacity-100" : "max-h-0 opacity-0"}`}>
            <div className="mx-auto max-h-[68vh] max-w-6xl overflow-y-auto rounded-t-3xl border border-co-border bg-co-surface p-4 pb-2 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text">At-a-glance coverage</h2>
                <button type="button" onClick={() => setCoverageOpen(false)} aria-label="Close coverage guide" className="grid h-8 w-8 place-items-center rounded-full bg-co-bg text-lg font-bold text-co-text-dim">×</button>
              </div>
              <div className="-mt-5"><CoveragePanel coverage={coverage} headcount={headcount} setHeadcount={setHeadcount} gapNudge={computeGapNudge(lines, coverage, headcount)} /></div>
            </div>
          </div>

          <div className="border-t border-co-border bg-co-bg/95 backdrop-blur">
            <button
              type="button"
              onClick={() => setCoverageOpen((v) => !v)}
              aria-expanded={coverageOpen}
              className="flex w-full items-center justify-between gap-3 border-b border-co-border/60 px-5 py-2 text-left"
            >
              <span key={hintIdx} className="min-w-0 flex-1 truncate text-xs font-semibold text-co-text transition-opacity duration-500">{hints.length > 0 ? hints[hintIdx % hints.length] : "See who's covered — sizes vs your guest count"}</span>
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm font-extrabold leading-none transition-transform motion-safe:duration-300 ${
                  coverageOpen
                    ? "rotate-180 bg-co-bg text-co-text-dim"
                    : count > 0
                      ? "bg-co-text text-co-gold motion-safe:animate-[cohint_1.7s_ease-in-out_infinite]"
                      : "bg-co-bg text-co-text-dim"
                }`}
                aria-hidden
              >⌃</span>
            </button>
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
              <div className="text-sm"><span className="font-bold text-co-text">{count} item{count === 1 ? "" : "s"}</span><span className="ml-2 text-co-text-muted">{money(displaySubtotalCents)}</span></div>
              <button type="button" onClick={goToReview} disabled={count === 0} className={`inline-flex min-h-[46px] items-center justify-center rounded-full px-6 text-sm font-bold uppercase tracking-[0.08em] transition ${count > 0 ? "bg-co-text text-co-cta hover:bg-co-text/90" : "cursor-not-allowed bg-co-border text-co-text-dim"}`}>Continue →</button>
            </div>
          </div>
        </div>
      </div>

      {modalCard && modalKey && <CustomizeModal card={modalCard} existing={cart[modalKey] ?? null} onClose={() => setModalKey(null)} onSave={(line) => { applyCustom(modalKey, line); setModalKey(null); }} />}

      {/* Gold glow-pulse for the mobile coverage-expand chevron. */}
      <style>{`@keyframes cohint{0%,100%{box-shadow:0 0 0 0 rgba(255,229,96,0)}50%{box-shadow:0 0 0 5px rgba(255,229,96,0.35),0 0 12px 2px rgba(255,229,96,0.6)}}`}</style>
    </div>
  );
}

function coverLabel(served: number, H: number): { text: string; done: boolean; pct: number } {
  const pct = Math.min(100, Math.round((served / Math.max(1, H)) * 100));
  if (served === 0) return { text: "—", done: false, pct: 0 };
  const per = served / Math.max(1, H);
  if (per < 1) return { text: `covers ~${Math.round(served)} of ${H}`, done: false, pct };
  if (per < 1.8) return { text: `✓ one each (~${Math.round(served)})`, done: true, pct };
  if (per < 2.8) return { text: `✓ seconds for all (~${Math.round(served)})`, done: true, pct };
  return { text: `✓ thirds+ (~${Math.round(served)})`, done: true, pct };
}
function Bar({ label, served, headcount, softer }: { label: string; served: number; headcount: number; softer?: boolean }) {
  const c = coverLabel(served, headcount);
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="font-semibold text-co-text">{label}</span><span className={c.done ? "font-bold text-co-success" : "text-co-text-dim"}>{c.text}</span></div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-co-border/50"><div className={`h-full rounded-full ${c.done ? "bg-co-success" : softer ? "bg-co-gold" : "bg-co-text"}`} style={{ width: `${c.pct}%` }} /></div>
    </div>
  );
}

// Ordered over/under guidance — what's LEFT to round out the order (biggest gap first), then a gentle
// upsell, then the all-set close. Desktop shows the whole guide; the mobile bar rotates line by line.
function coverageHints(lines: CartEntry[], coverage: { main: number; side: number; sweet: number; drink: number }, headcount: number): string[] {
  if (lines.length === 0) return [];
  const H = Math.max(1, headcount);
  const hints: string[] = [];
  const n = (v: number) => Math.round(v);

  if (coverage.main < H) hints.push(`Mains cover ~${n(coverage.main)} of ${H} — add more subs so everyone eats.`);
  if (coverage.drink < H) hints.push(coverage.drink === 0 ? `No drinks yet — add a case so no one's parched.` : `Drinks cover ~${n(coverage.drink)} of ${H} — a little more couldn't hurt.`);
  if (coverage.side < H) hints.push(coverage.side === 0 ? `Add sides or chips so it's not just subs — rounds out the spread.` : `Sides cover ~${n(coverage.side)} of ${H} — a little more rounds it out.`);
  if (coverage.sweet === 0) hints.push(`No sweets yet — a tray of cookies or cannoli finishes it off.`);

  if (coverage.main >= H && coverage.main < H * 1.8) hints.push(`Everyone's got a sub — add more so folks can grab seconds. 😋`);
  if (coverage.drink >= H && coverage.drink < H * 1.8) hints.push(`Drinks are set — a little extra for the thirsty ones never hurts.`);
  if (coverage.side >= H && coverage.side < H * 1.8) hints.push(`Sides are covered — a bit more means seconds all around.`);
  if (coverage.sweet > 0 && coverage.sweet < H) hints.push(`A few sweets in — add more so there's one for everyone.`);
  else if (coverage.sweet >= H && coverage.sweet < H * 1.8) hints.push(`Sweets for everyone — a couple extra and no one misses out.`);

  const cats = [coverage.main, coverage.side, coverage.sweet, coverage.drink];
  if (cats.every((c) => c >= H * 1.8)) hints.push(`Set for ${H} with seconds all around. 🎉`);
  if (hints.length === 0) hints.push(`One of everything for ${H} — add more for seconds if you like.`);

  return hints;
}

function computeGapNudge(lines: CartEntry[], coverage: { main: number; side: number; sweet: number; drink: number }, headcount: number): string | null {
  return coverageHints(lines, coverage, headcount)[0] ?? null;
}

// The at-a-glance coverage guide — over/under bars + headcount input + soft nudge. Reused on desktop
// (inside Cart) and mobile (inside the bottom sheet).
function CoveragePanel({ coverage, headcount, setHeadcount, gapNudge }: {
  coverage: { main: number; side: number; sweet: number; drink: number }; headcount: number; setHeadcount: (n: number) => void; gapNudge: string | null;
}) {
  return (
    <div className="mt-5 rounded-2xl bg-co-bg p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Covering</span>
        <label className="flex items-center gap-1.5 text-xs text-co-text-muted">guests<input type="number" min={1} value={headcount || ""} onChange={(e) => setHeadcount(Math.max(0, Number(e.target.value) || 0))} className="w-14 rounded-md border border-co-border-2 bg-co-surface px-2 py-1 text-sm font-bold text-co-text" /></label>
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        <Bar label="Mains" served={coverage.main} headcount={headcount} />
        <Bar label="Sides & chips" served={coverage.side} headcount={headcount} softer />
        <Bar label="Sweets" served={coverage.sweet} headcount={headcount} softer />
        <Bar label="Drinks" served={coverage.drink} headcount={headcount} softer />
      </div>
      {gapNudge && <p className="mt-3 text-xs font-semibold text-co-text">{gapNudge}</p>}
      <p className="mt-1 text-[11px] text-co-text-dim">Not everyone takes a sub, a sweet, or a drink — this is your at-a-glance guide.</p>
    </div>
  );
}

function Cart({ lines, subtotalCents, headcount, setHeadcount, coverage, onCustomize, dec, add, onContinue }: {
  lines: CartEntry[]; subtotalCents: number; headcount: number; setHeadcount: (n: number) => void;
  coverage: { main: number; side: number; sweet: number; drink: number }; onCustomize: (key: string) => void; dec: (key: string) => void; add: (key: string) => void; onContinue: () => void;
}) {
  const gapNudge = computeGapNudge(lines, coverage, headcount);

  return (
    <div className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
      <div className="border-b border-co-border/60 bg-co-text px-6 py-4 text-co-bg"><h2 className="text-lg font-extrabold">Your order</h2></div>
      <div className="p-6">
        {lines.length === 0 ? (
          <p className="text-sm text-co-text-muted">Tap an item to customize, or use + for a quick add. Your order builds here.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((e) => {
              const portionable = isPortionable(e.item);
              const displayCents = unitCents(e.item, e.line);
              return (
                <li key={e.key}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-co-text">{e.item.name}</p><p className="text-xs text-co-text-dim">{money(displayCents)} each</p></div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => dec(e.key)} className="grid h-6 w-6 place-items-center rounded-full bg-co-bg text-sm font-bold text-co-text">−</button>
                      <span className="w-4 text-center text-sm font-bold tabular-nums">{e.line.qty}</span>
                      <button type="button" onClick={() => add(e.key)} className="grid h-6 w-6 place-items-center rounded-full bg-co-text text-sm font-bold text-co-cta">+</button>
                    </div>
                  </div>
                  {lineSummary(e) && <p className="mt-0.5 text-[11px] text-co-text-dim">{lineSummary(e)}</p>}
                  <button type="button" onClick={() => onCustomize(e.key)} className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-co-text-dim underline">{portionable ? "Portion & notes" : "Customize"}</button>
                </li>
              );
            })}
          </ul>
        )}

        {lines.length > 0 && <div className="mt-5 flex items-center justify-between border-t border-co-border pt-4"><span className="text-sm font-semibold text-co-text-muted">Subtotal</span><span className="text-lg font-extrabold text-co-text">{money(subtotalCents)}</span></div>}

        <CoveragePanel coverage={coverage} headcount={headcount} setHeadcount={setHeadcount} gapNudge={gapNudge} />

        {lines.length > 0 && <p className="mt-3 rounded-xl bg-co-bg px-3 py-2 text-xs text-co-text-muted">Deposit locks your date; balance due 48h before. We confirm within a few hours — no charge until we do.</p>}

        <button type="button" onClick={onContinue} disabled={lines.length === 0} className={`mt-5 flex min-h-[52px] w-full items-center justify-center rounded-full text-base font-bold uppercase tracking-[0.08em] transition ${lines.length > 0 ? "bg-co-text text-co-cta hover:bg-co-text/90" : "cursor-not-allowed bg-co-border text-co-text-dim"}`}>Continue to review →</button>
      </div>
    </div>
  );
}

/**
 * Portion selector for portionable subs — ¼ / ½ / whole chips, each showing its per-portion price
 * (from portionPricesCents, cents). Default whole.
 */
function PortionSelector({ item, portion, onChange }: {
  item: CateringMenuItem;
  portion: Portion;
  onChange: (p: Portion) => void;
}) {
  const portions: Portion[] = ["quarter", "half", "whole"];
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim" id="portion-label">Choose your portion</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="portion-label">
        {portions.map((p) => {
          const selected = portion === p;
          const info = PORTION_LABELS[p];
          // PortionSelector only renders for portionable items — price off portionPricesCents directly
          // (no line needed; size is irrelevant here since portionable XOR sized).
          const priceCents = item.portionPricesCents?.[p] ?? item.unitPriceCents;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${info.aria} — ${money(priceCents)}`}
              onClick={() => onChange(p)}
              className={`flex min-w-[72px] flex-col items-center rounded-2xl border-2 px-3 py-2 text-center transition ${
                selected
                  ? "border-co-text bg-co-text text-co-bg"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text/40 hover:text-co-text"
              }`}
            >
              <span className="text-base font-extrabold leading-none">{info.label}</span>
              <span className={`mt-0.5 text-xs font-semibold ${selected ? "text-co-cta" : "text-co-text-dim"}`}>{money(priceCents)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-co-text-dim">Whole = a full sub. ½ and ¼ are great for mixed spreads.</p>
    </div>
  );
}

function Chips({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o);
        return <button key={o} type="button" onClick={() => onToggle(o)} aria-pressed={on} className={`rounded-full border-2 px-3 py-1 text-xs font-bold transition ${on ? "border-co-text bg-co-text/10 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"}`}>{o}</button>;
      })}
    </div>
  );
}

/**
 * Customize modal. Portionable subs get the ¼/½/whole PortionSelector (portion IS persisted).
 * A sized card carries a FIXED size (size = identity — chosen on the menu row, not switched here);
 * the modal shows it read-only. Allergen / special-instructions fields are LOCAL display-only state —
 * they have no server home in 3a and are NOT part of the persisted payload.
 */
function CustomizeModal({ card, existing, onClose, onSave }: { card: MenuCard; existing: Line | null; onClose: () => void; onSave: (line: Line) => void }) {
  const item = card.item;
  const portionable = isPortionable(item);
  const sized = card.sizeId != null;

  // Initialize: a sized card's line always carries its fixed size id (never switched in the modal).
  const initialLine = (): Line => {
    const base = existing ?? emptyLine();
    return sized ? { ...base, sizeId: card.sizeId } : base;
  };

  const [line, setLine] = useState<Line>(initialLine);
  const set = (patch: Partial<Line>) => setLine((l) => ({ ...l, ...patch }));
  const toggleAllergen = (a: string) => set({ allergens: line.allergens.includes(a) ? line.allergens.filter((x) => x !== a) : [...line.allergens, a] });

  const unit = unitCents(item, line);

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} className="fixed inset-0 z-50 flex items-end justify-center bg-co-text/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-t-3xl bg-co-bg shadow-2xl sm:rounded-3xl">
        <div className="max-h-[74vh] overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold text-co-text">{item.name}</h2>
              {item.section && <p className="mt-1 text-sm text-co-text-muted">{item.section}</p>}
            </div>
            <span className="shrink-0 text-lg font-extrabold text-co-cta">{money(card.priceCents)}</span>
          </div>

          {portionable && (
            <div className="mt-5">
              <PortionSelector item={item} portion={line.portion} onChange={(p) => set({ portion: p })} />
            </div>
          )}

          {sized && card.sizeLabel && (
            <div className="mt-5 rounded-2xl border-2 border-co-border-2 bg-co-surface px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Size</p>
              <p className="mt-0.5 text-base font-extrabold text-co-text">{card.sizeLabel} · {money(card.priceCents)}</p>
            </div>
          )}

          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Allergen alert — flag anything a guest can&apos;t have</p>
            <Chips options={ALLERGENS} selected={line.allergens} onToggle={toggleAllergen} />
            <p className="mt-1.5 text-[11px] text-co-text-dim">We&apos;ll confirm exactly how we handle it before you pay.</p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Special instructions</p>
            <textarea value={line.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="e.g. hold the onions, extra hot honey…" className="mt-2 w-full rounded-xl border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm text-co-text" />
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div className="inline-flex items-center gap-3 rounded-full border-2 border-co-border-2 px-2 py-1.5">
              <button type="button" onClick={() => set({ qty: Math.max(1, line.qty - 1) })} className="grid h-8 w-8 place-items-center rounded-full bg-co-surface text-xl font-bold text-co-text">−</button>
              <span className="min-w-6 text-center text-base font-bold tabular-nums">{line.qty}</span>
              <button type="button" onClick={() => set({ qty: line.qty + 1 })} className="grid h-8 w-8 place-items-center rounded-full bg-co-text text-xl font-bold text-co-cta">+</button>
            </div>
            <button type="button" onClick={() => onSave({ ...line, notes: line.notes.trim() })} className="flex min-h-[52px] flex-1 items-center justify-center rounded-full bg-co-text text-base font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90">{existing ? "Update" : "Add"} · {money(unit * line.qty)}</button>
          </div>
          <button type="button" onClick={onClose} className="mt-3 w-full py-2 text-center text-sm font-semibold text-co-text-muted">Cancel</button>
        </div>
      </div>
    </div>
  );
}
