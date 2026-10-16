/** Client-safe job contracts. No I/O, sessions or database rows cross this boundary. */
import type { TranslationKey } from "@/lib/i18n/types";
import type { MenuCostRollup } from "@/lib/menu-costing-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import type { RecipeBuilderSku, RecipeBuilderProduct } from "@/components/admin/recipes/RecipeBuilder";
import { createRequestGuard } from "@/lib/catalog/request-guard-shared";
import { NEW_ITEM_ERROR_CODES, SETUP_STEP_KINDS, type SetupStep } from "@/lib/catalog/new-item-shared";
import { SHOP_OWNED_ERROR_CODES } from "@/lib/catalog/shop-owned-shared";
import { SWAP_ERROR_CODES } from "@/lib/catalog/swap-shared";
import { RECIPE_VERSION_ERROR_CODES } from "@/lib/recipe-versions-shared";

export interface JobScopeView { scope: string | null; shops: Array<{ id: string; name: string }>; allowGlobal: boolean }
export interface JobOwner { ownerLocationId: string | null; ownerShopName: string | null; writeScope: string | null; canEdit: boolean; canShare: boolean }
export interface LiveJobSwap { swapId: string; oldSkuId: string; newSkuId: string; startedAt: string }
export interface JobVendorOptions {
  vendors: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; slug: string; label: string; labelEs: string | null }>;
  orderTypes: Array<{ id: string; slug: string; label: string; labelEs: string | null }>;
  guides: Array<{ id: string; vendorId: string; name: string; updatedAt: string; sections: Array<{ id: string; name: string; position: number }> }>;
  rhythm: Array<{ id: string; vendorId: string; orderDow: number; leadDays: number }>;
}
export interface NewItemJobView extends JobScopeView, JobVendorOptions {}
export interface NewSandwichJobView extends JobScopeView {
  catalog: {
    skus: RecipeBuilderSku[];
    items: Array<{ id: string; name: string }>;
    products: RecipeBuilderProduct[];
    outputItems: Array<{ id: string; name: string }>;
    prices: Array<[string, number]>;
    unitOptions: Array<{ id: string; label: string }>;
    measures: Array<[string, MeasureUnitFactor]>;
    activeMeasureLabels: string[];
  };
}
export interface ItemJobsStripView {
  skuId: string; name: string; scope: string | null; owner: JobOwner; canSwap: boolean; liveSwaps: LiveJobSwap[];
}
export interface SwapVendorJobView extends JobScopeView, JobVendorOptions {
  jobs: ItemJobsStripView;
  replacements: Array<{ id: string; name: string; vendorId: string | null; vendorName: string | null; ownerLocationId: string | null; productId: string | null }>;
}
export interface ToastLinkChoice { guid: string; name: string; price: number | null }
export interface ToastLinkChoices {
  menuItemId: string;
  shopId: string;
  status: "unavailable" | "empty" | "choices" | "suggested" | "linked";
  choices: ToastLinkChoice[];
  suggestion: ToastLinkChoice | null;
  linked: ToastLinkChoice[];
}
export interface CreatedJobItem { skuId: string; ownerLocationId: string | null; replayed: boolean }
export type SetupDayOutcome = { orderDow: number; leadDays: number } & (
  { ok: true; pairId: string } | { ok: false; status: number; code: string; messageKey: string; refreshRequired: boolean }
);
export type JobJson = null | boolean | number | string | JobJson[] | { [key: string]: JobJson };
export interface JobSetupResult { step: SetupStep["kind"]; ok: boolean; detail: { [key: string]: JobJson } }
export interface SetupStepState {
  status: "incomplete" | "saved" | "skipped" | "unconfirmed";
  days: Partial<Record<number, SetupDayOutcome>>;
  errorKey: TranslationKey | null;
  detail: { [key: string]: JobJson };
}
export type SetupState = Record<SetupStep["kind"], SetupStepState>;
export type SetupEvent =
  | { kind: "result"; result: JobSetupResult }
  | { kind: "skip"; step: SetupStep["kind"] }
  | { kind: "failed"; step: SetupStep["kind"]; code: string; uncertain: boolean };

