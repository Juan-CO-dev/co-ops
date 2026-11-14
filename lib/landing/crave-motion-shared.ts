/** Pure native-scroll math; no wheel interception, timers or forced completion. */
export function craveProgress(top:number,height:number,viewport:number):number {
  const travel=height-viewport;
  return travel<=0?0:Math.max(0,Math.min(1,-top/travel));
}
export function canAnimateCrave({still,reducedMotion,saveData,height}:{still:boolean;reducedMotion:boolean;saveData:boolean;height:number}):boolean {
  return !still&&!reducedMotion&&!saveData&&height>=500;
}
/** Where each word's leader lands on the full-frame L083 cross-section (x, y as fractions of the
 * photo), each read off the approved 960x1440 derivative (laptop polish, Juan 2026-11-13: "spread
 * them out"). Six DIFFERENT spots on five different subs, so no two pointers share a sandwich half:
 * the first three words sit above the photo and point into its upper half, left to right; the last
 * three sit below it and point into its lower half, left to right (GUIDE_WORDS_ABOVE). Every point
 * keeps at least 15% of the photo's width from its sides and 9% of its height from its top/bottom.
 * - bread: the crumb of the middle-left sub's roll
 * - chips: the ripple chips in the top sub
 * - turkey: the folded turkey in the right-hand sub
 * - iceberg: the shredded lettuce in the bottom sub
 * - provolone: the provolone slice over the turkey in the bottom sub
 * - pickles: the pickle chunks under the turkey in the centre sub
 */
export const fieldGuideAnchors=[
  {id:'bread',x:.17,y:.27},
  {id:'chips',x:.40,y:.10},
  {id:'turkey',x:.73,y:.21},
  {id:'iceberg',x:.30,y:.88},
  {id:'provolone',x:.52,y:.825},
  {id:'pickles',x:.735,y:.56},
] as const;
