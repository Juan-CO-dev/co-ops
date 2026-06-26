---
title: CO-OPS — Capabilities & The Finish Line
type: capture
system: chief
created: 2026-06-26
tags: [co-ops, strategy, data, finish-line, capabilities, forecasting]
status: living
---

# CO-OPS — Capabilities & The Finish Line

> A single capture of what CO-OPS is, why its data is unusually deep, the **full list of things we can view**, and where the finish line actually is. Every capability traces to a field we already capture (`lib/types.ts`) or a join between fields we already capture.

**Legend for the viewable list:**
`[now]` = buildable today on own data, zero integrations · `[+Toast]` = needs POS connected · `[+invoices]` = needs vendor invoice/price ingestion · `[+7shifts]` = needs scheduling/time-clock · `[+runway]` = needs ~12 weeks–6 months of history · `[+reviews]` / `[+weather]` / `[+competitor]` = needs that external feed.

---

## 1. What CO-OPS is (one paragraph)

CO-OPS is the **digitization layer** for Compliments Only — it captures every shift's operational data *at the source*, by the person doing the work, at the moment they do it, immutably and attributably. The "reports" management reads are not stored documents; they're **computed lenses over granular artifacts, drillable to the individual tap.** The granular truth is the asset. Everything downstream — trends, costing, forecasting, AI — is a lens over the same captured reality, which is why new views cost almost nothing and ask **zero new work of the floor.** (It is *not* BLOC OS — that's the separate autonomy layer. CO-OPS is the data layer that makes autonomy safe.)

## 2. Why the data is unusually deep

Most ops apps capture **events** ("task done ✓"). CO-OPS captures **events + typed reasons + provenance + dual-source truth** — three things almost no restaurant records:

1. **Typed reason-codes on every divergence.** When prep misses plan we store *why* as an enum — under-prep: `ingredient_unavailable / equipment_issue / time_constraint / staff_shortage / other`; over-prep: `management_directive (+who) / clear_fridge_space / prevent_expiration / forecast_busy / bulk_efficiency`. → a **root-cause taxonomy**, not a log.
2. **Dual-source counts.** Every item is counted by the closer at night *and* re-verified by the opener next morning (`closer_count` vs `opener_recount` → `ground_truth`), with a marker of whether the opener agreed or overrode (`spotCheckStatus`). → a built-in **accuracy/trust signal on every count.**
3. **Provenance + accountability everywhere** — `countProvenance` (real count vs morning reconstruction), `actualCompleter` vs `completedBy` (who really did it), `revocationReason`, and a permanent `audit_log` of every state change.

---

## 3. THE FULL LIST — everything we can view

### 💰 Cost & Profitability
- True food cost % (actual purchases vs sales) `[+Toast][+invoices]`
- Theoretical food cost (items sold × recipe × SKU price) `[+Toast][+BOM]`
- Food-cost variance (theoretical vs actual = waste/theft/portioning leak) `[+Toast][+invoices]`
- True labor cost % and sales per labor hour `[+Toast][+7shifts]`
- Plate cost & margin per menu item (recomputed as prices move) `[+invoices][+BOM]`
- Prime cost (food + labor combined) `[+Toast][+invoices]`
- Margin by daypart / location / item `[+Toast]`
- Overtime cost & OT-driver analysis (callouts that created OT) `[now]`/`[+7shifts]`

### 📈 Pricing decisions (when to raise / lower)
- Items priced below target margin → raise-price candidates `[+Toast][+invoices]`
- Vendor price-drift alerts ("chicken up 8% → reprice or substitute") `[+invoices]`
- Margin-vs-market (our price vs competitor price per item) `[+competitor]`
- Price-elasticity signal (volume change after a price change) `[+Toast][+runway]`
- LTO performance (did the limited-time offer make money?) `[+Toast]`
- High-volume / low-margin items (silent profit-killers) `[+Toast][+invoices]`
- Make-vs-buy (prep in-house vs buy prepped) `[+invoices][+BOM]`

### 🥕 Inventory, prep & waste
- Prep accuracy (needed vs made) per item/station/person `[now]`
- Par-tuning recommendations (pars chronically wrong by day-of-week) `[now]`
- Waste $ and waste reasons `[now]`
- Over-prep / under-prep frequency + root causes (typed reason-codes) `[now]`
- Shrinkage (delivered vs theoretical usage vs counted) `[+Toast][+invoices]`
- Depletion / usage curve per item `[now]`
- Items chronically out / 86'd `[now]`
- Invoice-vs-delivery reconciliation (billed for what showed up?) `[+invoices]`

### 💵 Cash & integrity
- Cash variance (over/short) per shift, per closer `[now]` (sharper `[+Toast]`)
- Tip totals & tip trends `[now]`
- Voids count + amount, by person/shift `[now]`
- Comps count + amount + reason `[now]`
- Discount usage patterns `[+Toast]`
- Theft/anomaly flags (recurring shorts tied to a name) `[now]`

### 👥 People & performance
- Per-employee prep accuracy & completion reliability `[now]`
- Closer accuracy score (how often opener overrides their counts) `[now]`
- Credit hygiene (who taps through others' work) `[now]`
- Callout / no-show / drop patterns `[now]`
- Who reliably owns vs drops assignments `[now]`
- Training progress & readiness per trainee `[now]`
- Labor-activity map (who was active, when, doing what — from timestamped taps) `[now]`
- Schedule adherence (scheduled vs actual punch) `[+7shifts]`
- Employee highlights & concerns `[now]`

### ❄️ Equipment & food safety
- Fridge/walk-in temp trends per unit `[now]`
- Predictive maintenance (asset trending toward failure before it dies) `[now]`
- Equipment-caused operational impact ($ cost of a broken unit) `[now]`
- HACCP / health-inspector temp log `[now]`
- Maintenance ticket history & recurring failures `[now]`

### 🚪 Service, delivery & quality
- Sales: total, by daypart, walk-in vs online vs catering `[+Toast]`
- Transaction count & average ticket `[+Toast]`
- Delivery breakdown (DoorDash / UberEats / Toast orders, avg delivery time, driver hours, complaints) `[now]`
- Customer complaints + types `[now]`
- Negative review count + review→cause correlation (bad night ↔ callout/waste/missed opening) `[now]`/`[+reviews]`
- Customer feedback sentiment by day/location `[+QR feedback]`

### 🔮 Forecasting & demand
- Item-level demand forecast by day-of-week / location `[+Toast][+runway]`
- Weather- and event-adjusted demand `[+weather][+runway]`
- Labor forecast → recommended schedule `[+Toast][+7shifts][+runway]`
- Forecast accuracy (were our own predictions right?) `[+runway]`
- Catering pipeline forecast & conversion `[now-partial]`
- Self-closing loop: forecast → par → order → prep → actual → re-forecast `[+Toast][+runway]`

### 🧭 Management roll-ups & cross-cutting
- Daily/weekly/monthly synthesis (computed, drillable to the tap) `[now]`
- Auto-generated weekly **exception** report for Pete (only what needs a decision) `[now→sharper]`
- Cross-location comparison (MEP vs EM on any metric) `[now]`
- Data-quality dashboard (% reconstructed vs real counts, unsupervised closes, late confirmations) `[now]`
- Anomaly detection across everything ("voids spike on X's shifts") `[now]`/`[+Toast]`
- Natural-language querying over the full ledger `[+runway/AI]`
- Full audit trail (who did what, when, every correction) `[now]`
- P&L notes, owner directives, market observations, strategic notes `[now]`

**Headline decisions this drives:** when to **raise/lower a price**, **re-par/re-order**, **switch a vendor**, **repair/replace equipment**, **coach/schedule differently**, and whether an **LTO is worth keeping.**

---

## 4. The compounding engine (why 1 + 1 = 10)

Depth isn't any single feed — it's forcing independent, trustworthy sources to **reconcile**. Every gap between two sources that should agree is money, risk, or a broken process.

| Reconciliation | Sources joined | The gap reveals |
|---|---|---|
| Should-make vs made vs sold vs left | prepNeed → openerPrepped → Toast sales → next-day count | over-prep, waste, theft |
| Cash truth | register + tips → Toast tenders | cash variance, with a name |
| Labor productivity | 7shifts → punches → Toast sales | real labor % + sales/labor-hour |
| Theoretical vs actual food cost | items sold × BOM × price → invoices | the food-cost variance everyone flies blind on |
| Predictive maintenance | temp trend → maintenance log → equipment_issue reasons | a failing asset, before it dies |
| Service-quality cause | reviews/complaints → callouts/waste that day | *why* a bad day happened |

---

## 5. Where the finish line is

**Layered, and each layer has a clear gate:**

- **Layer 1 — own-data intelligence:** available **now**. Mostly a matter of building views over data already captured. (Prep accuracy, par-tuning, root-cause taxonomy, closer-accuracy, temp trends, cash variance, the whole `shift_overlays` signal layer.)
- **Layer 2 — reconciliation:** gated on **connecting Toast** (the single highest-leverage next step) + ingesting **vendor invoices.** This is where food cost, labor cost, shrinkage, and real cash truth light up.
- **Layer 3 — external fusion:** gated on the respective integrations — Toast (scaffolded), 7shifts + geofenced time clock (scaffolded), vendor price ingestion + reviews + weather + competitor (net-new).
- **Layer 4 — forecasting / AI:** gated on a **data runway** — ~12 weeks minimum, ideally 3–6 months — of the granular capture being banked right now.
- **Cross-cutting bridge:** the **SKU/BOM spine** (in active development) is what turns vendor prices into menu-item costs. Finishing it unlocks all Layer-3 unit economics.

**Definition of done (operational):** CO-OPS runs as the primary operational ledger for 3+ months with **no spreadsheets or paper** for shift accountability, cost tracking, or inventory — and the cost/pricing/forecasting views above are live off connected Toast + invoice data.

**Single highest-leverage next move:** connect **Toast.** It's the keystone that unlocks the entire cost-and-pricing cluster (food cost, labor cost, shrinkage, margin, pricing, LTO) the moment it lands.

---

## 6. The true-power line

A spreadsheet is a snapshot someone half-remembers. **CO-OPS is a reconciliation engine that runs every shift — and it only gets sharper the longer it runs.** It captures *what* happened, *why* it diverged (typed reasons), *who* truly did it (provenance), and *whether two independent sources agree* (closer vs opener, count vs sale, schedule vs punch, invoice vs delivery). Today that powers accountability and visibility. Connect Toast + invoices and it powers reconciliation — waste, shrinkage, cash variance, true food cost. Let the data run a few months and it powers forecasting — the self-tightening loop from prediction to par to order to prep to actual. The boring daily checklists are the most valuable thing in the building, because they're quietly building the one thing a restaurant can't buy off the shelf: a truthful, granular, reconciled record of its own operation.
