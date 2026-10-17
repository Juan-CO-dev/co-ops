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
export const STICKY_SHOW_DWELL_MS = 400;
export const STICKY_RECOVERY_MS = 400;
/** Hero/footer boundaries hide immediately; sustained boundary clearance permits release. */
export function createStickyVisibility() {
  let visible=false, clearSince:number|null=null, hiddenAt=-Infinity;
  return {
    update({now,clearance,heroBottom,suppressed}:{now:number;clearance:number;heroBottom:number;suppressed:boolean}) {
      const dwell=STICKY_SHOW_DWELL_MS;
      if(!heroActionsPassed(heroBottom)||suppressed||clearance<0) {
        if(visible)hiddenAt=now;
        visible=false;clearSince=null;
      } else if(!visible && clearance>=STICKY_SHOW_CLEARANCE && heroBottom<=-STICKY_SHOW_CLEARANCE) {
        clearSince??=now;
        visible=now-clearSince>=dwell && now-hiddenAt>=STICKY_RECOVERY_MS;
      } else if(!visible)clearSince=null;
      const wait=!visible&&clearSince!==null?Math.max(0,dwell-(now-clearSince),STICKY_RECOVERY_MS-(now-hiddenAt)):null;
      return {visible,wait};
    },
  };
}
