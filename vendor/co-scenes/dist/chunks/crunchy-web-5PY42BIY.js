var gu=0,xc=1,_u=2;var Ts=1,oo=2,Ir=3,qn=0,We=1,Ue=2,Yn=0,Lr=1,vc=2,yc=3,bc=4,Dr=5;var $i=100,xu=101,vu=102,yu=103,bu=104,Mu=200,ci=201,Su=202,Eu=203,Mc=204,Pi=205,wu=206,Tu=207,Au=208,Ru=209,Cu=210,Pu=211,Iu=212,Lu=213,Du=214,wa=0,Ta=1,Aa=2,br=3,Ra=4,Ca=5,Pa=6,Ia=7,Sc=0,Uu=1,Nu=2,vn=0,Ec=1,wc=2,Tc=3,Ac=4,Rc=5,Cc=6,Pc=7;var Ic=300,Ii=301,Zi=302,lo=303,co=304,As=306,Mr=1e3,Gn=1001,La=1002,Ee=1003,Fu=1004;var Rs=1005;var Le=1006,ho=1007;var $n=1008;var Ve=1009,Lc=1010,Dc=1011,Ur=1012,uo=1013,On=1014,un=1015,Bn=1016,fo=1017,po=1018,Nr=1020,Uc=35902,Nc=35899,Fc=1021,Oc=1022,Xe=1023,Wn=1026,Li=1027,mo=1028,go=1029,Di=1030,_o=1031;var xo=1033,Cs=33776,Ps=33777,Is=33778,Ls=33779,vo=35840,yo=35841,bo=35842,Mo=35843,So=36196,Eo=37492,wo=37496,To=37488,Ao=37489,Ds=37490,Ro=37491,Co=37808,Po=37809,Io=37810,Lo=37811,Do=37812,Uo=37813,No=37814,Fo=37815,Oo=37816,Bo=37817,ko=37818,zo=37819,Ho=37820,Vo=37821,Go=36492,Wo=36494,Xo=36495,qo=36283,Yo=36284,Us=36285,$o=36286;var is=2300,Da=2301,Ea=2302,lc=2303,cc=2400,hc=2401,uc=2402;var Ou=3200,Ns=3201;var Zo=0,Bu=1,sn="",ke="srgb",Gi="srgb-linear",rs="linear",ce="srgb";var si=7680,Fs=7681;var Bc=517;var Os=519,ku=512,zu=513,Hu=514,Jo=515,Vu=516,Gu=517,Ko=518,Wu=519,Xu=35044,Fr=35048;var kc="300 es",Nn=2e3,Sr=2001;function Df(i){for(let t=i.length-1;t>=0;--t)if(i[t]>=65535)return!0;return!1}function Uf(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function ss(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function qu(){let i=ss("canvas");return i.style.display="block",i}var Vh={},Er=null;function zc(...i){let t="THREE."+i.shift();Er?Er("log",t,...i):console.log(t,...i)}function Yu(i){let t=i[0];if(typeof t=="string"&&t.startsWith("TSL:")){let e=i[1];e&&e.isStackTrace?i[0]+=" "+e.getLocation():i[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return i}function kt(...i){i=Yu(i);let t="THREE."+i.shift();if(Er)Er("warn",t,...i);else{let e=i[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...i)}}function Ht(...i){i=Yu(i);let t="THREE."+i.shift();if(Er)Er("error",t,...i);else{let e=i[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...i)}}function Vi(...i){let t=i.join(" ");t in Vh||(Vh[t]=!0,kt(...i))}function $u(i,t,e){return new Promise(function(n,r){function s(){switch(i.clientWaitSync(t,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:r();break;case i.TIMEOUT_EXPIRED:setTimeout(s,e);break;default:n()}}setTimeout(s,e)})}var Zu={[wa]:Ta,[Aa]:Pa,[Ra]:Ia,[br]:Ca,[Ta]:wa,[Pa]:Aa,[Ia]:Ra,[Ca]:br},Xn=class{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){let n=this._listeners;return n===void 0?!1:n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){let n=this._listeners;if(n===void 0)return;let r=n[t];if(r!==void 0){let s=r.indexOf(e);s!==-1&&r.splice(s,1)}}dispatchEvent(t){let e=this._listeners;if(e===void 0)return;let n=e[t.type];if(n!==void 0){t.target=this;let r=n.slice(0);for(let s=0,a=r.length;s<a;s++)r[s].call(this,t);t.target=null}}},Je=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var Fl=Math.PI/180,as=180/Math.PI;function Bs(){let i=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Je[i&255]+Je[i>>8&255]+Je[i>>16&255]+Je[i>>24&255]+"-"+Je[t&255]+Je[t>>8&255]+"-"+Je[t>>16&15|64]+Je[t>>24&255]+"-"+Je[e&63|128]+Je[e>>8&255]+"-"+Je[e>>16&255]+Je[e>>24&255]+Je[n&255]+Je[n>>8&255]+Je[n>>16&255]+Je[n>>24&255]).toLowerCase()}function Qt(i,t,e){return Math.max(t,Math.min(e,i))}function Nf(i,t){return(i%t+t)%t}function Ol(i,t,e){return(1-e)*i+e*t}function $r(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:case Uint8ClampedArray:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function cn(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:case Uint8ClampedArray:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}var Ut=class i{static{i.prototype.isVector2=!0}constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){let e=this.x,n=this.y,r=t.elements;return this.x=r[0]*e+r[3]*n+r[6],this.y=r[1]*e+r[4]*n+r[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Qt(this.x,t.x,e.x),this.y=Qt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Qt(this.x,t,e),this.y=Qt(this.y,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Qt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){let e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;let n=this.dot(t)/e;return Math.acos(Qt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){let n=Math.cos(e),r=Math.sin(e),s=this.x-t.x,a=this.y-t.y;return this.x=s*n-a*r+t.x,this.y=s*r+a*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},en=class{constructor(t=0,e=0,n=0,r=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=r}static slerpFlat(t,e,n,r,s,a,o){let l=n[r+0],c=n[r+1],h=n[r+2],d=n[r+3],f=s[a+0],p=s[a+1],_=s[a+2],b=s[a+3];if(d!==b||l!==f||c!==p||h!==_){let g=l*f+c*p+h*_+d*b;g<0&&(f=-f,p=-p,_=-_,b=-b,g=-g);let m=1-o;if(g<.9995){let E=Math.acos(g),T=Math.sin(E);m=Math.sin(m*E)/T,o=Math.sin(o*E)/T,l=l*m+f*o,c=c*m+p*o,h=h*m+_*o,d=d*m+b*o}else{l=l*m+f*o,c=c*m+p*o,h=h*m+_*o,d=d*m+b*o;let E=1/Math.sqrt(l*l+c*c+h*h+d*d);l*=E,c*=E,h*=E,d*=E}}t[e]=l,t[e+1]=c,t[e+2]=h,t[e+3]=d}static multiplyQuaternionsFlat(t,e,n,r,s,a){let o=n[r],l=n[r+1],c=n[r+2],h=n[r+3],d=s[a],f=s[a+1],p=s[a+2],_=s[a+3];return t[e]=o*_+h*d+l*p-c*f,t[e+1]=l*_+h*f+c*d-o*p,t[e+2]=c*_+h*p+o*f-l*d,t[e+3]=h*_-o*d-l*f-c*p,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,r){return this._x=t,this._y=e,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){let n=t._x,r=t._y,s=t._z,a=t._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(r/2),d=o(s/2),f=l(n/2),p=l(r/2),_=l(s/2);switch(a){case"XYZ":this._x=f*h*d+c*p*_,this._y=c*p*d-f*h*_,this._z=c*h*_+f*p*d,this._w=c*h*d-f*p*_;break;case"YXZ":this._x=f*h*d+c*p*_,this._y=c*p*d-f*h*_,this._z=c*h*_-f*p*d,this._w=c*h*d+f*p*_;break;case"ZXY":this._x=f*h*d-c*p*_,this._y=c*p*d+f*h*_,this._z=c*h*_+f*p*d,this._w=c*h*d-f*p*_;break;case"ZYX":this._x=f*h*d-c*p*_,this._y=c*p*d+f*h*_,this._z=c*h*_-f*p*d,this._w=c*h*d+f*p*_;break;case"YZX":this._x=f*h*d+c*p*_,this._y=c*p*d+f*h*_,this._z=c*h*_-f*p*d,this._w=c*h*d-f*p*_;break;case"XZY":this._x=f*h*d-c*p*_,this._y=c*p*d-f*h*_,this._z=c*h*_+f*p*d,this._w=c*h*d+f*p*_;break;default:kt("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){let n=e/2,r=Math.sin(n);return this._x=t.x*r,this._y=t.y*r,this._z=t.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){let e=t.elements,n=e[0],r=e[4],s=e[8],a=e[1],o=e[5],l=e[9],c=e[2],h=e[6],d=e[10],f=n+o+d;if(f>0){let p=.5/Math.sqrt(f+1);this._w=.25/p,this._x=(h-l)*p,this._y=(s-c)*p,this._z=(a-r)*p}else if(n>o&&n>d){let p=2*Math.sqrt(1+n-o-d);this._w=(h-l)/p,this._x=.25*p,this._y=(r+a)/p,this._z=(s+c)/p}else if(o>d){let p=2*Math.sqrt(1+o-n-d);this._w=(s-c)/p,this._x=(r+a)/p,this._y=.25*p,this._z=(l+h)/p}else{let p=2*Math.sqrt(1+d-n-o);this._w=(a-r)/p,this._x=(s+c)/p,this._y=(l+h)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<1e-8?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Qt(this.dot(t),-1,1)))}rotateTowards(t,e){let n=this.angleTo(t);if(n===0)return this;let r=Math.min(1,e/n);return this.slerp(t,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){let n=t._x,r=t._y,s=t._z,a=t._w,o=e._x,l=e._y,c=e._z,h=e._w;return this._x=n*h+a*o+r*c-s*l,this._y=r*h+a*l+s*o-n*c,this._z=s*h+a*c+n*l-r*o,this._w=a*h-n*o-r*l-s*c,this._onChangeCallback(),this}slerp(t,e){let n=t._x,r=t._y,s=t._z,a=t._w,o=this.dot(t);o<0&&(n=-n,r=-r,s=-s,a=-a,o=-o);let l=1-e;if(o<.9995){let c=Math.acos(o),h=Math.sin(c);l=Math.sin(l*c)/h,e=Math.sin(e*c)/h,this._x=this._x*l+n*e,this._y=this._y*l+r*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this._onChangeCallback()}else this._x=this._x*l+n*e,this._y=this._y*l+r*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this.normalize();return this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){let t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(r*Math.sin(t),r*Math.cos(t),s*Math.sin(e),s*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},U=class i{static{i.prototype.isVector3=!0}constructor(t=0,e=0,n=0){this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(Gh.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(Gh.setFromAxisAngle(t,e))}applyMatrix3(t){let e=this.x,n=this.y,r=this.z,s=t.elements;return this.x=s[0]*e+s[3]*n+s[6]*r,this.y=s[1]*e+s[4]*n+s[7]*r,this.z=s[2]*e+s[5]*n+s[8]*r,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){let e=this.x,n=this.y,r=this.z,s=t.elements,a=1/(s[3]*e+s[7]*n+s[11]*r+s[15]);return this.x=(s[0]*e+s[4]*n+s[8]*r+s[12])*a,this.y=(s[1]*e+s[5]*n+s[9]*r+s[13])*a,this.z=(s[2]*e+s[6]*n+s[10]*r+s[14])*a,this}applyQuaternion(t){let e=this.x,n=this.y,r=this.z,s=t.x,a=t.y,o=t.z,l=t.w,c=2*(a*r-o*n),h=2*(o*e-s*r),d=2*(s*n-a*e);return this.x=e+l*c+a*d-o*h,this.y=n+l*h+o*c-s*d,this.z=r+l*d+s*h-a*c,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){let e=this.x,n=this.y,r=this.z,s=t.elements;return this.x=s[0]*e+s[4]*n+s[8]*r,this.y=s[1]*e+s[5]*n+s[9]*r,this.z=s[2]*e+s[6]*n+s[10]*r,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Qt(this.x,t.x,e.x),this.y=Qt(this.y,t.y,e.y),this.z=Qt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Qt(this.x,t,e),this.y=Qt(this.y,t,e),this.z=Qt(this.z,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Qt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){let n=t.x,r=t.y,s=t.z,a=e.x,o=e.y,l=e.z;return this.x=r*l-s*o,this.y=s*a-n*l,this.z=n*o-r*a,this}projectOnVector(t){let e=t.lengthSq();if(e===0)return this.set(0,0,0);let n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return Bl.copy(this).projectOnVector(t),this.sub(Bl)}reflect(t){return this.sub(Bl.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){let e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;let n=this.dot(t)/e;return Math.acos(Qt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let e=this.x-t.x,n=this.y-t.y,r=this.z-t.z;return e*e+n*n+r*r}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){let r=Math.sin(e)*t;return this.x=r*Math.sin(n),this.y=Math.cos(e)*t,this.z=r*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){let e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){let e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),r=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=r,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Bl=new U,Gh=new en,Gt=class i{static{i.prototype.isMatrix3=!0}constructor(t,e,n,r,s,a,o,l,c){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,r,s,a,o,l,c)}set(t,e,n,r,s,a,o,l,c){let h=this.elements;return h[0]=t,h[1]=r,h[2]=o,h[3]=e,h[4]=s,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){let e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){let e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){let n=t.elements,r=e.elements,s=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],d=n[7],f=n[2],p=n[5],_=n[8],b=r[0],g=r[3],m=r[6],E=r[1],T=r[4],v=r[7],M=r[2],y=r[5],C=r[8];return s[0]=a*b+o*E+l*M,s[3]=a*g+o*T+l*y,s[6]=a*m+o*v+l*C,s[1]=c*b+h*E+d*M,s[4]=c*g+h*T+d*y,s[7]=c*m+h*v+d*C,s[2]=f*b+p*E+_*M,s[5]=f*g+p*T+_*y,s[8]=f*m+p*v+_*C,this}multiplyScalar(t){let e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){let t=this.elements,e=t[0],n=t[1],r=t[2],s=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8];return e*a*h-e*o*c-n*s*h+n*o*l+r*s*c-r*a*l}invert(){let t=this.elements,e=t[0],n=t[1],r=t[2],s=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8],d=h*a-o*c,f=o*l-h*s,p=c*s-a*l,_=e*d+n*f+r*p;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);let b=1/_;return t[0]=d*b,t[1]=(r*c-h*n)*b,t[2]=(o*n-r*a)*b,t[3]=f*b,t[4]=(h*e-r*l)*b,t[5]=(r*s-o*e)*b,t[6]=p*b,t[7]=(n*l-c*e)*b,t[8]=(a*e-n*s)*b,this}transpose(){let t,e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){let e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,r,s,a,o){let l=Math.cos(s),c=Math.sin(s);return this.set(n*l,n*c,-n*(l*a+c*o)+a+t,-r*c,r*l,-r*(-c*a+l*o)+o+e,0,0,1),this}scale(t,e){return Vi("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(kl.makeScale(t,e)),this}rotate(t){return Vi("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(kl.makeRotation(-t)),this}translate(t,e){return Vi("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(kl.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){let e=this.elements,n=t.elements;for(let r=0;r<9;r++)if(e[r]!==n[r])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){let n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}},kl=new Gt,Wh=new Gt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Xh=new Gt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Ff(){let i={enabled:!0,workingColorSpace:Gi,spaces:{},convert:function(r,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===ce&&(r.r=ai(r.r),r.g=ai(r.g),r.b=ai(r.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===ce&&(r.r=yr(r.r),r.g=yr(r.g),r.b=yr(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===sn?rs:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,a){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return Vi("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),i.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return Vi("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),i.colorSpaceToWorking(r,s)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Gi]:{primaries:t,whitePoint:n,transfer:rs,toXYZ:Wh,fromXYZ:Xh,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:ke},outputColorSpaceConfig:{drawingBufferColorSpace:ke}},[ke]:{primaries:t,whitePoint:n,transfer:ce,toXYZ:Wh,fromXYZ:Xh,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:ke}}}),i}var jt=Ff();function ai(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function yr(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var ar,Ua=class{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let n;if(t instanceof HTMLCanvasElement)n=t;else{ar===void 0&&(ar=ss("canvas")),ar.width=t.width,ar.height=t.height;let r=ar.getContext("2d");t instanceof ImageData?r.putImageData(t,0,0):r.drawImage(t,0,0,t.width,t.height),n=ar}return n.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){let e=ss("canvas");e.width=t.width,e.height=t.height;let n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);let r=n.getImageData(0,0,t.width,t.height),s=r.data;for(let a=0;a<s.length;a++)s[a]=ai(s[a]/255)*255;return n.putImageData(r,0,0),e}else if(t.data){let e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(ai(e[n]/255)*255):e[n]=ai(e[n]);return{data:e,width:t.width,height:t.height}}else return kt("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}},Of=0,wr=class{constructor(t=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:Of++}),this.uuid=Bs(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){let e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){let e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];let n={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let a=0,o=r.length;a<o;a++)r[a].isDataTexture?s.push(zl(r[a].image)):s.push(zl(r[a]))}else s=zl(r);n.url=s}return e||(t.images[this.uuid]=n),n}};function zl(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?Ua.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(kt("Texture: Unable to serialize Texture."),{})}var Bf=0,Hl=new U,nn=class i extends Xn{constructor(t=i.DEFAULT_IMAGE,e=i.DEFAULT_MAPPING,n=Gn,r=Gn,s=Le,a=$n,o=Xe,l=Ve,c=i.DEFAULT_ANISOTROPY,h=sn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Bf++}),this.uuid=Bs(),this.name="",this.source=new wr(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=r,this.magFilter=s,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Ut(0,0),this.repeat=new Ut(1,1),this.center=new Ut(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Gt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Hl).x}get height(){return this.source.getSize(Hl).y}get depth(){return this.source.getSize(Hl).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(let e in t){let n=t[e];if(n===void 0){kt(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}let r=this[e];if(r===void 0){kt(`Texture.setValues(): property '${e}' does not exist.`);continue}r&&n&&r.isVector2&&n.isVector2||r&&n&&r.isVector3&&n.isVector3||r&&n&&r.isMatrix3&&n.isMatrix3?r.copy(n):this[e]=n}}toJSON(t){let e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==Ic)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Mr:t.x=t.x-Math.floor(t.x);break;case Gn:t.x=t.x<0?0:1;break;case La:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Mr:t.y=t.y-Math.floor(t.y);break;case Gn:t.y=t.y<0?0:1;break;case La:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};nn.DEFAULT_IMAGE=null;nn.DEFAULT_MAPPING=Ic;nn.DEFAULT_ANISOTROPY=1;var Me=class i{static{i.prototype.isVector4=!0}constructor(t=0,e=0,n=0,r=1){this.x=t,this.y=e,this.z=n,this.w=r}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,r){return this.x=t,this.y=e,this.z=n,this.w=r,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){let e=this.x,n=this.y,r=this.z,s=this.w,a=t.elements;return this.x=a[0]*e+a[4]*n+a[8]*r+a[12]*s,this.y=a[1]*e+a[5]*n+a[9]*r+a[13]*s,this.z=a[2]*e+a[6]*n+a[10]*r+a[14]*s,this.w=a[3]*e+a[7]*n+a[11]*r+a[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);let e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,r,s,l=t.elements,c=l[0],h=l[4],d=l[8],f=l[1],p=l[5],_=l[9],b=l[2],g=l[6],m=l[10];if(Math.abs(h-f)<.01&&Math.abs(d-b)<.01&&Math.abs(_-g)<.01){if(Math.abs(h+f)<.1&&Math.abs(d+b)<.1&&Math.abs(_+g)<.1&&Math.abs(c+p+m-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;let T=(c+1)/2,v=(p+1)/2,M=(m+1)/2,y=(h+f)/4,C=(d+b)/4,x=(_+g)/4;return T>v&&T>M?T<.01?(n=0,r=.707106781,s=.707106781):(n=Math.sqrt(T),r=y/n,s=C/n):v>M?v<.01?(n=.707106781,r=0,s=.707106781):(r=Math.sqrt(v),n=y/r,s=x/r):M<.01?(n=.707106781,r=.707106781,s=0):(s=Math.sqrt(M),n=C/s,r=x/s),this.set(n,r,s,e),this}let E=Math.sqrt((g-_)*(g-_)+(d-b)*(d-b)+(f-h)*(f-h));return Math.abs(E)<.001&&(E=1),this.x=(g-_)/E,this.y=(d-b)/E,this.z=(f-h)/E,this.w=Math.acos((c+p+m-1)/2),this}setFromMatrixPosition(t){let e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Qt(this.x,t.x,e.x),this.y=Qt(this.y,t.y,e.y),this.z=Qt(this.z,t.z,e.z),this.w=Qt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Qt(this.x,t,e),this.y=Qt(this.y,t,e),this.z=Qt(this.z,t,e),this.w=Qt(this.w,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Qt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Na=class extends Xn{constructor(t=1,e=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Le,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=n.depth,this.scissor=new Me(0,0,t,e),this.scissorTest=!1,this.viewport=new Me(0,0,t,e),this.textures=[];let r={width:t,height:e,depth:n.depth},s=new nn(r),a=n.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveColorBuffer=n.resolveColorBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.storeMultisampledColorBuffer=n.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=n.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=n.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(t={}){let e={minFilter:Le,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),t!==null&&t.renderTarget===null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=t,this.textures[r].image.height=e,this.textures[r].image.depth=n,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,n=t.textures.length;e<n;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;let r=Object.assign({},t.textures[e].image);this.textures[e].source=new wr(r)}if(this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveColorBuffer=t.resolveColorBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,this.storeMultisampledColorBuffer=t.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=t.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=t.storeMultisampledStencilBuffer,t.depthTexture!==null)if(t.depthTexture.renderTarget===t){let e=t.depthTexture.clone();e.renderTarget=null,this.depthTexture=e}else this.depthTexture=t.depthTexture;return this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},Ge=class extends Na{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}},os=class extends nn{constructor(t=null,e=1,n=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:r},this.magFilter=Ee,this.minFilter=Ee,this.wrapR=Gn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(t){return super.copy(t),this.wrapR=t.wrapR,this}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}};var Fa=class extends nn{constructor(t=null,e=1,n=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:r},this.magFilter=Ee,this.minFilter=Ee,this.wrapR=Gn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(t){return super.copy(t),this.wrapR=t.wrapR,this}};var ie=class i{static{i.prototype.isMatrix4=!0}constructor(t,e,n,r,s,a,o,l,c,h,d,f,p,_,b,g){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,r,s,a,o,l,c,h,d,f,p,_,b,g)}set(t,e,n,r,s,a,o,l,c,h,d,f,p,_,b,g){let m=this.elements;return m[0]=t,m[4]=e,m[8]=n,m[12]=r,m[1]=s,m[5]=a,m[9]=o,m[13]=l,m[2]=c,m[6]=h,m[10]=d,m[14]=f,m[3]=p,m[7]=_,m[11]=b,m[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(t){let e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){let e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){let e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),n.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();let e=this.elements,n=t.elements,r=1/or.setFromMatrixColumn(t,0).length(),s=1/or.setFromMatrixColumn(t,1).length(),a=1/or.setFromMatrixColumn(t,2).length();return e[0]=n[0]*r,e[1]=n[1]*r,e[2]=n[2]*r,e[3]=0,e[4]=n[4]*s,e[5]=n[5]*s,e[6]=n[6]*s,e[7]=0,e[8]=n[8]*a,e[9]=n[9]*a,e[10]=n[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){let e=this.elements,n=t.x,r=t.y,s=t.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(r),c=Math.sin(r),h=Math.cos(s),d=Math.sin(s);if(t.order==="XYZ"){let f=a*h,p=a*d,_=o*h,b=o*d;e[0]=l*h,e[4]=-l*d,e[8]=c,e[1]=p+_*c,e[5]=f-b*c,e[9]=-o*l,e[2]=b-f*c,e[6]=_+p*c,e[10]=a*l}else if(t.order==="YXZ"){let f=l*h,p=l*d,_=c*h,b=c*d;e[0]=f+b*o,e[4]=_*o-p,e[8]=a*c,e[1]=a*d,e[5]=a*h,e[9]=-o,e[2]=p*o-_,e[6]=b+f*o,e[10]=a*l}else if(t.order==="ZXY"){let f=l*h,p=l*d,_=c*h,b=c*d;e[0]=f-b*o,e[4]=-a*d,e[8]=_+p*o,e[1]=p+_*o,e[5]=a*h,e[9]=b-f*o,e[2]=-a*c,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){let f=a*h,p=a*d,_=o*h,b=o*d;e[0]=l*h,e[4]=_*c-p,e[8]=f*c+b,e[1]=l*d,e[5]=b*c+f,e[9]=p*c-_,e[2]=-c,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){let f=a*l,p=a*c,_=o*l,b=o*c;e[0]=l*h,e[4]=b-f*d,e[8]=_*d+p,e[1]=d,e[5]=a*h,e[9]=-o*h,e[2]=-c*h,e[6]=p*d+_,e[10]=f-b*d}else if(t.order==="XZY"){let f=a*l,p=a*c,_=o*l,b=o*c;e[0]=l*h,e[4]=-d,e[8]=c*h,e[1]=f*d+b,e[5]=a*h,e[9]=p*d-_,e[2]=_*d-p,e[6]=o*h,e[10]=b*d+f}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(kf,t,zf)}lookAt(t,e,n){let r=this.elements;return mn.subVectors(t,e),mn.lengthSq()===0&&(mn.z=1),mn.normalize(),gi.crossVectors(n,mn),gi.lengthSq()===0&&(Math.abs(n.z)===1?mn.x+=1e-4:mn.z+=1e-4,mn.normalize(),gi.crossVectors(n,mn)),gi.normalize(),na.crossVectors(mn,gi),r[0]=gi.x,r[4]=na.x,r[8]=mn.x,r[1]=gi.y,r[5]=na.y,r[9]=mn.y,r[2]=gi.z,r[6]=na.z,r[10]=mn.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){let n=t.elements,r=e.elements,s=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],d=n[5],f=n[9],p=n[13],_=n[2],b=n[6],g=n[10],m=n[14],E=n[3],T=n[7],v=n[11],M=n[15],y=r[0],C=r[4],x=r[8],w=r[12],I=r[1],N=r[5],R=r[9],G=r[13],L=r[2],O=r[6],$=r[10],X=r[14],rt=r[3],q=r[7],K=r[11],st=r[15];return s[0]=a*y+o*I+l*L+c*rt,s[4]=a*C+o*N+l*O+c*q,s[8]=a*x+o*R+l*$+c*K,s[12]=a*w+o*G+l*X+c*st,s[1]=h*y+d*I+f*L+p*rt,s[5]=h*C+d*N+f*O+p*q,s[9]=h*x+d*R+f*$+p*K,s[13]=h*w+d*G+f*X+p*st,s[2]=_*y+b*I+g*L+m*rt,s[6]=_*C+b*N+g*O+m*q,s[10]=_*x+b*R+g*$+m*K,s[14]=_*w+b*G+g*X+m*st,s[3]=E*y+T*I+v*L+M*rt,s[7]=E*C+T*N+v*O+M*q,s[11]=E*x+T*R+v*$+M*K,s[15]=E*w+T*G+v*X+M*st,this}multiplyScalar(t){let e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){let t=this.elements,e=t[0],n=t[4],r=t[8],s=t[12],a=t[1],o=t[5],l=t[9],c=t[13],h=t[2],d=t[6],f=t[10],p=t[14],_=t[3],b=t[7],g=t[11],m=t[15],E=l*p-c*f,T=o*p-c*d,v=o*f-l*d,M=a*p-c*h,y=a*f-l*h,C=a*d-o*h;return e*(b*E-g*T+m*v)-n*(_*E-g*M+m*y)+r*(_*T-b*M+m*C)-s*(_*v-b*y+g*C)}determinantAffine(){let t=this.elements,e=t[0],n=t[4],r=t[8],s=t[1],a=t[5],o=t[9],l=t[2],c=t[6],h=t[10];return e*(a*h-o*c)-n*(s*h-o*l)+r*(s*c-a*l)}transpose(){let t=this.elements,e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){let r=this.elements;return t.isVector3?(r[12]=t.x,r[13]=t.y,r[14]=t.z):(r[12]=t,r[13]=e,r[14]=n),this}invert(){let t=this.elements,e=t[0],n=t[1],r=t[2],s=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8],d=t[9],f=t[10],p=t[11],_=t[12],b=t[13],g=t[14],m=t[15],E=e*o-n*a,T=e*l-r*a,v=e*c-s*a,M=n*l-r*o,y=n*c-s*o,C=r*c-s*l,x=h*b-d*_,w=h*g-f*_,I=h*m-p*_,N=d*g-f*b,R=d*m-p*b,G=f*m-p*g,L=E*G-T*R+v*N+M*I-y*w+C*x;if(L===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let O=1/L;return t[0]=(o*G-l*R+c*N)*O,t[1]=(r*R-n*G-s*N)*O,t[2]=(b*C-g*y+m*M)*O,t[3]=(f*y-d*C-p*M)*O,t[4]=(l*I-a*G-c*w)*O,t[5]=(e*G-r*I+s*w)*O,t[6]=(g*v-_*C-m*T)*O,t[7]=(h*C-f*v+p*T)*O,t[8]=(a*R-o*I+c*x)*O,t[9]=(n*I-e*R-s*x)*O,t[10]=(_*y-b*v+m*E)*O,t[11]=(d*v-h*y-p*E)*O,t[12]=(o*w-a*N-l*x)*O,t[13]=(e*N-n*w+r*x)*O,t[14]=(b*T-_*M-g*E)*O,t[15]=(h*M-d*T+f*E)*O,this}scale(t){let e=this.elements,n=t.x,r=t.y,s=t.z;return e[0]*=n,e[4]*=r,e[8]*=s,e[1]*=n,e[5]*=r,e[9]*=s,e[2]*=n,e[6]*=r,e[10]*=s,e[3]*=n,e[7]*=r,e[11]*=s,this}getMaxScaleOnAxis(){let t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],r=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,r))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){let e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){let n=Math.cos(e),r=Math.sin(e),s=1-n,a=t.x,o=t.y,l=t.z,c=s*a,h=s*o;return this.set(c*a+n,c*o-r*l,c*l+r*o,0,c*o+r*l,h*o+n,h*l-r*a,0,c*l-r*o,h*l+r*a,s*l*l+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,r,s,a){return this.set(1,n,s,0,t,1,a,0,e,r,1,0,0,0,0,1),this}compose(t,e,n){let r=this.elements,s=e._x,a=e._y,o=e._z,l=e._w,c=s+s,h=a+a,d=o+o,f=s*c,p=s*h,_=s*d,b=a*h,g=a*d,m=o*d,E=l*c,T=l*h,v=l*d,M=n.x,y=n.y,C=n.z;return r[0]=(1-(b+m))*M,r[1]=(p+v)*M,r[2]=(_-T)*M,r[3]=0,r[4]=(p-v)*y,r[5]=(1-(f+m))*y,r[6]=(g+E)*y,r[7]=0,r[8]=(_+T)*C,r[9]=(g-E)*C,r[10]=(1-(f+b))*C,r[11]=0,r[12]=t.x,r[13]=t.y,r[14]=t.z,r[15]=1,this}decompose(t,e,n){let r=this.elements;t.x=r[12],t.y=r[13],t.z=r[14];let s=this.determinantAffine();if(s===0)return n.set(1,1,1),e.identity(),this;let a=or.set(r[0],r[1],r[2]).length(),o=or.set(r[4],r[5],r[6]).length(),l=or.set(r[8],r[9],r[10]).length();s<0&&(a=-a),In.copy(this);let c=1/a,h=1/o,d=1/l;return In.elements[0]*=c,In.elements[1]*=c,In.elements[2]*=c,In.elements[4]*=h,In.elements[5]*=h,In.elements[6]*=h,In.elements[8]*=d,In.elements[9]*=d,In.elements[10]*=d,e.setFromRotationMatrix(In),n.x=a,n.y=o,n.z=l,this}makePerspective(t,e,n,r,s,a,o=Nn,l=!1){let c=this.elements,h=2*s/(e-t),d=2*s/(n-r),f=(e+t)/(e-t),p=(n+r)/(n-r),_,b;if(l)_=s/(a-s),b=a*s/(a-s);else if(o===Nn)_=-(a+s)/(a-s),b=-2*a*s/(a-s);else if(o===Sr)_=-a/(a-s),b=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=f,c[12]=0,c[1]=0,c[5]=d,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=_,c[14]=b,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(t,e,n,r,s,a,o=Nn,l=!1){let c=this.elements,h=2/(e-t),d=2/(n-r),f=-(e+t)/(e-t),p=-(n+r)/(n-r),_,b;if(l)_=1/(a-s),b=a/(a-s);else if(o===Nn)_=-2/(a-s),b=-(a+s)/(a-s);else if(o===Sr)_=-1/(a-s),b=-s/(a-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=0,c[12]=f,c[1]=0,c[5]=d,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=_,c[14]=b,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(t){let e=this.elements,n=t.elements;for(let r=0;r<16;r++)if(e[r]!==n[r])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){let n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}},or=new U,In=new ie,kf=new U(0,0,0),zf=new U(1,1,1),gi=new U,na=new U,mn=new U,qh=new ie,Yh=new en,hn=class i{constructor(t=0,e=0,n=0,r=i.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=r}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,r=this._order){return this._x=t,this._y=e,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){let r=t.elements,s=r[0],a=r[4],o=r[8],l=r[1],c=r[5],h=r[9],d=r[2],f=r[6],p=r[10];switch(e){case"XYZ":this._y=Math.asin(Qt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,p),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(f,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Qt(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Qt(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-d,p),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Qt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(f,p),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Qt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(o,p));break;case"XZY":this._z=Math.asin(-Qt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(f,c),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-h,p),this._y=0);break;default:kt("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return qh.makeRotationFromQuaternion(t),this.setFromRotationMatrix(qh,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return Yh.setFromEuler(this),this.setFromQuaternion(Yh,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};hn.DEFAULT_ORDER="XYZ";var ls=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},Hf=0,$h=new U,lr=new en,ti=new ie,ia=new U,Zr=new U,Vf=new U,Gf=new en,Zh=new U(1,0,0),Jh=new U(0,1,0),Kh=new U(0,0,1),jh={type:"added"},Wf={type:"removed"},cr={type:"childadded",child:null},Vl={type:"childremoved",child:null},Ae=class i extends Xn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Hf++}),this.uuid=Bs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let t=new U,e=new hn,n=new en,r=new U(1,1,1);function s(){n.setFromEuler(e,!1)}function a(){e.setFromQuaternion(n,void 0,!1)}e._onChange(s),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new ie},normalMatrix:{value:new Gt}}),this.matrix=new ie,this.matrixWorld=new ie,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ls,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return lr.setFromAxisAngle(t,e),this.quaternion.multiply(lr),this}rotateOnWorldAxis(t,e){return lr.setFromAxisAngle(t,e),this.quaternion.premultiply(lr),this}rotateX(t){return this.rotateOnAxis(Zh,t)}rotateY(t){return this.rotateOnAxis(Jh,t)}rotateZ(t){return this.rotateOnAxis(Kh,t)}translateOnAxis(t,e){return $h.copy(t).applyQuaternion(this.quaternion),this.position.add($h.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(Zh,t)}translateY(t){return this.translateOnAxis(Jh,t)}translateZ(t){return this.translateOnAxis(Kh,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(ti.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?ia.copy(t):ia.set(t,e,n);let r=this.parent;this.updateWorldMatrix(!0,!1),Zr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ti.lookAt(Zr,ia,this.up):ti.lookAt(ia,Zr,this.up),this.quaternion.setFromRotationMatrix(ti),r&&(ti.extractRotation(r.matrixWorld),lr.setFromRotationMatrix(ti),this.quaternion.premultiply(lr.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(Ht("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(jh),cr.child=t,this.dispatchEvent(cr),cr.child=null):Ht("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(Wf),Vl.child=t,this.dispatchEvent(Vl),Vl.child=null),this}removeFromParent(){let t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),ti.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),ti.multiply(t.parent.matrixWorld)),t.applyMatrix4(ti),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(jh),cr.child=t,this.dispatchEvent(cr),cr.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,r=this.children.length;n<r;n++){let a=this.children[n].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);let r=this.children;for(let s=0,a=r.length;s<a;s++)r[s].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Zr,t,Vf),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Zr,Gf,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);let e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}intersectsFrustum(){}traverse(t){t(this);let e=this.children;for(let n=0,r=e.length;n<r;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);let e=this.children;for(let n=0,r=e.length;n<r;n++)e[n].traverseVisible(t)}traverseAncestors(t){let e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let t=this.pivot;if(t!==null){let e=t.x,n=t.y,r=t.z,s=this.matrix.elements;s[12]+=e-s[0]*e-s[4]*n-s[8]*r,s[13]+=n-s[1]*e-s[5]*n-s[9]*r,s[14]+=r-s[2]*e-s[6]*n-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);let e=this.children;for(let n=0,r=e.length;n<r;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e,n=!1){let r=this.parent;if(t===!0&&r!==null&&r.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),e===!0){let s=this.children;for(let a=0,o=s.length;a<o;a++)s[a].updateWorldMatrix(!1,!0,n)}}toJSON(t){let e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,r.name=this.name,r.castShadow=this.castShadow,r.receiveShadow=this.receiveShadow,r.visible=this.visible,r.frustumCulled=this.frustumCulled,r.renderOrder=this.renderOrder,r.static=this.static,r.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(o=>({...o})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(t),r.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(t.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let d=l[c];s(t.shapes,d)}else s(t.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(s(t.materials,this.material[l]));r.material=o}else r.material=s(t.materials,this.material);if(this.children.length>0){r.children=[];for(let o=0;o<this.children.length;o++)r.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){r.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];r.animations.push(s(t.animations,l))}}if(e){let o=a(t.geometries),l=a(t.materials),c=a(t.textures),h=a(t.images),d=a(t.shapes),f=a(t.skeletons),p=a(t.animations),_=a(t.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),d.length>0&&(n.shapes=d),f.length>0&&(n.skeletons=f),p.length>0&&(n.animations=p),_.length>0&&(n.nodes=_)}return n.object=r,n;function a(o){let l=[];for(let c in o){let h=o[c];delete h.metadata,l.push(h)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){let r=t.children[n];this.add(r.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}};Ae.DEFAULT_UP=new U(0,1,0);Ae.DEFAULT_MATRIX_AUTO_UPDATE=!0;Ae.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var He=class extends Ae{constructor(){super(),this.isGroup=!0,this.type="Group"}},Xf={type:"move"},Tr=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new He,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new He,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new U,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new U),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new He,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new U,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new U,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){let e=this._hand;if(e)for(let n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let r=null,s=null,a=null,o=this._targetRay,l=this._grip,c=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(c&&t.hand){a=!0;for(let b of t.hand.values()){let g=e.getJointPose(b,n),m=this._getHandJoint(c,b);g!==null&&(m.matrix.fromArray(g.transform.matrix),m.matrix.decompose(m.position,m.rotation,m.scale),m.matrixWorldNeedsUpdate=!0,m.jointRadius=g.radius),m.visible=g!==null}let h=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],f=h.position.distanceTo(d.position),p=.02,_=.005;c.inputState.pinching&&f>p+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!c.inputState.pinching&&f<=p-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(s=e.getPose(t.gripSpace,n),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:t,target:this})));o!==null&&(r=e.getPose(t.targetRaySpace,n),r===null&&s!==null&&(r=s),r!==null&&(o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,r.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(r.linearVelocity)):o.hasLinearVelocity=!1,r.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(r.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(Xf)))}return o!==null&&(o.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){let n=new He;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}},Ju={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},_i={h:0,s:0,l:0},ra={h:0,s:0,l:0};function Gl(i,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?i+(t-i)*6*e:e<1/2?t:e<2/3?i+(t-i)*6*(2/3-e):i}var Xt=class{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){let r=t;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=ke){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,jt.colorSpaceToWorking(this,e),this}setRGB(t,e,n,r=jt.workingColorSpace){return this.r=t,this.g=e,this.b=n,jt.colorSpaceToWorking(this,r),this}setHSL(t,e,n,r=jt.workingColorSpace){if(t=Nf(t,1),e=Qt(e,0,1),n=Qt(n,0,1),e===0)this.r=this.g=this.b=n;else{let s=n<=.5?n*(1+e):n+e-n*e,a=2*n-s;this.r=Gl(a,s,t+1/3),this.g=Gl(a,s,t),this.b=Gl(a,s,t-1/3)}return jt.colorSpaceToWorking(this,r),this}setStyle(t,e=ke){function n(s){s!==void 0&&parseFloat(s)<1&&kt("Color: Alpha component of "+t+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(t)){let s,a=r[1],o=r[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,e);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,e);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,e);break;default:kt("Color: Unknown color model "+t)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(t)){let s=r[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(s,16),e);kt("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=ke){let n=Ju[t.toLowerCase()];return n!==void 0?this.setHex(n,e):kt("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=ai(t.r),this.g=ai(t.g),this.b=ai(t.b),this}copyLinearToSRGB(t){return this.r=yr(t.r),this.g=yr(t.g),this.b=yr(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=ke){return jt.workingToColorSpace(Ke.copy(this),t),Math.round(Qt(Ke.r*255,0,255))*65536+Math.round(Qt(Ke.g*255,0,255))*256+Math.round(Qt(Ke.b*255,0,255))}getHexString(t=ke){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=jt.workingColorSpace){jt.workingToColorSpace(Ke.copy(this),e);let n=Ke.r,r=Ke.g,s=Ke.b,a=Math.max(n,r,s),o=Math.min(n,r,s),l,c,h=(o+a)/2;if(o===a)l=0,c=0;else{let d=a-o;switch(c=h<=.5?d/(a+o):d/(2-a-o),a){case n:l=(r-s)/d+(r<s?6:0);break;case r:l=(s-n)/d+2;break;case s:l=(n-r)/d+4;break}l/=6}return t.h=l,t.s=c,t.l=h,t}getRGB(t,e=jt.workingColorSpace){return jt.workingToColorSpace(Ke.copy(this),e),t.r=Ke.r,t.g=Ke.g,t.b=Ke.b,t}getStyle(t=ke){jt.workingToColorSpace(Ke.copy(this),t);let e=Ke.r,n=Ke.g,r=Ke.b;return t!==ke?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(r*255)})`}offsetHSL(t,e,n){return this.getHSL(_i),this.setHSL(_i.h+t,_i.s+e,_i.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(_i),t.getHSL(ra);let n=Ol(_i.h,ra.h,e),r=Ol(_i.s,ra.s,e),s=Ol(_i.l,ra.l,e);return this.setHSL(n,r,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){let e=this.r,n=this.g,r=this.b,s=t.elements;return this.r=s[0]*e+s[3]*n+s[6]*r,this.g=s[1]*e+s[4]*n+s[7]*r,this.b=s[2]*e+s[5]*n+s[8]*r,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Ke=new Xt;Xt.NAMES=Ju;var Fn=class extends Ae{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new hn,this.environmentIntensity=1,this.environmentRotation=new hn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){let e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),e.object.backgroundBlurriness=this.backgroundBlurriness,e.object.backgroundIntensity=this.backgroundIntensity,e.object.backgroundRotation=this.backgroundRotation.toArray(),e.object.environmentIntensity=this.environmentIntensity,e.object.environmentRotation=this.environmentRotation.toArray(),e}},Ln=new U,ei=new U,Wl=new U,ni=new U,hr=new U,ur=new U,Qh=new U,Xl=new U,ql=new U,Yl=new U,$l=new Me,Zl=new Me,Jl=new Me,bi=class i{constructor(t=new U,e=new U,n=new U){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,r){r.subVectors(n,e),Ln.subVectors(t,e),r.cross(Ln);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(t,e,n,r,s){Ln.subVectors(r,e),ei.subVectors(n,e),Wl.subVectors(t,e);let a=Ln.dot(Ln),o=Ln.dot(ei),l=Ln.dot(Wl),c=ei.dot(ei),h=ei.dot(Wl),d=a*c-o*o;if(d===0)return s.set(0,0,0),null;let f=1/d,p=(c*l-o*h)*f,_=(a*h-o*l)*f;return s.set(1-p-_,_,p)}static containsPoint(t,e,n,r){return this.getBarycoord(t,e,n,r,ni)===null?!1:ni.x>=0&&ni.y>=0&&ni.x+ni.y<=1}static getInterpolation(t,e,n,r,s,a,o,l){return this.getBarycoord(t,e,n,r,ni)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,ni.x),l.addScaledVector(a,ni.y),l.addScaledVector(o,ni.z),l)}static getInterpolatedAttribute(t,e,n,r,s,a){return $l.setScalar(0),Zl.setScalar(0),Jl.setScalar(0),$l.fromBufferAttribute(t,e),Zl.fromBufferAttribute(t,n),Jl.fromBufferAttribute(t,r),a.setScalar(0),a.addScaledVector($l,s.x),a.addScaledVector(Zl,s.y),a.addScaledVector(Jl,s.z),a}static isFrontFacing(t,e,n,r){return Ln.subVectors(n,e),ei.subVectors(t,e),Ln.cross(ei).dot(r)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,r){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[r]),this}setFromAttributeAndIndices(t,e,n,r){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,r),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Ln.subVectors(this.c,this.b),ei.subVectors(this.a,this.b),Ln.cross(ei).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return i.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return i.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,r,s){return i.getInterpolation(t,this.a,this.b,this.c,e,n,r,s)}containsPoint(t){return i.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return i.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){let n=this.a,r=this.b,s=this.c,a,o;hr.subVectors(r,n),ur.subVectors(s,n),Xl.subVectors(t,n);let l=hr.dot(Xl),c=ur.dot(Xl);if(l<=0&&c<=0)return e.copy(n);ql.subVectors(t,r);let h=hr.dot(ql),d=ur.dot(ql);if(h>=0&&d<=h)return e.copy(r);let f=l*d-h*c;if(f<=0&&l>=0&&h<=0)return a=l/(l-h),e.copy(n).addScaledVector(hr,a);Yl.subVectors(t,s);let p=hr.dot(Yl),_=ur.dot(Yl);if(_>=0&&p<=_)return e.copy(s);let b=p*c-l*_;if(b<=0&&c>=0&&_<=0)return o=c/(c-_),e.copy(n).addScaledVector(ur,o);let g=h*_-p*d;if(g<=0&&d-h>=0&&p-_>=0)return Qh.subVectors(s,r),o=(d-h)/(d-h+(p-_)),e.copy(r).addScaledVector(Qh,o);let m=1/(g+b+f);return a=b*m,o=f*m,e.copy(n).addScaledVector(hr,a).addScaledVector(ur,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},wn=class{constructor(t=new U(1/0,1/0,1/0),e=new U(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(Dn.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(Dn.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){let n=Dn.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);let n=t.geometry;if(n!==void 0){let s=n.getAttribute("position");if(e===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,Dn):Dn.fromBufferAttribute(s,a),Dn.applyMatrix4(t.matrixWorld),this.expandByPoint(Dn);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),sa.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),sa.copy(n.boundingBox)),sa.applyMatrix4(t.matrixWorld),this.union(sa)}let r=t.children;for(let s=0,a=r.length;s<a;s++)this.expandByObject(r[s],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Dn),Dn.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Jr),aa.subVectors(this.max,Jr),dr.subVectors(t.a,Jr),fr.subVectors(t.b,Jr),pr.subVectors(t.c,Jr),xi.subVectors(fr,dr),vi.subVectors(pr,fr),Bi.subVectors(dr,pr);let e=[0,-xi.z,xi.y,0,-vi.z,vi.y,0,-Bi.z,Bi.y,xi.z,0,-xi.x,vi.z,0,-vi.x,Bi.z,0,-Bi.x,-xi.y,xi.x,0,-vi.y,vi.x,0,-Bi.y,Bi.x,0];return!Kl(e,dr,fr,pr,aa)||(e=[1,0,0,0,1,0,0,0,1],!Kl(e,dr,fr,pr,aa))?!1:(oa.crossVectors(xi,vi),e=[oa.x,oa.y,oa.z],Kl(e,dr,fr,pr,aa))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Dn).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Dn).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(ii[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),ii[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),ii[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),ii[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),ii[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),ii[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),ii[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),ii[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(ii),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}},ii=[new U,new U,new U,new U,new U,new U,new U,new U],Dn=new U,sa=new wn,dr=new U,fr=new U,pr=new U,xi=new U,vi=new U,Bi=new U,Jr=new U,aa=new U,oa=new U,ki=new U;function Kl(i,t,e,n,r){for(let s=0,a=i.length-3;s<=a;s+=3){ki.fromArray(i,s);let o=r.x*Math.abs(ki.x)+r.y*Math.abs(ki.y)+r.z*Math.abs(ki.z),l=t.dot(ki),c=e.dot(ki),h=n.dot(ki);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}var Ie=new U,la=new Ut,qf=0,De=class extends Xn{constructor(t,e,n=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:qf++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=Xu,this.updateRanges=[],this.gpuType=un,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[t+r]=e.array[n+r];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)la.fromBufferAttribute(this,e),la.applyMatrix3(t),this.setXY(e,la.x,la.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)Ie.fromBufferAttribute(this,e),Ie.applyMatrix3(t),this.setXYZ(e,Ie.x,Ie.y,Ie.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)Ie.fromBufferAttribute(this,e),Ie.applyMatrix4(t),this.setXYZ(e,Ie.x,Ie.y,Ie.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)Ie.fromBufferAttribute(this,e),Ie.applyNormalMatrix(t),this.setXYZ(e,Ie.x,Ie.y,Ie.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)Ie.fromBufferAttribute(this,e),Ie.transformDirection(t),this.setXYZ(e,Ie.x,Ie.y,Ie.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=$r(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=cn(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=$r(e,this.array)),e}setX(t,e){return this.normalized&&(e=cn(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=$r(e,this.array)),e}setY(t,e){return this.normalized&&(e=cn(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=$r(e,this.array)),e}setZ(t,e){return this.normalized&&(e=cn(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=$r(e,this.array)),e}setW(t,e){return this.normalized&&(e=cn(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=cn(e,this.array),n=cn(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,r){return t*=this.itemSize,this.normalized&&(e=cn(e,this.array),n=cn(n,this.array),r=cn(r,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=r,this}setXYZW(t,e,n,r,s){return t*=this.itemSize,this.normalized&&(e=cn(e,this.array),n=cn(n,this.array),r=cn(r,this.array),s=cn(s,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=r,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return t.name=this.name,t.usage=this.usage,t.gpuType=this.gpuType,t}dispose(){this.dispatchEvent({type:"dispose"})}};var cs=class extends De{constructor(t,e,n){super(new Uint16Array(t),e,n)}};var hs=class extends De{constructor(t,e,n){super(new Uint32Array(t),e,n)}};var re=class extends De{constructor(t,e,n){super(new Float32Array(t),e,n)}},Yf=new wn,Kr=new U,jl=new U,oi=class{constructor(t=new U,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){let n=this.center;e!==void 0?n.copy(e):Yf.setFromPoints(t).getCenter(n);let r=0;for(let s=0,a=t.length;s<a;s++)r=Math.max(r,n.distanceToSquared(t[s]));return this.radius=Math.sqrt(r),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){let e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){let n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Kr.subVectors(t,this.center);let e=Kr.lengthSq();if(e>this.radius*this.radius){let n=Math.sqrt(e),r=(n-this.radius)*.5;this.center.addScaledVector(Kr,r/n),this.radius+=r}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(jl.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Kr.copy(t.center).add(jl)),this.expandByPoint(Kr.copy(t.center).sub(jl))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}},$f=0,En=new ie,Ql=new Ae,mr=new U,gn=new wn,jr=new wn,Be=new U,we=class i extends Xn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:$f++}),this.uuid=Bs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Df(t)?hs:cs)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){let e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let s=new Gt().getNormalMatrix(t);n.applyNormalMatrix(s),n.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(t),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return En.makeRotationFromQuaternion(t),this.applyMatrix4(En),this}rotateX(t){return En.makeRotationX(t),this.applyMatrix4(En),this}rotateY(t){return En.makeRotationY(t),this.applyMatrix4(En),this}rotateZ(t){return En.makeRotationZ(t),this.applyMatrix4(En),this}translate(t,e,n){return En.makeTranslation(t,e,n),this.applyMatrix4(En),this}scale(t,e,n){return En.makeScale(t,e,n),this.applyMatrix4(En),this}lookAt(t){return Ql.lookAt(t),Ql.updateMatrix(),this.applyMatrix4(Ql.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(mr).negate(),this.translate(mr.x,mr.y,mr.z),this}setFromPoints(t){let e=this.getAttribute("position");if(e===void 0){let n=[];for(let r=0,s=t.length;r<s;r++){let a=t[r];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new re(n,3))}else{let n=Math.min(t.length,e.count);for(let r=0;r<n;r++){let s=t[r];e.setXYZ(r,s.x,s.y,s.z||0)}t.length>e.count&&kt("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new wn);let t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Ht("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new U(-1/0,-1/0,-1/0),new U(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,r=e.length;n<r;n++){let s=e[n];gn.setFromBufferAttribute(s),this.morphTargetsRelative?(Be.addVectors(this.boundingBox.min,gn.min),this.boundingBox.expandByPoint(Be),Be.addVectors(this.boundingBox.max,gn.max),this.boundingBox.expandByPoint(Be)):(this.boundingBox.expandByPoint(gn.min),this.boundingBox.expandByPoint(gn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Ht('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new oi);let t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Ht("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new U,1/0);return}if(t){let n=this.boundingSphere.center;if(gn.setFromBufferAttribute(t),e)for(let s=0,a=e.length;s<a;s++){let o=e[s];jr.setFromBufferAttribute(o),this.morphTargetsRelative?(Be.addVectors(gn.min,jr.min),gn.expandByPoint(Be),Be.addVectors(gn.max,jr.max),gn.expandByPoint(Be)):(gn.expandByPoint(jr.min),gn.expandByPoint(jr.max))}gn.getCenter(n);let r=0;for(let s=0,a=t.count;s<a;s++)Be.fromBufferAttribute(t,s),r=Math.max(r,n.distanceToSquared(Be));if(e)for(let s=0,a=e.length;s<a;s++){let o=e[s],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)Be.fromBufferAttribute(o,c),l&&(mr.fromBufferAttribute(t,c),Be.add(mr)),r=Math.max(r,n.distanceToSquared(Be))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&Ht('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){Ht("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=e.position,r=e.normal,s=e.uv,a=this.getAttribute("tangent");(a===void 0||a.count!==n.count)&&(a=new De(new Float32Array(4*n.count),4),this.setAttribute("tangent",a));let o=[],l=[];for(let x=0;x<n.count;x++)o[x]=new U,l[x]=new U;let c=new U,h=new U,d=new U,f=new Ut,p=new Ut,_=new Ut,b=new U,g=new U;function m(x,w,I){c.fromBufferAttribute(n,x),h.fromBufferAttribute(n,w),d.fromBufferAttribute(n,I),f.fromBufferAttribute(s,x),p.fromBufferAttribute(s,w),_.fromBufferAttribute(s,I),h.sub(c),d.sub(c),p.sub(f),_.sub(f);let N=1/(p.x*_.y-_.x*p.y);isFinite(N)&&(b.copy(h).multiplyScalar(_.y).addScaledVector(d,-p.y).multiplyScalar(N),g.copy(d).multiplyScalar(p.x).addScaledVector(h,-_.x).multiplyScalar(N),o[x].add(b),o[w].add(b),o[I].add(b),l[x].add(g),l[w].add(g),l[I].add(g))}let E=this.groups;E.length===0&&(E=[{start:0,count:t.count}]);for(let x=0,w=E.length;x<w;++x){let I=E[x],N=I.start,R=I.count;for(let G=N,L=N+R;G<L;G+=3)m(t.getX(G+0),t.getX(G+1),t.getX(G+2))}let T=new U,v=new U,M=new U,y=new U;function C(x){M.fromBufferAttribute(r,x),y.copy(M);let w=o[x];T.copy(w),T.sub(M.multiplyScalar(M.dot(w))).normalize(),v.crossVectors(y,w);let N=v.dot(l[x])<0?-1:1;a.setXYZW(x,T.x,T.y,T.z,N)}for(let x=0,w=E.length;x<w;++x){let I=E[x],N=I.start,R=I.count;for(let G=N,L=N+R;G<L;G+=3)C(t.getX(G+0)),C(t.getX(G+1)),C(t.getX(G+2))}this._transformed=!0}computeVertexNormals(){let t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0||n.count!==e.count)n=new De(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let f=0,p=n.count;f<p;f++)n.setXYZ(f,0,0,0);let r=new U,s=new U,a=new U,o=new U,l=new U,c=new U,h=new U,d=new U;if(t)for(let f=0,p=t.count;f<p;f+=3){let _=t.getX(f+0),b=t.getX(f+1),g=t.getX(f+2);r.fromBufferAttribute(e,_),s.fromBufferAttribute(e,b),a.fromBufferAttribute(e,g),h.subVectors(a,s),d.subVectors(r,s),h.cross(d),o.fromBufferAttribute(n,_),l.fromBufferAttribute(n,b),c.fromBufferAttribute(n,g),o.add(h),l.add(h),c.add(h),n.setXYZ(_,o.x,o.y,o.z),n.setXYZ(b,l.x,l.y,l.z),n.setXYZ(g,c.x,c.y,c.z)}else for(let f=0,p=e.count;f<p;f+=3)r.fromBufferAttribute(e,f+0),s.fromBufferAttribute(e,f+1),a.fromBufferAttribute(e,f+2),h.subVectors(a,s),d.subVectors(r,s),h.cross(d),n.setXYZ(f+0,h.x,h.y,h.z),n.setXYZ(f+1,h.x,h.y,h.z),n.setXYZ(f+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)Be.fromBufferAttribute(t,e),Be.normalize(),t.setXYZ(e,Be.x,Be.y,Be.z)}toNonIndexed(){function t(o,l){let c=o.array,h=o.itemSize,d=o.normalized,f=new c.constructor(l.length*h),p=0,_=0;for(let b=0,g=l.length;b<g;b++){o.isInterleavedBufferAttribute?p=l[b]*o.data.stride+o.offset:p=l[b]*h;for(let m=0;m<h;m++)f[_++]=c[p++]}return new De(f,h,d)}if(this.index===null)return kt("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let e=new i,n=this.index.array,r=this.attributes;for(let o in r){let l=r[o],c=t(l,n);e.setAttribute(o,c)}let s=this.morphAttributes;for(let o in s){let l=[],c=s[o];for(let h=0,d=c.length;h<d;h++){let f=c[h],p=t(f,n);l.push(p)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,l=a.length;o<l;o++){let c=a[o];e.addGroup(c.start,c.count,c.materialIndex)}return e}toJSON(){let t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,t.name=this.name,Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(t[c]=l[c]);return t}t.data={attributes:{}};let e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});let n=this.attributes;for(let l in n){let c=n[l];t.data.attributes[l]=c.toJSON(t.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let d=0,f=c.length;d<f;d++){let p=c[d];h.push(p.toJSON(t.data))}h.length>0&&(r[l]=h,s=!0)}s&&(t.data.morphAttributes=r,t.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let e={};this.name=t.name;let n=t.index;n!==null&&this.setIndex(n.clone());let r=t.attributes;for(let c in r){let h=r[c];this.setAttribute(c,h.clone(e))}let s=t.morphAttributes;for(let c in s){let h=[],d=s[c];for(let f=0,p=d.length;f<p;f++)h.push(d[f].clone(e));this.morphAttributes[c]=h}this.morphTargetsRelative=t.morphTargetsRelative;let a=t.groups;for(let c=0,h=a.length;c<h;c++){let d=a[c];this.addGroup(d.start,d.count,d.materialIndex)}let o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}};var tc=new U,Zf=new U,Jf=new Gt,Un=class{constructor(t=new U(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,r){return this.normal.set(t,e,n),this.constant=r,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){let r=tc.subVectors(n,e).cross(Zf.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(r,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){let t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e,n=!0){let r=t.delta(tc),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;let a=-(t.start.dot(this.normal)+this.constant)/s;return n===!0&&(a<0||a>1)?null:e.copy(t.start).addScaledVector(r,a)}intersectsLine(t){let e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){let n=e||Jf.getNormalMatrix(t),r=this.coplanarPoint(tc).applyMatrix4(t),s=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(s),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(t){return this.normal.fromArray(t.normal),this.constant=t.constant,this}},Kf=0,li=class extends Xn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Kf++}),this.uuid=Bs(),this.name="",this.type="Material",this.blending=Lr,this.side=qn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Mc,this.blendDst=Pi,this.blendEquation=$i,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Xt(0,0,0),this.blendAlpha=0,this.depthFunc=br,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Os,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=si,this.stencilZFail=si,this.stencilZPass=si,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(let e in t){let n=t[e];if(n===void 0){kt(`Material: parameter '${e}' has value of undefined.`);continue}let r=this[e];if(r===void 0){kt(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(n):r&&r.isVector2&&n&&n.isVector2||r&&r.isEuler&&n&&n.isEuler||r&&r.isVector3&&n&&n.isVector3?r.copy(n):this[e]=n}}toJSON(t){let e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(s=>s.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function r(s){let a=[];for(let o in s){let l=s[o];delete l.metadata,a.push(l)}return a}if(e){let s=r(t.textures),a=r(t.images);s.length>0&&(n.textures=s),a.length>0&&(n.images=a)}return n}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new Xt().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.retroreflectivity!==void 0&&(this.retroreflectivity=t.retroreflectivity),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.clippingPlanes!==void 0&&(this.clippingPlanes=t.clippingPlanes.map(n=>new Un().fromJSON(n))),t.clipIntersection!==void 0&&(this.clipIntersection=t.clipIntersection),t.clipShadows!==void 0&&(this.clipShadows=t.clipShadows),t.depthPacking!==void 0&&(this.depthPacking=t.depthPacking),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.linecap!==void 0&&(this.linecap=t.linecap),t.linejoin!==void 0&&(this.linejoin=t.linejoin),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let n=t.normalScale;Array.isArray(n)===!1&&(n=[n,n]),this.normalScale=new Ut().fromArray(n)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Ut().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;let e=t.clippingPlanes,n=null;if(e!==null){let r=e.length;n=new Array(r);for(let s=0;s!==r;++s)n[s]=e[s].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}};var ri=new U,ec=new U,ca=new U,ha=new U,us=class{constructor(t=new U,e=new U(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,ri)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);let n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){let e=ri.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(ri.copy(this.origin).addScaledVector(this.direction,e),ri.distanceToSquared(t))}distanceSqToSegment(t,e,n,r){ec.copy(t).add(e).multiplyScalar(.5),ca.copy(e).sub(t).normalize(),ha.copy(this.origin).sub(ec);let s=t.distanceTo(e)*.5,a=-this.direction.dot(ca),o=ha.dot(this.direction),l=-ha.dot(ca),c=ha.lengthSq(),h=Math.abs(1-a*a),d,f,p,_;if(h>0)if(d=a*l-o,f=a*o-l,_=s*h,d>=0)if(f>=-_)if(f<=_){let b=1/h;d*=b,f*=b,p=d*(d+a*f+2*o)+f*(a*d+f+2*l)+c}else f=s,d=Math.max(0,-(a*f+o)),p=-d*d+f*(f+2*l)+c;else f=-s,d=Math.max(0,-(a*f+o)),p=-d*d+f*(f+2*l)+c;else f<=-_?(d=Math.max(0,-(-a*s+o)),f=d>0?-s:Math.min(Math.max(-s,-l),s),p=-d*d+f*(f+2*l)+c):f<=_?(d=0,f=Math.min(Math.max(-s,-l),s),p=f*(f+2*l)+c):(d=Math.max(0,-(a*s+o)),f=d>0?s:Math.min(Math.max(-s,-l),s),p=-d*d+f*(f+2*l)+c);else f=a>0?-s:s,d=Math.max(0,-(a*f+o)),p=-d*d+f*(f+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,d),r&&r.copy(ec).addScaledVector(ca,f),p}intersectSphere(t,e){if(t.radius<0)return null;ri.subVectors(t.center,this.origin);let n=ri.dot(this.direction),r=ri.dot(ri)-n*n,s=t.radius*t.radius;if(r>s)return null;let a=Math.sqrt(s-r),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){let e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){let n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){let e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,r,s,a,o,l,c=1/this.direction.x,h=1/this.direction.y,d=1/this.direction.z,f=this.origin;return c>=0?(n=(t.min.x-f.x)*c,r=(t.max.x-f.x)*c):(n=(t.max.x-f.x)*c,r=(t.min.x-f.x)*c),h>=0?(s=(t.min.y-f.y)*h,a=(t.max.y-f.y)*h):(s=(t.max.y-f.y)*h,a=(t.min.y-f.y)*h),n>a||s>r||((s>n||isNaN(n))&&(n=s),(a<r||isNaN(r))&&(r=a),d>=0?(o=(t.min.z-f.z)*d,l=(t.max.z-f.z)*d):(o=(t.max.z-f.z)*d,l=(t.min.z-f.z)*d),n>l||o>r)||((o>n||n!==n)&&(n=o),(l<r||r!==r)&&(r=l),r<0)?null:this.at(n>=0?n:r,e)}intersectsBox(t){return this.intersectBox(t,ri)!==null}intersectTriangle(t,e,n,r,s){let a=this.origin,o=this.direction,l=o.x,c=o.y,h=o.z,d=t.x-a.x,f=t.y-a.y,p=t.z-a.z,_=e.x-a.x,b=e.y-a.y,g=e.z-a.z,m=n.x-a.x,E=n.y-a.y,T=n.z-a.z,v=Math.abs(l),M=Math.abs(c),y=Math.abs(h),C,x,w,I,N,R,G,L,O,$,X,rt;if(v>=M&&v>=y?(w=l,R=d,O=_,rt=m,l>=0?(C=c,x=h,I=f,N=p,G=b,L=g,$=E,X=T):(C=h,x=c,I=p,N=f,G=g,L=b,$=T,X=E)):M>=y?(w=c,R=f,O=b,rt=E,c>=0?(C=h,x=l,I=p,N=d,G=g,L=_,$=T,X=m):(C=l,x=h,I=d,N=p,G=_,L=g,$=m,X=T)):(w=h,R=p,O=g,rt=T,h>=0?(C=l,x=c,I=d,N=f,G=_,L=b,$=m,X=E):(C=c,x=l,I=f,N=d,G=b,L=_,$=E,X=m)),w===0)return null;let q=C/w,K=x/w,st=1/w,ot=I-q*R,Q=N-K*R,_t=G-q*O,gt=L-K*O,Mt=$-q*rt,W=X-K*rt,Y=Mt*gt-W*_t,ft=ot*W-Q*Mt,Ct=_t*Q-gt*ot;if(r){if(Y<0||ft<0||Ct<0)return null}else if((Y<0||ft<0||Ct<0)&&(Y>0||ft>0||Ct>0))return null;let pt=Y+ft+Ct;if(pt===0)return null;let Lt=st*(Y*R+ft*O+Ct*rt);return(pt>0?Lt<0:Lt>0)?null:this.at(Lt/pt,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},rn=class extends li{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Xt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new hn,this.combine=Sc,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}},tu=new ie,zi=new us,ua=new oi,eu=new U,da=new U,fa=new U,pa=new U,nc=new U,ma=new U,nu=new U,ga=new U,Vt=class extends Ae{constructor(t=new we,e=new rn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let r=e[n[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=r.length;s<a;s++){let o=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(t,e){let n=this.geometry,r=n.attributes.position,s=n.morphAttributes.position,a=n.morphTargetsRelative;e.fromBufferAttribute(r,t);let o=this.morphTargetInfluences;if(s&&o){ma.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let h=o[l],d=s[l];h!==0&&(nc.fromBufferAttribute(d,t),a?ma.addScaledVector(nc,h):ma.addScaledVector(nc.sub(e),h))}e.add(ma)}return e}intersectsFrustum(t){return t.intersectsObject(this)}raycast(t,e){let n=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),ua.copy(n.boundingSphere),ua.applyMatrix4(s),zi.copy(t.ray).recast(t.near),!(ua.containsPoint(zi.origin)===!1&&(zi.intersectSphere(ua,eu)===null||zi.origin.distanceToSquared(eu)>(t.far-t.near)**2))&&(tu.copy(s).invert(),zi.copy(t.ray).applyMatrix4(tu),!(n.boundingBox!==null&&zi.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,zi)))}_computeIntersections(t,e,n){let r,s=this.geometry,a=this.material,o=s.index,l=s.attributes.position,c=s.attributes.uv,h=s.attributes.uv1,d=s.attributes.normal,f=s.groups,p=s.drawRange;if(o!==null)if(Array.isArray(a))for(let _=0,b=f.length;_<b;_++){let g=f[_],m=a[g.materialIndex],E=Math.max(g.start,p.start),T=Math.min(o.count,Math.min(g.start+g.count,p.start+p.count));for(let v=E,M=T;v<M;v+=3){let y=o.getX(v),C=o.getX(v+1),x=o.getX(v+2);r=_a(this,m,t,n,c,h,d,y,C,x),r&&(r.faceIndex=Math.floor(v/3),r.face.materialIndex=g.materialIndex,e.push(r))}}else{let _=Math.max(0,p.start),b=Math.min(o.count,p.start+p.count);for(let g=_,m=b;g<m;g+=3){let E=o.getX(g),T=o.getX(g+1),v=o.getX(g+2);r=_a(this,a,t,n,c,h,d,E,T,v),r&&(r.faceIndex=Math.floor(g/3),e.push(r))}}else if(l!==void 0)if(Array.isArray(a))for(let _=0,b=f.length;_<b;_++){let g=f[_],m=a[g.materialIndex],E=Math.max(g.start,p.start),T=Math.min(l.count,Math.min(g.start+g.count,p.start+p.count));for(let v=E,M=T;v<M;v+=3){let y=v,C=v+1,x=v+2;r=_a(this,m,t,n,c,h,d,y,C,x),r&&(r.faceIndex=Math.floor(v/3),r.face.materialIndex=g.materialIndex,e.push(r))}}else{let _=Math.max(0,p.start),b=Math.min(l.count,p.start+p.count);for(let g=_,m=b;g<m;g+=3){let E=g,T=g+1,v=g+2;r=_a(this,a,t,n,c,h,d,E,T,v),r&&(r.faceIndex=Math.floor(g/3),e.push(r))}}}};function jf(i,t,e,n,r,s,a,o){let l;if(t.side===We?l=n.intersectTriangle(a,s,r,!0,o):l=n.intersectTriangle(r,s,a,t.side===qn,o),l===null)return null;ga.copy(o),ga.applyMatrix4(i.matrixWorld);let c=e.ray.origin.distanceTo(ga);return c<e.near||c>e.far?null:{distance:c,point:ga.clone(),object:i}}function _a(i,t,e,n,r,s,a,o,l,c){i.getVertexPosition(o,da),i.getVertexPosition(l,fa),i.getVertexPosition(c,pa);let h=jf(i,t,e,n,da,fa,pa,nu);if(h){let d=new U;bi.getBarycoord(nu,da,fa,pa,d),r&&(h.uv=bi.getInterpolatedAttribute(r,o,l,c,d,new Ut)),s&&(h.uv1=bi.getInterpolatedAttribute(s,o,l,c,d,new Ut)),a&&(h.normal=bi.getInterpolatedAttribute(a,o,l,c,d,new U),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let f={a:o,b:l,c,normal:new U,materialIndex:0};bi.getNormal(da,fa,pa,f.normal),h.face=f,h.barycoord=d}return h}var Wi=class extends nn{constructor(t=null,e=1,n=1,r,s,a,o,l,c=Ee,h=Ee,d,f){super(null,a,o,l,c,h,r,s,d,f),this.isDataTexture=!0,this.image={data:t,width:e,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var ds=class extends De{constructor(t,e,n,r=1){super(t,e,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){let t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}},gr=new ie,iu=new ie,xa=[],ru=new wn,Qf=new ie,Qr=new Vt,ts=new oi,Mi=class extends Vt{constructor(t,e,n){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new ds(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let r=0;r<n;r++)this.setMatrixAt(r,Qf)}computeBoundingBox(){let t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new wn),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,gr),ru.copy(t.boundingBox).applyMatrix4(gr),this.boundingBox.union(ru)}computeBoundingSphere(){let t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new oi),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,gr),ts.copy(t.boundingSphere).applyMatrix4(gr),this.boundingSphere.union(ts)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){return this.instanceColor===null?e.setRGB(1,1,1):e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){return e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){let n=e.morphTargetInfluences,r=this.morphTexture.source.data.data,s=n.length+1,a=t*s+1;for(let o=0;o<n.length;o++)n[o]=r[a+o]}raycast(t,e){let n=this.matrixWorld,r=this.count;if(Qr.geometry=this.geometry,Qr.material=this.material,Qr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),ts.copy(this.boundingSphere),ts.applyMatrix4(n),t.ray.intersectsSphere(ts)!==!1))for(let s=0;s<r;s++){this.getMatrixAt(s,gr),iu.multiplyMatrices(n,gr),Qr.matrixWorld=iu,Qr.raycast(t,xa);for(let a=0,o=xa.length;a<o;a++){let l=xa[a];l.instanceId=s,l.object=this,e.push(l)}xa.length=0}}setColorAt(t,e){return this.instanceColor===null&&(this.instanceColor=new ds(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3),this}setMatrixAt(t,e){return e.toArray(this.instanceMatrix.array,t*16),this}setMorphAt(t,e){let n=e.morphTargetInfluences,r=n.length+1;this.morphTexture===null&&(this.morphTexture=new Wi(new Float32Array(r*this.count),r,this.count,mo,un));let s=this.morphTexture.source.data.data,a=0;for(let c=0;c<n.length;c++)a+=n[c];let o=this.geometry.morphTargetsRelative?1:1-a,l=r*t;return s[l]=o,s.set(n,l+1),this}updateMorphTargets(){}dispose(){super.dispose(),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},Hi=new oi,tp=new Ut(.5,.5),va=new U,Ar=class{constructor(t=new Un,e=new Un,n=new Un,r=new Un,s=new Un,a=new Un){this.planes=[t,e,n,r,s,a]}set(t,e,n,r,s,a){let o=this.planes;return o[0].copy(t),o[1].copy(e),o[2].copy(n),o[3].copy(r),o[4].copy(s),o[5].copy(a),this}copy(t){let e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=Nn,n=!1){let r=this.planes,s=t.elements,a=s[0],o=s[1],l=s[2],c=s[3],h=s[4],d=s[5],f=s[6],p=s[7],_=s[8],b=s[9],g=s[10],m=s[11],E=s[12],T=s[13],v=s[14],M=s[15];if(r[0].setComponents(c-a,p-h,m-_,M-E).normalize(),r[1].setComponents(c+a,p+h,m+_,M+E).normalize(),r[2].setComponents(c+o,p+d,m+b,M+T).normalize(),r[3].setComponents(c-o,p-d,m-b,M-T).normalize(),n)r[4].setComponents(l,f,g,v).normalize(),r[5].setComponents(c-l,p-f,m-g,M-v).normalize();else if(r[4].setComponents(c-l,p-f,m-g,M-v).normalize(),e===Nn)r[5].setComponents(c+l,p+f,m+g,M+v).normalize();else if(e===Sr)r[5].setComponents(l,f,g,v).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),Hi.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{let e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),Hi.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(Hi)}intersectsSprite(t){Hi.center.set(0,0,0);let e=tp.distanceTo(t.center);return Hi.radius=.7071067811865476+e,Hi.applyMatrix4(t.matrixWorld),this.intersectsSphere(Hi)}intersectsSphere(t){let e=this.planes,n=t.center,r=-t.radius;for(let s=0;s<6;s++)if(e[s].distanceToPoint(n)<r)return!1;return!0}intersectsBox(t){let e=this.planes;for(let n=0;n<6;n++){let r=e[n];if(va.x=r.normal.x>0?t.max.x:t.min.x,va.y=r.normal.y>0?t.max.y:t.min.y,va.z=r.normal.z>0?t.max.z:t.min.z,r.distanceToPoint(va)<0)return!1}return!0}containsPoint(t){let e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var Oa=class extends li{constructor(t){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Xt(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}},su=new ie,dc=new us,ya=new oi,ba=new U,fs=class extends Ae{constructor(t=new we,e=new Oa){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}intersectsFrustum(t){return t.intersectsObject(this)}raycast(t,e){let n=this.geometry,r=this.matrixWorld,s=t.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),ya.copy(n.boundingSphere),ya.applyMatrix4(r),ya.radius+=s,t.ray.intersectsSphere(ya)===!1)return;su.copy(r).invert(),dc.copy(t.ray).applyMatrix4(su);let o=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=n.index,d=n.attributes.position;if(c!==null){let f=Math.max(0,a.start),p=Math.min(c.count,a.start+a.count);for(let _=f,b=p;_<b;_++){let g=c.getX(_);ba.fromBufferAttribute(d,g),au(ba,g,l,r,t,e,this)}}else{let f=Math.max(0,a.start),p=Math.min(d.count,a.start+a.count);for(let _=f,b=p;_<b;_++)ba.fromBufferAttribute(d,_),au(ba,_,l,r,t,e,this)}}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let r=e[n[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=r.length;s<a;s++){let o=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}};function au(i,t,e,n,r,s,a){let o=dc.distanceSqToPoint(i);if(o<e){let l=new U;dc.closestPointToPoint(i,l),l.applyMatrix4(n);let c=r.ray.origin.distanceTo(l);if(c<r.near||c>r.far)return;s.push({distance:c,distanceToRay:Math.sqrt(o),point:l,index:t,face:null,faceIndex:null,barycoord:null,object:a})}}var ps=class extends nn{constructor(t=[],e=Ii,n,r,s,a,o,l,c,h){super(t,e,n,r,s,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}},Si=class extends nn{constructor(t,e,n,r,s,a,o,l,c){super(t,e,n,r,s,a,o,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}};var Ei=class extends nn{constructor(t,e,n=On,r,s,a,o=Ee,l=Ee,c,h=Wn,d=1){if(h!==Wn&&h!==Li)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let f={width:t,height:e,depth:d};super(f,r,s,a,o,l,h,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new wr(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){let e=super.toJSON(t);return e.compareFunction=this.compareFunction,e}},Ba=class extends Ei{constructor(t,e=On,n=Ii,r,s,a=Ee,o=Ee,l,c=Wn){let h={width:t,height:t,depth:1},d=[h,h,h,h,h,h];super(t,t,e,n,r,s,a,o,l,c),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(t){this.image=t}},ms=class extends nn{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}},Rr=class i extends we{constructor(t=1,e=1,n=1,r=1,s=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:r,heightSegments:s,depthSegments:a};let o=this;r=Math.floor(r),s=Math.floor(s),a=Math.floor(a);let l=[],c=[],h=[],d=[],f=0,p=0;_("z","y","x",-1,-1,n,e,t,a,s,0),_("z","y","x",1,-1,n,e,-t,a,s,1),_("x","z","y",1,1,t,n,e,r,a,2),_("x","z","y",1,-1,t,n,-e,r,a,3),_("x","y","z",1,-1,t,e,n,r,s,4),_("x","y","z",-1,-1,t,e,-n,r,s,5),this.setIndex(l),this.setAttribute("position",new re(c,3)),this.setAttribute("normal",new re(h,3)),this.setAttribute("uv",new re(d,2));function _(b,g,m,E,T,v,M,y,C,x,w){let I=v/C,N=M/x,R=v/2,G=M/2,L=y/2,O=C+1,$=x+1,X=0,rt=0,q=new U;for(let K=0;K<$;K++){let st=K*N-G;for(let ot=0;ot<O;ot++){let Q=ot*I-R;q[b]=Q*E,q[g]=st*T,q[m]=L,c.push(q.x,q.y,q.z),q[b]=0,q[g]=0,q[m]=y>0?1:-1,h.push(q.x,q.y,q.z),d.push(ot/C),d.push(1-K/x),X+=1}}for(let K=0;K<x;K++)for(let st=0;st<C;st++){let ot=f+st+O*K,Q=f+st+O*(K+1),_t=f+(st+1)+O*(K+1),gt=f+(st+1)+O*K;l.push(ot,Q,gt),l.push(Q,_t,gt),rt+=6}o.addGroup(p,rt,w),p+=rt,f+=X}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new i(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}};var gs=class i extends we{constructor(t=1,e=32,n=0,r=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:t,segments:e,thetaStart:n,thetaLength:r},e=Math.max(3,e);let s=[],a=[],o=[],l=[],c=new U,h=new Ut;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let d=0,f=3;d<=e;d++,f+=3){let p=n+d/e*r;c.x=t*Math.cos(p),c.y=t*Math.sin(p),a.push(c.x,c.y,c.z),o.push(0,0,1),h.x=(a[f]/t+1)/2,h.y=(a[f+1]/t+1)/2,l.push(h.x,h.y)}for(let d=1;d<=e;d++)s.push(d,d+1,0);this.setIndex(s),this.setAttribute("position",new re(a,3)),this.setAttribute("normal",new re(o,3)),this.setAttribute("uv",new re(l,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new i(t.radius,t.segments,t.thetaStart,t.thetaLength)}};var ka=class i extends we{constructor(t=[],e=[],n=1,r=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:n,detail:r};let s=[],a=[];o(r),c(n),h(),this.setAttribute("position",new re(s,3)),this.setAttribute("normal",new re(s.slice(),3)),this.setAttribute("uv",new re(a,2)),r===0?this.computeVertexNormals():this.normalizeNormals();function o(E){let T=new U,v=new U,M=new U;for(let y=0;y<e.length;y+=3)p(e[y+0],T),p(e[y+1],v),p(e[y+2],M),l(T,v,M,E)}function l(E,T,v,M){let y=M+1,C=[];for(let x=0;x<=y;x++){C[x]=[];let w=E.clone().lerp(v,x/y),I=T.clone().lerp(v,x/y),N=y-x;for(let R=0;R<=N;R++)R===0&&x===y?C[x][R]=w:C[x][R]=w.clone().lerp(I,R/N)}for(let x=0;x<y;x++)for(let w=0;w<2*(y-x)-1;w++){let I=Math.floor(w/2);w%2===0?(f(C[x][I+1]),f(C[x+1][I]),f(C[x][I])):(f(C[x][I+1]),f(C[x+1][I+1]),f(C[x+1][I]))}}function c(E){let T=new U;for(let v=0;v<s.length;v+=3)T.x=s[v+0],T.y=s[v+1],T.z=s[v+2],T.normalize().multiplyScalar(E),s[v+0]=T.x,s[v+1]=T.y,s[v+2]=T.z}function h(){let E=new U;for(let T=0;T<s.length;T+=3){E.x=s[T+0],E.y=s[T+1],E.z=s[T+2];let v=g(E)/2/Math.PI+.5,M=m(E)/Math.PI+.5;a.push(v,1-M)}_(),d()}function d(){for(let E=0;E<a.length;E+=6){let T=a[E+0],v=a[E+2],M=a[E+4],y=Math.max(T,v,M),C=Math.min(T,v,M);y>.9&&C<.1&&(T<.2&&(a[E+0]+=1),v<.2&&(a[E+2]+=1),M<.2&&(a[E+4]+=1))}}function f(E){s.push(E.x,E.y,E.z)}function p(E,T){let v=E*3;T.x=t[v+0],T.y=t[v+1],T.z=t[v+2]}function _(){let E=new U,T=new U,v=new U,M=new U,y=new Ut,C=new Ut,x=new Ut;for(let w=0,I=0;w<s.length;w+=9,I+=6){E.set(s[w+0],s[w+1],s[w+2]),T.set(s[w+3],s[w+4],s[w+5]),v.set(s[w+6],s[w+7],s[w+8]),y.set(a[I+0],a[I+1]),C.set(a[I+2],a[I+3]),x.set(a[I+4],a[I+5]),M.copy(E).add(T).add(v).divideScalar(3);let N=g(M);b(y,I+0,E,N),b(C,I+2,T,N),b(x,I+4,v,N)}}function b(E,T,v,M){M<0&&E.x===1&&(a[T]=E.x-1),v.x===0&&v.z===0&&(a[T]=M/2/Math.PI+.5)}function g(E){return Math.atan2(E.z,-E.x)}function m(E){return Math.atan2(-E.y,Math.sqrt(E.x*E.x+E.z*E.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new i(t.vertices,t.indices,t.radius,t.detail)}};var Tn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){kt("Curve: .getPoint() not implemented.")}getPointAt(t,e){let n=this.getUtoTmapping(t);return this.getPoint(n,e)}getPoints(t=5){let e=[];for(let n=0;n<=t;n++)e.push(this.getPoint(n/t));return e}getSpacedPoints(t=5){let e=[];for(let n=0;n<=t;n++)e.push(this.getPointAt(n/t));return e}getLength(){let t=this.getLengths();return t[t.length-1]}getLengths(t=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===t+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let e=[],n,r=this.getPoint(0),s=0;e.push(0);for(let a=1;a<=t;a++)n=this.getPoint(a/t),s+=n.distanceTo(r),e.push(s),r=n;return this.cacheArcLengths=e,e}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(t,e=null){let n=this.getLengths(),r=0,s=n.length,a;e?a=e:a=t*n[s-1];let o=0,l=s-1,c;for(;o<=l;)if(r=Math.floor(o+(l-o)/2),c=n[r]-a,c<0)o=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,n[r]===a)return r/(s-1);let h=n[r],f=n[r+1]-h,p=(a-h)/f;return(r+p)/(s-1)}getTangent(t,e){let r=t-1e-4,s=t+1e-4;r<0&&(r=0),s>1&&(s=1);let a=this.getPoint(r),o=this.getPoint(s),l=e||(a.isVector2?new Ut:new U);return l.copy(o).sub(a).normalize(),l}getTangentAt(t,e){let n=this.getUtoTmapping(t);return this.getTangent(n,e)}computeFrenetFrames(t,e=!1){let n=new U,r=[],s=[],a=[],o=new U,l=new ie;for(let p=0;p<=t;p++){let _=p/t;r[p]=this.getTangentAt(_,new U)}s[0]=new U,a[0]=new U;let c=Number.MAX_VALUE,h=Math.abs(r[0].x),d=Math.abs(r[0].y),f=Math.abs(r[0].z);h<=c&&(c=h,n.set(1,0,0)),d<=c&&(c=d,n.set(0,1,0)),f<=c&&n.set(0,0,1),o.crossVectors(r[0],n).normalize(),s[0].crossVectors(r[0],o),a[0].crossVectors(r[0],s[0]);for(let p=1;p<=t;p++){if(s[p]=s[p-1].clone(),a[p]=a[p-1].clone(),o.crossVectors(r[p-1],r[p]),o.length()>Number.EPSILON){o.normalize();let _=Math.acos(Qt(r[p-1].dot(r[p]),-1,1));s[p].applyMatrix4(l.makeRotationAxis(o,_))}a[p].crossVectors(r[p],s[p])}if(e===!0){let p=Math.acos(Qt(s[0].dot(s[t]),-1,1));p/=t,r[0].dot(o.crossVectors(s[0],s[t]))>0&&(p=-p);for(let _=1;_<=t;_++)s[_].applyMatrix4(l.makeRotationAxis(r[_],p*_)),a[_].crossVectors(r[_],s[_])}return{tangents:r,normals:s,binormals:a}}clone(){return new this.constructor().copy(this)}copy(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}toJSON(){let t={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return t.arcLengthDivisions=this.arcLengthDivisions,t.type=this.type,t}fromJSON(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}},_s=class extends Tn{constructor(t=0,e=0,n=1,r=1,s=0,a=Math.PI*2,o=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=t,this.aY=e,this.xRadius=n,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=a,this.aClockwise=o,this.aRotation=l}getPoint(t,e=new Ut){let n=e,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,a=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(a?s=0:s=r),this.aClockwise===!0&&!a&&(s===r?s=-r:s=s-r);let o=this.aStartAngle+t*s,l=this.aX+this.xRadius*Math.cos(o),c=this.aY+this.yRadius*Math.sin(o);if(this.aRotation!==0){let h=Math.cos(this.aRotation),d=Math.sin(this.aRotation),f=l-this.aX,p=c-this.aY;l=f*h-p*d+this.aX,c=f*d+p*h+this.aY}return n.set(l,c)}copy(t){return super.copy(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}toJSON(){let t=super.toJSON();return t.aX=this.aX,t.aY=this.aY,t.xRadius=this.xRadius,t.yRadius=this.yRadius,t.aStartAngle=this.aStartAngle,t.aEndAngle=this.aEndAngle,t.aClockwise=this.aClockwise,t.aRotation=this.aRotation,t}fromJSON(t){return super.fromJSON(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}},za=class extends _s{constructor(t,e,n,r,s,a){super(t,e,n,n,r,s,a),this.isArcCurve=!0,this.type="ArcCurve"}};function Hc(){let i=0,t=0,e=0,n=0;function r(s,a,o,l){i=s,t=o,e=-3*s+3*a-2*o-l,n=2*s-2*a+o+l}return{initCatmullRom:function(s,a,o,l,c){r(a,o,c*(o-s),c*(l-a))},initNonuniformCatmullRom:function(s,a,o,l,c,h,d){let f=(a-s)/c-(o-s)/(c+h)+(o-a)/h,p=(o-a)/h-(l-a)/(h+d)+(l-o)/d;f*=h,p*=h,r(a,o,f,p)},calc:function(s){let a=s*s,o=a*s;return i+t*s+e*a+n*o}}}var ou=new U,lu=new U,ic=new Hc,rc=new Hc,sc=new Hc,Cr=class extends Tn{constructor(t=[],e=!1,n="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=t,this.closed=e,this.curveType=n,this.tension=r}getPoint(t,e=new U){let n=e,r=this.points,s=r.length,a=(s-(this.closed?0:1))*t,o=Math.floor(a),l=a-o;this.closed?o+=o>0?0:(Math.floor(Math.abs(o)/s)+1)*s:l===0&&o===s-1&&(o=s-2,l=1);let c,h;this.closed||o>0?c=r[(o-1)%s]:(lu.subVectors(r[0],r[1]).add(r[0]),c=lu);let d=r[o%s],f=r[(o+1)%s];if(this.closed||o+2<s?h=r[(o+2)%s]:(ou.subVectors(r[s-1],r[s-2]).add(r[s-1]),h=ou),this.curveType==="centripetal"||this.curveType==="chordal"){let p=this.curveType==="chordal"?.5:.25,_=Math.pow(c.distanceToSquared(d),p),b=Math.pow(d.distanceToSquared(f),p),g=Math.pow(f.distanceToSquared(h),p);b<1e-4&&(b=1),_<1e-4&&(_=b),g<1e-4&&(g=b),ic.initNonuniformCatmullRom(c.x,d.x,f.x,h.x,_,b,g),rc.initNonuniformCatmullRom(c.y,d.y,f.y,h.y,_,b,g),sc.initNonuniformCatmullRom(c.z,d.z,f.z,h.z,_,b,g)}else this.curveType==="catmullrom"&&(ic.initCatmullRom(c.x,d.x,f.x,h.x,this.tension),rc.initCatmullRom(c.y,d.y,f.y,h.y,this.tension),sc.initCatmullRom(c.z,d.z,f.z,h.z,this.tension));return n.set(ic.calc(l),rc.calc(l),sc.calc(l)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let r=t.points[e];this.points.push(r.clone())}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}toJSON(){let t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){let r=this.points[e];t.points.push(r.toArray())}return t.closed=this.closed,t.curveType=this.curveType,t.tension=this.tension,t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let r=t.points[e];this.points.push(new U().fromArray(r))}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}};function cu(i,t,e,n,r){let s=(n-t)*.5,a=(r-e)*.5,o=i*i,l=i*o;return(2*e-2*n+s+a)*l+(-3*e+3*n-2*s-a)*o+s*i+e}function ep(i,t){let e=1-i;return e*e*t}function np(i,t){return 2*(1-i)*i*t}function ip(i,t){return i*i*t}function es(i,t,e,n){return ep(i,t)+np(i,e)+ip(i,n)}function rp(i,t){let e=1-i;return e*e*e*t}function sp(i,t){let e=1-i;return 3*e*e*i*t}function ap(i,t){return 3*(1-i)*i*i*t}function op(i,t){return i*i*i*t}function ns(i,t,e,n,r){return rp(i,t)+sp(i,e)+ap(i,n)+op(i,r)}var Ha=class extends Tn{constructor(t=new Ut,e=new Ut,n=new Ut,r=new Ut){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=t,this.v1=e,this.v2=n,this.v3=r}getPoint(t,e=new Ut){let n=e,r=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(ns(t,r.x,s.x,a.x,o.x),ns(t,r.y,s.y,a.y,o.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}},Va=class extends Tn{constructor(t=new U,e=new U,n=new U,r=new U){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=t,this.v1=e,this.v2=n,this.v3=r}getPoint(t,e=new U){let n=e,r=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(ns(t,r.x,s.x,a.x,o.x),ns(t,r.y,s.y,a.y,o.y),ns(t,r.z,s.z,a.z,o.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}},Ga=class extends Tn{constructor(t=new Ut,e=new Ut){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=t,this.v2=e}getPoint(t,e=new Ut){let n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new Ut){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},Wa=class extends Tn{constructor(t=new U,e=new U){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=t,this.v2=e}getPoint(t,e=new U){let n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new U){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},Xa=class extends Tn{constructor(t=new Ut,e=new Ut,n=new Ut){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new Ut){let n=e,r=this.v0,s=this.v1,a=this.v2;return n.set(es(t,r.x,s.x,a.x),es(t,r.y,s.y,a.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},xs=class extends Tn{constructor(t=new U,e=new U,n=new U){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new U){let n=e,r=this.v0,s=this.v1,a=this.v2;return n.set(es(t,r.x,s.x,a.x),es(t,r.y,s.y,a.y),es(t,r.z,s.z,a.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},qa=class extends Tn{constructor(t=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=t}getPoint(t,e=new Ut){let n=e,r=this.points,s=(r.length-1)*t,a=Math.floor(s),o=s-a,l=r[a===0?a:a-1],c=r[a],h=r[a>r.length-2?r.length-1:a+1],d=r[a>r.length-3?r.length-1:a+2];return n.set(cu(o,l.x,c.x,h.x,d.x),cu(o,l.y,c.y,h.y,d.y)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let r=t.points[e];this.points.push(r.clone())}return this}toJSON(){let t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){let r=this.points[e];t.points.push(r.toArray())}return t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let r=t.points[e];this.points.push(new Ut().fromArray(r))}return this}},lp=Object.freeze({__proto__:null,ArcCurve:za,CatmullRomCurve3:Cr,CubicBezierCurve:Ha,CubicBezierCurve3:Va,EllipseCurve:_s,LineCurve:Ga,LineCurve3:Wa,QuadraticBezierCurve:Xa,QuadraticBezierCurve3:xs,SplineCurve:qa});var vs=class i extends ka{constructor(t=1,e=0){let n=(1+Math.sqrt(5))/2,r=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],s=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(r,s,t,e),this.type="IcosahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new i(t.radius,t.detail)}};var fe=class i extends we{constructor(t=1,e=1,n=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:r};let s=t/2,a=e/2,o=Math.floor(n),l=Math.floor(r),c=o+1,h=l+1,d=t/o,f=e/l,p=[],_=[],b=[],g=[];for(let m=0;m<h;m++){let E=m*f-a;for(let T=0;T<c;T++){let v=T*d-s;_.push(v,-E,0),b.push(0,0,1),g.push(T/o),g.push(1-m/l)}}for(let m=0;m<l;m++)for(let E=0;E<o;E++){let T=E+c*m,v=E+c*(m+1),M=E+1+c*(m+1),y=E+1+c*m;p.push(T,v,y),p.push(v,M,y)}this.setIndex(p),this.setAttribute("position",new re(_,3)),this.setAttribute("normal",new re(b,3)),this.setAttribute("uv",new re(g,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new i(t.width,t.height,t.widthSegments,t.heightSegments)}};var Xi=class i extends we{constructor(t=1,e=32,n=16,r=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:n,phiStart:r,phiLength:s,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),n=Math.max(2,Math.floor(n));let l=Math.min(a+o,Math.PI),c=0,h=[],d=new U,f=new U,p=[],_=[],b=[],g=[];for(let m=0;m<=n;m++){let E=[],T=m/n,v=a+T*o,M=t*Math.cos(v),y=Math.sqrt(t*t-M*M),C=0;m===0&&a===0?C=.5/e:m===n&&l===Math.PI&&(C=-.5/e);for(let x=0;x<=e;x++){let w=x/e,I=r+w*s;d.x=-y*Math.cos(I),d.y=M,d.z=y*Math.sin(I),_.push(d.x,d.y,d.z),f.copy(d).normalize(),b.push(f.x,f.y,f.z),g.push(w+C,1-T),E.push(c++)}h.push(E)}for(let m=0;m<n;m++)for(let E=0;E<e;E++){let T=h[m][E+1],v=h[m][E],M=h[m+1][E],y=h[m+1][E+1];(m!==0||a>0)&&p.push(T,v,y),(m!==n-1||l<Math.PI)&&p.push(v,M,y)}this.setIndex(p),this.setAttribute("position",new re(_,3)),this.setAttribute("normal",new re(b,3)),this.setAttribute("uv",new re(g,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new i(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}};var ys=class i extends we{constructor(t=1,e=.4,n=12,r=48,s=Math.PI*2,a=0,o=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:n,tubularSegments:r,arc:s,thetaStart:a,thetaLength:o},n=Math.floor(n),r=Math.floor(r);let l=[],c=[],h=[],d=[],f=new U,p=new U,_=new U;for(let b=0;b<=n;b++){let g=a+b/n*o;for(let m=0;m<=r;m++){let E=m/r*s;p.x=(t+e*Math.cos(g))*Math.cos(E),p.y=(t+e*Math.cos(g))*Math.sin(E),p.z=e*Math.sin(g),c.push(p.x,p.y,p.z),f.x=t*Math.cos(E),f.y=t*Math.sin(E),_.subVectors(p,f).normalize(),h.push(_.x,_.y,_.z),d.push(m/r),d.push(b/n)}}for(let b=1;b<=n;b++)for(let g=1;g<=r;g++){let m=(r+1)*b+g-1,E=(r+1)*(b-1)+g-1,T=(r+1)*(b-1)+g,v=(r+1)*b+g;l.push(m,E,v),l.push(E,T,v)}this.setIndex(l),this.setAttribute("position",new re(c,3)),this.setAttribute("normal",new re(h,3)),this.setAttribute("uv",new re(d,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new i(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc,t.thetaStart,t.thetaLength)}};var bs=class i extends we{constructor(t=new xs(new U(-1,-1,0),new U(-1,1,0),new U(1,1,0)),e=64,n=1,r=8,s=!1){super(),this.type="TubeGeometry",this.parameters={path:t,tubularSegments:e,radius:n,radialSegments:r,closed:s};let a=t.computeFrenetFrames(e,s);this.tangents=a.tangents,this.normals=a.normals,this.binormals=a.binormals;let o=new U,l=new U,c=new Ut,h=new U,d=[],f=[],p=[],_=[];b(),this.setIndex(_),this.setAttribute("position",new re(d,3)),this.setAttribute("normal",new re(f,3)),this.setAttribute("uv",new re(p,2));function b(){for(let T=0;T<e;T++)g(T);g(s===!1?e:0),E(),m()}function g(T){h=t.getPointAt(T/e,h);let v=a.normals[T],M=a.binormals[T];for(let y=0;y<=r;y++){let C=y/r*Math.PI*2,x=Math.sin(C),w=-Math.cos(C);l.x=w*v.x+x*M.x,l.y=w*v.y+x*M.y,l.z=w*v.z+x*M.z,l.normalize(),f.push(l.x,l.y,l.z),o.x=h.x+n*l.x,o.y=h.y+n*l.y,o.z=h.z+n*l.z,d.push(o.x,o.y,o.z)}}function m(){for(let T=1;T<=e;T++)for(let v=1;v<=r;v++){let M=(r+1)*(T-1)+(v-1),y=(r+1)*T+(v-1),C=(r+1)*T+v,x=(r+1)*(T-1)+v;_.push(M,y,x),_.push(y,C,x)}}function E(){for(let T=0;T<=e;T++)for(let v=0;v<=r;v++)c.x=T/e,c.y=v/r,p.push(c.x,c.y)}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON();return t.path=this.parameters.path.toJSON(),t}static fromJSON(t){return new i(new lp[t.path.type]().fromJSON(t.path),t.tubularSegments,t.radius,t.radialSegments,t.closed)}};function Ji(i){let t={};for(let e in i){t[e]={};for(let n in i[e]){let r=i[e][n];if(hu(r))r.isRenderTargetTexture?(kt("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=r.clone();else if(Array.isArray(r))if(hu(r[0])){let s=[];for(let a=0,o=r.length;a<o;a++)s[a]=r[a].clone();t[e][n]=s}else t[e][n]=r.slice();else t[e][n]=r}}return t}function je(i){let t={};for(let e=0;e<i.length;e++){let n=Ji(i[e]);for(let r in n)t[r]=n[r]}return t}function hu(i){return i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)}function cp(i){let t=[];for(let e=0;e<i.length;e++)t.push(i[e].clone());return t}function Vc(i){let t=i.getRenderTarget();return t===null?i.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:jt.workingColorSpace}var Ku={clone:Ji,merge:je},hp=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,up=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Re=class extends li{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=hp,this.fragmentShader=up,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Ji(t.uniforms),this.uniformsGroups=cp(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){let e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(let r in this.uniforms){let a=this.uniforms[r].value;a&&a.isTexture?e.uniforms[r]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[r]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[r]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[r]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[r]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[r]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[r]={type:"m4",value:a.toArray()}:e.uniforms[r]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;let n={};for(let r in this.extensions)this.extensions[r]===!0&&(n[r]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(let n in t.uniforms){let r=t.uniforms[n];switch(this.uniforms[n]={},r.type){case"t":this.uniforms[n].value=e[r.value]||null;break;case"c":this.uniforms[n].value=new Xt().setHex(r.value);break;case"v2":this.uniforms[n].value=new Ut().fromArray(r.value);break;case"v3":this.uniforms[n].value=new U().fromArray(r.value);break;case"v4":this.uniforms[n].value=new Me().fromArray(r.value);break;case"m3":this.uniforms[n].value=new Gt().fromArray(r.value);break;case"m4":this.uniforms[n].value=new ie().fromArray(r.value);break;default:this.uniforms[n].value=r.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(let n in t.extensions)this.extensions[n]=t.extensions[n];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}},Ya=class extends Re{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},An=class extends li{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Xt(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Xt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Zo,this.normalScale=new Ut(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new hn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}},_n=class extends An{constructor(t){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new Ut(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Qt(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Xt(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Xt(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Xt(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(t)}get anisotropy(){return this._anisotropy}set anisotropy(t){this._anisotropy>0!=t>0&&this.version++,this._anisotropy=t}get clearcoat(){return this._clearcoat}set clearcoat(t){this._clearcoat>0!=t>0&&this.version++,this._clearcoat=t}get iridescence(){return this._iridescence}set iridescence(t){this._iridescence>0!=t>0&&this.version++,this._iridescence=t}get dispersion(){return this._dispersion}set dispersion(t){this._dispersion>0!=t>0&&this.version++,this._dispersion=t}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(t){this._retroreflectivity>0!=t>0&&this.version++,this._retroreflectivity=t}get sheen(){return this._sheen}set sheen(t){this._sheen>0!=t>0&&this.version++,this._sheen=t}get transmission(){return this._transmission}set transmission(t){this._transmission>0!=t>0&&this.version++,this._transmission=t}copy(t){return super.copy(t),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=t.anisotropy,this.anisotropyRotation=t.anisotropyRotation,this.anisotropyMap=t.anisotropyMap,this.clearcoat=t.clearcoat,this.clearcoatMap=t.clearcoatMap,this.clearcoatRoughness=t.clearcoatRoughness,this.clearcoatRoughnessMap=t.clearcoatRoughnessMap,this.clearcoatNormalMap=t.clearcoatNormalMap,this.clearcoatNormalScale.copy(t.clearcoatNormalScale),this.dispersion=t.dispersion,this.ior=t.ior,this.iridescence=t.iridescence,this.iridescenceMap=t.iridescenceMap,this.iridescenceIOR=t.iridescenceIOR,this.iridescenceThicknessRange=[...t.iridescenceThicknessRange],this.iridescenceThicknessMap=t.iridescenceThicknessMap,this.retroreflectivity=t.retroreflectivity,this.sheen=t.sheen,this.sheenColor.copy(t.sheenColor),this.sheenColorMap=t.sheenColorMap,this.sheenRoughness=t.sheenRoughness,this.sheenRoughnessMap=t.sheenRoughnessMap,this.transmission=t.transmission,this.transmissionMap=t.transmissionMap,this.thickness=t.thickness,this.thicknessMap=t.thicknessMap,this.attenuationDistance=t.attenuationDistance,this.attenuationColor.copy(t.attenuationColor),this.specularIntensity=t.specularIntensity,this.specularIntensityMap=t.specularIntensityMap,this.specularColor.copy(t.specularColor),this.specularColorMap=t.specularColorMap,this}};var wi=class extends li{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Ou,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}},$a=class extends li{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}};function _r(i,t){return!i||i.constructor===t?i:typeof t.BYTES_PER_ELEMENT=="number"?new t(i):Array.prototype.slice.call(i)}function ac(i){return i!==void 0&&i.inTangents!==void 0&&i.outTangents!==void 0}var Ti=class{constructor(t,e,n,r){this.parameterPositions=t,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new e.constructor(n),this.sampleValues=e,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(t){let e=this.parameterPositions,n=this._cachedIndex,r=e[n],s=e[n-1];n:{t:{let a;e:{i:if(!(t<r)){for(let o=n+2;;){if(r===void 0){if(t<s)break i;return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(s=r,r=e[++n],t<r)break t}a=e.length;break e}if(!(t>=s)){let o=e[1];t<o&&(n=2,s=o);for(let l=n-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(r=s,s=e[--n-1],t>=s)break t}a=n,n=0;break e}break n}for(;n<a;){let o=n+a>>>1;t<e[o]?a=o:n=o+1}if(r=e[n],s=e[n-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,s,r)}return this.interpolate_(n,s,t,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(t){let e=this.resultBuffer,n=this.sampleValues,r=this.valueSize,s=t*r;for(let a=0;a!==r;++a)e[a]=n[s+a];return e}interpolate_(){throw new Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}},Za=class extends Ti{constructor(t,e,n,r){super(t,e,n,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:cc,endingEnd:cc}}intervalChanged_(t,e,n){let r=this.parameterPositions,s=t-2,a=t+1,o=r[s],l=r[a];if(o===void 0)switch(this.getSettings_().endingStart){case hc:s=t,o=2*e-n;break;case uc:s=r.length-2,o=e+r[s]-r[s+1];break;default:s=t,o=n}if(l===void 0)switch(this.getSettings_().endingEnd){case hc:a=t,l=2*n-e;break;case uc:a=1,l=n+r[1]-r[0];break;default:a=t-1,l=e}let c=(n-e)*.5,h=this.valueSize;this._weightPrev=c/(e-o),this._weightNext=c/(l-n),this._offsetPrev=s*h,this._offsetNext=a*h}interpolate_(t,e,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=t*o,c=l-o,h=this._offsetPrev,d=this._offsetNext,f=this._weightPrev,p=this._weightNext,_=(n-e)/(r-e),b=_*_,g=b*_,m=-f*g+2*f*b-f*_,E=(1+f)*g+(-1.5-2*f)*b+(-.5+f)*_+1,T=(-1-p)*g+(1.5+p)*b+.5*_,v=p*g-p*b;for(let M=0;M!==o;++M)s[M]=m*a[h+M]+E*a[c+M]+T*a[l+M]+v*a[d+M];return s}},Ja=class extends Ti{constructor(t,e,n,r){super(t,e,n,r)}interpolate_(t,e,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=t*o,c=l-o,h=(n-e)/(r-e),d=1-h;for(let f=0;f!==o;++f)s[f]=a[c+f]*d+a[l+f]*h;return s}},Ka=class extends Ti{constructor(t,e,n,r){super(t,e,n,r)}interpolate_(t){return this.copySampleValue_(t-1)}},ja=class extends Ti{interpolate_(t,e,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=t*o,c=l-o,h=this.inTangents,d=this.outTangents;if(!h||!d){let _=(n-e)/(r-e),b=1-_;for(let g=0;g!==o;++g)s[g]=a[c+g]*b+a[l+g]*_;return s}let f=o*2,p=t-1;for(let _=0;_!==o;++_){let b=a[c+_],g=a[l+_],m=p*f+_*2,E=d[m],T=d[m+1],v=t*f+_*2,M=h[v],y=h[v+1],C=fp(n,e,E,M,r);s[_]=ju(C,b,T,y,g)}return s}};function ju(i,t,e,n,r){let s=1-i;return s*s*s*t+3*s*s*i*e+3*s*i*i*n+i*i*i*r}function dp(i,t,e,n,r){let s=1-i;return 3*s*s*(e-t)+6*s*i*(n-e)+3*i*i*(r-n)}function fp(i,t,e,n,r){let s=(i-t)/(r-t);for(let a=0;a<8;a++){let o=ju(s,t,e,n,r)-i;if(Math.abs(o)<1e-10)break;let l=dp(s,t,e,n,r);if(Math.abs(l)<1e-10)break;s=Math.max(0,Math.min(1,s-o/l))}return s}var xn=class{constructor(t,e,n,r){if(t===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(e===void 0||e.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+t);this.name=t,this.times=_r(e,this.TimeBufferType),this.values=_r(n,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(t){let e=t.constructor,n;if(e.toJSON!==this.toJSON)n=e.toJSON(t);else{n={name:t.name,times:_r(t.times,Array),values:_r(t.values,Array)};let r=t.getInterpolation();r!==t.DefaultInterpolation&&(n.interpolation=r),ac(t.settings)&&(n.settings={inTangents:_r(t.settings.inTangents,Array),outTangents:_r(t.settings.outTangents,Array)})}return n.type=t.ValueTypeName,n}InterpolantFactoryMethodDiscrete(t){return new Ka(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodLinear(t){return new Ja(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodSmooth(t){return new Za(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodBezier(t){let e=new ja(this.times,this.values,this.getValueSize(),t);return this.settings&&(e.inTangents=this.settings.inTangents,e.outTangents=this.settings.outTangents),e}setInterpolation(t){let e;switch(t){case is:e=this.InterpolantFactoryMethodDiscrete;break;case Da:e=this.InterpolantFactoryMethodLinear;break;case Ea:e=this.InterpolantFactoryMethodSmooth;break;case lc:e=this.InterpolantFactoryMethodBezier;break}if(e===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(t!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return kt("KeyframeTrack:",n),this}return this.createInterpolant=e,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return is;case this.InterpolantFactoryMethodLinear:return Da;case this.InterpolantFactoryMethodSmooth:return Ea;case this.InterpolantFactoryMethodBezier:return lc}}getValueSize(){return this.values.length/this.times.length}shift(t){if(t!==0){let e=this.times;for(let n=0,r=e.length;n!==r;++n)e[n]+=t}return this}scale(t){if(t!==1){let e=this.times;for(let n=0,r=e.length;n!==r;++n)e[n]*=t;ac(this.settings)&&(uu(this.settings.inTangents,t),uu(this.settings.outTangents,t))}return this}trim(t,e){let n=this.times,r=n.length,s=0,a=r-1;for(;s!==r&&n[s]<t;)++s;for(;a!==-1&&n[a]>e;)--a;if(++a,s!==0||a!==r){s>=a&&(a=Math.max(a,1),s=a-1);let o=this.getValueSize();this.times=n.slice(s,a),this.values=this.values.slice(s*o,a*o)}return this}validate(){let t=!0,e=this.getValueSize();e-Math.floor(e)!==0&&(Ht("KeyframeTrack: Invalid value size in track.",this),t=!1);let n=this.times,r=this.values,s=n.length;s===0&&(Ht("KeyframeTrack: Track is empty.",this),t=!1);let a=null;for(let o=0;o!==s;o++){let l=n[o];if(typeof l=="number"&&isNaN(l)){Ht("KeyframeTrack: Time is not a valid number.",this,o,l),t=!1;break}if(a!==null&&a>l){Ht("KeyframeTrack: Out of order keys.",this,o,l,a),t=!1;break}a=l}if(r!==void 0&&Uf(r))for(let o=0,l=r.length;o!==l;++o){let c=r[o];if(isNaN(c)){Ht("KeyframeTrack: Value is not a valid number.",this,o,c),t=!1;break}}return t}optimize(){let t=this.times.slice(),e=this.values.slice(),n=this.getValueSize(),r=this.getInterpolation()===Ea,s=t.length-1,a=1;for(let o=1;o<s;++o){let l=!1,c=t[o],h=t[o+1];if(c!==h&&(o!==1||c!==t[0]))if(r)l=!0;else{let d=o*n,f=d-n,p=d+n;for(let _=0;_!==n;++_){let b=e[d+_];if(b!==e[f+_]||b!==e[p+_]){l=!0;break}}}if(l){if(o!==a){t[a]=t[o];let d=o*n,f=a*n;for(let p=0;p!==n;++p)e[f+p]=e[d+p]}++a}}if(s>0){t[a]=t[s];for(let o=s*n,l=a*n,c=0;c!==n;++c)e[l+c]=e[o+c];++a}return a!==t.length?(this.times=t.slice(0,a),this.values=e.slice(0,a*n)):(this.times=t,this.values=e),this}clone(){let t=this.times.slice(),e=this.values.slice(),n=this.constructor,r=new n(this.name,t,e);return r.createInterpolant=this.createInterpolant,ac(this.settings)&&(r.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),r}};function uu(i,t){for(let e=0,n=i.length;e!==n;e+=2)i[e]*=t}xn.prototype.ValueTypeName="";xn.prototype.TimeBufferType=Float32Array;xn.prototype.ValueBufferType=Float32Array;xn.prototype.DefaultInterpolation=Da;var Ai=class extends xn{constructor(t,e,n){super(t,e,n)}};Ai.prototype.ValueTypeName="bool";Ai.prototype.ValueBufferType=Array;Ai.prototype.DefaultInterpolation=is;Ai.prototype.InterpolantFactoryMethodLinear=void 0;Ai.prototype.InterpolantFactoryMethodSmooth=void 0;var Qa=class extends xn{constructor(t,e,n,r){super(t,e,n,r)}};Qa.prototype.ValueTypeName="color";var to=class extends xn{constructor(t,e,n,r){super(t,e,n,r)}};to.prototype.ValueTypeName="number";var eo=class extends Ti{constructor(t,e,n,r){super(t,e,n,r)}interpolate_(t,e,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(n-e)/(r-e),c=t*o;for(let h=c+o;c!==h;c+=4)en.slerpFlat(s,0,a,c-o,a,c,l);return s}},Ms=class extends xn{constructor(t,e,n,r){super(t,e,n,r)}InterpolantFactoryMethodLinear(t){return new eo(this.times,this.values,this.getValueSize(),t)}};Ms.prototype.ValueTypeName="quaternion";Ms.prototype.InterpolantFactoryMethodSmooth=void 0;var Ri=class extends xn{constructor(t,e,n){super(t,e,n)}};Ri.prototype.ValueTypeName="string";Ri.prototype.ValueBufferType=Array;Ri.prototype.DefaultInterpolation=is;Ri.prototype.InterpolantFactoryMethodLinear=void 0;Ri.prototype.InterpolantFactoryMethodSmooth=void 0;var no=class extends xn{constructor(t,e,n,r){super(t,e,n,r)}};no.prototype.ValueTypeName="vector";var io=class{constructor(t,e,n){let r=this,s=!1,a=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=t,this.onProgress=e,this.onError=n,this._abortController=null,this.itemStart=function(h){o++,s===!1&&r.onStart!==void 0&&r.onStart(h,a,o),s=!0},this.itemEnd=function(h){a++,r.onProgress!==void 0&&r.onProgress(h,a,o),a===o&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(h){r.onError!==void 0&&r.onError(h)},this.resolveURL=function(h){return h=h.normalize("NFC"),l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,d){return c.push(h,d),this},this.removeHandler=function(h){let d=c.indexOf(h);return d!==-1&&c.splice(d,2),this},this.getHandler=function(h){for(let d=0,f=c.length;d<f;d+=2){let p=c[d],_=c[d+1];if(p.global&&(p.lastIndex=0),p.test(h))return _}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Qu=new io,ro=class{constructor(t){this.manager=t!==void 0?t:Qu,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(t,e){let n=this;return new Promise(function(r,s){n.load(t,r,e,s)})}parse(){}setCrossOrigin(t){return this.crossOrigin=t,this}setWithCredentials(t){return this.withCredentials=t,this}setPath(t){return this.path=t,this}setResourcePath(t){return this.resourcePath=t,this}setRequestHeader(t){return this.requestHeader=t,this}abort(){return this}};ro.DEFAULT_MATERIAL_NAME="__DEFAULT";var qi=class extends Ae{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new Xt(t),this.intensity=e}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){let e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,e}},Yi=class extends qi{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Ae.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Xt(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}toJSON(t){let e=super.toJSON(t);return e.object.groundColor=this.groundColor.getHex(),e}},oc=new ie,du=new U,fu=new U,Pr=class{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ut(512,512),this.mapType=Ve,this.map=null,this.mapPass=null,this.matrix=new ie,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Ar,this._frameExtents=new Ut(1,1),this._viewportCount=1,this._viewports=[new Me(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(t){let e=this.camera;du.setFromMatrixPosition(t.matrixWorld),e.position.copy(du),fu.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(fu),e.updateMatrixWorld(),this._updateMatrix(e,this.matrix,this._frustum)}_updateMatrix(t,e,n,r){oc.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),n.setFromProjectionMatrix(oc,t.coordinateSystem,t.reversedDepth);let s=this._frameExtents,a=r?r.z/s.x:1,o=r?r.w/s.y:1,l=r?r.x/s.x:0,c=r?r.y/s.y:0;t.coordinateSystem===Sr||t.reversedDepth?e.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,1,0,0,0,0,1):e.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,.5,.5,0,0,0,1),e.multiply(oc)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this.biasNode=t.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let t={};return t.intensity=this.intensity,t.bias=this.bias,t.normalBias=this.normalBias,t.radius=this.radius,t.blurSamples=this.blurSamples,t.mapSize=this.mapSize.toArray(),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}},Ma=new U,Sa=new en,Vn=new U,Ss=class extends Ae{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new ie,this.projectionMatrix=new ie,this.projectionMatrixInverse=new ie,this.coordinateSystem=Nn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(Ma,Sa,Vn),Vn.x===1&&Vn.y===1&&Vn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ma,Sa,Vn.set(1,1,1)).invert()}updateWorldMatrix(t,e,n=!1){super.updateWorldMatrix(t,e,n),this.matrixWorld.decompose(Ma,Sa,Vn),Vn.x===1&&Vn.y===1&&Vn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ma,Sa,Vn.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},yi=new U,pu=new Ut,mu=new Ut,ze=class extends Ss{constructor(t=50,e=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){let e=.5*this.getFilmHeight()/t;this.fov=as*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){let t=Math.tan(Fl*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return as*2*Math.atan(Math.tan(Fl*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){yi.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(yi.x,yi.y).multiplyScalar(-t/yi.z),yi.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(yi.x,yi.y).multiplyScalar(-t/yi.z)}getViewSize(t,e){return this.getViewBounds(t,pu,mu),e.subVectors(mu,pu)}setViewOffset(t,e,n,r,s,a){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=r,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=this.near,e=t*Math.tan(Fl*.5*this.fov)/this.zoom,n=2*e,r=this.aspect*n,s=-.5*r,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,c=a.fullHeight;s+=a.offsetX*r/l,e-=a.offsetY*n/c,r*=a.width/l,n*=a.height/c}let o=this.filmOffset;o!==0&&(s+=t*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,e,e-n,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}},fc=class extends Pr{constructor(){super(new ze(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(t){let e=this.camera,n=as*2*t.angle*this.focus,r=this.mapSize.width/this.mapSize.height*this.aspect,s=t.distance||e.far;(n!==e.fov||r!==e.aspect||s!==e.far)&&(e.fov=n,e.aspect=r,e.far=s,e.updateProjectionMatrix()),super.updateMatrices(t)}copy(t){return super.copy(t),this.focus=t.focus,this.aspect=t.aspect,this}toJSON(){let t=super.toJSON();return t.focus=this.focus,t.aspect=this.aspect,t}},Es=class extends qi{constructor(t,e,n=0,r=Math.PI/3,s=0,a=2){super(t,e),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(Ae.DEFAULT_UP),this.updateMatrix(),this.target=new Ae,this.distance=n,this.angle=r,this.penumbra=s,this.decay=a,this.map=null,this.shadow=new fc}get power(){return this.intensity*Math.PI}set power(t){this.intensity=t/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.angle=t.angle,this.penumbra=t.penumbra,this.decay=t.decay,this.target=t.target.clone(),this.map=t.map,this.shadow=t.shadow.clone(),this}toJSON(t){let e=super.toJSON(t);return e.object.distance=this.distance,e.object.angle=this.angle,e.object.decay=this.decay,e.object.penumbra=this.penumbra,e.object.target=this.target.uuid,this.map&&this.map.isTexture&&(e.object.map=this.map.toJSON(t).uuid),e.object.shadow=this.shadow.toJSON(),e}},pc=class extends Pr{constructor(){super(new ze(90,1,.5,500)),this.isPointLightShadow=!0}},ws=class extends qi{constructor(t,e,n=0,r=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=r,this.shadow=new pc}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}toJSON(t){let e=super.toJSON(t);return e.object.distance=this.distance,e.object.decay=this.decay,e.object.shadow=this.shadow.toJSON(),e}},Rn=class extends Ss{constructor(t=-1,e=1,n=1,r=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=r,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,r,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=r,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=n-t,a=n+t,o=r+e,l=r-e;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,a=s+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}},mc=class extends Pr{constructor(){super(new Rn(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Ci=class extends qi{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Ae.DEFAULT_UP),this.updateMatrix(),this.target=new Ae,this.shadow=new mc}dispose(){super.dispose(),this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}toJSON(t){let e=super.toJSON(t);return e.object.shadow=this.shadow.toJSON(),e.object.target=this.target.uuid,e}};var xr=-90,vr=1,so=class extends Ae{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new ze(xr,vr,t,e);r.layers=this.layers,this.add(r);let s=new ze(xr,vr,t,e);s.layers=this.layers,this.add(s);let a=new ze(xr,vr,t,e);a.layers=this.layers,this.add(a);let o=new ze(xr,vr,t,e);o.layers=this.layers,this.add(o);let l=new ze(xr,vr,t,e);l.layers=this.layers,this.add(l);let c=new ze(xr,vr,t,e);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let t=this.coordinateSystem,e=this.children.concat(),[n,r,s,a,o,l]=e;for(let c of e)this.remove(c);if(t===Nn)n.up.set(0,1,0),n.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===Sr)n.up.set(0,-1,0),n.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(let c of e)this.add(c),c.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:r}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());let[s,a,o,l,c,h]=this.children,d=t.getRenderTarget(),f=t.getActiveCubeFace(),p=t.getActiveMipmapLevel(),_=t.xr.enabled;t.xr.enabled=!1;let b=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let g=!1;t.isWebGLRenderer===!0?g=t.state.buffers.depth.getReversed():g=t.reversedDepthBuffer,t.setRenderTarget(n,0,r),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,s),t.setRenderTarget(n,1,r),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,a),t.setRenderTarget(n,2,r),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,o),t.setRenderTarget(n,3,r),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,l),t.setRenderTarget(n,4,r),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,c),n.texture.generateMipmaps=b,t.setRenderTarget(n,5,r),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,h),t.setRenderTarget(d,f,p),t.xr.enabled=_,n.texture.needsPMREMUpdate=!0}},ao=class extends ze{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}};var Gc="\\[\\]\\.:\\/",pp=new RegExp("["+Gc+"]","g"),Wc="[^"+Gc+"]",mp="[^"+Gc.replace("\\.","")+"]",gp=/((?:WC+[\/:])*)/.source.replace("WC",Wc),_p=/(WCOD+)?/.source.replace("WCOD",mp),xp=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Wc),vp=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Wc),yp=new RegExp("^"+gp+_p+xp+vp+"$"),bp=["material","materials","bones","map"],gc=class{constructor(t,e,n){let r=n||ye.parseTrackName(e);this._targetGroup=t,this._bindings=t.subscribe_(e,r)}getValue(t,e){this.bind();let n=this._targetGroup.nCachedObjects_,r=this._bindings[n];r!==void 0&&r.getValue(t,e)}setValue(t,e){let n=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=n.length;r!==s;++r)n[r].setValue(t,e)}bind(){let t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].bind()}unbind(){let t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].unbind()}},ye=class i{constructor(t,e,n){this.path=e,this.parsedPath=n||i.parseTrackName(e),this.node=i.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,e,n){return t&&t.isAnimationObjectGroup?new i.Composite(t,e,n):new i(t,e,n)}static sanitizeNodeName(t){return t.replace(/\s/g,"_").replace(pp,"")}static parseTrackName(t){let e=yp.exec(t);if(e===null)throw new Error("THREE.PropertyBinding: Cannot parse trackName: "+t);let n={nodeName:e[2],objectName:e[3],objectIndex:e[4],propertyName:e[5],propertyIndex:e[6]},r=n.nodeName&&n.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=n.nodeName.substring(r+1);bp.indexOf(s)!==-1&&(n.nodeName=n.nodeName.substring(0,r),n.objectName=s)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+t);return n}static findNode(t,e){if(e===void 0||e===""||e==="."||e===-1||e===t.name||e===t.uuid)return t;if(t.skeleton){let n=t.skeleton.getBoneByName(e);if(n!==void 0)return n}if(t.children){let n=function(s){for(let a=0;a<s.length;a++){let o=s[a];if(o.name===e||o.uuid===e)return o;let l=n(o.children);if(l)return l}return null},r=n(t.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(t,e){t[e]=this.targetObject[this.propertyName]}_getValue_array(t,e){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)t[e++]=n[r]}_getValue_arrayElement(t,e){t[e]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(t,e){this.resolvedProperty.toArray(t,e)}_setValue_direct(t,e){this.targetObject[this.propertyName]=t[e]}_setValue_direct_setNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(t,e){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)n[r]=t[e++]}_setValue_array_setNeedsUpdate(t,e){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)n[r]=t[e++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(t,e){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)n[r]=t[e++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(t,e){this.resolvedProperty[this.propertyIndex]=t[e]}_setValue_arrayElement_setNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(t,e){this.resolvedProperty.fromArray(t,e)}_setValue_fromArray_setNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(t,e){this.bind(),this.getValue(t,e)}_setValue_unbound(t,e){this.bind(),this.setValue(t,e)}bind(){let t=this.node,e=this.parsedPath,n=e.objectName,r=e.propertyName,s=e.propertyIndex;if(t||(t=i.findNode(this.rootNode,e.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){kt("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=e.objectIndex;switch(n){case"materials":if(!t.material){Ht("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.materials){Ht("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}t=t.material.materials;break;case"bones":if(!t.skeleton){Ht("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}t=t.skeleton.bones;for(let h=0;h<t.length;h++)if(t[h].name===c){c=h;break}break;case"map":if("map"in t){t=t.map;break}if(!t.material){Ht("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.map){Ht("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}t=t.material.map;break;default:if(t[n]===void 0){Ht("PropertyBinding: Can not bind to objectName of node undefined.",this);return}t=t[n]}if(c!==void 0){if(t[c]===void 0){Ht("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,t);return}t=t[c]}}let a=t[r];if(a===void 0){let c=e.nodeName;Ht("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",t);return}let o=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?o=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!t.geometry){Ht("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!t.geometry.morphAttributes){Ht("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}t.morphTargetDictionary[s]!==void 0&&(s=t.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=s}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};ye.Composite=gc;ye.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};ye.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};ye.prototype.GetterByBindingType=[ye.prototype._getValue_direct,ye.prototype._getValue_array,ye.prototype._getValue_arrayElement,ye.prototype._getValue_toArray];ye.prototype.SetterByBindingTypeAndVersioning=[[ye.prototype._setValue_direct,ye.prototype._setValue_direct_setNeedsUpdate,ye.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[ye.prototype._setValue_array,ye.prototype._setValue_array_setNeedsUpdate,ye.prototype._setValue_array_setMatrixWorldNeedsUpdate],[ye.prototype._setValue_arrayElement,ye.prototype._setValue_arrayElement_setNeedsUpdate,ye.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[ye.prototype._setValue_fromArray,ye.prototype._setValue_fromArray_setNeedsUpdate,ye.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var vv=new Float32Array(1);var _c=class i{static{i.prototype.isMatrix2=!0}constructor(t,e,n,r){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,n,r)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let n=0;n<4;n++)this.elements[n]=t[n+e];return this}set(t,e,n,r){let s=this.elements;return s[0]=t,s[2]=e,s[1]=n,s[3]=r,this}};function Xc(i,t,e,n){let r=Mp(n);switch(e){case Fc:return i*t;case mo:return i*t/r.components*r.byteLength;case go:return i*t/r.components*r.byteLength;case Di:return i*t*2/r.components*r.byteLength;case _o:return i*t*2/r.components*r.byteLength;case Oc:return i*t*3/r.components*r.byteLength;case Xe:return i*t*4/r.components*r.byteLength;case xo:return i*t*4/r.components*r.byteLength;case Cs:case Ps:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case Is:case Ls:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case yo:case Mo:return Math.max(i,16)*Math.max(t,8)/4;case vo:case bo:return Math.max(i,8)*Math.max(t,8)/2;case So:case Eo:case To:case Ao:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case wo:case Ds:case Ro:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case Co:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case Po:return Math.floor((i+4)/5)*Math.floor((t+3)/4)*16;case Io:return Math.floor((i+4)/5)*Math.floor((t+4)/5)*16;case Lo:return Math.floor((i+5)/6)*Math.floor((t+4)/5)*16;case Do:return Math.floor((i+5)/6)*Math.floor((t+5)/6)*16;case Uo:return Math.floor((i+7)/8)*Math.floor((t+4)/5)*16;case No:return Math.floor((i+7)/8)*Math.floor((t+5)/6)*16;case Fo:return Math.floor((i+7)/8)*Math.floor((t+7)/8)*16;case Oo:return Math.floor((i+9)/10)*Math.floor((t+4)/5)*16;case Bo:return Math.floor((i+9)/10)*Math.floor((t+5)/6)*16;case ko:return Math.floor((i+9)/10)*Math.floor((t+7)/8)*16;case zo:return Math.floor((i+9)/10)*Math.floor((t+9)/10)*16;case Ho:return Math.floor((i+11)/12)*Math.floor((t+9)/10)*16;case Vo:return Math.floor((i+11)/12)*Math.floor((t+11)/12)*16;case Go:case Wo:case Xo:return Math.ceil(i/4)*Math.ceil(t/4)*16;case qo:case Yo:return Math.ceil(i/4)*Math.ceil(t/4)*8;case Us:case $o:return Math.ceil(i/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function Mp(i){switch(i){case Ve:case Lc:return{byteLength:1,components:1};case Ur:case Dc:case Bn:return{byteLength:2,components:1};case fo:case po:return{byteLength:2,components:4};case On:case uo:case un:return{byteLength:4,components:1};case Uc:case Nc:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"186"}}));typeof window<"u"&&(window.__THREE__?kt("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="186");function bd(){let i=null,t=!1,e=null,n=null;function r(s,a){n=i.requestAnimationFrame(r),e(s,a)}return{start:function(){t!==!0&&e!==null&&i!==null&&(n=i.requestAnimationFrame(r),t=!0)},stop:function(){i!==null&&i.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(s){e=s},setContext:function(s){i=s}}}function Ep(i){let t=new WeakMap;function e(o,l){let c=o.array,h=o.usage,d=c.byteLength,f=i.createBuffer();i.bindBuffer(l,f),i.bufferData(l,c,h),o.onUploadCallback();let p;if(c instanceof Float32Array)p=i.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=i.HALF_FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?p=i.HALF_FLOAT:p=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=i.SHORT;else if(c instanceof Uint32Array)p=i.UNSIGNED_INT;else if(c instanceof Int32Array)p=i.INT;else if(c instanceof Int8Array)p=i.BYTE;else if(c instanceof Uint8Array)p=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:f,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:d}}function n(o,l,c){let h=l.array,d=l.updateRanges;if(i.bindBuffer(c,o),d.length===0)i.bufferSubData(c,0,h);else{d.sort((p,_)=>p.start-_.start);let f=0;for(let p=1;p<d.length;p++){let _=d[f],b=d[p];b.start<=_.start+_.count+1?_.count=Math.max(_.count,b.start+b.count-_.start):(++f,d[f]=b)}d.length=f+1;for(let p=0,_=d.length;p<_;p++){let b=d[p];i.bufferSubData(c,b.start*h.BYTES_PER_ELEMENT,h,b.start,b.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function s(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=t.get(o);l&&(i.deleteBuffer(l.buffer),t.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let h=t.get(o);(!h||h.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=t.get(o);if(c===void 0)t.set(o,e(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:r,remove:s,update:a}}var wp=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Tp=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Ap=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Rp=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Cp=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Pp=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Ip=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Lp=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Dp=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,Up=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Np=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Fp=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Op=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Bp=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,kp=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,zp=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,Hp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Vp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Gp=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Wp=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,Xp=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,qp=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,Yp=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,$p=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Zp=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Jp=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,Kp=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,jp=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Qp=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,tm=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,em="gl_FragColor = linearToOutputTexel( gl_FragColor );",nm=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,im=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,rm=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,sm=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,am=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,om=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,lm=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,cm=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,hm=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,um=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,dm=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,fm=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,pm=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,mm=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,gm=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,_m=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureCubeUV( envMap, envMapRotation * retroVec, roughness );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,xm=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,vm=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,ym=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,bm=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Mm=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,Sm=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Em=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,wm=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Tm=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Am=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,Rm=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Cm=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Pm=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Im=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Lm=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Dm=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Um=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Nm=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Fm=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Om=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Bm=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,km=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,zm=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Hm=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Vm=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Gm=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Wm=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,Xm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,qm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Ym=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,$m=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Zm=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Jm=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Km=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,jm=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Qm=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,t0=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,e0=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,n0=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,i0=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,r0=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,s0=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,a0=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,o0=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,l0=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,c0=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,h0=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,u0=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,d0=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,f0=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,p0=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,m0=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,g0=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,_0=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,x0=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,v0=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,y0=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,b0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,M0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,S0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,E0=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,w0=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,T0=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,A0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,R0=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,C0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,P0=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,I0=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,L0=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,D0=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,U0=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,N0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,F0=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,O0=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,B0=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,k0=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,z0=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,H0=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,V0=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,G0=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,W0=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,X0=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,q0=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,Y0=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,$0=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Z0=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,J0=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,K0=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,j0=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Q0=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,tg=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,eg=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,ng=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,ig=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,rg=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Zt={alphahash_fragment:wp,alphahash_pars_fragment:Tp,alphamap_fragment:Ap,alphamap_pars_fragment:Rp,alphatest_fragment:Cp,alphatest_pars_fragment:Pp,aomap_fragment:Ip,aomap_pars_fragment:Lp,batching_pars_vertex:Dp,batching_vertex:Up,begin_vertex:Np,beginnormal_vertex:Fp,bsdfs:Op,iridescence_fragment:Bp,bumpmap_pars_fragment:kp,clipping_planes_fragment:zp,clipping_planes_pars_fragment:Hp,clipping_planes_pars_vertex:Vp,clipping_planes_vertex:Gp,color_fragment:Wp,color_pars_fragment:Xp,color_pars_vertex:qp,color_vertex:Yp,common:$p,cube_uv_reflection_fragment:Zp,defaultnormal_vertex:Jp,displacementmap_pars_vertex:Kp,displacementmap_vertex:jp,emissivemap_fragment:Qp,emissivemap_pars_fragment:tm,colorspace_fragment:em,colorspace_pars_fragment:nm,envmap_fragment:im,envmap_common_pars_fragment:rm,envmap_pars_fragment:sm,envmap_pars_vertex:am,envmap_physical_pars_fragment:_m,envmap_vertex:om,fog_vertex:lm,fog_pars_vertex:cm,fog_fragment:hm,fog_pars_fragment:um,gradientmap_pars_fragment:dm,lightmap_pars_fragment:fm,lights_lambert_fragment:pm,lights_lambert_pars_fragment:mm,lights_pars_begin:gm,lights_toon_fragment:xm,lights_toon_pars_fragment:vm,lights_phong_fragment:ym,lights_phong_pars_fragment:bm,lights_physical_fragment:Mm,lights_physical_pars_fragment:Sm,lights_fragment_begin:Em,lights_fragment_maps:wm,lights_fragment_end:Tm,lightprobes_pars_fragment:Am,logdepthbuf_fragment:Rm,logdepthbuf_pars_fragment:Cm,logdepthbuf_pars_vertex:Pm,logdepthbuf_vertex:Im,map_fragment:Lm,map_pars_fragment:Dm,map_particle_fragment:Um,map_particle_pars_fragment:Nm,metalnessmap_fragment:Fm,metalnessmap_pars_fragment:Om,morphinstance_vertex:Bm,morphcolor_vertex:km,morphnormal_vertex:zm,morphtarget_pars_vertex:Hm,morphtarget_vertex:Vm,normal_fragment_begin:Gm,normal_fragment_maps:Wm,normal_pars_fragment:Xm,normal_pars_vertex:qm,normal_vertex:Ym,normalmap_pars_fragment:$m,clearcoat_normal_fragment_begin:Zm,clearcoat_normal_fragment_maps:Jm,clearcoat_pars_fragment:Km,iridescence_pars_fragment:jm,opaque_fragment:Qm,packing:t0,premultiplied_alpha_fragment:e0,project_vertex:n0,dithering_fragment:i0,dithering_pars_fragment:r0,roughnessmap_fragment:s0,roughnessmap_pars_fragment:a0,shadowmap_pars_fragment:o0,shadowmap_pars_vertex:l0,shadowmap_vertex:c0,shadowmask_pars_fragment:h0,skinbase_vertex:u0,skinning_pars_vertex:d0,skinning_vertex:f0,skinnormal_vertex:p0,specularmap_fragment:m0,specularmap_pars_fragment:g0,tonemapping_fragment:_0,tonemapping_pars_fragment:x0,transmission_fragment:v0,transmission_pars_fragment:y0,uv_pars_fragment:b0,uv_pars_vertex:M0,uv_vertex:S0,worldpos_vertex:E0,background_vert:w0,background_frag:T0,backgroundCube_vert:A0,backgroundCube_frag:R0,cube_vert:C0,cube_frag:P0,depth_vert:I0,depth_frag:L0,distance_vert:D0,distance_frag:U0,equirect_vert:N0,equirect_frag:F0,linedashed_vert:O0,linedashed_frag:B0,meshbasic_vert:k0,meshbasic_frag:z0,meshlambert_vert:H0,meshlambert_frag:V0,meshmatcap_vert:G0,meshmatcap_frag:W0,meshnormal_vert:X0,meshnormal_frag:q0,meshphong_vert:Y0,meshphong_frag:$0,meshphysical_vert:Z0,meshphysical_frag:J0,meshtoon_vert:K0,meshtoon_frag:j0,points_vert:Q0,points_frag:tg,shadow_vert:eg,shadow_frag:ng,sprite_vert:ig,sprite_frag:rg},yt={common:{diffuse:{value:new Xt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Gt},alphaMap:{value:null},alphaMapTransform:{value:new Gt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Gt}},envmap:{envMap:{value:null},envMapRotation:{value:new Gt},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Gt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Gt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Gt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Gt},normalScale:{value:new Ut(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Gt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Gt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Gt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Gt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Xt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new U},probesMax:{value:new U},probesResolution:{value:new U}},points:{diffuse:{value:new Xt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Gt},alphaTest:{value:0},uvTransform:{value:new Gt}},sprite:{diffuse:{value:new Xt(16777215)},opacity:{value:1},center:{value:new Ut(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Gt},alphaMap:{value:null},alphaMapTransform:{value:new Gt},alphaTest:{value:0}}},Jn={basic:{uniforms:je([yt.common,yt.specularmap,yt.envmap,yt.aomap,yt.lightmap,yt.fog]),vertexShader:Zt.meshbasic_vert,fragmentShader:Zt.meshbasic_frag},lambert:{uniforms:je([yt.common,yt.specularmap,yt.envmap,yt.aomap,yt.lightmap,yt.emissivemap,yt.bumpmap,yt.normalmap,yt.displacementmap,yt.fog,yt.lights,{emissive:{value:new Xt(0)},envMapIntensity:{value:1}}]),vertexShader:Zt.meshlambert_vert,fragmentShader:Zt.meshlambert_frag},phong:{uniforms:je([yt.common,yt.specularmap,yt.envmap,yt.aomap,yt.lightmap,yt.emissivemap,yt.bumpmap,yt.normalmap,yt.displacementmap,yt.fog,yt.lights,{emissive:{value:new Xt(0)},specular:{value:new Xt(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Zt.meshphong_vert,fragmentShader:Zt.meshphong_frag},standard:{uniforms:je([yt.common,yt.envmap,yt.aomap,yt.lightmap,yt.emissivemap,yt.bumpmap,yt.normalmap,yt.displacementmap,yt.roughnessmap,yt.metalnessmap,yt.fog,yt.lights,{emissive:{value:new Xt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Zt.meshphysical_vert,fragmentShader:Zt.meshphysical_frag},toon:{uniforms:je([yt.common,yt.aomap,yt.lightmap,yt.emissivemap,yt.bumpmap,yt.normalmap,yt.displacementmap,yt.gradientmap,yt.fog,yt.lights,{emissive:{value:new Xt(0)}}]),vertexShader:Zt.meshtoon_vert,fragmentShader:Zt.meshtoon_frag},matcap:{uniforms:je([yt.common,yt.bumpmap,yt.normalmap,yt.displacementmap,yt.fog,{matcap:{value:null}}]),vertexShader:Zt.meshmatcap_vert,fragmentShader:Zt.meshmatcap_frag},points:{uniforms:je([yt.points,yt.fog]),vertexShader:Zt.points_vert,fragmentShader:Zt.points_frag},dashed:{uniforms:je([yt.common,yt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Zt.linedashed_vert,fragmentShader:Zt.linedashed_frag},depth:{uniforms:je([yt.common,yt.displacementmap]),vertexShader:Zt.depth_vert,fragmentShader:Zt.depth_frag},normal:{uniforms:je([yt.common,yt.bumpmap,yt.normalmap,yt.displacementmap,{opacity:{value:1}}]),vertexShader:Zt.meshnormal_vert,fragmentShader:Zt.meshnormal_frag},sprite:{uniforms:je([yt.sprite,yt.fog]),vertexShader:Zt.sprite_vert,fragmentShader:Zt.sprite_frag},background:{uniforms:{uvTransform:{value:new Gt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Zt.background_vert,fragmentShader:Zt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Gt}},vertexShader:Zt.backgroundCube_vert,fragmentShader:Zt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Zt.cube_vert,fragmentShader:Zt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Zt.equirect_vert,fragmentShader:Zt.equirect_frag},distance:{uniforms:je([yt.common,yt.displacementmap,{referencePosition:{value:new U},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Zt.distance_vert,fragmentShader:Zt.distance_frag},shadow:{uniforms:je([yt.lights,yt.fog,{color:{value:new Xt(0)},opacity:{value:1}}]),vertexShader:Zt.shadow_vert,fragmentShader:Zt.shadow_frag}};Jn.physical={uniforms:je([Jn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Gt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Gt},clearcoatNormalScale:{value:new Ut(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Gt},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Gt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Gt},sheen:{value:0},sheenColor:{value:new Xt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Gt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Gt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Gt},transmissionSamplerSize:{value:new Ut},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Gt},attenuationDistance:{value:0},attenuationColor:{value:new Xt(0)},specularColor:{value:new Xt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Gt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Gt},anisotropyVector:{value:new Ut},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Gt}}]),vertexShader:Zt.meshphysical_vert,fragmentShader:Zt.meshphysical_frag};var jo={r:0,b:0,g:0},sg=new ie,Md=new Gt;Md.set(-1,0,0,0,1,0,0,0,1);function ag(i,t,e,n,r,s){let a=new Xt(0),o=r===!0?0:1,l,c,h=null,d=0,f=null;function p(E){let T=E.isScene===!0?E.background:null;if(T&&T.isTexture){let v=E.backgroundBlurriness>0;T=t.get(T,v)}return T}function _(E){let T=!1,v=p(E);v===null?g(a,o):v&&v.isColor&&(g(v,1),T=!0);let M=i.xr.getEnvironmentBlendMode();M==="additive"?e.buffers.color.setClear(0,0,0,1,s):M==="alpha-blend"&&e.buffers.color.setClear(0,0,0,0,s),(i.autoClear||T)&&(e.buffers.depth.setTest(!0),e.buffers.depth.setMask(!0),e.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function b(E,T){let v=p(T);v&&(v.isCubeTexture||v.mapping===As)?(c===void 0&&(c=new Vt(new Rr(1,1,1),new Re({name:"BackgroundCubeMaterial",uniforms:Ji(Jn.backgroundCube.uniforms),vertexShader:Jn.backgroundCube.vertexShader,fragmentShader:Jn.backgroundCube.fragmentShader,side:We,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(M,y,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(c)),c.material.uniforms.envMap.value=v,c.material.uniforms.backgroundBlurriness.value=T.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=T.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(sg.makeRotationFromEuler(T.backgroundRotation)).transpose(),v.isCubeTexture&&v.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(Md),c.material.toneMapped=jt.getTransfer(v.colorSpace)!==ce,(h!==v||d!==v.version||f!==i.toneMapping)&&(c.material.needsUpdate=!0,h=v,d=v.version,f=i.toneMapping),c.layers.enableAll(),E.unshift(c,c.geometry,c.material,0,0,null)):v&&v.isTexture&&(l===void 0&&(l=new Vt(new fe(2,2),new Re({name:"BackgroundMaterial",uniforms:Ji(Jn.background.uniforms),vertexShader:Jn.background.vertexShader,fragmentShader:Jn.background.fragmentShader,side:qn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(l)),l.material.uniforms.t2D.value=v,l.material.uniforms.backgroundIntensity.value=T.backgroundIntensity,l.material.toneMapped=jt.getTransfer(v.colorSpace)!==ce,v.matrixAutoUpdate===!0&&v.updateMatrix(),l.material.uniforms.uvTransform.value.copy(v.matrix),(h!==v||d!==v.version||f!==i.toneMapping)&&(l.material.needsUpdate=!0,h=v,d=v.version,f=i.toneMapping),l.layers.enableAll(),E.unshift(l,l.geometry,l.material,0,0,null))}function g(E,T){E.getRGB(jo,Vc(i)),e.buffers.color.setClear(jo.r,jo.g,jo.b,T,s)}function m(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(E,T=1){a.set(E),o=T,g(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(E){o=E,g(a,o)},render:_,addToRenderList:b,dispose:m}}function og(i,t){let e=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},r=f(null),s=r,a=!1;function o(N,R,G,L,O){let $=!1,X=d(N,L,G,R);s!==X&&(s=X,c(s.object)),$=p(N,L,G,O),$&&_(N,L,G,O),O!==null&&t.update(O,i.ELEMENT_ARRAY_BUFFER),($||a)&&(a=!1,v(N,R,G,L),O!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(O).buffer))}function l(){return i.createVertexArray()}function c(N){return i.bindVertexArray(N)}function h(N){return i.deleteVertexArray(N)}function d(N,R,G,L){let O=L.wireframe===!0,$=n[R.id];$===void 0&&($={},n[R.id]=$);let X=N.isInstancedMesh===!0?N.id:0,rt=$[X];rt===void 0&&(rt={},$[X]=rt);let q=rt[G.id];q===void 0&&(q={},rt[G.id]=q);let K=q[O];return K===void 0&&(K=f(l()),q[O]=K),K}function f(N){let R=[],G=[],L=[];for(let O=0;O<e;O++)R[O]=0,G[O]=0,L[O]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:R,enabledAttributes:G,attributeDivisors:L,object:N,attributes:{},index:null}}function p(N,R,G,L){let O=s.attributes,$=R.attributes,X=0,rt=G.getAttributes();for(let q in rt)if(rt[q].location>=0){let st=O[q],ot=$[q];if(ot===void 0&&(q==="instanceMatrix"&&N.instanceMatrix&&(ot=N.instanceMatrix),q==="instanceColor"&&N.instanceColor&&(ot=N.instanceColor)),st===void 0||st.attribute!==ot||ot&&st.data!==ot.data)return!0;X++}return s.attributesNum!==X||s.index!==L}function _(N,R,G,L){let O={},$=R.attributes,X=0,rt=G.getAttributes();for(let q in rt)if(rt[q].location>=0){let st=$[q];st===void 0&&(q==="instanceMatrix"&&N.instanceMatrix&&(st=N.instanceMatrix),q==="instanceColor"&&N.instanceColor&&(st=N.instanceColor));let ot={};ot.attribute=st,st&&st.data&&(ot.data=st.data),O[q]=ot,X++}s.attributes=O,s.attributesNum=X,s.index=L}function b(){let N=s.newAttributes;for(let R=0,G=N.length;R<G;R++)N[R]=0}function g(N){m(N,0)}function m(N,R){let G=s.newAttributes,L=s.enabledAttributes,O=s.attributeDivisors;G[N]=1,L[N]===0&&(i.enableVertexAttribArray(N),L[N]=1),O[N]!==R&&(i.vertexAttribDivisor(N,R),O[N]=R)}function E(){let N=s.newAttributes,R=s.enabledAttributes;for(let G=0,L=R.length;G<L;G++)R[G]!==N[G]&&(i.disableVertexAttribArray(G),R[G]=0)}function T(N,R,G,L,O,$,X){X===!0?i.vertexAttribIPointer(N,R,G,O,$):i.vertexAttribPointer(N,R,G,L,O,$)}function v(N,R,G,L){b();let O=L.attributes,$=G.getAttributes(),X=R.defaultAttributeValues;for(let rt in $){let q=$[rt];if(q.location>=0){let K=O[rt];if(K===void 0&&(rt==="instanceMatrix"&&N.instanceMatrix&&(K=N.instanceMatrix),rt==="instanceColor"&&N.instanceColor&&(K=N.instanceColor)),K!==void 0){let st=K.normalized,ot=K.itemSize,Q=t.get(K);if(Q===void 0)continue;let _t=Q.buffer,gt=Q.type,Mt=Q.bytesPerElement,W=gt===i.INT||gt===i.UNSIGNED_INT||K.gpuType===uo;if(K.isInterleavedBufferAttribute){let Y=K.data,ft=Y.stride,Ct=K.offset;if(Y.isInstancedInterleavedBuffer){for(let pt=0;pt<q.locationSize;pt++)m(q.location+pt,Y.meshPerAttribute);N.isInstancedMesh!==!0&&L._maxInstanceCount===void 0&&(L._maxInstanceCount=Y.meshPerAttribute*Y.count)}else for(let pt=0;pt<q.locationSize;pt++)g(q.location+pt);i.bindBuffer(i.ARRAY_BUFFER,_t);for(let pt=0;pt<q.locationSize;pt++)T(q.location+pt,ot/q.locationSize,gt,st,ft*Mt,(Ct+ot/q.locationSize*pt)*Mt,W)}else{if(K.isInstancedBufferAttribute){for(let Y=0;Y<q.locationSize;Y++)m(q.location+Y,K.meshPerAttribute);N.isInstancedMesh!==!0&&L._maxInstanceCount===void 0&&(L._maxInstanceCount=K.meshPerAttribute*K.count)}else for(let Y=0;Y<q.locationSize;Y++)g(q.location+Y);i.bindBuffer(i.ARRAY_BUFFER,_t);for(let Y=0;Y<q.locationSize;Y++)T(q.location+Y,ot/q.locationSize,gt,st,ot*Mt,ot/q.locationSize*Y*Mt,W)}}else if(X!==void 0){let st=X[rt];if(st!==void 0)switch(st.length){case 2:i.vertexAttrib2fv(q.location,st);break;case 3:i.vertexAttrib3fv(q.location,st);break;case 4:i.vertexAttrib4fv(q.location,st);break;default:i.vertexAttrib1fv(q.location,st)}}}}E()}function M(){w();for(let N in n){let R=n[N];for(let G in R){let L=R[G];for(let O in L){let $=L[O];for(let X in $)h($[X].object),delete $[X];delete L[O]}}delete n[N]}}function y(N){if(n[N.id]===void 0)return;let R=n[N.id];for(let G in R){let L=R[G];for(let O in L){let $=L[O];for(let X in $)h($[X].object),delete $[X];delete L[O]}}delete n[N.id]}function C(N){for(let R in n){let G=n[R];for(let L in G){let O=G[L];if(O[N.id]===void 0)continue;let $=O[N.id];for(let X in $)h($[X].object),delete $[X];delete O[N.id]}}}function x(N){for(let R in n){let G=n[R],L=N.isInstancedMesh===!0?N.id:0,O=G[L];if(O!==void 0){for(let $ in O){let X=O[$];for(let rt in X)h(X[rt].object),delete X[rt];delete O[$]}delete G[L],Object.keys(G).length===0&&delete n[R]}}}function w(){I(),a=!0,s!==r&&(s=r,c(s.object))}function I(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:o,reset:w,resetDefaultState:I,dispose:M,releaseStatesOfGeometry:y,releaseStatesOfObject:x,releaseStatesOfProgram:C,initAttributes:b,enableAttribute:g,disableUnusedAttributes:E}}function lg(i,t,e){let n;function r(l){n=l}function s(l,c){i.drawArrays(n,l,c),e.update(c,n,1)}function a(l,c,h){h!==0&&(i.drawArraysInstanced(n,l,c,h),e.update(c,n,h))}function o(l,c,h){if(h===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,c,0,h);let f=0;for(let p=0;p<h;p++)f+=c[p];e.update(f,n,1)}this.setMode=r,this.render=s,this.renderInstances=a,this.renderMultiDraw=o}function cg(i,t,e,n){let r;function s(){if(r!==void 0)return r;if(t.has("EXT_texture_filter_anisotropic")===!0){let C=t.get("EXT_texture_filter_anisotropic");r=i.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function a(C){return!(C!==Xe&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(C){let x=C===Bn&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(C!==Ve&&C!==un&&!x&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE))}function l(C){if(C==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=e.precision!==void 0?e.precision:"highp",h=l(c);h!==c&&(kt("WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);let d=e.logarithmicDepthBuffer===!0,f=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control");e.reversedDepthBuffer===!0&&f===!1&&kt("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let p=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),_=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),b=i.getParameter(i.MAX_TEXTURE_SIZE),g=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),m=i.getParameter(i.MAX_VERTEX_ATTRIBS),E=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),T=i.getParameter(i.MAX_VARYING_VECTORS),v=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),M=i.getParameter(i.MAX_SAMPLES),y=i.getParameter(i.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:d,reversedDepthBuffer:f,maxTextures:p,maxVertexTextures:_,maxTextureSize:b,maxCubemapSize:g,maxAttributes:m,maxVertexUniforms:E,maxVaryings:T,maxFragmentUniforms:v,maxSamples:M,samples:y}}function hg(i){let t=this,e=null,n=0,r=!1,s=!1,a=new Un,o=new Gt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,f){let p=d.length!==0||f||n!==0||r;return r=f,n=d.length,p},this.beginShadows=function(){s=!0,h(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,f){e=h(d,f,0)},this.setState=function(d,f,p){let _=d.clippingPlanes,b=d.clipIntersection,g=d.clipShadows,m=i.get(d);if(!r||_===null||_.length===0||s&&!g)s?h(null):c();else{let E=s?0:n,T=E*4,v=m.clippingState||null;l.value=v,v=h(_,f,T,p);for(let M=0;M!==T;++M)v[M]=e[M];m.clippingState=v,this.numIntersection=b?this.numPlanes:0,this.numPlanes+=E}};function c(){l.value!==e&&(l.value=e,l.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function h(d,f,p,_){let b=d!==null?d.length:0,g=null;if(b!==0){if(g=l.value,_!==!0||g===null){let m=p+b*4,E=f.matrixWorldInverse;o.getNormalMatrix(E),(g===null||g.length<m)&&(g=new Float32Array(m));for(let T=0,v=p;T!==b;++T,v+=4)a.copy(d[T]).applyMatrix4(E,o),a.normal.toArray(g,v),g[v+3]=a.constant}l.value=g,l.needsUpdate=!0}return t.numPlanes=b,t.numIntersection=0,g}}var Br=4,ug=6,dg=20,fg=256,ks=new Rn,td=new Xt,qc=null,Yc=0,$c=0,Zc=!1,pg=new U,Ki=new U,tl=class{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(t,e=0,n=.1,r=100,s={}){let{size:a=256,position:o=pg}=s;qc=this._renderer.getRenderTarget(),Yc=this._renderer.getActiveCubeFace(),$c=this._renderer.getActiveMipmapLevel(),Zc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,n,r,l,o),e>0&&this._blur(l,0,0,e),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=id(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=nd(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodMeshes.length;t++)this._lodMeshes[t].geometry.dispose()}_cleanup(t){this._renderer.setRenderTarget(qc,Yc,$c),this._renderer.xr.enabled=Zc,t.scissorTest=!1,Or(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===Ii||t.mapping===Zi?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),qc=this._renderer.getRenderTarget(),Yc=this._renderer.getActiveCubeFace(),$c=this._renderer.getActiveMipmapLevel(),Zc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:Le,minFilter:Le,generateMipmaps:!1,type:Bn,format:Xe,colorSpace:Gi,depthBuffer:!1},r=ed(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=ed(t,e,n);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods}=mg(s)),this._blurMaterial=_g(s,t,e),this._ggxMaterial=gg(s,t,e)}return r}_compileMaterial(t){let e=new Vt(new we,t);this._renderer.compile(e,ks)}_sceneToCubeUV(t,e,n,r,s){let l=new ze(90,1,e,n),c=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],d=this._renderer,f=d.autoClear,p=d.toneMapping;d.getClearColor(td),d.toneMapping=vn,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(r),d.clearDepth(),d.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Vt(new Rr,new rn({name:"PMREM.Background",side:We,depthWrite:!1,depthTest:!1})));let b=this._backgroundBox,g=b.material,m=!1,E=t.background;E?E.isColor&&(g.color.copy(E),t.background=null,m=!0):(g.color.copy(td),m=!0);for(let T=0;T<6;T++){let v=T%3;v===0?(l.up.set(0,c[T],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+h[T],s.y,s.z)):v===1?(l.up.set(0,0,c[T]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+h[T],s.z)):(l.up.set(0,c[T],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+h[T]));let M=this._cubeSize;Or(r,v*M,T>2?M:0,M,M),d.setRenderTarget(r),m&&d.render(b,l),d.render(t,l)}d.toneMapping=p,d.autoClear=f,t.background=E}_textureToCubeUV(t,e){let n=this._renderer,r=t.mapping===Ii||t.mapping===Zi;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=id()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=nd());let s=r?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=s;let o=s.uniforms;o.envMap.value=t;let l=this._cubeSize;Or(e,0,0,3*l,2*l),n.setRenderTarget(e),n.render(a,ks)}_applyPMREM(t){let e=this._renderer,n=e.autoClear;e.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(t,s-1,s);e.autoClear=n}_applyGGXFilter(t,e,n){let r=this._renderer,s=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let l=a.uniforms,c=n/(this._lodMeshes.length-1),h=e/(this._lodMeshes.length-1),d=Math.sqrt(c*c-h*h),f=c*1.25,p=d*f,{_lodMax:_}=this,b=this._sizeLods[n],g=3*b*(n>_-Br?n-_+Br:0),m=4*(this._cubeSize-b);l.envMap.value=t.texture,l.roughness.value=p,l.mipInt.value=_-e,Or(s,g,m,3*b,2*b),r.setRenderTarget(s),r.render(o,ks),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=_-n,Or(t,g,m,3*b,2*b),r.setRenderTarget(t),r.render(o,ks)}_blur(t,e,n,r){let s=this._pingPongRenderTarget,a=Math.min(r,Math.PI)/Math.SQRT2;this._blurPass(t,s,e,n,a),this._blurPass(s,t,n,n,a)}_blurPass(t,e,n,r,s){let a=this._renderer,o=this._blurMaterial,l=this._lodMeshes[r];l.material=o;let c=o.uniforms;c.envMap.value=t.texture,c.sigma.value=s,c.mipInt.value=this._lodMax-n;let h=this._sizeLods[r],d=3*h*(r>this._lodMax-Br?r-this._lodMax+Br:0),f=4*(this._cubeSize-h);Or(e,d,f,3*h,2*h),a.setRenderTarget(e),a.render(l,ks)}};function mg(i){let t=[],e=[],n=i,r=i-Br+1+ug;for(let s=0;s<r;s++){let a=Math.pow(2,n);t.push(a);let o=1/(a-2),l=-o,c=1+o,h=[l,l,c,l,c,c,l,l,c,c,l,c],d=6,f=6,p=3,_=new Float32Array(p*f*d),b=new Float32Array(p*f*d);for(let m=0;m<d;m++){let E=m%3*2/3-1,T=m>2?0:-1,v=[E,T,0,E+2/3,T,0,E+2/3,T+1,0,E,T,0,E+2/3,T+1,0,E,T+1,0];_.set(v,p*f*m);for(let M=0;M<f;M++){let y=h[M*2]*2-1,C=h[M*2+1]*2-1;m===0?Ki.set(1,C,y):m===1?Ki.set(-y,1,-C):m===2?Ki.set(-y,C,1):m===3?Ki.set(-1,C,-y):m===4?Ki.set(-y,-1,C):Ki.set(y,C,-1),Ki.toArray(b,(m*f+M)*p)}}let g=new we;g.setAttribute("position",new De(_,p)),g.setAttribute("outputDirection",new De(b,p)),e.push(new Vt(g,null)),n>Br&&n--}return{lodMeshes:e,sizeLods:t}}function ed(i,t,e){let n=new Ge(i,t,e);return n.texture.mapping=As,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Or(i,t,e,n,r){i.viewport.set(t,e,n,r),i.scissor.set(t,e,n,r)}function gg(i,t,e){return new Re({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:fg,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:il(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function _g(i,t,e){return new Re({name:"SphericalGaussianBlur",defines:{SAMPLES:dg,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},sigma:{value:0},mipInt:{value:0}},vertexShader:il(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float sigma;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359
			#define GOLDEN_ANGLE 2.39996322973

			void main() {

				if ( sigma == 0.0 ) {

					gl_FragColor = vec4( bilinearCubeUV( envMap, vOutputDirection, mipInt ), 1.0 );
					return;

				}

				vec3 outputDirection = normalize( vOutputDirection );

				vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
				vec3 tangent = normalize( cross( up, outputDirection ) );
				vec3 bitangent = cross( outputDirection, tangent );

				// Truncate the kernel at three standard deviations or at the antipode.
				float thetaMax = min( 3.0 * sigma, PI );
				float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

				vec3 accumColor = vec3( 0.0 );
				float accumWeight = 0.0;

				for ( int i = 0; i < SAMPLES; i ++ ) {

					// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
					float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
					float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
					float phi = float( i ) * GOLDEN_ANGLE;

					vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
					vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

					// Correct the planar sample density to solid angle.
					float weight = sin( theta ) / theta;

					accumColor += weight * bilinearCubeUV( envMap, sampleDirection, mipInt );
					accumWeight += weight;

				}

				gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function nd(){return new Re({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:il(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function id(){return new Re({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:il(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function il(){return`

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`}var el=class extends Ge{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;let n={width:t,height:t,depth:1},r=[n,n,n,n,n,n];this.texture=new ps(r),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new Rr(5,5,5),s=new Re({name:"CubemapFromEquirect",uniforms:Ji(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:We,blending:Yn});s.uniforms.tEquirect.value=e;let a=new Vt(r,s),o=e.minFilter;return e.minFilter===$n&&(e.minFilter=Le),new so(1,10,this).update(t,a),e.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(t,e=!0,n=!0,r=!0){let s=t.getRenderTarget();for(let a=0;a<6;a++)t.setRenderTarget(this,a),t.clear(e,n,r);t.setRenderTarget(s)}};function xg(i){let t=new WeakMap,e=new WeakMap,n=null;function r(f,p=!1){return f==null?null:p?a(f):s(f)}function s(f){if(f&&f.isTexture){let p=f.mapping;if(p===lo||p===co)if(t.has(f)){let _=t.get(f).texture;return o(_,f.mapping)}else{let _=f.image;if(_&&_.height>0){let b=new el(_.height);return b.fromEquirectangularTexture(i,f),t.set(f,b),f.addEventListener("dispose",c),o(b.texture,f.mapping)}else return null}}return f}function a(f){if(f&&f.isTexture){let p=f.mapping,_=p===lo||p===co,b=p===Ii||p===Zi;if(_||b){let g=e.get(f),m=g!==void 0?g.texture.pmremVersion:0;if(f.isRenderTargetTexture&&f.pmremVersion!==m)return n===null&&(n=new tl(i)),g=_?n.fromEquirectangular(f,g):n.fromCubemap(f,g),g.texture.pmremVersion=f.pmremVersion,e.set(f,g),g.texture;if(g!==void 0)return g.texture;{let E=f.image;return _&&E&&E.height>0||b&&E&&l(E)?(n===null&&(n=new tl(i)),g=_?n.fromEquirectangular(f):n.fromCubemap(f),g.texture.pmremVersion=f.pmremVersion,e.set(f,g),f.addEventListener("dispose",h),g.texture):null}}}return f}function o(f,p){return p===lo?f.mapping=Ii:p===co&&(f.mapping=Zi),f}function l(f){let p=0,_=6;for(let b=0;b<_;b++)f[b]!==void 0&&p++;return p===_}function c(f){let p=f.target;p.removeEventListener("dispose",c);let _=t.get(p);_!==void 0&&(t.delete(p),_.dispose())}function h(f){let p=f.target;p.removeEventListener("dispose",h);let _=e.get(p);_!==void 0&&(e.delete(p),_.dispose())}function d(){t=new WeakMap,e=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:r,dispose:d}}function vg(i){let t={};function e(n){if(t[n]!==void 0)return t[n];let r=i.getExtension(n);return t[n]=r,r}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){let r=e(n);return r===null&&Vi("WebGLRenderer: "+n+" extension not supported."),r}}}function yg(i,t,e,n){let r={},s=new WeakMap;function a(d){let f=d.target;f.index!==null&&t.remove(f.index);for(let _ in f.attributes)t.remove(f.attributes[_]);f.removeEventListener("dispose",a),delete r[f.id];let p=s.get(f);p&&(t.remove(p),s.delete(f)),n.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,e.memory.geometries--}function o(d,f){return r[f.id]===!0||(f.addEventListener("dispose",a),r[f.id]=!0,e.memory.geometries++),f}function l(d){let f=d.attributes;for(let p in f)t.update(f[p],i.ARRAY_BUFFER)}function c(d){let f=[],p=d.index,_=d.attributes.position,b=0;if(_===void 0)return;if(p!==null){let E=p.array;b=p.version;for(let T=0,v=E.length;T<v;T+=3){let M=E[T+0],y=E[T+1],C=E[T+2];f.push(M,y,y,C,C,M)}}else{let E=_.array;b=_.version;for(let T=0,v=E.length/3-1;T<v;T+=3){let M=T+0,y=T+1,C=T+2;f.push(M,y,y,C,C,M)}}let g=new(_.count>=65535?hs:cs)(f,1);g.version=b;let m=s.get(d);m&&t.remove(m),s.set(d,g)}function h(d){let f=s.get(d);if(f){let p=d.index;p!==null&&f.version<p.version&&c(d)}else c(d);return s.get(d)}return{get:o,update:l,getWireframeAttribute:h}}function bg(i,t,e){let n;function r(d){n=d}let s,a;function o(d){s=d.type,a=d.bytesPerElement}function l(d,f){i.drawElements(n,f,s,d*a),e.update(f,n,1)}function c(d,f,p){p!==0&&(i.drawElementsInstanced(n,f,s,d*a,p),e.update(f,n,p))}function h(d,f,p){if(p===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,f,0,s,d,0,p);let b=0;for(let g=0;g<p;g++)b+=f[g];e.update(b,n,1)}this.setMode=r,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h}function Mg(i){let t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(s,a,o){switch(e.calls++,a){case i.TRIANGLES:e.triangles+=o*(s/3);break;case i.LINES:e.lines+=o*(s/2);break;case i.LINE_STRIP:e.lines+=o*(s-1);break;case i.LINE_LOOP:e.lines+=o*s;break;case i.POINTS:e.points+=o*s;break;default:Ht("WebGLInfo: Unknown draw mode:",a);break}}function r(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:r,update:n}}function Sg(i,t,e){let n=new WeakMap,r=new Me;function s(a,o,l){let c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,d=h!==void 0?h.length:0,f=n.get(o);if(f===void 0||f.count!==d){let w=function(){C.dispose(),n.delete(o),o.removeEventListener("dispose",w)};f!==void 0&&f.texture.dispose();let p=o.morphAttributes.position!==void 0,_=o.morphAttributes.normal!==void 0,b=o.morphAttributes.color!==void 0,g=o.morphAttributes.position||[],m=o.morphAttributes.normal||[],E=o.morphAttributes.color||[],T=0;p===!0&&(T=1),_===!0&&(T=2),b===!0&&(T=3);let v=o.attributes.position.count*T,M=1;v>t.maxTextureSize&&(M=Math.ceil(v/t.maxTextureSize),v=t.maxTextureSize);let y=new Float32Array(v*M*4*d),C=new os(y,v,M,d);C.type=un,C.needsUpdate=!0;let x=T*4;for(let I=0;I<d;I++){let N=g[I],R=m[I],G=E[I],L=v*M*4*I;for(let O=0;O<N.count;O++){let $=O*x;p===!0&&(r.fromBufferAttribute(N,O),y[L+$+0]=r.x,y[L+$+1]=r.y,y[L+$+2]=r.z,y[L+$+3]=0),_===!0&&(r.fromBufferAttribute(R,O),y[L+$+4]=r.x,y[L+$+5]=r.y,y[L+$+6]=r.z,y[L+$+7]=0),b===!0&&(r.fromBufferAttribute(G,O),y[L+$+8]=r.x,y[L+$+9]=r.y,y[L+$+10]=r.z,y[L+$+11]=G.itemSize===4?r.w:1)}}f={count:d,texture:C,size:new Ut(v,M)},n.set(o,f),o.addEventListener("dispose",w)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",a.morphTexture,e);else{let p=0;for(let b=0;b<c.length;b++)p+=c[b];let _=o.morphTargetsRelative?1:1-p;l.getUniforms().setValue(i,"morphTargetBaseInfluence",_),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",f.texture,e),l.getUniforms().setValue(i,"morphTargetsTextureSize",f.size)}return{update:s}}function Eg(i,t,e,n,r){let s=new WeakMap;function a(c){let h=r.render.frame,d=c.geometry,f=t.get(c,d);if(s.get(f)!==h&&(t.update(f),s.set(f,h)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==h&&(e.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&e.update(c.instanceColor,i.ARRAY_BUFFER),s.set(c,h))),c.isSkinnedMesh){let p=c.skeleton;s.get(p)!==h&&(p.update(),s.set(p,h))}return f}function o(){s=new WeakMap}function l(c){let h=c.target;h.removeEventListener("dispose",l),n.releaseStatesOfObject(h),e.remove(h.instanceMatrix),h.instanceColor!==null&&e.remove(h.instanceColor)}return{update:a,dispose:o}}var wg={[Ec]:"LINEAR_TONE_MAPPING",[wc]:"REINHARD_TONE_MAPPING",[Tc]:"CINEON_TONE_MAPPING",[Ac]:"ACES_FILMIC_TONE_MAPPING",[Cc]:"AGX_TONE_MAPPING",[Pc]:"NEUTRAL_TONE_MAPPING",[Rc]:"CUSTOM_TONE_MAPPING"};function Tg(i,t,e,n,r,s){let a=new Ge(t,e,{type:i,depthBuffer:r,stencilBuffer:s,samples:n?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),o=null,l=null,c=new we;c.setAttribute("position",new re([-1,3,0,-1,-1,0,3,-1,0],3)),c.setAttribute("uv",new re([0,2,0,0,2,0],2));let h=new Ya({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),d=new Vt(c,h),f=new Rn(-1,1,1,-1,0,1),p=null,_=null,b=!1,g,m=null,E=[],T=!1;this.setSize=function(v,M){a.setSize(v,M),o!==null&&o.setSize(v,M),l!==null&&l.setSize(v,M);for(let y=0;y<E.length;y++){let C=E[y];C.setSize&&C.setSize(v,M)}},this.setEffects=function(v){E=v,T=E.length>0&&E[0].isRenderPass===!0;let M=a.width,y=a.height;E.length>0&&o===null&&(o=new Ge(M,y,{type:Bn,depthBuffer:!1,stencilBuffer:!1}),l=new Ge(M,y,{type:Bn,depthBuffer:!1,stencilBuffer:!1}));for(let C=0;C<E.length;C++){let x=E[C];x.setSize&&x.setSize(M,y)}},this.begin=function(v,M){if(b||v.toneMapping===vn&&E.length===0)return!1;if(m=M,M!==null){let y=M.width,C=M.height;(a.width!==y||a.height!==C)&&this.setSize(y,C)}return T===!1&&v.setRenderTarget(a),g=v.toneMapping,v.toneMapping=vn,!0},this.hasRenderPass=function(){return T},this.end=function(v,M){v.toneMapping=g,b=!0;let y=a,C=o;for(let x=0;x<E.length;x++){let w=E[x];w.enabled!==!1&&(w.render(v,C,y,M),w.needsSwap!==!1&&(y=C,C=C===o?l:o))}if(p!==v.outputColorSpace||_!==v.toneMapping){p=v.outputColorSpace,_=v.toneMapping,h.defines={},jt.getTransfer(p)===ce&&(h.defines.SRGB_TRANSFER="");let x=wg[_];x&&(h.defines[x]=""),h.needsUpdate=!0}h.uniforms.tDiffuse.value=y.texture,v.setRenderTarget(m),v.render(d,f),m=null,b=!1},this.isCompositing=function(){return b},this.dispose=function(){a.dispose(),o!==null&&o.dispose(),l!==null&&l.dispose(),c.dispose(),h.dispose()}}var Sd=new nn,jc=new Ei(1,1),Ed=new os,wd=new Fa,Td=new ps,rd=[],sd=[],ad=new Float32Array(16),od=new Float32Array(9),ld=new Float32Array(4);function zr(i,t,e){let n=i[0];if(n<=0||n>0)return i;let r=t*e,s=rd[r];if(s===void 0&&(s=new Float32Array(r),rd[r]=s),t!==0){n.toArray(s,0);for(let a=1,o=0;a!==t;++a)o+=e,i[a].toArray(s,o)}return s}function Ne(i,t){if(i.length!==t.length)return!1;for(let e=0,n=i.length;e<n;e++)if(i[e]!==t[e])return!1;return!0}function Fe(i,t){for(let e=0,n=t.length;e<n;e++)i[e]=t[e]}function rl(i,t){let e=sd[t];e===void 0&&(e=new Int32Array(t),sd[t]=e);for(let n=0;n!==t;++n)e[n]=i.allocateTextureUnit();return e}function Ag(i,t){let e=this.cache;e[0]!==t&&(i.uniform1f(this.addr,t),e[0]=t)}function Rg(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ne(e,t))return;i.uniform2fv(this.addr,t),Fe(e,t)}}function Cg(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(i.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(Ne(e,t))return;i.uniform3fv(this.addr,t),Fe(e,t)}}function Pg(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ne(e,t))return;i.uniform4fv(this.addr,t),Fe(e,t)}}function Ig(i,t){let e=this.cache,n=t.elements;if(n===void 0){if(Ne(e,t))return;i.uniformMatrix2fv(this.addr,!1,t),Fe(e,t)}else{if(Ne(e,n))return;ld.set(n),i.uniformMatrix2fv(this.addr,!1,ld),Fe(e,n)}}function Lg(i,t){let e=this.cache,n=t.elements;if(n===void 0){if(Ne(e,t))return;i.uniformMatrix3fv(this.addr,!1,t),Fe(e,t)}else{if(Ne(e,n))return;od.set(n),i.uniformMatrix3fv(this.addr,!1,od),Fe(e,n)}}function Dg(i,t){let e=this.cache,n=t.elements;if(n===void 0){if(Ne(e,t))return;i.uniformMatrix4fv(this.addr,!1,t),Fe(e,t)}else{if(Ne(e,n))return;ad.set(n),i.uniformMatrix4fv(this.addr,!1,ad),Fe(e,n)}}function Ug(i,t){let e=this.cache;e[0]!==t&&(i.uniform1i(this.addr,t),e[0]=t)}function Ng(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ne(e,t))return;i.uniform2iv(this.addr,t),Fe(e,t)}}function Fg(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Ne(e,t))return;i.uniform3iv(this.addr,t),Fe(e,t)}}function Og(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ne(e,t))return;i.uniform4iv(this.addr,t),Fe(e,t)}}function Bg(i,t){let e=this.cache;e[0]!==t&&(i.uniform1ui(this.addr,t),e[0]=t)}function kg(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ne(e,t))return;i.uniform2uiv(this.addr,t),Fe(e,t)}}function zg(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Ne(e,t))return;i.uniform3uiv(this.addr,t),Fe(e,t)}}function Hg(i,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ne(e,t))return;i.uniform4uiv(this.addr,t),Fe(e,t)}}function Vg(i,t,e){let n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r);let s;this.type===i.SAMPLER_2D_SHADOW?(jc.compareFunction=e.isReversedDepthBuffer()?Ko:Jo,s=jc):s=Sd,e.setTexture2D(t||s,r)}function Gg(i,t,e){let n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),e.setTexture3D(t||wd,r)}function Wg(i,t,e){let n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),e.setTextureCube(t||Td,r)}function Xg(i,t,e){let n=this.cache,r=e.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),e.setTexture2DArray(t||Ed,r)}function qg(i){switch(i){case 5126:return Ag;case 35664:return Rg;case 35665:return Cg;case 35666:return Pg;case 35674:return Ig;case 35675:return Lg;case 35676:return Dg;case 5124:case 35670:return Ug;case 35667:case 35671:return Ng;case 35668:case 35672:return Fg;case 35669:case 35673:return Og;case 5125:return Bg;case 36294:return kg;case 36295:return zg;case 36296:return Hg;case 35678:case 36198:case 36298:case 36306:case 35682:return Vg;case 35679:case 36299:case 36307:return Gg;case 35680:case 36300:case 36308:case 36293:return Wg;case 36289:case 36303:case 36311:case 36292:return Xg}}function Yg(i,t){i.uniform1fv(this.addr,t)}function $g(i,t){let e=zr(t,this.size,2);i.uniform2fv(this.addr,e)}function Zg(i,t){let e=zr(t,this.size,3);i.uniform3fv(this.addr,e)}function Jg(i,t){let e=zr(t,this.size,4);i.uniform4fv(this.addr,e)}function Kg(i,t){let e=zr(t,this.size,4);i.uniformMatrix2fv(this.addr,!1,e)}function jg(i,t){let e=zr(t,this.size,9);i.uniformMatrix3fv(this.addr,!1,e)}function Qg(i,t){let e=zr(t,this.size,16);i.uniformMatrix4fv(this.addr,!1,e)}function t_(i,t){i.uniform1iv(this.addr,t)}function e_(i,t){i.uniform2iv(this.addr,t)}function n_(i,t){i.uniform3iv(this.addr,t)}function i_(i,t){i.uniform4iv(this.addr,t)}function r_(i,t){i.uniform1uiv(this.addr,t)}function s_(i,t){i.uniform2uiv(this.addr,t)}function a_(i,t){i.uniform3uiv(this.addr,t)}function o_(i,t){i.uniform4uiv(this.addr,t)}function l_(i,t,e){let n=this.cache,r=t.length,s=rl(e,r);Ne(n,s)||(i.uniform1iv(this.addr,s),Fe(n,s));let a;this.type===i.SAMPLER_2D_SHADOW?a=jc:a=Sd;for(let o=0;o!==r;++o)e.setTexture2D(t[o]||a,s[o])}function c_(i,t,e){let n=this.cache,r=t.length,s=rl(e,r);Ne(n,s)||(i.uniform1iv(this.addr,s),Fe(n,s));for(let a=0;a!==r;++a)e.setTexture3D(t[a]||wd,s[a])}function h_(i,t,e){let n=this.cache,r=t.length,s=rl(e,r);Ne(n,s)||(i.uniform1iv(this.addr,s),Fe(n,s));for(let a=0;a!==r;++a)e.setTextureCube(t[a]||Td,s[a])}function u_(i,t,e){let n=this.cache,r=t.length,s=rl(e,r);Ne(n,s)||(i.uniform1iv(this.addr,s),Fe(n,s));for(let a=0;a!==r;++a)e.setTexture2DArray(t[a]||Ed,s[a])}function d_(i){switch(i){case 5126:return Yg;case 35664:return $g;case 35665:return Zg;case 35666:return Jg;case 35674:return Kg;case 35675:return jg;case 35676:return Qg;case 5124:case 35670:return t_;case 35667:case 35671:return e_;case 35668:case 35672:return n_;case 35669:case 35673:return i_;case 5125:return r_;case 36294:return s_;case 36295:return a_;case 36296:return o_;case 35678:case 36198:case 36298:case 36306:case 35682:return l_;case 35679:case 36299:case 36307:return c_;case 35680:case 36300:case 36308:case 36293:return h_;case 36289:case 36303:case 36311:case 36292:return u_}}var Qc=class{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=qg(e.type)}},th=class{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=d_(e.type)}},eh=class{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){let r=this.seq;for(let s=0,a=r.length;s!==a;++s){let o=r[s];o.setValue(t,e[o.id],n)}}},Jc=/(\w+)(\])?(\[|\.)?/g;function cd(i,t){i.seq.push(t),i.map[t.id]=t}function f_(i,t,e){let n=i.name,r=n.length;for(Jc.lastIndex=0;;){let s=Jc.exec(n),a=Jc.lastIndex,o=s[1],l=s[2]==="]",c=s[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===r){cd(e,c===void 0?new Qc(o,i,t):new th(o,i,t));break}else{let d=e.map[o];d===void 0&&(d=new eh(o),cd(e,d)),e=d}}}var kr=class{constructor(t,e){this.seq=[],this.map={};let n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let a=0;a<n;++a){let o=t.getActiveUniform(e,a),l=t.getUniformLocation(e,o.name);f_(o,l,this)}let r=[],s=[];for(let a of this.seq)a.type===t.SAMPLER_2D_SHADOW||a.type===t.SAMPLER_CUBE_SHADOW||a.type===t.SAMPLER_2D_ARRAY_SHADOW?r.push(a):s.push(a);r.length>0&&(this.seq=r.concat(s))}setValue(t,e,n,r){let s=this.map[e];s!==void 0&&s.setValue(t,n,r)}setOptional(t,e,n){let r=e[n];r!==void 0&&this.setValue(t,n,r)}static upload(t,e,n,r){for(let s=0,a=e.length;s!==a;++s){let o=e[s],l=n[o.id];l.needsUpdate!==!1&&o.setValue(t,l.value,r)}}static seqWithValue(t,e){let n=[];for(let r=0,s=t.length;r!==s;++r){let a=t[r];a.id in e&&n.push(a)}return n}};function hd(i,t,e){let n=i.createShader(t);return i.shaderSource(n,e),i.compileShader(n),n}var p_=37297,m_=0;function g_(i,t){let e=i.split(`
`),n=[],r=Math.max(t-6,0),s=Math.min(t+6,e.length);for(let a=r;a<s;a++){let o=a+1;n.push(`${o===t?">":" "} ${o}: ${e[a]}`)}return n.join(`
`)}var ud=new Gt;function __(i){jt._getMatrix(ud,jt.workingColorSpace,i);let t=`mat3( ${ud.elements.map(e=>e.toFixed(4))} )`;switch(jt.getTransfer(i)){case rs:return[t,"LinearTransferOETF"];case ce:return[t,"sRGBTransferOETF"];default:return kt("WebGLProgram: Unsupported color space: ",i),[t,"LinearTransferOETF"]}}function dd(i,t,e){let n=i.getShaderParameter(t,i.COMPILE_STATUS),s=(i.getShaderInfoLog(t)||"").trim();if(n&&s==="")return"";let a=/ERROR: 0:(\d+)/.exec(s);if(a){let o=parseInt(a[1]);return e.toUpperCase()+`

`+s+`

`+g_(i.getShaderSource(t),o)}else return s}function x_(i,t){let e=__(t);return[`vec4 ${i}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}var v_={[Ec]:"Linear",[wc]:"Reinhard",[Tc]:"Cineon",[Ac]:"ACESFilmic",[Cc]:"AgX",[Pc]:"Neutral",[Rc]:"Custom"};function y_(i,t){let e=v_[t];return e===void 0?(kt("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+i+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+i+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}var Qo=new U;function b_(){jt.getLuminanceCoefficients(Qo);let i=Qo.x.toFixed(4),t=Qo.y.toFixed(4),e=Qo.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function M_(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Hs).join(`
`)}function S_(i){let t=[];for(let e in i){let n=i[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function E_(i,t){let e={},n=i.getProgramParameter(t,i.ACTIVE_ATTRIBUTES);for(let r=0;r<n;r++){let s=i.getActiveAttrib(t,r),a=s.name,o=1;s.type===i.FLOAT_MAT2&&(o=2),s.type===i.FLOAT_MAT3&&(o=3),s.type===i.FLOAT_MAT4&&(o=4),e[a]={type:s.type,location:i.getAttribLocation(t,a),locationSize:o}}return e}function Hs(i){return i!==""}function fd(i,t){let e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return i.replace(/NUM_SUN_LIGHTS/g,t.numSunLights).replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,t.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function pd(i,t){return i.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var w_=/^[ \t]*#include +<([\w\d./]+)>/gm;function nh(i){return i.replace(w_,A_)}var T_=new Map;function A_(i,t){let e=Zt[t];if(e===void 0){let n=T_.get(t);if(n!==void 0)e=Zt[n],kt('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return nh(e)}var R_=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function md(i){return i.replace(R_,C_)}function C_(i,t,e,n){let r="";for(let s=parseInt(t);s<parseInt(e);s++)r+=n.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function gd(i){let t=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?t+=`
#define HIGH_PRECISION`:i.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}var P_={[Ts]:"SHADOWMAP_TYPE_PCF",[Ir]:"SHADOWMAP_TYPE_VSM"};function I_(i){return P_[i.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var L_={[Ii]:"ENVMAP_TYPE_CUBE",[Zi]:"ENVMAP_TYPE_CUBE",[As]:"ENVMAP_TYPE_CUBE_UV"};function D_(i){return i.envMap===!1?"ENVMAP_TYPE_CUBE":L_[i.envMapMode]||"ENVMAP_TYPE_CUBE"}var U_={[Zi]:"ENVMAP_MODE_REFRACTION"};function N_(i){return i.envMap===!1?"ENVMAP_MODE_REFLECTION":U_[i.envMapMode]||"ENVMAP_MODE_REFLECTION"}var F_={[Sc]:"ENVMAP_BLENDING_MULTIPLY",[Uu]:"ENVMAP_BLENDING_MIX",[Nu]:"ENVMAP_BLENDING_ADD"};function O_(i){return i.envMap===!1?"ENVMAP_BLENDING_NONE":F_[i.combine]||"ENVMAP_BLENDING_NONE"}function B_(i){let t=i.envMapCubeUVHeight;if(t===null)return null;let e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:n,maxMip:e}}function k_(i,t,e,n){let r=i.getContext(),s=e.defines,a=e.vertexShader,o=e.fragmentShader,l=I_(e),c=D_(e),h=N_(e),d=O_(e),f=B_(e),p=M_(e),_=S_(s),b=r.createProgram(),g,m,E=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(g=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_].filter(Hs).join(`
`),g.length>0&&(g+=`
`),m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_].filter(Hs).join(`
`),m.length>0&&(m+=`
`)):(g=[gd(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexNormals?"#define HAS_NORMAL":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Hs).join(`
`),m=[gd(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.envMap?"#define "+h:"",e.envMap?"#define "+d:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.retroreflection?"#define USE_RETROREFLECTION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor?"#define USE_COLOR":"",e.vertexAlphas||e.batchingColor?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==vn?"#define TONE_MAPPING":"",e.toneMapping!==vn?Zt.tonemapping_pars_fragment:"",e.toneMapping!==vn?y_("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Zt.colorspace_pars_fragment,x_("linearToOutputTexel",e.outputColorSpace),b_(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(Hs).join(`
`)),a=nh(a),a=fd(a,e),a=pd(a,e),o=nh(o),o=fd(o,e),o=pd(o,e),a=md(a),o=md(o),e.isRawShaderMaterial!==!0&&(E=`#version 300 es
`,g=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,m=["#define varying in",e.glslVersion===kc?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===kc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+m);let T=E+g+a,v=E+m+o,M=hd(r,r.VERTEX_SHADER,T),y=hd(r,r.FRAGMENT_SHADER,v);r.attachShader(b,M),r.attachShader(b,y),e.index0AttributeName!==void 0?r.bindAttribLocation(b,0,e.index0AttributeName):e.hasPositionAttribute===!0&&r.bindAttribLocation(b,0,"position"),r.linkProgram(b);function C(N){if(i.debug.checkShaderErrors){let R=r.getProgramInfoLog(b)||"",G=r.getShaderInfoLog(M)||"",L=r.getShaderInfoLog(y)||"",O=R.trim(),$=G.trim(),X=L.trim(),rt=!0,q=!0;if(r.getProgramParameter(b,r.LINK_STATUS)===!1)if(rt=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(r,b,M,y);else{let K=dd(r,M,"vertex"),st=dd(r,y,"fragment");Ht("WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(b,r.VALIDATE_STATUS)+`

Material Name: `+N.name+`
Material Type: `+N.type+`

Program Info Log: `+O+`
`+K+`
`+st)}else O!==""?kt("WebGLProgram: Program Info Log:",O):($===""||X==="")&&(q=!1);q&&(N.diagnostics={runnable:rt,programLog:O,vertexShader:{log:$,prefix:g},fragmentShader:{log:X,prefix:m}})}r.deleteShader(M),r.deleteShader(y),x=new kr(r,b),w=E_(r,b)}let x;this.getUniforms=function(){return x===void 0&&C(this),x};let w;this.getAttributes=function(){return w===void 0&&C(this),w};let I=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return I===!1&&(I=r.getProgramParameter(b,p_)),I},this.destroy=function(){n.releaseStatesOfProgram(this),r.deleteProgram(b),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=m_++,this.cacheKey=t,this.usedTimes=1,this.program=b,this.vertexShader=M,this.fragmentShader=y,this}var z_=0,ih=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t,e,n){let r=this._getShaderCacheForMaterial(t);return r.has(e)===!1&&(r.add(e),e.usedTimes++),r.has(n)===!1&&(r.add(n),n.usedTimes++),this}remove(t){let e=this.materialCache.get(t);for(let n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderStage(t){return this._getShaderStage(t.vertexShader)}getFragmentShaderStage(t){return this._getShaderStage(t.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){let e=this.materialCache,n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){let e=this.shaderCache,n=e.get(t);return n===void 0&&(n=new rh(t),e.set(t,n)),n}},rh=class{constructor(t){this.id=z_++,this.code=t,this.usedTimes=0}};function H_(i){return i===Di||i===Ds||i===Us}function V_(i,t,e,n,r,s){let a=new ls,o=new ih,l=new Set,c=[],h=new Map,d=n.logarithmicDepthBuffer,f=n.precision,p={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(x){return l.add(x),x===0?"uv":`uv${x}`}function b(x,w,I,N,R,G){let L=N.fog,O=R.geometry,$=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?N.environment:null,X=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,rt=t.get(x.envMap||$,X),q=rt&&rt.mapping===As?rt.image.height:null,K=p[x.type];x.precision!==null&&(f=n.getMaxPrecision(x.precision),f!==x.precision&&kt("WebGLProgram.getParameters:",x.precision,"not supported, using",f,"instead."));let st=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,ot=st!==void 0?st.length:0,Q=0;O.morphAttributes.position!==void 0&&(Q=1),O.morphAttributes.normal!==void 0&&(Q=2),O.morphAttributes.color!==void 0&&(Q=3);let _t,gt,Mt,W;if(K){let pe=Jn[K];_t=pe.vertexShader,gt=pe.fragmentShader}else{_t=x.vertexShader,gt=x.fragmentShader;let pe=o.getVertexShaderStage(x),oe=o.getFragmentShaderStage(x);o.update(x,pe,oe),Mt=pe.id,W=oe.id}let Y=i.getRenderTarget(),ft=i.state.buffers.depth.getReversed(),Ct=R.isInstancedMesh===!0,pt=R.isBatchedMesh===!0,Lt=!!x.map,Kt=!!x.matcap,et=!!rt,dt=!!x.aoMap,wt=!!x.lightMap,Ot=!!x.bumpMap&&x.wireframe===!1,zt=!!x.normalMap,ne=!!x.displacementMap,he=!!x.emissiveMap,Yt=!!x.metalnessMap,Wt=!!x.roughnessMap,B=x.anisotropy>0,xe=x.clearcoat>0,qt=x.dispersion>0,P=x.retroreflectivity>0,u=x.iridescence>0,A=x.sheen>0,D=x.transmission>0,z=B&&!!x.anisotropyMap,tt=xe&&!!x.clearcoatMap,j=xe&&!!x.clearcoatNormalMap,H=xe&&!!x.clearcoatRoughnessMap,V=u&&!!x.iridescenceMap,it=u&&!!x.iridescenceThicknessMap,ut=A&&!!x.sheenColorMap,lt=A&&!!x.sheenRoughnessMap,ct=!!x.specularMap,Et=!!x.specularColorMap,Tt=!!x.specularIntensityMap,Ft=D&&!!x.transmissionMap,F=D&&!!x.thicknessMap,mt=!!x.gradientMap,at=!!x.alphaMap,xt=x.alphaTest>0,vt=!!x.alphaHash,ht=!!x.extensions,Bt=vn;x.toneMapped&&(Y===null||Y.isXRRenderTarget===!0)&&(Bt=i.toneMapping);let Dt={shaderID:K,shaderType:x.type,shaderName:x.name,vertexShader:_t,fragmentShader:gt,defines:x.defines,customVertexShaderID:Mt,customFragmentShaderID:W,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:f,batching:pt,batchingColor:pt&&R._colorsTexture!==null,instancing:Ct,instancingColor:Ct&&R.instanceColor!==null,instancingMorph:Ct&&R.morphTexture!==null,outputColorSpace:Y===null?i.outputColorSpace:Y.isXRRenderTarget===!0?Y.texture.colorSpace:jt.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:Lt,matcap:Kt,envMap:et,envMapMode:et&&rt.mapping,envMapCubeUVHeight:q,aoMap:dt,lightMap:wt,bumpMap:Ot,normalMap:zt,displacementMap:ne,emissiveMap:he,normalMapObjectSpace:zt&&x.normalMapType===Bu,normalMapTangentSpace:zt&&x.normalMapType===Zo,packedNormalMap:zt&&x.normalMapType===Zo&&H_(x.normalMap.format),metalnessMap:Yt,roughnessMap:Wt,anisotropy:B,anisotropyMap:z,clearcoat:xe,clearcoatMap:tt,clearcoatNormalMap:j,clearcoatRoughnessMap:H,dispersion:qt,retroreflection:P,iridescence:u,iridescenceMap:V,iridescenceThicknessMap:it,sheen:A,sheenColorMap:ut,sheenRoughnessMap:lt,specularMap:ct,specularColorMap:Et,specularIntensityMap:Tt,transmission:D,transmissionMap:Ft,thicknessMap:F,gradientMap:mt,opaque:x.transparent===!1&&x.blending===Lr&&x.alphaToCoverage===!1,alphaMap:at,alphaTest:xt,alphaHash:vt,combine:x.combine,mapUv:Lt&&_(x.map.channel),aoMapUv:dt&&_(x.aoMap.channel),lightMapUv:wt&&_(x.lightMap.channel),bumpMapUv:Ot&&_(x.bumpMap.channel),normalMapUv:zt&&_(x.normalMap.channel),displacementMapUv:ne&&_(x.displacementMap.channel),emissiveMapUv:he&&_(x.emissiveMap.channel),metalnessMapUv:Yt&&_(x.metalnessMap.channel),roughnessMapUv:Wt&&_(x.roughnessMap.channel),anisotropyMapUv:z&&_(x.anisotropyMap.channel),clearcoatMapUv:tt&&_(x.clearcoatMap.channel),clearcoatNormalMapUv:j&&_(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:H&&_(x.clearcoatRoughnessMap.channel),iridescenceMapUv:V&&_(x.iridescenceMap.channel),iridescenceThicknessMapUv:it&&_(x.iridescenceThicknessMap.channel),sheenColorMapUv:ut&&_(x.sheenColorMap.channel),sheenRoughnessMapUv:lt&&_(x.sheenRoughnessMap.channel),specularMapUv:ct&&_(x.specularMap.channel),specularColorMapUv:Et&&_(x.specularColorMap.channel),specularIntensityMapUv:Tt&&_(x.specularIntensityMap.channel),transmissionMapUv:Ft&&_(x.transmissionMap.channel),thicknessMapUv:F&&_(x.thicknessMap.channel),alphaMapUv:at&&_(x.alphaMap.channel),vertexTangents:!!O.attributes.tangent&&(zt||B),vertexNormals:!!O.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,pointsUvs:R.isPoints===!0&&!!O.attributes.uv&&(Lt||at),fog:!!L,useFog:x.fog===!0,fogExp2:!!L&&L.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||O.attributes.normal===void 0&&zt===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:ft,skinning:R.isSkinnedMesh===!0,hasPositionAttribute:O.attributes.position!==void 0,morphTargets:O.morphAttributes.position!==void 0,morphNormals:O.morphAttributes.normal!==void 0,morphColors:O.morphAttributes.color!==void 0,morphTargetsCount:ot,morphTextureStride:Q,numSunLights:w.sun.length,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numSunLightShadows:w.sunShadowMap.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numLightProbeGrids:G.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:x.dithering,shadowMapEnabled:i.shadowMap.enabled&&I.length>0,shadowMapType:i.shadowMap.type,toneMapping:Bt,decodeVideoTexture:Lt&&x.map.isVideoTexture===!0&&jt.getTransfer(x.map.colorSpace)===ce,decodeVideoTextureEmissive:he&&x.emissiveMap.isVideoTexture===!0&&jt.getTransfer(x.emissiveMap.colorSpace)===ce,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===Ue,flipSided:x.side===We,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:ht&&x.extensions.clipCullDistance===!0&&e.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ht&&x.extensions.multiDraw===!0||pt)&&e.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:e.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return Dt.vertexUv1s=l.has(1),Dt.vertexUv2s=l.has(2),Dt.vertexUv3s=l.has(3),l.clear(),Dt}function g(x){let w=[];if(x.shaderID?w.push(x.shaderID):(w.push(x.customVertexShaderID),w.push(x.customFragmentShaderID)),x.defines!==void 0)for(let I in x.defines)w.push(I),w.push(x.defines[I]);return x.isRawShaderMaterial===!1&&(m(w,x),E(w,x),w.push(i.outputColorSpace)),w.push(x.customProgramCacheKey),w.join()}function m(x,w){x.push(w.precision),x.push(w.outputColorSpace),x.push(w.envMapMode),x.push(w.envMapCubeUVHeight),x.push(w.mapUv),x.push(w.alphaMapUv),x.push(w.lightMapUv),x.push(w.aoMapUv),x.push(w.bumpMapUv),x.push(w.normalMapUv),x.push(w.displacementMapUv),x.push(w.emissiveMapUv),x.push(w.metalnessMapUv),x.push(w.roughnessMapUv),x.push(w.anisotropyMapUv),x.push(w.clearcoatMapUv),x.push(w.clearcoatNormalMapUv),x.push(w.clearcoatRoughnessMapUv),x.push(w.iridescenceMapUv),x.push(w.iridescenceThicknessMapUv),x.push(w.sheenColorMapUv),x.push(w.sheenRoughnessMapUv),x.push(w.specularMapUv),x.push(w.specularColorMapUv),x.push(w.specularIntensityMapUv),x.push(w.transmissionMapUv),x.push(w.thicknessMapUv),x.push(w.combine),x.push(w.fogExp2),x.push(w.sizeAttenuation),x.push(w.morphTargetsCount),x.push(w.morphAttributeCount),x.push(w.numSunLights),x.push(w.numDirLights),x.push(w.numPointLights),x.push(w.numSpotLights),x.push(w.numSpotLightMaps),x.push(w.numHemiLights),x.push(w.numRectAreaLights),x.push(w.numSunLightShadows),x.push(w.numDirLightShadows),x.push(w.numPointLightShadows),x.push(w.numSpotLightShadows),x.push(w.numSpotLightShadowsWithMaps),x.push(w.numLightProbes),x.push(w.shadowMapType),x.push(w.toneMapping),x.push(w.numClippingPlanes),x.push(w.numClipIntersection),x.push(w.depthPacking)}function E(x,w){a.disableAll(),w.instancing&&a.enable(0),w.instancingColor&&a.enable(1),w.instancingMorph&&a.enable(2),w.matcap&&a.enable(3),w.envMap&&a.enable(4),w.normalMapObjectSpace&&a.enable(5),w.normalMapTangentSpace&&a.enable(6),w.clearcoat&&a.enable(7),w.iridescence&&a.enable(8),w.alphaTest&&a.enable(9),w.vertexColors&&a.enable(10),w.vertexAlphas&&a.enable(11),w.vertexUv1s&&a.enable(12),w.vertexUv2s&&a.enable(13),w.vertexUv3s&&a.enable(14),w.vertexTangents&&a.enable(15),w.anisotropy&&a.enable(16),w.alphaHash&&a.enable(17),w.batching&&a.enable(18),w.dispersion&&a.enable(19),w.retroreflection&&a.enable(24),w.batchingColor&&a.enable(20),w.gradientMap&&a.enable(21),w.packedNormalMap&&a.enable(22),w.vertexNormals&&a.enable(23),x.push(a.mask),a.disableAll(),w.fog&&a.enable(0),w.useFog&&a.enable(1),w.flatShading&&a.enable(2),w.logarithmicDepthBuffer&&a.enable(3),w.reversedDepthBuffer&&a.enable(4),w.skinning&&a.enable(5),w.morphTargets&&a.enable(6),w.morphNormals&&a.enable(7),w.morphColors&&a.enable(8),w.premultipliedAlpha&&a.enable(9),w.shadowMapEnabled&&a.enable(10),w.doubleSided&&a.enable(11),w.flipSided&&a.enable(12),w.useDepthPacking&&a.enable(13),w.dithering&&a.enable(14),w.transmission&&a.enable(15),w.sheen&&a.enable(16),w.opaque&&a.enable(17),w.pointsUvs&&a.enable(18),w.decodeVideoTexture&&a.enable(19),w.decodeVideoTextureEmissive&&a.enable(20),w.alphaToCoverage&&a.enable(21),w.numLightProbeGrids>0&&a.enable(22),w.hasPositionAttribute&&a.enable(23),x.push(a.mask)}function T(x){let w=p[x.type],I;if(w){let N=Jn[w];I=Ku.clone(N.uniforms)}else I=x.uniforms;return I}function v(x,w){let I=h.get(w);return I!==void 0?++I.usedTimes:(I=new k_(i,w,x,r),c.push(I),h.set(w,I)),I}function M(x){if(--x.usedTimes===0){let w=c.indexOf(x);c[w]=c[c.length-1],c.pop(),h.delete(x.cacheKey),x.destroy()}}function y(x){o.remove(x)}function C(){o.dispose()}return{getParameters:b,getProgramCacheKey:g,getUniforms:T,acquireProgram:v,releaseProgram:M,releaseShaderCache:y,programs:c,dispose:C}}function G_(){let i=new WeakMap;function t(a){return i.has(a)}function e(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function r(a,o,l){i.get(a)[o]=l}function s(){i=new WeakMap}return{has:t,get:e,remove:n,update:r,dispose:s}}function W_(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.material.id!==t.material.id?i.material.id-t.material.id:i.materialVariant!==t.materialVariant?i.materialVariant-t.materialVariant:i.z!==t.z?i.z-t.z:i.id-t.id}function _d(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.z!==t.z?t.z-i.z:i.id-t.id}function xd(){let i=[],t=0,e=[],n=[],r=[];function s(){t=0,e.length=0,n.length=0,r.length=0}function a(f){let p=0;return f.isInstancedMesh&&(p+=2),f.isSkinnedMesh&&(p+=1),p}function o(f,p,_,b,g,m){let E=i[t];return E===void 0?(E={id:f.id,object:f,geometry:p,material:_,materialVariant:a(f),groupOrder:b,renderOrder:f.renderOrder,z:g,group:m},i[t]=E):(E.id=f.id,E.object=f,E.geometry=p,E.material=_,E.materialVariant=a(f),E.groupOrder=b,E.renderOrder=f.renderOrder,E.z=g,E.group=m),t++,E}function l(f,p,_,b,g,m,E){E.reversedDepth===!0&&(g=-g);let T=o(f,p,_,b,g,m);_.transmission>0?n.push(T):_.transparent===!0?r.push(T):e.push(T)}function c(f,p,_,b,g,m){let E=o(f,p,_,b,g,m);_.transmission>0?n.unshift(E):_.transparent===!0?r.unshift(E):e.unshift(E)}function h(f,p){e.length>1&&e.sort(f||W_),n.length>1&&n.sort(p||_d),r.length>1&&r.sort(p||_d)}function d(){for(let f=t,p=i.length;f<p;f++){let _=i[f];if(_.id===null)break;_.id=null,_.object=null,_.geometry=null,_.material=null,_.group=null}}return{opaque:e,transmissive:n,transparent:r,init:s,push:l,unshift:c,finish:d,sort:h}}function X_(){let i=new WeakMap;function t(n,r){let s=i.get(n),a;return s===void 0?(a=new xd,i.set(n,[a])):r>=s.length?(a=new xd,s.push(a)):a=s[r],a}function e(){i=new WeakMap}return{get:t,dispose:e}}function q_(){let i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"SunLight":case"DirectionalLight":e={direction:new U,color:new Xt};break;case"SpotLight":e={position:new U,direction:new U,color:new Xt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new U,color:new Xt,distance:0,decay:0};break;case"HemisphereLight":e={direction:new U,skyColor:new Xt,groundColor:new Xt};break;case"RectAreaLight":e={color:new Xt,position:new U,halfWidth:new U,halfHeight:new U};break}return i[t.id]=e,e}}}function Y_(){let i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"SunLight":case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[t.id]=e,e}}}var $_=0;function Z_(i,t){return(t.castShadow?2:0)-(i.castShadow?2:0)+(t.map?1:0)-(i.map?1:0)}function J_(i){let t=new q_,e=Y_(),n={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new U);let r=new U,s=new ie,a=new ie;function o(c){let h=0,d=0,f=0;for(let R=0;R<9;R++)n.probe[R].set(0,0,0);let p=0,_=0,b=0,g=0,m=0,E=0,T=0,v=0,M=0,y=0,C=0,x=0,w=0,I=0;c.sort(Z_);for(let R=0,G=c.length;R<G;R++){let L=c[R],O=L.color,$=L.intensity,X=L.distance,rt=null;if(L.shadow&&L.shadow.map&&(L.shadow.map.texture.format===Di?rt=L.shadow.map.texture:rt=L.shadow.map.depthTexture||L.shadow.map.texture),L.isAmbientLight)h+=O.r*$,d+=O.g*$,f+=O.b*$;else if(L.isLightProbe){for(let q=0;q<9;q++)n.probe[q].addScaledVector(L.sh.coefficients[q],$);I++}else if(L.isSunLight){let q=t.get(L);if(q.color.copy(L.color).multiplyScalar(L.intensity),L.castShadow){let K=L.shadow,st=e.get(L);st.shadowIntensity=K.intensity,st.shadowBias=K.bias,st.shadowNormalBias=K.normalBias,st.shadowRadius=K.radius,st.shadowMapSize.copy(K.mapSize).multiply(K.getFrameExtents()),n.sunShadow[_]=st,n.sunShadowMap[_]=rt;let ot=K.getViewportCount();for(let Q=0;Q<ot;Q++)n.sunShadowMatrix[b+Q]=K.getMatrix(Q),n.sunShadowCascade[b+Q]=K._cascadeData[Q];b+=ot,_++}n.sun[p]=q,p++}else if(L.isDirectionalLight){let q=t.get(L);if(q.color.copy(L.color).multiplyScalar(L.intensity),L.castShadow){let K=L.shadow,st=e.get(L);st.shadowIntensity=K.intensity,st.shadowBias=K.bias,st.shadowNormalBias=K.normalBias,st.shadowRadius=K.radius,st.shadowMapSize=K.mapSize,n.directionalShadow[g]=st,n.directionalShadowMap[g]=rt,n.directionalShadowMatrix[g]=L.shadow.matrix,M++}n.directional[g]=q,g++}else if(L.isSpotLight){let q=t.get(L);q.position.setFromMatrixPosition(L.matrixWorld),q.color.copy(O).multiplyScalar($),q.distance=X,q.coneCos=Math.cos(L.angle),q.penumbraCos=Math.cos(L.angle*(1-L.penumbra)),q.decay=L.decay,n.spot[E]=q;let K=L.shadow;if(L.map&&(n.spotLightMap[x]=L.map,x++,K.updateMatrices(L),L.castShadow&&w++),n.spotLightMatrix[E]=K.matrix,L.castShadow){let st=e.get(L);st.shadowIntensity=K.intensity,st.shadowBias=K.bias,st.shadowNormalBias=K.normalBias,st.shadowRadius=K.radius,st.shadowMapSize=K.mapSize,n.spotShadow[E]=st,n.spotShadowMap[E]=rt,C++}E++}else if(L.isRectAreaLight){let q=t.get(L);q.color.copy(O).multiplyScalar($),q.halfWidth.set(L.width*.5,0,0),q.halfHeight.set(0,L.height*.5,0),n.rectArea[T]=q,T++}else if(L.isPointLight){let q=t.get(L);if(q.color.copy(L.color).multiplyScalar(L.intensity),q.distance=L.distance,q.decay=L.decay,L.castShadow){let K=L.shadow,st=e.get(L);st.shadowIntensity=K.intensity,st.shadowBias=K.bias,st.shadowNormalBias=K.normalBias,st.shadowRadius=K.radius,st.shadowMapSize=K.mapSize,st.shadowCameraNear=K.camera.near,st.shadowCameraFar=K.camera.far,n.pointShadow[m]=st,n.pointShadowMap[m]=rt,n.pointShadowMatrix[m]=L.shadow.matrix,y++}n.point[m]=q,m++}else if(L.isHemisphereLight){let q=t.get(L);q.skyColor.copy(L.color).multiplyScalar($),q.groundColor.copy(L.groundColor).multiplyScalar($),n.hemi[v]=q,v++}}T>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=yt.LTC_FLOAT_1,n.rectAreaLTC2=yt.LTC_FLOAT_2):(n.rectAreaLTC1=yt.LTC_HALF_1,n.rectAreaLTC2=yt.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=d,n.ambient[2]=f;let N=n.hash;(N.sunLength!==p||N.directionalLength!==g||N.pointLength!==m||N.spotLength!==E||N.rectAreaLength!==T||N.hemiLength!==v||N.numSunShadows!==_||N.numDirectionalShadows!==M||N.numPointShadows!==y||N.numSpotShadows!==C||N.numSpotMaps!==x||N.numLightProbes!==I)&&(n.sun.length=p,n.directional.length=g,n.spot.length=E,n.rectArea.length=T,n.point.length=m,n.hemi.length=v,n.sunShadow.length=_,n.sunShadowMap.length=_,n.sunShadowMatrix.length=b,n.sunShadowCascade.length=b,n.directionalShadow.length=M,n.directionalShadowMap.length=M,n.directionalShadowMatrix.length=M,n.pointShadow.length=y,n.pointShadowMap.length=y,n.pointShadowMatrix.length=y,n.spotShadow.length=C,n.spotShadowMap.length=C,n.spotLightMatrix.length=C+x-w,n.spotLightMap.length=x,n.numSpotLightShadowsWithMaps=w,n.numLightProbes=I,N.sunLength=p,N.directionalLength=g,N.pointLength=m,N.spotLength=E,N.rectAreaLength=T,N.hemiLength=v,N.numSunShadows=_,N.numDirectionalShadows=M,N.numPointShadows=y,N.numSpotShadows=C,N.numSpotMaps=x,N.numLightProbes=I,n.version=$_++)}function l(c,h){let d=0,f=0,p=0,_=0,b=0,g=0,m=h.matrixWorldInverse;for(let E=0,T=c.length;E<T;E++){let v=c[E];if(v.isSunLight){let M=n.sun[d];M.direction.setFromMatrixPosition(v.matrixWorld),M.direction.transformDirection(m),d++}else if(v.isDirectionalLight){let M=n.directional[f];M.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(m),f++}else if(v.isSpotLight){let M=n.spot[_];M.position.setFromMatrixPosition(v.matrixWorld),M.position.applyMatrix4(m),M.direction.setFromMatrixPosition(v.matrixWorld),r.setFromMatrixPosition(v.target.matrixWorld),M.direction.sub(r),M.direction.transformDirection(m),_++}else if(v.isRectAreaLight){let M=n.rectArea[b];M.position.setFromMatrixPosition(v.matrixWorld),M.position.applyMatrix4(m),a.identity(),s.copy(v.matrixWorld),s.premultiply(m),a.extractRotation(s),M.halfWidth.set(v.width*.5,0,0),M.halfHeight.set(0,v.height*.5,0),M.halfWidth.applyMatrix4(a),M.halfHeight.applyMatrix4(a),b++}else if(v.isPointLight){let M=n.point[p];M.position.setFromMatrixPosition(v.matrixWorld),M.position.applyMatrix4(m),p++}else if(v.isHemisphereLight){let M=n.hemi[g];M.direction.setFromMatrixPosition(v.matrixWorld),M.direction.transformDirection(m),g++}}}return{setup:o,setupView:l,state:n}}function vd(i){let t=new J_(i),e=[],n=[],r=[];function s(f){d.camera=f,e.length=0,n.length=0,r.length=0}function a(f){e.push(f)}function o(f){n.push(f)}function l(f){r.push(f)}function c(){t.setup(e)}function h(f){t.setupView(e,f)}let d={lightsArray:e,shadowsArray:n,lightProbeGridArray:r,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:d,setupLights:c,setupLightsView:h,pushLight:a,pushShadow:o,pushLightProbeGrid:l}}function K_(i){let t=new WeakMap;function e(r,s=0){let a=t.get(r),o;return a===void 0?(o=new vd(i),t.set(r,[o])):s>=a.length?(o=new vd(i),a.push(o)):o=a[s],o}function n(){t=new WeakMap}return{get:e,dispose:n}}var j_=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Q_=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,tx=[new U(1,0,0),new U(-1,0,0),new U(0,1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1)],ex=[new U(0,-1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1),new U(0,-1,0),new U(0,-1,0)],yd=new ie,zs=new U,Kc=new U;function nx(i,t,e){let n=new Ar,r=new Ut,s=new Ut,a=new Me,o=new wi,l=new $a,c={},h=e.maxTextureSize,d={[qn]:We,[We]:qn,[Ue]:Ue},f=new Re({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ut},radius:{value:4}},vertexShader:j_,fragmentShader:Q_}),p=f.clone();p.defines.HORIZONTAL_PASS=1;let _=new we;_.setAttribute("position",new De(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let b=new Vt(_,f),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Ts;let m=this.type;this.render=function(y,C,x){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||y.length===0)return;this.type===oo&&(kt("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=Ts);let w=i.getRenderTarget(),I=i.getActiveCubeFace(),N=i.getActiveMipmapLevel(),R=i.state;R.setBlending(Yn),R.buffers.depth.getReversed()===!0?R.buffers.color.setClear(0,0,0,0):R.buffers.color.setClear(1,1,1,1),R.buffers.depth.setTest(!0),R.setScissorTest(!1);let G=m!==this.type;G&&C.traverse(function(L){L.material&&(Array.isArray(L.material)?L.material.forEach(O=>O.needsUpdate=!0):L.material.needsUpdate=!0)});for(let L=0,O=y.length;L<O;L++){let $=y[L],X=$.shadow;if(X===void 0){kt("WebGLShadowMap:",$,"has no shadow.");continue}if(X.autoUpdate===!1&&X.needsUpdate===!1)continue;r.copy(X.mapSize);let rt=X.getFrameExtents();r.multiply(rt),s.copy(X.mapSize),(r.x>h||r.y>h)&&(r.x>h&&(s.x=Math.floor(h/rt.x),r.x=s.x*rt.x,X.mapSize.x=s.x),r.y>h&&(s.y=Math.floor(h/rt.y),r.y=s.y*rt.y,X.mapSize.y=s.y));let q=i.state.buffers.depth.getReversed();if(X.camera._reversedDepth=q,X.map===null||G===!0){if(X.map!==null&&(X.map.depthTexture!==null&&(X.map.depthTexture.dispose(),X.map.depthTexture=null),X.map.dispose()),this.type===Ir){if($.isPointLight){kt("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}X.map=new Ge(r.x,r.y,{format:Di,type:Bn,minFilter:Le,magFilter:Le,generateMipmaps:!1}),X.map.texture.name=$.name+".shadowMap",X.map.depthTexture=new Ei(r.x,r.y,un),X.map.depthTexture.name=$.name+".shadowMapDepth",X.map.depthTexture.format=Wn,X.map.depthTexture.compareFunction=null,X.map.depthTexture.minFilter=Ee,X.map.depthTexture.magFilter=Ee}else $.isPointLight?(X.map=new el(r.x),X.map.depthTexture=new Ba(r.x,On)):(X.map=new Ge(r.x,r.y),X.map.depthTexture=new Ei(r.x,r.y,On)),X.map.depthTexture.name=$.name+".shadowMap",X.map.depthTexture.format=Wn,this.type===Ts?(X.map.depthTexture.compareFunction=q?Ko:Jo,X.map.depthTexture.minFilter=Le,X.map.depthTexture.magFilter=Le):(X.map.depthTexture.compareFunction=null,X.map.depthTexture.minFilter=Ee,X.map.depthTexture.magFilter=Ee);X.camera.updateProjectionMatrix()}X.map.isWebGLCubeRenderTarget!==!0&&(X.map.width!==r.x||X.map.height!==r.y)&&X.map.setSize(r.x,r.y);let K=X.map.isWebGLCubeRenderTarget?6:X.getViewportCount();$.isPointLight!==!0&&X.updateMatrices($,x);for(let st=0;st<K;st++){let ot=X.getCamera(st);if($.isPointLight){let Q=X.camera,_t=X.matrix,gt=$.distance||Q.far;gt!==Q.far&&(Q.far=gt,Q.updateProjectionMatrix()),zs.setFromMatrixPosition($.matrixWorld),Q.position.copy(zs),Kc.copy(Q.position),Kc.add(tx[st]),Q.up.copy(ex[st]),Q.lookAt(Kc),Q.updateMatrixWorld(),_t.makeTranslation(-zs.x,-zs.y,-zs.z),yd.multiplyMatrices(Q.projectionMatrix,Q.matrixWorldInverse),X._frustum.setFromProjectionMatrix(yd,Q.coordinateSystem,Q.reversedDepth)}if(X.map.isWebGLCubeRenderTarget)i.setRenderTarget(X.map,st),i.clear();else{st===0&&(i.setRenderTarget(X.map),i.clear());let Q=X.getViewport(st);a.set(s.x*Q.x,s.y*Q.y,s.x*Q.z,s.y*Q.w),R.viewport(a)}n=X.getFrustum(st),v(C,x,ot,$,this.type)}X.isPointLightShadow!==!0&&this.type===Ir&&E(X,x),X.needsUpdate=!1}m=this.type,g.needsUpdate=!1,i.setRenderTarget(w,I,N)};function E(y,C){let x=t.update(b);f.defines.VSM_SAMPLES!==y.blurSamples&&(f.defines.VSM_SAMPLES=y.blurSamples,p.defines.VSM_SAMPLES=y.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),y.mapPass===null?y.mapPass=new Ge(r.x,r.y,{format:Di,type:Bn}):(y.mapPass.width!==y.map.width||y.mapPass.height!==y.map.height)&&y.mapPass.setSize(y.map.width,y.map.height),f.uniforms.shadow_pass.value=y.map.depthTexture,f.uniforms.resolution.value.set(y.map.width,y.map.height),f.uniforms.radius.value=y.radius,i.setRenderTarget(y.mapPass),i.clear(),i.renderBufferDirect(C,null,x,f,b,null),p.uniforms.shadow_pass.value=y.mapPass.texture,p.uniforms.resolution.value.set(y.map.width,y.map.height),p.uniforms.radius.value=y.radius,i.setRenderTarget(y.map),i.clear(),i.renderBufferDirect(C,null,x,p,b,null)}function T(y,C,x,w){let I=null,N=x.isPointLight===!0?y.customDistanceMaterial:y.customDepthMaterial;if(N!==void 0)I=N;else if(I=x.isPointLight===!0?l:o,i.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let R=I.uuid,G=C.uuid,L=c[R];L===void 0&&(L={},c[R]=L);let O=L[G];O===void 0&&(O=I.clone(),L[G]=O,C.addEventListener("dispose",M)),I=O}if(I.visible=C.visible,I.wireframe=C.wireframe,w===Ir?I.side=C.shadowSide!==null?C.shadowSide:C.side:I.side=C.shadowSide!==null?C.shadowSide:d[C.side],I.alphaMap=C.alphaMap,I.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,I.map=C.map,I.clipShadows=C.clipShadows,I.clippingPlanes=C.clippingPlanes,I.clipIntersection=C.clipIntersection,I.displacementMap=C.displacementMap,I.displacementScale=C.displacementScale,I.displacementBias=C.displacementBias,I.wireframeLinewidth=C.wireframeLinewidth,I.linewidth=C.linewidth,x.isPointLight===!0&&I.isMeshDistanceMaterial===!0){let R=i.properties.get(I);R.light=x}return I}function v(y,C,x,w,I){if(y.visible===!1)return;if(y.layers.test(C.layers)&&(y.isMesh||y.isLine||y.isPoints)&&(y.castShadow||y.receiveShadow&&I===Ir)&&(!y.frustumCulled||y.intersectsFrustum(n))){y.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,y.matrixWorld);let G=t.update(y),L=y.material;if(Array.isArray(L)){let O=G.groups;for(let $=0,X=O.length;$<X;$++){let rt=O[$],q=L[rt.materialIndex];if(q&&q.visible){let K=T(y,q,w,I);y.onBeforeShadow(i,y,C,x,G,K,rt),i.renderBufferDirect(x,null,G,K,y,rt),y.onAfterShadow(i,y,C,x,G,K,rt)}}}else if(L.visible){let O=T(y,L,w,I);y.onBeforeShadow(i,y,C,x,G,O,null),i.renderBufferDirect(x,null,G,O,y,null),y.onAfterShadow(i,y,C,x,G,O,null)}}let R=y.children;for(let G=0,L=R.length;G<L;G++)v(R[G],C,x,w,I)}function M(y){y.target.removeEventListener("dispose",M);for(let x in c){let w=c[x],I=y.target.uuid;I in w&&(w[I].dispose(),delete w[I])}}}function ix(i,t){function e(){let F=!1,mt=new Me,at=null,xt=new Me(0,0,0,0);return{setMask:function(vt){at!==vt&&!F&&(i.colorMask(vt,vt,vt,vt),at=vt)},setLocked:function(vt){F=vt},setClear:function(vt,ht,Bt,Dt,pe){pe===!0&&(vt*=Dt,ht*=Dt,Bt*=Dt),mt.set(vt,ht,Bt,Dt),xt.equals(mt)===!1&&(i.clearColor(vt,ht,Bt,Dt),xt.copy(mt))},reset:function(){F=!1,at=null,xt.set(-1,0,0,0)}}}function n(){let F=!1,mt=!1,at=null,xt=null,vt=null;return{setReversed:function(ht){if(mt!==ht){let Bt=t.get("EXT_clip_control");ht?Bt.clipControlEXT(Bt.LOWER_LEFT_EXT,Bt.ZERO_TO_ONE_EXT):Bt.clipControlEXT(Bt.LOWER_LEFT_EXT,Bt.NEGATIVE_ONE_TO_ONE_EXT),mt=ht;let Dt=vt;vt=null,this.setClear(Dt)}},getReversed:function(){return mt},setTest:function(ht){ht?Y(i.DEPTH_TEST):ft(i.DEPTH_TEST)},setMask:function(ht){at!==ht&&!F&&(i.depthMask(ht),at=ht)},setFunc:function(ht){if(mt&&(ht=Zu[ht]),xt!==ht){switch(ht){case wa:i.depthFunc(i.NEVER);break;case Ta:i.depthFunc(i.ALWAYS);break;case Aa:i.depthFunc(i.LESS);break;case br:i.depthFunc(i.LEQUAL);break;case Ra:i.depthFunc(i.EQUAL);break;case Ca:i.depthFunc(i.GEQUAL);break;case Pa:i.depthFunc(i.GREATER);break;case Ia:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}xt=ht}},setLocked:function(ht){F=ht},setClear:function(ht){vt!==ht&&(vt=ht,mt&&(ht=1-ht),i.clearDepth(ht))},reset:function(){F=!1,at=null,xt=null,vt=null,mt=!1}}}function r(){let F=!1,mt=null,at=null,xt=null,vt=null,ht=null,Bt=null,Dt=null,pe=null;return{setTest:function(oe){F||(oe?Y(i.STENCIL_TEST):ft(i.STENCIL_TEST))},setMask:function(oe){mt!==oe&&!F&&(i.stencilMask(oe),mt=oe)},setFunc:function(oe,Pn,zn){(at!==oe||xt!==Pn||vt!==zn)&&(i.stencilFunc(oe,Pn,zn),at=oe,xt=Pn,vt=zn)},setOp:function(oe,Pn,zn){(ht!==oe||Bt!==Pn||Dt!==zn)&&(i.stencilOp(oe,Pn,zn),ht=oe,Bt=Pn,Dt=zn)},setLocked:function(oe){F=oe},setClear:function(oe){pe!==oe&&(i.clearStencil(oe),pe=oe)},reset:function(){F=!1,mt=null,at=null,xt=null,vt=null,ht=null,Bt=null,Dt=null,pe=null}}}let s=new e,a=new n,o=new r,l=new WeakMap,c=new WeakMap,h={},d={},f={},p=new WeakMap,_=[],b=null,g=!1,m=null,E=null,T=null,v=null,M=null,y=null,C=null,x=new Xt(0,0,0),w=0,I=!1,N=null,R=null,G=null,L=null,O=null,$=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),X=!1,rt=0,q=i.getParameter(i.VERSION);q.indexOf("WebGL")!==-1?(rt=parseFloat(/^WebGL (\d)/.exec(q)[1]),X=rt>=1):q.indexOf("OpenGL ES")!==-1&&(rt=parseFloat(/^OpenGL ES (\d)/.exec(q)[1]),X=rt>=2);let K=null,st={},ot=i.getParameter(i.SCISSOR_BOX),Q=i.getParameter(i.VIEWPORT),_t=new Me().fromArray(ot),gt=new Me().fromArray(Q);function Mt(F,mt,at,xt){let vt=new Uint8Array(4),ht=i.createTexture();i.bindTexture(F,ht),i.texParameteri(F,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(F,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Bt=0;Bt<at;Bt++)F===i.TEXTURE_3D||F===i.TEXTURE_2D_ARRAY?i.texImage3D(mt,0,i.RGBA,1,1,xt,0,i.RGBA,i.UNSIGNED_BYTE,vt):i.texImage2D(mt+Bt,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,vt);return ht}let W={};W[i.TEXTURE_2D]=Mt(i.TEXTURE_2D,i.TEXTURE_2D,1),W[i.TEXTURE_CUBE_MAP]=Mt(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),W[i.TEXTURE_2D_ARRAY]=Mt(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),W[i.TEXTURE_3D]=Mt(i.TEXTURE_3D,i.TEXTURE_3D,1,1),s.setClear(0,0,0,1),a.setClear(1),o.setClear(0),Y(i.DEPTH_TEST),a.setFunc(br),Ot(!1),zt(xc),Y(i.CULL_FACE),dt(Yn);function Y(F){h[F]!==!0&&(i.enable(F),h[F]=!0)}function ft(F){h[F]!==!1&&(i.disable(F),h[F]=!1)}function Ct(F,mt){return f[F]!==mt?(i.bindFramebuffer(F,mt),f[F]=mt,F===i.DRAW_FRAMEBUFFER&&(f[i.FRAMEBUFFER]=mt),F===i.FRAMEBUFFER&&(f[i.DRAW_FRAMEBUFFER]=mt),!0):!1}function pt(F,mt){let at=_,xt=!1;if(F){at=p.get(mt),at===void 0&&(at=[],p.set(mt,at));let vt=F.textures;if(at.length!==vt.length||at[0]!==i.COLOR_ATTACHMENT0){for(let ht=0,Bt=vt.length;ht<Bt;ht++)at[ht]=i.COLOR_ATTACHMENT0+ht;at.length=vt.length,xt=!0}}else at[0]!==i.BACK&&(at[0]=i.BACK,xt=!0);xt&&i.drawBuffers(at)}function Lt(F){return b!==F?(i.useProgram(F),b=F,!0):!1}let Kt={[$i]:i.FUNC_ADD,[xu]:i.FUNC_SUBTRACT,[vu]:i.FUNC_REVERSE_SUBTRACT};Kt[yu]=i.MIN,Kt[bu]=i.MAX;let et={[Mu]:i.ZERO,[ci]:i.ONE,[Su]:i.SRC_COLOR,[Mc]:i.SRC_ALPHA,[Cu]:i.SRC_ALPHA_SATURATE,[Au]:i.DST_COLOR,[wu]:i.DST_ALPHA,[Eu]:i.ONE_MINUS_SRC_COLOR,[Pi]:i.ONE_MINUS_SRC_ALPHA,[Ru]:i.ONE_MINUS_DST_COLOR,[Tu]:i.ONE_MINUS_DST_ALPHA,[Pu]:i.CONSTANT_COLOR,[Iu]:i.ONE_MINUS_CONSTANT_COLOR,[Lu]:i.CONSTANT_ALPHA,[Du]:i.ONE_MINUS_CONSTANT_ALPHA};function dt(F,mt,at,xt,vt,ht,Bt,Dt,pe,oe){if(F===Yn){g===!0&&(ft(i.BLEND),g=!1);return}if(g===!1&&(Y(i.BLEND),g=!0),F!==Dr){if(F!==m||oe!==I){if((E!==$i||M!==$i)&&(i.blendEquation(i.FUNC_ADD),E=$i,M=$i),oe)switch(F){case Lr:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case vc:i.blendFunc(i.ONE,i.ONE);break;case yc:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case bc:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:Ht("WebGLState: Invalid blending: ",F);break}else switch(F){case Lr:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case vc:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case yc:Ht("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case bc:Ht("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Ht("WebGLState: Invalid blending: ",F);break}T=null,v=null,y=null,C=null,x.set(0,0,0),w=0,m=F,I=oe}return}vt=vt||mt,ht=ht||at,Bt=Bt||xt,(mt!==E||vt!==M)&&(i.blendEquationSeparate(Kt[mt],Kt[vt]),E=mt,M=vt),(at!==T||xt!==v||ht!==y||Bt!==C)&&(i.blendFuncSeparate(et[at],et[xt],et[ht],et[Bt]),T=at,v=xt,y=ht,C=Bt),(Dt.equals(x)===!1||pe!==w)&&(i.blendColor(Dt.r,Dt.g,Dt.b,pe),x.copy(Dt),w=pe),m=F,I=!1}function wt(F,mt){F.side===Ue?ft(i.CULL_FACE):Y(i.CULL_FACE);let at=F.side===We;mt&&(at=!at),Ot(at),F.blending===Lr&&F.transparent===!1?dt(Yn):dt(F.blending,F.blendEquation,F.blendSrc,F.blendDst,F.blendEquationAlpha,F.blendSrcAlpha,F.blendDstAlpha,F.blendColor,F.blendAlpha,F.premultipliedAlpha),a.setFunc(F.depthFunc),a.setTest(F.depthTest),a.setMask(F.depthWrite),s.setMask(F.colorWrite);let xt=F.stencilWrite;o.setTest(xt),xt&&(o.setMask(F.stencilWriteMask),o.setFunc(F.stencilFunc,F.stencilRef,F.stencilFuncMask),o.setOp(F.stencilFail,F.stencilZFail,F.stencilZPass)),he(F.polygonOffset,F.polygonOffsetFactor,F.polygonOffsetUnits),F.alphaToCoverage===!0?Y(i.SAMPLE_ALPHA_TO_COVERAGE):ft(i.SAMPLE_ALPHA_TO_COVERAGE)}function Ot(F){N!==F&&(F?i.frontFace(i.CW):i.frontFace(i.CCW),N=F)}function zt(F){F!==gu?(Y(i.CULL_FACE),F!==R&&(F===xc?i.cullFace(i.BACK):F===_u?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):ft(i.CULL_FACE),R=F}function ne(F){F!==G&&(X&&i.lineWidth(F),G=F)}function he(F,mt,at){F?(Y(i.POLYGON_OFFSET_FILL),(L!==mt||O!==at)&&(L=mt,O=at,a.getReversed()&&(mt=-mt),i.polygonOffset(mt,at))):ft(i.POLYGON_OFFSET_FILL)}function Yt(F){F?Y(i.SCISSOR_TEST):ft(i.SCISSOR_TEST)}function Wt(F){F===void 0&&(F=i.TEXTURE0+$-1),K!==F&&(i.activeTexture(F),K=F)}function B(F,mt,at){at===void 0&&(K===null?at=i.TEXTURE0+$-1:at=K);let xt=st[at];xt===void 0&&(xt={type:void 0,texture:void 0},st[at]=xt),(xt.type!==F||xt.texture!==mt)&&(K!==at&&(i.activeTexture(at),K=at),i.bindTexture(F,mt||W[F]),xt.type=F,xt.texture=mt)}function xe(){let F=st[K];F!==void 0&&F.type!==void 0&&(i.bindTexture(F.type,null),F.type=void 0,F.texture=void 0)}function qt(){try{i.compressedTexImage2D(...arguments)}catch(F){Ht("WebGLState:",F)}}function P(){try{i.compressedTexImage3D(...arguments)}catch(F){Ht("WebGLState:",F)}}function u(){try{i.texSubImage2D(...arguments)}catch(F){Ht("WebGLState:",F)}}function A(){try{i.texSubImage3D(...arguments)}catch(F){Ht("WebGLState:",F)}}function D(){try{i.compressedTexSubImage2D(...arguments)}catch(F){Ht("WebGLState:",F)}}function z(){try{i.compressedTexSubImage3D(...arguments)}catch(F){Ht("WebGLState:",F)}}function tt(){try{i.texStorage2D(...arguments)}catch(F){Ht("WebGLState:",F)}}function j(){try{i.texStorage3D(...arguments)}catch(F){Ht("WebGLState:",F)}}function H(){try{i.texImage2D(...arguments)}catch(F){Ht("WebGLState:",F)}}function V(){try{i.texImage3D(...arguments)}catch(F){Ht("WebGLState:",F)}}function it(F){return d[F]!==void 0?d[F]:i.getParameter(F)}function ut(F,mt){d[F]!==mt&&(i.pixelStorei(F,mt),d[F]=mt)}function lt(F){_t.equals(F)===!1&&(i.scissor(F.x,F.y,F.z,F.w),_t.copy(F))}function ct(F){gt.equals(F)===!1&&(i.viewport(F.x,F.y,F.z,F.w),gt.copy(F))}function Et(F,mt){let at=c.get(mt);at===void 0&&(at=new WeakMap,c.set(mt,at));let xt=at.get(F);xt===void 0&&(xt=i.getUniformBlockIndex(mt,F.name),at.set(F,xt))}function Tt(F,mt){let xt=c.get(mt).get(F);l.get(mt)!==xt&&(i.uniformBlockBinding(mt,xt,F.__bindingPointIndex),l.set(mt,xt))}function Ft(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),a.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),i.pixelStorei(i.PACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,!1),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,i.BROWSER_DEFAULT_WEBGL),i.pixelStorei(i.PACK_ROW_LENGTH,0),i.pixelStorei(i.PACK_SKIP_PIXELS,0),i.pixelStorei(i.PACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_ROW_LENGTH,0),i.pixelStorei(i.UNPACK_IMAGE_HEIGHT,0),i.pixelStorei(i.UNPACK_SKIP_PIXELS,0),i.pixelStorei(i.UNPACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_SKIP_IMAGES,0),h={},d={},K=null,st={},f={},p=new WeakMap,_=[],b=null,g=!1,m=null,E=null,T=null,v=null,M=null,y=null,C=null,x=new Xt(0,0,0),w=0,I=!1,N=null,R=null,G=null,L=null,O=null,_t.set(0,0,i.canvas.width,i.canvas.height),gt.set(0,0,i.canvas.width,i.canvas.height),s.reset(),a.reset(),o.reset()}return{buffers:{color:s,depth:a,stencil:o},enable:Y,disable:ft,bindFramebuffer:Ct,drawBuffers:pt,useProgram:Lt,setBlending:dt,setMaterial:wt,setFlipSided:Ot,setCullFace:zt,setLineWidth:ne,setPolygonOffset:he,setScissorTest:Yt,activeTexture:Wt,bindTexture:B,unbindTexture:xe,compressedTexImage2D:qt,compressedTexImage3D:P,texImage2D:H,texImage3D:V,pixelStorei:ut,getParameter:it,updateUBOMapping:Et,uniformBlockBinding:Tt,texStorage2D:tt,texStorage3D:j,texSubImage2D:u,texSubImage3D:A,compressedTexSubImage2D:D,compressedTexSubImage3D:z,scissor:lt,viewport:ct,reset:Ft}}function rx(i,t,e,n,r,s,a){let o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ut,h=new WeakMap,d=new Set,f,p=new WeakMap,_=!1;try{_=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function b(P,u){return _?new OffscreenCanvas(P,u):ss("canvas")}function g(P,u,A){let D=1,z=qt(P);if((z.width>A||z.height>A)&&(D=A/Math.max(z.width,z.height)),D<1)if(typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&P instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&P instanceof ImageBitmap||typeof VideoFrame<"u"&&P instanceof VideoFrame){let tt=Math.floor(D*z.width),j=Math.floor(D*z.height);f===void 0&&(f=b(tt,j));let H=u?b(tt,j):f;return H.width=tt,H.height=j,H.getContext("2d").drawImage(P,0,0,tt,j),kt("WebGLRenderer: Texture has been resized from ("+z.width+"x"+z.height+") to ("+tt+"x"+j+")."),H}else return"data"in P&&kt("WebGLRenderer: Image in DataTexture is too big ("+z.width+"x"+z.height+")."),P;return P}function m(P){return P.generateMipmaps}function E(P){i.generateMipmap(P)}function T(P){return P.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:P.isWebGL3DRenderTarget?i.TEXTURE_3D:P.isWebGLArrayRenderTarget||P.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function v(P,u,A,D,z,tt=!1){if(P!==null){if(i[P]!==void 0)return i[P];kt("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+P+"'")}let j;D&&(j=t.get("EXT_texture_norm16"),j||kt("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let H=u;if(u===i.RED&&(A===i.FLOAT&&(H=i.R32F),A===i.HALF_FLOAT&&(H=i.R16F),A===i.UNSIGNED_BYTE&&(H=i.R8),A===i.UNSIGNED_SHORT&&j&&(H=j.R16_EXT),A===i.SHORT&&j&&(H=j.R16_SNORM_EXT)),u===i.RED_INTEGER&&(A===i.UNSIGNED_BYTE&&(H=i.R8UI),A===i.UNSIGNED_SHORT&&(H=i.R16UI),A===i.UNSIGNED_INT&&(H=i.R32UI),A===i.BYTE&&(H=i.R8I),A===i.SHORT&&(H=i.R16I),A===i.INT&&(H=i.R32I)),u===i.RG&&(A===i.FLOAT&&(H=i.RG32F),A===i.HALF_FLOAT&&(H=i.RG16F),A===i.UNSIGNED_BYTE&&(H=i.RG8),A===i.UNSIGNED_SHORT&&j&&(H=j.RG16_EXT),A===i.SHORT&&j&&(H=j.RG16_SNORM_EXT)),u===i.RG_INTEGER&&(A===i.UNSIGNED_BYTE&&(H=i.RG8UI),A===i.UNSIGNED_SHORT&&(H=i.RG16UI),A===i.UNSIGNED_INT&&(H=i.RG32UI),A===i.BYTE&&(H=i.RG8I),A===i.SHORT&&(H=i.RG16I),A===i.INT&&(H=i.RG32I)),u===i.RGB_INTEGER&&(A===i.UNSIGNED_BYTE&&(H=i.RGB8UI),A===i.UNSIGNED_SHORT&&(H=i.RGB16UI),A===i.UNSIGNED_INT&&(H=i.RGB32UI),A===i.BYTE&&(H=i.RGB8I),A===i.SHORT&&(H=i.RGB16I),A===i.INT&&(H=i.RGB32I)),u===i.RGBA_INTEGER&&(A===i.UNSIGNED_BYTE&&(H=i.RGBA8UI),A===i.UNSIGNED_SHORT&&(H=i.RGBA16UI),A===i.UNSIGNED_INT&&(H=i.RGBA32UI),A===i.BYTE&&(H=i.RGBA8I),A===i.SHORT&&(H=i.RGBA16I),A===i.INT&&(H=i.RGBA32I)),u===i.RGB&&(A===i.UNSIGNED_SHORT&&j&&(H=j.RGB16_EXT),A===i.SHORT&&j&&(H=j.RGB16_SNORM_EXT),A===i.UNSIGNED_INT_5_9_9_9_REV&&(H=i.RGB9_E5),A===i.UNSIGNED_INT_10F_11F_11F_REV&&(H=i.R11F_G11F_B10F)),u===i.RGBA){let V=tt?rs:jt.getTransfer(z);A===i.FLOAT&&(H=i.RGBA32F),A===i.HALF_FLOAT&&(H=i.RGBA16F),A===i.UNSIGNED_BYTE&&(H=V===ce?i.SRGB8_ALPHA8:i.RGBA8),A===i.UNSIGNED_SHORT&&j&&(H=j.RGBA16_EXT),A===i.SHORT&&j&&(H=j.RGBA16_SNORM_EXT),A===i.UNSIGNED_SHORT_4_4_4_4&&(H=i.RGBA4),A===i.UNSIGNED_SHORT_5_5_5_1&&(H=i.RGB5_A1)}return(H===i.R16F||H===i.R32F||H===i.RG16F||H===i.RG32F||H===i.RGBA16F||H===i.RGBA32F)&&t.get("EXT_color_buffer_float"),H}function M(P,u){let A;return P?u===null||u===On||u===Nr?A=i.DEPTH24_STENCIL8:u===un?A=i.DEPTH32F_STENCIL8:u===Ur&&(A=i.DEPTH24_STENCIL8,kt("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):u===null||u===On||u===Nr?A=i.DEPTH_COMPONENT24:u===un?A=i.DEPTH_COMPONENT32F:u===Ur&&(A=i.DEPTH_COMPONENT16),A}function y(P,u){return m(P)===!0||P.isFramebufferTexture&&P.minFilter!==Ee&&P.minFilter!==Le?Math.log2(Math.max(u.width,u.height))+1:P.mipmaps!==void 0&&P.mipmaps.length>0?P.mipmaps.length:P.isCompressedTexture&&Array.isArray(P.image)?u.mipmaps.length:1}function C(P){let u=P.target;u.removeEventListener("dispose",C),w(u),u.isVideoTexture&&h.delete(u),u.isHTMLTexture&&d.delete(u)}function x(P){let u=P.target;u.removeEventListener("dispose",x),N(u)}function w(P){let u=n.get(P);if(u.__webglInit===void 0)return;let A=P.source,D=p.get(A);if(D){let z=D[u.__cacheKey];z.usedTimes--,z.usedTimes===0&&I(P),Object.keys(D).length===0&&p.delete(A)}n.remove(P)}function I(P){let u=n.get(P);i.deleteTexture(u.__webglTexture);let A=P.source,D=p.get(A);delete D[u.__cacheKey],a.memory.textures--}function N(P){let u=n.get(P);if(P.depthTexture&&(P.depthTexture.dispose(),n.remove(P.depthTexture)),P.isWebGLCubeRenderTarget)for(let D=0;D<6;D++){if(Array.isArray(u.__webglFramebuffer[D]))for(let z=0;z<u.__webglFramebuffer[D].length;z++)i.deleteFramebuffer(u.__webglFramebuffer[D][z]);else i.deleteFramebuffer(u.__webglFramebuffer[D]);u.__webglDepthbuffer&&i.deleteRenderbuffer(u.__webglDepthbuffer[D])}else{if(Array.isArray(u.__webglFramebuffer))for(let D=0;D<u.__webglFramebuffer.length;D++)i.deleteFramebuffer(u.__webglFramebuffer[D]);else i.deleteFramebuffer(u.__webglFramebuffer);if(u.__webglDepthbuffer&&i.deleteRenderbuffer(u.__webglDepthbuffer),u.__webglMultisampledFramebuffer&&i.deleteFramebuffer(u.__webglMultisampledFramebuffer),u.__webglColorRenderbuffer)for(let D=0;D<u.__webglColorRenderbuffer.length;D++)u.__webglColorRenderbuffer[D]&&i.deleteRenderbuffer(u.__webglColorRenderbuffer[D]);u.__webglDepthRenderbuffer&&i.deleteRenderbuffer(u.__webglDepthRenderbuffer)}let A=P.textures;for(let D=0,z=A.length;D<z;D++){let tt=n.get(A[D]);tt.__webglTexture&&(i.deleteTexture(tt.__webglTexture),a.memory.textures--),n.remove(A[D])}n.remove(P)}let R=0;function G(){R=0}function L(){return R}function O(P){R=P}function $(){let P=R;return P>=r.maxTextures&&kt("WebGLTextures: Trying to use "+(P+1)+" texture units while this GPU supports only "+r.maxTextures),R+=1,P}function X(P){let u=[];return u.push(P.wrapS),u.push(P.wrapT),u.push(P.wrapR||0),u.push(P.magFilter),u.push(P.minFilter),u.push(P.anisotropy),u.push(P.internalFormat),u.push(P.format),u.push(P.type),u.push(P.generateMipmaps),u.push(P.premultiplyAlpha),u.push(P.flipY),u.push(P.unpackAlignment),u.push(P.colorSpace),u.join()}function rt(P,u){let A=n.get(P);if(P.isVideoTexture&&B(P),P.isRenderTargetTexture===!1&&P.isExternalTexture!==!0&&P.version>0&&A.__version!==P.version){let D=P.image;if(D===null)kt("WebGLRenderer: Texture marked for update but no image data found.");else if(D.complete===!1)kt("WebGLRenderer: Texture marked for update but image is incomplete");else{ft(A,P,u);return}}else P.isExternalTexture&&(A.__webglTexture=P.sourceTexture?P.sourceTexture:null);e.bindTexture(i.TEXTURE_2D,A.__webglTexture,i.TEXTURE0+u)}function q(P,u){let A=n.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&A.__version!==P.version){ft(A,P,u);return}else P.isExternalTexture&&(A.__webglTexture=P.sourceTexture?P.sourceTexture:null);e.bindTexture(i.TEXTURE_2D_ARRAY,A.__webglTexture,i.TEXTURE0+u)}function K(P,u){let A=n.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&A.__version!==P.version){ft(A,P,u);return}e.bindTexture(i.TEXTURE_3D,A.__webglTexture,i.TEXTURE0+u)}function st(P,u){let A=n.get(P);if(P.isCubeDepthTexture!==!0&&P.version>0&&A.__version!==P.version){Ct(A,P,u);return}e.bindTexture(i.TEXTURE_CUBE_MAP,A.__webglTexture,i.TEXTURE0+u)}let ot={[Mr]:i.REPEAT,[Gn]:i.CLAMP_TO_EDGE,[La]:i.MIRRORED_REPEAT},Q={[Ee]:i.NEAREST,[Fu]:i.NEAREST_MIPMAP_NEAREST,[Rs]:i.NEAREST_MIPMAP_LINEAR,[Le]:i.LINEAR,[ho]:i.LINEAR_MIPMAP_NEAREST,[$n]:i.LINEAR_MIPMAP_LINEAR},_t={[ku]:i.NEVER,[Wu]:i.ALWAYS,[zu]:i.LESS,[Jo]:i.LEQUAL,[Hu]:i.EQUAL,[Ko]:i.GEQUAL,[Vu]:i.GREATER,[Gu]:i.NOTEQUAL};function gt(P,u){if(u.type===un&&t.has("OES_texture_float_linear")===!1&&(u.magFilter===Le||u.magFilter===ho||u.magFilter===Rs||u.magFilter===$n||u.minFilter===Le||u.minFilter===ho||u.minFilter===Rs||u.minFilter===$n)&&kt("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(P,i.TEXTURE_WRAP_S,ot[u.wrapS]),i.texParameteri(P,i.TEXTURE_WRAP_T,ot[u.wrapT]),(P===i.TEXTURE_3D||P===i.TEXTURE_2D_ARRAY)&&i.texParameteri(P,i.TEXTURE_WRAP_R,ot[u.wrapR]),i.texParameteri(P,i.TEXTURE_MAG_FILTER,Q[u.magFilter]),i.texParameteri(P,i.TEXTURE_MIN_FILTER,Q[u.minFilter]),u.compareFunction&&(i.texParameteri(P,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(P,i.TEXTURE_COMPARE_FUNC,_t[u.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(u.magFilter===Ee||u.minFilter!==Rs&&u.minFilter!==$n||u.type===un&&t.has("OES_texture_float_linear")===!1)return;if(u.anisotropy>1||n.get(u).__currentAnisotropy){let A=t.get("EXT_texture_filter_anisotropic");i.texParameterf(P,A.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(u.anisotropy,r.getMaxAnisotropy())),n.get(u).__currentAnisotropy=u.anisotropy}}}function Mt(P,u){let A=!1;P.__webglInit===void 0&&(P.__webglInit=!0,u.addEventListener("dispose",C));let D=u.source,z=p.get(D);z===void 0&&(z={},p.set(D,z));let tt=X(u);if(tt!==P.__cacheKey){z[tt]===void 0&&(z[tt]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,A=!0),z[tt].usedTimes++;let j=z[P.__cacheKey];j!==void 0&&(z[P.__cacheKey].usedTimes--,j.usedTimes===0&&I(u)),P.__cacheKey=tt,P.__webglTexture=z[tt].texture}return A}function W(P,u,A){return Math.floor(Math.floor(P/A)/u)}function Y(P,u,A,D){let tt=P.updateRanges;if(tt.length===0)e.texSubImage2D(i.TEXTURE_2D,0,0,0,u.width,u.height,A,D,u.data);else{tt.sort((ut,lt)=>ut.start-lt.start);let j=0;for(let ut=1;ut<tt.length;ut++){let lt=tt[j],ct=tt[ut],Et=lt.start+lt.count,Tt=W(ct.start,u.width,4),Ft=W(lt.start,u.width,4);ct.start<=Et+1&&Tt===Ft&&W(ct.start+ct.count-1,u.width,4)===Tt?lt.count=Math.max(lt.count,ct.start+ct.count-lt.start):(++j,tt[j]=ct)}tt.length=j+1;let H=e.getParameter(i.UNPACK_ROW_LENGTH),V=e.getParameter(i.UNPACK_SKIP_PIXELS),it=e.getParameter(i.UNPACK_SKIP_ROWS);e.pixelStorei(i.UNPACK_ROW_LENGTH,u.width);for(let ut=0,lt=tt.length;ut<lt;ut++){let ct=tt[ut],Et=Math.floor(ct.start/4),Tt=Math.ceil(ct.count/4),Ft=Et%u.width,F=Math.floor(Et/u.width),mt=Tt,at=1;e.pixelStorei(i.UNPACK_SKIP_PIXELS,Ft),e.pixelStorei(i.UNPACK_SKIP_ROWS,F),e.texSubImage2D(i.TEXTURE_2D,0,Ft,F,mt,at,A,D,u.data)}P.clearUpdateRanges(),e.pixelStorei(i.UNPACK_ROW_LENGTH,H),e.pixelStorei(i.UNPACK_SKIP_PIXELS,V),e.pixelStorei(i.UNPACK_SKIP_ROWS,it)}}function ft(P,u,A){let D=i.TEXTURE_2D;(u.isDataArrayTexture||u.isCompressedArrayTexture)&&(D=i.TEXTURE_2D_ARRAY),u.isData3DTexture&&(D=i.TEXTURE_3D);let z=Mt(P,u),tt=u.source;e.bindTexture(D,P.__webglTexture,i.TEXTURE0+A);let j=n.get(tt);if(tt.version!==j.__version||z===!0){if(e.activeTexture(i.TEXTURE0+A),(typeof ImageBitmap<"u"&&u.image instanceof ImageBitmap)===!1){let at=jt.getPrimaries(jt.workingColorSpace),xt=u.colorSpace===sn?null:jt.getPrimaries(u.colorSpace),vt=u.colorSpace===sn||at===xt?i.NONE:i.BROWSER_DEFAULT_WEBGL;e.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,u.flipY),e.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,u.premultiplyAlpha),e.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,vt)}e.pixelStorei(i.UNPACK_ALIGNMENT,u.unpackAlignment);let V=g(u.image,!1,r.maxTextureSize);V=xe(u,V);let it=s.convert(u.format,u.colorSpace),ut=s.convert(u.type),lt=v(u.internalFormat,it,ut,u.normalized,u.colorSpace,u.isVideoTexture);gt(D,u);let ct,Et=u.mipmaps,Tt=u.isVideoTexture!==!0,Ft=j.__version===void 0||z===!0,F=tt.dataReady,mt=y(u,V);if(u.isDepthTexture)lt=M(u.format===Li,u.type),Ft&&(Tt?e.texStorage2D(i.TEXTURE_2D,1,lt,V.width,V.height):e.texImage2D(i.TEXTURE_2D,0,lt,V.width,V.height,0,it,ut,null));else if(u.isDataTexture)if(Et.length>0){Tt&&Ft&&e.texStorage2D(i.TEXTURE_2D,mt,lt,Et[0].width,Et[0].height);for(let at=0,xt=Et.length;at<xt;at++)ct=Et[at],Tt?F&&e.texSubImage2D(i.TEXTURE_2D,at,0,0,ct.width,ct.height,it,ut,ct.data):e.texImage2D(i.TEXTURE_2D,at,lt,ct.width,ct.height,0,it,ut,ct.data);u.generateMipmaps=!1}else Tt?(Ft&&e.texStorage2D(i.TEXTURE_2D,mt,lt,V.width,V.height),F&&Y(u,V,it,ut)):e.texImage2D(i.TEXTURE_2D,0,lt,V.width,V.height,0,it,ut,V.data);else if(u.isCompressedTexture)if(u.isCompressedArrayTexture){Tt&&Ft&&e.texStorage3D(i.TEXTURE_2D_ARRAY,mt,lt,Et[0].width,Et[0].height,V.depth);for(let at=0,xt=Et.length;at<xt;at++)if(ct=Et[at],u.format!==Xe)if(it!==null)if(Tt){if(F)if(u.layerUpdates.size>0){let vt=Xc(ct.width,ct.height,u.format,u.type);for(let ht of u.layerUpdates){let Bt=ct.data.subarray(ht*vt/ct.data.BYTES_PER_ELEMENT,(ht+1)*vt/ct.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,at,0,0,ht,ct.width,ct.height,1,it,Bt)}}else e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,at,0,0,0,ct.width,ct.height,V.depth,it,ct.data)}else e.compressedTexImage3D(i.TEXTURE_2D_ARRAY,at,lt,ct.width,ct.height,V.depth,0,ct.data,0,0);else kt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Tt?F&&e.texSubImage3D(i.TEXTURE_2D_ARRAY,at,0,0,0,ct.width,ct.height,V.depth,it,ut,ct.data):e.texImage3D(i.TEXTURE_2D_ARRAY,at,lt,ct.width,ct.height,V.depth,0,it,ut,ct.data);u.layerUpdates.size>0&&u.clearLayerUpdates()}else{Tt&&Ft&&e.texStorage2D(i.TEXTURE_2D,mt,lt,Et[0].width,Et[0].height);for(let at=0,xt=Et.length;at<xt;at++)ct=Et[at],u.format!==Xe?it!==null?Tt?F&&e.compressedTexSubImage2D(i.TEXTURE_2D,at,0,0,ct.width,ct.height,it,ct.data):e.compressedTexImage2D(i.TEXTURE_2D,at,lt,ct.width,ct.height,0,ct.data):kt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Tt?F&&e.texSubImage2D(i.TEXTURE_2D,at,0,0,ct.width,ct.height,it,ut,ct.data):e.texImage2D(i.TEXTURE_2D,at,lt,ct.width,ct.height,0,it,ut,ct.data)}else if(u.isDataArrayTexture)if(Tt){if(Ft&&e.texStorage3D(i.TEXTURE_2D_ARRAY,mt,lt,V.width,V.height,V.depth),F)if(u.layerUpdates.size>0){let at=Xc(V.width,V.height,u.format,u.type);for(let xt of u.layerUpdates){let vt=V.data.subarray(xt*at/V.data.BYTES_PER_ELEMENT,(xt+1)*at/V.data.BYTES_PER_ELEMENT);e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,xt,V.width,V.height,1,it,ut,vt)}u.clearLayerUpdates()}else e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,V.width,V.height,V.depth,it,ut,V.data)}else e.texImage3D(i.TEXTURE_2D_ARRAY,0,lt,V.width,V.height,V.depth,0,it,ut,V.data);else if(u.isData3DTexture)Tt?(Ft&&e.texStorage3D(i.TEXTURE_3D,mt,lt,V.width,V.height,V.depth),F&&e.texSubImage3D(i.TEXTURE_3D,0,0,0,0,V.width,V.height,V.depth,it,ut,V.data)):e.texImage3D(i.TEXTURE_3D,0,lt,V.width,V.height,V.depth,0,it,ut,V.data);else if(u.isFramebufferTexture){if(Ft)if(Tt)e.texStorage2D(i.TEXTURE_2D,mt,lt,V.width,V.height);else{let at=V.width,xt=V.height;for(let vt=0;vt<mt;vt++)e.texImage2D(i.TEXTURE_2D,vt,lt,at,xt,0,it,ut,null),at>>=1,xt>>=1}}else if(u.isHTMLTexture){if("texElementImage2D"in i){let at=i.canvas;if(at.hasAttribute("layoutsubtree")||at.setAttribute("layoutsubtree","true"),V.parentNode!==at){at.appendChild(V),d.add(u),at.onpaint=xt=>{let vt=xt.changedElements;for(let ht of d)vt.includes(ht.image)&&(ht.needsUpdate=!0)},at.requestPaint();return}if(i.texElementImage2D.length===3)i.texElementImage2D(i.TEXTURE_2D,i.RGBA8,V);else{let vt=i.RGBA,ht=i.RGBA,Bt=i.UNSIGNED_BYTE;i.texElementImage2D(i.TEXTURE_2D,0,vt,ht,Bt,V)}i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE)}}else if(Et.length>0){if(Tt&&Ft){let at=qt(Et[0]);e.texStorage2D(i.TEXTURE_2D,mt,lt,at.width,at.height)}for(let at=0,xt=Et.length;at<xt;at++)ct=Et[at],Tt?F&&e.texSubImage2D(i.TEXTURE_2D,at,0,0,it,ut,ct):e.texImage2D(i.TEXTURE_2D,at,lt,it,ut,ct);u.generateMipmaps=!1}else if(Tt){if(Ft){let at=qt(V);e.texStorage2D(i.TEXTURE_2D,mt,lt,at.width,at.height)}F&&e.texSubImage2D(i.TEXTURE_2D,0,0,0,it,ut,V)}else e.texImage2D(i.TEXTURE_2D,0,lt,it,ut,V);m(u)&&E(D),j.__version=tt.version,u.onUpdate&&u.onUpdate(u)}P.__version=u.version}function Ct(P,u,A){if(u.image.length!==6)return;let D=Mt(P,u),z=u.source;e.bindTexture(i.TEXTURE_CUBE_MAP,P.__webglTexture,i.TEXTURE0+A);let tt=n.get(z);if(z.version!==tt.__version||D===!0){e.activeTexture(i.TEXTURE0+A);let j=jt.getPrimaries(jt.workingColorSpace),H=u.colorSpace===sn?null:jt.getPrimaries(u.colorSpace),V=u.colorSpace===sn||j===H?i.NONE:i.BROWSER_DEFAULT_WEBGL;e.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,u.flipY),e.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,u.premultiplyAlpha),e.pixelStorei(i.UNPACK_ALIGNMENT,u.unpackAlignment),e.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,V);let it=u.isCompressedTexture||u.image[0].isCompressedTexture,ut=u.image[0]&&u.image[0].isDataTexture,lt=[];for(let ht=0;ht<6;ht++)!it&&!ut?lt[ht]=g(u.image[ht],!0,r.maxCubemapSize):lt[ht]=ut?u.image[ht].image:u.image[ht],lt[ht]=xe(u,lt[ht]);let ct=lt[0],Et=s.convert(u.format,u.colorSpace),Tt=s.convert(u.type),Ft=v(u.internalFormat,Et,Tt,u.normalized,u.colorSpace),F=u.isVideoTexture!==!0,mt=tt.__version===void 0||D===!0,at=z.dataReady,xt=y(u,ct);gt(i.TEXTURE_CUBE_MAP,u);let vt;if(it){F&&mt&&e.texStorage2D(i.TEXTURE_CUBE_MAP,xt,Ft,ct.width,ct.height);for(let ht=0;ht<6;ht++){vt=lt[ht].mipmaps;for(let Bt=0;Bt<vt.length;Bt++){let Dt=vt[Bt];u.format!==Xe?Et!==null?F?at&&e.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt,0,0,Dt.width,Dt.height,Et,Dt.data):e.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt,Ft,Dt.width,Dt.height,0,Dt.data):kt("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):F?at&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt,0,0,Dt.width,Dt.height,Et,Tt,Dt.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt,Ft,Dt.width,Dt.height,0,Et,Tt,Dt.data)}}}else{if(vt=u.mipmaps,F&&mt){vt.length>0&&xt++;let ht=qt(lt[0]);e.texStorage2D(i.TEXTURE_CUBE_MAP,xt,Ft,ht.width,ht.height)}for(let ht=0;ht<6;ht++)if(ut){F?at&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,0,0,lt[ht].width,lt[ht].height,Et,Tt,lt[ht].data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,Ft,lt[ht].width,lt[ht].height,0,Et,Tt,lt[ht].data);for(let Bt=0;Bt<vt.length;Bt++){let pe=vt[Bt].image[ht].image;F?at&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt+1,0,0,pe.width,pe.height,Et,Tt,pe.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt+1,Ft,pe.width,pe.height,0,Et,Tt,pe.data)}}else{F?at&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,0,0,Et,Tt,lt[ht]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,Ft,Et,Tt,lt[ht]);for(let Bt=0;Bt<vt.length;Bt++){let Dt=vt[Bt];F?at&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt+1,0,0,Et,Tt,Dt.image[ht]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Bt+1,Ft,Et,Tt,Dt.image[ht])}}}m(u)&&E(i.TEXTURE_CUBE_MAP),tt.__version=z.version,u.onUpdate&&u.onUpdate(u)}P.__version=u.version}function pt(P,u,A,D,z,tt){let j=s.convert(A.format,A.colorSpace),H=s.convert(A.type),V=v(A.internalFormat,j,H,A.normalized,A.colorSpace),it=n.get(u),ut=n.get(A);if(ut.__renderTarget=u,!it.__hasExternalTextures){let lt=Math.max(1,u.width>>tt),ct=Math.max(1,u.height>>tt);z===i.TEXTURE_3D||z===i.TEXTURE_2D_ARRAY?e.texImage3D(z,tt,V,lt,ct,u.depth,0,j,H,null):e.texImage2D(z,tt,V,lt,ct,0,j,H,null)}e.bindFramebuffer(i.FRAMEBUFFER,P),Wt(u)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,D,z,ut.__webglTexture,0,Yt(u)):(z===i.TEXTURE_2D||z>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&z<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,D,z,ut.__webglTexture,tt),e.bindFramebuffer(i.FRAMEBUFFER,null)}function Lt(P,u,A){if(i.bindRenderbuffer(i.RENDERBUFFER,P),u.depthBuffer){let D=u.depthTexture,z=D&&D.isDepthTexture?D.type:null,tt=M(u.stencilBuffer,z),j=u.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;Wt(u)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Yt(u),tt,u.width,u.height):A?i.renderbufferStorageMultisample(i.RENDERBUFFER,Yt(u),tt,u.width,u.height):i.renderbufferStorage(i.RENDERBUFFER,tt,u.width,u.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,j,i.RENDERBUFFER,P)}else{let D=u.textures;for(let z=0;z<D.length;z++){let tt=D[z],j=s.convert(tt.format,tt.colorSpace),H=s.convert(tt.type),V=v(tt.internalFormat,j,H,tt.normalized,tt.colorSpace);Wt(u)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Yt(u),V,u.width,u.height):A?i.renderbufferStorageMultisample(i.RENDERBUFFER,Yt(u),V,u.width,u.height):i.renderbufferStorage(i.RENDERBUFFER,V,u.width,u.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Kt(P,u,A){let D=u.isWebGLCubeRenderTarget===!0;if(e.bindFramebuffer(i.FRAMEBUFFER,P),!(u.depthTexture&&u.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let z=n.get(u.depthTexture);if(z.__renderTarget=u,(!z.__webglTexture||u.depthTexture.image.width!==u.width||u.depthTexture.image.height!==u.height)&&(u.depthTexture.image.width=u.width,u.depthTexture.image.height=u.height,u.depthTexture.needsUpdate=!0),D){if(z.__webglInit===void 0&&(z.__webglInit=!0,u.depthTexture.addEventListener("dispose",C)),z.__webglTexture===void 0){z.__webglTexture=i.createTexture(),e.bindTexture(i.TEXTURE_CUBE_MAP,z.__webglTexture),gt(i.TEXTURE_CUBE_MAP,u.depthTexture);let it=s.convert(u.depthTexture.format),ut=s.convert(u.depthTexture.type),lt;u.depthTexture.format===Wn?lt=i.DEPTH_COMPONENT24:u.depthTexture.format===Li&&(lt=i.DEPTH24_STENCIL8);for(let ct=0;ct<6;ct++)i.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ct,0,lt,u.width,u.height,0,it,ut,null)}}else rt(u.depthTexture,0);let tt=z.__webglTexture,j=Yt(u),H=D?i.TEXTURE_CUBE_MAP_POSITIVE_X+A:i.TEXTURE_2D,V=u.depthTexture.format===Li?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;if(u.depthTexture.format===Wn)Wt(u)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,V,H,tt,0,j):i.framebufferTexture2D(i.FRAMEBUFFER,V,H,tt,0);else if(u.depthTexture.format===Li)Wt(u)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,V,H,tt,0,j):i.framebufferTexture2D(i.FRAMEBUFFER,V,H,tt,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function et(P){let u=n.get(P),A=P.isWebGLCubeRenderTarget===!0;if(u.__boundDepthTexture!==P.depthTexture){let D=P.depthTexture;if(u.__depthDisposeCallback&&u.__depthDisposeCallback(),D){let z=()=>{delete u.__boundDepthTexture,delete u.__depthDisposeCallback,D.removeEventListener("dispose",z)};D.addEventListener("dispose",z),u.__depthDisposeCallback=z}u.__boundDepthTexture=D}if(P.depthTexture&&!u.__autoAllocateDepthBuffer)if(A)for(let D=0;D<6;D++)Kt(u.__webglFramebuffer[D],P,D);else{let D=P.texture.mipmaps;D&&D.length>0?Kt(u.__webglFramebuffer[0],P,0):Kt(u.__webglFramebuffer,P,0)}else if(A){u.__webglDepthbuffer=[];for(let D=0;D<6;D++)if(e.bindFramebuffer(i.FRAMEBUFFER,u.__webglFramebuffer[D]),u.__webglDepthbuffer[D]===void 0)u.__webglDepthbuffer[D]=i.createRenderbuffer(),Lt(u.__webglDepthbuffer[D],P,!1);else{let z=P.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,tt=u.__webglDepthbuffer[D];i.bindRenderbuffer(i.RENDERBUFFER,tt),i.framebufferRenderbuffer(i.FRAMEBUFFER,z,i.RENDERBUFFER,tt)}}else{let D=P.texture.mipmaps;if(D&&D.length>0?e.bindFramebuffer(i.FRAMEBUFFER,u.__webglFramebuffer[0]):e.bindFramebuffer(i.FRAMEBUFFER,u.__webglFramebuffer),u.__webglDepthbuffer===void 0)u.__webglDepthbuffer=i.createRenderbuffer(),Lt(u.__webglDepthbuffer,P,!1);else{let z=P.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,tt=u.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,tt),i.framebufferRenderbuffer(i.FRAMEBUFFER,z,i.RENDERBUFFER,tt)}}e.bindFramebuffer(i.FRAMEBUFFER,null)}function dt(P,u,A){let D=n.get(P);u!==void 0&&pt(D.__webglFramebuffer,P,P.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),A!==void 0&&et(P)}function wt(P){let u=P.texture,A=n.get(P),D=n.get(u);P.addEventListener("dispose",x);let z=P.textures,tt=P.isWebGLCubeRenderTarget===!0,j=z.length>1;if(j||(D.__webglTexture===void 0&&(D.__webglTexture=i.createTexture()),D.__version=u.version,a.memory.textures++),tt){A.__webglFramebuffer=[];for(let H=0;H<6;H++)if(u.mipmaps&&u.mipmaps.length>0){A.__webglFramebuffer[H]=[];for(let V=0;V<u.mipmaps.length;V++)A.__webglFramebuffer[H][V]=i.createFramebuffer()}else A.__webglFramebuffer[H]=i.createFramebuffer()}else{if(u.mipmaps&&u.mipmaps.length>0){A.__webglFramebuffer=[];for(let H=0;H<u.mipmaps.length;H++)A.__webglFramebuffer[H]=i.createFramebuffer()}else A.__webglFramebuffer=i.createFramebuffer();if(j)for(let H=0,V=z.length;H<V;H++){let it=n.get(z[H]);it.__webglTexture===void 0&&(it.__webglTexture=i.createTexture(),a.memory.textures++)}if(P.samples>0&&Wt(P)===!1){A.__webglMultisampledFramebuffer=i.createFramebuffer(),A.__webglColorRenderbuffer=[],e.bindFramebuffer(i.FRAMEBUFFER,A.__webglMultisampledFramebuffer);for(let H=0;H<z.length;H++){let V=z[H];A.__webglColorRenderbuffer[H]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,A.__webglColorRenderbuffer[H]);let it=s.convert(V.format,V.colorSpace),ut=s.convert(V.type),lt=v(V.internalFormat,it,ut,V.normalized,V.colorSpace,P.isXRRenderTarget===!0),ct=Yt(P);i.renderbufferStorageMultisample(i.RENDERBUFFER,ct,lt,P.width,P.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+H,i.RENDERBUFFER,A.__webglColorRenderbuffer[H])}i.bindRenderbuffer(i.RENDERBUFFER,null),P.depthBuffer&&(A.__webglDepthRenderbuffer=i.createRenderbuffer(),Lt(A.__webglDepthRenderbuffer,P,!0)),e.bindFramebuffer(i.FRAMEBUFFER,null)}}if(tt){e.bindTexture(i.TEXTURE_CUBE_MAP,D.__webglTexture),gt(i.TEXTURE_CUBE_MAP,u);for(let H=0;H<6;H++)if(u.mipmaps&&u.mipmaps.length>0)for(let V=0;V<u.mipmaps.length;V++)pt(A.__webglFramebuffer[H][V],P,u,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+H,V);else pt(A.__webglFramebuffer[H],P,u,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+H,0);m(u)&&E(i.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(j){for(let H=0,V=z.length;H<V;H++){let it=z[H],ut=n.get(it),lt=i.TEXTURE_2D;(P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(lt=P.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),e.bindTexture(lt,ut.__webglTexture),gt(lt,it),pt(A.__webglFramebuffer,P,it,i.COLOR_ATTACHMENT0+H,lt,0),m(it)&&E(lt)}e.unbindTexture()}else{let H=i.TEXTURE_2D;if((P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(H=P.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),e.bindTexture(H,D.__webglTexture),gt(H,u),u.mipmaps&&u.mipmaps.length>0)for(let V=0;V<u.mipmaps.length;V++)pt(A.__webglFramebuffer[V],P,u,i.COLOR_ATTACHMENT0,H,V);else pt(A.__webglFramebuffer,P,u,i.COLOR_ATTACHMENT0,H,0);m(u)&&E(H),e.unbindTexture()}P.depthBuffer&&et(P)}function Ot(P){let u=P.textures;for(let A=0,D=u.length;A<D;A++){let z=u[A];if(m(z)){let tt=T(P),j=n.get(z).__webglTexture;e.bindTexture(tt,j),E(tt),e.unbindTexture()}}}let zt=[],ne=[];function he(P){if(P.samples>0){if(Wt(P)===!1){let u=P.textures,A=P.width,D=P.height,z=i.COLOR_BUFFER_BIT,tt=P.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,j=n.get(P),H=u.length>1;if(H)for(let it=0;it<u.length;it++)e.bindFramebuffer(i.FRAMEBUFFER,j.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+it,i.RENDERBUFFER,null),e.bindFramebuffer(i.FRAMEBUFFER,j.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+it,i.TEXTURE_2D,null,0);e.bindFramebuffer(i.READ_FRAMEBUFFER,j.__webglMultisampledFramebuffer);let V=P.texture.mipmaps;V&&V.length>0?e.bindFramebuffer(i.DRAW_FRAMEBUFFER,j.__webglFramebuffer[0]):e.bindFramebuffer(i.DRAW_FRAMEBUFFER,j.__webglFramebuffer);for(let it=0;it<u.length;it++){if(P.resolveDepthBuffer&&(P.depthBuffer&&(z|=i.DEPTH_BUFFER_BIT),P.stencilBuffer&&P.resolveStencilBuffer&&(z|=i.STENCIL_BUFFER_BIT)),H){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,j.__webglColorRenderbuffer[it]);let ut=n.get(u[it]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,ut,0)}i.blitFramebuffer(0,0,A,D,0,0,A,D,z,i.NEAREST),l===!0&&(zt.length=0,ne.length=0,zt.push(i.COLOR_ATTACHMENT0+it),P.depthBuffer&&P.storeMultisampledDepthBuffer===!1&&(zt.push(tt),ne.push(tt),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,ne)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,zt))}if(e.bindFramebuffer(i.READ_FRAMEBUFFER,null),e.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),H)for(let it=0;it<u.length;it++){e.bindFramebuffer(i.FRAMEBUFFER,j.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+it,i.RENDERBUFFER,j.__webglColorRenderbuffer[it]);let ut=n.get(u[it]).__webglTexture;e.bindFramebuffer(i.FRAMEBUFFER,j.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+it,i.TEXTURE_2D,ut,0)}e.bindFramebuffer(i.DRAW_FRAMEBUFFER,j.__webglMultisampledFramebuffer)}else if(P.depthBuffer&&P.storeMultisampledDepthBuffer===!1&&l){let u=P.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[u])}}}function Yt(P){return Math.min(r.maxSamples,P.samples)}function Wt(P){let u=n.get(P);return P.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&u.__useRenderToTexture!==!1}function B(P){let u=a.render.frame;h.get(P)!==u&&(h.set(P,u),P.update())}function xe(P,u){let A=P.colorSpace,D=P.format,z=P.type;return P.isCompressedTexture===!0||P.isVideoTexture===!0||A!==Gi&&A!==sn&&(jt.getTransfer(A)===ce?(D!==Xe||z!==Ve)&&kt("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Ht("WebGLTextures: Unsupported texture color space:",A)),u}function qt(P){return typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement?(c.width=P.naturalWidth||P.width,c.height=P.naturalHeight||P.height):typeof VideoFrame<"u"&&P instanceof VideoFrame?(c.width=P.displayWidth,c.height=P.displayHeight):(c.width=P.width,c.height=P.height),c}this.allocateTextureUnit=$,this.resetTextureUnits=G,this.getTextureUnits=L,this.setTextureUnits=O,this.setTexture2D=rt,this.setTexture2DArray=q,this.setTexture3D=K,this.setTextureCube=st,this.rebindTextures=dt,this.setupRenderTarget=wt,this.updateRenderTargetMipmap=Ot,this.updateMultisampleRenderTarget=he,this.setupDepthRenderbuffer=et,this.setupFrameBufferTexture=pt,this.useMultisampledRTT=Wt,this.isReversedDepthBuffer=function(){return e.buffers.depth.getReversed()}}function sx(i,t){function e(n,r=sn){let s,a=jt.getTransfer(r);if(n===Ve)return i.UNSIGNED_BYTE;if(n===fo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===po)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Uc)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===Nc)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===Lc)return i.BYTE;if(n===Dc)return i.SHORT;if(n===Ur)return i.UNSIGNED_SHORT;if(n===uo)return i.INT;if(n===On)return i.UNSIGNED_INT;if(n===un)return i.FLOAT;if(n===Bn)return i.HALF_FLOAT;if(n===Fc)return i.ALPHA;if(n===Oc)return i.RGB;if(n===Xe)return i.RGBA;if(n===Wn)return i.DEPTH_COMPONENT;if(n===Li)return i.DEPTH_STENCIL;if(n===mo)return i.RED;if(n===go)return i.RED_INTEGER;if(n===Di)return i.RG;if(n===_o)return i.RG_INTEGER;if(n===xo)return i.RGBA_INTEGER;if(n===Cs||n===Ps||n===Is||n===Ls)if(a===ce)if(s=t.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(n===Cs)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Ps)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Is)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Ls)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=t.get("WEBGL_compressed_texture_s3tc"),s!==null){if(n===Cs)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Ps)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Is)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Ls)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===vo||n===yo||n===bo||n===Mo)if(s=t.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(n===vo)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===yo)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===bo)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Mo)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===So||n===Eo||n===wo||n===To||n===Ao||n===Ds||n===Ro)if(s=t.get("WEBGL_compressed_texture_etc"),s!==null){if(n===So||n===Eo)return a===ce?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(n===wo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(n===To)return s.COMPRESSED_R11_EAC;if(n===Ao)return s.COMPRESSED_SIGNED_R11_EAC;if(n===Ds)return s.COMPRESSED_RG11_EAC;if(n===Ro)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===Co||n===Po||n===Io||n===Lo||n===Do||n===Uo||n===No||n===Fo||n===Oo||n===Bo||n===ko||n===zo||n===Ho||n===Vo)if(s=t.get("WEBGL_compressed_texture_astc"),s!==null){if(n===Co)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Po)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Io)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Lo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===Do)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Uo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===No)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Fo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===Oo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Bo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===ko)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===zo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Ho)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Vo)return a===ce?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Go||n===Wo||n===Xo)if(s=t.get("EXT_texture_compression_bptc"),s!==null){if(n===Go)return a===ce?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Wo)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Xo)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===qo||n===Yo||n===Us||n===$o)if(s=t.get("EXT_texture_compression_rgtc"),s!==null){if(n===qo)return s.COMPRESSED_RED_RGTC1_EXT;if(n===Yo)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Us)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===$o)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Nr?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:e}}var ax=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,ox=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,sh=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){let n=new ms(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=n}}getMesh(t){if(this.texture!==null&&this.mesh===null){let e=t.cameras[0].viewport,n=new Re({vertexShader:ax,fragmentShader:ox,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new Vt(new fe(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},ah=class extends Xn{constructor(t,e){super();let n=this,r=null,s=1,a=null,o="local-floor",l=1,c=null,h=null,d=null,f=null,p=null,_=null,b=typeof XRWebGLBinding<"u",g=new sh,m={},E=e.getContextAttributes(),T=null,v=null,M=[],y=[],C=new Ut,x=null,w=null,I=new ze;I.viewport=new Me;let N=new ze;N.viewport=new Me;let R=[I,N],G=new ao,L=null,O=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(W){let Y=M[W];return Y===void 0&&(Y=new Tr,M[W]=Y),Y.getTargetRaySpace()},this.getControllerGrip=function(W){let Y=M[W];return Y===void 0&&(Y=new Tr,M[W]=Y),Y.getGripSpace()},this.getHand=function(W){let Y=M[W];return Y===void 0&&(Y=new Tr,M[W]=Y),Y.getHandSpace()};function $(W){let Y=y.indexOf(W.inputSource);if(Y===-1)return;let ft=M[Y];ft!==void 0&&(ft.update(W.inputSource,W.frame,c||a),ft.dispatchEvent({type:W.type,data:W.inputSource}))}function X(){r.removeEventListener("select",$),r.removeEventListener("selectstart",$),r.removeEventListener("selectend",$),r.removeEventListener("squeeze",$),r.removeEventListener("squeezestart",$),r.removeEventListener("squeezeend",$),r.removeEventListener("end",X),r.removeEventListener("inputsourceschange",rt);for(let W=0;W<M.length;W++){let Y=y[W];Y!==null&&(y[W]=null,M[W].disconnect(Y))}L=null,O=null,g.reset();for(let W in m)delete m[W];if(t.setRenderTarget(T),p=null,f=null,d=null,r=null,v=null,Mt.stop(),n.isPresenting=!1,t.setPixelRatio(x),t.setSize(C.width,C.height,!1),w!==null){let W=w.camera;W.fov=w.fov,W.zoom=w.zoom,W.updateProjectionMatrix(),w=null}n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(W){s=W,n.isPresenting===!0&&kt("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(W){o=W,n.isPresenting===!0&&kt("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(W){c=W},this.getBaseLayer=function(){return f!==null?f:p},this.getBinding=function(){return d===null&&b&&(d=new XRWebGLBinding(r,e)),d},this.getFrame=function(){return _},this.getSession=function(){return r},this.setSession=async function(W){if(r=W,r!==null){if(T=t.getRenderTarget(),r.addEventListener("select",$),r.addEventListener("selectstart",$),r.addEventListener("selectend",$),r.addEventListener("squeeze",$),r.addEventListener("squeezestart",$),r.addEventListener("squeezeend",$),r.addEventListener("end",X),r.addEventListener("inputsourceschange",rt),E.xrCompatible!==!0&&await e.makeXRCompatible(),x=t.getPixelRatio(),t.getSize(C),b&&"createProjectionLayer"in XRWebGLBinding.prototype){let ft=null,Ct=null,pt=null;E.depth&&(pt=E.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,ft=E.stencil?Li:Wn,Ct=E.stencil?Nr:On);let Lt={colorFormat:e.RGBA8,depthFormat:pt,scaleFactor:s};d=this.getBinding(),f=d.createProjectionLayer(Lt),r.updateRenderState({layers:[f]}),t.setPixelRatio(1),t.setSize(f.textureWidth,f.textureHeight,!1),v=new Ge(f.textureWidth,f.textureHeight,{format:Xe,type:Ve,depthTexture:new Ei(f.textureWidth,f.textureHeight,Ct,void 0,void 0,void 0,void 0,void 0,void 0,ft),stencilBuffer:E.stencil,colorSpace:t.outputColorSpace,samples:E.antialias?4:0,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1,storeMultisampledDepthBuffer:f.ignoreDepthValues===!1,storeMultisampledStencilBuffer:f.ignoreDepthValues===!1})}else{let ft={antialias:E.antialias,alpha:!0,depth:E.depth,stencil:E.stencil,framebufferScaleFactor:s};p=new XRWebGLLayer(r,e,ft),r.updateRenderState({baseLayer:p}),t.setPixelRatio(1),t.setSize(p.framebufferWidth,p.framebufferHeight,!1),v=new Ge(p.framebufferWidth,p.framebufferHeight,{format:Xe,type:Ve,colorSpace:t.outputColorSpace,stencilBuffer:E.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1,storeMultisampledDepthBuffer:p.ignoreDepthValues===!1,storeMultisampledStencilBuffer:p.ignoreDepthValues===!1})}v.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await r.requestReferenceSpace(o),Mt.setContext(r),Mt.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return g.getDepthTexture()};function rt(W){for(let Y=0;Y<W.removed.length;Y++){let ft=W.removed[Y],Ct=y.indexOf(ft);Ct>=0&&(y[Ct]=null,M[Ct].disconnect(ft))}for(let Y=0;Y<W.added.length;Y++){let ft=W.added[Y],Ct=y.indexOf(ft);if(Ct===-1){for(let Lt=0;Lt<M.length;Lt++)if(Lt>=y.length){y.push(ft),Ct=Lt;break}else if(y[Lt]===null){y[Lt]=ft,Ct=Lt;break}if(Ct===-1)break}let pt=M[Ct];pt&&pt.connect(ft)}}let q=new U,K=new U;function st(W,Y,ft){q.setFromMatrixPosition(Y.matrixWorld),K.setFromMatrixPosition(ft.matrixWorld);let Ct=q.distanceTo(K),pt=Y.projectionMatrix.elements,Lt=ft.projectionMatrix.elements,Kt=pt[14]/(pt[10]-1),et=pt[14]/(pt[10]+1),dt=(pt[9]+1)/pt[5],wt=(pt[9]-1)/pt[5],Ot=(pt[8]-1)/pt[0],zt=(Lt[8]+1)/Lt[0],ne=Kt*Ot,he=Kt*zt,Yt=Ct/(-Ot+zt),Wt=Yt*-Ot;if(Y.matrixWorld.decompose(W.position,W.quaternion,W.scale),W.translateX(Wt),W.translateZ(Yt),W.matrixWorld.compose(W.position,W.quaternion,W.scale),W.matrixWorldInverse.copy(W.matrixWorld).invert(),pt[10]===-1)W.projectionMatrix.copy(Y.projectionMatrix),W.projectionMatrixInverse.copy(Y.projectionMatrixInverse);else{let B=Kt+Yt,xe=et+Yt,qt=ne-Wt,P=he+(Ct-Wt),u=dt*et/xe*B,A=wt*et/xe*B;W.projectionMatrix.makePerspective(qt,P,u,A,B,xe),W.projectionMatrixInverse.copy(W.projectionMatrix).invert()}}function ot(W,Y){Y===null?W.matrixWorld.copy(W.matrix):W.matrixWorld.multiplyMatrices(Y.matrixWorld,W.matrix),W.matrixWorldInverse.copy(W.matrixWorld).invert()}this.updateCamera=function(W){if(r===null)return;let Y=W.near,ft=W.far;g.texture!==null&&(g.depthNear>0&&(Y=g.depthNear),g.depthFar>0&&(ft=g.depthFar)),G.near=N.near=I.near=Y,G.far=N.far=I.far=ft,(L!==G.near||O!==G.far)&&(r.updateRenderState({depthNear:G.near,depthFar:G.far}),L=G.near,O=G.far),G.layers.mask=W.layers.mask|6,I.layers.mask=G.layers.mask&-5,N.layers.mask=G.layers.mask&-3;let Ct=W.parent,pt=G.cameras;ot(G,Ct);for(let Lt=0;Lt<pt.length;Lt++)ot(pt[Lt],Ct);pt.length===2?st(G,I,N):G.projectionMatrix.copy(I.projectionMatrix),w===null&&W.isPerspectiveCamera&&(w={camera:W,fov:W.fov,zoom:W.zoom}),Q(W,G,Ct)};function Q(W,Y,ft){ft===null?W.matrix.copy(Y.matrixWorld):(W.matrix.copy(ft.matrixWorld),W.matrix.invert(),W.matrix.multiply(Y.matrixWorld)),W.matrix.decompose(W.position,W.quaternion,W.scale),W.updateMatrixWorld(!0),W.projectionMatrix.copy(Y.projectionMatrix),W.projectionMatrixInverse.copy(Y.projectionMatrixInverse),W.isPerspectiveCamera&&(W.fov=as*2*Math.atan(1/W.projectionMatrix.elements[5]),W.zoom=1)}this.getCamera=function(){return G},this.getFoveation=function(){if(!(f===null&&p===null))return l},this.setFoveation=function(W){l=W,f!==null&&(f.fixedFoveation=W),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=W)},this.hasDepthSensing=function(){return g.texture!==null},this.getDepthSensingMesh=function(){return g.getMesh(G)},this.getCameraTexture=function(W){return m[W]};let _t=null;function gt(W,Y){if(h=Y.getViewerPose(c||a),_=Y,h!==null){let ft=h.views;p!==null&&(t.setRenderTargetFramebuffer(v,p.framebuffer),t.setRenderTarget(v));let Ct=!1;ft.length!==G.cameras.length&&(G.cameras.length=0,Ct=!0);for(let et=0;et<ft.length;et++){let dt=ft[et],wt=null;if(p!==null)wt=p.getViewport(dt);else{let zt=d.getViewSubImage(f,dt);wt=zt.viewport,et===0&&(t.setRenderTargetTextures(v,zt.colorTexture,zt.depthStencilTexture),t.setRenderTarget(v))}let Ot=R[et];Ot===void 0&&(Ot=new ze,Ot.layers.enable(et),Ot.viewport=new Me,R[et]=Ot),Ot.matrix.fromArray(dt.transform.matrix),Ot.matrix.decompose(Ot.position,Ot.quaternion,Ot.scale),Ot.projectionMatrix.fromArray(dt.projectionMatrix),Ot.projectionMatrixInverse.copy(Ot.projectionMatrix).invert(),Ot.viewport.set(wt.x,wt.y,wt.width,wt.height),et===0&&(G.matrix.copy(Ot.matrix),G.matrix.decompose(G.position,G.quaternion,G.scale)),Ct===!0&&G.cameras.push(Ot)}let pt=r.enabledFeatures;if(pt&&pt.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&b){d=n.getBinding();let et=d.getDepthInformation(ft[0]);et&&et.isValid&&et.texture&&g.init(et,r.renderState)}if(pt&&pt.includes("camera-access")&&b){t.state.unbindTexture(),d=n.getBinding();for(let et=0;et<ft.length;et++){let dt=ft[et].camera;if(dt){let wt=m[dt];wt||(wt=new ms,m[dt]=wt);let Ot=d.getCameraImage(dt);wt.sourceTexture=Ot}}}}for(let ft=0;ft<M.length;ft++){let Ct=y[ft],pt=M[ft];Ct!==null&&pt!==void 0&&pt.update(Ct,Y,c||a)}_t&&_t(W,Y),Y.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:Y}),_=null}let Mt=new bd;Mt.setAnimationLoop(gt),this.setAnimationLoop=function(W){_t=W},this.dispose=function(){}}},lx=new ie,Ad=new Gt;Ad.set(-1,0,0,0,1,0,0,0,1);function cx(i,t){function e(g,m){g.matrixAutoUpdate===!0&&g.updateMatrix(),m.value.copy(g.matrix)}function n(g,m){m.color.getRGB(g.fogColor.value,Vc(i)),m.isFog?(g.fogNear.value=m.near,g.fogFar.value=m.far):m.isFogExp2&&(g.fogDensity.value=m.density)}function r(g,m,E,T,v){m.isNodeMaterial?m.uniformsNeedUpdate=!1:m.isMeshBasicMaterial?s(g,m):m.isMeshLambertMaterial?(s(g,m),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)):m.isMeshToonMaterial?(s(g,m),d(g,m)):m.isMeshPhongMaterial?(s(g,m),h(g,m),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)):m.isMeshStandardMaterial?(s(g,m),f(g,m),m.isMeshPhysicalMaterial&&p(g,m,v)):m.isMeshMatcapMaterial?(s(g,m),_(g,m)):m.isMeshDepthMaterial?s(g,m):m.isMeshDistanceMaterial?(s(g,m),b(g,m)):m.isMeshNormalMaterial?s(g,m):m.isLineBasicMaterial?(a(g,m),m.isLineDashedMaterial&&o(g,m)):m.isPointsMaterial?l(g,m,E,T):m.isSpriteMaterial?c(g,m):m.isShadowMaterial?(g.color.value.copy(m.color),g.opacity.value=m.opacity):m.isShaderMaterial&&(m.uniformsNeedUpdate=!1)}function s(g,m){g.opacity.value=m.opacity,m.color&&g.diffuse.value.copy(m.color),m.emissive&&g.emissive.value.copy(m.emissive).multiplyScalar(m.emissiveIntensity),m.map&&(g.map.value=m.map,e(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,e(m.alphaMap,g.alphaMapTransform)),m.bumpMap&&(g.bumpMap.value=m.bumpMap,e(m.bumpMap,g.bumpMapTransform),g.bumpScale.value=m.bumpScale,m.side===We&&(g.bumpScale.value*=-1)),m.normalMap&&(g.normalMap.value=m.normalMap,e(m.normalMap,g.normalMapTransform),g.normalScale.value.copy(m.normalScale),m.side===We&&g.normalScale.value.negate()),m.displacementMap&&(g.displacementMap.value=m.displacementMap,e(m.displacementMap,g.displacementMapTransform),g.displacementScale.value=m.displacementScale,g.displacementBias.value=m.displacementBias),m.emissiveMap&&(g.emissiveMap.value=m.emissiveMap,e(m.emissiveMap,g.emissiveMapTransform)),m.specularMap&&(g.specularMap.value=m.specularMap,e(m.specularMap,g.specularMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest);let E=t.get(m),T=E.envMap,v=E.envMapRotation;T&&(g.envMap.value=T,g.envMapRotation.value.setFromMatrix4(lx.makeRotationFromEuler(v)).transpose(),T.isCubeTexture&&T.isRenderTargetTexture===!1&&g.envMapRotation.value.premultiply(Ad),g.reflectivity.value=m.reflectivity,g.ior.value=m.ior,g.refractionRatio.value=m.refractionRatio),m.lightMap&&(g.lightMap.value=m.lightMap,g.lightMapIntensity.value=m.lightMapIntensity,e(m.lightMap,g.lightMapTransform)),m.aoMap&&(g.aoMap.value=m.aoMap,g.aoMapIntensity.value=m.aoMapIntensity,e(m.aoMap,g.aoMapTransform))}function a(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,m.map&&(g.map.value=m.map,e(m.map,g.mapTransform))}function o(g,m){g.dashSize.value=m.dashSize,g.totalSize.value=m.dashSize+m.gapSize,g.scale.value=m.scale}function l(g,m,E,T){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.size.value=m.size*E,g.scale.value=T*.5,m.map&&(g.map.value=m.map,e(m.map,g.uvTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,e(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function c(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.rotation.value=m.rotation,m.map&&(g.map.value=m.map,e(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,e(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function h(g,m){g.specular.value.copy(m.specular),g.shininess.value=Math.max(m.shininess,1e-4)}function d(g,m){m.gradientMap&&(g.gradientMap.value=m.gradientMap)}function f(g,m){g.metalness.value=m.metalness,m.metalnessMap&&(g.metalnessMap.value=m.metalnessMap,e(m.metalnessMap,g.metalnessMapTransform)),g.roughness.value=m.roughness,m.roughnessMap&&(g.roughnessMap.value=m.roughnessMap,e(m.roughnessMap,g.roughnessMapTransform)),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)}function p(g,m,E){g.ior.value=m.ior,m.sheen>0&&(g.sheenColor.value.copy(m.sheenColor).multiplyScalar(m.sheen),g.sheenRoughness.value=m.sheenRoughness,m.sheenColorMap&&(g.sheenColorMap.value=m.sheenColorMap,e(m.sheenColorMap,g.sheenColorMapTransform)),m.sheenRoughnessMap&&(g.sheenRoughnessMap.value=m.sheenRoughnessMap,e(m.sheenRoughnessMap,g.sheenRoughnessMapTransform))),m.clearcoat>0&&(g.clearcoat.value=m.clearcoat,g.clearcoatRoughness.value=m.clearcoatRoughness,m.clearcoatMap&&(g.clearcoatMap.value=m.clearcoatMap,e(m.clearcoatMap,g.clearcoatMapTransform)),m.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=m.clearcoatRoughnessMap,e(m.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),m.clearcoatNormalMap&&(g.clearcoatNormalMap.value=m.clearcoatNormalMap,e(m.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(m.clearcoatNormalScale),m.side===We&&g.clearcoatNormalScale.value.negate())),m.dispersion>0&&(g.dispersion.value=m.dispersion),m.retroreflectivity>0&&(g.retroreflectivity.value=m.retroreflectivity),m.iridescence>0&&(g.iridescence.value=m.iridescence,g.iridescenceIOR.value=m.iridescenceIOR,g.iridescenceThicknessMinimum.value=m.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=m.iridescenceThicknessRange[1],m.iridescenceMap&&(g.iridescenceMap.value=m.iridescenceMap,e(m.iridescenceMap,g.iridescenceMapTransform)),m.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=m.iridescenceThicknessMap,e(m.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),m.transmission>0&&(g.transmission.value=m.transmission,g.transmissionSamplerMap.value=E.texture,g.transmissionSamplerSize.value.set(E.width,E.height),m.transmissionMap&&(g.transmissionMap.value=m.transmissionMap,e(m.transmissionMap,g.transmissionMapTransform)),g.thickness.value=m.thickness,m.thicknessMap&&(g.thicknessMap.value=m.thicknessMap,e(m.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=m.attenuationDistance,g.attenuationColor.value.copy(m.attenuationColor)),m.anisotropy>0&&(g.anisotropyVector.value.set(m.anisotropy*Math.cos(m.anisotropyRotation),m.anisotropy*Math.sin(m.anisotropyRotation)),m.anisotropyMap&&(g.anisotropyMap.value=m.anisotropyMap,e(m.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=m.specularIntensity,g.specularColor.value.copy(m.specularColor),m.specularColorMap&&(g.specularColorMap.value=m.specularColorMap,e(m.specularColorMap,g.specularColorMapTransform)),m.specularIntensityMap&&(g.specularIntensityMap.value=m.specularIntensityMap,e(m.specularIntensityMap,g.specularIntensityMapTransform))}function _(g,m){m.matcap&&(g.matcap.value=m.matcap)}function b(g,m){let E=t.get(m).light;g.referencePosition.value.setFromMatrixPosition(E.matrixWorld),g.nearDistance.value=E.shadow.camera.near,g.farDistance.value=E.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:r}}function hx(i,t,e,n){let r={},s={},a=[],o=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(v,M){let y=M.program;n.uniformBlockBinding(v,y)}function c(v,M){let y=r[v.id];y===void 0&&(g(v),y=h(v),r[v.id]=y,v.addEventListener("dispose",E));let C=M.program;n.updateUBOMapping(v,C);let x=t.render.frame;s[v.id]!==x&&(f(v),s[v.id]=x)}function h(v){let M=d();v.__bindingPointIndex=M;let y=i.createBuffer(),C=v.__size,x=v.usage;return i.bindBuffer(i.UNIFORM_BUFFER,y),i.bufferData(i.UNIFORM_BUFFER,C,x),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,M,y),y}function d(){for(let v=0;v<o;v++)if(a.indexOf(v)===-1)return a.push(v),v;return Ht("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(v){let M=r[v.id],y=v.uniforms,C=v.__cache;i.bindBuffer(i.UNIFORM_BUFFER,M);for(let x=0,w=y.length;x<w;x++){let I=y[x];if(Array.isArray(I))for(let N=0,R=I.length;N<R;N++)p(I[N],x,N,C);else p(I,x,0,C)}i.bindBuffer(i.UNIFORM_BUFFER,null)}function p(v,M,y,C){if(b(v,M,y,C)===!0){let x=v.__offset,w=v.value;if(Array.isArray(w)){let I=0;for(let N=0;N<w.length;N++){let R=w[N],G=m(R);_(R,v.__data,I),typeof R!="number"&&typeof R!="boolean"&&!R.isMatrix3&&!ArrayBuffer.isView(R)&&(I+=G.storage/Float32Array.BYTES_PER_ELEMENT)}}else _(w,v.__data,0);i.bufferSubData(i.UNIFORM_BUFFER,x,v.__data)}}function _(v,M,y){typeof v=="number"||typeof v=="boolean"?M[0]=v:v.isMatrix3?(M[0]=v.elements[0],M[1]=v.elements[1],M[2]=v.elements[2],M[3]=0,M[4]=v.elements[3],M[5]=v.elements[4],M[6]=v.elements[5],M[7]=0,M[8]=v.elements[6],M[9]=v.elements[7],M[10]=v.elements[8],M[11]=0):ArrayBuffer.isView(v)?M.set(new v.constructor(v.buffer,v.byteOffset,M.length)):v.toArray(M,y)}function b(v,M,y,C){let x=v.value,w=M+"_"+y;if(C[w]===void 0)return typeof x=="number"||typeof x=="boolean"?C[w]=x:ArrayBuffer.isView(x)?C[w]=x.slice():C[w]=x.clone(),!0;{let I=C[w];if(typeof x=="number"||typeof x=="boolean"){if(I!==x)return C[w]=x,!0}else{if(ArrayBuffer.isView(x))return!0;if(I.equals(x)===!1)return I.copy(x),!0}}return!1}function g(v){let M=v.uniforms,y=0,C=16;for(let w=0,I=M.length;w<I;w++){let N=Array.isArray(M[w])?M[w]:[M[w]];for(let R=0,G=N.length;R<G;R++){let L=N[R],O=Array.isArray(L.value)?L.value:[L.value];for(let $=0,X=O.length;$<X;$++){let rt=O[$],q=m(rt),K=y%C,st=K%q.boundary,ot=K+st;y+=st,ot!==0&&C-ot<q.storage&&(y+=C-ot),L.__data=new Float32Array(q.storage/Float32Array.BYTES_PER_ELEMENT),L.__offset=y,y+=q.storage}}}let x=y%C;return x>0&&(y+=C-x),v.__size=y,v.__cache={},this}function m(v){let M={boundary:0,storage:0};return typeof v=="number"||typeof v=="boolean"?(M.boundary=4,M.storage=4):v.isVector2?(M.boundary=8,M.storage=8):v.isVector3||v.isColor?(M.boundary=16,M.storage=12):v.isVector4?(M.boundary=16,M.storage=16):v.isMatrix3?(M.boundary=48,M.storage=48):v.isMatrix4?(M.boundary=64,M.storage=64):v.isTexture?kt("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(v)?(M.boundary=16,M.storage=v.byteLength):kt("WebGLRenderer: Unsupported uniform value type.",v),M}function E(v){let M=v.target;M.removeEventListener("dispose",E);let y=a.indexOf(M.__bindingPointIndex);a.splice(y,1),i.deleteBuffer(r[M.id]),delete r[M.id],delete s[M.id]}function T(){for(let v in r)i.deleteBuffer(r[v]);a=[],r={},s={}}return{bind:l,update:c,dispose:T}}var ux=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Zn=null;function dx(){return Zn===null&&(Zn=new Wi(ux,16,16,Di,Bn),Zn.name="DFG_LUT",Zn.minFilter=Le,Zn.magFilter=Le,Zn.wrapS=Gn,Zn.wrapT=Gn,Zn.generateMipmaps=!1,Zn.needsUpdate=!0),Zn}var nl=class{constructor(t={}){let{canvas:e=qu(),context:n=null,depth:r=!0,stencil:s=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:f=!1,outputBufferType:p=Ve}=t;this.isWebGLRenderer=!0;let _;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");_=n.getContextAttributes().alpha}else _=a;let b=p,g=new Set([xo,_o,go]),m=new Set([Ve,On,Ur,Nr,fo,po]),E=new Uint32Array(4),T=new Int32Array(4),v=new U,M=null,y=null,C=[],x=[],w=null;this.domElement=e,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=vn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let I=this,N=!1,R=null,G=null,L=null,O=null;this._outputColorSpace=ke;let $=0,X=0,rt=null,q=-1,K=null,st=new Me,ot=new Me,Q=null,_t=new Xt(0),gt=0,Mt=e.width,W=e.height,Y=1,ft=null,Ct=null,pt=new Me(0,0,Mt,W),Lt=new Me(0,0,Mt,W),Kt=!1,et=new Ar,dt=!1,wt=!1,Ot=new ie,zt=new U,ne=new Me,he={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},Yt=!1;function Wt(){return rt===null?Y:1}let B=n;function xe(S,k){return e.getContext(S,k)}let qt,P,u,A,D,z,tt,j,H,V,it,ut,lt,ct,Et,Tt,Ft,F,mt,at,xt,vt,ht;try{let S={alpha:!0,depth:r,stencil:s,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:d};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${"186"}`),e.addEventListener("webglcontextlost",pe,!1),e.addEventListener("webglcontextrestored",oe,!1),e.addEventListener("webglcontextcreationerror",Pn,!1),B===null){let k="webgl2";if(B=xe(k,S),B===null)throw xe(k)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}Bt()}catch(S){throw e.removeEventListener("webglcontextlost",pe,!1),e.removeEventListener("webglcontextrestored",oe,!1),e.removeEventListener("webglcontextcreationerror",Pn,!1),Ht("WebGLRenderer: "+S.message),S}function Bt(){qt=new vg(B),qt.init(),xt=new sx(B,qt),P=new cg(B,qt,t,xt),u=new ix(B,qt),P.reversedDepthBuffer&&f&&u.buffers.depth.setReversed(!0),G=B.createFramebuffer(),L=B.createFramebuffer(),O=B.createFramebuffer(),A=new Mg(B),D=new G_,z=new rx(B,qt,u,D,P,xt,A),tt=new xg(I),j=new Ep(B),vt=new og(B,j),H=new yg(B,j,A,vt),V=new Eg(B,H,j,vt,A),F=new Sg(B,P,z),Et=new hg(D),it=new V_(I,tt,qt,P,vt,Et),ut=new cx(I,D),lt=new X_,ct=new K_(qt),Ft=new ag(I,tt,u,V,_,l),Tt=new nx(I,V,P),ht=new hx(B,A,P,u),mt=new lg(B,qt,A),at=new bg(B,qt,A),A.programs=it.programs,I.capabilities=P,I.extensions=qt,I.properties=D,I.renderLists=lt,I.shadowMap=Tt,I.state=u,I.info=A}b!==Ve&&(w=new Tg(b,e.width,e.height,o,r,s));let Dt=new ah(I,B);this.xr=Dt,this.getContext=function(){return B},this.getContextAttributes=function(){return B.getContextAttributes()},this.forceContextLoss=function(){let S=qt.get("WEBGL_lose_context");S&&S.loseContext()},this.forceContextRestore=function(){let S=qt.get("WEBGL_lose_context");S&&S.restoreContext()},this.getPixelRatio=function(){return Y},this.setPixelRatio=function(S){S!==void 0&&(Y=S,this.setSize(Mt,W,!1))},this.getSize=function(S){return S.set(Mt,W)},this.setSize=function(S,k,nt=!0){if(Dt.isPresenting){kt("WebGLRenderer: Can't change size while VR device is presenting.");return}Mt=S,W=k,e.width=Math.floor(S*Y),e.height=Math.floor(k*Y),nt===!0&&(e.style.width=S+"px",e.style.height=k+"px"),w!==null&&w.setSize(e.width,e.height),this.setViewport(0,0,S,k)},this.getDrawingBufferSize=function(S){return S.set(Mt*Y,W*Y).floor()},this.setDrawingBufferSize=function(S,k,nt){Mt=S,W=k,Y=nt,e.width=Math.floor(S*nt),e.height=Math.floor(k*nt),this.setViewport(0,0,S,k)},this.setEffects=function(S){if(b===Ve){Ht("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(S){for(let k=0;k<S.length;k++)if(S[k].isOutputPass===!0){kt("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}w.setEffects(S||[])},this.getCurrentViewport=function(S){return S.copy(st)},this.getViewport=function(S){return S.copy(pt)},this.setViewport=function(S,k,nt,Z){S.isVector4?pt.set(S.x,S.y,S.z,S.w):pt.set(S,k,nt,Z),u.viewport(st.copy(pt).multiplyScalar(Y).round())},this.getScissor=function(S){return S.copy(Lt)},this.setScissor=function(S,k,nt,Z){S.isVector4?Lt.set(S.x,S.y,S.z,S.w):Lt.set(S,k,nt,Z),u.scissor(ot.copy(Lt).multiplyScalar(Y).round())},this.getScissorTest=function(){return Kt},this.setScissorTest=function(S){u.setScissorTest(Kt=S)},this.setOpaqueSort=function(S){ft=S},this.setTransparentSort=function(S){Ct=S},this.getClearColor=function(S){return S.copy(Ft.getClearColor())},this.setClearColor=function(){Ft.setClearColor(...arguments)},this.getClearAlpha=function(){return Ft.getClearAlpha()},this.setClearAlpha=function(){Ft.setClearAlpha(...arguments)},this.clear=function(S=!0,k=!0,nt=!0){let Z=0;if(S){let J=!1;if(rt!==null){let St=rt.texture.format;J=g.has(St)}if(J){let St=rt.texture.type,Rt=m.has(St),bt=Ft.getClearColor(),Pt=Ft.getClearAlpha(),Nt=bt.r,$t=bt.g,te=bt.b;Rt?(E[0]=Nt,E[1]=$t,E[2]=te,E[3]=Pt,B.clearBufferuiv(B.COLOR,0,E)):(T[0]=Nt,T[1]=$t,T[2]=te,T[3]=Pt,B.clearBufferiv(B.COLOR,0,T))}else Z|=B.COLOR_BUFFER_BIT}k&&(Z|=B.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),nt&&(Z|=B.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),Z!==0&&B.clear(Z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(S){S.setRenderer(this),R=S},this.dispose=function(){e.removeEventListener("webglcontextlost",pe,!1),e.removeEventListener("webglcontextrestored",oe,!1),e.removeEventListener("webglcontextcreationerror",Pn,!1),Ft.dispose(),lt.dispose(),ct.dispose(),D.dispose(),tt.dispose(),V.dispose(),vt.dispose(),ht.dispose(),it.dispose(),Dt.dispose(),Dt.removeEventListener("sessionstart",Dh),Dt.removeEventListener("sessionend",Uh),Oi.stop()};function pe(S){S.preventDefault(),zc("WebGLRenderer: Context Lost."),N=!0}function oe(){zc("WebGLRenderer: Context Restored."),N=!1;let S=A.autoReset,k=Tt.enabled,nt=Tt.autoUpdate,Z=Tt.needsUpdate,J=Tt.type;Bt(),A.autoReset=S,Tt.enabled=k,Tt.autoUpdate=nt,Tt.needsUpdate=Z,Tt.type=J}function Pn(S){Ht("WebGLRenderer: A WebGL context could not be created. Reason: ",S.statusMessage)}function zn(S){let k=S.target;k.removeEventListener("dispose",zn),Tf(k)}function Tf(S){Af(S),D.remove(S)}function Af(S){let k=D.get(S).programs;k!==void 0&&(k.forEach(function(nt){it.releaseProgram(nt)}),S.isShaderMaterial&&it.releaseShaderCache(S))}this.renderBufferDirect=function(S,k,nt,Z,J,St){k===null&&(k=he);let Rt=J.isMesh&&J.matrixWorld.determinantAffine()<0,bt=Pf(S,k,nt,Z,J);u.setMaterial(Z,Rt);let Pt=nt.index,Nt=1;if(Z.wireframe===!0){if(Pt=H.getWireframeAttribute(nt),Pt===void 0)return;Nt=2}let $t=nt.drawRange,te=nt.attributes.position,It=$t.start*Nt,le=($t.start+$t.count)*Nt;St!==null&&(It=Math.max(It,St.start*Nt),le=Math.min(le,(St.start+St.count)*Nt)),Pt!==null?(It=Math.max(It,0),le=Math.min(le,Pt.count)):te!=null&&(It=Math.max(It,0),le=Math.min(le,te.count));let Pe=le-It;if(Pe<0||Pe===1/0)return;vt.setup(J,Z,bt,nt,Pt);let ve,de=mt;if(Pt!==null&&(ve=j.get(Pt),de=at,de.setIndex(ve)),J.isMesh)Z.wireframe===!0?(u.setLineWidth(Z.wireframeLinewidth*Wt()),de.setMode(B.LINES)):de.setMode(B.TRIANGLES);else if(J.isLine){let Ze=Z.linewidth;Ze===void 0&&(Ze=1),u.setLineWidth(Ze*Wt()),J.isLineSegments?de.setMode(B.LINES):J.isLineLoop?de.setMode(B.LINE_LOOP):de.setMode(B.LINE_STRIP)}else J.isPoints?de.setMode(B.POINTS):J.isSprite&&de.setMode(B.TRIANGLES);if(J.isBatchedMesh)if(qt.get("WEBGL_multi_draw"))de.renderMultiDraw(J._multiDrawStarts,J._multiDrawCounts,J._multiDrawCount);else{let Ze=J._multiDrawStarts,At=J._multiDrawCounts,tn=J._multiDrawCount,se=Pt?j.get(Pt).bytesPerElement:1,Sn=D.get(Z).currentProgram.getUniforms();for(let Hn=0;Hn<tn;Hn++)Sn.setValue(B,"_gl_DrawID",Hn),de.render(Ze[Hn]/se,At[Hn])}else if(J.isInstancedMesh)de.renderInstances(It,Pe,J.count);else if(nt.isInstancedBufferGeometry){let Ze=nt._maxInstanceCount!==void 0?nt._maxInstanceCount:1/0,At=Math.min(nt.instanceCount,Ze);de.renderInstances(It,Pe,At)}else de.render(It,Pe)};function Lh(S,k,nt,Z){R!==null&&S.isNodeMaterial&&R.setObject(Z,S),dt===!0&&Et.setState(S,nt,!1),S.transparent===!0&&S.side===Ue&&S.forceSinglePass===!1?(S.side=We,S.needsUpdate=!0,ea(S,k,Z),S.side=qn,S.needsUpdate=!0,ea(S,k,Z),S.side=Ue):ea(S,k,Z)}this.compile=function(S,k,nt=null){nt===null&&(nt=S),R!==null&&R.renderStart(S,k,nt),y=ct.get(nt),y.init(k),x.push(y),nt.traverseVisible(function(J){J.isLight&&J.layers.test(k.layers)&&(y.pushLight(J),J.castShadow&&y.pushShadow(J))}),S!==nt&&S.traverseVisible(function(J){J.isLight&&J.layers.test(k.layers)&&(y.pushLight(J),J.castShadow&&y.pushShadow(J))}),y.setupLights(),R!==null&&R.updateLights(y.state.lightsArray),wt=this.localClippingEnabled,dt=Et.init(this.clippingPlanes,wt),dt===!0&&Et.setGlobalState(this.clippingPlanes,k),R!==null&&Tt.render(y.state.shadowsArray,nt,k);let Z=new Set;return S.traverse(function(J){if(!(J.isMesh||J.isPoints||J.isLine||J.isSprite))return;let St=J.material;if(St)if(Array.isArray(St))for(let Rt=0;Rt<St.length;Rt++){let bt=St[Rt];Lh(bt,nt,k,J),Z.add(bt)}else Lh(St,nt,k,J),Z.add(St)}),y=x.pop(),R!==null&&R.renderEnd(),Z},this.compileAsync=function(S,k,nt=null){let Z=this.compile(S,k,nt);return new Promise(J=>{function St(){if(Z.forEach(function(Rt){let Pt=D.get(Rt).currentProgram;(Pt===void 0||Pt.isReady())&&Z.delete(Rt)}),Z.size===0){J(S);return}setTimeout(St,10)}qt.get("KHR_parallel_shader_compile")!==null?St():setTimeout(St,10)})};let Ul=null;function Rf(S){Ul&&Ul(S)}function Dh(){Oi.stop()}function Uh(){Oi.start()}let Oi=new bd;Oi.setAnimationLoop(Rf),typeof self<"u"&&Oi.setContext(self),this.setAnimationLoop=function(S){Ul=S,Dt.setAnimationLoop(S),S===null?Oi.stop():Oi.start()},Dt.addEventListener("sessionstart",Dh),Dt.addEventListener("sessionend",Uh),this.render=function(S,k){if(k!==void 0&&k.isCamera!==!0){Ht("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(N===!0)return;R!==null&&R.renderStart(S,k);let nt=Dt.enabled===!0&&Dt.isPresenting===!0,Z=w!==null&&(rt===null||nt)&&w.begin(I,rt);if(S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),k.parent===null&&k.matrixWorldAutoUpdate===!0&&k.updateMatrixWorld(),Dt.enabled===!0&&Dt.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(Dt.cameraAutoUpdate===!0&&Dt.updateCamera(k),k=Dt.getCamera()),S.isScene===!0&&S.onBeforeRender(I,S,k,rt),y=ct.get(S,x.length),y.init(k),y.state.textureUnits=z.getTextureUnits(),x.push(y),Ot.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse),et.setFromProjectionMatrix(Ot,Nn,k.reversedDepth),wt=this.localClippingEnabled,dt=Et.init(this.clippingPlanes,wt),M=lt.get(S,C.length),M.init(),C.push(M),Dt.enabled===!0&&Dt.isPresenting===!0){let Rt=I.xr.getDepthSensingMesh();Rt!==null&&Nl(Rt,k,-1/0,I.sortObjects)}Nl(S,k,0,I.sortObjects),M.finish(),R!==null&&R.updateLights(y.state.lightsArray),I.sortObjects===!0&&M.sort(ft,Ct),Yt=Dt.enabled===!1||Dt.isPresenting===!1||Dt.hasDepthSensing()===!1,Yt&&Ft.addToRenderList(M,S),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),dt===!0&&Et.beginShadows();let J=y.state.shadowsArray;if(Tt.render(J,S,k),dt===!0&&Et.endShadows(),(Z&&w.hasRenderPass())===!1){let Rt=M.opaque,bt=M.transmissive;if(y.setupLights(),k.isArrayCamera){let Pt=k.cameras;if(bt.length>0)for(let Nt=0,$t=Pt.length;Nt<$t;Nt++){let te=Pt[Nt];Fh(Rt,bt,S,te)}Yt&&Ft.render(S);for(let Nt=0,$t=Pt.length;Nt<$t;Nt++){let te=Pt[Nt];Nh(M,S,te,te.viewport)}}else bt.length>0&&Fh(Rt,bt,S,k),Yt&&Ft.render(S),Nh(M,S,k)}rt!==null&&X===0&&(z.updateMultisampleRenderTarget(rt),z.updateRenderTargetMipmap(rt)),Z&&w.end(I),S.isScene===!0&&S.onAfterRender(I,S,k),vt.resetDefaultState(),q=-1,K=null,x.pop(),x.length>0?(y=x[x.length-1],z.setTextureUnits(y.state.textureUnits),dt===!0&&Et.setGlobalState(I.clippingPlanes,y.state.camera)):y=null,C.pop(),C.length>0?M=C[C.length-1]:M=null,R!==null&&R.renderEnd()};function Nl(S,k,nt,Z){if(S.visible===!1)return;if(S.layers.test(k.layers)){if(S.isGroup)nt=S.renderOrder;else if(S.isLOD)S.autoUpdate===!0&&S.update(k);else if(S.isLightProbeGrid)y.pushLightProbeGrid(S);else if(S.isLight)y.pushLight(S),S.castShadow&&y.pushShadow(S);else if(S.isSprite){if(!S.frustumCulled||S.intersectsFrustum(et)){Z&&ne.setFromMatrixPosition(S.matrixWorld).applyMatrix4(Ot);let Rt=V.update(S),bt=S.material;bt.visible&&M.push(S,Rt,bt,nt,ne.z,null,k)}}else if((S.isMesh||S.isLine||S.isPoints)&&(!S.frustumCulled||S.intersectsFrustum(et))){let Rt=V.update(S),bt=S.material;if(Z&&(S.boundingSphere!==void 0?(S.boundingSphere===null&&S.computeBoundingSphere(),ne.copy(S.boundingSphere.center)):(Rt.boundingSphere===null&&Rt.computeBoundingSphere(),ne.copy(Rt.boundingSphere.center)),ne.applyMatrix4(S.matrixWorld).applyMatrix4(Ot)),Array.isArray(bt)){let Pt=Rt.groups;for(let Nt=0,$t=Pt.length;Nt<$t;Nt++){let te=Pt[Nt],It=bt[te.materialIndex];It&&It.visible&&M.push(S,Rt,It,nt,ne.z,te,k)}}else bt.visible&&M.push(S,Rt,bt,nt,ne.z,null,k)}}let St=S.children;for(let Rt=0,bt=St.length;Rt<bt;Rt++)Nl(St[Rt],k,nt,Z)}function Nh(S,k,nt,Z){let{opaque:J,transmissive:St,transparent:Rt}=S;y.setupLightsView(nt),dt===!0&&Et.setGlobalState(I.clippingPlanes,nt),Z&&u.viewport(st.copy(Z)),J.length>0&&ta(J,k,nt),St.length>0&&ta(St,k,nt),Rt.length>0&&ta(Rt,k,nt),u.buffers.depth.setTest(!0),u.buffers.depth.setMask(!0),u.buffers.color.setMask(!0),u.setPolygonOffset(!1)}function Fh(S,k,nt,Z){if((nt.isScene===!0?nt.overrideMaterial:null)!==null)return;if(y.state.transmissionRenderTarget[Z.id]===void 0){let It=qt.has("EXT_color_buffer_half_float")||qt.has("EXT_color_buffer_float");y.state.transmissionRenderTarget[Z.id]=new Ge(1,1,{generateMipmaps:!0,type:It?Bn:Ve,minFilter:$n,samples:Math.max(4,P.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:jt.workingColorSpace})}let St=y.state.transmissionRenderTarget[Z.id],Rt=Z.viewport||st;St.setSize(Rt.z*I.transmissionResolutionScale,Rt.w*I.transmissionResolutionScale);let bt=I.getRenderTarget(),Pt=I.getActiveCubeFace(),Nt=I.getActiveMipmapLevel();I.setRenderTarget(St),I.getClearColor(_t),gt=I.getClearAlpha(),gt<1&&I.setClearColor(16777215,.5),I.clear(),Yt&&Ft.render(nt);let $t=I.toneMapping;I.toneMapping=vn;let te=Z.viewport;if(Z.viewport!==void 0&&(Z.viewport=void 0),y.setupLightsView(Z),dt===!0&&Et.setGlobalState(I.clippingPlanes,Z),ta(S,nt,Z),z.updateMultisampleRenderTarget(St),z.updateRenderTargetMipmap(St),qt.has("WEBGL_multisampled_render_to_texture")===!1){let It=!1;for(let le=0,Pe=k.length;le<Pe;le++){let ve=k[le],{object:de,geometry:Ze,material:At,group:tn}=ve;if(At.side===Ue&&de.layers.test(Z.layers)){let se=At.side;At.side=We,At.needsUpdate=!0,Oh(de,nt,Z,Ze,At,tn),At.side=se,At.needsUpdate=!0,It=!0}}It===!0&&(z.updateMultisampleRenderTarget(St),z.updateRenderTargetMipmap(St))}I.setRenderTarget(bt,Pt,Nt),I.setClearColor(_t,gt),te!==void 0&&(Z.viewport=te),I.toneMapping=$t}function ta(S,k,nt){let Z=k.isScene===!0?k.overrideMaterial:null;for(let J=0,St=S.length;J<St;J++){let Rt=S[J],{object:bt,geometry:Pt,group:Nt}=Rt,$t=Rt.material;$t.allowOverride===!0&&Z!==null&&($t=Z),bt.layers.test(nt.layers)&&Oh(bt,k,nt,Pt,$t,Nt)}}function Oh(S,k,nt,Z,J,St){R!==null&&J.isNodeMaterial&&R.setObject(S,J),S.onBeforeRender(I,k,nt,Z,J,St),S.modelViewMatrix.multiplyMatrices(nt.matrixWorldInverse,S.matrixWorld),S.normalMatrix.getNormalMatrix(S.modelViewMatrix),J.onBeforeRender(I,k,nt,Z,S,St),J.transparent===!0&&J.side===Ue&&J.forceSinglePass===!1?(J.side=We,J.needsUpdate=!0,I.renderBufferDirect(nt,k,Z,J,S,St),J.side=qn,J.needsUpdate=!0,I.renderBufferDirect(nt,k,Z,J,S,St),J.side=Ue):I.renderBufferDirect(nt,k,Z,J,S,St),S.onAfterRender(I,k,nt,Z,J,St)}function ea(S,k,nt){k.isScene!==!0&&(k=he);let Z=D.get(S),J=y.state.lights,St=y.state.shadowsArray,Rt=J.state.version,bt=it.getParameters(S,J.state,St,k,nt,y.state.lightProbeGridArray),Pt=it.getProgramCacheKey(bt),Nt=Z.programs;Z.environment=S.isMeshStandardMaterial||S.isMeshLambertMaterial||S.isMeshPhongMaterial?k.environment:null,Z.fog=k.fog;let $t=S.isMeshStandardMaterial||S.isMeshLambertMaterial&&!S.envMap||S.isMeshPhongMaterial&&!S.envMap;Z.envMap=tt.get(S.envMap||Z.environment,$t),Z.envMapRotation=Z.environment!==null&&S.envMap===null?k.environmentRotation:S.envMapRotation,Nt===void 0&&(S.addEventListener("dispose",zn),Nt=new Map,Z.programs=Nt);let te=Nt.get(Pt);if(te!==void 0){if(Z.currentProgram===te&&Z.lightsStateVersion===Rt)return kh(S,bt),te}else bt.uniforms=it.getUniforms(S),R!==null&&S.isNodeMaterial&&R.build(S,nt,bt),S.onBeforeCompile(bt,I),te=it.acquireProgram(bt,Pt),Nt.set(Pt,te),Z.uniforms=bt.uniforms;let It=Z.uniforms;return(!S.isShaderMaterial&&!S.isRawShaderMaterial||S.clipping===!0)&&(It.clippingPlanes=Et.uniform),kh(S,bt),Z.needsLights=Lf(S),Z.lightsStateVersion=Rt,Z.needsLights&&(It.ambientLightColor.value=J.state.ambient,It.lightProbe.value=J.state.probe,It.sunLights.value=J.state.sun,It.sunLightShadows.value=J.state.sunShadow,It.directionalLights.value=J.state.directional,It.directionalLightShadows.value=J.state.directionalShadow,It.spotLights.value=J.state.spot,It.spotLightShadows.value=J.state.spotShadow,It.rectAreaLights.value=J.state.rectArea,It.ltc_1.value=J.state.rectAreaLTC1,It.ltc_2.value=J.state.rectAreaLTC2,It.pointLights.value=J.state.point,It.pointLightShadows.value=J.state.pointShadow,It.hemisphereLights.value=J.state.hemi,It.sunShadowMatrix.value=J.state.sunShadowMatrix,It.sunShadowCascade.value=J.state.sunShadowCascade,It.directionalShadowMatrix.value=J.state.directionalShadowMatrix,It.spotLightMatrix.value=J.state.spotLightMatrix,It.spotLightMap.value=J.state.spotLightMap,It.pointShadowMatrix.value=J.state.pointShadowMatrix),Z.lightProbeGrid=y.state.lightProbeGridArray.length>0,Z.currentProgram=te,Z.uniformsList=null,te}function Bh(S){if(S.uniformsList===null){let k=S.currentProgram.getUniforms();S.uniformsList=kr.seqWithValue(k.seq,S.uniforms)}return S.uniformsList}function kh(S,k){let nt=D.get(S);nt.outputColorSpace=k.outputColorSpace,nt.batching=k.batching,nt.batchingColor=k.batchingColor,nt.instancing=k.instancing,nt.instancingColor=k.instancingColor,nt.instancingMorph=k.instancingMorph,nt.skinning=k.skinning,nt.morphTargets=k.morphTargets,nt.morphNormals=k.morphNormals,nt.morphColors=k.morphColors,nt.morphTargetsCount=k.morphTargetsCount,nt.numClippingPlanes=k.numClippingPlanes,nt.numIntersection=k.numClipIntersection,nt.vertexAlphas=k.vertexAlphas,nt.vertexTangents=k.vertexTangents,nt.toneMapping=k.toneMapping}function Cf(S,k){if(S.length===0)return null;if(S.length===1)return S[0].texture!==null?S[0]:null;v.setFromMatrixPosition(k.matrixWorld);for(let nt=0,Z=S.length;nt<Z;nt++){let J=S[nt];if(J.texture!==null&&J.boundingBox.containsPoint(v))return J}return null}function Pf(S,k,nt,Z,J){k.isScene!==!0&&(k=he),z.resetTextureUnits();let St=k.fog,Rt=Z.isMeshStandardMaterial||Z.isMeshLambertMaterial||Z.isMeshPhongMaterial?k.environment:null,bt=rt===null?I.outputColorSpace:rt.isXRRenderTarget===!0?rt.texture.colorSpace:jt.workingColorSpace,Pt=Z.isMeshStandardMaterial||Z.isMeshLambertMaterial&&!Z.envMap||Z.isMeshPhongMaterial&&!Z.envMap,Nt=tt.get(Z.envMap||Rt,Pt),$t=Z.vertexColors===!0&&!!nt.attributes.color&&nt.attributes.color.itemSize===4,te=!!nt.attributes.tangent&&(!!Z.normalMap||Z.anisotropy>0),It=!!nt.morphAttributes.position,le=!!nt.morphAttributes.normal,Pe=!!nt.morphAttributes.color,ve=vn;Z.toneMapped&&(rt===null||rt.isXRRenderTarget===!0)&&(ve=I.toneMapping);let de=nt.morphAttributes.position||nt.morphAttributes.normal||nt.morphAttributes.color,Ze=de!==void 0?de.length:0,At=D.get(Z),tn=y.state.lights;if(dt===!0&&(wt===!0||S!==K)){let me=S===K&&Z.id===q;Et.setState(Z,S,me)}let se=!1;Z.version===At.__version?(At.needsLights&&At.lightsStateVersion!==tn.state.version||At.outputColorSpace!==bt||J.isBatchedMesh&&At.batching===!1||!J.isBatchedMesh&&At.batching===!0||J.isBatchedMesh&&At.batchingColor===!0&&J._colorsTexture===null||J.isBatchedMesh&&At.batchingColor===!1&&J._colorsTexture!==null||J.isInstancedMesh&&At.instancing===!1||!J.isInstancedMesh&&At.instancing===!0||J.isSkinnedMesh&&At.skinning===!1||!J.isSkinnedMesh&&At.skinning===!0||J.isInstancedMesh&&At.instancingColor===!0&&J.instanceColor===null||J.isInstancedMesh&&At.instancingColor===!1&&J.instanceColor!==null||J.isInstancedMesh&&At.instancingMorph===!0&&J.morphTexture===null||J.isInstancedMesh&&At.instancingMorph===!1&&J.morphTexture!==null||At.envMap!==Nt||Z.fog===!0&&At.fog!==St||At.numClippingPlanes!==void 0&&(At.numClippingPlanes!==Et.numPlanes||At.numIntersection!==Et.numIntersection)||At.vertexAlphas!==$t||At.vertexTangents!==te||At.morphTargets!==It||At.morphNormals!==le||At.morphColors!==Pe||At.toneMapping!==ve||At.morphTargetsCount!==Ze||!!At.lightProbeGrid!=y.state.lightProbeGridArray.length>0)&&(se=!0):(se=!0,At.__version=Z.version);let Sn=At.currentProgram;se===!0&&(Sn=ea(Z,k,J),R&&Z.isNodeMaterial&&R.onUpdateProgram(Z,Sn,At));let Hn=!1,fi=!1,rr=!1,ue=Sn.getUniforms(),Te=At.uniforms;if(u.useProgram(Sn.program)&&(Hn=!0,fi=!0,rr=!0),Z.id!==q&&(q=Z.id,fi=!0),At.needsLights){let me=Cf(y.state.lightProbeGridArray,J);At.lightProbeGrid!==me&&(At.lightProbeGrid=me,fi=!0)}if(Hn||K!==S){u.buffers.depth.getReversed()&&S.reversedDepth!==!0&&(S._reversedDepth=!0,S.updateProjectionMatrix()),ue.setValue(B,"projectionMatrix",S.projectionMatrix),ue.setValue(B,"viewMatrix",S.matrixWorldInverse);let mi=ue.map.cameraPosition;mi!==void 0&&mi.setValue(B,zt.setFromMatrixPosition(S.matrixWorld)),P.logarithmicDepthBuffer&&ue.setValue(B,"logDepthBufFC",2/(Math.log(S.far+1)/Math.LN2)),(Z.isMeshPhongMaterial||Z.isMeshToonMaterial||Z.isMeshLambertMaterial||Z.isMeshBasicMaterial||Z.isMeshStandardMaterial||Z.isShaderMaterial)&&ue.setValue(B,"isOrthographic",S.isOrthographicCamera===!0),K!==S&&(K=S,fi=!0,rr=!0)}if(At.needsLights&&(tn.state.sunShadowMap.length>0&&ue.setValue(B,"sunShadowMap",tn.state.sunShadowMap,z),tn.state.directionalShadowMap.length>0&&ue.setValue(B,"directionalShadowMap",tn.state.directionalShadowMap,z),tn.state.spotShadowMap.length>0&&ue.setValue(B,"spotShadowMap",tn.state.spotShadowMap,z),tn.state.pointShadowMap.length>0&&ue.setValue(B,"pointShadowMap",tn.state.pointShadowMap,z)),J.isSkinnedMesh){ue.setOptional(B,J,"bindMatrix"),ue.setOptional(B,J,"bindMatrixInverse");let me=J.skeleton;me&&(me.boneTexture===null&&me.computeBoneTexture(),ue.setValue(B,"boneTexture",me.boneTexture,z))}J.isBatchedMesh&&(ue.setOptional(B,J,"batchingTexture"),ue.setValue(B,"batchingTexture",J._matricesTexture,z),ue.setOptional(B,J,"batchingIdTexture"),ue.setValue(B,"batchingIdTexture",J._indirectTexture,z),ue.setOptional(B,J,"batchingColorTexture"),J._colorsTexture!==null&&ue.setValue(B,"batchingColorTexture",J._colorsTexture,z));let pi=nt.morphAttributes;if((pi.position!==void 0||pi.normal!==void 0||pi.color!==void 0)&&F.update(J,nt,Sn),(fi||At.receiveShadow!==J.receiveShadow)&&(At.receiveShadow=J.receiveShadow,ue.setValue(B,"receiveShadow",J.receiveShadow)),(Z.isMeshStandardMaterial||Z.isMeshLambertMaterial||Z.isMeshPhongMaterial)&&Z.envMap===null&&k.environment!==null&&(Te.envMapIntensity.value=k.environmentIntensity),Te.dfgLUT!==void 0&&(Te.dfgLUT.value=dx()),fi){if(ue.setValue(B,"toneMappingExposure",I.toneMappingExposure),At.needsLights&&If(Te,rr),St&&Z.fog===!0&&ut.refreshFogUniforms(Te,St),ut.refreshMaterialUniforms(Te,Z,Y,W,y.state.transmissionRenderTarget[S.id]),At.needsLights&&At.lightProbeGrid){let me=At.lightProbeGrid;Te.probesSH.value=me.texture,Te.probesMin.value.copy(me.boundingBox.min),Te.probesMax.value.copy(me.boundingBox.max),Te.probesResolution.value.copy(me.resolution)}kr.upload(B,Bh(At),Te,z)}if(Z.isShaderMaterial&&Z.uniformsNeedUpdate===!0&&(kr.upload(B,Bh(At),Te,z),Z.uniformsNeedUpdate=!1),Z.isSpriteMaterial&&ue.setValue(B,"center",J.center),ue.setValue(B,"modelViewMatrix",J.modelViewMatrix),ue.setValue(B,"normalMatrix",J.normalMatrix),ue.setValue(B,"modelMatrix",J.matrixWorld),Z.uniformsGroups!==void 0){let me=Z.uniformsGroups;for(let mi=0,sr=me.length;mi<sr;mi++){let Hh=me[mi];ht.update(Hh,Sn),ht.bind(Hh,Sn)}}return Sn}function If(S,k){S.ambientLightColor.needsUpdate=k,S.lightProbe.needsUpdate=k,S.sunLights.needsUpdate=k,S.sunLightShadows.needsUpdate=k,S.directionalLights.needsUpdate=k,S.directionalLightShadows.needsUpdate=k,S.pointLights.needsUpdate=k,S.pointLightShadows.needsUpdate=k,S.spotLights.needsUpdate=k,S.spotLightShadows.needsUpdate=k,S.rectAreaLights.needsUpdate=k,S.hemisphereLights.needsUpdate=k}function Lf(S){return S.isMeshLambertMaterial||S.isMeshToonMaterial||S.isMeshPhongMaterial||S.isMeshStandardMaterial||S.isShadowMaterial||S.isShaderMaterial&&S.lights===!0}this.getActiveCubeFace=function(){return $},this.getActiveMipmapLevel=function(){return X},this.getRenderTarget=function(){return rt},this.setRenderTargetTextures=function(S,k,nt){let Z=D.get(S);Z.__autoAllocateDepthBuffer=S.resolveDepthBuffer===!1,Z.__autoAllocateDepthBuffer===!1&&(Z.__useRenderToTexture=!1),D.get(S.texture).__webglTexture=k,D.get(S.depthTexture).__webglTexture=Z.__autoAllocateDepthBuffer?void 0:nt,Z.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(S,k){let nt=D.get(S);nt.__webglFramebuffer=k,nt.__useDefaultFramebuffer=k===void 0},this.setRenderTarget=function(S,k=0,nt=0){rt=S,$=k,X=nt;let Z=null,J=!1,St=!1;if(S){let bt=D.get(S);if(bt.__useDefaultFramebuffer!==void 0){u.bindFramebuffer(B.FRAMEBUFFER,bt.__webglFramebuffer),st.copy(S.viewport),ot.copy(S.scissor),Q=S.scissorTest,u.viewport(st),u.scissor(ot),u.setScissorTest(Q),q=-1;return}else if(bt.__webglFramebuffer===void 0)z.setupRenderTarget(S);else if(bt.__hasExternalTextures)z.rebindTextures(S,D.get(S.texture).__webglTexture,D.get(S.depthTexture).__webglTexture);else if(S.depthBuffer){let $t=S.depthTexture;if(bt.__boundDepthTexture!==$t){if($t!==null&&D.has($t)&&(S.width!==$t.image.width||S.height!==$t.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");z.setupDepthRenderbuffer(S)}}let Pt=S.texture;(Pt.isData3DTexture||Pt.isDataArrayTexture||Pt.isCompressedArrayTexture)&&(St=!0);let Nt=D.get(S).__webglFramebuffer;S.isWebGLCubeRenderTarget?(Array.isArray(Nt[k])?Z=Nt[k][nt]:Z=Nt[k],J=!0):S.samples>0&&z.useMultisampledRTT(S)===!1?Z=D.get(S).__webglMultisampledFramebuffer:Array.isArray(Nt)?Z=Nt[nt]:Z=Nt,st.copy(S.viewport),ot.copy(S.scissor),Q=S.scissorTest}else st.copy(pt).multiplyScalar(Y).floor(),ot.copy(Lt).multiplyScalar(Y).floor(),Q=Kt;if(nt!==0&&(Z=G),u.bindFramebuffer(B.FRAMEBUFFER,Z)&&u.drawBuffers(S,Z),u.viewport(st),u.scissor(ot),u.setScissorTest(Q),J){let bt=D.get(S.texture);B.framebufferTexture2D(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_CUBE_MAP_POSITIVE_X+k,bt.__webglTexture,nt)}else if(St){let bt=k;for(let Pt=0;Pt<S.textures.length;Pt++){let Nt=D.get(S.textures[Pt]);B.framebufferTextureLayer(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0+Pt,Nt.__webglTexture,nt,bt)}}else if(S!==null&&nt!==0){let bt=D.get(S.texture);B.framebufferTexture2D(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_2D,bt.__webglTexture,nt)}q=-1};function zh(S){let k=D.get(S);return(k.__readFormat!==S.format||k.__readType!==S.type)&&(k.__readFormat=S.format,k.__readType=S.type,k.__formatReadable=P.textureFormatReadable(S.format),k.__typeReadable=P.textureTypeReadable(S.type)),k}this.readRenderTargetPixels=function(S,k,nt,Z,J,St,Rt,bt=0){if(!(S&&S.isWebGLRenderTarget)){Ht("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Pt=D.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&Rt!==void 0&&(Pt=Pt[Rt]),Pt){u.bindFramebuffer(B.FRAMEBUFFER,Pt);try{let Nt=S.textures[bt],$t=Nt.format,te=Nt.type;S.textures.length>1&&B.readBuffer(B.COLOR_ATTACHMENT0+bt);let It=zh(Nt);if(It.__formatReadable===!1){Ht("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(It.__typeReadable===!1){Ht("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}k>=0&&k<=S.width-Z&&nt>=0&&nt<=S.height-J&&B.readPixels(k,nt,Z,J,xt.convert($t),xt.convert(te),St)}finally{let Nt=rt!==null?D.get(rt).__webglFramebuffer:null;u.bindFramebuffer(B.FRAMEBUFFER,Nt)}}},this.readRenderTargetPixelsAsync=async function(S,k,nt,Z,J,St,Rt,bt=0){if(!(S&&S.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Pt=D.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&Rt!==void 0&&(Pt=Pt[Rt]),Pt)if(k>=0&&k<=S.width-Z&&nt>=0&&nt<=S.height-J){u.bindFramebuffer(B.FRAMEBUFFER,Pt);let Nt=S.textures[bt],$t=Nt.format,te=Nt.type;S.textures.length>1&&B.readBuffer(B.COLOR_ATTACHMENT0+bt);let It=zh(Nt);if(It.__formatReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(It.__typeReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let le=B.createBuffer();B.bindBuffer(B.PIXEL_PACK_BUFFER,le),B.bufferData(B.PIXEL_PACK_BUFFER,St.byteLength,B.STREAM_READ),B.readPixels(k,nt,Z,J,xt.convert($t),xt.convert(te),0),B.bindBuffer(B.PIXEL_PACK_BUFFER,null);let Pe=rt!==null?D.get(rt).__webglFramebuffer:null;u.bindFramebuffer(B.FRAMEBUFFER,Pe);let ve=B.fenceSync(B.SYNC_GPU_COMMANDS_COMPLETE,0);return B.flush(),await $u(B,ve,4),B.bindBuffer(B.PIXEL_PACK_BUFFER,le),B.getBufferSubData(B.PIXEL_PACK_BUFFER,0,St),B.bindBuffer(B.PIXEL_PACK_BUFFER,null),B.deleteBuffer(le),B.deleteSync(ve),St}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(S,k=null,nt=0){let Z=Math.pow(2,-nt),J=Math.floor(S.image.width*Z),St=Math.floor(S.image.height*Z),Rt=k!==null?k.x:0,bt=k!==null?k.y:0;z.setTexture2D(S,0),B.copyTexSubImage2D(B.TEXTURE_2D,nt,0,0,Rt,bt,J,St),u.unbindTexture()},this.copyTextureToTexture=function(S,k,nt=null,Z=null,J=0,St=0){let Rt,bt,Pt,Nt,$t,te,It,le,Pe,ve=S.isCompressedTexture?S.mipmaps[St]:S.image;if(nt!==null)Rt=nt.max.x-nt.min.x,bt=nt.max.y-nt.min.y,Pt=nt.isBox3?nt.max.z-nt.min.z:1,Nt=nt.min.x,$t=nt.min.y,te=nt.isBox3?nt.min.z:0;else{let Te=Math.pow(2,-J);Rt=Math.floor(ve.width*Te),bt=Math.floor(ve.height*Te),S.isDataArrayTexture?Pt=ve.depth:S.isData3DTexture?Pt=Math.floor(ve.depth*Te):Pt=1,Nt=0,$t=0,te=0}Z!==null?(It=Z.x,le=Z.y,Pe=Z.z):(It=0,le=0,Pe=0);let de=xt.convert(k.format),Ze=xt.convert(k.type),At;k.isData3DTexture?(z.setTexture3D(k,0),At=B.TEXTURE_3D):k.isDataArrayTexture||k.isCompressedArrayTexture?(z.setTexture2DArray(k,0),At=B.TEXTURE_2D_ARRAY):(z.setTexture2D(k,0),At=B.TEXTURE_2D),u.activeTexture(B.TEXTURE0),u.pixelStorei(B.UNPACK_FLIP_Y_WEBGL,k.flipY),u.pixelStorei(B.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),u.pixelStorei(B.UNPACK_ALIGNMENT,k.unpackAlignment);let tn=u.getParameter(B.UNPACK_ROW_LENGTH),se=u.getParameter(B.UNPACK_IMAGE_HEIGHT),Sn=u.getParameter(B.UNPACK_SKIP_PIXELS),Hn=u.getParameter(B.UNPACK_SKIP_ROWS),fi=u.getParameter(B.UNPACK_SKIP_IMAGES);u.pixelStorei(B.UNPACK_ROW_LENGTH,ve.width),u.pixelStorei(B.UNPACK_IMAGE_HEIGHT,ve.height),u.pixelStorei(B.UNPACK_SKIP_PIXELS,Nt),u.pixelStorei(B.UNPACK_SKIP_ROWS,$t),u.pixelStorei(B.UNPACK_SKIP_IMAGES,te);let rr=S.isDataArrayTexture||S.isData3DTexture,ue=k.isDataArrayTexture||k.isData3DTexture;if(S.isDepthTexture){let Te=D.get(S),pi=D.get(k),me=D.get(Te.__renderTarget),mi=D.get(pi.__renderTarget);u.bindFramebuffer(B.READ_FRAMEBUFFER,me.__webglFramebuffer),u.bindFramebuffer(B.DRAW_FRAMEBUFFER,mi.__webglFramebuffer);for(let sr=0;sr<Pt;sr++)rr&&(B.framebufferTextureLayer(B.READ_FRAMEBUFFER,B.COLOR_ATTACHMENT0,D.get(S).__webglTexture,J,te+sr),B.framebufferTextureLayer(B.DRAW_FRAMEBUFFER,B.COLOR_ATTACHMENT0,D.get(k).__webglTexture,St,Pe+sr)),B.blitFramebuffer(Nt,$t,Rt,bt,It,le,Rt,bt,B.DEPTH_BUFFER_BIT,B.NEAREST);u.bindFramebuffer(B.READ_FRAMEBUFFER,null),u.bindFramebuffer(B.DRAW_FRAMEBUFFER,null)}else if(J!==0||S.isRenderTargetTexture||D.has(S)){let Te=D.get(S),pi=D.get(k);u.bindFramebuffer(B.READ_FRAMEBUFFER,L),u.bindFramebuffer(B.DRAW_FRAMEBUFFER,O);for(let me=0;me<Pt;me++)rr?B.framebufferTextureLayer(B.READ_FRAMEBUFFER,B.COLOR_ATTACHMENT0,Te.__webglTexture,J,te+me):B.framebufferTexture2D(B.READ_FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_2D,Te.__webglTexture,J),ue?B.framebufferTextureLayer(B.DRAW_FRAMEBUFFER,B.COLOR_ATTACHMENT0,pi.__webglTexture,St,Pe+me):B.framebufferTexture2D(B.DRAW_FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_2D,pi.__webglTexture,St),J!==0?B.blitFramebuffer(Nt,$t,Rt,bt,It,le,Rt,bt,B.COLOR_BUFFER_BIT,B.NEAREST):ue?B.copyTexSubImage3D(At,St,It,le,Pe+me,Nt,$t,Rt,bt):B.copyTexSubImage2D(At,St,It,le,Nt,$t,Rt,bt);u.bindFramebuffer(B.READ_FRAMEBUFFER,null),u.bindFramebuffer(B.DRAW_FRAMEBUFFER,null)}else ue?S.isDataTexture||S.isData3DTexture?B.texSubImage3D(At,St,It,le,Pe,Rt,bt,Pt,de,Ze,ve.data):k.isCompressedArrayTexture?B.compressedTexSubImage3D(At,St,It,le,Pe,Rt,bt,Pt,de,ve.data):B.texSubImage3D(At,St,It,le,Pe,Rt,bt,Pt,de,Ze,ve):S.isDataTexture?B.texSubImage2D(B.TEXTURE_2D,St,It,le,Rt,bt,de,Ze,ve.data):S.isCompressedTexture?B.compressedTexSubImage2D(B.TEXTURE_2D,St,It,le,ve.width,ve.height,de,ve.data):B.texSubImage2D(B.TEXTURE_2D,St,It,le,Rt,bt,de,Ze,ve);u.pixelStorei(B.UNPACK_ROW_LENGTH,tn),u.pixelStorei(B.UNPACK_IMAGE_HEIGHT,se),u.pixelStorei(B.UNPACK_SKIP_PIXELS,Sn),u.pixelStorei(B.UNPACK_SKIP_ROWS,Hn),u.pixelStorei(B.UNPACK_SKIP_IMAGES,fi),St===0&&k.generateMipmaps&&B.generateMipmap(At),u.unbindTexture()},this.initRenderTarget=function(S){D.get(S).__webglFramebuffer===void 0&&z.setupRenderTarget(S)},this.initTexture=function(S){S.isCubeTexture?z.setTextureCube(S,0):S.isData3DTexture?z.setTexture3D(S,0):S.isDataArrayTexture||S.isCompressedArrayTexture?z.setTexture2DArray(S,0):z.setTexture2D(S,0),u.unbindTexture()},this.resetState=function(){$=0,X=0,rt=null,u.reset(),vt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Nn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;let e=this.getContext();e.drawingBufferColorSpace=jt._getDrawingBufferColorSpace(t),e.unpackColorSpace=jt._getUnpackColorSpace()}};var an=Uint8Array,Hr=Uint16Array,fx=Int32Array,Rd=new an([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Cd=new an([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),px=new an([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Pd=function(i,t){for(var e=new Hr(31),n=0;n<31;++n)e[n]=t+=1<<i[n-1];for(var r=new fx(e[30]),n=1;n<30;++n)for(var s=e[n];s<e[n+1];++s)r[s]=s-e[n]<<5|n;return{b:e,r}},Id=Pd(Rd,2),Ld=Id.b,mx=Id.r;Ld[28]=258,mx[258]=28;var Dd=Pd(Cd,0),gx=Dd.b,PM=Dd.r,hh=new Hr(32768);for(ae=0;ae<32768;++ae)hi=(ae&43690)>>1|(ae&21845)<<1,hi=(hi&52428)>>2|(hi&13107)<<2,hi=(hi&61680)>>4|(hi&3855)<<4,hh[ae]=((hi&65280)>>8|(hi&255)<<8)>>1;var hi,ae,Vs=(function(i,t,e){for(var n=i.length,r=0,s=new Hr(t);r<n;++r)i[r]&&++s[i[r]-1];var a=new Hr(t);for(r=1;r<t;++r)a[r]=a[r-1]+s[r-1]<<1;var o;if(e){o=new Hr(1<<t);var l=15-t;for(r=0;r<n;++r)if(i[r])for(var c=r<<4|i[r],h=t-i[r],d=a[i[r]-1]++<<h,f=d|(1<<h)-1;d<=f;++d)o[hh[d]>>l]=c}else for(o=new Hr(n),r=0;r<n;++r)i[r]&&(o[r]=hh[a[i[r]-1]++]>>15-i[r]);return o}),Gs=new an(288);for(ae=0;ae<144;++ae)Gs[ae]=8;var ae;for(ae=144;ae<256;++ae)Gs[ae]=9;var ae;for(ae=256;ae<280;++ae)Gs[ae]=7;var ae;for(ae=280;ae<288;++ae)Gs[ae]=8;var ae,Ud=new an(32);for(ae=0;ae<32;++ae)Ud[ae]=5;var ae;var _x=Vs(Gs,9,1);var xx=Vs(Ud,5,1),oh=function(i){for(var t=i[0],e=1;e<i.length;++e)i[e]>t&&(t=i[e]);return t},kn=function(i,t,e){var n=t/8|0;return(i[n]|i[n+1]<<8)>>(t&7)&e},lh=function(i,t){var e=t/8|0;return(i[e]|i[e+1]<<8|i[e+2]<<16)>>(t&7)},vx=function(i){return(i+7)/8|0},sl=function(i,t,e){return(t==null||t<0)&&(t=0),(e==null||e>i.length)&&(e=i.length),new an(i.subarray(t,e))};var yx=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],dn=function(i,t,e){var n=new Error(t||yx[i]);if(n.code=i,Error.captureStackTrace&&Error.captureStackTrace(n,dn),!e)throw n;return n},Nd=function(i,t,e,n){var r=i.length,s=n?n.length:0;if(!r||t.f&&!t.l)return e||new an(0);var a=!e,o=a||t.i!=2,l=t.i;a&&(e=new an(r*3));var c=function(pt){var Lt=e.length;if(pt>Lt){var Kt=new an(Math.max(Lt*2,pt));Kt.set(e),e=Kt}},h=t.f||0,d=t.p||0,f=t.b||0,p=t.l,_=t.d,b=t.m,g=t.n,m=r*8;do{if(!p){h=kn(i,d,1);var E=kn(i,d+1,3);if(d+=3,E)if(E==1)p=_x,_=xx,b=9,g=5;else if(E==2){var y=kn(i,d,31)+257,C=kn(i,d+10,15)+4,x=y+kn(i,d+5,31)+1;d+=14;for(var w=new an(x),I=new an(19),N=0;N<C;++N)I[px[N]]=kn(i,d+N*3,7);d+=C*3;for(var R=oh(I),G=(1<<R)-1,L=Vs(I,R,1),N=0;N<x;){var O=L[kn(i,d,G)];d+=O&15;var T=O>>4;if(T<16)w[N++]=T;else{var $=0,X=0;for(T==16?(X=3+kn(i,d,3),d+=2,$=w[N-1]):T==17?(X=3+kn(i,d,7),d+=3):T==18&&(X=11+kn(i,d,127),d+=7);X--;)w[N++]=$}}var rt=w.subarray(0,y),q=w.subarray(y);b=oh(rt),g=oh(q),p=Vs(rt,b,1),_=Vs(q,g,1)}else dn(1);else{var T=vx(d)+4,v=i[T-4]|i[T-3]<<8,M=T+v;if(M>r){l&&dn(0);break}o&&c(f+v),e.set(i.subarray(T,M),f),t.b=f+=v,t.p=d=M*8,t.f=h;continue}if(d>m){l&&dn(0);break}}o&&c(f+131072);for(var K=(1<<b)-1,st=(1<<g)-1,ot=d;;ot=d){var $=p[lh(i,d)&K],Q=$>>4;if(d+=$&15,d>m){l&&dn(0);break}if($||dn(2),Q<256)e[f++]=Q;else if(Q==256){ot=d,p=null;break}else{var _t=Q-254;if(Q>264){var N=Q-257,gt=Rd[N];_t=kn(i,d,(1<<gt)-1)+Ld[N],d+=gt}var Mt=_[lh(i,d)&st],W=Mt>>4;Mt||dn(3),d+=Mt&15;var q=gx[W];if(W>3){var gt=Cd[W];q+=lh(i,d)&(1<<gt)-1,d+=gt}if(d>m){l&&dn(0);break}o&&c(f+131072);var Y=f+_t;if(f<q){var ft=s-q,Ct=Math.min(q,Y);for(ft+f<0&&dn(3);f<Ct;++f)e[f]=n[ft+f]}for(;f<Y;++f)e[f]=e[f-q]}}t.l=p,t.p=ot,t.b=f,t.f=h,p&&(h=1,t.m=b,t.d=_,t.n=g)}while(!h);return f!=e.length&&a?sl(e,0,f):e.subarray(0,f)};var bx=new an(0);var Fd=function(i,t){return((i[0]&15)!=8||i[0]>>4>7||(i[0]<<8|i[1])%31)&&dn(6,"invalid zlib data"),(i[1]>>5&1)==+!t&&dn(6,"invalid zlib data: "+(i[1]&32?"need":"unexpected")+" dictionary"),(i[1]>>3&4)+2};var ch=(function(){function i(t,e){typeof t=="function"&&(e=t,t={}),this.ondata=e;var n=t&&t.dictionary&&t.dictionary.subarray(-32768);this.s={i:0,b:n?n.length:0},this.o=new an(32768),this.p=new an(0),n&&this.o.set(n)}return i.prototype.e=function(t){if(this.ondata||dn(5),this.d&&dn(4),!this.p.length)this.p=t;else if(t.length){var e=new an(this.p.length+t.length);e.set(this.p),e.set(t,this.p.length),this.p=e}},i.prototype.c=function(t){this.s.i=+(this.d=t||!1);var e=this.s.b,n=Nd(this.p,this.s,this.o);this.ondata(sl(n,e,this.s.b),this.d),this.o=sl(n,this.s.b-32768),this.s.b=this.o.length,this.p=sl(this.p,this.s.p/8|0),this.s.p&=7},i.prototype.push=function(t,e){this.e(t),this.c(e)},i})();var uh=(function(){function i(t,e){ch.call(this,t,e),this.v=t&&t.dictionary?2:1}return i.prototype.push=function(t,e){if(ch.prototype.e.call(this,t),this.v){if(this.p.length<6&&!e)return;this.p=this.p.subarray(Fd(this.p,this.v-1)),this.v=0}e&&(this.p.length<4&&dn(6,"invalid zlib data"),this.p=this.p.subarray(0,-4)),ch.prototype.c.call(this,e)},i})();function Od(i,t){return Nd(i.subarray(Fd(i,t&&t.dictionary),-4),{i:2},t&&t.out,t&&t.dictionary)}var Mx=typeof TextDecoder<"u"&&new TextDecoder,Sx=0;try{Mx.decode(bx,{stream:!0}),Sx=1}catch{}function dh(i,t="utf8"){return new TextDecoder(t).decode(i)}var Ex=new TextEncoder;function Bd(i){return Ex.encode(i)}var wx=1024*8,Tx=(()=>{let i=new Uint8Array(4),t=new Uint32Array(i.buffer);return!((t[0]=1)&i[0])})(),fh={int8:globalThis.Int8Array,uint8:globalThis.Uint8Array,int16:globalThis.Int16Array,uint16:globalThis.Uint16Array,int32:globalThis.Int32Array,uint32:globalThis.Uint32Array,uint64:globalThis.BigUint64Array,int64:globalThis.BigInt64Array,float32:globalThis.Float32Array,float64:globalThis.Float64Array},Ws=class i{buffer;byteLength;byteOffset;length;offset;lastWrittenByte;littleEndian;_data;_mark;_marks;constructor(t=wx,e={}){let n=!1;typeof t=="number"?t=new ArrayBuffer(t):(n=!0,this.lastWrittenByte=t.byteLength);let r=e.offset?e.offset>>>0:0,s=t.byteLength-r,a=r;(ArrayBuffer.isView(t)||t instanceof i)&&(t.byteLength!==t.buffer.byteLength&&(a=t.byteOffset+r),t=t.buffer),n?this.lastWrittenByte=s:this.lastWrittenByte=0,this.buffer=t,this.length=s,this.byteLength=s,this.byteOffset=a,this.offset=0,this.littleEndian=!0,this._data=new DataView(this.buffer,a,s),this._mark=0,this._marks=[]}available(t=1){return this.offset+t<=this.length}isLittleEndian(){return this.littleEndian}setLittleEndian(){return this.littleEndian=!0,this}isBigEndian(){return!this.littleEndian}setBigEndian(){return this.littleEndian=!1,this}skip(t=1){return this.offset+=t,this}back(t=1){return this.offset-=t,this}seek(t){return this.offset=t,this}mark(){return this._mark=this.offset,this}reset(){return this.offset=this._mark,this}pushMark(){return this._marks.push(this.offset),this}popMark(){let t=this._marks.pop();if(t===void 0)throw new Error("Mark stack empty");return this.seek(t),this}rewind(){return this.offset=0,this}ensureAvailable(t=1){if(!this.available(t)){let n=(this.offset+t)*2,r=new Uint8Array(n);r.set(new Uint8Array(this.buffer)),this.buffer=r.buffer,this.length=n,this.byteLength=n,this._data=new DataView(this.buffer)}return this}readBoolean(){return this.readUint8()!==0}readInt8(){return this._data.getInt8(this.offset++)}readUint8(){return this._data.getUint8(this.offset++)}readByte(){return this.readUint8()}readBytes(t=1){return this.readArray(t,"uint8")}readArray(t,e){let n=fh[e].BYTES_PER_ELEMENT*t,r=this.byteOffset+this.offset,s=this.buffer.slice(r,r+n);if(this.littleEndian===Tx&&e!=="uint8"&&e!=="int8"){let o=new Uint8Array(this.buffer.slice(r,r+n));o.reverse();let l=new fh[e](o.buffer);return this.offset+=n,l.reverse(),l}let a=new fh[e](s);return this.offset+=n,a}readInt16(){let t=this._data.getInt16(this.offset,this.littleEndian);return this.offset+=2,t}readUint16(){let t=this._data.getUint16(this.offset,this.littleEndian);return this.offset+=2,t}readInt32(){let t=this._data.getInt32(this.offset,this.littleEndian);return this.offset+=4,t}readUint32(){let t=this._data.getUint32(this.offset,this.littleEndian);return this.offset+=4,t}readFloat32(){let t=this._data.getFloat32(this.offset,this.littleEndian);return this.offset+=4,t}readFloat64(){let t=this._data.getFloat64(this.offset,this.littleEndian);return this.offset+=8,t}readBigInt64(){let t=this._data.getBigInt64(this.offset,this.littleEndian);return this.offset+=8,t}readBigUint64(){let t=this._data.getBigUint64(this.offset,this.littleEndian);return this.offset+=8,t}readChar(){return String.fromCharCode(this.readInt8())}readChars(t=1){let e="";for(let n=0;n<t;n++)e+=this.readChar();return e}readUtf8(t=1){return dh(this.readBytes(t))}decodeText(t=1,e="utf8"){return dh(this.readBytes(t),e)}writeBoolean(t){return this.writeUint8(t?255:0),this}writeInt8(t){return this.ensureAvailable(1),this._data.setInt8(this.offset++,t),this._updateLastWrittenByte(),this}writeUint8(t){return this.ensureAvailable(1),this._data.setUint8(this.offset++,t),this._updateLastWrittenByte(),this}writeByte(t){return this.writeUint8(t)}writeBytes(t){this.ensureAvailable(t.length);for(let e=0;e<t.length;e++)this._data.setUint8(this.offset++,t[e]);return this._updateLastWrittenByte(),this}writeInt16(t){return this.ensureAvailable(2),this._data.setInt16(this.offset,t,this.littleEndian),this.offset+=2,this._updateLastWrittenByte(),this}writeUint16(t){return this.ensureAvailable(2),this._data.setUint16(this.offset,t,this.littleEndian),this.offset+=2,this._updateLastWrittenByte(),this}writeInt32(t){return this.ensureAvailable(4),this._data.setInt32(this.offset,t,this.littleEndian),this.offset+=4,this._updateLastWrittenByte(),this}writeUint32(t){return this.ensureAvailable(4),this._data.setUint32(this.offset,t,this.littleEndian),this.offset+=4,this._updateLastWrittenByte(),this}writeFloat32(t){return this.ensureAvailable(4),this._data.setFloat32(this.offset,t,this.littleEndian),this.offset+=4,this._updateLastWrittenByte(),this}writeFloat64(t){return this.ensureAvailable(8),this._data.setFloat64(this.offset,t,this.littleEndian),this.offset+=8,this._updateLastWrittenByte(),this}writeBigInt64(t){return this.ensureAvailable(8),this._data.setBigInt64(this.offset,t,this.littleEndian),this.offset+=8,this._updateLastWrittenByte(),this}writeBigUint64(t){return this.ensureAvailable(8),this._data.setBigUint64(this.offset,t,this.littleEndian),this.offset+=8,this._updateLastWrittenByte(),this}writeChar(t){return this.writeUint8(t.charCodeAt(0))}writeChars(t){for(let e=0;e<t.length;e++)this.writeUint8(t.charCodeAt(e));return this}writeUtf8(t){return this.writeBytes(Bd(t))}toArray(){return new Uint8Array(this.buffer,this.byteOffset,this.lastWrittenByte)}getWrittenByteLength(){return this.lastWrittenByte-this.byteOffset}_updateLastWrittenByte(){this.offset>this.lastWrittenByte&&(this.lastWrittenByte=this.offset)}};var zd=[];for(let i=0;i<256;i++){let t=i;for(let e=0;e<8;e++)t&1?t=3988292384^t>>>1:t=t>>>1;zd[i]=t}var kd=4294967295;function Ax(i,t,e){let n=i;for(let r=0;r<e;r++)n=zd[(n^t[r])&255]^n>>>8;return n}function Rx(i,t){return(Ax(kd,i,t)^kd)>>>0}function ph(i,t,e){let n=i.readUint32(),r=Rx(new Uint8Array(i.buffer,i.byteOffset+i.offset-t-4,t),t);if(r!==n)throw new Error(`CRC mismatch for chunk ${e}. Expected ${n}, found ${r}`)}function al(i,t,e){for(let n=0;n<e;n++)t[n]=i[n]}function ol(i,t,e,n){let r=0;for(;r<n;r++)t[r]=i[r];for(;r<e;r++)t[r]=i[r]+t[r-n]&255}function ll(i,t,e,n){let r=0;if(e.length===0)for(;r<n;r++)t[r]=i[r];else for(;r<n;r++)t[r]=i[r]+e[r]&255}function cl(i,t,e,n,r){let s=0;if(e.length===0){for(;s<r;s++)t[s]=i[s];for(;s<n;s++)t[s]=i[s]+(t[s-r]>>1)&255}else{for(;s<r;s++)t[s]=i[s]+(e[s]>>1)&255;for(;s<n;s++)t[s]=i[s]+(t[s-r]+e[s]>>1)&255}}function hl(i,t,e,n,r){let s=0;if(e.length===0){for(;s<r;s++)t[s]=i[s];for(;s<n;s++)t[s]=i[s]+t[s-r]&255}else{for(;s<r;s++)t[s]=i[s]+e[s]&255;for(;s<n;s++)t[s]=i[s]+Cx(t[s-r],e[s],e[s-r])&255}}function Cx(i,t,e){let n=i+t-e,r=Math.abs(n-i),s=Math.abs(n-t),a=Math.abs(n-e);return r<=s&&r<=a?i:s<=a?t:e}function Hd(i,t,e,n,r,s){switch(i){case 0:al(t,e,r);break;case 1:ol(t,e,r,s);break;case 2:ll(t,e,n,r);break;case 3:cl(t,e,n,r,s);break;case 4:hl(t,e,n,r,s);break;default:throw new Error(`Unsupported filter: ${i}`)}}var Px=new Uint16Array([255]),Ix=new Uint8Array(Px.buffer),Lx=Ix[0]===255;function Vd(i){let{data:t,width:e,height:n,channels:r,depth:s}=i,a=[{x:0,y:0,xStep:8,yStep:8},{x:4,y:0,xStep:8,yStep:8},{x:0,y:4,xStep:4,yStep:8},{x:2,y:0,xStep:4,yStep:4},{x:0,y:2,xStep:2,yStep:4},{x:1,y:0,xStep:2,yStep:2},{x:0,y:1,xStep:1,yStep:2}],o=Math.ceil(s/8)*r,l=new Uint8Array(n*e*o),c=0;for(let h=0;h<7;h++){let d=a[h],f=Math.ceil((e-d.x)/d.xStep),p=Math.ceil((n-d.y)/d.yStep);if(f<=0||p<=0)continue;let _=f*o,b=new Uint8Array(_);for(let g=0;g<p;g++){let m=t[c++],E=t.subarray(c,c+_);c+=_;let T=new Uint8Array(_);Hd(m,E,T,b,_,o),b.set(T);for(let v=0;v<f;v++){let M=d.x+v*d.xStep,y=d.y+g*d.yStep;if(!(M>=e||y>=n))for(let C=0;C<o;C++)l[(y*e+M)*o+C]=T[v*o+C]}}}if(s===16){let h=new Uint16Array(l.buffer);if(Lx)for(let d=0;d<h.length;d++)h[d]=Dx(h[d]);return h}else return l}function Dx(i){return(i&255)<<8|i>>8&255}var Ux=new Uint16Array([255]),Nx=new Uint8Array(Ux.buffer),Fx=Nx[0]===255,Ox=new Uint8Array(0);function mh(i){let{data:t,width:e,height:n,channels:r,depth:s}=i,a=Math.ceil(s/8)*r,o=Math.ceil(s/8*r*e),l=new Uint8Array(n*o),c=Ox,h=0,d,f;for(let p=0;p<n;p++){switch(d=t.subarray(h+1,h+1+o),f=l.subarray(p*o,(p+1)*o),t[h]){case 0:al(d,f,o);break;case 1:ol(d,f,o,a);break;case 2:ll(d,f,c,o);break;case 3:cl(d,f,c,o,a);break;case 4:hl(d,f,c,o,a);break;default:throw new Error(`Unsupported filter: ${t[h]}`)}c=f,h+=o+1}if(s===16){let p=new Uint16Array(l.buffer);if(Fx)for(let _=0;_<p.length;_++)p[_]=Bx(p[_]);return p}else return l}function Bx(i){return(i&255)<<8|i>>8&255}var ul=Uint8Array.of(137,80,78,71,13,10,26,10);function gh(i){if(!Gd(i.readBytes(ul.length)))throw new Error("wrong PNG signature")}function Gd(i){if(i.length<ul.length)return!1;for(let t=0;t<ul.length;t++)if(i[t]!==ul[t])return!1;return!0}var Wd="tEXt",zx=0,Xd=new TextDecoder("latin1");function Hx(i){if(Gx(i),i.length===0||i.length>79)throw new Error("keyword length must be between 1 and 79")}var Vx=/^[\u0000-\u00FF]*$/;function Gx(i){if(!Vx.test(i))throw new Error("invalid latin1 text")}function qd(i,t,e){let n=_h(t);i[n]=Wx(t,e-n.length-1)}function _h(i){for(i.mark();i.readByte()!==zx;);let t=i.offset;i.reset();let e=Xd.decode(i.readBytes(t-i.offset-1));return i.skip(1),Hx(e),e}function Wx(i,t){return Xd.decode(i.readBytes(t))}var on={UNKNOWN:-1,GREYSCALE:0,TRUECOLOUR:2,INDEXED_COLOUR:3,GREYSCALE_ALPHA:4,TRUECOLOUR_ALPHA:6},Xs={UNKNOWN:-1,DEFLATE:0},dl={UNKNOWN:-1,ADAPTIVE:0},qs={UNKNOWN:-1,NO_INTERLACE:0,ADAM7:1},Ys={NONE:0,BACKGROUND:1,PREVIOUS:2},fl={SOURCE:0,OVER:1};var $s=class extends Ws{_checkCrc;_inflator;_png;_apng;_end;_hasPalette;_palette;_hasTransparency;_transparency;_compressionMethod;_filterMethod;_interlaceMethod;_colorType;_isAnimated;_numberOfFrames;_numberOfPlays;_frames;_writingDataChunks;_chunks;_inflatorResult;constructor(t,e={}){super(t);let{checkCrc:n=!1}=e;this._checkCrc=n,this._inflator=new uh((r,s)=>{if(this._chunks.push(r),s){let a=this._chunks.reduce((l,c)=>l+c.length,0);this._inflatorResult=new Uint8Array(a);let o=0;for(let l of this._chunks)this._inflatorResult.set(l,o),o+=l.length;this._chunks=[]}}),this._chunks=[],this._png={width:-1,height:-1,channels:-1,data:new Uint8Array(0),depth:1,text:{}},this._apng={width:-1,height:-1,channels:-1,depth:1,numberOfFrames:1,numberOfPlays:0,text:{},frames:[]},this._end=!1,this._hasPalette=!1,this._palette=[],this._hasTransparency=!1,this._transparency=new Uint16Array(0),this._compressionMethod=Xs.UNKNOWN,this._filterMethod=dl.UNKNOWN,this._interlaceMethod=qs.UNKNOWN,this._colorType=on.UNKNOWN,this._isAnimated=!1,this._numberOfFrames=1,this._numberOfPlays=0,this._frames=[],this._writingDataChunks=!1,this._inflatorResult=new Uint8Array(0),this.setBigEndian()}decode(){for(gh(this);!this._end;){let t=this.readUint32(),e=this.readChars(4);this.decodeChunk(t,e)}return this._inflator.push(new Uint8Array(0),!0),this.decodeImage(),this._png}decodeApng(){for(gh(this);!this._end;){let t=this.readUint32(),e=this.readChars(4);this.decodeApngChunk(t,e)}return this.decodeApngImage(),this._apng}decodeChunk(t,e){let n=this.offset;switch(e){case"IHDR":this.decodeIHDR();break;case"PLTE":this.decodePLTE(t);break;case"IDAT":this.decodeIDAT(t);break;case"IEND":this._end=!0;break;case"tRNS":this.decodetRNS(t);break;case"iCCP":this.decodeiCCP(t);break;case Wd:qd(this._png.text,this,t);break;case"pHYs":this.decodepHYs();break;default:this.skip(t);break}if(this.offset-n!==t)throw new Error(`Length mismatch while decoding chunk ${e}`);this._checkCrc?ph(this,t+4,e):this.skip(4)}decodeApngChunk(t,e){let n=this.offset;switch(e!=="fdAT"&&e!=="IDAT"&&this._writingDataChunks&&this.pushDataToFrame(),e){case"acTL":this.decodeACTL();break;case"fcTL":this.decodeFCTL();break;case"fdAT":this.decodeFDAT(t);break;default:this.decodeChunk(t,e),this.offset=n+t;break}if(this.offset-n!==t)throw new Error(`Length mismatch while decoding chunk ${e}`);this._checkCrc?ph(this,t+4,e):this.skip(4)}decodeIHDR(){let t=this._png;t.width=this.readUint32(),t.height=this.readUint32(),t.depth=Xx(this.readUint8());let e=this.readUint8();this._colorType=e;let n;switch(e){case on.GREYSCALE:n=1;break;case on.TRUECOLOUR:n=3;break;case on.INDEXED_COLOUR:n=1;break;case on.GREYSCALE_ALPHA:n=2;break;case on.TRUECOLOUR_ALPHA:n=4;break;case on.UNKNOWN:default:throw new Error(`Unknown color type: ${e}`)}if(this._png.channels=n,this._compressionMethod=this.readUint8(),this._compressionMethod!==Xs.DEFLATE)throw new Error(`Unsupported compression method: ${this._compressionMethod}`);this._filterMethod=this.readUint8(),this._interlaceMethod=this.readUint8()}decodeACTL(){this._numberOfFrames=this.readUint32(),this._numberOfPlays=this.readUint32(),this._isAnimated=!0}decodeFCTL(){let t={sequenceNumber:this.readUint32(),width:this.readUint32(),height:this.readUint32(),xOffset:this.readUint32(),yOffset:this.readUint32(),delayNumber:this.readUint16(),delayDenominator:this.readUint16(),disposeOp:this.readUint8(),blendOp:this.readUint8(),data:new Uint8Array(0)};this._frames.push(t)}decodePLTE(t){if(t%3!==0)throw new RangeError(`PLTE field length must be a multiple of 3. Got ${t}`);let e=t/3;this._hasPalette=!0;let n=[];this._palette=n;for(let r=0;r<e;r++)n.push([this.readUint8(),this.readUint8(),this.readUint8()])}decodeIDAT(t){this._writingDataChunks=!0;let e=t,n=this.offset+this.byteOffset;try{this._inflator.push(new Uint8Array(this.buffer,n,e),!1)}catch(r){throw new Error("Error while decompressing the data:",{cause:r})}this.skip(t)}decodeFDAT(t){this._writingDataChunks=!0;let e=t,n=this.offset+this.byteOffset;n+=4,e-=4;try{this._inflator.push(new Uint8Array(this.buffer,n,e),!1)}catch(r){throw new Error("Error while decompressing the data:",{cause:r})}this.skip(t)}decodetRNS(t){switch(this._colorType){case on.GREYSCALE:case on.TRUECOLOUR:{if(t%2!==0)throw new RangeError(`tRNS chunk length must be a multiple of 2. Got ${t}`);if(t/2>this._png.width*this._png.height)throw new Error(`tRNS chunk contains more alpha values than there are pixels (${t/2} vs ${this._png.width*this._png.height})`);this._hasTransparency=!0,this._transparency=new Uint16Array(t/2);for(let e=0;e<t/2;e++)this._transparency[e]=this.readUint16();break}case on.INDEXED_COLOUR:{if(t>this._palette.length)throw new Error(`tRNS chunk contains more alpha values than there are palette colors (${t} vs ${this._palette.length})`);let e=0;for(;e<t;e++){let n=this.readByte();this._palette[e].push(n)}for(;e<this._palette.length;e++)this._palette[e].push(255);break}case on.UNKNOWN:case on.GREYSCALE_ALPHA:case on.TRUECOLOUR_ALPHA:default:throw new Error(`tRNS chunk is not supported for color type ${this._colorType}`)}}decodeiCCP(t){let e=_h(this),n=this.readUint8();if(n!==Xs.DEFLATE)throw new Error(`Unsupported iCCP compression method: ${n}`);let r=this.readBytes(t-e.length-2);this._png.iccEmbeddedProfile={name:e,profile:Od(r)}}decodepHYs(){let t=this.readUint32(),e=this.readUint32(),n=this.readByte();this._png.resolution={x:t,y:e,unit:n}}decodeApngImage(){this._apng.width=this._png.width,this._apng.height=this._png.height,this._apng.channels=this._png.channels,this._apng.depth=this._png.depth,this._apng.numberOfFrames=this._numberOfFrames,this._apng.numberOfPlays=this._numberOfPlays,this._apng.text=this._png.text,this._apng.resolution=this._png.resolution;for(let t=0;t<this._numberOfFrames;t++){let e={sequenceNumber:this._frames[t].sequenceNumber,delayNumber:this._frames[t].delayNumber,delayDenominator:this._frames[t].delayDenominator,data:this._apng.depth===8?new Uint8Array(this._apng.width*this._apng.height*this._apng.channels):new Uint16Array(this._apng.width*this._apng.height*this._apng.channels)},n=this._frames.at(t);if(n){if(n.data=mh({data:n.data,width:n.width,height:n.height,channels:this._apng.channels,depth:this._apng.depth}),this._hasPalette&&(this._apng.palette=this._palette),this._hasTransparency&&(this._apng.transparency=this._transparency),t===0||n.xOffset===0&&n.yOffset===0&&n.width===this._png.width&&n.height===this._png.height)e.data=n.data;else{let r=this._apng.frames.at(t-1);this.disposeFrame(n,r,e),this.addFrameDataToCanvas(e,n)}this._apng.frames.push(e)}}return this._apng}disposeFrame(t,e,n){switch(t.disposeOp){case Ys.NONE:break;case Ys.BACKGROUND:for(let r=0;r<this._png.height;r++)for(let s=0;s<this._png.width;s++){let a=(r*t.width+s)*this._png.channels;for(let o=0;o<this._png.channels;o++)n.data[a+o]=0}break;case Ys.PREVIOUS:n.data.set(e.data);break;default:throw new Error("Unknown disposeOp")}}addFrameDataToCanvas(t,e){let n=1<<this._png.depth,r=(s,a)=>{let o=((s+e.yOffset)*this._png.width+e.xOffset+a)*this._png.channels,l=(s*e.width+a)*this._png.channels;return{index:o,frameIndex:l}};switch(e.blendOp){case fl.SOURCE:for(let s=0;s<e.height;s++)for(let a=0;a<e.width;a++){let{index:o,frameIndex:l}=r(s,a);for(let c=0;c<this._png.channels;c++)t.data[o+c]=e.data[l+c]}break;case fl.OVER:for(let s=0;s<e.height;s++)for(let a=0;a<e.width;a++){let{index:o,frameIndex:l}=r(s,a);for(let c=0;c<this._png.channels;c++){let h=e.data[l+this._png.channels-1]/n,d=c%(this._png.channels-1)===0?1:e.data[l+c],f=Math.floor(h*d+(1-h)*t.data[o+c]);t.data[o+c]+=f}}break;default:throw new Error("Unknown blendOp")}}decodeImage(){let t=this._inflatorResult;if(this._filterMethod!==dl.ADAPTIVE)throw new Error(`Filter method ${this._filterMethod} not supported`);if(this._interlaceMethod===qs.NO_INTERLACE)this._png.data=mh({data:t,width:this._png.width,height:this._png.height,channels:this._png.channels,depth:this._png.depth});else if(this._interlaceMethod===qs.ADAM7)this._png.data=Vd({data:t,width:this._png.width,height:this._png.height,channels:this._png.channels,depth:this._png.depth});else throw new Error(`Interlace method ${this._interlaceMethod} not supported`);this._hasPalette&&(this._png.palette=this._palette),this._hasTransparency&&(this._png.transparency=this._transparency)}pushDataToFrame(){this._inflator.push(new Uint8Array(0),!0);let t=this._inflatorResult,e=this._frames.at(-1);e?e.data=t:this._frames.push({sequenceNumber:0,width:this._png.width,height:this._png.height,xOffset:0,yOffset:0,delayNumber:0,delayDenominator:0,disposeOp:Ys.NONE,blendOp:fl.SOURCE,data:t}),this._inflator=new uh((n,r)=>{if(this._chunks.push(n),r){let s=this._chunks.reduce((o,l)=>o+l.length,0);this._inflatorResult=new Uint8Array(s);let a=0;for(let o of this._chunks)this._inflatorResult.set(o,a),a+=o.length;this._chunks=[]}}),this._chunks=[],this._writingDataChunks=!1}};function Xx(i){if(i!==1&&i!==2&&i!==4&&i!==8&&i!==16)throw new Error(`invalid bit depth: ${i}`);return i}function pl(i,t){return new $s(i,t).decode()}function Vr(i,t,e){let n=new Uint8Array(i.length),r=t*4;for(let s=0;s<e;s++)n.set(i.subarray(s*r,(s+1)*r),(e-1-s)*r);return n}var Jt={stage:1,"fx-back":2,photo:3,drawn:4,"fx-front":5,ui:6,isolate:7,lightsOnly:30},Yd=1,qe=(i,t=0,e=1)=>Math.min(e,Math.max(t,i)),Se=(i,t,e)=>i+(t-i)*e,ge=(i,t,e)=>t===i?e>=t?1:0:qe((e-i)/(t-i)),be=(i,t,e)=>{let n=ge(i,t,e);return n*n*(3-2*n)},jn=i=>1-Math.pow(1-i,3),ml=i=>i*i,Wr=i=>i<.5?4*i*i*i:1-Math.pow(-2*i+2,3)/2,Ui=(i,t=1.7)=>1+(t+1)*Math.pow(i-1,3)+t*Math.pow(i-1,2);function Qe(i){return new Xt(i).convertSRGBToLinear()}var Gr=class{parts=[];next=1;add(t,e,n,r=null){let s=this.next++,a=r?.userData.co,o=new wi({depthPacking:Ns,map:r,alphaTest:r?1/512:0}),l=n[0]?.material;o.side=(Array.isArray(l)?l[0]:l)?.side??qn,o.name=`${t}#${s}#depth`,o.userData.co={cls:e,part_id:s};let c={part_id:s,name:t,cls:e,asset_id:a?.asset_id??null,asset_sha256:e==="photo"?a?.sha256??null:null,objects:n,depthMat:o};for(let h of n){h.layers.set(e==="photo"?Jt.photo:Jt.drawn);let d=Array.isArray(h.material)?h.material:[h.material];for(let f of d)f.userData.co={cls:e,part_id:s}}return this.parts.push(c),c}};function $d(i,t){let e=new rn({map:i,transparent:!0,alphaTest:.001953125,toneMapped:!1,depthWrite:!0,fog:!1,side:Ue,stencilWrite:!0,stencilRef:Yd,stencilFunc:Os,stencilZPass:Fs});return qx(e),e.onBeforeCompile=n=>{n.fragmentShader=n.fragmentShader.replace("#include <premultiplied_alpha_fragment>",`#include <premultiplied_alpha_fragment>
	gl_FragColor.rgb *= opacity;`)},e.customProgramCacheKey=()=>"crunchy-photo-premultiplied",e.name=t,e}function qx(i){i.blending=Dr,i.blendSrc=ci,i.blendDst=Pi,i.blendSrcAlpha=ci,i.blendDstAlpha=Pi}function Zd(i){for(let t=0;t<i.length;t+=4){let e=i[t+3];e!==255&&(i[t]=Math.round(i[t]*e/255),i[t+1]=Math.round(i[t+1]*e/255),i[t+2]=Math.round(i[t+2]*e/255))}return i}function xh(i){for(let t of i.parts)if(t.cls==="drawn")for(let e of t.objects)for(let n of Array.isArray(e.material)?e.material:[e.material])n.stencilZPass=Yx(n)?Fs:si}function Yx(i){let t=i;return i.opacity>=1&&!t.alphaMap&&!(t.transmission&&t.transmission>0)&&!i.alphaHash}function fn(i,t){return i.name=t,i.stencilWrite=!0,i.stencilRef=0,i.stencilFunc=Os,i.stencilZPass=Fs,gl(i),i}function gl(i){i.onBeforeCompile=t=>{t.fragmentShader=t.fragmentShader.replace("#include <colorspace_fragment>",`#include <colorspace_fragment>
	gl_FragColor = clamp( sRGBTransferOETF( gl_FragColor ), 0.0, 1.0 );`)},i.customProgramCacheKey=()=>"crunchy-srgb-out"}function Ye(i,t,e){return i.name=t,i.userData.co={cls:"graphic",part_id:null},e&&(i.stencilWrite=!0,i.stencilRef=Yd,i.stencilFunc=Bc,i.stencilWriteMask=0,i.stencilFail=si,i.stencilZFail=si,i.stencilZPass=si),i}function ji(i,t){return i.name=t,i.userData.co={cls:"graphic",asset_id:t,sha256:null},i}function vh(i,t){return i.name=t,i.userData.co={cls:"drawn",asset_id:t,sha256:null},i}function Qi(i,t,e){let n=document.createElement("canvas");n.width=i,n.height=t,e(n.getContext("2d"));let r=new Si(n);return r.colorSpace=sn,r.generateMipmaps=!0,r.minFilter=$n,r}var $x=new Uint32Array([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),Qn=(i,t)=>i>>>t|i<<32-t;function Jd(i){let t=i.length,e=new Uint8Array(t+9+63>>6<<6);e.set(i),e[t]=128;let n=new DataView(e.buffer);n.setUint32(e.length-8,Math.floor(t/536870912)),n.setUint32(e.length-4,t<<3>>>0);let r=new Uint32Array([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]),s=new Uint32Array(64);for(let l=0;l<e.length;l+=64){for(let m=0;m<16;m++)s[m]=n.getUint32(l+m*4);for(let m=16;m<64;m++){let E=s[m-15],T=s[m-2],v=Qn(E,7)^Qn(E,18)^E>>>3,M=Qn(T,17)^Qn(T,19)^T>>>10;s[m]=s[m-16]+v+s[m-7]+M>>>0}let c=r[0],h=r[1],d=r[2],f=r[3],p=r[4],_=r[5],b=r[6],g=r[7];for(let m=0;m<64;m++){let E=Qn(p,6)^Qn(p,11)^Qn(p,25),T=p&_^~p&b,v=g+E+T+$x[m]+s[m]>>>0,M=Qn(c,2)^Qn(c,13)^Qn(c,22),y=c&h^c&d^h&d,C=M+y>>>0;g=b,b=_,_=p,p=f+v>>>0,f=d,d=h,h=c,c=v+C>>>0}r[0]=r[0]+c>>>0,r[1]=r[1]+h>>>0,r[2]=r[2]+d>>>0,r[3]=r[3]+f>>>0,r[4]=r[4]+p>>>0,r[5]=r[5]+_>>>0,r[6]=r[6]+b>>>0,r[7]=r[7]+g>>>0}let a=new Uint8Array(32),o=new DataView(a.buffer);for(let l=0;l<8;l++)o.setUint32(l*4,r[l]);return a}function _l(i){if(i===null)return"null";if(typeof i=="number"){if(!Number.isFinite(i))throw new Error("canonicalJson: non-finite number");return JSON.stringify(i)}if(typeof i=="string"||typeof i=="boolean")return JSON.stringify(i);if(Array.isArray(i))return"["+i.map(_l).join(",")+"]";if(typeof i=="object"){let t=i;return"{"+Object.keys(t).sort().map(e=>{if(t[e]===void 0)throw new Error(`canonicalJson: undefined at ${e}`);return JSON.stringify(e)+":"+_l(t[e])}).join(",")+"}"}throw new Error(`canonicalJson: unsupported ${typeof i}`)}function tr(i){let t=typeof i=="string"?new TextEncoder().encode(i):i;return Array.from(Jd(t),e=>e.toString(16).padStart(2,"0")).join("")}var Zx=["04","05","06","07","09","11","13","20"].map(i=>`cb-p-chip-${i}`),Jx={whole:{add:[],state:"cb-s01-whole-series"},slice:{add:[],state:"cb-s02-sliced"},gut:{add:[],state:"cb-s03-gutted-series"},aioli:{add:["cb-p-aioli"],state:"cb-s04-aioli"},chips:{add:Zx,state:"cb-s05-chips"},provolone:{add:["cb-p-provolone"],state:"cb-s06-provolone"},turkey:{add:["cb-p-turkey"],state:"cb-s07-turkey"},onions:{add:["cb-p-onion"],state:null},pickles:{add:Array.from({length:7},(i,t)=>`cb-p-pickle-0${t+1}`),state:"cb-s09-onions"},shredduce:{add:["cb-p-shredduce"],state:"cb-s10-shredduce"},"oil-vinegar":{add:[],state:"cb-s11-oil-vinegar"},oregano:{add:["cb-p-oregano"],state:"cb-s12-oregano"}},Kd="cb-f-built-angle",Kx=new Set(["chips","shredduce"]);function xl(i,t,e){let n=Object.entries(Jx).map(([a,o])=>{if(i==="studio-3d")return{key:a,rep:"drawn",add:[],state:null,reason:"studio-3d is drawn"};let l=o.state&&e.has(o.state)?o.state:null;if(t==="c2"&&Kx.has(a))return{key:a,rep:"drawn",add:[],state:l,reason:"C2 drawn accent"};let c=o.add.filter(h=>!e.has(h));return o.add.length>0&&c.length===0?{key:a,rep:"photo",add:o.add,state:l,reason:null}:l?{key:a,rep:"photo",add:[],state:l,reason:null}:{key:a,rep:"drawn",add:[],state:null,reason:`missing photo ${[...c,...o.state?[o.state]:[]].join(", ")}`}}),r=i==="stage-show"&&e.has(Kd)?Kd:null,s=n.filter(a=>a.rep==="drawn").map(a=>a.key);return{look:i,variant:t,steps:n,hero:r,tag:s.length?"drawn":"real-photo",drawnFood:s}}var jd=i=>[...i.beats].sort((t,e)=>t.step-e.step),jx=i=>(i.mode??"show")!=="elide";function vl(i,t){let e=new Set;for(let s of i.beats){if(!Number.isInteger(s.step)||s.step<1||s.step>t)throw new Error(`narrative ${i.id}: bad step ${s.step}`);if(e.has(s.step))throw new Error(`narrative ${i.id}: step ${s.step} twice`);if(e.add(s.step),!(s.t0>=0&&s.dur>=0&&s.t0+s.dur<=i.duration+1e-9))throw new Error(`narrative ${i.id}: step ${s.step} outside [0, ${i.duration}]`)}for(let s=1;s<=t;s++)if(!e.has(s))throw new Error(`narrative ${i.id}: step ${s} missing`);let n=jd(i);for(let s=1;s<n.length;s++)if(n[s].t0<n[s-1].t0-1e-9)throw new Error(`narrative ${i.id}: reorder, step ${n[s].step} starts before step ${n[s-1].step}`);let r=n.filter(jx);for(let s=1;s<r.length;s++){let a=r[s-1],o=r[s];if(Math.abs(a.t0-o.t0)<=1e-9&&o.step!==a.step+1)throw new Error(`narrative ${i.id}: simultaneous reveal of non-adjacent steps ${a.step} and ${o.step}`)}}function yh(i,t){let e=i.beats.find(n=>n.step===t);if(!e)throw new Error(`narrative ${i.id}: no step ${t}`);return e}function Zs(i,t){let e=yh(i,t);return e.t0+e.dur}function ui(i,t){return yh(i,t)}function Qd(i,t){let e=jd(i),n=0;for(let a of e)if(a.t0<=t+1e-9)n=a.step;else break;if(n===0)return{executed:0,current:0,progress:0};let r=e[n-1],s=r.dur<=0||t>=r.t0+r.dur-1e-9?1:Math.max(0,(t-r.t0)/r.dur);return{executed:n,current:n,progress:s}}function tf(i,t,e){let n=yh(i,t);return e<n.t0?0:n.dur<=0||e>=n.t0+n.dur-1e-9?1:(e-n.t0)/n.dur}var ef={id:"crunchy-stage-show-v1",duration:18,beats:[{step:1,t0:.35,dur:.75},{step:2,t0:1.4,dur:.8},{step:3,t0:2.5,dur:.8},{step:4,t0:3.6,dur:1},{step:5,t0:4.65,dur:2.35},{step:6,t0:7.1,dur:1},{step:7,t0:8.4,dur:1},{step:8,t0:9.7,dur:1.4},{step:9,t0:9.7,dur:1.4},{step:10,t0:11.4,dur:1.1},{step:11,t0:12.8,dur:.9},{step:12,t0:14,dur:1}]},yl={id:"crunchy-studio-3d-v1",duration:18,beats:[{step:1,t0:.35,dur:.75},{step:2,t0:1.4,dur:.9},{step:3,t0:2.5,dur:.8},{step:4,t0:3.6,dur:1},{step:5,t0:4.65,dur:2.35},{step:6,t0:7.1,dur:1},{step:7,t0:8.4,dur:1},{step:8,t0:9.7,dur:.8},{step:9,t0:10.6,dur:.9},{step:10,t0:11.8,dur:1.1},{step:11,t0:13.1,dur:.8},{step:12,t0:14.1,dur:1}]},ee=15.4;var bl=null,bh=[];function Mh(i){bl=i}function Sh(){bl=null}function Ml(){let i=bh;return bh=[],i}function rf(i){return i==="photo"||i==="drawn"||i==="graphic"?i:"unlabeled"}function Qx(i){let t=[];for(let e of Object.values(i))if(e&&e.isTexture){let n=e.userData.co??{};t.push({asset_id:n.asset_id??null,cls:rf(n.cls),sha256:n.sha256??null})}return t}var nf=!1;function Eh(){nf||(nf=!0,Ae.prototype.onBeforeRender=function(...i){let t=i[4];if(bl===null||!t||!t.isMaterial)return;let e=t.userData.co??{};bh.push({pass:bl,object:this.name,material:t.name,material_cls:rf(e.cls),part_id:typeof e.part_id=="number"?e.part_id:null,textures:Qx(t),color_write:t.colorWrite})})}function Sl(i){i.traverse(t=>{if(Object.prototype.hasOwnProperty.call(t,"onBeforeRender"))throw new Error(`drawlog: ${t.name} overrides onBeforeRender`)})}function wh(i,t,e){let n=i*t;for(let l of e){if(!Number.isInteger(l.part_id)||l.part_id<1||l.part_id>65534)throw new Error(`ids: bad part_id ${l.part_id}`);if(l.coverage.length!==n)throw new Error(`ids: coverage length ${l.coverage.length} != ${n}`)}let r=new Uint16Array(n*4),s=new Uint16Array(n*4),a=0,o=[];for(let l=0;l<n;l++){o.length=0;for(let h of e)h.coverage[l]>0&&o.push({part_id:h.part_id,coverage:h.coverage[l]});o.sort((h,d)=>d.coverage-h.coverage||h.part_id-d.part_id);let c=o;o.length>4&&(c=[...o.slice(0,3),{part_id:65535,coverage:0}],a++);for(let h=0;h<c.length;h++){let d=h<2?r:s,f=l*4+h%2*2;d[f]=c[h].part_id,d[f+1]=c[h].coverage}}return{a:r,b:s,overflow_pixels:a}}function tv(i){let t=i.filter(r=>r.alpha>0).sort((r,s)=>r.depth-s.depth||r.part_id-s.part_id),e=[],n=1;for(let r of t){if(n<=0)break;e.push({part_id:r.part_id,cls:r.cls,coverage:r.alpha*n,rgb:[r.rgb[0]*n,r.rgb[1]*n,r.rgb[2]*n]}),n*=1-r.alpha}return e}var sf=i=>Math.min(255,Math.max(0,Math.round(i*255)));function Th(i,t,e){let n=i*t,r=e.map(l=>({part_id:l.part_id,coverage:new Uint16Array(n)})),s=new Map(e.map((l,c)=>[l.part_id,c])),a=new Uint8Array(n*4),o=new Uint8Array(n*4);for(let l=0;l<n;l++){let c=e.map(d=>({part_id:d.part_id,cls:d.cls,alpha:d.color[l*4+3]/255,depth:d.depth[l],rgb:[d.color[l*4]/255,d.color[l*4+1]/255,d.color[l*4+2]/255]})),h={photo:[0,0,0,0],drawn:[0,0,0,0]};for(let d of tv(c)){r[s.get(d.part_id)].coverage[l]=Math.round(d.coverage*65535);let f=h[d.cls];f[0]+=d.rgb[0],f[1]+=d.rgb[1],f[2]+=d.rgb[2],f[3]+=d.coverage}for(let d=0;d<4;d++)a[l*4+d]=sf(h.photo[d]),o[l*4+d]=sf(h.drawn[d])}return{layers:r,photo:a,drawn:o}}function af(i){let t="";for(let e=0;e<i.length;e+=32768)t+=String.fromCharCode(...i.subarray(e,e+32768));return btoa(t)}function ev(i,t){if(i===8)return new Uint8Array(t.buffer,t.byteOffset,t.byteLength);let e=t,n=new Uint8Array(e.length*2);for(let r=0;r<e.length;r++)n[r*2]=e[r]&255,n[r*2+1]=e[r]>>>8;return n}function nv(i){return tr(_l({pass:i.pass,run_id:i.run_id,frame:i.frame,t:i.t,pixel_sha256:i.pixel_sha256}))}function Js(i,t,e,n,r,s,a,o){let l=ev(a,o),c=tr(l);return{pass:i,run_id:t,frame:e,t:n,width:r,height:s,depth:a,pixel_sha256:c,bind_sha256:nv({pass:i,run_id:t,frame:e,t:n,pixel_sha256:c}),b64:af(l)}}function Ah(i,t,e){let n=e==="r-msb"?[0,1,2,3]:[3,2,1,0];return i[t*4+n[0]]/256+i[t*4+n[1]]/65536+i[t*4+n[2]]/16777216+i[t*4+n[3]]/4294967296}function Ks(i,t,e){Eh();let{w:n,h:r}=e,s=new Ge(n,r,{type:Ve,format:Xe,depthBuffer:!0,stencilBuffer:!0,samples:0,minFilter:Ee,magFilter:Ee,generateMipmaps:!1}),a=()=>{let b=new Uint8Array(n*r*4);return i.readRenderTargetPixels(s,0,0,n,r,b),Vr(b,n,r)},o=new Ge(n,r,{type:un,format:Xe,depthBuffer:!0,stencilBuffer:!0,samples:0,minFilter:Ee,magFilter:Ee,generateMipmaps:!1}),l=()=>{let b=new Float32Array(n*r*4);i.readRenderTargetPixels(o,0,0,n,r,b);let g=new Uint8Array(b.length);for(let m=0;m<b.length;m++)g[m]=Math.round(Math.min(1,Math.max(0,b[m]))*255);return Vr(g,n,r)},c=(()=>{let b=new Fn,g=new Rn(-1,1,1,-1,.1,100);g.position.z=50;let m=new wi({depthPacking:Ns}),E={"r-msb":[],"a-msb":[]};for(let M of[10,0,-20]){let y=new Vt(new fe(4,4),m);y.position.z=M,b.add(y),i.setRenderTarget(s),i.setClearColor(16777215,1),i.clear(!0,!0,!0),i.render(b,g);let C=a(),x=(r>>1)*n+(n>>1);for(let w of["r-msb","a-msb"])E[w].push(Ah(C,x,w));b.remove(y)}i.setRenderTarget(null);let T=M=>(50-M-.1)/(100-.1),v=["r-msb","a-msb"].filter(M=>[10,0,-20].every((y,C)=>Math.abs(E[M][C]-T(y))<.01));if(v.length!==1)throw new Error(`crunchy: depth calibration failed ${JSON.stringify(E)}`);return v[0]})(),h=t.camera;function d(b,g,m=!1){let E=m?t.hud.camera:h;E.layers.disableAll();for(let T of g)E.layers.enable(T);i.setRenderTarget(b),i.render(m?t.hud.scene:t.scene,E)}function f(){t.shadows&&(i.shadowMap.autoUpdate=!1,i.shadowMap.needsUpdate=!0,h.layers.set(Jt.lightsOnly),i.setRenderTarget(null),i.render(t.scene,h))}function p(b){let g=i.getDrawingBufferSize(new Ut);t.viewport?.(g.y),t.pose(b),xh(t.registry),f(),i.autoClear=!1,i.setRenderTarget(null),i.setClearColor(t.background,1),i.clear(!0,!0,!0),d(null,[Jt.stage]),d(null,[Jt["fx-back"]]),d(null,[Jt.photo,Jt.drawn]),d(null,[Jt["fx-front"]]),d(null,[Jt.ui],!0)}function _(b,g,m){Sl(t.scene),Sl(t.hud.scene),t.viewport?.(r),t.pose(b),xh(t.registry),f(),Ml(),i.autoClear=!1;let E=[],T=(I,N)=>E.push(Js(I,m,g,b,n,r,8,N)),v=(I,N)=>{Mh(I);try{N()}finally{Sh()}},M=(I=s)=>{i.setRenderTarget(I),i.setClearColor(0,0),i.clear(!0,!0,!0)},y=(I=s)=>{i.setRenderTarget(I),i.setClearColor(0,0),i.clear(!0,!1,!1)};M(o),v("stage",()=>d(o,[Jt.stage])),T("stage",l()),M(o),v("fx-back",()=>d(o,[Jt["fx-back"]])),T("fx-back",l()),M(o),v("food",()=>d(o,[Jt.photo,Jt.drawn])),T("food",l()),y(o),v("fx-front",()=>d(o,[Jt["fx-front"]])),T("fx-front",l()),y(o),v("ui",()=>d(o,[Jt.ui],!0)),T("ui",l());let C=[];for(let I of t.registry.parts){let N=I.objects.filter(L=>L.visible&&iv(L));if(N.length===0)continue;let R=I.cls==="photo"?"food-photo":"food-drawn",G=N.map(L=>L.material);for(let L of N)L.layers.enable(Jt.isolate);try{M(),v(R,()=>d(s,[Jt.isolate]));let L=a();for(let X of N)X.material=I.depthMat;i.setRenderTarget(s),i.setClearColor(16777215,1),i.clear(!0,!0,!0),v(R,()=>d(s,[Jt.isolate]));let O=a(),$=new Float32Array(n*r);for(let X=0;X<$.length;X++)$[X]=Ah(O,X,c);C.push({part_id:I.part_id,cls:I.cls,color:L,depth:$})}finally{N.forEach((L,O)=>{L.material=G[O],L.layers.disable(Jt.isolate)})}}i.setRenderTarget(null);let x=Th(n,r,C);T("food-photo",x.photo),T("food-drawn",x.drawn);let w=wh(n,r,x.layers);return E.push(Js("ids-a",m,g,b,n,r,16,w.a)),E.push(Js("ids-b",m,g,b,n,r,16,w.b)),{run_id:m,frame:g,t:b,passes:E,draws:Ml(),ids_overflow_pixels:w.overflow_pixels}}return{renderBeauty:p,renderLayers:_,depthOrder:c}}function iv(i){for(let t=i;t;t=t.parent)if(!t.visible)return!1;return!0}var Ce={w:540,h:960},Ni='system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',yn={red:"#FF3A44",ink:"#141414",cream:"#FFF9E4",gold:"#FFE560"},of={pillBg:yn.cream,pillFg:yn.ink,accent:yn.red,kicker:yn.gold,rail:"rgba(255,249,228,0.22)",railOn:yn.gold},lf={pillBg:"rgba(20,20,20,0.82)",pillFg:yn.cream,accent:yn.red,kicker:"#e9dcc0",rail:"rgba(255,249,228,0.18)",railOn:yn.red};function El(i,t,e,n){let r=new Fn,s=new Rn(-Ce.w/2,Ce.w/2,Ce.h/2,-Ce.h/2,-10,10),a=2,o=(R,G,L,O,$)=>{let X=ji(Qi(Math.ceil(R*a),Math.ceil(G*a),K=>{K.scale(a,a),O(K)}),L),rt=Ye(new rn({map:X,transparent:!0,depthTest:!1,depthWrite:!1,toneMapped:!1}),L,!0),q=new Vt(new fe(R,G),rt);return q.name=L,q.renderOrder=$,q.frustumCulled=!1,q.layers.set(Jt.ui),r.add(q),{mesh:q,w:R,h:G,mat:rt}},l=(R,G)=>{let L=document.createElement("canvas").getContext("2d");return L.font=R,L.measureText(G).width},c=`700 20px ${Ni}`,h=Math.ceil(l(c,"Compliments Only"))+32,d=o(h,34,"hud-wordmark",R=>{R.font=c,R.fillStyle=yn.cream,R.textBaseline="middle",R.fillText("Compliments Only",24,17),R.fillStyle=yn.red,R.beginPath(),R.arc(9,17,5,0,Math.PI*2),R.fill()},5),f=`800 44px ${Ni}`,p=Math.ceil(l(f,"Compliments Only"))+16,_=o(p,64,"hud-hero-wordmark",R=>{R.font=f,R.fillStyle=yn.cream,R.textBaseline="middle",R.shadowColor="rgba(0,0,0,.55)",R.shadowBlur=14,R.fillText("Compliments Only",8,33)},6),b=`800 30px ${Ni}`,g=Math.ceil(l(b,"The Crunchy Boi"))+16,m=o(g,44,"hud-hero-name",R=>{R.font=b,R.fillStyle=yn.gold,R.textBaseline="middle",R.shadowColor="rgba(0,0,0,.55)",R.shadowBlur=12,R.fillText("The Crunchy Boi",8,23)},6),E=`800 30px ${Ni}`,T=`700 13px ${Ni}`,v=i.map(R=>{let G=`STEP ${R.n} \xB7 ${R.action.toUpperCase()}`,L=R.name??R.label,O=R.amount,$=l(E,L),X=O?l(`600 26px ${Ni}`,` \xB7 ${O}`):0,rt=Math.ceil(Math.max($+X,l(T,G)*1.05)+56),q=86;return o(rt+20,q+20,`hud-step-${R.key}`,K=>{K.shadowColor="rgba(0,0,0,.45)",K.shadowBlur=16,K.shadowOffsetY=5,K.fillStyle=e.pillBg,K.beginPath(),K.roundRect(10,8,rt,q,26),K.fill(),K.shadowColor="transparent",K.fillStyle=e.accent,K.font=T,K.textBaseline="middle",K.fillText(G,38,34),K.fillStyle=e.pillFg,K.font=E,K.fillText(L,38,66),O&&(K.font=`600 26px ${Ni}`,K.fillStyle=e.accent,K.fillText(` \xB7 ${O}`,38+$,67))},8)}),M=`800 34px ${Ni}`,y=Array.from({length:25},(R,G)=>o(90,56,`hud-tally-${G}`,L=>{L.fillStyle=e.accent,L.beginPath(),L.roundRect(4,4,82,48,24),L.fill(),L.font=M,L.fillStyle=yn.cream,L.textAlign="center",L.textBaseline="middle",L.fillText(`\xD7${G}`,45,30)},9)),C=360,x=C/i.length,w=i.map((R,G)=>{let L=o(x-6,6,`hud-rail-on-${G}`,X=>{X.fillStyle=e.railOn,X.beginPath(),X.roundRect(0,0,x-6,6,3),X.fill()},7),O=o(x-6,6,`hud-rail-off-${G}`,X=>{X.fillStyle=e.rail,X.beginPath(),X.roundRect(0,0,x-6,6,3),X.fill()},7),$=-C/2+x*G+x/2;return L.mesh.position.set($,-300,0),O.mesh.position.set($,-300,0),{on:L,off:O}}),I=(R,G,L,O,$=1)=>{R.mesh.visible=O>.001,R.mesh.position.set(G,L,0),R.mesh.scale.setScalar($),R.mat.opacity=O};function N(R,G){let L=be(n,n+.5,R),O=jn(ge(.1,.6,R));I(d,0,440+10*(1-O),O*.92*(1-L));let{executed:$}=Qd(t,R);w.forEach(({on:q,off:K},st)=>{let ot=st<$,Q=O*(1-L);I(q,q.mesh.position.x,-300,ot?Q:0),I(K,K.mesh.position.x,-300,ot?0:Q*.9)}),v.forEach((q,K)=>{let st=ui(t,K+1),ot=i.map((Lt,Kt)=>ui(t,Kt+1)).filter(Lt=>Math.abs(Lt.t0-st.t0)<1e-9).map(Lt=>Lt.step).sort((Lt,Kt)=>Lt-Kt),Q=ot.indexOf(K+1),_t=i.map((Lt,Kt)=>ui(t,Kt+1).t0).filter(Lt=>Lt>st.t0+1e-9),gt=_t.length?Math.min(..._t):n,Mt=(st.mode??"show")!=="elide",W=Ui(ge(st.t0+Q*.12,st.t0+Q*.12+.28,R)),Y=be(gt-.05,gt+.15,R),ft=Mt&&R>=st.t0?qe(W*1.3)*(1-Y):0,Ct=ot.length>1?.78:1,pt=ot.length>1?-352-Q*80:-372;I(q,0,pt-24*(1-W)+30*Y,ft,Ct)}),y.forEach(q=>{q.mesh.visible=!1});let X=$>0?v[$-1]:null,rt=$>0?G($,R):null;if(X&&rt!==null&&rt>0&&X.mat.opacity>.01){let q=y[Math.min(rt,y.length-1)];I(q,X.w/2+28,-372,X.mat.opacity,1)}I(_,0,-372-16*(1-jn(ge(n+.3,n+.8,R))),be(n+.3,n+.6,R)),I(m,0,-318,be(n+.55,n+.9,R))}return{scene:r,camera:s,pose:N}}function di(i){let t=i>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}var pn=[1,229/255,96/255],Cn=[1,249/255,228/255],Tl=[1,58/255,68/255],er=class{list=[];mat=null;points=null;add(t){this.list.push({life:.6,vel:[0,0,0],drag:2,grav:0,size:.2,type:0,col:pn,spin:0,...t})}puff(t,e,n,r,s,a,o,l=3,c=Cn){for(let h=0;h<o;h++){let d=t()*6.28;this.add({t:e+t()*.03,life:.45+t()*.25,pos:[n+Math.cos(d)*a,r,s+Math.sin(d)*a*1.4],vel:[Math.cos(d)*(1.6+t()*2),.3+t()*.6,Math.sin(d)*(1.6+t()*2)],drag:4,size:.11+t()*.08,type:2,col:t()<.5?c:pn})}for(let h=0;h<l;h++){let d=t()*6.28;this.add({t:e+t()*.05,life:.4+t()*.3,pos:[n+Math.cos(d)*a*.8,r+.15,s+Math.sin(d)*a*1.2],vel:[Math.cos(d)*1.2,1.4+t(),Math.sin(d)*1.2],drag:2.5,grav:-1.5,size:.3+t()*.25,type:0,spin:(t()-.5)*4})}}build(t,e,n,r,s){let a=this.list.length,o=new Float32Array(a*3),l=new Float32Array(a*3),c=new Float32Array(a*4),h=new Float32Array(a*4),d=new Float32Array(a*3);this.list.forEach((b,g)=>{o.set(b.pos,g*3),l.set(b.vel,g*3),d.set(b.col,g*3),c.set([b.t,b.life,b.size,b.type],g*4),h.set([b.drag,b.grav,b.spin,0],g*4)});let f=new we;f.setAttribute("position",new De(o,3)),f.setAttribute("vel",new De(l,3)),f.setAttribute("meta",new De(c,4)),f.setAttribute("phys",new De(h,4)),f.setAttribute("pcol",new De(d,3));let p=new Re({uniforms:{uTime:{value:0},uPx:{value:r()},uOrtho:{value:s?1:0}},vertexShader:`
      attribute vec3 vel; attribute vec4 meta; attribute vec4 phys; attribute vec3 pcol;
      uniform float uTime, uPx, uOrtho; varying vec3 vCol; varying float vA, vType, vRot;
      void main(){
        float age = uTime - meta.x, life = meta.y;
        if (age < 0.0 || age > life) { gl_Position = vec4(3.0,3.0,3.0,1.0); gl_PointSize = 0.0; return; }
        float k = age / life; float dr = phys.x;
        vec3 d = dr > 0.0 ? vel * (1.0 - exp(-dr*age)) / dr : vel * age;
        vec3 p = position + d + vec3(0.0, 0.5*phys.y*age*age, 0.0);
        float ty = meta.w;
        if (ty > 2.5) { p += vec3(sin(uTime*0.7 + position.x*3.0), 0.0, cos(uTime*0.6 + position.y*2.0))*0.12; }
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float env = ty > 2.5 ? 1.0 : smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.55, 1.0, k));
        if (ty < 0.5) env *= 0.75 + 0.25*sin(age*38.0 + meta.x*91.0);
        float persp = uOrtho > 0.5 ? 1.0 : 1.0 / -mv.z;
        gl_PointSize = meta.z * uPx * persp * (ty < 0.5 ? (0.6 + 0.6*(1.0-k)) : 1.0);
        vCol = pcol; vA = env; vType = ty; vRot = phys.z * age + meta.x * 13.0;
      }`,fragmentShader:`
      varying vec3 vCol; varying float vA, vType, vRot;
      void main(){
        vec2 p = gl_PointCoord*2.0 - 1.0; float c = cos(vRot), s = sin(vRot); vec2 q = mat2(c,-s,s,c)*p;
        float a = 0.0;
        if (vType < 0.5) { float r = length(q); float st = 0.018/(abs(q.x*q.y)+0.018); st *= smoothstep(1.0, 0.0, r); a = st*0.9 + exp(-r*r*14.0)*1.2; }
        else if (vType < 1.5) { float d = abs(q.x) + abs(q.y)*2.2; float core = smoothstep(0.55, 0.0, d); a = core*1.4 + exp(-dot(q,q)*5.0)*0.45; }
        else if (vType < 2.5) { float r = length(p); a = exp(-r*r*4.5)*smoothstep(1.0, 0.7, r)*0.6; }
        else { float r = length(p); a = exp(-r*r*6.0)*0.35; }
        a *= vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol * a, a);
      }`,transparent:!0,depthWrite:!1,depthTest:!1});Al(p),Ye(p,t,n);let _=new fs(f,p);return _.name=t,_.frustumCulled=!1,_.renderOrder=200,_.layers.set(e),this.mat=p,this.points=_,_}pose(t,e){this.mat&&(this.mat.uniforms.uTime.value=t,this.mat.uniforms.uPx.value=e)}},wl=class{constructor(t){this.parent=t}parent;rings=[];add(t,e,n,r,s,a,o,l=.05,c=1){let h=Ye(new Re({uniforms:{uR:{value:0},uW:{value:l},uA:{value:0},uCol:{value:new U(...o)}},vertexShader:"varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",fragmentShader:`uniform float uR, uW, uA; uniform vec3 uCol; varying vec2 vUv;
      void main(){ float d = length(vUv-0.5)*2.0; float band = exp(-pow((d-uR)/uW, 2.0)); float inner = smoothstep(uR, 0.0, d)*0.12*uR;
        float a = (band+inner)*uA; if (a < 0.003) discard; gl_FragColor = vec4(uCol*a, a); }`,transparent:!0,depthWrite:!1,depthTest:!1}),`ring-${this.rings.length}`,!1);Al(h);let d=new Vt(new fe(1,1).rotateX(-Math.PI/2),h);d.name=h.name,d.position.set(e,n,r),d.scale.setScalar(s),d.frustumCulled=!1,d.visible=!1,d.layers.set(Jt["fx-back"]),d.renderOrder=3,this.parent.add(d),this.rings.push({m:d,mat:h,t,dur:a,a:c,w:l})}pose(t){for(let e of this.rings){let n=t>=e.t&&t<=e.t+e.dur;if(e.m.visible=n,!n)continue;let r=ge(e.t,e.t+e.dur,t),s=e.mat.uniforms;s.uR.value=Se(.04,.96,jn(r)),s.uA.value=e.a*(1-r)*(1-r)*be(0,.08,r),s.uW.value=e.w*(1+r)}}};function Al(i){i.blending=Dr,i.blendSrc=ci,i.blendDst=ci,i.blendSrcAlpha=ci,i.blendDstAlpha=Pi}function Fi(i){return di(i)}var js=class extends we{constructor(t=(r,s,a)=>a.set(r,s,Math.cos(r)*Math.sin(s)),e=8,n=8){super(),this.type="ParametricGeometry",this.parameters={func:t,slices:e,stacks:n};let r=[],s=[],a=[],o=[],l=1e-5,c=new U,h=new U,d=new U,f=new U,p=new U,_=e+1;for(let b=0;b<=n;b++){let g=b/n;for(let m=0;m<=e;m++){let E=m/e;t(E,g,h),s.push(h.x,h.y,h.z),E-l>=0?(t(E-l,g,d),f.subVectors(h,d)):(t(E+l,g,d),f.subVectors(d,h)),g-l>=0?(t(E,g-l,d),p.subVectors(h,d)):(t(E,g+l,d),p.subVectors(d,h)),c.crossVectors(f,p).normalize(),a.push(c.x,c.y,c.z),o.push(E,g)}}for(let b=0;b<n;b++)for(let g=0;g<e;g++){let m=b*_+g,E=b*_+g+1,T=(b+1)*_+g+1,v=(b+1)*_+g;r.push(m,E,v),r.push(E,T,v)}this.setIndex(r),this.setAttribute("position",new re(s,3)),this.setAttribute("normal",new re(a,3)),this.setAttribute("uv",new re(o,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}};var Cl=1,Mn=3.2,rv=.3,sv=.38,nr=.58,av=.06,ln=Cl/2+av;function qr(i,t,e=0){return new U(i*2*ln*.96,e,t*(Mn/2)*.92)}function Rl(i,t,e){let n=Math.imul(i|0,374761393)+Math.imul(t|0,668265263)+Math.imul(e|0,1442695041)|0;return n=Math.imul(n^n>>>13,1274126177),n^=n>>>16,(n>>>0)/4294967296}function ov(i,t,e=0){let n=Math.floor(i),r=Math.floor(t),s=i-n,a=t-r,o=s*s*(3-2*s),l=a*a*(3-2*a),c=Rl(n,r,e),h=Rl(n+1,r,e),d=Rl(n,r+1,e),f=Rl(n+1,r+1,e);return c+(h-c)*o+(d-c)*l+(c-h-d+f)*o*l}function $e(i,t,e=0,n=4){let r=0,s=.5,a=1,o=0;for(let l=0;l<n;l++)r+=s*ov(i*a,t*a,e+l*17),o+=s,a*=2.03,s*=.5;return r/o}var bn=(i,t,e)=>{let n=qe((e-i)/(t-i));return n*n*(3-2*n)},ir=(i,t)=>Math.sign(i)*Math.pow(Math.abs(i),t),_e=i=>{let t=parseInt(i.slice(1),16);return[t>>16&255,t>>8&255,t&255]};function Oe(i,t,e,n){for(let r=0;r<3;r++)n[r]=i[r]+(t[r]-i[r])*e;return n}function Xr(i,t,e,n){let r=document.createElement("canvas");r.width=t,r.height=e;let s=document.createElement("canvas");s.width=t,s.height=e;let a=r.getContext("2d").createImageData(t,e),o=s.getContext("2d").createImageData(t,e),l=[0,0,0];for(let d=0;d<e;d++)for(let f=0;f<t;f++){let p=n(f/t,d/e,l),_=(d*t+f)*4;a.data[_]=l[0],a.data[_+1]=l[1],a.data[_+2]=l[2],a.data[_+3]=255;let b=qe(p)*255;o.data[_]=o.data[_+1]=o.data[_+2]=b,o.data[_+3]=255}r.getContext("2d").putImageData(a,0,0),s.getContext("2d").putImageData(o,0,0);let c=vh(new Si(r),`drawn:${i}`);c.colorSpace=ke,c.anisotropy=4;let h=vh(new Si(s),`drawn:${i}-bump`);return h.colorSpace=sn,{map:c,bump:h}}function cf(i,t){i.computeVertexNormals();let e=i.attributes.position,n=i.attributes.normal,r=0;for(let s=0;s<e.count;s++)r+=(e.getX(s)-t.x)*n.getX(s)+(e.getY(s)-t.y)*n.getY(s)+(e.getZ(s)-t.z)*n.getZ(s);if(r<0&&i.index){let s=i.index.array;for(let a=0;a<s.length;a+=3){let o=s[a+1];s[a+1]=s[a+2],s[a+2]=o}i.index.needsUpdate=!0,i.computeVertexNormals()}return i}function Pl({rings:i=10,segs:t=48,R:e=.5,radius:n,disp:r,thick:s}){let a=[],o=[],l=[],c=(M,y,C)=>(a.push(M,y,C),o.push(M/(2*e)+.5,C/(2*e)+.5),a.length/3-1),h=[];for(let M of[1,-1]){let y=c(0,r(0,0)+M*s(0,0,0)/2,0),C=[];for(let x=1;x<=i;x++){let w=x/i,I=[];for(let N=0;N<t;N++){let R=N/t*Math.PI*2,G=w*n(R),L=G*Math.cos(R),O=G*Math.sin(R);I.push(c(L,r(L,O)+M*s(L,O,w)/2,O))}C.push(I)}h.push({c:y,rows:C,sgn:M})}let d=new U,f=new U,p=new U,_=new U,b=(M,y)=>y.set(a[M*3],a[M*3+1],a[M*3+2]),g=(M,y,C,x)=>{b(M,d),b(y,f),b(C,p),_.subVectors(f,d).cross(p.clone().sub(d)),x(_,d)<0?l.push(M,C,y):l.push(M,y,C)};for(let{c:M,rows:y,sgn:C}of h){let x=w=>w.y*C;for(let w=0;w<t;w++){let I=(w+1)%t;g(M,y[0][w],y[0][I],x);for(let N=0;N<i-1;N++){let R=y[N][w],G=y[N][I],L=y[N+1][w],O=y[N+1][I];g(R,L,O,x),g(R,O,G,x)}}}let m=h[0].rows[i-1],E=h[1].rows[i-1],T=(M,y)=>M.x*y.x+M.z*y.z;for(let M=0;M<t;M++){let y=(M+1)%t;g(m[M],E[M],E[y],T),g(m[M],E[y],m[y],T)}let v=new we;return v.setAttribute("position",new re(a,3)),v.setAttribute("uv",new re(o,2)),v.setIndex(l),v.computeVertexNormals(),v}function hf(){let i=T=>Xr(T?"crust-top":"crust-bottom",512,256,(v,M,y)=>{let C=Math.sin(M*Math.PI),x=$e(v*38,M*11,T?31:32,5),w=$e(v*150,M*44,33,3);T?(Oe(_e("#e8c88f"),_e("#bd7832"),bn(.05,.75,C),y),Oe(y,_e("#9a5a22"),bn(.45,.8,x)*bn(.3,1,C)*.7,y)):(Oe(_e("#e6c68e"),_e("#caa062"),bn(.2,1,C),y),Oe(y,_e("#b98446"),bn(.6,.9,x)*.45,y));let I=.92+.16*x;return y[0]*=I,y[1]*=I,y[2]*=I,w>.8&&Oe(y,_e("#f0dcb4"),(w-.8)*1.4,y),.55*x+.45*w}),t=Xr("crumb",256,768,(T,v,M)=>{let y=$e(T*70,v*55,41,4),C=$e(T*6,v*14,42,4);Oe(_e("#dccba4"),_e("#efe2c4"),y*.7+C*.3,M);let x=Math.pow(Math.pow(Math.abs((T-.5)*2),2/nr)+Math.pow(Math.abs((v-.5)*2),2/nr),nr/2);return Oe(M,_e("#e3c793"),bn(.8,.95,x)*.7,M),Oe(M,_e("#c28a45"),bn(.955,.985,x),M),.55+(y-.5)*.6}),e=(T,v)=>fn(new An({map:T.map,bumpMap:T.bump,bumpScale:1.2,roughness:.6}),v),n=fn(new An({map:t.map,bumpMap:t.bump,bumpScale:2,roughness:.93,side:Ue}),"drawn-crumb"),r=i(!0),s=i(!1),a=T=>{let v=T?sv:rv,M=T?.62:.42,y=new js((w,I,N)=>{let R=w*Math.PI*2-Math.PI,G=I*Math.PI/2,L=Math.cos(G),O=Math.sin(G),$=Cl/2*ir(L,M)*ir(Math.cos(R),nr),X=Mn/2*ir(L,M)*ir(Math.sin(R),nr),rt=v*ir(O,M),q=1+($e($*3+5,X*3,T?5:6,2)-.5)*.08*O;$*=q,X*=q,rt*=q*(T?1+.035*Math.sin(X*5.2+.4)*O*O:1),N.set($,T?rt:-rt,X)},96,20),C=y.attributes.position,x=y.attributes.uv;for(let w=0;w<C.count;w++)x.setXY(w,C.getZ(w)/Mn+.5,qe(Math.abs(Math.atan2(C.getY(w),C.getX(w)))/Math.PI));return cf(y,new U(0,T?v*.3:-v*.3,0))},o=(T,v)=>{let M=new js((x,w,I)=>{let N=x*Math.PI*2-Math.PI,R=w,G=R*(Cl/2)*.985*ir(Math.cos(N),nr),L=R*(Mn/2)*.985*ir(Math.sin(N),nr),O=-.004-T*(1-Math.pow(R,4))+($e(G*9,L*9,8,2)-.5)*.012*(1-R);v&&(O-=.17*Math.exp(-Math.pow(G/.22,4))*bn(.97,.7,Math.abs(L)/(Mn/2))*(.85+.3*$e(L*4,1,9,2))),I.set(G,O,L)},72,18),y=M.attributes.position,C=M.attributes.uv;for(let x=0;x<y.count;x++)C.setXY(x,y.getX(x)/Cl+.5,y.getZ(x)/Mn+.5);return cf(M,new U(0,-1,0))},l=new He,c=new He;c.position.x=ln,l.add(c);let h=new Vt(a(!1),e(s,"drawn-crust-bottom")),d=new Vt(o(.03,!1),n);c.add(h,d);let f=new He;l.add(f);let p=new He;p.position.x=-ln,f.add(p);let _=new Vt(a(!0),e(r,"drawn-crust-top"));_.rotation.z=Math.PI;let b=new Vt(o(.03,!1),n),g=new Vt(o(.03,!0),n);p.add(_,b,g);let m=new Mi(new vs(.035,0),fn(new An({color:Qe("#e9d6aa"),roughness:.95}),"drawn-crumb-bits"),40);m.instanceMatrix.setUsage(Fr),l.add(m);let E=[h,d,_,b,g,m];for(let T of E)T.castShadow=!0,T.receiveShadow=!0;return{group:l,hinge:f,meshes:E,crumbTopFlat:b,crumbTopGut:g,crumbs:m}}function lv(){return Xr("chip",256,256,(i,t,e)=>{let n=i-.5,r=t-.5,s=Math.sqrt(n*n+r*r)*2,a=$e(i*6,t*6,701,4),o=$e(i*30,t*30,702,3);return Oe(_e("#f3d273"),_e("#e3ad45"),a,e),o>.66&&Oe(e,_e("#b57b2c"),(o-.66)*2.4,e),Oe(e,_e("#d39a3a"),bn(.75,.95,s)*.6,e),.5+(o-.5)*.6+.12*Math.sin((n*.8+r*.6)*90)})}function cv(i){return Array.from({length:i},(t,e)=>{let n=di(710+e),r=n()*Math.PI,s=Math.cos(r),a=Math.sin(r),o=.8+n()*.9,l=-.3-n()*.8,c=n()*6,h=.82+n()*.18;return Pl({R:.26,rings:10,segs:48,radius:d=>(.23+($e(Math.cos(d)*1.8+e*3,Math.sin(d)*1.8,720+e,3)-.5)*.09)*(Math.abs(Math.cos(d))*(1-h)+h),disp:(d,f)=>{let p=d*s+f*a,_=-d*a+f*s;return .012*Math.sin(_*52+c)+o*p*p*.5+l*_*_*.5},thick:(d,f,p)=>.011*(1-.4*Math.pow(p,6))})})}function Il(i){let t=fn(new _n({color:Qe("#f6efd8"),roughness:.2,clearcoat:1,clearcoatRoughness:.08,emissive:Qe("#1c1812"),emissiveIntensity:.5}),"drawn-aioli"),e=[];for(let ot=0;ot<=13;ot++){let Q=Se(-1.3,1.3,ot/13),_t=-ln+(ot%2?1:-1)*.09*(.6+.4*Math.sin(ot*2.3));e.push(new U(_t,-.1,Q))}let n=new Cr(e,!1,"centripetal"),r=260,s=10,a=new bs(n,r,.05,s,!1),o={mesh:new Vt(a,t),curve:n,segs:r,rad:s},l=lv(),c=fn(new _n({map:l.map,bumpMap:l.bump,bumpScale:1.4,roughness:.4,clearcoat:.5,clearcoatRoughness:.3,emissive:Qe("#4a3008"),emissiveIntensity:.35,side:Ue}),"drawn-chips"),h=cv(4),d=i.chips.map(ot=>new Vt(h[ot.i%4],c)),f=Xr("provolone",256,256,(ot,Q,_t)=>{let gt=$e(ot*7,Q*7,81,4);return Oe(_e("#f3e4b6"),_e("#ead38f"),gt*.8,_t),.5+($e(ot*40,Q*40,82,3)-.5)*.3}),p=fn(new _n({map:f.map,bumpMap:f.bump,bumpScale:.6,roughness:.34,clearcoat:.3,emissive:Qe("#40361a"),emissiveIntensity:.25,side:Ue}),"drawn-provolone"),_=[-.62,.62].map((ot,Q)=>{let _t=di(200+Q),gt=_t()*6;return new Vt(Pl({R:.56,rings:10,segs:56,radius:Mt=>.5+.012*Math.sin(Mt*3+gt),disp:(Mt,W)=>-.5*Math.pow(Math.max(0,Math.abs(Mt)-.34),1.2)+.012*Math.sin(W*6+gt),thick:(Mt,W,Y)=>.014*(1-.5*Math.pow(Y,6))}),p)}),b=Xr("turkey",256,256,(ot,Q,_t)=>{let gt=$e(ot*5,Q*5,51,4),Mt=$e(ot*8,Q*8,52,3),W=.5+.5*Math.sin((ot*.9+Q*.35)*90+Mt*16);Oe(_e("#e8cfbb"),_e("#d6b19b"),gt,_t),Oe(_t,_e("#cfa590"),W*.1,_t);let Y=Math.hypot(ot-.5,Q-.5)*2;return Oe(_t,_e("#c39468"),bn(.78,.96,Y)*.6,_t),.5+(W-.5)*.35}),g=fn(new _n({map:b.map,bumpMap:b.bump,bumpScale:1.5,roughness:.45,clearcoat:.3,emissive:Qe("#4a1a10"),emissiveIntensity:.15,side:Ue}),"drawn-turkey"),m=[-.95,0,.95].map((ot,Q)=>{let _t=di(100+Q),gt=_t()*6,Mt=_t()*6;return new Vt(Pl({R:.62,rings:12,segs:60,radius:W=>(.55+($e(Math.cos(W)*1.6+4,Math.sin(W)*1.6+Q,60+Q,3)-.5)*.18)*(1+.12*Math.cos(2*W)),disp:(W,Y)=>-.08*Math.pow(Math.max(0,Math.abs(W)-.34),1.3)+.06*Math.sin(Y*5.5+gt)+.03*Math.sin(W*5+Mt+Y*2)+($e(W*4+9,Y*4,70+Q,3)-.5)*.09,thick:(W,Y,ft)=>.016*(1-.6*Math.pow(ft,5))}),g)}),E=fn(new _n({color:Qe("#efe4ea"),roughness:.14,clearcoat:1,clearcoatRoughness:.05,emissive:Qe("#2a2030"),emissiveIntensity:.4}),"drawn-onions"),T=[],v=[[-1.05,.08],[-.38,-.12],[.3,.1],[.98,-.06]].map(([ot,Q],_t)=>{let gt=new He,Mt=di(400+_t);return[.15,.115,.082].forEach((W,Y)=>{let ft=new ys(W,.012-Y*.0015,8,40);ft.rotateX(Math.PI/2),ft.scale(1+(Mt()-.5)*.18,.5,1+(Mt()-.5)*.18);let Ct=new Vt(ft,E);Ct.position.set((Mt()-.5)*.03,.004*Y,(Mt()-.5)*.03),gt.add(Ct),T.push(Ct)}),gt.userData={zc:ot,xc:Q,yaw:Mt()*6},gt}),M=Xr("pickle",256,256,(ot,Q,_t)=>{let gt=ot-.5,Mt=Q-.5,W=Math.sqrt(gt*gt+Mt*Mt)*2,Y=Math.atan2(Mt,gt),ft=$e(ot*10,Q*10,91,4);Oe(_e("#dcd276"),_e("#aeaa3e"),bn(.1,.8,W)*.8+ft*.25,_t);let Ct=.42+.05*Math.sin(Y*3),pt=(Y/(Math.PI*2)*11%1+1)%1,Lt=Math.exp(-Math.pow((pt-.5)*5,2))*Math.exp(-Math.pow((W-Ct)*16,2));return Oe(_t,_e("#f1ebbd"),Lt*.85,_t),Oe(_t,_e("#6f7c26"),bn(.8,.9,W),_t),Oe(_t,_e("#3c4a12"),bn(.9,.96,W),_t),.5+Lt*.3}),y=fn(new _n({map:M.map,bumpMap:M.bump,roughness:.22,clearcoat:1,clearcoatRoughness:.06,emissive:Qe("#2a3006"),emissiveIntensity:.4}),"drawn-pickles"),C=[0,1].map(ot=>{let Q=di(500+ot),_t=Q()*6;return Pl({R:.15,rings:7,segs:44,radius:gt=>.135+.008*Math.sin(gt*2+_t),disp:gt=>.007*Math.sin(gt*78),thick:(gt,Mt,W)=>.032*(1-.35*Math.pow(W,6))})}),x=i.pickles.map(ot=>new Vt(C[ot.i%2],y)),w=fn(new _n({roughness:.35,clearcoat:.6,clearcoatRoughness:.2,emissive:Qe("#1c2a08"),emissiveIntensity:.12,side:Ue}),"drawn-shredduce"),I=5,N=Math.ceil(i.strands.length/I),R=["#f4f6de","#e8f0c0","#d9e8a2","#c8de86","#b3d06a","#98bf50"].map(ot=>Qe(ot)),G=Array.from({length:I},(ot,Q)=>{let _t=di(310+Q),gt=.3+_t()*.14,Mt=.026+_t()*.01,W=new fe(Mt,gt,2,12);W.rotateX(-Math.PI/2);let Y=W.attributes.position,ft=.015+_t()*.02,Ct=7+_t()*8,pt=_t()*6,Lt=(_t()-.5)*3,Kt=(_t()-.5)*.35;for(let dt=0;dt<Y.count;dt++){let wt=Y.getX(dt),Ot=Y.getZ(dt),zt=Ot/gt,ne=Lt*zt;Y.setXYZ(dt,wt*Math.cos(ne)+.035*Math.sin(zt*3.3+pt),ft*Math.sin(zt*Ct+pt)+Kt*zt*zt+wt*Math.sin(ne),Ot)}W.computeVertexNormals();let et=new Mi(W,w,N);return et.instanceMatrix.setUsage(Fr),et}),L=i.strands.map((ot,Q)=>({p:ot,k:Math.floor(Q/I),v:Q%I}));for(let ot of L)G[ot.v].setColorAt(ot.k,R[ot.p.i%R.length]);for(let ot of G)ot.instanceColor&&(ot.instanceColor.needsUpdate=!0);let O=fn(new _n({color:Qe("#6b4a1c"),roughness:.05,clearcoat:1}),"drawn-oil-streak"),$=new fe(.16,2.7,1,20);$.rotateX(-Math.PI/2);let X=new Vt($,O),rt=fn(new _n({color:Qe("#c89a2c"),roughness:.02,clearcoat:1}),"drawn-oil-drops"),q=new Mi(new Xi(.02,10,8),rt,i.oilDrops.length);q.instanceMatrix.setUsage(Fr);let K=new Mi(new gs(.009,4).rotateX(-Math.PI/2),fn(new An({roughness:.8,side:Ue}),"drawn-oregano"),i.oregano.length),st=["#4c5a26","#5f6d31","#3a4520","#6d6a36","#7b6a3c"].map(ot=>Qe(ot));return i.oregano.forEach((ot,Q)=>K.setColorAt(Q,st[ot.variant])),K.instanceColor&&(K.instanceColor.needsUpdate=!0),K.instanceMatrix.setUsage(Fr),{aioli:o,chips:d,provolone:_,turkey:m,onions:v,onionMeshes:T,pickles:x,strands:{meshes:G,data:L},oil:{streak:X,drops:q},oregano:K}}var Yr=5.2,Rh=Yr*Ce.w/Ce.h,Ll=6.2,df=1.72,ff=2.85,hv=1315860,Qs=(i,t)=>[i*df,t*ff],Ch=i=>Math.round(i*1e4),Ph={aioli:{u:-.46,v:0,long:.7,rot:.02},provolone:{u:-.36,v:.02,long:.8,rot:-.03},turkey:{u:-.02,v:.02,long:.76,rot:.02},onions:{u:.02,v:-.05,long:.42,rot:.3},shredduce:{u:0,v:0,long:.92,rot:0},oregano:{u:.02,v:0,long:.34,rot:0}},uv=.11,dv=.09,uf={land:.8,maxFlight:.95};function pf(i,t,e,n,r){let s=new Fn,a=new Gr,o=new Rn(-Rh,Rh,Yr,-Yr,1,100);o.position.set(0,40,0),o.up.set(0,0,-1),o.lookAt(0,0,0),s.add(o);let l=Object.fromEntries(i.map(u=>[u.key,u])),c=Object.fromEntries(n.steps.map(u=>[u.key,u])),h=Fi(24301),d=u=>new U(u[0],u[1],u[2]),f=Ye(new Re({uniforms:{uTime:{value:0},uBurst:{value:0},uGlow:{value:1},uRed:{value:d(Tl)},uGold:{value:d(pn)},uCream:{value:d(Cn)}},vertexShader:"varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }",fragmentShader:`uniform float uTime, uBurst, uGlow; uniform vec3 uRed, uGold, uCream; varying vec3 vW;
    void main(){
      vec2 p = vW.xz; float r = length(p*vec2(1.0,0.72));
      vec3 ink = vec3(0.078); vec3 col = ink*0.62;
      col = mix(col, uRed*0.34, exp(-r*r*0.035)*0.8*uGlow);
      col = mix(col, ink*0.35, smoothstep(5.0, 11.0, r));
      float ang = atan(p.y, p.x);
      float rays = pow(0.5+0.5*sin(ang*16.0 + uTime*0.30), 5.0), rays2 = pow(0.5+0.5*sin(ang*7.0 - uTime*0.21 + 1.3), 9.0);
      float fall = smoothstep(2.6, 4.8, r) * exp(-r*0.16);
      col += (uGold*rays*0.30 + uCream*rays2*0.16) * fall * uBurst;
      col += uGold * 0.016 * smoothstep(0.04, 0.0, abs(fract(r*0.9 - uTime*0.08) - 0.5) - 0.46) * exp(-r*0.18);
      gl_FragColor = vec4(col, 1.0);
    }`}),"stage-floor",!1),p=new Vt(new fe(60,60).rotateX(-Math.PI/2),f);p.name="stage-floor",p.position.y=-1,p.layers.set(Jt.stage),s.add(p);let _=2.3,b=1.75,g=`float sdStad(vec2 p){ p.y = abs(p.y) - ${b.toFixed(3)}; p.y = max(p.y, 0.0); return length(p) - ${_.toFixed(3)}; }`,m=Ye(new Re({uniforms:{uSweep:{value:-10},uPulse:{value:0},uRed:{value:d(Tl)},uGold:{value:d(pn)},uCream:{value:d(Cn)}},vertexShader:"varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }",fragmentShader:`uniform float uSweep, uPulse; uniform vec3 uRed, uGold, uCream; varying vec3 vW; ${g}
    void main(){
      vec2 p = vW.xz; float d = sdStad(p);
      if (d > 0.06) discard;
      vec3 ink = vec3(0.078);
      vec3 col = ink*1.15 + vec3(0.015,0.005,0.005);
      col = mix(col, uRed*0.30 + ink*0.5, smoothstep(-0.9, 0.0, d)*0.55);
      col += uRed*0.10*exp(-dot(p,p)*0.05);
      col *= 0.93 + 0.07*sin(d*70.0);
      float gold = smoothstep(0.022, 0.0, abs(d + 0.20));
      col = mix(col, uGold, gold*0.9);
      float lip = smoothstep(0.05, 0.0, abs(d + 0.035)); col += uCream*lip*0.25;
      float band = exp(-pow((p.x*0.55 + p.y*0.85 - uSweep)/0.55, 2.0)); col += uCream*band*0.10 + uGold*band*gold*0.6;
      col += uGold*uPulse*exp(-abs(d+0.2)*6.0)*0.35;
      float edge = smoothstep(0.06, 0.0, d);
      gl_FragColor = vec4(col*edge + vec3(0.0)*(1.0-edge), 1.0);
    }`}),"stage-tray",!1),E=new Vt(new fe(2*_+1,2*(b+_)+1).rotateX(-Math.PI/2),m);E.name="stage-tray",E.position.y=0,E.layers.set(Jt.stage),s.add(E);let T=Ye(new Re({vertexShader:"varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }",fragmentShader:`varying vec3 vW; ${g} void main(){ float d = sdStad(vW.xz - vec2(0.14, 0.2)); float a = 0.75*exp(-max(d,0.0)*2.6)*step(-0.3,d); gl_FragColor = vec4(0.0,0.0,0.0,a); }`,transparent:!0,depthWrite:!1}),"stage-tray-ao",!1),v=new Vt(new fe(16,20).rotateX(-Math.PI/2),T);v.name="stage-tray-ao",v.position.y=-.5,v.layers.set(Jt.stage),s.add(v);let M=Ye(new Re({uniforms:{uTime:{value:0},uI:{value:0},uGold:{value:d(pn)},uCream:{value:d(Cn)}},vertexShader:"varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",fragmentShader:`uniform float uTime, uI; uniform vec3 uGold, uCream; varying vec2 vUv;
    void main(){
      vec2 p = vec2(vUv.x*0.5625, vUv.y); vec2 d = p - vec2(-0.03, 1.1);
      float ang = atan(d.y, d.x), r = length(d);
      float b = pow(0.5+0.5*sin(ang*23.0 + uTime*0.35), 8.0) + 0.7*pow(0.5+0.5*sin(ang*37.0 - uTime*0.5 + 2.0), 12.0) + 0.5*pow(0.5+0.5*sin(ang*11.0 + uTime*0.2 + 4.0), 6.0);
      float a = b * exp(-r*1.35) * smoothstep(0.0, 0.25, r) * uI;
      gl_FragColor = vec4(mix(uCream, uGold, 0.5)*a, a);
    }`,transparent:!0,depthTest:!1,depthWrite:!1}),"fx-rays",!1);Al(M);let y=new Vt(new fe(1,1),M);y.name="fx-rays",y.position.z=-20,y.renderOrder=2,y.frustumCulled=!1,y.layers.set(Jt["fx-back"]),o.add(y);let C=ji(Qi(64,64,u=>{let A=u.createRadialGradient(32,32,0,32,32,32);A.addColorStop(0,"rgba(0,0,0,1)"),A.addColorStop(.55,"rgba(0,0,0,.6)"),A.addColorStop(1,"rgba(0,0,0,0)"),u.fillStyle=A,u.fillRect(0,0,64,64)}),"stage-blob"),x=new Map,w=new Map;function I(u,A,D,z,tt){let j=r.get(A);if(!j)throw new Error(`stage: texture ${A} not loaded`);let H=j.image,V=H.width/H.height,it=z.h??1,ut=it*V;z.long&&(V>=1?(ut=z.long,it=ut/V):(it=z.long,ut=it*V));let lt=$d(j,`photo:${u}`),ct=new Vt(new fe(ut,it).rotateX(-Math.PI/2),lt);ct.name=`photo:${u}`,ct.frustumCulled=!1,ct.visible=!1,ct.renderOrder=Ch(tt),s.add(ct);let Et=a.add(D,"photo",[ct],j);w.set(u,Et.part_id);let Tt=Ye(new rn({map:C,transparent:!0,depthWrite:!1,toneMapped:!1,opacity:0}),`shadow:${u}`,!1),Ft=new Vt(new fe(ut*1.02,it*1.02).rotateX(-Math.PI/2),Tt);Ft.name=`shadow:${u}`,Ft.layers.set(Jt.stage),Ft.visible=!1,Ft.renderOrder=1,s.add(Ft);let F={mesh:ct,mat:lt,w:ut,h:it,shadow:Ft,shMat:Tt,base:tt};return x.set(u,F),F}function N(u,A,D,z={}){let tt=z.op??1,j=z.s??1,H=z.lift??0;u.mesh.visible=tt>.002,u.mesh.position.set(A,u.base+H*.01,D),u.mesh.renderOrder=Ch(u.mesh.position.y),u.shadow.visible=u.mesh.visible,u.shadow.position.set(A+.07+H*.5,.02,D+.12+H*.4),u.shadow.rotation.set(0,z.rot??0,0),u.shadow.scale.setScalar(j*(1+H*.15)),u.shMat.opacity=tt*.5*qe(1-H*.5)}let R=u=>{u.mesh.visible=!1,u.shadow.visible=!1},G=u=>u.kind==="state"?`bread-${u.state}`:`build-state-${String(u.n).padStart(2,"0")}`,L=i.filter(u=>c[u.key]?.state);L.forEach(u=>I(`state:${u.key}`,c[u.key].state,G(u),{h:Ll},.1+u.n*.04));let O=n.hero?I("hero",n.hero,"finished-3q",{long:5.5},2):null;for(let u of i){let A=c[u.key];!A||A.rep!=="photo"||A.add.length===0||u.key==="chips"||u.key==="pickles"||I(`add:${u.key}`,A.add[0],u.ingredient,{long:Ph[u.key].long*Ll},.1+u.n*.04-.02)}let $=c.chips?.rep==="photo"&&c.chips.add.length?e.chips.map(u=>I(`add:chips:${u.i}`,c.chips.add[u.variant%c.chips.add.length],l.chips.ingredient,{long:uv*Ll*u.scale},.1+5*.04-.035+u.y*.1+u.i*4e-4)):[],X=c.pickles?.rep==="photo"&&c.pickles.add.length?e.pickles.map(u=>I(`add:pickles:${u.i}`,c.pickles.add[u.variant%c.pickles.add.length],l.pickles.ingredient,{long:dv*Ll*u.scale},.1+9*.04-.02+u.i*.001)):[],rt=new Set(n.drawnFood),q=new He;q.scale.set(df/(2*ln*.96),1.8,ff/(Mn/2*.92)),q.position.y=.28;let K=u=>Ch(.1+u*.04+.02);s.add(q);let st=new Yi(16774108,2757652,1.1);st.layers.enableAll(),s.add(st);let ot=new Ci(16774370,2.2);ot.position.set(-3,12,4),ot.layers.enableAll(),s.add(ot);for(let u of rt)if(l[u].kind==="state")throw new Error(`stage: bread state "${u}" has no photo and no drawn stand-in; refused`);let Q=rt.size?Il(e):null;Q&&rt.has("chips")&&(Q.chips.forEach((u,A)=>{u.name=`drawn:chip:${A}`,q.add(u)}),Q.chips.forEach(u=>{u.renderOrder=K(l.chips.n)}),w.set("drawn:chips",a.add(l.chips.ingredient,"drawn",Q.chips).part_id)),Q&&rt.has("shredduce")&&(Q.strands.meshes.forEach((u,A)=>{u.name=`drawn:shredduce:${A}`,q.add(u)}),Q.strands.meshes.forEach(u=>{u.renderOrder=K(l.shredduce.n)}),w.set("drawn:shredduce",a.add(l.shredduce.ingredient,"drawn",Q.strands.meshes).part_id));let _t=new Map;if(Q){let u=new ie,A=new en,D=new U,z=new U,tt=new hn,j=H=>{switch(H){case"aioli":return Q.aioli.mesh.position.set(0,.12,0),{objs:[Q.aioli.mesh],meshes:[Q.aioli.mesh]};case"provolone":return Q.provolone.forEach((V,it)=>V.position.set(-ln,.02+it*.012,it?.62:-.62)),{objs:Q.provolone,meshes:Q.provolone};case"turkey":return Q.turkey.forEach((V,it)=>{V.position.set(.05,.1+it*.022,(it-1)*.95),V.rotation.set(0,(it-1)*.2,0)}),{objs:Q.turkey,meshes:Q.turkey};case"onions":return Q.onions.forEach(V=>{let it=V.userData;V.position.set(it.xc,.18,it.zc),V.rotation.set(0,it.yaw,0)}),{objs:Q.onions,meshes:Q.onionMeshes};case"pickles":return Q.pickles.forEach((V,it)=>{let ut=e.pickles[it];V.position.set(ut.u*2*ln*.96,.2,ut.v*(Mn/2)*.92),V.rotation.set(0,ut.rot,0)}),{objs:Q.pickles,meshes:Q.pickles};case"oil-vinegar":return Q.oil.streak.position.set(.02,.5,0),e.oilDrops.forEach((V,it)=>{D.set(V.u*2*ln*.96,.52,V.v*(Mn/2)*.92),A.identity(),z.set(V.scale,V.scale*.45,V.scale),u.compose(D,A,z),Q.oil.drops.setMatrixAt(it,u)}),Q.oil.drops.instanceMatrix.needsUpdate=!0,{objs:[Q.oil.streak,Q.oil.drops],meshes:[Q.oil.streak,Q.oil.drops]};case"oregano":return e.oregano.forEach((V,it)=>{D.set(V.u*2*ln*.96,.54,V.v*(Mn/2)*.92),tt.set(.3,V.rot,.2),A.setFromEuler(tt),z.set(V.scale*1.6,V.scale,V.scale*.7),u.compose(D,A,z),Q.oregano.setMatrixAt(it,u)}),Q.oregano.instanceMatrix.needsUpdate=!0,{objs:[Q.oregano],meshes:[Q.oregano]};default:throw new Error(`stage: no drawn stand-in for "${H}"`)}};for(let H of rt){if(H==="chips"||H==="shredduce")continue;let{objs:V,meshes:it}=j(H),ut=new He;ut.scale.set(q.scale.x,.25,q.scale.z),ut.position.y=.1+l[H].n*.04-.035,ut.traverse(lt=>{lt.renderOrder=K(l[H].n)}),V.forEach(lt=>ut.add(lt)),it.forEach((lt,ct)=>{lt.name=`drawn:${H}:${ct}`}),s.add(ut),w.set(`stand-in:${H}`,a.add(l[H].ingredient,"drawn",it).part_id),_t.set(H,{g:ut,objs:V})}}let gt=new er,Mt=new er,W=new wl(s),Y=u=>ui(t,l[u].n),ft=(u,A,D,z,tt=!1)=>{W.add(u,A,.03,D,tt?11:7,tt?.9:.6,tt?pn:Cn,tt?.03:.035,tt?.7:.45),gt.puff(h,u,A,.05,D,z,12,3),Mt.puff(h,u,A,.3,D,z*1.15,6,2)};ft(Y("whole").t0+Y("whole").dur*.6,0,0,1.6,!0),ft(Y("slice").t0+Y("slice").dur*.5,0,0,2,!0),ft(Y("gut").t0+Y("gut").dur*.5,-.9,0,1.2);for(let u of["aioli","provolone","turkey","onions","shredduce","oregano"]){let A=Ph[u],[D,z]=Qs(A.u,A.v);ft(Y(u).t0+Y(u).dur*.5,D,z,1.1)}ft(Y("oil-vinegar").t0+.2,0,0,1.3);let Ct=e.chips.map((u,A)=>{let D=Fi(50207+A);return{dur:Se(.55,.95,D()),sx:Se(-2.6,3.4,D()),sz:-6.6-D()*1.2,s:Se(1.7,2.3,D()),spin:(D()<.5?-1:1)*Se(2,6,D()),jit:(D()-.5)*.05}}),pt=e.chips.map((u,A)=>{let D=Y("chips"),z=e.chips.length,tt=D.dur*uf.land-uf.maxFlight-.04,j=D.t0+Ct[A].dur+tt*Math.pow(A/Math.max(1,z-1),.85)+Math.abs(Ct[A].jit)*.5,[H,V]=Qs(u.u,u.v);W.add(j,H,.03,V,1.6,.32,pn,.07,.55);for(let it=0;it<3;it++){let ut=h()*6.28;Mt.add({t:j,life:.5+h()*.3,pos:[H,.5,V],vel:[Math.cos(ut)*2,2.5,Math.sin(ut)*2],drag:1.2,grav:-9,size:.12,type:1,col:h()<.6?pn:Tl,spin:(h()-.5)*20})}return j}),Lt=e.pickles.map((u,A)=>Y("pickles").t0+.55+A*.07);W.add(ee+.1,0,.03,0,18,1.1,Cn,.03,.9);for(let u=0;u<40;u++){let A=u/40*6.28;Mt.add({t:ee+.1+h()*.05,life:.6+h()*.5,pos:[Math.cos(A)*2.9,.9,Math.sin(A)*1.9],vel:[Math.cos(A)*3,1,Math.sin(A)*3],drag:2.5,size:.3+h()*.3,type:0,col:h()<.7?pn:Cn,spin:(h()-.5)*6})}for(let u=0;u<60;u++)Mt.add({t:ee+.6+h()*2.2,life:.35+h()*.35,pos:[(h()-.5)*6,1,(h()-.5)*3.6],vel:[0,.25,0],drag:0,size:.25+h()*.3,type:0,col:h()<.7?pn:Cn,spin:(h()-.5)*3});for(let u=0;u<80;u++)gt.add({t:-10,life:100,pos:[(h()-.5)*8,-.5,(h()-.5)*12],vel:[(h()-.5)*.12,0,(h()-.5)*.12],drag:0,size:.05+h()*.07,type:3,col:h()<.6?Cn:pn});let Kt=Ce.h/(2*Yr);s.add(gt.build("fx-back-particles",Jt["fx-back"],!1,()=>Kt,!0)),s.add(Mt.build("fx-front-particles",Jt["fx-front"],!0,()=>Kt,!0));let et=[[0,1.14,0,0,-5],[1.4,1,0,0,-2],[3.4,1,0,0,0],[3.9,1.1,-.45,0,1],[4.9,1.08,.35,.1,0],[6.8,1,0,0,-1],[9.7,1.05,0,0,1],[12.8,1,0,0,0],[ee,1,0,0,0],[18,1.05,0,-.1,0]],dt=[Y("whole").t0+Y("whole").dur*.6,Y("slice").t0+Y("slice").dur*.5,ee+.1];function wt(u){let A=0;for(;A<et.length-2&&u>et[A+1][0];)A++;let D=et[A],z=et[A+1],tt=Wr(ge(D[0],z[0],u)),j=0;for(let it of dt)u>it&&(j+=.05*Math.exp(-(u-it)*9));let H=Se(D[1],z[1],tt),V=Se(D[4],z[4],tt)*Math.PI/180+j*.06*Math.sin(u*63);o.zoom=H,o.updateProjectionMatrix(),o.position.set(Se(D[2],z[2],tt)+j*Math.sin(u*91),40,Se(D[3],z[3],tt)+j*Math.cos(u*77)),o.up.set(Math.sin(V),0,-Math.cos(V)),o.lookAt(o.position.x,0,o.position.z),y.scale.set(2*Rh/H,2*Yr/H,1)}let Ot=El(i,t,of,ee),zt=u=>{let A=ui(t,u.n),D=c[u.key];if(u.kind==="state")return u.n===1?[A.t0,A.t0+A.dur*.7]:[A.t0+A.dur*.15,A.t0+A.dur*.75];if(u.key==="oil-vinegar")return[A.t0+.12,A.t0+A.dur*.85];let z=D.add.length>0||rt.has(u.key)||u.key==="chips"&&$.length>0;return u.key==="chips"&&z?[A.t0+A.dur*.82,A.t0+A.dur]:z?[A.t0+A.dur*.72,A.t0+A.dur]:[A.t0+A.dur*.2,A.t0+A.dur]},ne=L.map(u=>({s:u,w:zt(u)})),he=.25,Yt=u=>ne.find(A=>A.s.key===u)?.w[1]??1/0,Wt=u=>ne.find(A=>A.s.n>=u)?.w[1]??1/0;function B(u,A,D,z,tt,j,H=.42,V={dx:.9,dz:-1.6,s:1.5,spin:.5},it=1/0){let ut=D-H;if(A<ut||A>=it){R(u);return}let lt=ge(ut,D,A),ct=ml(lt),Et=1-jn(lt),Tt=A-D,Ft=Tt>0?1-.035*Math.sin(Tt*26)*Math.exp(-Tt*9):1;N(u,z+V.dx*(1-ct),tt+V.dz*(1-ct),{rot:j+V.spin*Et,s:Se(V.s,1,ct)*Ft,op:be(0,.3,lt),lift:(1-ct)*1.5})}function xe(u){wt(u);let A=O?be(ee,ee+.6,u):0,D=.3+.3*be(4.9,6.8,u)+.5*be(ee,ee+.8,u);f.uniforms.uTime.value=u,f.uniforms.uBurst.value=D*be(0,.6,u),f.uniforms.uGlow.value=.55+.45*be(0,1,u)+.35*A,m.uniforms.uSweep.value=Se(-6,6,ge(.2,1.4,u))+(u>ee?Se(-6,6,ge(ee+.2,ee+1.4,u))+12:0),m.uniforms.uPulse.value=u>ee+.1?.8*Math.exp(-(u-ee-.1)*3):0,M.uniforms.uTime.value=u,M.uniforms.uI.value=(.24+.16*be(4.9,6.8,u)+.14*A)*be(0,.8,u),W.pose(u),gt.pose(u,Kt*o.zoom),Mt.pose(u,Kt*o.zoom),ne.forEach(({s:j,w:H},V)=>{let it=x.get(`state:${j.key}`),ut=ne[V+1],lt=ut?u>=ut.w[1]:!1,ct=ge(H[0],H[1],u)*(1-A);if(ct<=0||lt){R(it);return}let Et=j.n===1?Ui(ge(H[0],H[1],u),1.2):1,Tt=.02*(1-ge(H[0],H[1],u));N(it,0,0,{s:j.n===1?Se(1.28,1,Et):1+Tt,op:j.n===1?be(0,.4,ge(H[0],H[1],u)):ct,lift:j.n===1?(1-Et)*1.2:0})});for(let j of["aioli","provolone","turkey","onions","shredduce","oregano"]){let H=x.get(`add:${j}`);if(!H)continue;let V=Y(j),it=Ph[j],[ut,lt]=Qs(it.u,it.v);B(H,u,V.t0+V.dur*(j==="onions"?.3:.5),ut,lt,it.rot,.42,{dx:.8,dz:-1.8,s:1.45,spin:.45},Wt(l[j].n))}let z=Wt(l.chips.n);$.forEach((j,H)=>{let V=e.chips[H],[it,ut]=Qs(V.u,V.v),lt=Ct[H];B(j,u,pt[H],it,ut,V.rot,lt.dur,{dx:lt.sx-it,dz:lt.sz-ut,s:lt.s,spin:lt.spin},z)});let tt=Wt(l.pickles.n);if(X.forEach((j,H)=>{let V=e.pickles[H],[it,ut]=Qs(V.u,V.v);B(j,u,Lt[H],it,ut,V.rot,.35,{dx:-2.5-it*.2,dz:-1.5,s:1.6,spin:2},tt)}),Q&&rt.has("chips")){let j=Q.chips[0].material,H=1-ge(Yt("chips"),Yt("chips")+he,u);j.transparent=H<1,j.opacity=H,Q.chips.forEach((V,it)=>{let ut=e.chips[it],lt=pt[it],ct=.45;if(u<lt-ct||u>=Yt("chips")+he){V.visible=!1;return}V.visible=!0;let Et=ge(lt-ct,lt,u),Tt=ml(Et),Ft=1-jn(Et),F=ut.u*2*ln*.96,mt=ut.v*(Mn/2)*.92;V.position.set(Se(2.2,F,Tt),.1+ut.y*2+(1-Tt)*3,Se(-3.4,mt,Tt)),V.rotation.set(.3*Math.sin(ut.rot)+Ft*6,ut.rot+Ft*4,.3*Math.cos(ut.rot)+Ft*3,"YXZ"),V.scale.setScalar(ut.scale*.95)})}if(Q&&rt.has("shredduce")){let j=Y("shredduce"),H=Yt("shredduce")+he,V=new ie,it=new en,ut=new hn,lt=new U,ct=new U,Et=new ie().makeScale(0,0,0);for(let F of Q.strands.data){let mt=j.t0+.15+F.p.i%97/97*j.dur*.5,at=.42,xt=Q.strands.meshes[F.v];if(u<mt-at||u>=H){xt.setMatrixAt(F.k,Et);continue}let vt=ge(mt-at,mt,u);lt.set(F.p.u*2*ln*.96*Se(1.4,1,vt),.12+F.p.y+(1-vt*vt)*2.5,F.p.v*(Mn/2)*.92),ut.set((1-vt)*5+.2,F.p.rot+(1-vt)*3,(1-vt)*2),it.setFromEuler(ut),ct.setScalar(F.p.scale),V.compose(lt,it,ct),xt.setMatrixAt(F.k,V)}let Tt=Q.strands.meshes[0].material,Ft=1-ge(Yt("shredduce"),Yt("shredduce")+he,u);Tt.transparent=Ft<1,Tt.opacity=Ft;for(let F of Q.strands.meshes)F.instanceMatrix.needsUpdate=!0,F.visible=u>=j.t0&&u<H}for(let[j,H]of _t){let V=Y(j),it=V.t0+V.dur*.5,ut=Wt(l[j].n),lt=u>=it-.35&&u<ut;if(H.g.visible=lt,lt){let ct=ml(ge(it-.35,it,u));H.g.position.x=(1-ct)*.8,H.g.position.z=(1-ct)*-1.6}if(j==="aioli"){let ct=Math.floor(Wr(ge(V.t0,it,u))*Q.aioli.segs);Q.aioli.mesh.geometry.setDrawRange(0,ct*Q.aioli.rad*6)}}if(O)if(u<ee)R(O);else{let j=ge(ee,ee+.6,u);N(O,0,-.35,{s:Se(1.08,1,Ui(ge(ee,ee+.85,u),2.5))*(1+.035*be(ee+.8,18,u)),op:be(0,1,j),rot:0})}Ot.pose(u,P)}function qt(u){let A={},D=(tt,j)=>{j!==void 0&&(A[tt]??=[]).push(j)},z=O?u>=ee+.6:!1;ne.forEach(({s:tt,w:j},H)=>{let V=ne[H+1];u>j[0]+.05&&!(V&&u>=V.w[1])&&!z&&D(`state:${tt.key}`,w.get(`state:${tt.key}`))});for(let tt of["aioli","provolone","turkey","onions","shredduce","oregano"]){if(!x.has(`add:${tt}`))continue;let j=Y(tt),H=j.t0+j.dur*(tt==="onions"?.3:.5);u>=H&&u<Wt(l[tt].n)&&D(tt,w.get(`add:${tt}`))}$.forEach((tt,j)=>{u>=pt[j]&&u<Wt(l.chips.n)&&D("chips",w.get(`add:chips:${j}`))}),X.forEach((tt,j)=>{u>=Lt[j]&&u<Wt(l.pickles.n)&&D("pickles",w.get(`add:pickles:${j}`))});for(let tt of _t.keys()){let j=Y(tt);u>=j.t0+j.dur*.5&&u<Wt(l[tt].n)&&D(tt,w.get(`stand-in:${tt}`))}return w.has("drawn:chips")&&u>=Math.min(...pt)&&u<Yt("chips")+he&&D("chips",w.get("drawn:chips")),z&&D("hero",w.get("hero")),A}function P(u,A){return u!==l.chips.n?null:pt.filter(D=>D<=A).length}return{scene:s,camera:o,hud:Ot,registry:a,pose:xe,tally:P,expected:qt,background:hv,shadows:!1,viewport(u){Kt=u/(2*Yr)}}}function Dl(i,t,e){let n=new Fn,r=new Gr,s=new ze(32,Ce.w/Ce.h,.1,60);n.add(s);let a=Object.fromEntries(i.map(et=>[et.key,et])),o=et=>ui(t,a[et].n),l=(et,dt)=>tf(t,a[et].n,dt),c=ji(Qi(256,256,et=>{let dt=Fi(3);et.fillStyle="#1b1614",et.fillRect(0,0,256,256);for(let wt=0;wt<2600;wt++)et.fillStyle=`rgba(${40+dt()*20},${30+dt()*14},${26+dt()*12},${.2+dt()*.3})`,et.fillRect(dt()*256,dt()*256,1+dt()*3,1+dt()*3)}),"studio-slab");c.colorSpace=ke,c.wrapS=c.wrapT=Mr,c.repeat.set(8,8);let h=Ye(new An({map:c,roughness:.8}),"studio-slab",!1);gl(h);let d=new Vt(new fe(40,40).rotateX(-Math.PI/2),h);d.name="studio-slab",d.position.y=-.345,d.receiveShadow=!0,d.layers.set(Jt.stage),n.add(d);let f=Ye(new rn({color:789002,side:We,toneMapped:!1}),"studio-dome",!1),p=new Vt(new Xi(30,24,12),f);p.name="studio-dome",p.layers.set(Jt.stage),n.add(p);let _=ji(Qi(512,768,et=>{let dt=Fi(11);et.fillStyle="#d8ceb3",et.fillRect(0,0,512,768);for(let wt=0;wt<5e3;wt++)et.fillStyle=`rgba(${200+dt()*30},${190+dt()*30},${160+dt()*30},0.25)`,et.fillRect(dt()*512,dt()*768,1,3+dt()*8);et.strokeStyle="#e0333b",et.lineWidth=5,et.strokeRect(24,24,464,720),et.lineWidth=2,et.strokeRect(34,34,444,700)}),"studio-paper");_.colorSpace=ke;let b=Ye(new An({map:_,roughness:.85}),"studio-paper",!1);gl(b);let g=new Vt(new fe(3.4,4.9).rotateX(-Math.PI/2),b);g.name="studio-paper",g.rotation.y=.06,g.position.set(0,-.33,.05),g.receiveShadow=!0,g.layers.set(Jt.stage),n.add(g);let m=new Yi(16774112,2759188,.5),E=new Ci(16773338,3);E.position.set(-3.2,6.5,3.6),E.castShadow=!0,E.shadow.mapSize.set(1024,1024),Object.assign(E.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:1,far:16}),E.shadow.bias=-5e-4,E.shadow.normalBias=.02;let T=new Ci(14674175,.6);T.position.set(4,3,4);let v=new Es(16767370,0,14,.55,1,1.2);v.position.set(1.5,3.2,-4.5),v.target.position.set(0,.3,0);let M=new ws(16726596,0,9,1.6);M.position.set(3.2,1.2,.6);for(let et of[m,E,T,v,M])et.layers.enableAll(),n.add(et);n.add(v.target),E.shadow.camera.layers.enableAll();let y=hf();y.group.traverse(et=>{et.isMesh&&(et.name=et.name||"drawn:roll")}),n.add(y.group);let[C,x,w,,,I]=y.meshes;r.add("bread-sliced","drawn",[C,x,w,y.crumbTopFlat]),r.add("bread-gutted","drawn",[y.crumbTopGut,I]);let N=Array.from({length:40},(et,dt)=>{let wt=Fi(900+dt);return{p0:new U(-ln+(wt()-.5)*.3,.02,(wt()-.5)*2.6),v:new U((wt()-.5)*1.6,1+wt()*1.3,(wt()-.5)*.6),s:.6+wt()*1.2,rot:wt()*6}}),R=Il(e),G=.36,L=.42,O=new He;n.add(O);let $=(et,dt)=>{dt.forEach((wt,Ot)=>{wt.name=`drawn:${et}:${Ot}`,wt.castShadow=!0,wt.receiveShadow=!0}),r.add(a[et].ingredient,"drawn",dt)};O.add(R.aioli.mesh),$("aioli",[R.aioli.mesh]),R.chips.forEach(et=>O.add(et)),$("chips",R.chips),R.provolone.forEach(et=>O.add(et)),$("provolone",R.provolone),R.turkey.forEach(et=>O.add(et)),$("turkey",R.turkey),R.onions.forEach(et=>O.add(et)),$("onions",R.onionMeshes),R.pickles.forEach((et,dt)=>{O.add(et),et.name=`drawn:pickles:${dt}`,et.castShadow=!0,et.receiveShadow=!0,r.add(a.pickles.ingredient,"drawn",[et])}),R.strands.meshes.forEach(et=>O.add(et)),$("shredduce",R.strands.meshes),O.add(R.oil.streak,R.oil.drops),$("oil-vinegar",[R.oil.streak,R.oil.drops]),O.add(R.oregano),$("oregano",[R.oregano]);let X=Fi(745197),rt=new er;for(let et of["whole","slice","provolone","turkey"]){let dt=o(et);rt.puff(X,dt.t0+dt.dur*.6,.2,.3,0,.8,8,3)}for(let et=0;et<40;et++){let dt=X()*6.28;rt.add({t:ee+.2+X()*1.6,life:.4+X()*.4,pos:[Math.cos(dt)*1.3,.4+X()*.6,Math.sin(dt)*2],vel:[0,.3,0],drag:0,size:.06+X()*.05,type:0,col:X()<.7?pn:Cn,spin:2})}let q=Ce.h;n.add(rt.build("fx-front-sparkles",Jt["fx-front"],!0,()=>q/(2*Math.tan(s.fov*Math.PI/360)),!1));let K=[{t:0,p:[2.6,3.1,4.6],q:[.45,0,0]},{t:1.4,p:[.9,5.4,4],q:[.2,0,0]},{t:2.5,p:[-.9,4.6,3],q:[-.4,-.05,0]},{t:3.6,p:[-.9,4.2,2.8],q:[-.45,-.05,0]},{t:4.9,p:[1.4,4.4,3.2],q:[.45,0,.1]},{t:7.1,p:[.1,5.2,3.7],q:[-.1,.05,0]},{t:9.7,p:[.3,4.8,3.4],q:[0,.1,0]},{t:11.8,p:[0,5,3.6],q:[0,.15,0]},{t:14.1,p:[.4,4.6,3.3],q:[0,.2,.1]},{t:ee,p:[2.7,2.3,4.6],q:[.05,.15,.1]},{t:18,p:[3.3,1.8,4.2],q:[0,.16,.2]}],st=(et,dt,wt,Ot,zt)=>.5*(2*dt+(-et+wt)*zt+(2*et-5*dt+4*wt-Ot)*zt*zt+(-et+3*dt-3*wt+Ot)*zt*zt*zt);function ot(et){let dt=0;for(;dt<K.length-2&&et>K[dt+1].t;)dt++;let wt=K[Math.max(0,dt-1)],Ot=K[dt],zt=K[dt+1],ne=K[Math.min(K.length-1,dt+2)],he=qe((et-Ot.t)/(zt.t-Ot.t)),Yt=Wr(he)*.4+he*.6;s.position.set(...[0,1,2].map(Wt=>st(wt.p[Wt],Ot.p[Wt],zt.p[Wt],ne.p[Wt],Yt))),s.lookAt(...[0,1,2].map(Wt=>st(wt.q[Wt],Ot.q[Wt],zt.q[Wt],ne.q[Wt],Yt)))}let Q=El(i,t,lf,ee),_t=new ie,gt=new en,Mt=new hn,W=new U,Y=new U,ft=new ie().makeScale(0,0,0),Ct=e.chips.map((et,dt)=>{let wt=o("chips");return wt.t0+.3+(wt.dur*.85-.3)*(dt/Math.max(1,e.chips.length-1))});function pt(et,dt,wt,Ot,zt,ne,he,Yt=.34,Wt=2.2,B=.6){if(dt<wt-Yt){et.visible=!1;return}et.visible=!0;let xe=qe((dt-(wt-Yt))/Yt),qt=1-xe*xe,P=Math.max(0,dt-wt),u=.07*Math.exp(-P*9)*Math.sin(P*30);et.position.set(Ot+.25*qt,zt+Wt*qt,ne-.3*qt),et.rotation.set(B*qt+u,he+.8*qt,-.35*qt)}function Lt(et){ot(et);let dt=o("whole"),wt=Ui(ge(dt.t0,dt.t0+dt.dur*.7,et),1.1);y.group.visible=et>=dt.t0,y.group.position.y=(1-wt)*2.4;let Ot=Ui(l("slice",et),.9);y.hinge.rotation.z=Math.PI*(1-Ot),y.hinge.position.y=Math.sin(qe(Ot)*Math.PI)*.45;let zt=l("gut",et);y.crumbTopFlat.visible=zt<.5,y.crumbTopGut.visible=zt>=.5;let ne=o("gut"),he=I;N.forEach((u,A)=>{let D=et-(ne.t0+ne.dur*.45);if(D<0||D>1.3){he.setMatrixAt(A,ft);return}let z=Math.min(D,.6);W.set(u.p0.x+u.v.x*z,Math.max(-.32,u.p0.y+u.v.y*z-4.9*z*z),u.p0.z+u.v.z*z),Mt.set(u.rot+D*8,u.rot,0),gt.setFromEuler(Mt),Y.setScalar(u.s),_t.compose(W,gt,Y),he.setMatrixAt(A,_t)}),he.instanceMatrix.needsUpdate=!0;let Yt=l("aioli",et),Wt=Math.floor(Wr(Yt)*R.aioli.segs);R.aioli.mesh.visible=Wt>0,R.aioli.mesh.geometry.setDrawRange(0,Wt*R.aioli.rad*6),R.chips.forEach((u,A)=>{let D=e.chips[A],z=qr(D.u,D.v,.03+D.y);pt(u,et,Ct[A],z.x,z.y,z.z,D.rot,.4,1.8,2.4),u.scale.setScalar(D.scale*.8)}),R.provolone.forEach((u,A)=>{let D=o("provolone");pt(u,et,D.t0+D.dur*(.4+A*.3),-ln,.02+A*.012,A?.62:-.62,A?.2:-.15)}),R.turkey.forEach((u,A)=>{let D=o("turkey");pt(u,et,D.t0+D.dur*(.3+A*.22),.05,.2+A*.022,(A-1)*.95,(A-1)*.2)}),R.onions.forEach((u,A)=>{let D=o("onions"),z=u.userData;pt(u,et,D.t0+D.dur*(.3+A*.15),z.xc,G,z.zc,z.yaw,.3,1.8,1.2)}),R.pickles.forEach((u,A)=>{let D=o("pickles"),z=e.pickles[A],tt=qr(z.u,z.v,L);pt(u,et,D.t0+D.dur*(.2+A*.1),tt.x,tt.y,tt.z,z.rot,.28,1.7,2.2)});let B=o("shredduce");for(let u of R.strands.data){let A=B.t0+.2+u.p.i%97/97*B.dur*.7,D=.42,z=R.strands.meshes[u.v];if(et<A-D){z.setMatrixAt(u.k,ft);continue}let tt=qe((et-(A-D))/D),j=qr(u.p.u,u.p.v,.12+u.p.y);W.set(j.x*Se(1.3,1,tt),j.y+(1-tt*tt)*2.2,j.z),Mt.set((1-tt)*5+.25*Math.sin(u.p.rot),u.p.rot+(1-tt)*3,(1-tt)*2),gt.setFromEuler(Mt),Y.setScalar(u.p.scale),_t.compose(W,gt,Y),z.setMatrixAt(u.k,_t)}R.strands.meshes.forEach(u=>{u.instanceMatrix.needsUpdate=!0,u.visible=et>=B.t0});let xe=o("oil-vinegar"),qt=l("oil-vinegar",et);R.oil.streak.visible=qt>0,R.oil.streak.position.set(.02,.5,0),R.oil.streak.scale.set(1,1,Math.max(.001,jn(qt))),R.oil.drops.visible=et>=xe.t0,e.oilDrops.forEach((u,A)=>{let D=xe.t0+.1+A/e.oilDrops.length*xe.dur*.6,z=.3;if(et<D-z){R.oil.drops.setMatrixAt(A,ft);return}let tt=qe((et-(D-z))/z),j=qr(u.u,u.v,.5);W.set(j.x,j.y+(1-tt*tt)*1.5,j.z),gt.identity(),Y.set(u.scale,u.scale*(tt<1?1.3:.45),u.scale),_t.compose(W,gt,Y),R.oil.drops.setMatrixAt(A,_t)}),R.oil.drops.instanceMatrix.needsUpdate=!0;let P=o("oregano");R.oregano.visible=et>=P.t0,e.oregano.forEach((u,A)=>{let D=P.t0+.15+A%61/61*P.dur*.6,z=.26;if(et<D-z){R.oregano.setMatrixAt(A,ft);return}let tt=qe((et-(D-z))/z),j=qr(u.u,u.v,.52);W.set(j.x+(1-tt)*.2,j.y+(1-tt*tt)*1.3,j.z),Mt.set(.3,u.rot,.2),gt.setFromEuler(Mt),Y.set(u.scale*1.6,u.scale,u.scale*.7),_t.compose(W,gt,Y),R.oregano.setMatrixAt(A,_t)}),R.oregano.instanceMatrix.needsUpdate=!0,v.intensity=10*be(4.9,5.6,et)*(1-.4*be(6.4,7,et))+16*be(ee,ee+.9,et),v.position.set(Se(1.5,-2.2,be(ee,18,et)),3.2,-4.5),M.intensity=3*be(ee+.2,ee+1.1,et),rt.pose(et,q/(2*Math.tan(s.fov*Math.PI/360))),Q.pose(et,Kt)}function Kt(et,dt){return et!==a.chips.n?null:Ct.filter(wt=>wt<=dt).length}return{scene:n,camera:s,hud:Q,registry:r,pose:Lt,tally:Kt,background:789002,shadows:!0,viewport(et){q=et}}}async function mf(i){let t=new Map;for(let e of i){let n=await fv(e.bytes);if(n!==e.sha256)throw new Error(`crunchy loader: ${e.asset_id} sha ${n} != ${e.sha256}`);let r=pl(e.bytes);if(r.channels!==4||r.depth!==8)throw new Error(`crunchy loader: ${e.asset_id} must be RGBA8`);let s=new Wi(Zd(Vr(r.data,r.width,r.height)),r.width,r.height,Xe,Ve);s.premultiplyAlpha=!1,s.magFilter=Le,s.minFilter=Le,s.generateMipmaps=!1,s.colorSpace=sn,s.name=e.asset_id,s.userData.co={cls:"photo",asset_id:e.asset_id,sha256:e.sha256},s.needsUpdate=!0,t.set(e.asset_id,s)}return t}async function fv(i){let t=globalThis.crypto?.subtle;if(t){let e=await t.digest("SHA-256",i.slice().buffer);return[...new Uint8Array(e)].map(n=>n.toString(16).padStart(2,"0")).join("")}return tr(i)}function gf(i,t,e={}){jt.enabled=!1;let n=new nl({canvas:i,antialias:e.antialias??!0,alpha:!1,stencil:!0,preserveDrawingBuffer:!0,powerPreference:"high-performance"});return n.setPixelRatio(t),n.setSize(e.w??Ce.w,e.h??Ce.h,!1),n.outputColorSpace=Gi,n.toneMapping=vn,n.shadowMap.enabled=!0,n.shadowMap.type=oo,n.autoClear=!1,n}function _f(i,t){let e=new Set(t.textures.keys()),n=xl(t.look,t.variant,e),r=t.look==="stage-show"?ef:yl;vl(r,t.steps.length);let s=t.look==="stage-show"?pf(t.steps,r,t.layout,n,t.textures):Dl(t.steps,r,t.layout),a=t.probe?pv(s):[],o=null,l=()=>o??=Ks(i,s,t.capture??{w:270,h:480}),c=Ks(i,s,{w:4,h:4});return{plan:n,narrative:r,duration:r.duration,heroT:ee,render:h=>c.renderBeauty(Math.min(r.duration,Math.max(0,h))),async prepare(){let h=new Set;for(let f of[s.scene,s.hud.scene])f.traverse(p=>{let _=p.material;for(let b of _?Array.isArray(_)?_:[_]:[])for(let g of Object.values(b))g&&g.isTexture&&h.add(g)});for(let f of s.registry.parts){let p=f.depthMat;p.map&&h.add(p.map)}for(let f of h)i.initTexture(f);s.camera.layers.enableAll(),await i.compileAsync(s.scene,s.camera),await i.compileAsync(s.hud.scene,s.hud.camera);for(let f of r.beats)c.renderBeauty(f.t0+f.dur);c.renderBeauty(ee+1),c.renderBeauty(0)},setStep(h){let d=Zs(r,h);return c.renderBeauty(d),d},stepTime:h=>Zs(r,h),renderLayers:(h,d,f)=>l().renderLayers(h,d,f),parts:()=>s.registry.parts.map(h=>({part_id:h.part_id,name:h.name,cls:h.cls,asset_sha256:h.asset_sha256})),setProbe(h){for(let d of a)d.visible=h},expected:h=>"expected"in s?s.expected(h):null,dispose(){s.scene.traverse(h=>{h.geometry?.dispose?.()})}}}function pv(i){let t=(r,s)=>Ye(new rn({color:s,transparent:!0,opacity:.5,depthTest:!1,depthWrite:!1,toneMapped:!1}),r,!0),e=new Vt(new fe(1e3,1e3),t("probe-fx-front",65535));e.name="probe-fx-front",e.position.z=-5,e.frustumCulled=!1,e.renderOrder=999,e.layers.set(Jt["fx-front"]),i.camera.add(e),i.camera.parent||i.scene.add(i.camera);let n=new Vt(new fe(4e3,4e3),t("probe-ui",16711935));return n.name="probe-ui",n.frustumCulled=!1,n.renderOrder=999,n.layers.set(Jt.ui),i.hud.scene.add(n),[e,n]}function mv(i){return tr(i.trim().toLowerCase())}var gv={"49a7401dc52a86d430b5bd19b7370cfcb9c43c2ed939544ba0d1af4869c05624":{label:{en:"Oil and vinegar",es:"Aceite y vinagre"}},"6864c7c5474ec1f3c0109e1d10b9e71f7cc2b4a69a68359c8b6b43ce86596c6b":{each:{one:{en:"slice",es:"rebanada"},other:{en:"slices",es:"rebanadas"}}},bd3da3e78e76cb1952256002b7ca284d03433fc9e7a73d45fef3124be7f348f6:{handful:{min:20,max:25,typical:22,noun:{en:"chips",es:"papitas"}}}};function xf(i){return gv[mv(i)]??null}function vf(i){return i==="stage"?"stage-show":"studio-3d"}function yf(i,t,e={}){i.forEach((s,a)=>{if(s.n!==a+1)throw new Error(`crunchy-adapter: step order broken at "${s.key}" (n=${s.n}, expected ${a+1})`)});let n=new Map(t.steps.map(s=>[s.key,s.rep])),r=new Set(i.map(s=>s.key));for(let s of Object.keys(e))if(!r.has(s))throw new Error(`crunchy-adapter: how-to note for unknown step "${s}"`);return i.map(s=>{let a=n.get(s.key);if(!a)throw new Error(`crunchy-adapter: look plan has no entry for step "${s.key}"`);let o={n:s.n,key:s.key,action:s.action,ingredient:s.ingredient,amount:s.amount,label:s.label,drawn:a==="drawn"};return e[s.key]&&(o.howto={...e[s.key]}),o})}function bf(i,t){if(!i.ingredient||!t||i.amount===null)return;let e=t.label?.es??i.ingredient,n=i.amount;return i.presentation==="handful"?n="un pu\xF1ado":t.each&&i.count!==null&&(n=`${i.count} ${i.count===1?t.each.one.es:t.each.other.es}`),{label:`${e} \xB7 ${n}`,draft:!0}}function Ih(i,t){let e=new Set(t),n=i.filter(r=>!e.has(r));if(n.length)throw new Error(`crunchy-web: ${n.length} part(s) not in the card's part inventory`)}function Mf(i,t){let e=t.filter(r=>r.ingredient!==null).sort((r,s)=>r.n-s.n),n=new Map(e.map((r,s)=>[r.ingredient,s+1]));return i.map(r=>n.get(r.name)??0)}function Sf(i,t,e){let n=new Map;i.forEach((a,o)=>{for(let l of a.objects)n.has(l)||n.set(l,t[o]??0)});let r=new Map,s=()=>{for(let[a,o]of r)a.position.y-=o;r=new Map};return{restore:s,apply(a){s();let o=Math.min(1,Math.max(0,a));if(o!==0)for(let[l,c]of n){if(c===0)continue;let h=c*o*e;l.position.y+=h,r.set(l,h)}}}}function _v(i){let t=new URL(i,location.href);if(t.origin!==location.origin)throw new Error(`crunchy-web: refusing off-origin asset ${t.href}`);return t.href}function xv(i){for(let e=i;e;e=e.parent)if(!e.visible)return!1;let t=i;return!(t.isInstancedMesh&&t.count===0)}function Ef(i,t){return yf(i.steps,t,i.notes).map((e,n)=>{let r=bf(i.steps[n],i.steps[n].ingredient?xf(i.steps[n].ingredient):null);return r?{...e,i18n:{es:{...e.i18n?.es,label:r.label,draft:!0}}}:e})}function wf(i){i.traverse(t=>{let e=t;e.geometry?.dispose?.();for(let n of Array.isArray(e.material)?e.material:e.material?[e.material]:[])n.dispose()})}function l1(i){return async(t,e)=>{let n=await i(),r=vf(e.look),s=gf(t,1,{antialias:e.quality!=="phone"}),a=(v,M,y)=>{s.setPixelRatio(Math.min(2,Math.max(.5,v*y/Ce.w))),s.setSize(Ce.w,Ce.h,!1)},o=Ce.w/Ce.h;if(r==="stage-show"){let v=await Promise.all(n.assets.map(async w=>{let I=await fetch(_v(w.url));if(!I.ok)throw new Error(`crunchy-web: ${w.asset_id} HTTP ${I.status}`);return{asset_id:w.asset_id,sha256:w.sha256,bytes:new Uint8Array(await I.arrayBuffer())}})),M=await mf(v),y=_f(s,{look:r,variant:"c1",steps:n.steps,layout:n.layout,textures:M});Ih(y.parts().map(w=>w.name),n.inventory),await y.prepare();let C=Ef(n,y.plan),x=y.plan.drawnFood.length>0||y.parts().some(w=>w.cls==="drawn");return{steps:C,duration:y.duration,canExplode:!1,aspect:o,stepTime:w=>w<=0?0:y.stepTime(Math.min(w,C.length)),render:w=>y.render(w),drawnVisible:()=>x,resize:a,dispose(){y.dispose();for(let w of M.values())w.dispose();s.dispose(),s.forceContextLoss()}}}let l=xl(r,"b",new Set),c=yl;vl(c,n.steps.length);let h=Dl(n.steps,c,n.layout),d=h.registry.parts;Ih(d.map(v=>v.name),n.inventory);let f=Ef(n,l),p=h.pose.bind(h);h.pose(c.duration);let _=new wn;for(let v of d)for(let M of v.objects)_.expandByObject(M);let b=Sf(d,Mf(d,n.steps),_.getSize(new U).x*.022),g=0;h.pose=v=>{b.restore(),p(v),b.apply(g)};let m=Ks(s,h,{w:4,h:4}),E=new Set;for(let v of[h.scene,h.hud.scene])v.traverse(M=>{let y=M.material;for(let C of y?Array.isArray(y)?y:[y]:[])for(let x of Object.values(C))x&&x.isTexture&&E.add(x)});for(let v of E)s.initTexture(v);h.camera.layers.enableAll(),await s.compileAsync(h.scene,h.camera),await s.compileAsync(h.hud.scene,h.hud.camera);for(let v of c.beats)m.renderBeauty(v.t0+v.dur);m.renderBeauty(ee+1),m.renderBeauty(0);let T=!1;return{steps:f,duration:c.duration,canExplode:!0,aspect:o,stepTime:v=>v<=0?0:Zs(c,Math.min(v,f.length)),render(v,M){g=M.explode,m.renderBeauty(Math.min(c.duration,Math.max(0,v))),T=d.some(y=>y.cls==="drawn"&&y.objects.some(xv))},drawnVisible:()=>T,resize:a,dispose(){wf(h.scene),wf(h.hud.scene),s.dispose(),s.forceContextLoss()}}}}export{l1 as crunchyFactory};
