/**
 * THE PEOPLE-LAYER INPUTS — which NEW inputs feed the legacy score family, per shop. Pure.
 *
 * Scheduling Phase 1, Task 11 Step 4. The legacy numbers (team scoring, person detail, My
 * Performance, the public profile) are a function of the legacy inputs ONLY; the people equivalence
 * pin proves it. Phase 1 adds exactly one new input to that family — PM v2 grades in the gradient
 * tally and the notes count (Task 23) — and it enters only through `PeopleInputs`, resolved per shop
 * (from `people_shop_settings`) by the wrappers and handed to the pure rules as a parameter. OFF by
 * default. Skills are a NEW view and change no legacy number, so they are not an input here.
 */
export interface PeopleInputs {
  pmV2: boolean;
}

/** Every new input off: the legacy numbers, byte-identical to the golden. */
export const LEGACY_INPUTS: PeopleInputs = Object.freeze({ pmV2: false });
