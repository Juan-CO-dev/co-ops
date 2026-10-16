export interface Coordinates { latitude: number; longitude: number }
export function validCoordinates(point: Coordinates | null | undefined): point is Coordinates {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}
/** Great-circle distance only: road routes and walking times are not known. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude-a.latitude)*rad/2)**2 + Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
export function nearestStores<T extends {coordinates: Coordinates | null}>(stores: readonly T[], origin: Coordinates) {
  const measured = stores.map(store=>({...store,distance:validCoordinates(origin) && validCoordinates(store.coordinates) ? distanceKm(origin,store.coordinates) : null}));
  return measured.sort((a,b)=>(a.distance ?? Infinity)-(b.distance ?? Infinity));
}
