/**
 * Form-internal types for the AM Prep components — Build #2 PR 1.
 *
 * Distinct from the lib/types.ts PrepInputs shape (number-typed numeric
 * fields, matches the JSONB stored on checklist_completions.prep_data.inputs).
 * RawPrepInputs is the in-progress form state: numeric fields stay as strings
 * during typing so partial decimals ("3.", "0.0") and trailing zeros are
 * preserved. AmPrepForm parses to PrepInputs only at submission time.
 *
 * Keys mirror PrepInputs camelCase so the shape stays parallel; the only
 * delta is `onHand | portioned | line | backUp | total` are `string | undefined`
 * here vs `number | undefined` in PrepInputs.
 */

export interface RawPrepInputs {
  /** Operator-typed string (preserves partial decimals during typing). */
  onHand?: string;
  portioned?: string;
  line?: string;
  backUp?: string;
  total?: string;
  /** Boolean flag from Misc-section toggle — already typed correctly, no parse step needed. */
  yesNo?: boolean;
  /** Free-form notes — already typed correctly. */
  freeText?: string;
}
