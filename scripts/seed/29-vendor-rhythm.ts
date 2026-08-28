/**
 * Seed 29 — VENDOR ORDER→DELIVERY RHYTHM: Cristian's schedule, relayed by Juan 2026-08-28,
 * with Juan's answers to the three held questions folded in (same day).
 *
 * Source A, Cristian verbatim (via Juan — "this should be the whole thing more or less"):
 *
 *   "PFG cut off fri by 4 for sat. Mon by 4 for tue. Wed by 4 for thurs. 10 case minimum
 *    Boars head Mon-sat cut off by 3pm No minimum . Leonard paper mon-friday cut off by
 *    3:30 minimum for Leonard $350.
 *    Whisked cookies, Berger, bread we have standing orders for. Usually if we have to
 *    make a change we email or call the vendor to make a change. Id say we would have to
 *    let the vendor know a day before by 3pm if we need to make any changes. We also have
 *    Trimark with we order as needed mon-fri cut off by 6pm the day before $350 minimum"
 *
 * Source B, Juan's rulings on the dry-run's held questions (2026-08-28):
 *
 *   "Boars heads only delivers mon-sat… and you can order mon-Friday with the next day
 *    delivery and 3pm cutoff… on fridays they must order for Saturday and Sunday with the
 *    Saturday delivery.
 *    For trimark it's A… for standing orders the bread is daily to change the standing
 *    order has to be the day before at 3pm… for the other things I'm not sure the rhythm,
 *    but more than likely 1x per week.
 *    We also do need to create those vendors."
 *
 * ── THE FINAL SHAPE ──────────────────────────────────────────────────────────
 *   PFG            EXPLICIT   Fri→Sat, Mon→Tue, Wed→Thu · cutoff 16:00 each order day.
 *   Boar's Head    RULED      order Mon–Fri, next-day, cutoff 15:00 → pairs dows 1–5,
 *                             lead 1. Juan's B SUPERSEDES Cristian's "Mon-sat cutoff":
 *                             there is NO Saturday order — Friday's order covers Sat+Sun
 *                             via the Saturday truck, which the coverage horizon models
 *                             on its own (after Fri→Sat the next truck is Tuesday's).
 *                             NO Saturday cutoff row is written.
 *   Trimark        RULED A    trucks Mon–Fri; order by 18:00 the day before → pairs
 *                             dows 0–4 (Sun–Thu), lead 1 · cutoff 18:00 on those days.
 *   Cardinal       RULED      bread is DAILY on a standing order; the 15:00 day-before
 *                             deadline is the CHANGE window, which at the rhythm grain IS
 *                             an order cutoff → pairs dows 0–6, lead 1, cutoff 15:00.
 *                             (0 par'd SKUs today; the model is ready when bread is.)
 *   Leonard Paper  CREATE+A3  vendor created; pairs dows 1–5 lead 1 (next-day ASSUMED —
 *                             A3, the one assumption Juan's answers did not reach; same
 *                             shape as Boar's Head, correctable on the vendor admin) ·
 *                             cutoff 15:30 dows 1–5. $350 minimum → vendor notes.
 *   Whisked        CREATE     vendor created, rhythm DARK — Juan: "not sure… more than
 *   Berger         CREATE     likely 1x per week" is not a schedule, and a guessed pair
 *                             would fabricate a coverage horizon. The reason lane will
 *                             say `no_vendor_rhythm` if they ever carry par'd SKUs, which
 *                             is the errand naming itself. Standing-order facts → notes.
 *
 *   MINIMUMS still have NO SCHEMA HOME (PFG 10 cases · Leonard $350 · Trimark $350).
 *   Recorded in the NEW vendors' notes; for existing vendors, in this header + the
 *   dispatch docs. The ordering-layer column is a filed follow-up, not smuggled here.
 *
 * ── DRY RUN IS THE DEFAULT ───────────────────────────────────────────────────
 * --execute is lead-gated on Juan's word (given 2026-08-28, source B + "we do need to
 * create those vendors"). The seed REFUSES any vendor that already has active rhythm
 * rows, and refuses to create a vendor whose name already exists.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/29-vendor-rhythm.ts             -> DRY RUN
 *      ... 29-vendor-rhythm.ts --execute              -> WRITES (lead-gated)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

const EXECUTE = process.argv.includes("--execute");

type Pair = { orderDow: number; leadDays: number };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface VendorPlan {
  vendorName: string;
  /** null = must already exist; a string = CREATE with these notes. */
  createWithNotes: string | null;
  category: string | null;
  pairs: Pair[];
  /** order_dow → cutoff "HH:MM"; written location-NULL = shared (0182 asymmetry). */
  cutoffs: Record<number, string>;
  note: string;
}

