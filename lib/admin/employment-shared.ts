/**
 * EMPLOYMENT STATUS — the parts that need user management's rule (who may record what). Everything else (the
 * vocabulary, the state, the redaction, the payload, the RPC builder) is `employment-core-shared.ts`, re-exported here.
 * Pure and client-safe; zero I/O.
 */
import { userAdminRefusal, type UserAdminActor, type UserAdminTarget } from "./user-access-shared";
import { rehireRefusal, type ActState, type EmploymentEventKind, type RehireSetting } from "./employment-core-shared";

export * from "./employment-core-shared";

export type EmploymentRefusal =
  | "forbidden" | "target_outside_shop" | "employment_invalid_transition" | "rehire_owner_ok_required" | "rehire_owner_required";

/** May the actor record `act` for the subject in this state (`actStateOf`)? `newRehire` = a correction's new setting. */
export function employmentActRefusal(
  actor: UserAdminActor, subject: UserAdminTarget, act: EmploymentEventKind, state: ActState, newRehire?: RehireSetting,
): EmploymentRefusal | null {
  const base = userAdminRefusal(actor, subject);
  if (base) return base;
  const s = state.status;
  if ((act === "leave_start" && s !== "active") || (act === "separated" && s === "separated") || (act === "leave_end" && s !== "on_leave")
    || (act === "rehired" && s !== "separated") || (act === "correction" && s === "active")) return "employment_invalid_transition";
  const from = state.rehire;
  if (from && act === "rehired") return rehireRefusal(actor.role, from, "yes");
  if (from && act === "correction" && newRehire) return rehireRefusal(actor.role, from, newRehire);
  return null;
}

/** What the screen offers for a person (the server decides again on write). */
export function employmentActionsFor(actor: UserAdminActor, subject: UserAdminTarget, state: ActState): {
  endEmployment: boolean; backFromLeave: boolean; rehire: boolean; correct: boolean;
} {
  const ok = (act: EmploymentEventKind) => employmentActRefusal(actor, subject, act, state) === null;
  return {
    endEmployment: ok("leave_start") || ok("separated"),
    backFromLeave: ok("leave_end"),
    rehire: ok("rehired"),
    correct: ok("correction"),
  };
}

