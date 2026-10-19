/** One motion policy for the landing: reduced motion and Save-Data both get the complete
 * static equivalent (no auto-advance, no animated draws, no transitions). Browser-only. */
export function prefersCalm():boolean {
  const saveData=Boolean((navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData);
  return saveData||matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Calls back whenever reduced motion or Save-Data changes; returns the unsubscribe. */
export function subscribeCalm(callback:(calm:boolean)=>void):()=>void {
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const connection=(navigator as Navigator&{connection?:EventTarget}).connection;
  const fire=()=>callback(prefersCalm());
  media.addEventListener('change',fire);connection?.addEventListener('change',fire);
  return ()=>{media.removeEventListener('change',fire);connection?.removeEventListener('change',fire);};
}
