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
}
export const metaLeadsTenantConfig: MetaLeadsTenantConfig = {
  shopLabels: [
    { label: "Dupont Circle (P Street)", code: "EM" },
    { label: "Capitol Hill", code: "MEP" },
  ],
  deliveryPlaceholderLabels: ["Our catering team picks the closest shop"],
  adSetShop: {},
  defaultShopCode: "MEP",
};