export function initialSetupState(): SetupState {
  return Object.fromEntries(SETUP_STEP_KINDS.map(step => [step, { status: "incomplete", days: {}, errorKey: null, detail: {} }])) as SetupState;
}
function isDayOutcome(value: JobJson): value is SetupDayOutcome & { [key: string]: JobJson } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return typeof value.orderDow === "number" && Number.isInteger(value.orderDow) && value.orderDow >= 0 && value.orderDow <= 6
    && typeof value.leadDays === "number" && (value.ok === true ? typeof value.pairId === "string"
      : value.ok === false && typeof value.status === "number" && typeof value.code === "string" && typeof value.messageKey === "string" && typeof value.refreshRequired === "boolean");
}
/** A result is one durable save. Preserve earlier days/steps when a later writer fails. */
export function setupReducer(state: SetupState, event: SetupEvent): SetupState {
  const step = event.kind === "result" ? event.result.step : event.step;
  const previous = state[step];
  if (event.kind === "skip") return { ...state, [step]: { ...previous, status: previous.status === "saved" ? "saved" : "skipped" } };
  if (event.kind === "failed") return { ...state, [step]: { ...previous, status: event.uncertain ? "unconfirmed" : "incomplete", errorKey: jobErrorKey(event.code) } };
  const { ok, detail } = event.result;
  const days = { ...previous.days };
  const outcomes = Array.isArray(detail.outcomes) ? detail.outcomes : [];
  for (const outcome of outcomes) if (isDayOutcome(outcome)) days[outcome.orderDow] = { ...outcome };
  const invalidDays = step === "order_days" && (!outcomes.length || outcomes.some(outcome => !isDayOutcome(outcome)));
  const refresh = detail.refreshRequired === true || (step === "guide_line" && detail.lineSaved === null)
    || Object.values(days).some(day => day && !day.ok && day.refreshRequired);
  const complete = ok && !invalidDays && Object.values(days).every(day => day?.ok);
  return { ...state, [step]: { days, detail: { ...detail }, status: refresh || invalidDays ? "unconfirmed" : complete ? "saved" : "incomplete",
    errorKey: complete ? null : jobErrorKey(typeof detail.code === "string" ? detail.code : "generic") } };
}

function withScope(path: string, shopId?: string | null): string {
  return shopId === undefined ? path : `${path}?location=${shopId === null ? "global" : encodeURIComponent(shopId)}`;
}
export const newItemJobHref = (shopId?: string | null): string => withScope("/admin/catalog/new/item", shopId);
export const newSandwichJobHref = (shopId?: string | null): string => withScope("/admin/catalog/new/sandwich", shopId);
export const swapVendorJobHref = (skuId: string, shopId?: string | null): string => withScope(`/admin/catalog/sku/${encodeURIComponent(skuId)}/swap`, shopId);

export const JOB_ERROR_CODES = [...new Set<string>([
  ...NEW_ITEM_ERROR_CODES, ...SHOP_OWNED_ERROR_CODES, ...SWAP_ERROR_CODES, ...RECIPE_VERSION_ERROR_CODES,
  "step_up_required", "step_up_stale", "exists", "section_name_taken", "sku_already_placed", "guide_stale", "section_not_found",
  "foreign_section", "foreign_line", "foreign_sku", "guide_not_found", "invalid_code", "vendor_mismatch", "level_differs", "teach_failed", "open_item_guid", "invalid_json",
])];
const jobErrors = new Set(JOB_ERROR_CODES);
/** Never trust a server-supplied message key or interpolate an arbitrary refusal into one. */
export function jobErrorKey(code: string): TranslationKey {
  return jobErrors.has(code) ? `catalog.error.${code}` as TranslationKey : "catalog.error.generic";
}

export function sandwichCostSummary(rollup: MenuCostRollup, menuPrice: number | null) {
  const cost = rollup.status === "costed" && rollup.cost !== null && Number.isFinite(rollup.cost) ? rollup.cost : null;
  const price = menuPrice !== null && Number.isFinite(menuPrice) ? menuPrice : null;
  return { status: rollup.status, cost, pricedCost: rollup.pricedCost,
    foodCostPct: cost !== null && price !== null && price > 0 ? cost / price * 100 : null,
    marginDollars: cost !== null && price !== null ? price - cost : null };
}

export type JobPreviewState<T> = { status: "idle" | "pending" | "failed"; value: null } | { status: "ready"; value: T };
/** Call invalidate immediately on any draft or shop edit, before scheduling a new preview. */
export function createJobPreviewController<T>() {
  const guard = createRequestGuard();
  let state: JobPreviewState<T> = { status: "idle", value: null };
  return {
    getState: (): JobPreviewState<T> => state,
    invalidate() { guard.invalidate(); state = { status: "idle", value: null }; },
    async run(load: () => Promise<T>) {
      state = { status: "pending", value: null };
      const result = await guard.run(async (): Promise<JobPreviewState<T>> => {
        try { return { status: "ready", value: await load() }; }
        catch { return { status: "failed", value: null }; }
      });
      if (result !== null) state = result;
      return result;
    },
  };
}
