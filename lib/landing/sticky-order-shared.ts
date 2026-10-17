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
