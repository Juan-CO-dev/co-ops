/**
 * A route refusal → its named message (every refusal named, en + es). Schedule codes map to `schedule.error.<code>`;
 * the step-up and request codes to the board's own lines; anything else is the generic line, never a raw code.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import { isScheduleErrorCode } from "@/lib/scheduling/errors-shared";

const OWN = ["step_up_required", "step_up_stale", "bad_origin", "bad_request", "unauthorized", "internal_error"] as const;

export function scheduleErrorKey(code: unknown): TranslationKey {
  if (typeof code === "string" && isScheduleErrorCode(code)) return `schedule.error.${code}` as TranslationKey;
  if (typeof code === "string" && (OWN as readonly string[]).includes(code)) return `schedule.board.error.${code}` as TranslationKey;
  return "schedule.board.error.generic";
}
