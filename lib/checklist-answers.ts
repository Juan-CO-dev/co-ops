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

/**
 * The WRITE gate of the same law — what an answer must look like to save.
 * Returns null when valid, else the human detail for the route's 400.
 * Lives here (pure, client-safe) so the form can pre-validate with the exact
 * server rule; lib/checklists.ts completeItem enforces it server-side.
 */
export function validateAnswerForInputType(
  inputType: "yes_no" | "free_text" | null,
  countValue: number | null | undefined,
  notes: string | null | undefined,
): string | null {
  if (inputType === "yes_no") {
    if (countValue !== 0 && countValue !== 1) return "yes/no answer must set countValue to exactly 0 or 1";
    return null;
  }
  if (inputType === "free_text") {
    if (typeof notes !== "string" || notes.trim().length === 0) return "free-text answer requires non-empty notes";
    return null;
  }
  return null;
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