const PLANS: VendorPlan[] = [
  {
    vendorName: "PFG",
    createWithNotes: null,
    category: null,
    pairs: [
      { orderDow: 5, leadDays: 1 },
      { orderDow: 1, leadDays: 1 },
      { orderDow: 3, leadDays: 1 },
    ],
    cutoffs: { 5: "16:00", 1: "16:00", 3: "16:00" },
    note: "EXPLICIT (Cristian named both sides). 10-case minimum — follow-up, no schema home.",
  },
  {
    vendorName: "Boar's Head",
    createWithNotes: null,
    category: null,
    pairs: [1, 2, 3, 4, 5].map((d) => ({ orderDow: d, leadDays: 1 })),
    cutoffs: { 1: "15:00", 2: "15:00", 3: "15:00", 4: "15:00", 5: "15:00" },
    note: "RULED (Juan B): order Mon–Fri, next-day, 15:00. NO Sat order — Friday covers Sat+Sun via the Sat truck; the horizon models the gap itself.",
  },
  {
    vendorName: "Trimark",
    createWithNotes: null,
    category: null,
    pairs: [0, 1, 2, 3, 4].map((d) => ({ orderDow: d, leadDays: 1 })),
    cutoffs: { 0: "18:00", 1: "18:00", 2: "18:00", 3: "18:00", 4: "18:00" },
    note: "RULED A (Juan B): trucks Mon–Fri, order by 18:00 the day before (Sun–Thu). $350 minimum — follow-up, no schema home.",
  },
  {
    vendorName: "Cardinal Bakery",
    createWithNotes: null,
    category: null,
    pairs: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ orderDow: d, leadDays: 1 })),
    cutoffs: { 0: "15:00", 1: "15:00", 2: "15:00", 3: "15:00", 4: "15:00", 5: "15:00", 6: "15:00" },
    note: "RULED (Juan B): bread daily on a standing order; 15:00 day-before change window IS the cutoff at this grain. 0 par'd SKUs today.",
  },
  {
    vendorName: "Leonard Paper",
    createWithNotes:
      "Paper goods. $350 order minimum. Rhythm: order Mon-Fri, 3:30pm cutoff, next-day delivery ASSUMED (seed 29 A3) - correct on this page if wrong.",
    category: "Packaging",
    pairs: [1, 2, 3, 4, 5].map((d) => ({ orderDow: d, leadDays: 1 })),
    cutoffs: { 1: "15:30", 2: "15:30", 3: "15:30", 4: "15:30", 5: "15:30" },
    note: "CREATED + rhythm with A3 (next-day assumed — the one assumption Juan's answers did not reach).",
  },
  {
    vendorName: "Whisked",
    createWithNotes:
      "Cookies. STANDING ORDER - change by 3pm the day before (call/email). Delivery rhythm unknown (~1x/week per Juan 2026-08-28); author pairs here when known.",
    category: "Bakery",
    pairs: [],
    cutoffs: {},
    note: "CREATED, rhythm DARK — '~1x per week' is not a schedule; a guessed pair fabricates a horizon.",
  },
  {
    vendorName: "Berger",
    createWithNotes:
      "Cookies. STANDING ORDER - change by 3pm the day before (call/email). Delivery rhythm unknown (~1x/week per Juan 2026-08-28); author pairs here when known.",
    category: "Bakery",
    pairs: [],
    cutoffs: {},
    note: "CREATED, rhythm DARK — same as Whisked.",
  },
];

