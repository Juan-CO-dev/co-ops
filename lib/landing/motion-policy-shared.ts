/** One motion policy for the landing: reduced motion and Save-Data both get the complete
 * static equivalent (no auto-advance, no animated draws, no transitions). Browser-only. */
export function prefersCalm():boolean {
  const saveData=Boolean((navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData);
  return saveData||matchMedia('(prefers-reduced-motion: reduce)').matches;
}
