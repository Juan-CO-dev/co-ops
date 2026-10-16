export const TRANSFER_LIMITS = Object.freeze({critical:250000,poster:100000,javascript:200000,initial:500000,fullScroll:5000000});
/** Compressed bytes from the browser network stack, never filesystem sizes. */
export function checkTransferBudget(measured){
  return Object.entries(TRANSFER_LIMITS).filter(([key,max])=>!Number.isFinite(measured[key])||measured[key]<0||measured[key]>max).map(([key])=>key);
}
