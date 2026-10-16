import 'server-only';
import { ServerResponse } from 'node:http';
const installed=Symbol.for('co.landing.vary-guard');
/** Next 16.2.4 app-page template replaces Vary after proxy/config headers.
 * Preserve ONLY the Host token already set by our proxy. Next still owns its
 * RSC tokens; responses without Host (staff) are byte-for-byte unaffected.
 * Remove when Next merges the prior Vary; production e2e pins that behavior.
 */
export function installLandingVaryGuard():void {
  const prototype=ServerResponse.prototype as ServerResponse & {[installed]?:boolean};
  if(prototype[installed])return;
  const original=prototype.setHeader;
  prototype.setHeader=function(name,value) {
    if(name.toLowerCase()==='vary') {
      const prior=String(this.getHeader('vary')??'').split(',').map(s=>s.trim().toLowerCase());
      const next=(Array.isArray(value)?value.join(', '):String(value)).split(',').map(s=>s.trim());
      if(prior.includes('host')&&!next.some(s=>s.toLowerCase()==='host'||s==='*')) value=[...next,'Host'].join(', ');
    }
    return original.call(this,name,value);
  };
  prototype[installed]=true;
}
