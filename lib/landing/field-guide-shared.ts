export interface Point {x:number;y:number}
/** A soft S-curve from a word (above) down to its ingredient on the photo. */
export function leaderPath(from:Point,to:Point):string {
  const dy=to.y-from.y;
  const r=(n:number)=>Math.round(n*10)/10;
  return `M${r(from.x)} ${r(from.y)} C${r(from.x)} ${r(from.y+dy*.45)} ${r(to.x)} ${r(to.y-dy*.35)} ${r(to.x)} ${r(to.y)}`;
}
