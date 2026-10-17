/** Pure native-scroll math; no wheel interception, timers or forced completion. */
export function craveProgress(top:number,height:number,viewport:number):number {
  const travel=height-viewport;
  return travel<=0?0:Math.max(0,Math.min(1,-top/travel));
}
export function canAnimateCrave({still,reducedMotion,saveData,height}:{still:boolean;reducedMotion:boolean;saveData:boolean;height:number}):boolean {
  return !still&&!reducedMotion&&!saveData&&height>=500;
}
/** Full-frame L083, visually measured on approved 720x1080 derivative.
 * Labels/ticks remain outside the photo, aligned to these ingredient bands.
 * x records the inspected feature; no marker/leader crosses real food.
 */
export const fieldGuideAnchors=[
  {id:'bread',x:.30,y:.035},
  {id:'chips',x:.37,y:.09},
  {id:'turkey',x:.31,y:.16},
  {id:'iceberg',x:.38,y:.24},
  {id:'pickles',x:.73,y:.56},
  {id:'provolone',x:.51,y:.83},
] as const;
