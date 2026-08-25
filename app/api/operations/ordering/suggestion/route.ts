import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { etBusinessDate } from "@/lib/counts-shared";
import { etDayFromDate } from "@/lib/et-day-shared";
import { minutesOfDayEt } from "@/lib/vendor-rhythm-shared";
import { type DayClass } from "@/lib/dynamic-pars-shared";
import {
  DynamicParsError,
  dismissSuggestion,
  revertAutoMove,
  writeParFromSuggestion,
} from "@/lib/dynamic-pars";
import { loadAppliedAutoMove, loadParSuggestions } from "@/lib/dynamic-pars-walker";
import { getServiceRoleClient } from "@/lib/supabase-server";

// THE WALKER'S ONE-TAP VERDICT ON A PAR SUGGESTION.
//
// POST { locationId, skuId, dayClass, generationId, action: "accept"|"dismiss"|"revert" }
//
// AUTHORITY (plan D1/D2): level 7 — the value SKU_WRITE_MIN already carries, which is what
// "GM" means in lib/roles.ts (gm = 7; level 6 is AGM / catering_mgr / prep_mgr /
// social_media_mgr, and the r3 spelling of "GM >= 6" would have handed par authority to the
// Social Media Manager). The suggestion RENDERS at PAR_PASS_MIN (4) for transparency;
// acting on it is the same authority that may edit the par in the admin console today, no
// more and no less. THE LIB IS THE AUTHORITY — `writeParFromSuggestion` / `dismissSuggestion`
// enforce the floor; this handler validates the wire shape, binds the location, and maps
// typed errors, exactly as app/api/operations/ordering/route.ts does for OrderingError.
//
// NO STEP-UP (plan D2, and it is a NARROWING not a loosening): /ordering is an operational
// surface that has never had one, step-up auto-clears on /admin exit, and a password prompt
// at 6 AM on a shelf walk is the affordance's death. The blast radius is strictly smaller
// than the admin overlay route's: one (sku, location, day-class), one value, and that value
// is computed by the SYSTEM and re-derived here — the client never posts a number.
//
// IDEMPOTENCY (plan D14): par_suggestion_actions carries UNIQUE (location, sku, day_class,
// generation_id). The INDEX is the guard — the loser of a double-tap race takes 23505 and
// the lib maps it to 409 suggestion_already_actioned. Same move as the display-code index
// arbitrating the double-generate race in lib/ordering.ts, proven on this surface by SIM-22.

type Action = "accept" | "dismiss" | "revert";
const ACTIONS: ReadonlySet<string> = new Set<Action>(["accept", "dismiss", "revert"]);

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/ordering/suggestion");
  if (ctx instanceof Response) return ctx;

  const b = parsed as {
    locationId?: unknown; skuId?: unknown; dayClass?: unknown;
    generationId?: unknown; action?: unknown;
  };
  if (typeof b.locationId !== "string" || !b.locationId) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  if (typeof b.skuId !== "string" || !b.skuId) {
    return jsonError(400, "invalid_payload", { field: "skuId" });
  }
  if (b.dayClass !== "weekday" && b.dayClass !== "weekend") {
    return jsonError(400, "invalid_payload", { field: "dayClass" });
  }
  if (typeof b.generationId !== "string" || !b.generationId) {
    return jsonError(400, "invalid_payload", { field: "generationId" });
  }
  if (typeof b.action !== "string" || !ACTIONS.has(b.action)) {
    return jsonError(400, "invalid_payload", { field: "action" });
  }
  const action = b.action as Action;
  const postedDayClass: DayClass = b.dayClass;

  // LOCATION-BIND (IDOR), at the same layer /ordering's read does it. A level-7 manager at
  // one shop must not move the other shop's par, and the role floor alone does not say so.
  if (!lockLocationContext({ role: ctx.user.role, locations: ctx.locations }, b.locationId)) {
    return jsonError(404, "not_found", { message: "Location not found" });
  }

  // THE WALK INSTANT, DERIVED SERVER-SIDE (R3-A). The client posts an IDENTITY, never a
  // number and never a horizon: the value written is re-derived here at this instant, so a
  // tampered payload cannot steer the engine, and the 9:58/10:02 pair stays coherent.
  const walkDateEt = etBusinessDate(new Date().toISOString());
  const dayClass = etDayFromDate(walkDateEt).weekend ? "weekend" : "weekday";
  if (postedDayClass !== dayClass) {
    // The walk crossed a day-class boundary between render and tap. Not a client bug and
    // not an error the manager caused — the offer on screen is simply no longer the offer.
    return jsonError(409, "suggestion_superseded", { message: "The walk day changed" });
  }

  try {
    if (action === "revert") {
      // A REVERT UNDOES A REAL WRITE, AND ONLY A REAL WRITE. Without this check a revert
      // would set the PIN on a slot the machine never moved — punishing a future auto-move
      // for something that never happened. In v1 this always refuses, because
      // PAR_AUTO_APPLY_ENABLED is false and no `applied` row can exist; the walker renders
      // the affordance disabled for the same reason, and a disabled button is not a guard.
      const applied = await loadAppliedAutoMove(getServiceRoleClient(), {
        locationId: b.locationId, skuId: b.skuId, dayClass, generationId: b.generationId,
      });
      if (applied == null) {
        return jsonError(409, "nothing_to_revert", {
          message: "No applied auto-move matches this suggestion",
        });
      }
      // value null = drop back to the lane that governed BEFORE the machine wrote. The auto
      // lane only ever governs when the human lane is null, so nulling both restores the
      // exact pre-move par without minting a human override the manager never typed.
      await revertAutoMove(ctx, {
        locationId: b.locationId, skuId: b.skuId, dayClass,
        value: null, generationId: b.generationId,
      });
      return jsonOk({ action, reverted: true });
    }

    // A STALE GENERATION IS A 409, NEVER A SILENT OVERWRITE. The suggestion is re-derived at
    // this instant over the same ledger row the walker read; if the identity has moved
    // since the render, the manager is looking at a number that no longer stands.
    const suggestions = await loadParSuggestions(
      getServiceRoleClient(),
      b.locationId,
      { walkDateEt, walkMinutesEt: minutesOfDayEt(new Date()), dayClass, canAct: true },
    );
    const suggestion = suggestions.get(b.skuId);
    if (suggestion == null || suggestion.generationId !== b.generationId) {
      return jsonError(409, "suggestion_superseded", {
        message: "This suggestion has changed — refresh the walk",
      });
    }
    if (action === "accept") {
      await writeParFromSuggestion({
        actor: ctx,
        actorKind: "accept",
        locationId: b.locationId,
        skuId: b.skuId,
        dayClass,
        // THE SERVER'S NUMBER, not the client's. Nothing in the payload can move a par.
        value: suggestion.suggestedPar,
        generationId: suggestion.generationId,
      });
      return jsonOk({ action, par: suggestion.suggestedPar });
    }

    await dismissSuggestion(ctx, {
      locationId: b.locationId,
      skuId: b.skuId,
      dayClass,
      generationId: suggestion.generationId,
      currentPar: suggestion.currentPar,
    });
    return jsonOk({ action, par: suggestion.currentPar });
  } catch (e) {
    if (e instanceof DynamicParsError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