async function main() {
  const sb = getServiceRoleClient();

  const { data: locations, error: lErr } = await sb
    .from("locations").select("id, name").eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`locations: ${lErr.message}`);
  if (!locations || locations.length === 0) throw new Error("no active locations");

  const { data: vendors, error: vErr } = await sb
    .from("vendors").select("id, name").returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`vendors: ${vErr.message}`);
  const vendorByName = new Map((vendors ?? []).map((v) => [v.name, v.id]));

  console.log(`\nSeed 29 (final) — vendor rhythm, Cristian + Juan's rulings 2026-08-28 — ${EXECUTE ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Locations (A1 — same schedule authored to each): ${locations.map((l) => l.name).join(" · ")}\n`);

  for (const plan of PLANS) {
    let vendorId = vendorByName.get(plan.vendorName) ?? null;

    if (plan.createWithNotes != null && vendorId == null) {
      console.log(`＋ ${plan.vendorName} — CREATE vendor (${plan.category ?? "uncategorised"}). Notes carry minimum/standing-order facts.`);
      if (EXECUTE) {
        const { data: created, error } = await sb.from("vendors")
          .insert({
            name: plan.vendorName, category: plan.category,
            notes: plan.createWithNotes, active: true,
          })
          .select("id").maybeSingle<{ id: string }>();
        if (error) throw new Error(`${plan.vendorName} create: ${error.message}`);
        vendorId = created?.id ?? null;
        await audit({
          actorId: null, actorRole: null,
          action: "vendor.create", resourceTable: "vendors", resourceId: vendorId,
          metadata: { name: plan.vendorName, source: "seed-29-cristian-2026-08-28" },
          ipAddress: null, userAgent: null,
        });
      }
    } else if (plan.createWithNotes != null && vendorId != null) {
      console.log(`✗ ${plan.vendorName} — already exists; NOT re-created, notes NOT overwritten.`);
    }

    if (plan.pairs.length === 0) {
      console.log(`⏸ ${plan.vendorName} — rhythm DARK. ${plan.note}`);
      continue;
    }
    if (vendorId == null && !EXECUTE) {
      // Dry run of a to-be-created vendor: report the plan, nothing to guard yet.
      const pairDesc = plan.pairs.map((p) => `${DOW[p.orderDow]}→${DOW[(p.orderDow + p.leadDays) % 7]}`).join(", ");
      console.log(`✓ ${plan.vendorName} — (after create) pairs [${pairDesc}] ×${locations.length} shops · cutoffs ${Object.entries(plan.cutoffs).map(([d, t]) => `${DOW[Number(d)]} ${t}`).join(", ")}`);
      console.log(`  ${plan.note}`);
      continue;
    }
    if (vendorId == null) throw new Error(`${plan.vendorName}: no vendor id at execute time`);

    const { count: existing, error: gErr } = await sb
      .from("vendor_delivery_rhythm")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId).eq("active", true);
    if (gErr) throw new Error(`${plan.vendorName} guard: ${gErr.message}`);
    if ((existing ?? 0) > 0) {
      console.log(`✗ ${plan.vendorName} — REFUSED: ${existing} active rhythm row(s) already exist.`);
      continue;
    }

    const pairDesc = plan.pairs.map((p) => `${DOW[p.orderDow]}→${DOW[(p.orderDow + p.leadDays) % 7]}`).join(", ");
    const cutoffDesc = Object.entries(plan.cutoffs).map(([d, t]) => `${DOW[Number(d)]} ${t}`).join(", ");
    console.log(`✓ ${plan.vendorName} — pairs [${pairDesc}] ×${locations.length} shops · cutoffs (shared): ${cutoffDesc}`);
    console.log(`  ${plan.note}`);

    if (!EXECUTE) continue;

    for (const loc of locations) {
      for (const p of plan.pairs) {
        const { data: row, error } = await sb.from("vendor_delivery_rhythm")
          .insert({
            vendor_id: vendorId, location_id: loc.id,
            order_dow: p.orderDow, lead_days: p.leadDays, active: true, created_by: null,
          })
          .select("id").maybeSingle<{ id: string }>();
        if (error) throw new Error(`${plan.vendorName} pair insert: ${error.message}`);
        await audit({
          actorId: null, actorRole: null,
          action: "vendor.full_profile_edit",
          resourceTable: "vendor_delivery_rhythm", resourceId: row?.id ?? null,
          metadata: {
            scope: "delivery_rhythm", op: "set", source: "seed-29-cristian-2026-08-28",
            vendor_id: vendorId, location_id: loc.id,
            order_dow: p.orderDow, lead_days: p.leadDays,
          },
          ipAddress: null, userAgent: null,
        });
      }
    }
    for (const [dowStr, time] of Object.entries(plan.cutoffs)) {
      const { data: row, error } = await sb.from("vendor_cutoffs")
        .insert({
          vendor_id: vendorId, location_id: null, // shared — the 0182 asymmetry, deliberate
          order_day: Number(dowStr), cutoff_time: time, active: true,
        })
        .select("id").maybeSingle<{ id: string }>();
      if (error) throw new Error(`${plan.vendorName} cutoff insert: ${error.message}`);
      await audit({
        actorId: null, actorRole: null,
        action: "vendor.cutoff_change",
        resourceTable: "vendor_cutoffs", resourceId: row?.id ?? null,
        metadata: {
          scope: "cutoff", op: "set", source: "seed-29-cristian-2026-08-28",
          vendor_id: vendorId, order_day: Number(dowStr), cutoff_time: time,
        },
        ipAddress: null, userAgent: null,
      });
    }
  }

  console.log(`\n${EXECUTE ? "WRITTEN." : "Nothing written (dry run)."}`);
  console.log("Open assumption: A3 (Leonard next-day). Follow-up with no schema home: minimums — PFG 10 cases · Leonard $350 · Trimark $350.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
