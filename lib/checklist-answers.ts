/**
 * Fulledit PR-2 — the ONE place a completion's ANSWER is interpreted for
 * display (operator meta stack + reports). Pure, client-safe.
 *
 * The council's guardrail (0165): meaning is never inferred from column
 * overloading — the line's explicit input_type decides how count_value/notes
 * read. Interpretation is historically stable because closing/opening
 * templates version on publish: a completion's template_item_id pins the
 * input_type it was answered under.
 *
 *   yes_no    → count_value 1 = YES, 0 = NO (an answered NO is a real answer,
 *               distinct from unanswered; anything else = defensive tick)
 *   free_text → notes is the answer text
 *   legacy    → count when expects_count, else plain tick
 */
import type { ChecklistCompletion, ChecklistTemplateItem } from "@/lib/types";

export type AnswerKind = "tick" | "count" | "yes" | "no" | "text";

export interface InterpretedAnswer {
  kind: AnswerKind;
  /** count → the number · text → the answer string · yes/no/tick → null. */
  value: number | string | null;
}

export function interpretAnswer(
  item: Pick<ChecklistTemplateItem, "inputType" | "expectsCount">,
  completion: Pick<ChecklistCompletion, "countValue" | "notes"> | null,
): InterpretedAnswer | null {
  if (!completion) return null;
  if (item.inputType === "yes_no") {
    if (completion.countValue === 1) return { kind: "yes", value: null };
    if (completion.countValue === 0) return { kind: "no", value: null };
    // Defensive: a yes_no line can't complete without 0|1 (validateAnswerFor-
    // InputType), but never render a lie for an out-of-contract row.
    return { kind: "tick", value: null };
  }
  if (item.inputType === "free_text") {
    return { kind: "text", value: completion.notes ?? "" };
  }
  if (item.expectsCount) return { kind: "count", value: completion.countValue };
  return { kind: "tick", value: null };
}
