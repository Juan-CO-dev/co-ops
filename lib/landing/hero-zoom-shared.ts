/** 0 at the top of the page, 1 once the hero has scrolled 70% of its height away. */
export function heroZoomProgress(top:number,height:number):number {
  if(!(height>0))return 0;
  return Math.max(0,Math.min(1,-top/(height*.7)));
}
