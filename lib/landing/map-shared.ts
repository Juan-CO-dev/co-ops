import type {Coordinates} from './nearby-shared';
export interface MapProjection {lat0:number;lon0:number;kx:number;ky:number;halfMetres:number}
export interface MapPoint {x:number;y:number}
/** Same local projection the map raster was rendered with; fractions of the square. */
export function projectPoint(meta:MapProjection,point:Coordinates):MapPoint {
  const east=(point.longitude-meta.lon0)*meta.kx,north=(point.latitude-meta.lat0)*meta.ky;
  return {x:(east+meta.halfMetres)/(2*meta.halfMetres),y:(meta.halfMetres-north)/(2*meta.halfMetres)};
}
export const insideMap=(point:MapPoint,margin=0)=>point.x>=margin&&point.x<=1-margin&&point.y>=margin&&point.y<=1-margin;
/** Zoom (transform-origin 0 0) that frames every point with padding, never showing past the edge. */
export function fitView(points:readonly MapPoint[],maxScale=3.2):{scale:number;x:number;y:number} {
  if(!points.length)return {scale:1,x:0,y:0};
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const span=Math.max(maxX-minX,maxY-minY,.08);
  const scale=Math.max(1,Math.min(maxScale,.62/span));
  const clamp=(t:number)=>Math.min(0,Math.max(1-scale,t));
  return {scale,x:clamp(.5-(minX+maxX)/2*scale),y:clamp(.5-(minY+maxY)/2*scale)};
}
/** Where an off-map visitor's arrow sits on the frame edge, and which way it points. */
export function edgeMarker(from:MapPoint,to:MapPoint):{x:number;y:number;degrees:number} {
  const angle=Math.atan2(to.y-from.y,to.x-from.x);
  const clamp=(n:number)=>Math.min(.94,Math.max(.06,n));
  return {x:clamp(to.x),y:clamp(to.y),degrees:Math.round(angle*180/Math.PI)};
}
/** Destination-only directions: the maps app chooses the visitor's start point itself,
 * so their location never appears in a URL we build. */
export function directionsHref(address:string,apple:boolean):string {
  const destination=encodeURIComponent(address);
  return apple?`https://maps.apple.com/?daddr=${destination}`:`https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}
