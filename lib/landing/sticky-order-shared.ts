export function heroActionsPassed(bottom: number): boolean {
  return Number.isFinite(bottom) && bottom < 0;
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function createStickyPreference(storage: () => PreferenceStorage | undefined) {
  let minimized = false;
  let unavailable = false;
  return {
    read() {
      if (unavailable) return minimized;
      try { const value = storage()?.getItem('landing_order_minimized'); if (value !== null && value !== undefined) minimized = value === 'true'; } catch { unavailable = true; }
      return minimized;
    },
    write(value: boolean) {
      minimized = value;
      if (unavailable) return;
      try { storage()?.setItem('landing_order_minimized', String(value)); } catch { unavailable = true; }
    },
  };
}
// Module lifetime preserves the fallback through client navigation.
export const stickyPreference = createStickyPreference(() => window.sessionStorage);

export const STICKY_SHOW_CLEARANCE = 120;
export const STICKY_SHOW_DWELL_MS = 240;
export const STICKY_DIRECTION_RESET = 120;
/** Safety hides are immediate. A deliberate reverse starts a new pass after collision. */
export function createStickyVisibility() {
  let visible=false, latched=false, clearSince:number|null=null;
  let extreme:number|null=null, direction=1;
  return {
    update({y,now,clearance,heroBottom,suppressed}:{y:number;now:number;clearance:number;heroBottom:number;suppressed:boolean}) {
      if(extreme===null)extreme=y;
      if((y-extreme)*direction < -STICKY_DIRECTION_RESET){direction*=-1;extreme=y;latched=false;clearSince=null;}
      else if((y-extreme)*direction>0)extreme=y;
      if(!heroActionsPassed(heroBottom)) {visible=false;latched=false;clearSince=null;}
      else if(suppressed || clearance<0) {
        if(visible)latched=true;
        visible=false;clearSince=null;
      } else if(!visible && !latched && clearance>=STICKY_SHOW_CLEARANCE) {
        clearSince??=now;
        visible=now-clearSince>=STICKY_SHOW_DWELL_MS;
      } else if(!visible)clearSince=null;
      return {visible,wait:!visible&&clearSince!==null?Math.max(0,STICKY_SHOW_DWELL_MS-(now-clearSince)):null};
    },
  };
}