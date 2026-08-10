/**
 * Shared FAQ + food-facts content for the customer ordering flow (mockup).
 *
 * Two content types woven through every step:
 *  - FOOD_FACTS / ITEM_FACTS — flavor & provenance (appetite + trust), NEVER dietary claims (D26).
 *  - FAQ — the answer surfaced at the exact moment the question arises.
 * GTK.* are the per-screen "good to know" rotation sets for the companion strip.
 *
 * MOCKUP CONTENT: representative CO copy. In the functional build this plugs into the Wave-1
 * `faq` + `food_facts` config tables (currently empty; editors deferred to menu-authoring day).
 */

// Flavor & provenance — appetite + trust.
export const FOOD_FACTS: string[] = [
  "Everything's built the morning of your event — never the night before.",
  "Our sub rolls come fresh from Cardinal Bakery.",
  "House-made ingredients, sliced and built face-to-face.",
  "“Shredduce” is our house shredded-lettuce blend — on almost everything.",
  "Every platter is an even mix of the Classics.",
  "The Vesuvio is beef & pork meatballs simmered in vodka sauce.",
];

// Item-aware facts, keyed by the builder MENU item id — surfaced when that item is in play.
export const ITEM_FACTS: Record<string, string> = {
  teamster: "Our house Italian — ham, capicola, genoa, hot & sweet peppers.",
  crunchy: "Yes, real potato chips are inside. That's the crunch.",
  hotpants: "Cholula mayo plus hot & sweet peppers — it brings the heat.",
  marisa: "Fresh mozz, basil & arugula, honey chili aioli.",
  vesuvio: "Beef & pork meatballs simmered in vodka sauce, melted mozz.",
  frex: "Five cured meats, prosciutto and fresh mozz — the big one.",
  three: "Three feet of sub from Cardinal Bakery — needs 48 hours' notice.",
  six: "Six freakin' feet of sub — needs 72 hours, worth the notice.",
  p8: "An even mix of the Classics, built the morning of.",
  p16: "An even mix of the Classics, built the morning of.",
  p32: "An even mix of the Classics, built the morning of.",
  p48: "An even mix of the Classics, built the morning of.",
  light: "5-inch sub, chips and water — sorted per person.",
  full: "10-inch sub, chips and water — the hungry option.",
};

// Contextual FAQ — the answer at the exact moment the question arises.
export interface Faq { q: string; a: string }
export const FAQ = {
  count: { q: "What if my headcount changes?", a: "No stress — order for your best guess now, and we confirm the final number with you before the balance is due." },
  changeOrder: { q: "Can I change my order after I place it?", a: "Yes. Until we confirm, just reply to your email or call us and we'll adjust the order and the total." },
  paymentSecure: { q: "Is my payment secure?", a: "Payment runs through Stripe's hosted checkout — Compliments Only never sees or stores your card details." },
  refund: { q: "When am I charged, and what's refundable?", a: "Only the deposit now, to lock your date. If we can't do your date, it's refunded in full. The balance is due up to 48h before." },
  contact: { q: "Need to change something?", a: "Reply to your confirmation email or call (202) 621-8645 — a real person will sort it out." },
} satisfies Record<string, Faq>;

// Per-screen "good to know" companion rotations.
export const GTK = {
  start: [
    "New here? Order for your best-guess headcount — we confirm the final count with you.",
    "Your email is your account — one order history, no passwords.",
    "Delivery across DC, or free pickup at Capitol Hill or Dupont.",
  ],
  review: [
    "Built the morning of your event — never the night before.",
    "Counts flexible? We confirm the final number before the balance is due.",
    "Only the deposit today — the balance is due up to 48h before.",
  ],
} satisfies Record<string, string[]>;
