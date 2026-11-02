import type { Language } from "@/lib/i18n/types";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

function copy(messages: typeof en) {
  return {
    title: messages["marketing.adcodes.title"],
    back: messages["marketing.adcodes.back"],
    add: messages["marketing.adcodes.add"],
    code: messages["marketing.adcodes.code"],
    hint: messages["marketing.adcodes.hint"],
    active: messages["marketing.adcodes.active"],
    retired: messages["marketing.adcodes.retired"],
    retire: messages["marketing.adcodes.retire"],
    cancel: messages["marketing.adcodes.cancel"],
    save: messages["marketing.adcodes.save"],
    confirm: messages["marketing.adcodes.confirm"],
    empty: messages["marketing.adcodes.empty"],
    off: messages["marketing.adcodes.off"],
    unavailable: messages["marketing.adcodes.unavailable"],
    saved: messages["marketing.adcodes.saved"],
    error: messages["marketing.adcodes.error"],
    code_invalid: messages["marketing.adcodes.code_invalid"],
    code_reserved: messages["marketing.adcodes.code_reserved"],
    code_taken: messages["marketing.adcodes.code_taken"],
    slots_exhausted: messages["marketing.adcodes.slots_exhausted"],
    code_not_found: messages["marketing.adcodes.code_not_found"],
    already_retired: messages["marketing.adcodes.already_retired"],
    actor_not_allowed: messages["marketing.adcodes.actor_not_allowed"],
    role_not_allowed: messages["marketing.adcodes.role_not_allowed"],
    step_up_required: messages["marketing.adcodes.step_up_required"],
    step_up_stale: messages["marketing.adcodes.step_up_stale"],
    marketing_unavailable: messages["marketing.adcodes.marketing_unavailable"],
  };
}
export const adCodeCopy = { en: copy(en), es: copy(es) };

export function adCodeRefusal(language: Language, code: string): string {
  const messages = adCodeCopy[language];
  return Object.prototype.hasOwnProperty.call(messages, code) ? messages[code as keyof typeof messages] : messages.error;
}
