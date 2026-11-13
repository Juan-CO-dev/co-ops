/**
 * Meta lead-form tenant DATA (T0 boundary law: code owns BEHAVIOR, tenant config owns VOCABULARY).
 * The option labels a customer sees on the Meta form, the shop each one means, the delivery
 * placeholder ("our team picks"), the ad-set → shop routing table and the default delivery shop
 * all live HERE — never in lib/meta-leads logic. A second tenant edits this file only.
 *
 * Live CO form (2026-11-11): "Catering Inquiry - EN", id 2514347029057258.
 */
export interface MetaLeadsTenantConfig {
  /** Meta option LABEL (or raw code) → `locations.code`. Matched case-insensitively, whitespace-normalized. */
  shopLabels: readonly { label: string; code: string }[];
  /** Delivery placeholder labels = the customer made NO shop choice → the worker routes the lead. */
  deliveryPlaceholderLabels: readonly string[];
  /** Meta ad-set id → `locations.code` (delivery routing rule b). Empty until the geo ad sets exist. */
  adSetShop: Readonly<Record<string, string>>;
  /** Delivery routing rule c: the shop that takes a delivery lead with no history and no ad-set match. */
  defaultShopCode: string;
  /**
   * EXACT Meta `checkbox_key`s of the approved marketing-consent checkbox on the live forms. Meta derives
   * the key from the checkbox LABEL (lowercased, spaces → "_"), so each entry is a fingerprint of
   * consent copy we approved; a copy change means a new key here (a pinned test enforces it).
   */
  consentCheckboxKeys: readonly string[];
  /**
   * Meta question key → our canonical key. The form editor's logic mode names each question after its
   * LABEL ("pickup_or_delivery?") and offers no field-name setting, so each entry is that exact generated
   * key. Published forms never change, so an entry stays correct for the life of its form.
   */
  fieldKeyAliases: Readonly<Record<string, string>>;
  /**
   * The optional "when is your event" answer (question key `event_timing`, form v9) → a short line for
   * staff. Each entry lists every spelling Meta may send for one option — its option KEY and its visible
   * LABEL (matched case-insensitively, "_" = space) — and `rush` marks short notice so the line stands out.
   * An answer matching no entry is kept as typed.
   */
  timingOptions: readonly { answers: readonly string[]; display: string; rush: boolean }[];
}
export const metaLeadsTenantConfig: MetaLeadsTenantConfig = {
  shopLabels: [
    { label: "Dupont Circle (P Street)", code: "EM" },
    { label: "Capitol Hill", code: "MEP" },
    // "Catering Inquiry - EN v2/v3" (logic-mode forms, 2026-11-12).
    { label: "Dupont Circle(P Street)", code: "EM" },
    { label: "Capitol Hill(8th Street)", code: "MEP" },
  ],
  deliveryPlaceholderLabels: ["Our catering team picks the closest shop"],
  adSetShop: {},
  defaultShopCode: "MEP",
  // "Email me news and offers from Compliments Only at my email above. I can unsubscribe anytime." (v3)
  consentCheckboxKeys: ["email_me_news_and_offers_from_compliments_only_at_my_email_above._i_can_unsubscribe_anytime."],
  // "Catering Inquiry - EN v2/v3" (2026-11-12): label-derived keys, read back from the published form.
  fieldKeyAliases: {
    "is_this_for_a_work_or_personal_gathering?": "occasion",
    "pickup_or_delivery?": "fulfillment_method",
    "which_shop?": "preferred_shop",
    "how_many_people_are_you_feeding?": "headcount",
    "should_people_be_able_to_get_seconds?": "seconds",
    "more_than_just_subs?": "extras",
    "company_name?": "company_name",
    "work_email_for_this_order(if_different)?": "work_email",
    "what_is_the_date_of_your_event?(e.g._nov_20)": "event_date",
    "anything_else_we_should_know?(dietary_needs,_timing,_budget)": "notes",
  },
  // "Catering Inquiry - EN v9" (id 1132947982662777, 2026-11-13): the first question. Only the first two
  // can reach us (today / browsing close the form), but each option is listed so none is ever misread.
  timingOptions: [
    { answers: ["timing_48plus", "2+ days out: let's properly plan it"], display: "2+ days out", rush: false },
    { answers: ["timing_24to48", "Tomorrow: short notice, limited menu"], display: "Tomorrow (short notice)", rush: true },
    { answers: ["timing_today", "Today: pickup or delivery, please"], display: "Today", rush: true },
    { answers: ["timing_browsing", "Browsing for more than delicious subs"], display: "Just browsing", rush: false },
  ],
};
