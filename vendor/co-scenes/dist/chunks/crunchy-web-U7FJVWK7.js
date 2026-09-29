var Mu=0,Sc=1,Su=2;var Is=1,mo=2,Nr=3,Jn=0,Nt=1,Ft=2,Kn=0,Pi=1,Ec=2,wc=3,Tc=4,Ls=5;var Ki=100,Eu=101,wu=102,Tu=103,Au=104,Ru=200,ji=201,Cu=202,Pu=203,Ac=204,Fr=205,Iu=206,Lu=207,Uu=208,Du=209,Nu=210,Fu=211,Ou=212,Bu=213,ku=214,La=0,Ua=1,Da=2,Tr=3,Na=4,Fa=5,Oa=6,Ba=7,go=0,Hu=1,zu=2,Sn=0,Rc=1,Cc=2,Pc=3,Ic=4,Lc=5,Uc=6,Dc=7;var Nc=300,Ii=301,Qi=302,xo=303,_o=304,Us=306,Ar=1e3,yn=1001,ka=1002,ut=1003,Vu=1004;var Ds=1005;var Xt=1006,yo=1007;var jn=1008;var Wt=1009,Fc=1010,Oc=1011,Or=1012,vo=1013,zn=1014,fn=1015,Vn=1016,bo=1017,Mo=1018,Br=1020,Bc=35902,kc=35899,Hc=1021,zc=1022,$t=1023,Yn=1026,Li=1027,So=1028,Eo=1029,Ui=1030,wo=1031;var To=1033,Ns=33776,Fs=33777,Os=33778,Bs=33779,Ao=35840,Ro=35841,Co=35842,Po=35843,Io=36196,Lo=37492,Uo=37496,Do=37488,No=37489,ks=37490,Fo=37491,Oo=37808,Bo=37809,ko=37810,Ho=37811,zo=37812,Vo=37813,Go=37814,Wo=37815,Xo=37816,qo=37817,Yo=37818,$o=37819,Zo=37820,Jo=37821,Ko=36492,jo=36494,Qo=36495,el=36283,tl=36284,Hs=36285,nl=36286;var ls=2300,Ha=2301,Ia=2302,fc=2303,pc=2400,mc=2401,gc=2402;var Gu=3200,zs=3201;var Vs=0,Wu=1,Zt="",Vt="srgb",Xi="srgb-linear",cs="linear",lt="srgb";var li=7680,Gs=7681;var Vc=517;var Ws=519,Xu=512,qu=513,Yu=514,il=515,$u=516,Zu=517,rl=518,Ju=519,Ku=35044,kr=35048;var Gc="300 es",kn=2e3,Rr=2001;function Vf(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Gf(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function hs(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function ju(){let i=hs("canvas");return i.style.display="block",i}var $h={},Cr=null;function Wc(...i){let e="THREE."+i.shift();Cr?Cr("log",e,...i):console.log(e,...i)}function Qu(i){let e=i[0];if(typeof e=="string"&&e.startsWith("TSL:")){let t=i[1];t&&t.isStackTrace?i[0]+=" "+t.getLocation():i[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return i}function He(...i){i=Qu(i);let e="THREE."+i.shift();if(Cr)Cr("warn",e,...i);else{let t=i[0];t&&t.isStackTrace?console.warn(t.getError(e)):console.warn(e,...i)}}function Ve(...i){i=Qu(i);let e="THREE."+i.shift();if(Cr)Cr("error",e,...i);else{let t=i[0];t&&t.isStackTrace?console.error(t.getError(e)):console.error(e,...i)}}function Wi(...i){let e=i.join(" ");e in $h||($h[e]=!0,He(...i))}function ed(i,e,t){return new Promise(function(n,r){function s(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:r();break;case i.TIMEOUT_EXPIRED:setTimeout(s,t);break;default:n()}}setTimeout(s,t)})}var td={[La]:Ua,[Da]:Oa,[Na]:Ba,[Tr]:Fa,[Ua]:La,[Oa]:Da,[Ba]:Na,[Fa]:Tr},$n=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let r=n[e];if(r!==void 0){let s=r.indexOf(t);s!==-1&&r.splice(s,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let r=n.slice(0);for(let s=0,a=r.length;s<a;s++)r[s].call(this,e);e.target=null}}},Qt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var zl=Math.PI/180,us=180/Math.PI;function Xs(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Qt[i&255]+Qt[i>>8&255]+Qt[i>>16&255]+Qt[i>>24&255]+"-"+Qt[e&255]+Qt[e>>8&255]+"-"+Qt[e>>16&15|64]+Qt[e>>24&255]+"-"+Qt[t&63|128]+Qt[t>>8&255]+"-"+Qt[t>>16&255]+Qt[t>>24&255]+Qt[n&255]+Qt[n>>8&255]+Qt[n>>16&255]+Qt[n>>24&255]).toLowerCase()}function Ke(i,e,t){return Math.max(e,Math.min(t,i))}function Wf(i,e){return(i%e+e)%e}function Vl(i,e,t){return(1-t)*i+t*e}function Qr(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:case Uint8ClampedArray:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function dn(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:case Uint8ClampedArray:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}var De=class i{static{i.prototype.isVector2=!0}constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("THREE.Vector2: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6],this.y=r[1]*t+r[4]*n+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Ke(this.x,e.x,t.x),this.y=Ke(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Ke(this.x,e,t),this.y=Ke(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Ke(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Ke(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),r=Math.sin(t),s=this.x-e.x,a=this.y-e.y;return this.x=s*n-a*r+e.x,this.y=s*r+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},tn=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,s,a,o){let l=n[r+0],c=n[r+1],h=n[r+2],u=n[r+3],d=s[a+0],f=s[a+1],g=s[a+2],v=s[a+3];if(u!==v||l!==d||c!==f||h!==g){let m=l*d+c*f+h*g+u*v;m<0&&(d=-d,f=-f,g=-g,v=-v,m=-m);let p=1-o;if(m<.9995){let w=Math.acos(m),T=Math.sin(w);p=Math.sin(p*w)/T,o=Math.sin(o*w)/T,l=l*p+d*o,c=c*p+f*o,h=h*p+g*o,u=u*p+v*o}else{l=l*p+d*o,c=c*p+f*o,h=h*p+g*o,u=u*p+v*o;let w=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=w,c*=w,h*=w,u*=w}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,s,a){let o=n[r],l=n[r+1],c=n[r+2],h=n[r+3],u=s[a],d=s[a+1],f=s[a+2],g=s[a+3];return e[t]=o*g+h*u+l*f-c*d,e[t+1]=l*g+h*d+c*u-o*f,e[t+2]=c*g+h*f+o*d-l*u,e[t+3]=h*g-o*u-l*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,s=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(r/2),u=o(s/2),d=l(n/2),f=l(r/2),g=l(s/2);switch(a){case"XYZ":this._x=d*h*u+c*f*g,this._y=c*f*u-d*h*g,this._z=c*h*g+d*f*u,this._w=c*h*u-d*f*g;break;case"YXZ":this._x=d*h*u+c*f*g,this._y=c*f*u-d*h*g,this._z=c*h*g-d*f*u,this._w=c*h*u+d*f*g;break;case"ZXY":this._x=d*h*u-c*f*g,this._y=c*f*u+d*h*g,this._z=c*h*g+d*f*u,this._w=c*h*u-d*f*g;break;case"ZYX":this._x=d*h*u-c*f*g,this._y=c*f*u+d*h*g,this._z=c*h*g-d*f*u,this._w=c*h*u+d*f*g;break;case"YZX":this._x=d*h*u+c*f*g,this._y=c*f*u+d*h*g,this._z=c*h*g-d*f*u,this._w=c*h*u-d*f*g;break;case"XZY":this._x=d*h*u-c*f*g,this._y=c*f*u-d*h*g,this._z=c*h*g+d*f*u,this._w=c*h*u+d*f*g;break;default:He("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],s=t[8],a=t[1],o=t[5],l=t[9],c=t[2],h=t[6],u=t[10],d=n+o+u;if(d>0){let f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-l)*f,this._y=(s-c)*f,this._z=(a-r)*f}else if(n>o&&n>u){let f=2*Math.sqrt(1+n-o-u);this._w=(h-l)/f,this._x=.25*f,this._y=(r+a)/f,this._z=(s+c)/f}else if(o>u){let f=2*Math.sqrt(1+o-n-u);this._w=(s-c)/f,this._x=(r+a)/f,this._y=.25*f,this._z=(l+h)/f}else{let f=2*Math.sqrt(1+u-n-o);this._w=(a-r)/f,this._x=(s+c)/f,this._y=(l+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ke(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,s=e._z,a=e._w,o=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+a*o+r*c-s*l,this._y=r*h+a*l+s*o-n*c,this._z=s*h+a*c+n*l-r*o,this._w=a*h-n*o-r*l-s*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,r=e._y,s=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,r=-r,s=-s,a=-a,o=-o);let l=1-t;if(o<.9995){let c=Math.acos(o),h=Math.sin(c);l=Math.sin(l*c)/h,t=Math.sin(t*c)/h,this._x=this._x*l+n*t,this._y=this._y*l+r*t,this._z=this._z*l+s*t,this._w=this._w*l+a*t,this._onChangeCallback()}else this._x=this._x*l+n*t,this._y=this._y*l+r*t,this._z=this._z*l+s*t,this._w=this._w*l+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},D=class i{static{i.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("THREE.Vector3: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Zh.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Zh.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6]*r,this.y=s[1]*t+s[4]*n+s[7]*r,this.z=s[2]*t+s[5]*n+s[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,s=e.elements,a=1/(s[3]*t+s[7]*n+s[11]*r+s[15]);return this.x=(s[0]*t+s[4]*n+s[8]*r+s[12])*a,this.y=(s[1]*t+s[5]*n+s[9]*r+s[13])*a,this.z=(s[2]*t+s[6]*n+s[10]*r+s[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,s=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*r-o*n),h=2*(o*t-s*r),u=2*(s*n-a*t);return this.x=t+l*c+a*u-o*h,this.y=n+l*h+o*c-s*u,this.z=r+l*u+s*h-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,s=e.elements;return this.x=s[0]*t+s[4]*n+s[8]*r,this.y=s[1]*t+s[5]*n+s[9]*r,this.z=s[2]*t+s[6]*n+s[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Ke(this.x,e.x,t.x),this.y=Ke(this.y,e.y,t.y),this.z=Ke(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Ke(this.x,e,t),this.y=Ke(this.y,e,t),this.z=Ke(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Ke(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,s=e.z,a=t.x,o=t.y,l=t.z;return this.x=r*l-s*o,this.y=s*a-n*l,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Gl.copy(this).projectOnVector(e),this.sub(Gl)}reflect(e){return this.sub(Gl.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Ke(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Gl=new D,Zh=new tn,Ge=class i{static{i.prototype.isMatrix3=!0}constructor(e,t,n,r,s,a,o,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,r,s,a,o,l,c)}set(e,t,n,r,s,a,o,l,c){let h=this.elements;return h[0]=e,h[1]=r,h[2]=o,h[3]=t,h[4]=s,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,s=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],u=n[7],d=n[2],f=n[5],g=n[8],v=r[0],m=r[3],p=r[6],w=r[1],T=r[4],y=r[7],b=r[2],S=r[5],C=r[8];return s[0]=a*v+o*w+l*b,s[3]=a*m+o*T+l*S,s[6]=a*p+o*y+l*C,s[1]=c*v+h*w+u*b,s[4]=c*m+h*T+u*S,s[7]=c*p+h*y+u*C,s[2]=d*v+f*w+g*b,s[5]=d*m+f*T+g*S,s[8]=d*p+f*y+g*C,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],s=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8];return t*a*h-t*o*c-n*s*h+n*o*l+r*s*c-r*a*l}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],s=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=h*a-o*c,d=o*l-h*s,f=c*s-a*l,g=t*u+n*d+r*f;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);let v=1/g;return e[0]=u*v,e[1]=(r*c-h*n)*v,e[2]=(o*n-r*a)*v,e[3]=d*v,e[4]=(h*t-r*l)*v,e[5]=(r*s-o*t)*v,e[6]=f*v,e[7]=(n*l-c*t)*v,e[8]=(a*t-n*s)*v,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,s,a,o){let l=Math.cos(s),c=Math.sin(s);return this.set(n*l,n*c,-n*(l*a+c*o)+a+e,-r*c,r*l,-r*(-c*a+l*o)+o+t,0,0,1),this}scale(e,t){return Wi("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(Wl.makeScale(e,t)),this}rotate(e){return Wi("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(Wl.makeRotation(-e)),this}translate(e,t){return Wi("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(Wl.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let r=0;r<9;r++)if(t[r]!==n[r])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Wl=new Ge,Jh=new Ge().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Kh=new Ge().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Xf(){let i={enabled:!0,workingColorSpace:Xi,spaces:{},convert:function(r,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===lt&&(r.r=ci(r.r),r.g=ci(r.g),r.b=ci(r.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(r.applyMatrix3(this.spaces[s].toXYZ),r.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===lt&&(r.r=wr(r.r),r.g=wr(r.g),r.b=wr(r.b))),r},workingToColorSpace:function(r,s){return this.convert(r,this.workingColorSpace,s)},colorSpaceToWorking:function(r,s){return this.convert(r,s,this.workingColorSpace)},getPrimaries:function(r){return this.spaces[r].primaries},getTransfer:function(r){return r===Zt?cs:this.spaces[r].transfer},getToneMappingMode:function(r){return this.spaces[r].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(r,s=this.workingColorSpace){return r.fromArray(this.spaces[s].luminanceCoefficients)},define:function(r){Object.assign(this.spaces,r)},_getMatrix:function(r,s,a){return r.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(r){return this.spaces[r].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(r=this.workingColorSpace){return this.spaces[r].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(r,s){return Wi("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),i.workingToColorSpace(r,s)},toWorkingColorSpace:function(r,s){return Wi("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),i.colorSpaceToWorking(r,s)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Xi]:{primaries:e,whitePoint:n,transfer:cs,toXYZ:Jh,fromXYZ:Kh,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:Vt},outputColorSpaceConfig:{drawingBufferColorSpace:Vt}},[Vt]:{primaries:e,whitePoint:n,transfer:lt,toXYZ:Jh,fromXYZ:Kh,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:Vt}}}),i}var Je=Xf();function ci(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function wr(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var ur,za=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{ur===void 0&&(ur=hs("canvas")),ur.width=e.width,ur.height=e.height;let r=ur.getContext("2d");e instanceof ImageData?r.putImageData(e,0,0):r.drawImage(e,0,0,e.width,e.height),n=ur}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=hs("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let r=n.getImageData(0,0,e.width,e.height),s=r.data;for(let a=0;a<s.length;a++)s[a]=ci(s[a]/255)*255;return n.putImageData(r,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(ci(t[n]/255)*255):t[n]=ci(t[n]);return{data:t,width:e.width,height:e.height}}else return He("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},qf=0,Pr=class{constructor(e=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:qf++}),this.uuid=Xs(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<"u"&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},r=this.data;if(r!==null){let s;if(Array.isArray(r)){s=[];for(let a=0,o=r.length;a<o;a++)r[a].isDataTexture?s.push(Xl(r[a].image)):s.push(Xl(r[a]))}else s=Xl(r);n.url=s}return t||(e.images[this.uuid]=n),n}};function Xl(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?za.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(He("Texture: Unable to serialize Texture."),{})}var Yf=0,ql=new D,ln=class i extends $n{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=yn,r=yn,s=Xt,a=jn,o=$t,l=Wt,c=i.DEFAULT_ANISOTROPY,h=Zt){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Yf++}),this.uuid=Xs(),this.name="",this.source=new Pr(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=r,this.magFilter=s,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new De(0,0),this.repeat=new De(1,1),this.center=new De(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ge,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(ql).x}get height(){return this.source.getSize(ql).y}get depth(){return this.source.getSize(ql).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){He(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){He(`Texture.setValues(): property '${t}' does not exist.`);continue}r&&n&&r.isVector2&&n.isVector2||r&&n&&r.isVector3&&n.isVector3||r&&n&&r.isMatrix3&&n.isMatrix3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Nc)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Ar:e.x=e.x-Math.floor(e.x);break;case yn:e.x=e.x<0?0:1;break;case ka:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Ar:e.y=e.y-Math.floor(e.y);break;case yn:e.y=e.y<0?0:1;break;case ka:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};ln.DEFAULT_IMAGE=null;ln.DEFAULT_MAPPING=Nc;ln.DEFAULT_ANISOTROPY=1;var St=class i{static{i.prototype.isVector4=!0}constructor(e=0,t=0,n=0,r=1){this.x=e,this.y=t,this.z=n,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("THREE.Vector4: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,s=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*s,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*s,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*s,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,s,l=e.elements,c=l[0],h=l[4],u=l[8],d=l[1],f=l[5],g=l[9],v=l[2],m=l[6],p=l[10];if(Math.abs(h-d)<.01&&Math.abs(u-v)<.01&&Math.abs(g-m)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+v)<.1&&Math.abs(g+m)<.1&&Math.abs(c+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let T=(c+1)/2,y=(f+1)/2,b=(p+1)/2,S=(h+d)/4,C=(u+v)/4,_=(g+m)/4;return T>y&&T>b?T<.01?(n=0,r=.707106781,s=.707106781):(n=Math.sqrt(T),r=S/n,s=C/n):y>b?y<.01?(n=.707106781,r=0,s=.707106781):(r=Math.sqrt(y),n=S/r,s=_/r):b<.01?(n=.707106781,r=.707106781,s=0):(s=Math.sqrt(b),n=C/s,r=_/s),this.set(n,r,s,t),this}let w=Math.sqrt((m-g)*(m-g)+(u-v)*(u-v)+(d-h)*(d-h));return Math.abs(w)<.001&&(w=1),this.x=(m-g)/w,this.y=(u-v)/w,this.z=(d-h)/w,this.w=Math.acos((c+f+p-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Ke(this.x,e.x,t.x),this.y=Ke(this.y,e.y,t.y),this.z=Ke(this.z,e.z,t.z),this.w=Ke(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Ke(this.x,e,t),this.y=Ke(this.y,e,t),this.z=Ke(this.z,e,t),this.w=Ke(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Ke(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Va=class extends $n{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Xt,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new St(0,0,e,t),this.scissorTest=!1,this.viewport=new St(0,0,e,t),this.textures=[];let r={width:e,height:t,depth:n.depth},s=new ln(r),a=n.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveColorBuffer=n.resolveColorBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.storeMultisampledColorBuffer=n.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=n.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=n.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(e={}){let t={minFilter:Xt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),e!==null&&e.renderTarget===null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let r=0,s=this.textures.length;r<s;r++)this.textures[r].image.width=e,this.textures[r].image.height=t,this.textures[r].image.depth=n,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let r=Object.assign({},e.textures[t].image);this.textures[t].source=new Pr(r)}if(this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveColorBuffer=e.resolveColorBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,this.storeMultisampledColorBuffer=e.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=e.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=e.storeMultisampledStencilBuffer,e.depthTexture!==null)if(e.depthTexture.renderTarget===e){let t=e.depthTexture.clone();t.renderTarget=null,this.depthTexture=t}else this.depthTexture=e.depthTexture;return this.samples=e.samples,this.multiview=e.multiview,this.useArrayDepthTexture=e.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},qt=class extends Va{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},ds=class extends ln{constructor(e=null,t=1,n=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=ut,this.minFilter=ut,this.wrapR=yn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Ga=class extends ln{constructor(e=null,t=1,n=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=ut,this.minFilter=ut,this.wrapR=yn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}};var je=class i{static{i.prototype.isMatrix4=!0}constructor(e,t,n,r,s,a,o,l,c,h,u,d,f,g,v,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,r,s,a,o,l,c,h,u,d,f,g,v,m)}set(e,t,n,r,s,a,o,l,c,h,u,d,f,g,v,m){let p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=r,p[1]=s,p[5]=a,p[9]=o,p[13]=l,p[2]=c,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=g,p[11]=v,p[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,r=1/dr.setFromMatrixColumn(e,0).length(),s=1/dr.setFromMatrixColumn(e,1).length(),a=1/dr.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*s,t[5]=n[5]*s,t[6]=n[6]*s,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,s=e.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(r),c=Math.sin(r),h=Math.cos(s),u=Math.sin(s);if(e.order==="XYZ"){let d=a*h,f=a*u,g=o*h,v=o*u;t[0]=l*h,t[4]=-l*u,t[8]=c,t[1]=f+g*c,t[5]=d-v*c,t[9]=-o*l,t[2]=v-d*c,t[6]=g+f*c,t[10]=a*l}else if(e.order==="YXZ"){let d=l*h,f=l*u,g=c*h,v=c*u;t[0]=d+v*o,t[4]=g*o-f,t[8]=a*c,t[1]=a*u,t[5]=a*h,t[9]=-o,t[2]=f*o-g,t[6]=v+d*o,t[10]=a*l}else if(e.order==="ZXY"){let d=l*h,f=l*u,g=c*h,v=c*u;t[0]=d-v*o,t[4]=-a*u,t[8]=g+f*o,t[1]=f+g*o,t[5]=a*h,t[9]=v-d*o,t[2]=-a*c,t[6]=o,t[10]=a*l}else if(e.order==="ZYX"){let d=a*h,f=a*u,g=o*h,v=o*u;t[0]=l*h,t[4]=g*c-f,t[8]=d*c+v,t[1]=l*u,t[5]=v*c+d,t[9]=f*c-g,t[2]=-c,t[6]=o*l,t[10]=a*l}else if(e.order==="YZX"){let d=a*l,f=a*c,g=o*l,v=o*c;t[0]=l*h,t[4]=v-d*u,t[8]=g*u+f,t[1]=u,t[5]=a*h,t[9]=-o*h,t[2]=-c*h,t[6]=f*u+g,t[10]=d-v*u}else if(e.order==="XZY"){let d=a*l,f=a*c,g=o*l,v=o*c;t[0]=l*h,t[4]=-u,t[8]=c*h,t[1]=d*u+v,t[5]=a*h,t[9]=f*u-g,t[2]=g*u-f,t[6]=o*h,t[10]=v*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose($f,e,Zf)}lookAt(e,t,n){let r=this.elements;return xn.subVectors(e,t),xn.lengthSq()===0&&(xn.z=1),xn.normalize(),xi.crossVectors(n,xn),xi.lengthSq()===0&&(Math.abs(n.z)===1?xn.x+=1e-4:xn.z+=1e-4,xn.normalize(),xi.crossVectors(n,xn)),xi.normalize(),ca.crossVectors(xn,xi),r[0]=xi.x,r[4]=ca.x,r[8]=xn.x,r[1]=xi.y,r[5]=ca.y,r[9]=xn.y,r[2]=xi.z,r[6]=ca.z,r[10]=xn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,s=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],u=n[5],d=n[9],f=n[13],g=n[2],v=n[6],m=n[10],p=n[14],w=n[3],T=n[7],y=n[11],b=n[15],S=r[0],C=r[4],_=r[8],E=r[12],I=r[1],N=r[5],P=r[9],F=r[13],U=r[2],H=r[6],q=r[10],Y=r[14],ce=r[3],G=r[7],J=r[11],W=r[15];return s[0]=a*S+o*I+l*U+c*ce,s[4]=a*C+o*N+l*H+c*G,s[8]=a*_+o*P+l*q+c*J,s[12]=a*E+o*F+l*Y+c*W,s[1]=h*S+u*I+d*U+f*ce,s[5]=h*C+u*N+d*H+f*G,s[9]=h*_+u*P+d*q+f*J,s[13]=h*E+u*F+d*Y+f*W,s[2]=g*S+v*I+m*U+p*ce,s[6]=g*C+v*N+m*H+p*G,s[10]=g*_+v*P+m*q+p*J,s[14]=g*E+v*F+m*Y+p*W,s[3]=w*S+T*I+y*U+b*ce,s[7]=w*C+T*N+y*H+b*G,s[11]=w*_+T*P+y*q+b*J,s[15]=w*E+T*F+y*Y+b*W,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],s=e[12],a=e[1],o=e[5],l=e[9],c=e[13],h=e[2],u=e[6],d=e[10],f=e[14],g=e[3],v=e[7],m=e[11],p=e[15],w=l*f-c*d,T=o*f-c*u,y=o*d-l*u,b=a*f-c*h,S=a*d-l*h,C=a*u-o*h;return t*(v*w-m*T+p*y)-n*(g*w-m*b+p*S)+r*(g*T-v*b+p*C)-s*(g*y-v*S+m*C)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],r=e[8],s=e[1],a=e[5],o=e[9],l=e[2],c=e[6],h=e[10];return t*(a*h-o*c)-n*(s*h-o*l)+r*(s*c-a*l)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],s=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=e[9],d=e[10],f=e[11],g=e[12],v=e[13],m=e[14],p=e[15],w=t*o-n*a,T=t*l-r*a,y=t*c-s*a,b=n*l-r*o,S=n*c-s*o,C=r*c-s*l,_=h*v-u*g,E=h*m-d*g,I=h*p-f*g,N=u*m-d*v,P=u*p-f*v,F=d*p-f*m,U=w*F-T*P+y*N+b*I-S*E+C*_;if(U===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let H=1/U;return e[0]=(o*F-l*P+c*N)*H,e[1]=(r*P-n*F-s*N)*H,e[2]=(v*C-m*S+p*b)*H,e[3]=(d*S-u*C-f*b)*H,e[4]=(l*I-a*F-c*E)*H,e[5]=(t*F-r*I+s*E)*H,e[6]=(m*y-g*C-p*T)*H,e[7]=(h*C-d*y+f*T)*H,e[8]=(a*P-o*I+c*_)*H,e[9]=(n*I-t*P-s*_)*H,e[10]=(g*S-v*y+p*w)*H,e[11]=(u*y-h*S-f*w)*H,e[12]=(o*E-a*N-l*_)*H,e[13]=(t*N-n*E+r*_)*H,e[14]=(v*T-g*b-m*w)*H,e[15]=(h*b-u*T+d*w)*H,this}scale(e){let t=this.elements,n=e.x,r=e.y,s=e.z;return t[0]*=n,t[4]*=r,t[8]*=s,t[1]*=n,t[5]*=r,t[9]*=s,t[2]*=n,t[6]*=r,t[10]*=s,t[3]*=n,t[7]*=r,t[11]*=s,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),s=1-n,a=e.x,o=e.y,l=e.z,c=s*a,h=s*o;return this.set(c*a+n,c*o-r*l,c*l+r*o,0,c*o+r*l,h*o+n,h*l-r*a,0,c*l-r*o,h*l+r*a,s*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,s,a){return this.set(1,n,s,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,s=t._x,a=t._y,o=t._z,l=t._w,c=s+s,h=a+a,u=o+o,d=s*c,f=s*h,g=s*u,v=a*h,m=a*u,p=o*u,w=l*c,T=l*h,y=l*u,b=n.x,S=n.y,C=n.z;return r[0]=(1-(v+p))*b,r[1]=(f+y)*b,r[2]=(g-T)*b,r[3]=0,r[4]=(f-y)*S,r[5]=(1-(d+p))*S,r[6]=(m+w)*S,r[7]=0,r[8]=(g+T)*C,r[9]=(m-w)*C,r[10]=(1-(d+v))*C,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let s=this.determinantAffine();if(s===0)return n.set(1,1,1),t.identity(),this;let a=dr.set(r[0],r[1],r[2]).length(),o=dr.set(r[4],r[5],r[6]).length(),l=dr.set(r[8],r[9],r[10]).length();s<0&&(a=-a),Nn.copy(this);let c=1/a,h=1/o,u=1/l;return Nn.elements[0]*=c,Nn.elements[1]*=c,Nn.elements[2]*=c,Nn.elements[4]*=h,Nn.elements[5]*=h,Nn.elements[6]*=h,Nn.elements[8]*=u,Nn.elements[9]*=u,Nn.elements[10]*=u,t.setFromRotationMatrix(Nn),n.x=a,n.y=o,n.z=l,this}makePerspective(e,t,n,r,s,a,o=kn,l=!1){let c=this.elements,h=2*s/(t-e),u=2*s/(n-r),d=(t+e)/(t-e),f=(n+r)/(n-r),g,v;if(l)g=s/(a-s),v=a*s/(a-s);else if(o===kn)g=-(a+s)/(a-s),v=-2*a*s/(a-s);else if(o===Rr)g=-a/(a-s),v=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=g,c[14]=v,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,r,s,a,o=kn,l=!1){let c=this.elements,h=2/(t-e),u=2/(n-r),d=-(t+e)/(t-e),f=-(n+r)/(n-r),g,v;if(l)g=1/(a-s),v=a/(a-s);else if(o===kn)g=-2/(a-s),v=-(a+s)/(a-s);else if(o===Rr)g=-1/(a-s),v=-s/(a-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=h,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=g,c[14]=v,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let r=0;r<16;r++)if(t[r]!==n[r])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},dr=new D,Nn=new je,$f=new D(0,0,0),Zf=new D(1,1,1),xi=new D,ca=new D,xn=new D,jh=new je,Qh=new tn,cn=class i{constructor(e=0,t=0,n=0,r=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=r}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,r=this._order){return this._x=e,this._y=t,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let r=e.elements,s=r[0],a=r[4],o=r[8],l=r[1],c=r[5],h=r[9],u=r[2],d=r[6],f=r[10];switch(t){case"XYZ":this._y=Math.asin(Ke(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(d,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ke(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,s),this._z=0);break;case"ZXY":this._x=Math.asin(Ke(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Ke(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Ke(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,s)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-Ke(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-h,f),this._y=0);break;default:He("Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return jh.makeRotationFromQuaternion(e),this.setFromRotationMatrix(jh,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Qh.setFromEuler(this),this.setFromQuaternion(Qh,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};cn.DEFAULT_ORDER="XYZ";var fs=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},Jf=0,eu=new D,fr=new tn,ii=new je,ha=new D,es=new D,Kf=new D,jf=new tn,tu=new D(1,0,0),nu=new D(0,1,0),iu=new D(0,0,1),ru={type:"added"},Qf={type:"removed"},pr={type:"childadded",child:null},Yl={type:"childremoved",child:null},wt=class i extends $n{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Jf++}),this.uuid=Xs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new D,t=new cn,n=new tn,r=new D(1,1,1);function s(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(s),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:r},modelViewMatrix:{value:new je},normalMatrix:{value:new Ge}}),this.matrix=new je,this.matrixWorld=new je,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new fs,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return fr.setFromAxisAngle(e,t),this.quaternion.multiply(fr),this}rotateOnWorldAxis(e,t){return fr.setFromAxisAngle(e,t),this.quaternion.premultiply(fr),this}rotateX(e){return this.rotateOnAxis(tu,e)}rotateY(e){return this.rotateOnAxis(nu,e)}rotateZ(e){return this.rotateOnAxis(iu,e)}translateOnAxis(e,t){return eu.copy(e).applyQuaternion(this.quaternion),this.position.add(eu.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(tu,e)}translateY(e){return this.translateOnAxis(nu,e)}translateZ(e){return this.translateOnAxis(iu,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(ii.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?ha.copy(e):ha.set(e,t,n);let r=this.parent;this.updateWorldMatrix(!0,!1),es.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?ii.lookAt(es,ha,this.up):ii.lookAt(ha,es,this.up),this.quaternion.setFromRotationMatrix(ii),r&&(ii.extractRotation(r.matrixWorld),fr.setFromRotationMatrix(ii),this.quaternion.premultiply(fr.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(Ve("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(ru),pr.child=e,this.dispatchEvent(pr),pr.child=null):Ve("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Qf),Yl.child=e,this.dispatchEvent(Yl),Yl.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),ii.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),ii.multiply(e.parent.matrixWorld)),e.applyMatrix4(ii),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(ru),pr.child=e,this.dispatchEvent(pr),pr.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,r=this.children.length;n<r;n++){let a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let r=this.children;for(let s=0,a=r.length;s<a;s++)r[s].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(es,e,Kf),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(es,jf,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}intersectsFrustum(){}traverse(e){e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,r=e.z,s=this.matrix.elements;s[12]+=t-s[0]*t-s[4]*n-s[8]*r,s[13]+=n-s[1]*t-s[5]*n-s[9]*r,s[14]+=r-s[2]*t-s[6]*n-s[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let r=this.parent;if(e===!0&&r!==null&&r.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let s=this.children;for(let a=0,o=s.length;a<o;a++)s[a].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let r={};r.uuid=this.uuid,r.type=this.type,r.name=this.name,r.castShadow=this.castShadow,r.receiveShadow=this.receiveShadow,r.visible=this.visible,r.frustumCulled=this.frustumCulled,r.renderOrder=this.renderOrder,r.static=this.static,r.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type="InstancedMesh",r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type="BatchedMesh",r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(o=>({...o})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=s(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let u=l[c];s(e.shapes,u)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(s(e.materials,this.material[l]));r.material=o}else r.material=s(e.materials,this.material);if(this.children.length>0){r.children=[];for(let o=0;o<this.children.length;o++)r.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];r.animations.push(s(e.animations,l))}}if(t){let o=a(e.geometries),l=a(e.materials),c=a(e.textures),h=a(e.images),u=a(e.shapes),d=a(e.skeletons),f=a(e.animations),g=a(e.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),g.length>0&&(n.nodes=g)}return n.object=r,n;function a(o){let l=[];for(let c in o){let h=o[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let r=e.children[n];this.add(r.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}};wt.DEFAULT_UP=new D(0,1,0);wt.DEFAULT_MATRIX_AUTO_UPDATE=!0;wt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Ut=class extends wt{constructor(){super(),this.isGroup=!0,this.type="Group"}},ep={type:"move"},Ir=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ut,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ut,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new D,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new D),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ut,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new D,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new D,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let r=null,s=null,a=null,o=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(let v of e.hand.values()){let m=t.getJointPose(v,n),p=this._getHandJoint(c,v);m!==null&&(p.matrix.fromArray(m.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=m.radius),p.visible=m!==null}let h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,g=.005;c.inputState.pinching&&d>f+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&d<=f-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=t.getPose(e.gripSpace,n),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));o!==null&&(r=t.getPose(e.targetRaySpace,n),r===null&&s!==null&&(r=s),r!==null&&(o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,r.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(r.linearVelocity)):o.hasLinearVelocity=!1,r.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(r.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(ep)))}return o!==null&&(o.visible=r!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new Ut;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},nd={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},_i={h:0,s:0,l:0},ua={h:0,s:0,l:0};function $l(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var We=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let r=e;r&&r.isColor?this.copy(r):typeof r=="number"?this.setHex(r):typeof r=="string"&&this.setStyle(r)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Vt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Je.colorSpaceToWorking(this,t),this}setRGB(e,t,n,r=Je.workingColorSpace){return this.r=e,this.g=t,this.b=n,Je.colorSpaceToWorking(this,r),this}setHSL(e,t,n,r=Je.workingColorSpace){if(e=Wf(e,1),t=Ke(t,0,1),n=Ke(n,0,1),t===0)this.r=this.g=this.b=n;else{let s=n<=.5?n*(1+t):n+t-n*t,a=2*n-s;this.r=$l(a,s,e+1/3),this.g=$l(a,s,e),this.b=$l(a,s,e-1/3)}return Je.colorSpaceToWorking(this,r),this}setStyle(e,t=Vt){function n(s){s!==void 0&&parseFloat(s)<1&&He("Color: Alpha component of "+e+" will be ignored.")}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let s,a=r[1],o=r[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:He("Color: Unknown color model "+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let s=r[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(s,16),t);He("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Vt){let n=nd[e.toLowerCase()];return n!==void 0?this.setHex(n,t):He("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=ci(e.r),this.g=ci(e.g),this.b=ci(e.b),this}copyLinearToSRGB(e){return this.r=wr(e.r),this.g=wr(e.g),this.b=wr(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Vt){return Je.workingToColorSpace(en.copy(this),e),Math.round(Ke(en.r*255,0,255))*65536+Math.round(Ke(en.g*255,0,255))*256+Math.round(Ke(en.b*255,0,255))}getHexString(e=Vt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Je.workingColorSpace){Je.workingToColorSpace(en.copy(this),t);let n=en.r,r=en.g,s=en.b,a=Math.max(n,r,s),o=Math.min(n,r,s),l,c,h=(o+a)/2;if(o===a)l=0,c=0;else{let u=a-o;switch(c=h<=.5?u/(a+o):u/(2-a-o),a){case n:l=(r-s)/u+(r<s?6:0);break;case r:l=(s-n)/u+2;break;case s:l=(n-r)/u+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=Je.workingColorSpace){return Je.workingToColorSpace(en.copy(this),t),e.r=en.r,e.g=en.g,e.b=en.b,e}getStyle(e=Vt){Je.workingToColorSpace(en.copy(this),e);let t=en.r,n=en.g,r=en.b;return e!==Vt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(r*255)})`}offsetHSL(e,t,n){return this.getHSL(_i),this.setHSL(_i.h+e,_i.s+t,_i.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(_i),e.getHSL(ua);let n=Vl(_i.h,ua.h,t),r=Vl(_i.s,ua.s,t),s=Vl(_i.l,ua.l,t);return this.setHSL(n,r,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,r=this.b,s=e.elements;return this.r=s[0]*t+s[3]*n+s[6]*r,this.g=s[1]*t+s[4]*n+s[7]*r,this.b=s[2]*t+s[5]*n+s[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},en=new We;We.NAMES=nd;var vn=class extends wt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new cn,this.environmentIntensity=1,this.environmentRotation=new cn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),t.object.backgroundBlurriness=this.backgroundBlurriness,t.object.backgroundIntensity=this.backgroundIntensity,t.object.backgroundRotation=this.backgroundRotation.toArray(),t.object.environmentIntensity=this.environmentIntensity,t.object.environmentRotation=this.environmentRotation.toArray(),t}},Fn=new D,ri=new D,Zl=new D,si=new D,mr=new D,gr=new D,su=new D,Jl=new D,Kl=new D,jl=new D,Ql=new St,ec=new St,tc=new St,Mi=class i{constructor(e=new D,t=new D,n=new D){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,r){r.subVectors(n,t),Fn.subVectors(e,t),r.cross(Fn);let s=r.lengthSq();return s>0?r.multiplyScalar(1/Math.sqrt(s)):r.set(0,0,0)}static getBarycoord(e,t,n,r,s){Fn.subVectors(r,t),ri.subVectors(n,t),Zl.subVectors(e,t);let a=Fn.dot(Fn),o=Fn.dot(ri),l=Fn.dot(Zl),c=ri.dot(ri),h=ri.dot(Zl),u=a*c-o*o;if(u===0)return s.set(0,0,0),null;let d=1/u,f=(c*l-o*h)*d,g=(a*h-o*l)*d;return s.set(1-f-g,g,f)}static containsPoint(e,t,n,r){return this.getBarycoord(e,t,n,r,si)===null?!1:si.x>=0&&si.y>=0&&si.x+si.y<=1}static getInterpolation(e,t,n,r,s,a,o,l){return this.getBarycoord(e,t,n,r,si)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,si.x),l.addScaledVector(a,si.y),l.addScaledVector(o,si.z),l)}static getInterpolatedAttribute(e,t,n,r,s,a){return Ql.setScalar(0),ec.setScalar(0),tc.setScalar(0),Ql.fromBufferAttribute(e,t),ec.fromBufferAttribute(e,n),tc.fromBufferAttribute(e,r),a.setScalar(0),a.addScaledVector(Ql,s.x),a.addScaledVector(ec,s.y),a.addScaledVector(tc,s.z),a}static isFrontFacing(e,t,n,r){return Fn.subVectors(n,t),ri.subVectors(e,t),Fn.cross(ri).dot(r)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,r){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,n,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Fn.subVectors(this.c,this.b),ri.subVectors(this.a,this.b),Fn.cross(ri).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,r,s){return i.getInterpolation(e,this.a,this.b,this.c,t,n,r,s)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,r=this.b,s=this.c,a,o;mr.subVectors(r,n),gr.subVectors(s,n),Jl.subVectors(e,n);let l=mr.dot(Jl),c=gr.dot(Jl);if(l<=0&&c<=0)return t.copy(n);Kl.subVectors(e,r);let h=mr.dot(Kl),u=gr.dot(Kl);if(h>=0&&u<=h)return t.copy(r);let d=l*u-h*c;if(d<=0&&l>=0&&h<=0)return a=l/(l-h),t.copy(n).addScaledVector(mr,a);jl.subVectors(e,s);let f=mr.dot(jl),g=gr.dot(jl);if(g>=0&&f<=g)return t.copy(s);let v=f*c-l*g;if(v<=0&&c>=0&&g<=0)return o=c/(c-g),t.copy(n).addScaledVector(gr,o);let m=h*g-f*u;if(m<=0&&u-h>=0&&f-g>=0)return su.subVectors(s,r),o=(u-h)/(u-h+(f-g)),t.copy(r).addScaledVector(su,o);let p=1/(m+v+d);return a=v*p,o=d*p,t.copy(n).addScaledVector(mr,a).addScaledVector(gr,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Rn=class{constructor(e=new D(1/0,1/0,1/0),t=new D(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(On.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(On.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=On.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let s=n.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,On):On.fromBufferAttribute(s,a),On.applyMatrix4(e.matrixWorld),this.expandByPoint(On);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),da.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),da.copy(n.boundingBox)),da.applyMatrix4(e.matrixWorld),this.union(da)}let r=e.children;for(let s=0,a=r.length;s<a;s++)this.expandByObject(r[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,On),On.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ts),fa.subVectors(this.max,ts),xr.subVectors(e.a,ts),_r.subVectors(e.b,ts),yr.subVectors(e.c,ts),yi.subVectors(_r,xr),vi.subVectors(yr,_r),Hi.subVectors(xr,yr);let t=[0,-yi.z,yi.y,0,-vi.z,vi.y,0,-Hi.z,Hi.y,yi.z,0,-yi.x,vi.z,0,-vi.x,Hi.z,0,-Hi.x,-yi.y,yi.x,0,-vi.y,vi.x,0,-Hi.y,Hi.x,0];return!nc(t,xr,_r,yr,fa)||(t=[1,0,0,0,1,0,0,0,1],!nc(t,xr,_r,yr,fa))?!1:(pa.crossVectors(yi,vi),t=[pa.x,pa.y,pa.z],nc(t,xr,_r,yr,fa))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,On).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(On).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(ai[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),ai[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),ai[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),ai[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),ai[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),ai[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),ai[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),ai[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(ai),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},ai=[new D,new D,new D,new D,new D,new D,new D,new D],On=new D,da=new Rn,xr=new D,_r=new D,yr=new D,yi=new D,vi=new D,Hi=new D,ts=new D,fa=new D,pa=new D,zi=new D;function nc(i,e,t,n,r){for(let s=0,a=i.length-3;s<=a;s+=3){zi.fromArray(i,s);let o=r.x*Math.abs(zi.x)+r.y*Math.abs(zi.y)+r.z*Math.abs(zi.z),l=e.dot(zi),c=t.dot(zi),h=n.dot(zi);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}var It=new D,ma=new De,tp=0,Dt=class extends $n{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:tp++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Ku,this.updateRanges=[],this.gpuType=fn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let r=0,s=this.itemSize;r<s;r++)this.array[e+r]=t.array[n+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)ma.fromBufferAttribute(this,t),ma.applyMatrix3(e),this.setXY(t,ma.x,ma.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)It.fromBufferAttribute(this,t),It.applyMatrix3(e),this.setXYZ(t,It.x,It.y,It.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)It.fromBufferAttribute(this,t),It.applyMatrix4(e),this.setXYZ(t,It.x,It.y,It.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)It.fromBufferAttribute(this,t),It.applyNormalMatrix(e),this.setXYZ(t,It.x,It.y,It.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)It.fromBufferAttribute(this,t),It.transformDirection(e),this.setXYZ(t,It.x,It.y,It.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Qr(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=dn(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Qr(t,this.array)),t}setX(e,t){return this.normalized&&(t=dn(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Qr(t,this.array)),t}setY(e,t){return this.normalized&&(t=dn(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Qr(t,this.array)),t}setZ(e,t){return this.normalized&&(t=dn(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Qr(t,this.array)),t}setW(e,t){return this.normalized&&(t=dn(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=dn(t,this.array),n=dn(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,r){return e*=this.itemSize,this.normalized&&(t=dn(t,this.array),n=dn(n,this.array),r=dn(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this}setXYZW(e,t,n,r,s){return e*=this.itemSize,this.normalized&&(t=dn(t,this.array),n=dn(n,this.array),r=dn(r,this.array),s=dn(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return e.name=this.name,e.usage=this.usage,e.gpuType=this.gpuType,e}dispose(){this.dispatchEvent({type:"dispose"})}};var ps=class extends Dt{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var ms=class extends Dt{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var nt=class extends Dt{constructor(e,t,n){super(new Float32Array(e),t,n)}},np=new Rn,ns=new D,ic=new D,hi=class{constructor(e=new D,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):np.setFromPoints(e).getCenter(n);let r=0;for(let s=0,a=e.length;s<a;s++)r=Math.max(r,n.distanceToSquared(e[s]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;ns.subVectors(e,this.center);let t=ns.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),r=(n-this.radius)*.5;this.center.addScaledVector(ns,r/n),this.radius+=r}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(ic.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(ns.copy(e.center).add(ic)),this.expandByPoint(ns.copy(e.center).sub(ic))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},ip=0,An=new je,rc=new wt,vr=new D,_n=new Rn,is=new Rn,zt=new D,Tt=class i extends $n{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:ip++}),this.uuid=Xs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Vf(e)?ms:ps)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let s=new Ge().getNormalMatrix(e);n.applyNormalMatrix(s),n.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return An.makeRotationFromQuaternion(e),this.applyMatrix4(An),this}rotateX(e){return An.makeRotationX(e),this.applyMatrix4(An),this}rotateY(e){return An.makeRotationY(e),this.applyMatrix4(An),this}rotateZ(e){return An.makeRotationZ(e),this.applyMatrix4(An),this}translate(e,t,n){return An.makeTranslation(e,t,n),this.applyMatrix4(An),this}scale(e,t,n){return An.makeScale(e,t,n),this.applyMatrix4(An),this}lookAt(e){return rc.lookAt(e),rc.updateMatrix(),this.applyMatrix4(rc.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(vr).negate(),this.translate(vr.x,vr.y,vr.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let r=0,s=e.length;r<s;r++){let a=e[r];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new nt(n,3))}else{let n=Math.min(e.length,t.count);for(let r=0;r<n;r++){let s=e[r];t.setXYZ(r,s.x,s.y,s.z||0)}e.length>t.count&&He("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Rn);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Ve("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new D(-1/0,-1/0,-1/0),new D(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,r=t.length;n<r;n++){let s=t[n];_n.setFromBufferAttribute(s),this.morphTargetsRelative?(zt.addVectors(this.boundingBox.min,_n.min),this.boundingBox.expandByPoint(zt),zt.addVectors(this.boundingBox.max,_n.max),this.boundingBox.expandByPoint(zt)):(this.boundingBox.expandByPoint(_n.min),this.boundingBox.expandByPoint(_n.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Ve('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new hi);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Ve("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new D,1/0);return}if(e){let n=this.boundingSphere.center;if(_n.setFromBufferAttribute(e),t)for(let s=0,a=t.length;s<a;s++){let o=t[s];is.setFromBufferAttribute(o),this.morphTargetsRelative?(zt.addVectors(_n.min,is.min),_n.expandByPoint(zt),zt.addVectors(_n.max,is.max),_n.expandByPoint(zt)):(_n.expandByPoint(is.min),_n.expandByPoint(is.max))}_n.getCenter(n);let r=0;for(let s=0,a=e.count;s<a;s++)zt.fromBufferAttribute(e,s),r=Math.max(r,n.distanceToSquared(zt));if(t)for(let s=0,a=t.length;s<a;s++){let o=t[s],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)zt.fromBufferAttribute(o,c),l&&(vr.fromBufferAttribute(e,c),zt.add(vr)),r=Math.max(r,n.distanceToSquared(zt))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&Ve('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){Ve("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,r=t.normal,s=t.uv,a=this.getAttribute("tangent");(a===void 0||a.count!==n.count)&&(a=new Dt(new Float32Array(4*n.count),4),this.setAttribute("tangent",a));let o=[],l=[];for(let _=0;_<n.count;_++)o[_]=new D,l[_]=new D;let c=new D,h=new D,u=new D,d=new De,f=new De,g=new De,v=new D,m=new D;function p(_,E,I){c.fromBufferAttribute(n,_),h.fromBufferAttribute(n,E),u.fromBufferAttribute(n,I),d.fromBufferAttribute(s,_),f.fromBufferAttribute(s,E),g.fromBufferAttribute(s,I),h.sub(c),u.sub(c),f.sub(d),g.sub(d);let N=1/(f.x*g.y-g.x*f.y);isFinite(N)&&(v.copy(h).multiplyScalar(g.y).addScaledVector(u,-f.y).multiplyScalar(N),m.copy(u).multiplyScalar(f.x).addScaledVector(h,-g.x).multiplyScalar(N),o[_].add(v),o[E].add(v),o[I].add(v),l[_].add(m),l[E].add(m),l[I].add(m))}let w=this.groups;w.length===0&&(w=[{start:0,count:e.count}]);for(let _=0,E=w.length;_<E;++_){let I=w[_],N=I.start,P=I.count;for(let F=N,U=N+P;F<U;F+=3)p(e.getX(F+0),e.getX(F+1),e.getX(F+2))}let T=new D,y=new D,b=new D,S=new D;function C(_){b.fromBufferAttribute(r,_),S.copy(b);let E=o[_];T.copy(E),T.sub(b.multiplyScalar(b.dot(E))).normalize(),y.crossVectors(S,E);let N=y.dot(l[_])<0?-1:1;a.setXYZW(_,T.x,T.y,T.z,N)}for(let _=0,E=w.length;_<E;++_){let I=w[_],N=I.start,P=I.count;for(let F=N,U=N+P;F<U;F+=3)C(e.getX(F+0)),C(e.getX(F+1)),C(e.getX(F+2))}this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0||n.count!==t.count)n=new Dt(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);let r=new D,s=new D,a=new D,o=new D,l=new D,c=new D,h=new D,u=new D;if(e)for(let d=0,f=e.count;d<f;d+=3){let g=e.getX(d+0),v=e.getX(d+1),m=e.getX(d+2);r.fromBufferAttribute(t,g),s.fromBufferAttribute(t,v),a.fromBufferAttribute(t,m),h.subVectors(a,s),u.subVectors(r,s),h.cross(u),o.fromBufferAttribute(n,g),l.fromBufferAttribute(n,v),c.fromBufferAttribute(n,m),o.add(h),l.add(h),c.add(h),n.setXYZ(g,o.x,o.y,o.z),n.setXYZ(v,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let d=0,f=t.count;d<f;d+=3)r.fromBufferAttribute(t,d+0),s.fromBufferAttribute(t,d+1),a.fromBufferAttribute(t,d+2),h.subVectors(a,s),u.subVectors(r,s),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)zt.fromBufferAttribute(e,t),zt.normalize(),e.setXYZ(t,zt.x,zt.y,zt.z)}toNonIndexed(){function e(o,l){let c=o.array,h=o.itemSize,u=o.normalized,d=new c.constructor(l.length*h),f=0,g=0;for(let v=0,m=l.length;v<m;v++){o.isInterleavedBufferAttribute?f=l[v]*o.data.stride+o.offset:f=l[v]*h;for(let p=0;p<h;p++)d[g++]=c[f++]}return new Dt(d,h,u)}if(this.index===null)return He("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,r=this.attributes;for(let o in r){let l=r[o],c=e(l,n);t.setAttribute(o,c)}let s=this.morphAttributes;for(let o in s){let l=[],c=s[o];for(let h=0,u=c.length;h<u;h++){let d=c[h],f=e(d,n);l.push(f)}t.morphAttributes[o]=l}t.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,l=a.length;o<l;o++){let c=a[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,e.name=this.name,Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let c=n[l];e.data.attributes[l]=c.toJSON(e.data)}let r={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let u=0,d=c.length;u<d;u++){let f=c[u];h.push(f.toJSON(e.data))}h.length>0&&(r[l]=h,s=!0)}s&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let r=e.attributes;for(let c in r){let h=r[c];this.setAttribute(c,h.clone(t))}let s=e.morphAttributes;for(let c in s){let h=[],u=s[c];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let c=0,h=a.length;c<h;c++){let u=a[c];this.addGroup(u.start,u.count,u.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}};var sc=new D,rp=new D,sp=new Ge,Bn=class{constructor(e=new D(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=sc.subVectors(n,t).cross(rp.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let r=e.delta(sc),s=this.normal.dot(r);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/s;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||sp.getNormalMatrix(e),r=this.coplanarPoint(sc).applyMatrix4(e),s=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},ap=0,Cn=class extends $n{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:ap++}),this.uuid=Xs(),this.name="",this.type="Material",this.blending=Pi,this.side=Jn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Ac,this.blendDst=Fr,this.blendEquation=Ki,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new We(0,0,0),this.blendAlpha=0,this.depthFunc=Tr,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Ws,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=li,this.stencilZFail=li,this.stencilZPass=li,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){He(`Material: parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){He(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(n):r&&r.isVector2&&n&&n.isVector2||r&&r.isEuler&&n&&n.isEuler||r&&r.isVector3&&n&&n.isVector3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(s=>s.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function r(s){let a=[];for(let o in s){let l=s[o];delete l.metadata,a.push(l)}return a}if(t){let s=r(e.textures),a=r(e.images);s.length>0&&(n.textures=s),a.length>0&&(n.images=a)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new We().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.retroreflectivity!==void 0&&(this.retroreflectivity=e.retroreflectivity),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=e.iridescenceThicknessRange),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.clippingPlanes!==void 0&&(this.clippingPlanes=e.clippingPlanes.map(n=>new Bn().fromJSON(n))),e.clipIntersection!==void 0&&(this.clipIntersection=e.clipIntersection),e.clipShadows!==void 0&&(this.clipShadows=e.clipShadows),e.depthPacking!==void 0&&(this.depthPacking=e.depthPacking),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.linecap!==void 0&&(this.linecap=e.linecap),e.linejoin!==void 0&&(this.linejoin=e.linejoin),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(typeof e.vertexColors=="number"?this.vertexColors=e.vertexColors>0:this.vertexColors=e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let n=e.normalScale;Array.isArray(n)===!1&&(n=[n,n]),this.normalScale=new De().fromArray(n)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new De().fromArray(e.clearcoatNormalScale)),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let r=t.length;n=new Array(r);for(let s=0;s!==r;++s)n[s]=t[s].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var oi=new D,ac=new D,ga=new D,xa=new D,gs=class{constructor(e=new D,t=new D(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,oi)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=oi.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(oi.copy(this.origin).addScaledVector(this.direction,t),oi.distanceToSquared(e))}distanceSqToSegment(e,t,n,r){ac.copy(e).add(t).multiplyScalar(.5),ga.copy(t).sub(e).normalize(),xa.copy(this.origin).sub(ac);let s=e.distanceTo(t)*.5,a=-this.direction.dot(ga),o=xa.dot(this.direction),l=-xa.dot(ga),c=xa.lengthSq(),h=Math.abs(1-a*a),u,d,f,g;if(h>0)if(u=a*l-o,d=a*o-l,g=s*h,u>=0)if(d>=-g)if(d<=g){let v=1/h;u*=v,d*=v,f=u*(u+a*d+2*o)+d*(a*u+d+2*l)+c}else d=s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d=-s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d<=-g?(u=Math.max(0,-(-a*s+o)),d=u>0?-s:Math.min(Math.max(-s,-l),s),f=-u*u+d*(d+2*l)+c):d<=g?(u=0,d=Math.min(Math.max(-s,-l),s),f=d*(d+2*l)+c):(u=Math.max(0,-(a*s+o)),d=u>0?s:Math.min(Math.max(-s,-l),s),f=-u*u+d*(d+2*l)+c);else d=a>0?-s:s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),r&&r.copy(ac).addScaledVector(ga,d),f}intersectSphere(e,t){if(e.radius<0)return null;oi.subVectors(e.center,this.origin);let n=oi.dot(this.direction),r=oi.dot(oi)-n*n,s=e.radius*e.radius;if(r>s)return null;let a=Math.sqrt(s-r),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,r,s,a,o,l,c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,r=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,r=(e.min.x-d.x)*c),h>=0?(s=(e.min.y-d.y)*h,a=(e.max.y-d.y)*h):(s=(e.max.y-d.y)*h,a=(e.min.y-d.y)*h),n>a||s>r||((s>n||isNaN(n))&&(n=s),(a<r||isNaN(r))&&(r=a),u>=0?(o=(e.min.z-d.z)*u,l=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,l=(e.min.z-d.z)*u),n>l||o>r)||((o>n||n!==n)&&(n=o),(l<r||r!==r)&&(r=l),r<0)?null:this.at(n>=0?n:r,t)}intersectsBox(e){return this.intersectBox(e,oi)!==null}intersectTriangle(e,t,n,r,s){let a=this.origin,o=this.direction,l=o.x,c=o.y,h=o.z,u=e.x-a.x,d=e.y-a.y,f=e.z-a.z,g=t.x-a.x,v=t.y-a.y,m=t.z-a.z,p=n.x-a.x,w=n.y-a.y,T=n.z-a.z,y=Math.abs(l),b=Math.abs(c),S=Math.abs(h),C,_,E,I,N,P,F,U,H,q,Y,ce;if(y>=b&&y>=S?(E=l,P=u,H=g,ce=p,l>=0?(C=c,_=h,I=d,N=f,F=v,U=m,q=w,Y=T):(C=h,_=c,I=f,N=d,F=m,U=v,q=T,Y=w)):b>=S?(E=c,P=d,H=v,ce=w,c>=0?(C=h,_=l,I=f,N=u,F=m,U=g,q=T,Y=p):(C=l,_=h,I=u,N=f,F=g,U=m,q=p,Y=T)):(E=h,P=f,H=m,ce=T,h>=0?(C=l,_=c,I=u,N=d,F=g,U=v,q=p,Y=w):(C=c,_=l,I=d,N=u,F=v,U=g,q=w,Y=p)),E===0)return null;let G=C/E,J=_/E,W=1/E,ue=I-G*P,pe=N-J*P,Me=F-G*H,Se=U-J*H,de=q-G*ce,X=Y-J*ce,ne=de*Se-X*Me,ye=ue*X-pe*de,Pe=Me*pe-Se*ue;if(r){if(ne<0||ye<0||Pe<0)return null}else if((ne<0||ye<0||Pe<0)&&(ne>0||ye>0||Pe>0))return null;let _e=ne+ye+Pe;if(_e===0)return null;let Ce=W*(ne*P+ye*H+Pe*ce);return(_e>0?Ce<0:Ce>0)?null:this.at(Ce/_e,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},nn=class extends Cn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new We(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cn,this.combine=go,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},au=new je,Vi=new gs,_a=new hi,ou=new D,ya=new D,va=new D,ba=new D,oc=new D,Ma=new D,lu=new D,Sa=new D,Oe=class extends wt{constructor(e=new Tt,t=new nn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let r=t[n[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=r.length;s<a;s++){let o=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(e,t){let n=this.geometry,r=n.attributes.position,s=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(r,e);let o=this.morphTargetInfluences;if(s&&o){Ma.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let h=o[l],u=s[l];h!==0&&(oc.fromBufferAttribute(u,e),a?Ma.addScaledVector(oc,h):Ma.addScaledVector(oc.sub(t),h))}t.add(Ma)}return t}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.material,s=this.matrixWorld;r!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),_a.copy(n.boundingSphere),_a.applyMatrix4(s),Vi.copy(e.ray).recast(e.near),!(_a.containsPoint(Vi.origin)===!1&&(Vi.intersectSphere(_a,ou)===null||Vi.origin.distanceToSquared(ou)>(e.far-e.near)**2))&&(au.copy(s).invert(),Vi.copy(e.ray).applyMatrix4(au),!(n.boundingBox!==null&&Vi.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Vi)))}_computeIntersections(e,t,n){let r,s=this.geometry,a=this.material,o=s.index,l=s.attributes.position,c=s.attributes.uv,h=s.attributes.uv1,u=s.attributes.normal,d=s.groups,f=s.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,v=d.length;g<v;g++){let m=d[g],p=a[m.materialIndex],w=Math.max(m.start,f.start),T=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let y=w,b=T;y<b;y+=3){let S=o.getX(y),C=o.getX(y+1),_=o.getX(y+2);r=Ea(this,p,e,n,c,h,u,S,C,_),r&&(r.faceIndex=Math.floor(y/3),r.face.materialIndex=m.materialIndex,t.push(r))}}else{let g=Math.max(0,f.start),v=Math.min(o.count,f.start+f.count);for(let m=g,p=v;m<p;m+=3){let w=o.getX(m),T=o.getX(m+1),y=o.getX(m+2);r=Ea(this,a,e,n,c,h,u,w,T,y),r&&(r.faceIndex=Math.floor(m/3),t.push(r))}}else if(l!==void 0)if(Array.isArray(a))for(let g=0,v=d.length;g<v;g++){let m=d[g],p=a[m.materialIndex],w=Math.max(m.start,f.start),T=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let y=w,b=T;y<b;y+=3){let S=y,C=y+1,_=y+2;r=Ea(this,p,e,n,c,h,u,S,C,_),r&&(r.faceIndex=Math.floor(y/3),r.face.materialIndex=m.materialIndex,t.push(r))}}else{let g=Math.max(0,f.start),v=Math.min(l.count,f.start+f.count);for(let m=g,p=v;m<p;m+=3){let w=m,T=m+1,y=m+2;r=Ea(this,a,e,n,c,h,u,w,T,y),r&&(r.faceIndex=Math.floor(m/3),t.push(r))}}}};function op(i,e,t,n,r,s,a,o){let l;if(e.side===Nt?l=n.intersectTriangle(a,s,r,!0,o):l=n.intersectTriangle(r,s,a,e.side===Jn,o),l===null)return null;Sa.copy(o),Sa.applyMatrix4(i.matrixWorld);let c=t.ray.origin.distanceTo(Sa);return c<t.near||c>t.far?null:{distance:c,point:Sa.clone(),object:i}}function Ea(i,e,t,n,r,s,a,o,l,c){i.getVertexPosition(o,ya),i.getVertexPosition(l,va),i.getVertexPosition(c,ba);let h=op(i,e,t,n,ya,va,ba,lu);if(h){let u=new D;Mi.getBarycoord(lu,ya,va,ba,u),r&&(h.uv=Mi.getInterpolatedAttribute(r,o,l,c,u,new De)),s&&(h.uv1=Mi.getInterpolatedAttribute(s,o,l,c,u,new De)),a&&(h.normal=Mi.getInterpolatedAttribute(a,o,l,c,u,new D),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let d={a:o,b:l,c,normal:new D,materialIndex:0};Mi.getNormal(ya,va,ba,d.normal),h.face=d,h.barycoord=u}return h}var qi=class extends ln{constructor(e=null,t=1,n=1,r,s,a,o,l,c=ut,h=ut,u,d){super(null,a,o,l,c,h,r,s,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var xs=class extends Dt{constructor(e,t,n,r=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},br=new je,cu=new je,wa=[],hu=new Rn,lp=new je,rs=new Oe,ss=new hi,Zn=class extends Oe{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new xs(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let r=0;r<n;r++)this.setMatrixAt(r,lp)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Rn),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,br),hu.copy(e.boundingBox).applyMatrix4(br),this.boundingBox.union(hu)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new hi),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,br),ss.copy(e.boundingSphere).applyMatrix4(br),this.boundingSphere.union(ss)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,r=this.morphTexture.source.data.data,s=n.length+1,a=e*s+1;for(let o=0;o<n.length;o++)n[o]=r[a+o]}raycast(e,t){let n=this.matrixWorld,r=this.count;if(rs.geometry=this.geometry,rs.material=this.material,rs.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),ss.copy(this.boundingSphere),ss.applyMatrix4(n),e.ray.intersectsSphere(ss)!==!1))for(let s=0;s<r;s++){this.getMatrixAt(s,br),cu.multiplyMatrices(n,br),rs.matrixWorld=cu,rs.raycast(e,wa);for(let a=0,o=wa.length;a<o;a++){let l=wa[a];l.instanceId=s,l.object=this,t.push(l)}wa.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new xs(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,r=n.length+1;this.morphTexture===null&&(this.morphTexture=new qi(new Float32Array(r*this.count),r,this.count,So,fn));let s=this.morphTexture.source.data.data,a=0;for(let c=0;c<n.length;c++)a+=n[c];let o=this.geometry.morphTargetsRelative?1:1-a,l=r*e;return s[l]=o,s.set(n,l+1),this}updateMorphTargets(){}dispose(){super.dispose(),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},Gi=new hi,cp=new De(.5,.5),Ta=new D,Lr=class{constructor(e=new Bn,t=new Bn,n=new Bn,r=new Bn,s=new Bn,a=new Bn){this.planes=[e,t,n,r,s,a]}set(e,t,n,r,s,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(r),o[4].copy(s),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=kn,n=!1){let r=this.planes,s=e.elements,a=s[0],o=s[1],l=s[2],c=s[3],h=s[4],u=s[5],d=s[6],f=s[7],g=s[8],v=s[9],m=s[10],p=s[11],w=s[12],T=s[13],y=s[14],b=s[15];if(r[0].setComponents(c-a,f-h,p-g,b-w).normalize(),r[1].setComponents(c+a,f+h,p+g,b+w).normalize(),r[2].setComponents(c+o,f+u,p+v,b+T).normalize(),r[3].setComponents(c-o,f-u,p-v,b-T).normalize(),n)r[4].setComponents(l,d,m,y).normalize(),r[5].setComponents(c-l,f-d,p-m,b-y).normalize();else if(r[4].setComponents(c-l,f-d,p-m,b-y).normalize(),t===kn)r[5].setComponents(c+l,f+d,p+m,b+y).normalize();else if(t===Rr)r[5].setComponents(l,d,m,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Gi.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Gi.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Gi)}intersectsSprite(e){Gi.center.set(0,0,0);let t=cp.distanceTo(e.center);return Gi.radius=.7071067811865476+t,Gi.applyMatrix4(e.matrixWorld),this.intersectsSphere(Gi)}intersectsSphere(e){let t=this.planes,n=e.center,r=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(n)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let r=t[n];if(Ta.x=r.normal.x>0?e.max.x:e.min.x,Ta.y=r.normal.y>0?e.max.y:e.min.y,Ta.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(Ta)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var Wa=class extends Cn{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new We(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},uu=new je,xc=new gs,Aa=new hi,Ra=new D,_s=class extends wt{constructor(e=new Tt,t=new Wa){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.matrixWorld,s=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Aa.copy(n.boundingSphere),Aa.applyMatrix4(r),Aa.radius+=s,e.ray.intersectsSphere(Aa)===!1)return;uu.copy(r).invert(),xc.copy(e.ray).applyMatrix4(uu);let o=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=n.index,u=n.attributes.position;if(c!==null){let d=Math.max(0,a.start),f=Math.min(c.count,a.start+a.count);for(let g=d,v=f;g<v;g++){let m=c.getX(g);Ra.fromBufferAttribute(u,m),du(Ra,m,l,r,e,t,this)}}else{let d=Math.max(0,a.start),f=Math.min(u.count,a.start+a.count);for(let g=d,v=f;g<v;g++)Ra.fromBufferAttribute(u,g),du(Ra,g,l,r,e,t,this)}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let r=t[n[0]];if(r!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=r.length;s<a;s++){let o=r[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}};function du(i,e,t,n,r,s,a){let o=xc.distanceSqToPoint(i);if(o<t){let l=new D;xc.closestPointToPoint(i,l),l.applyMatrix4(n);let c=r.ray.origin.distanceTo(l);if(c<r.near||c>r.far)return;s.push({distance:c,distanceToRay:Math.sqrt(o),point:l,index:e,face:null,faceIndex:null,barycoord:null,object:a})}}var ys=class extends ln{constructor(e=[],t=Ii,n,r,s,a,o,l,c,h){super(e,t,n,r,s,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Si=class extends ln{constructor(e,t,n,r,s,a,o,l,c){super(e,t,n,r,s,a,o,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}};var Ei=class extends ln{constructor(e,t,n=zn,r,s,a,o=ut,l=ut,c,h=Yn,u=1){if(h!==Yn&&h!==Li)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let d={width:e,height:t,depth:u};super(d,r,s,a,o,l,h,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Pr(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return t.compareFunction=this.compareFunction,t}},Xa=class extends Ei{constructor(e,t=zn,n=Ii,r,s,a=ut,o=ut,l,c=Yn){let h={width:e,height:e,depth:1},u=[h,h,h,h,h,h];super(e,e,t,n,r,s,a,o,l,c),this.image=u,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},vs=class extends ln{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Hn=class i extends Tt{constructor(e=1,t=1,n=1,r=1,s=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:r,heightSegments:s,depthSegments:a};let o=this;r=Math.floor(r),s=Math.floor(s),a=Math.floor(a);let l=[],c=[],h=[],u=[],d=0,f=0;g("z","y","x",-1,-1,n,t,e,a,s,0),g("z","y","x",1,-1,n,t,-e,a,s,1),g("x","z","y",1,1,e,n,t,r,a,2),g("x","z","y",1,-1,e,n,-t,r,a,3),g("x","y","z",1,-1,e,t,n,r,s,4),g("x","y","z",-1,-1,e,t,-n,r,s,5),this.setIndex(l),this.setAttribute("position",new nt(c,3)),this.setAttribute("normal",new nt(h,3)),this.setAttribute("uv",new nt(u,2));function g(v,m,p,w,T,y,b,S,C,_,E){let I=y/C,N=b/_,P=y/2,F=b/2,U=S/2,H=C+1,q=_+1,Y=0,ce=0,G=new D;for(let J=0;J<q;J++){let W=J*N-F;for(let ue=0;ue<H;ue++){let pe=ue*I-P;G[v]=pe*w,G[m]=W*T,G[p]=U,c.push(G.x,G.y,G.z),G[v]=0,G[m]=0,G[p]=S>0?1:-1,h.push(G.x,G.y,G.z),u.push(ue/C),u.push(1-J/_),Y+=1}}for(let J=0;J<_;J++)for(let W=0;W<C;W++){let ue=d+W+H*J,pe=d+W+H*(J+1),Me=d+(W+1)+H*(J+1),Se=d+(W+1)+H*J;l.push(ue,pe,Se),l.push(pe,Me,Se),ce+=6}o.addGroup(f,ce,E),f+=ce,d+=Y}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var bs=class i extends Tt{constructor(e=1,t=32,n=0,r=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:r},t=Math.max(3,t);let s=[],a=[],o=[],l=[],c=new D,h=new De;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let u=0,d=3;u<=t;u++,d+=3){let f=n+u/t*r;c.x=e*Math.cos(f),c.y=e*Math.sin(f),a.push(c.x,c.y,c.z),o.push(0,0,1),h.x=(a[d]/e+1)/2,h.y=(a[d+1]/e+1)/2,l.push(h.x,h.y)}for(let u=1;u<=t;u++)s.push(u,u+1,0);this.setIndex(s),this.setAttribute("position",new nt(a,3)),this.setAttribute("normal",new nt(o,3)),this.setAttribute("uv",new nt(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.segments,e.thetaStart,e.thetaLength)}};var qa=class i extends Tt{constructor(e=[],t=[],n=1,r=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:r};let s=[],a=[];o(r),c(n),h(),this.setAttribute("position",new nt(s,3)),this.setAttribute("normal",new nt(s.slice(),3)),this.setAttribute("uv",new nt(a,2)),r===0?this.computeVertexNormals():this.normalizeNormals();function o(w){let T=new D,y=new D,b=new D;for(let S=0;S<t.length;S+=3)f(t[S+0],T),f(t[S+1],y),f(t[S+2],b),l(T,y,b,w)}function l(w,T,y,b){let S=b+1,C=[];for(let _=0;_<=S;_++){C[_]=[];let E=w.clone().lerp(y,_/S),I=T.clone().lerp(y,_/S),N=S-_;for(let P=0;P<=N;P++)P===0&&_===S?C[_][P]=E:C[_][P]=E.clone().lerp(I,P/N)}for(let _=0;_<S;_++)for(let E=0;E<2*(S-_)-1;E++){let I=Math.floor(E/2);E%2===0?(d(C[_][I+1]),d(C[_+1][I]),d(C[_][I])):(d(C[_][I+1]),d(C[_+1][I+1]),d(C[_+1][I]))}}function c(w){let T=new D;for(let y=0;y<s.length;y+=3)T.x=s[y+0],T.y=s[y+1],T.z=s[y+2],T.normalize().multiplyScalar(w),s[y+0]=T.x,s[y+1]=T.y,s[y+2]=T.z}function h(){let w=new D;for(let T=0;T<s.length;T+=3){w.x=s[T+0],w.y=s[T+1],w.z=s[T+2];let y=m(w)/2/Math.PI+.5,b=p(w)/Math.PI+.5;a.push(y,1-b)}g(),u()}function u(){for(let w=0;w<a.length;w+=6){let T=a[w+0],y=a[w+2],b=a[w+4],S=Math.max(T,y,b),C=Math.min(T,y,b);S>.9&&C<.1&&(T<.2&&(a[w+0]+=1),y<.2&&(a[w+2]+=1),b<.2&&(a[w+4]+=1))}}function d(w){s.push(w.x,w.y,w.z)}function f(w,T){let y=w*3;T.x=e[y+0],T.y=e[y+1],T.z=e[y+2]}function g(){let w=new D,T=new D,y=new D,b=new D,S=new De,C=new De,_=new De;for(let E=0,I=0;E<s.length;E+=9,I+=6){w.set(s[E+0],s[E+1],s[E+2]),T.set(s[E+3],s[E+4],s[E+5]),y.set(s[E+6],s[E+7],s[E+8]),S.set(a[I+0],a[I+1]),C.set(a[I+2],a[I+3]),_.set(a[I+4],a[I+5]),b.copy(w).add(T).add(y).divideScalar(3);let N=m(b);v(S,I+0,w,N),v(C,I+2,T,N),v(_,I+4,y,N)}}function v(w,T,y,b){b<0&&w.x===1&&(a[T]=w.x-1),y.x===0&&y.z===0&&(a[T]=b/2/Math.PI+.5)}function m(w){return Math.atan2(w.z,-w.x)}function p(w){return Math.atan2(-w.y,Math.sqrt(w.x*w.x+w.z*w.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.vertices,e.indices,e.radius,e.detail)}};var Pn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){He("Curve: .getPoint() not implemented.")}getPointAt(e,t){let n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],n,r=this.getPoint(0),s=0;t.push(0);for(let a=1;a<=e;a++)n=this.getPoint(a/e),s+=n.distanceTo(r),t.push(s),r=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let n=this.getLengths(),r=0,s=n.length,a;t?a=t:a=e*n[s-1];let o=0,l=s-1,c;for(;o<=l;)if(r=Math.floor(o+(l-o)/2),c=n[r]-a,c<0)o=r+1;else if(c>0)l=r-1;else{l=r;break}if(r=l,n[r]===a)return r/(s-1);let h=n[r],d=n[r+1]-h,f=(a-h)/d;return(r+f)/(s-1)}getTangent(e,t){let r=e-1e-4,s=e+1e-4;r<0&&(r=0),s>1&&(s=1);let a=this.getPoint(r),o=this.getPoint(s),l=t||(a.isVector2?new De:new D);return l.copy(o).sub(a).normalize(),l}getTangentAt(e,t){let n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){let n=new D,r=[],s=[],a=[],o=new D,l=new je;for(let f=0;f<=e;f++){let g=f/e;r[f]=this.getTangentAt(g,new D)}s[0]=new D,a[0]=new D;let c=Number.MAX_VALUE,h=Math.abs(r[0].x),u=Math.abs(r[0].y),d=Math.abs(r[0].z);h<=c&&(c=h,n.set(1,0,0)),u<=c&&(c=u,n.set(0,1,0)),d<=c&&n.set(0,0,1),o.crossVectors(r[0],n).normalize(),s[0].crossVectors(r[0],o),a[0].crossVectors(r[0],s[0]);for(let f=1;f<=e;f++){if(s[f]=s[f-1].clone(),a[f]=a[f-1].clone(),o.crossVectors(r[f-1],r[f]),o.length()>Number.EPSILON){o.normalize();let g=Math.acos(Ke(r[f-1].dot(r[f]),-1,1));s[f].applyMatrix4(l.makeRotationAxis(o,g))}a[f].crossVectors(r[f],s[f])}if(t===!0){let f=Math.acos(Ke(s[0].dot(s[e]),-1,1));f/=e,r[0].dot(o.crossVectors(s[0],s[e]))>0&&(f=-f);for(let g=1;g<=e;g++)s[g].applyMatrix4(l.makeRotationAxis(r[g],f*g)),a[g].crossVectors(r[g],s[g])}return{tangents:r,normals:s,binormals:a}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},Ms=class extends Pn{constructor(e=0,t=0,n=1,r=1,s=0,a=Math.PI*2,o=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=r,this.aStartAngle=s,this.aEndAngle=a,this.aClockwise=o,this.aRotation=l}getPoint(e,t=new De){let n=t,r=Math.PI*2,s=this.aEndAngle-this.aStartAngle,a=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=r;for(;s>r;)s-=r;s<Number.EPSILON&&(a?s=0:s=r),this.aClockwise===!0&&!a&&(s===r?s=-r:s=s-r);let o=this.aStartAngle+e*s,l=this.aX+this.xRadius*Math.cos(o),c=this.aY+this.yRadius*Math.sin(o);if(this.aRotation!==0){let h=Math.cos(this.aRotation),u=Math.sin(this.aRotation),d=l-this.aX,f=c-this.aY;l=d*h-f*u+this.aX,c=d*u+f*h+this.aY}return n.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},Ya=class extends Ms{constructor(e,t,n,r,s,a){super(e,t,n,n,r,s,a),this.isArcCurve=!0,this.type="ArcCurve"}};function Xc(){let i=0,e=0,t=0,n=0;function r(s,a,o,l){i=s,e=o,t=-3*s+3*a-2*o-l,n=2*s-2*a+o+l}return{initCatmullRom:function(s,a,o,l,c){r(a,o,c*(o-s),c*(l-a))},initNonuniformCatmullRom:function(s,a,o,l,c,h,u){let d=(a-s)/c-(o-s)/(c+h)+(o-a)/h,f=(o-a)/h-(l-a)/(h+u)+(l-o)/u;d*=h,f*=h,r(a,o,d,f)},calc:function(s){let a=s*s,o=a*s;return i+e*s+t*a+n*o}}}var fu=new D,pu=new D,lc=new Xc,cc=new Xc,hc=new Xc,Ur=class extends Pn{constructor(e=[],t=!1,n="centripetal",r=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=n,this.tension=r}getPoint(e,t=new D){let n=t,r=this.points,s=r.length,a=(s-(this.closed?0:1))*e,o=Math.floor(a),l=a-o;this.closed?o+=o>0?0:(Math.floor(Math.abs(o)/s)+1)*s:l===0&&o===s-1&&(o=s-2,l=1);let c,h;this.closed||o>0?c=r[(o-1)%s]:(pu.subVectors(r[0],r[1]).add(r[0]),c=pu);let u=r[o%s],d=r[(o+1)%s];if(this.closed||o+2<s?h=r[(o+2)%s]:(fu.subVectors(r[s-1],r[s-2]).add(r[s-1]),h=fu),this.curveType==="centripetal"||this.curveType==="chordal"){let f=this.curveType==="chordal"?.5:.25,g=Math.pow(c.distanceToSquared(u),f),v=Math.pow(u.distanceToSquared(d),f),m=Math.pow(d.distanceToSquared(h),f);v<1e-4&&(v=1),g<1e-4&&(g=v),m<1e-4&&(m=v),lc.initNonuniformCatmullRom(c.x,u.x,d.x,h.x,g,v,m),cc.initNonuniformCatmullRom(c.y,u.y,d.y,h.y,g,v,m),hc.initNonuniformCatmullRom(c.z,u.z,d.z,h.z,g,v,m)}else this.curveType==="catmullrom"&&(lc.initCatmullRom(c.x,u.x,d.x,h.x,this.tension),cc.initCatmullRom(c.y,u.y,d.y,h.y,this.tension),hc.initCatmullRom(c.z,u.z,d.z,h.z,this.tension));return n.set(lc.calc(l),cc.calc(l),hc.calc(l)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let r=e.points[t];this.points.push(r.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let r=this.points[t];e.points.push(r.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let r=e.points[t];this.points.push(new D().fromArray(r))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function mu(i,e,t,n,r){let s=(n-e)*.5,a=(r-t)*.5,o=i*i,l=i*o;return(2*t-2*n+s+a)*l+(-3*t+3*n-2*s-a)*o+s*i+t}function hp(i,e){let t=1-i;return t*t*e}function up(i,e){return 2*(1-i)*i*e}function dp(i,e){return i*i*e}function as(i,e,t,n){return hp(i,e)+up(i,t)+dp(i,n)}function fp(i,e){let t=1-i;return t*t*t*e}function pp(i,e){let t=1-i;return 3*t*t*i*e}function mp(i,e){return 3*(1-i)*i*i*e}function gp(i,e){return i*i*i*e}function os(i,e,t,n,r){return fp(i,e)+pp(i,t)+mp(i,n)+gp(i,r)}var $a=class extends Pn{constructor(e=new De,t=new De,n=new De,r=new De){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=n,this.v3=r}getPoint(e,t=new De){let n=t,r=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(os(e,r.x,s.x,a.x,o.x),os(e,r.y,s.y,a.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Za=class extends Pn{constructor(e=new D,t=new D,n=new D,r=new D){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=n,this.v3=r}getPoint(e,t=new D){let n=t,r=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(os(e,r.x,s.x,a.x,o.x),os(e,r.y,s.y,a.y,o.y),os(e,r.z,s.z,a.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Ja=class extends Pn{constructor(e=new De,t=new De){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new De){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new De){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ka=class extends Pn{constructor(e=new D,t=new D){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new D){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new D){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},ja=class extends Pn{constructor(e=new De,t=new De,n=new De){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new De){let n=t,r=this.v0,s=this.v1,a=this.v2;return n.set(as(e,r.x,s.x,a.x),as(e,r.y,s.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ss=class extends Pn{constructor(e=new D,t=new D,n=new D){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new D){let n=t,r=this.v0,s=this.v1,a=this.v2;return n.set(as(e,r.x,s.x,a.x),as(e,r.y,s.y,a.y),as(e,r.z,s.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Qa=class extends Pn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new De){let n=t,r=this.points,s=(r.length-1)*e,a=Math.floor(s),o=s-a,l=r[a===0?a:a-1],c=r[a],h=r[a>r.length-2?r.length-1:a+1],u=r[a>r.length-3?r.length-1:a+2];return n.set(mu(o,l.x,c.x,h.x,u.x),mu(o,l.y,c.y,h.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let r=e.points[t];this.points.push(r.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let r=this.points[t];e.points.push(r.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let r=e.points[t];this.points.push(new De().fromArray(r))}return this}},xp=Object.freeze({__proto__:null,ArcCurve:Ya,CatmullRomCurve3:Ur,CubicBezierCurve:$a,CubicBezierCurve3:Za,EllipseCurve:Ms,LineCurve:Ja,LineCurve3:Ka,QuadraticBezierCurve:ja,QuadraticBezierCurve3:Ss,SplineCurve:Qa});var Es=class i extends qa{constructor(e=1,t=0){let n=(1+Math.sqrt(5))/2,r=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],s=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(r,s,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new i(e.radius,e.detail)}};var ct=class i extends Tt{constructor(e=1,t=1,n=1,r=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:r};let s=e/2,a=t/2,o=Math.floor(n),l=Math.floor(r),c=o+1,h=l+1,u=e/o,d=t/l,f=[],g=[],v=[],m=[];for(let p=0;p<h;p++){let w=p*d-a;for(let T=0;T<c;T++){let y=T*u-s;g.push(y,-w,0),v.push(0,0,1),m.push(T/o),m.push(1-p/l)}}for(let p=0;p<l;p++)for(let w=0;w<o;w++){let T=w+c*p,y=w+c*(p+1),b=w+1+c*(p+1),S=w+1+c*p;f.push(T,y,S),f.push(y,b,S)}this.setIndex(f),this.setAttribute("position",new nt(g,3)),this.setAttribute("normal",new nt(v,3)),this.setAttribute("uv",new nt(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}};var Yi=class i extends Tt{constructor(e=1,t=32,n=16,r=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:r,phiLength:s,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let l=Math.min(a+o,Math.PI),c=0,h=[],u=new D,d=new D,f=[],g=[],v=[],m=[];for(let p=0;p<=n;p++){let w=[],T=p/n,y=a+T*o,b=e*Math.cos(y),S=Math.sqrt(e*e-b*b),C=0;p===0&&a===0?C=.5/t:p===n&&l===Math.PI&&(C=-.5/t);for(let _=0;_<=t;_++){let E=_/t,I=r+E*s;u.x=-S*Math.cos(I),u.y=b,u.z=S*Math.sin(I),g.push(u.x,u.y,u.z),d.copy(u).normalize(),v.push(d.x,d.y,d.z),m.push(E+C,1-T),w.push(c++)}h.push(w)}for(let p=0;p<n;p++)for(let w=0;w<t;w++){let T=h[p][w+1],y=h[p][w],b=h[p+1][w],S=h[p+1][w+1];(p!==0||a>0)&&f.push(T,y,S),(p!==n-1||l<Math.PI)&&f.push(y,b,S)}this.setIndex(f),this.setAttribute("position",new nt(g,3)),this.setAttribute("normal",new nt(v,3)),this.setAttribute("uv",new nt(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var ws=class i extends Tt{constructor(e=1,t=.4,n=12,r=48,s=Math.PI*2,a=0,o=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:r,arc:s,thetaStart:a,thetaLength:o},n=Math.floor(n),r=Math.floor(r);let l=[],c=[],h=[],u=[],d=new D,f=new D,g=new D;for(let v=0;v<=n;v++){let m=a+v/n*o;for(let p=0;p<=r;p++){let w=p/r*s;f.x=(e+t*Math.cos(m))*Math.cos(w),f.y=(e+t*Math.cos(m))*Math.sin(w),f.z=t*Math.sin(m),c.push(f.x,f.y,f.z),d.x=e*Math.cos(w),d.y=e*Math.sin(w),g.subVectors(f,d).normalize(),h.push(g.x,g.y,g.z),u.push(p/r),u.push(v/n)}}for(let v=1;v<=n;v++)for(let m=1;m<=r;m++){let p=(r+1)*v+m-1,w=(r+1)*(v-1)+m-1,T=(r+1)*(v-1)+m,y=(r+1)*v+m;l.push(p,w,y),l.push(w,T,y)}this.setIndex(l),this.setAttribute("position",new nt(c,3)),this.setAttribute("normal",new nt(h,3)),this.setAttribute("uv",new nt(u,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc,e.thetaStart,e.thetaLength)}};var Ts=class i extends Tt{constructor(e=new Ss(new D(-1,-1,0),new D(-1,1,0),new D(1,1,0)),t=64,n=1,r=8,s=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:t,radius:n,radialSegments:r,closed:s};let a=e.computeFrenetFrames(t,s);this.tangents=a.tangents,this.normals=a.normals,this.binormals=a.binormals;let o=new D,l=new D,c=new De,h=new D,u=[],d=[],f=[],g=[];v(),this.setIndex(g),this.setAttribute("position",new nt(u,3)),this.setAttribute("normal",new nt(d,3)),this.setAttribute("uv",new nt(f,2));function v(){for(let T=0;T<t;T++)m(T);m(s===!1?t:0),w(),p()}function m(T){h=e.getPointAt(T/t,h);let y=a.normals[T],b=a.binormals[T];for(let S=0;S<=r;S++){let C=S/r*Math.PI*2,_=Math.sin(C),E=-Math.cos(C);l.x=E*y.x+_*b.x,l.y=E*y.y+_*b.y,l.z=E*y.z+_*b.z,l.normalize(),d.push(l.x,l.y,l.z),o.x=h.x+n*l.x,o.y=h.y+n*l.y,o.z=h.z+n*l.z,u.push(o.x,o.y,o.z)}}function p(){for(let T=1;T<=t;T++)for(let y=1;y<=r;y++){let b=(r+1)*(T-1)+(y-1),S=(r+1)*T+(y-1),C=(r+1)*T+y,_=(r+1)*(T-1)+y;g.push(b,S,_),g.push(S,C,_)}}function w(){for(let T=0;T<=t;T++)for(let y=0;y<=r;y++)c.x=T/t,c.y=y/r,f.push(c.x,c.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new i(new xp[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}};function er(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let r=i[t][n];if(gu(r))r.isRenderTargetTexture?(He("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=r.clone();else if(Array.isArray(r))if(gu(r[0])){let s=[];for(let a=0,o=r.length;a<o;a++)s[a]=r[a].clone();e[t][n]=s}else e[t][n]=r.slice();else e[t][n]=r}}return e}function rn(i){let e={};for(let t=0;t<i.length;t++){let n=er(i[t]);for(let r in n)e[r]=n[r]}return e}function gu(i){return i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)}function _p(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function qc(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Je.workingColorSpace}var id={clone:er,merge:rn},yp=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,vp=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Rt=class extends Cn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=yp,this.fragmentShader=vp,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=er(e.uniforms),this.uniformsGroups=_p(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let r in this.uniforms){let a=this.uniforms[r].value;a&&a.isTexture?t.uniforms[r]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[r]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[r]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[r]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[r]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[r]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[r]={type:"m4",value:a.toArray()}:t.uniforms[r]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let r in this.extensions)this.extensions[r]===!0&&(n[r]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}fromJSON(e,t){if(super.fromJSON(e,t),e.uniforms!==void 0)for(let n in e.uniforms){let r=e.uniforms[n];switch(this.uniforms[n]={},r.type){case"t":this.uniforms[n].value=t[r.value]||null;break;case"c":this.uniforms[n].value=new We().setHex(r.value);break;case"v2":this.uniforms[n].value=new De().fromArray(r.value);break;case"v3":this.uniforms[n].value=new D().fromArray(r.value);break;case"v4":this.uniforms[n].value=new St().fromArray(r.value);break;case"m3":this.uniforms[n].value=new Ge().fromArray(r.value);break;case"m4":this.uniforms[n].value=new je().fromArray(r.value);break;default:this.uniforms[n].value=r.value}}if(e.defines!==void 0&&(this.defines=e.defines),e.vertexShader!==void 0&&(this.vertexShader=e.vertexShader),e.fragmentShader!==void 0&&(this.fragmentShader=e.fragmentShader),e.glslVersion!==void 0&&(this.glslVersion=e.glslVersion),e.extensions!==void 0)for(let n in e.extensions)this.extensions[n]=e.extensions[n];return e.lights!==void 0&&(this.lights=e.lights),e.clipping!==void 0&&(this.clipping=e.clipping),this}},eo=class extends Rt{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},Yt=class extends Cn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new We(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new We(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Vs,this.normalScale=new De(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},bn=class extends Yt{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new De(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Ke(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new We(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new We(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new We(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(e){this._retroreflectivity>0!=e>0&&this.version++,this._retroreflectivity=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.retroreflectivity=e.retroreflectivity,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}};var As=class extends Cn{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new We(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new We(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Vs,this.normalScale=new De(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cn,this.combine=go,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.envMapIntensity=e.envMapIntensity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},wi=class extends Cn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Gu,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},to=class extends Cn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Mr(i,e){return!i||i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function uc(i){return i!==void 0&&i.inTangents!==void 0&&i.outTangents!==void 0}var Ti=class{constructor(e,t,n,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r!==void 0?r:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,r=t[n],s=t[n-1];n:{e:{let a;t:{i:if(!(e<r)){for(let o=n+2;;){if(r===void 0){if(e<s)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(s=r,r=t[++n],e<r)break e}a=t.length;break t}if(!(e>=s)){let o=t[1];e<o&&(n=2,s=o);for(let l=n-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(r=s,s=t[--n-1],e>=s)break e}a=n,n=0;break t}break n}for(;n<a;){let o=n+a>>>1;e<t[o]?a=o:n=o+1}if(r=t[n],s=t[n-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,s,r)}return this.interpolate_(n,s,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,r=this.valueSize,s=e*r;for(let a=0;a!==r;++a)t[a]=n[s+a];return t}interpolate_(){throw new Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}},no=class extends Ti{constructor(e,t,n,r){super(e,t,n,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:pc,endingEnd:pc}}intervalChanged_(e,t,n){let r=this.parameterPositions,s=e-2,a=e+1,o=r[s],l=r[a];if(o===void 0)switch(this.getSettings_().endingStart){case mc:s=e,o=2*t-n;break;case gc:s=r.length-2,o=t+r[s]-r[s+1];break;default:s=e,o=n}if(l===void 0)switch(this.getSettings_().endingEnd){case mc:a=e,l=2*n-t;break;case gc:a=1,l=n+r[1]-r[0];break;default:a=e-1,l=t}let c=(n-t)*.5,h=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(l-n),this._offsetPrev=s*h,this._offsetNext=a*h}interpolate_(e,t,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,g=(n-t)/(r-t),v=g*g,m=v*g,p=-d*m+2*d*v-d*g,w=(1+d)*m+(-1.5-2*d)*v+(-.5+d)*g+1,T=(-1-f)*m+(1.5+f)*v+.5*g,y=f*m-f*v;for(let b=0;b!==o;++b)s[b]=p*a[h+b]+w*a[c+b]+T*a[l+b]+y*a[u+b];return s}},io=class extends Ti{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=(n-t)/(r-t),u=1-h;for(let d=0;d!==o;++d)s[d]=a[c+d]*u+a[l+d]*h;return s}},ro=class extends Ti{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e){return this.copySampleValue_(e-1)}},so=class extends Ti{interpolate_(e,t,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this.inTangents,u=this.outTangents;if(!h||!u){let g=(n-t)/(r-t),v=1-g;for(let m=0;m!==o;++m)s[m]=a[c+m]*v+a[l+m]*g;return s}let d=o*2,f=e-1;for(let g=0;g!==o;++g){let v=a[c+g],m=a[l+g],p=f*d+g*2,w=u[p],T=u[p+1],y=e*d+g*2,b=h[y],S=h[y+1],C=Mp(n,t,w,b,r);s[g]=rd(C,v,T,S,m)}return s}};function rd(i,e,t,n,r){let s=1-i;return s*s*s*e+3*s*s*i*t+3*s*i*i*n+i*i*i*r}function bp(i,e,t,n,r){let s=1-i;return 3*s*s*(t-e)+6*s*i*(n-t)+3*i*i*(r-n)}function Mp(i,e,t,n,r){let s=(i-e)/(r-e);for(let a=0;a<8;a++){let o=rd(s,e,t,n,r)-i;if(Math.abs(o)<1e-10)break;let l=bp(s,e,t,n,r);if(Math.abs(l)<1e-10)break;s=Math.max(0,Math.min(1,s-o/l))}return s}var Mn=class{constructor(e,t,n,r){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Mr(t,this.TimeBufferType),this.values=Mr(n,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Mr(e.times,Array),values:Mr(e.values,Array)};let r=e.getInterpolation();r!==e.DefaultInterpolation&&(n.interpolation=r),uc(e.settings)&&(n.settings={inTangents:Mr(e.settings.inTangents,Array),outTangents:Mr(e.settings.outTangents,Array)})}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new ro(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new io(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new no(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new so(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case ls:t=this.InterpolantFactoryMethodDiscrete;break;case Ha:t=this.InterpolantFactoryMethodLinear;break;case Ia:t=this.InterpolantFactoryMethodSmooth;break;case fc:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return He("KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return ls;case this.InterpolantFactoryMethodLinear:return Ha;case this.InterpolantFactoryMethodSmooth:return Ia;case this.InterpolantFactoryMethodBezier:return fc}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]*=e;uc(this.settings)&&(xu(this.settings.inTangents,e),xu(this.settings.outTangents,e))}return this}trim(e,t){let n=this.times,r=n.length,s=0,a=r-1;for(;s!==r&&n[s]<e;)++s;for(;a!==-1&&n[a]>t;)--a;if(++a,s!==0||a!==r){s>=a&&(a=Math.max(a,1),s=a-1);let o=this.getValueSize();this.times=n.slice(s,a),this.values=this.values.slice(s*o,a*o)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(Ve("KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,r=this.values,s=n.length;s===0&&(Ve("KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==s;o++){let l=n[o];if(typeof l=="number"&&isNaN(l)){Ve("KeyframeTrack: Time is not a valid number.",this,o,l),e=!1;break}if(a!==null&&a>l){Ve("KeyframeTrack: Out of order keys.",this,o,l,a),e=!1;break}a=l}if(r!==void 0&&Gf(r))for(let o=0,l=r.length;o!==l;++o){let c=r[o];if(isNaN(c)){Ve("KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),r=this.getInterpolation()===Ia,s=e.length-1,a=1;for(let o=1;o<s;++o){let l=!1,c=e[o],h=e[o+1];if(c!==h&&(o!==1||c!==e[0]))if(r)l=!0;else{let u=o*n,d=u-n,f=u+n;for(let g=0;g!==n;++g){let v=t[u+g];if(v!==t[d+g]||v!==t[f+g]){l=!0;break}}}if(l){if(o!==a){e[a]=e[o];let u=o*n,d=a*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++a}}if(s>0){e[a]=e[s];for(let o=s*n,l=a*n,c=0;c!==n;++c)t[l+c]=t[o+c];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,r=new n(this.name,e,t);return r.createInterpolant=this.createInterpolant,uc(this.settings)&&(r.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),r}};function xu(i,e){for(let t=0,n=i.length;t!==n;t+=2)i[t]*=e}Mn.prototype.ValueTypeName="";Mn.prototype.TimeBufferType=Float32Array;Mn.prototype.ValueBufferType=Float32Array;Mn.prototype.DefaultInterpolation=Ha;var Ai=class extends Mn{constructor(e,t,n){super(e,t,n)}};Ai.prototype.ValueTypeName="bool";Ai.prototype.ValueBufferType=Array;Ai.prototype.DefaultInterpolation=ls;Ai.prototype.InterpolantFactoryMethodLinear=void 0;Ai.prototype.InterpolantFactoryMethodSmooth=void 0;var ao=class extends Mn{constructor(e,t,n,r){super(e,t,n,r)}};ao.prototype.ValueTypeName="color";var oo=class extends Mn{constructor(e,t,n,r){super(e,t,n,r)}};oo.prototype.ValueTypeName="number";var lo=class extends Ti{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(n-t)/(r-t),c=e*o;for(let h=c+o;c!==h;c+=4)tn.slerpFlat(s,0,a,c-o,a,c,l);return s}},Rs=class extends Mn{constructor(e,t,n,r){super(e,t,n,r)}InterpolantFactoryMethodLinear(e){return new lo(this.times,this.values,this.getValueSize(),e)}};Rs.prototype.ValueTypeName="quaternion";Rs.prototype.InterpolantFactoryMethodSmooth=void 0;var Ri=class extends Mn{constructor(e,t,n){super(e,t,n)}};Ri.prototype.ValueTypeName="string";Ri.prototype.ValueBufferType=Array;Ri.prototype.DefaultInterpolation=ls;Ri.prototype.InterpolantFactoryMethodLinear=void 0;Ri.prototype.InterpolantFactoryMethodSmooth=void 0;var co=class extends Mn{constructor(e,t,n,r){super(e,t,n,r)}};co.prototype.ValueTypeName="vector";var ho=class{constructor(e,t,n){let r=this,s=!1,a=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(h){o++,s===!1&&r.onStart!==void 0&&r.onStart(h,a,o),s=!0},this.itemEnd=function(h){a++,r.onProgress!==void 0&&r.onProgress(h,a,o),a===o&&(s=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(h){r.onError!==void 0&&r.onError(h)},this.resolveURL=function(h){return h=h.normalize("NFC"),l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,u){return c.push(h,u),this},this.removeHandler=function(h){let u=c.indexOf(h);return u!==-1&&c.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=c.length;u<d;u+=2){let f=c[u],g=c[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return g}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},sd=new ho,uo=class{constructor(e){this.manager=e!==void 0?e:sd,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(r,s){n.load(e,r,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};uo.DEFAULT_MATERIAL_NAME="__DEFAULT";var $i=class extends wt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new We(e),this.intensity=t}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},Zi=class extends $i{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(wt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new We(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},dc=new je,_u=new D,yu=new D,Dr=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new De(512,512),this.mapType=Wt,this.map=null,this.mapPass=null,this.matrix=new je,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Lr,this._frameExtents=new De(1,1),this._viewportCount=1,this._viewports=[new St(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera;_u.setFromMatrixPosition(e.matrixWorld),t.position.copy(_u),yu.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(yu),t.updateMatrixWorld(),this._updateMatrix(t,this.matrix,this._frustum)}_updateMatrix(e,t,n,r){dc.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),n.setFromProjectionMatrix(dc,e.coordinateSystem,e.reversedDepth);let s=this._frameExtents,a=r?r.z/s.x:1,o=r?r.w/s.y:1,l=r?r.x/s.x:0,c=r?r.y/s.y:0;e.coordinateSystem===Rr||e.reversedDepth?t.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,1,0,0,0,0,1):t.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,.5,.5,0,0,0,1),t.multiply(dc)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return e.intensity=this.intensity,e.bias=this.bias,e.normalBias=this.normalBias,e.radius=this.radius,e.blurSamples=this.blurSamples,e.mapSize=this.mapSize.toArray(),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Ca=new D,Pa=new tn,qn=new D,Cs=class extends wt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new je,this.projectionMatrix=new je,this.projectionMatrixInverse=new je,this.coordinateSystem=kn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(Ca,Pa,qn),qn.x===1&&qn.y===1&&qn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ca,Pa,qn.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(Ca,Pa,qn),qn.x===1&&qn.y===1&&qn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ca,Pa,qn.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},bi=new D,vu=new De,bu=new De,Gt=class extends Cs{constructor(e=50,t=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=us*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(zl*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return us*2*Math.atan(Math.tan(zl*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){bi.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(bi.x,bi.y).multiplyScalar(-e/bi.z),bi.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(bi.x,bi.y).multiplyScalar(-e/bi.z)}getViewSize(e,t){return this.getViewBounds(e,vu,bu),t.subVectors(bu,vu)}setViewOffset(e,t,n,r,s,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(zl*.5*this.fov)/this.zoom,n=2*t,r=this.aspect*n,s=-.5*r,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,c=a.fullHeight;s+=a.offsetX*r/l,t-=a.offsetY*n/c,r*=a.width/l,n*=a.height/c}let o=this.filmOffset;o!==0&&(s+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+r,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},_c=class extends Dr{constructor(){super(new Gt(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=us*2*e.angle*this.focus,r=this.mapSize.width/this.mapSize.height*this.aspect,s=e.distance||t.far;(n!==t.fov||r!==t.aspect||s!==t.far)&&(t.fov=n,t.aspect=r,t.far=s,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this.aspect=e.aspect,this}toJSON(){let e=super.toJSON();return e.focus=this.focus,e.aspect=this.aspect,e}},Ps=class extends $i{constructor(e,t,n=0,r=Math.PI/3,s=0,a=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(wt.DEFAULT_UP),this.updateMatrix(),this.target=new wt,this.distance=n,this.angle=r,this.penumbra=s,this.decay=a,this.map=null,this.shadow=new _c}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.map=e.map,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.angle=this.angle,t.object.decay=this.decay,t.object.penumbra=this.penumbra,t.object.target=this.target.uuid,this.map&&this.map.isTexture&&(t.object.map=this.map.toJSON(e).uuid),t.object.shadow=this.shadow.toJSON(),t}},yc=class extends Dr{constructor(){super(new Gt(90,1,.5,500)),this.isPointLightShadow=!0}},Ji=class extends $i{constructor(e,t,n=0,r=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=r,this.shadow=new yc}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.decay=this.decay,t.object.shadow=this.shadow.toJSON(),t}},In=class extends Cs{constructor(e=-1,t=1,n=1,r=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=r,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,r,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,r=(this.top+this.bottom)/2,s=n-e,a=n+e,o=r+t,l=r-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,a=s+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},vc=class extends Dr{constructor(){super(new In(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Ci=class extends $i{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(wt.DEFAULT_UP),this.updateMatrix(),this.target=new wt,this.shadow=new vc}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}};var Sr=-90,Er=1,fo=class extends wt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new Gt(Sr,Er,e,t);r.layers=this.layers,this.add(r);let s=new Gt(Sr,Er,e,t);s.layers=this.layers,this.add(s);let a=new Gt(Sr,Er,e,t);a.layers=this.layers,this.add(a);let o=new Gt(Sr,Er,e,t);o.layers=this.layers,this.add(o);let l=new Gt(Sr,Er,e,t);l.layers=this.layers,this.add(l);let c=new Gt(Sr,Er,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,r,s,a,o,l]=t;for(let c of t)this.remove(c);if(e===kn)n.up.set(0,1,0),n.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Rr)n.up.set(0,-1,0),n.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[s,a,o,l,c,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;let v=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let m=!1;e.isWebGLRenderer===!0?m=e.state.buffers.depth.getReversed():m=e.reversedDepthBuffer,e.setRenderTarget(n,0,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,s),e.setRenderTarget(n,1,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(n,4,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),n.texture.generateMipmaps=v,e.setRenderTarget(n,5,r),m&&e.autoClear===!1&&e.clearDepth(),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}},po=class extends Gt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Yc="\\[\\]\\.:\\/",Sp=new RegExp("["+Yc+"]","g"),$c="[^"+Yc+"]",Ep="[^"+Yc.replace("\\.","")+"]",wp=/((?:WC+[\/:])*)/.source.replace("WC",$c),Tp=/(WCOD+)?/.source.replace("WCOD",Ep),Ap=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",$c),Rp=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",$c),Cp=new RegExp("^"+wp+Tp+Ap+Rp+"$"),Pp=["material","materials","bones","map"],bc=class{constructor(e,t,n){let r=n||bt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,r=this._bindings[n];r!==void 0&&r.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let r=this._targetGroup.nCachedObjects_,s=n.length;r!==s;++r)n[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},bt=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Sp,"")}static parseTrackName(e){let t=Cp.exec(e);if(t===null)throw new Error("THREE.PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=n.nodeName&&n.nodeName.lastIndexOf(".");if(r!==void 0&&r!==-1){let s=n.nodeName.substring(r+1);Pp.indexOf(s)!==-1&&(n.nodeName=n.nodeName.substring(0,r),n.objectName=s)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(s){for(let a=0;a<s.length;a++){let o=s[a];if(o.name===t||o.uuid===t)return o;let l=n(o.children);if(l)return l}return null},r=n(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)e[t++]=n[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)n[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)n[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,s=n.length;r!==s;++r)n[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,r=t.propertyName,s=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){He("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){Ve("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Ve("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Ve("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===c){c=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Ve("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Ve("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){Ve("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){Ve("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let a=e[r];if(a===void 0){let c=t.nodeName;Ve("PropertyBinding: Trying to update property for track: "+c+"."+r+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(r==="morphTargetInfluences"){if(!e.geometry){Ve("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Ve("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=s}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=r;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};bt.Composite=bc;bt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};bt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};bt.prototype.GetterByBindingType=[bt.prototype._getValue_direct,bt.prototype._getValue_array,bt.prototype._getValue_arrayElement,bt.prototype._getValue_toArray];bt.prototype.SetterByBindingTypeAndVersioning=[[bt.prototype._setValue_direct,bt.prototype._setValue_direct_setNeedsUpdate,bt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[bt.prototype._setValue_array,bt.prototype._setValue_array_setNeedsUpdate,bt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[bt.prototype._setValue_arrayElement,bt.prototype._setValue_arrayElement_setNeedsUpdate,bt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[bt.prototype._setValue_fromArray,bt.prototype._setValue_fromArray_setNeedsUpdate,bt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Iy=new Float32Array(1);var Mc=class i{static{i.prototype.isMatrix2=!0}constructor(e,t,n,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,r){let s=this.elements;return s[0]=e,s[2]=t,s[1]=n,s[3]=r,this}};function Zc(i,e,t,n){let r=Ip(n);switch(t){case Hc:return i*e;case So:return i*e/r.components*r.byteLength;case Eo:return i*e/r.components*r.byteLength;case Ui:return i*e*2/r.components*r.byteLength;case wo:return i*e*2/r.components*r.byteLength;case zc:return i*e*3/r.components*r.byteLength;case $t:return i*e*4/r.components*r.byteLength;case To:return i*e*4/r.components*r.byteLength;case Ns:case Fs:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Os:case Bs:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Ro:case Po:return Math.max(i,16)*Math.max(e,8)/4;case Ao:case Co:return Math.max(i,8)*Math.max(e,8)/2;case Io:case Lo:case Do:case No:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Uo:case ks:case Fo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Oo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Bo:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case ko:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case Ho:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case zo:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case Vo:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case Go:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case Wo:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case Xo:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case qo:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case Yo:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case $o:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case Zo:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case Jo:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case Ko:case jo:case Qo:return Math.ceil(i/4)*Math.ceil(e/4)*16;case el:case tl:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Hs:case nl:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function Ip(i){switch(i){case Wt:case Fc:return{byteLength:1,components:1};case Or:case Oc:case Vn:return{byteLength:2,components:1};case bo:case Mo:return{byteLength:2,components:4};case zn:case vo:case fn:return{byteLength:4,components:1};case Bc:case kc:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"186"}}));typeof window<"u"&&(window.__THREE__?He("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="186");function Ad(){let i=null,e=!1,t=null,n=null;function r(s,a){n=i.requestAnimationFrame(r),t(s,a)}return{start:function(){e!==!0&&t!==null&&i!==null&&(n=i.requestAnimationFrame(r),e=!0)},stop:function(){i!==null&&i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(s){t=s},setContext:function(s){i=s}}}function Up(i){let e=new WeakMap;function t(o,l){let c=o.array,h=o.usage,u=c.byteLength,d=i.createBuffer();i.bindBuffer(l,d),i.bufferData(l,c,h),o.onUploadCallback();let f;if(c instanceof Float32Array)f=i.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)f=i.HALF_FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?f=i.HALF_FLOAT:f=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)f=i.SHORT;else if(c instanceof Uint32Array)f=i.UNSIGNED_INT;else if(c instanceof Int32Array)f=i.INT;else if(c instanceof Int8Array)f=i.BYTE;else if(c instanceof Uint8Array)f=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)f=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:d,type:f,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,l,c){let h=l.array,u=l.updateRanges;if(i.bindBuffer(c,o),u.length===0)i.bufferSubData(c,0,h);else{u.sort((f,g)=>f.start-g.start);let d=0;for(let f=1;f<u.length;f++){let g=u[d],v=u[f];v.start<=g.start+g.count+1?g.count=Math.max(g.count,v.start+v.count-g.start):(++d,u[d]=v)}u.length=d+1;for(let f=0,g=u.length;f<g;f++){let v=u[f];i.bufferSubData(c,v.start*h.BYTES_PER_ELEMENT,h,v.start,v.count)}l.clearUpdateRanges()}l.onUploadCallback()}function r(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function s(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=e.get(o);l&&(i.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=e.get(o);if(c===void 0)e.set(o,t(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:r,remove:s,update:a}}var Dp=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Np=`#ifdef USE_ALPHAHASH
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
#endif`,Fp=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Op=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Bp=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,kp=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Hp=`#ifdef USE_AOMAP
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
#endif`,zp=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Vp=`#ifdef USE_BATCHING
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
#endif`,Gp=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Wp=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Xp=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,qp=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,Yp=`#ifdef USE_IRIDESCENCE
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
#endif`,$p=`#ifdef USE_BUMPMAP
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
#endif`,Zp=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,Jp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Kp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,jp=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Qp=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,em=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,tm=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,nm=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,im=`#define PI 3.141592653589793
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
} // validated`,rm=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,sm=`vec3 transformedNormal = objectNormal;
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
#endif`,am=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,om=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,lm=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,cm=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,hm="gl_FragColor = linearToOutputTexel( gl_FragColor );",um=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,dm=`#ifdef USE_ENVMAP
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
#endif`,fm=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,pm=`#ifdef USE_ENVMAP
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
#endif`,mm=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,gm=`#ifdef USE_ENVMAP
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
#endif`,xm=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,_m=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,ym=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,vm=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,bm=`#ifdef USE_GRADIENTMAP
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
}`,Mm=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Sm=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Em=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,wm=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,Tm=`#ifdef USE_ENVMAP
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
#endif`,Am=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Rm=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Cm=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Pm=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Im=`PhysicalMaterial material;
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
#endif`,Lm=`uniform sampler2D dfgLUT;
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
}`,Um=`
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
#endif`,Dm=`#if defined( RE_IndirectDiffuse )
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
#endif`,Nm=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Fm=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,Om=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Bm=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,km=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Hm=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,zm=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Vm=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Gm=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,Wm=`#if defined( USE_POINTS_UV )
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
#endif`,Xm=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,qm=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Ym=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,$m=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Zm=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Jm=`#ifdef USE_MORPHTARGETS
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
#endif`,Km=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,jm=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,Qm=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,e0=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,t0=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,n0=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,i0=`#ifdef USE_NORMALMAP
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
#endif`,r0=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,s0=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,a0=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,o0=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,l0=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,c0=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,h0=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,u0=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,d0=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,f0=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,p0=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,m0=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,g0=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,x0=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,_0=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,y0=`float getShadowMask() {
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
}`,v0=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,b0=`#ifdef USE_SKINNING
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
#endif`,M0=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,S0=`#ifdef USE_SKINNING
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
#endif`,E0=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,w0=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,T0=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,A0=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,R0=`#ifdef USE_TRANSMISSION
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
#endif`,C0=`#ifdef USE_TRANSMISSION
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
#endif`,P0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,I0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,L0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,U0=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,D0=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,N0=`uniform sampler2D t2D;
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
}`,F0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,O0=`#ifdef ENVMAP_TYPE_CUBE
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
}`,B0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,k0=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,H0=`#include <common>
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
}`,z0=`#if DEPTH_PACKING == 3200
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
}`,V0=`#define DISTANCE
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
}`,G0=`#define DISTANCE
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
}`,W0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,X0=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,q0=`uniform float scale;
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
}`,Y0=`uniform vec3 diffuse;
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
}`,$0=`#include <common>
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
}`,Z0=`uniform vec3 diffuse;
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
}`,J0=`#define LAMBERT
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
}`,K0=`#define LAMBERT
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
}`,j0=`#define MATCAP
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
}`,Q0=`#define MATCAP
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
}`,eg=`#define NORMAL
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
}`,tg=`#define NORMAL
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
}`,ng=`#define PHONG
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
}`,ig=`#define PHONG
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
}`,rg=`#define STANDARD
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
}`,sg=`#define STANDARD
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
}`,ag=`#define TOON
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
}`,og=`#define TOON
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
}`,lg=`uniform float size;
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
}`,cg=`uniform vec3 diffuse;
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
}`,hg=`#include <common>
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
}`,ug=`uniform vec3 color;
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
}`,dg=`uniform float rotation;
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
}`,fg=`uniform vec3 diffuse;
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
}`,Ze={alphahash_fragment:Dp,alphahash_pars_fragment:Np,alphamap_fragment:Fp,alphamap_pars_fragment:Op,alphatest_fragment:Bp,alphatest_pars_fragment:kp,aomap_fragment:Hp,aomap_pars_fragment:zp,batching_pars_vertex:Vp,batching_vertex:Gp,begin_vertex:Wp,beginnormal_vertex:Xp,bsdfs:qp,iridescence_fragment:Yp,bumpmap_pars_fragment:$p,clipping_planes_fragment:Zp,clipping_planes_pars_fragment:Jp,clipping_planes_pars_vertex:Kp,clipping_planes_vertex:jp,color_fragment:Qp,color_pars_fragment:em,color_pars_vertex:tm,color_vertex:nm,common:im,cube_uv_reflection_fragment:rm,defaultnormal_vertex:sm,displacementmap_pars_vertex:am,displacementmap_vertex:om,emissivemap_fragment:lm,emissivemap_pars_fragment:cm,colorspace_fragment:hm,colorspace_pars_fragment:um,envmap_fragment:dm,envmap_common_pars_fragment:fm,envmap_pars_fragment:pm,envmap_pars_vertex:mm,envmap_physical_pars_fragment:Tm,envmap_vertex:gm,fog_vertex:xm,fog_pars_vertex:_m,fog_fragment:ym,fog_pars_fragment:vm,gradientmap_pars_fragment:bm,lightmap_pars_fragment:Mm,lights_lambert_fragment:Sm,lights_lambert_pars_fragment:Em,lights_pars_begin:wm,lights_toon_fragment:Am,lights_toon_pars_fragment:Rm,lights_phong_fragment:Cm,lights_phong_pars_fragment:Pm,lights_physical_fragment:Im,lights_physical_pars_fragment:Lm,lights_fragment_begin:Um,lights_fragment_maps:Dm,lights_fragment_end:Nm,lightprobes_pars_fragment:Fm,logdepthbuf_fragment:Om,logdepthbuf_pars_fragment:Bm,logdepthbuf_pars_vertex:km,logdepthbuf_vertex:Hm,map_fragment:zm,map_pars_fragment:Vm,map_particle_fragment:Gm,map_particle_pars_fragment:Wm,metalnessmap_fragment:Xm,metalnessmap_pars_fragment:qm,morphinstance_vertex:Ym,morphcolor_vertex:$m,morphnormal_vertex:Zm,morphtarget_pars_vertex:Jm,morphtarget_vertex:Km,normal_fragment_begin:jm,normal_fragment_maps:Qm,normal_pars_fragment:e0,normal_pars_vertex:t0,normal_vertex:n0,normalmap_pars_fragment:i0,clearcoat_normal_fragment_begin:r0,clearcoat_normal_fragment_maps:s0,clearcoat_pars_fragment:a0,iridescence_pars_fragment:o0,opaque_fragment:l0,packing:c0,premultiplied_alpha_fragment:h0,project_vertex:u0,dithering_fragment:d0,dithering_pars_fragment:f0,roughnessmap_fragment:p0,roughnessmap_pars_fragment:m0,shadowmap_pars_fragment:g0,shadowmap_pars_vertex:x0,shadowmap_vertex:_0,shadowmask_pars_fragment:y0,skinbase_vertex:v0,skinning_pars_vertex:b0,skinning_vertex:M0,skinnormal_vertex:S0,specularmap_fragment:E0,specularmap_pars_fragment:w0,tonemapping_fragment:T0,tonemapping_pars_fragment:A0,transmission_fragment:R0,transmission_pars_fragment:C0,uv_pars_fragment:P0,uv_pars_vertex:I0,uv_vertex:L0,worldpos_vertex:U0,background_vert:D0,background_frag:N0,backgroundCube_vert:F0,backgroundCube_frag:O0,cube_vert:B0,cube_frag:k0,depth_vert:H0,depth_frag:z0,distance_vert:V0,distance_frag:G0,equirect_vert:W0,equirect_frag:X0,linedashed_vert:q0,linedashed_frag:Y0,meshbasic_vert:$0,meshbasic_frag:Z0,meshlambert_vert:J0,meshlambert_frag:K0,meshmatcap_vert:j0,meshmatcap_frag:Q0,meshnormal_vert:eg,meshnormal_frag:tg,meshphong_vert:ng,meshphong_frag:ig,meshphysical_vert:rg,meshphysical_frag:sg,meshtoon_vert:ag,meshtoon_frag:og,points_vert:lg,points_frag:cg,shadow_vert:hg,shadow_frag:ug,sprite_vert:dg,sprite_frag:fg},Ee={common:{diffuse:{value:new We(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ge}},envmap:{envMap:{value:null},envMapRotation:{value:new Ge},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ge}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ge}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ge},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ge},normalScale:{value:new De(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ge},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ge}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ge}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ge}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new We(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new D},probesMax:{value:new D},probesResolution:{value:new D}},points:{diffuse:{value:new We(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0},uvTransform:{value:new Ge}},sprite:{diffuse:{value:new We(16777215)},opacity:{value:1},center:{value:new De(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}}},ei={basic:{uniforms:rn([Ee.common,Ee.specularmap,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.fog]),vertexShader:Ze.meshbasic_vert,fragmentShader:Ze.meshbasic_frag},lambert:{uniforms:rn([Ee.common,Ee.specularmap,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.fog,Ee.lights,{emissive:{value:new We(0)},envMapIntensity:{value:1}}]),vertexShader:Ze.meshlambert_vert,fragmentShader:Ze.meshlambert_frag},phong:{uniforms:rn([Ee.common,Ee.specularmap,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.fog,Ee.lights,{emissive:{value:new We(0)},specular:{value:new We(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Ze.meshphong_vert,fragmentShader:Ze.meshphong_frag},standard:{uniforms:rn([Ee.common,Ee.envmap,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.roughnessmap,Ee.metalnessmap,Ee.fog,Ee.lights,{emissive:{value:new We(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ze.meshphysical_vert,fragmentShader:Ze.meshphysical_frag},toon:{uniforms:rn([Ee.common,Ee.aomap,Ee.lightmap,Ee.emissivemap,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.gradientmap,Ee.fog,Ee.lights,{emissive:{value:new We(0)}}]),vertexShader:Ze.meshtoon_vert,fragmentShader:Ze.meshtoon_frag},matcap:{uniforms:rn([Ee.common,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,Ee.fog,{matcap:{value:null}}]),vertexShader:Ze.meshmatcap_vert,fragmentShader:Ze.meshmatcap_frag},points:{uniforms:rn([Ee.points,Ee.fog]),vertexShader:Ze.points_vert,fragmentShader:Ze.points_frag},dashed:{uniforms:rn([Ee.common,Ee.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ze.linedashed_vert,fragmentShader:Ze.linedashed_frag},depth:{uniforms:rn([Ee.common,Ee.displacementmap]),vertexShader:Ze.depth_vert,fragmentShader:Ze.depth_frag},normal:{uniforms:rn([Ee.common,Ee.bumpmap,Ee.normalmap,Ee.displacementmap,{opacity:{value:1}}]),vertexShader:Ze.meshnormal_vert,fragmentShader:Ze.meshnormal_frag},sprite:{uniforms:rn([Ee.sprite,Ee.fog]),vertexShader:Ze.sprite_vert,fragmentShader:Ze.sprite_frag},background:{uniforms:{uvTransform:{value:new Ge},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ze.background_vert,fragmentShader:Ze.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ge}},vertexShader:Ze.backgroundCube_vert,fragmentShader:Ze.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ze.cube_vert,fragmentShader:Ze.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ze.equirect_vert,fragmentShader:Ze.equirect_frag},distance:{uniforms:rn([Ee.common,Ee.displacementmap,{referencePosition:{value:new D},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ze.distance_vert,fragmentShader:Ze.distance_frag},shadow:{uniforms:rn([Ee.lights,Ee.fog,{color:{value:new We(0)},opacity:{value:1}}]),vertexShader:Ze.shadow_vert,fragmentShader:Ze.shadow_frag}};ei.physical={uniforms:rn([ei.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ge},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ge},clearcoatNormalScale:{value:new De(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ge},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ge},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ge},sheen:{value:0},sheenColor:{value:new We(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ge},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ge},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ge},transmissionSamplerSize:{value:new De},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ge},attenuationDistance:{value:0},attenuationColor:{value:new We(0)},specularColor:{value:new We(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ge},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ge},anisotropyVector:{value:new De},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ge}}]),vertexShader:Ze.meshphysical_vert,fragmentShader:Ze.meshphysical_frag};var sl={r:0,b:0,g:0},pg=new je,Rd=new Ge;Rd.set(-1,0,0,0,1,0,0,0,1);function mg(i,e,t,n,r,s){let a=new We(0),o=r===!0?0:1,l,c,h=null,u=0,d=null;function f(w){let T=w.isScene===!0?w.background:null;if(T&&T.isTexture){let y=w.backgroundBlurriness>0;T=e.get(T,y)}return T}function g(w){let T=!1,y=f(w);y===null?m(a,o):y&&y.isColor&&(m(y,1),T=!0);let b=i.xr.getEnvironmentBlendMode();b==="additive"?t.buffers.color.setClear(0,0,0,1,s):b==="alpha-blend"&&t.buffers.color.setClear(0,0,0,0,s),(i.autoClear||T)&&(t.buffers.depth.setTest(!0),t.buffers.depth.setMask(!0),t.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function v(w,T){let y=f(T);y&&(y.isCubeTexture||y.mapping===Us)?(c===void 0&&(c=new Oe(new Hn(1,1,1),new Rt({name:"BackgroundCubeMaterial",uniforms:er(ei.backgroundCube.uniforms),vertexShader:ei.backgroundCube.vertexShader,fragmentShader:ei.backgroundCube.fragmentShader,side:Nt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(b,S,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(c)),c.material.uniforms.envMap.value=y,c.material.uniforms.backgroundBlurriness.value=T.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=T.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(pg.makeRotationFromEuler(T.backgroundRotation)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(Rd),c.material.toneMapped=Je.getTransfer(y.colorSpace)!==lt,(h!==y||u!==y.version||d!==i.toneMapping)&&(c.material.needsUpdate=!0,h=y,u=y.version,d=i.toneMapping),c.layers.enableAll(),w.unshift(c,c.geometry,c.material,0,0,null)):y&&y.isTexture&&(l===void 0&&(l=new Oe(new ct(2,2),new Rt({name:"BackgroundMaterial",uniforms:er(ei.background.uniforms),vertexShader:ei.background.vertexShader,fragmentShader:ei.background.fragmentShader,side:Jn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(l)),l.material.uniforms.t2D.value=y,l.material.uniforms.backgroundIntensity.value=T.backgroundIntensity,l.material.toneMapped=Je.getTransfer(y.colorSpace)!==lt,y.matrixAutoUpdate===!0&&y.updateMatrix(),l.material.uniforms.uvTransform.value.copy(y.matrix),(h!==y||u!==y.version||d!==i.toneMapping)&&(l.material.needsUpdate=!0,h=y,u=y.version,d=i.toneMapping),l.layers.enableAll(),w.unshift(l,l.geometry,l.material,0,0,null))}function m(w,T){w.getRGB(sl,qc(i)),t.buffers.color.setClear(sl.r,sl.g,sl.b,T,s)}function p(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(w,T=1){a.set(w),o=T,m(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(w){o=w,m(a,o)},render:g,addToRenderList:v,dispose:p}}function gg(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},r=d(null),s=r,a=!1;function o(N,P,F,U,H){let q=!1,Y=u(N,U,F,P);s!==Y&&(s=Y,c(s.object)),q=f(N,U,F,H),q&&g(N,U,F,H),H!==null&&e.update(H,i.ELEMENT_ARRAY_BUFFER),(q||a)&&(a=!1,y(N,P,F,U),H!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(H).buffer))}function l(){return i.createVertexArray()}function c(N){return i.bindVertexArray(N)}function h(N){return i.deleteVertexArray(N)}function u(N,P,F,U){let H=U.wireframe===!0,q=n[P.id];q===void 0&&(q={},n[P.id]=q);let Y=N.isInstancedMesh===!0?N.id:0,ce=q[Y];ce===void 0&&(ce={},q[Y]=ce);let G=ce[F.id];G===void 0&&(G={},ce[F.id]=G);let J=G[H];return J===void 0&&(J=d(l()),G[H]=J),J}function d(N){let P=[],F=[],U=[];for(let H=0;H<t;H++)P[H]=0,F[H]=0,U[H]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:P,enabledAttributes:F,attributeDivisors:U,object:N,attributes:{},index:null}}function f(N,P,F,U){let H=s.attributes,q=P.attributes,Y=0,ce=F.getAttributes();for(let G in ce)if(ce[G].location>=0){let W=H[G],ue=q[G];if(ue===void 0&&(G==="instanceMatrix"&&N.instanceMatrix&&(ue=N.instanceMatrix),G==="instanceColor"&&N.instanceColor&&(ue=N.instanceColor)),W===void 0||W.attribute!==ue||ue&&W.data!==ue.data)return!0;Y++}return s.attributesNum!==Y||s.index!==U}function g(N,P,F,U){let H={},q=P.attributes,Y=0,ce=F.getAttributes();for(let G in ce)if(ce[G].location>=0){let W=q[G];W===void 0&&(G==="instanceMatrix"&&N.instanceMatrix&&(W=N.instanceMatrix),G==="instanceColor"&&N.instanceColor&&(W=N.instanceColor));let ue={};ue.attribute=W,W&&W.data&&(ue.data=W.data),H[G]=ue,Y++}s.attributes=H,s.attributesNum=Y,s.index=U}function v(){let N=s.newAttributes;for(let P=0,F=N.length;P<F;P++)N[P]=0}function m(N){p(N,0)}function p(N,P){let F=s.newAttributes,U=s.enabledAttributes,H=s.attributeDivisors;F[N]=1,U[N]===0&&(i.enableVertexAttribArray(N),U[N]=1),H[N]!==P&&(i.vertexAttribDivisor(N,P),H[N]=P)}function w(){let N=s.newAttributes,P=s.enabledAttributes;for(let F=0,U=P.length;F<U;F++)P[F]!==N[F]&&(i.disableVertexAttribArray(F),P[F]=0)}function T(N,P,F,U,H,q,Y){Y===!0?i.vertexAttribIPointer(N,P,F,H,q):i.vertexAttribPointer(N,P,F,U,H,q)}function y(N,P,F,U){v();let H=U.attributes,q=F.getAttributes(),Y=P.defaultAttributeValues;for(let ce in q){let G=q[ce];if(G.location>=0){let J=H[ce];if(J===void 0&&(ce==="instanceMatrix"&&N.instanceMatrix&&(J=N.instanceMatrix),ce==="instanceColor"&&N.instanceColor&&(J=N.instanceColor)),J!==void 0){let W=J.normalized,ue=J.itemSize,pe=e.get(J);if(pe===void 0)continue;let Me=pe.buffer,Se=pe.type,de=pe.bytesPerElement,X=Se===i.INT||Se===i.UNSIGNED_INT||J.gpuType===vo;if(J.isInterleavedBufferAttribute){let ne=J.data,ye=ne.stride,Pe=J.offset;if(ne.isInstancedInterleavedBuffer){for(let _e=0;_e<G.locationSize;_e++)p(G.location+_e,ne.meshPerAttribute);N.isInstancedMesh!==!0&&U._maxInstanceCount===void 0&&(U._maxInstanceCount=ne.meshPerAttribute*ne.count)}else for(let _e=0;_e<G.locationSize;_e++)m(G.location+_e);i.bindBuffer(i.ARRAY_BUFFER,Me);for(let _e=0;_e<G.locationSize;_e++)T(G.location+_e,ue/G.locationSize,Se,W,ye*de,(Pe+ue/G.locationSize*_e)*de,X)}else{if(J.isInstancedBufferAttribute){for(let ne=0;ne<G.locationSize;ne++)p(G.location+ne,J.meshPerAttribute);N.isInstancedMesh!==!0&&U._maxInstanceCount===void 0&&(U._maxInstanceCount=J.meshPerAttribute*J.count)}else for(let ne=0;ne<G.locationSize;ne++)m(G.location+ne);i.bindBuffer(i.ARRAY_BUFFER,Me);for(let ne=0;ne<G.locationSize;ne++)T(G.location+ne,ue/G.locationSize,Se,W,ue*de,ue/G.locationSize*ne*de,X)}}else if(Y!==void 0){let W=Y[ce];if(W!==void 0)switch(W.length){case 2:i.vertexAttrib2fv(G.location,W);break;case 3:i.vertexAttrib3fv(G.location,W);break;case 4:i.vertexAttrib4fv(G.location,W);break;default:i.vertexAttrib1fv(G.location,W)}}}}w()}function b(){E();for(let N in n){let P=n[N];for(let F in P){let U=P[F];for(let H in U){let q=U[H];for(let Y in q)h(q[Y].object),delete q[Y];delete U[H]}}delete n[N]}}function S(N){if(n[N.id]===void 0)return;let P=n[N.id];for(let F in P){let U=P[F];for(let H in U){let q=U[H];for(let Y in q)h(q[Y].object),delete q[Y];delete U[H]}}delete n[N.id]}function C(N){for(let P in n){let F=n[P];for(let U in F){let H=F[U];if(H[N.id]===void 0)continue;let q=H[N.id];for(let Y in q)h(q[Y].object),delete q[Y];delete H[N.id]}}}function _(N){for(let P in n){let F=n[P],U=N.isInstancedMesh===!0?N.id:0,H=F[U];if(H!==void 0){for(let q in H){let Y=H[q];for(let ce in Y)h(Y[ce].object),delete Y[ce];delete H[q]}delete F[U],Object.keys(F).length===0&&delete n[P]}}}function E(){I(),a=!0,s!==r&&(s=r,c(s.object))}function I(){r.geometry=null,r.program=null,r.wireframe=!1}return{setup:o,reset:E,resetDefaultState:I,dispose:b,releaseStatesOfGeometry:S,releaseStatesOfObject:_,releaseStatesOfProgram:C,initAttributes:v,enableAttribute:m,disableUnusedAttributes:w}}function xg(i,e,t){let n;function r(l){n=l}function s(l,c){i.drawArrays(n,l,c),t.update(c,n,1)}function a(l,c,h){h!==0&&(i.drawArraysInstanced(n,l,c,h),t.update(c,n,h))}function o(l,c,h){if(h===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,c,0,h);let d=0;for(let f=0;f<h;f++)d+=c[f];t.update(d,n,1)}this.setMode=r,this.render=s,this.renderInstances=a,this.renderMultiDraw=o}function _g(i,e,t,n){let r;function s(){if(r!==void 0)return r;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");r=i.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else r=0;return r}function a(C){return!(C!==$t&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(C){let _=C===Vn&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==Wt&&C!==fn&&!_&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE))}function l(C){if(C==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp",h=l(c);h!==c&&(He("WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);let u=t.logarithmicDepthBuffer===!0,d=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control");t.reversedDepthBuffer===!0&&d===!1&&He("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let f=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),v=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),p=i.getParameter(i.MAX_VERTEX_ATTRIBS),w=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),T=i.getParameter(i.MAX_VARYING_VECTORS),y=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),b=i.getParameter(i.MAX_SAMPLES),S=i.getParameter(i.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:u,reversedDepthBuffer:d,maxTextures:f,maxVertexTextures:g,maxTextureSize:v,maxCubemapSize:m,maxAttributes:p,maxVertexUniforms:w,maxVaryings:T,maxFragmentUniforms:y,maxSamples:b,samples:S}}function yg(i){let e=this,t=null,n=0,r=!1,s=!1,a=new Bn,o=new Ge,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let f=u.length!==0||d||n!==0||r;return r=d,n=u.length,f},this.beginShadows=function(){s=!0,h(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){let g=u.clippingPlanes,v=u.clipIntersection,m=u.clipShadows,p=i.get(u);if(!r||g===null||g.length===0||s&&!m)s?h(null):c();else{let w=s?0:n,T=w*4,y=p.clippingState||null;l.value=y,y=h(g,d,T,f);for(let b=0;b!==T;++b)y[b]=t[b];p.clippingState=y,this.numIntersection=v?this.numPlanes:0,this.numPlanes+=w}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,g){let v=u!==null?u.length:0,m=null;if(v!==0){if(m=l.value,g!==!0||m===null){let p=f+v*4,w=d.matrixWorldInverse;o.getNormalMatrix(w),(m===null||m.length<p)&&(m=new Float32Array(p));for(let T=0,y=f;T!==v;++T,y+=4)a.copy(u[T]).applyMatrix4(w,o),a.normal.toArray(m,y),m[y+3]=a.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=v,e.numIntersection=0,m}}var zr=4,vg=6,bg=20,Mg=256,qs=new In,ad=new We,Jc=null,Kc=0,jc=0,Qc=!1,Sg=new D,tr=new D,Gr=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,r=100,s={}){let{size:a=256,position:o=Sg}=s;Jc=this._renderer.getRenderTarget(),Kc=this._renderer.getActiveCubeFace(),jc=this._renderer.getActiveMipmapLevel(),Qc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(e,n,r,l,o),t>0&&this._blur(l,0,0,t),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=cd(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=ld(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(Jc,Kc,jc),this._renderer.xr.enabled=Qc,e.scissorTest=!1,Hr(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Ii||e.mapping===Qi?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Jc=this._renderer.getRenderTarget(),Kc=this._renderer.getActiveCubeFace(),jc=this._renderer.getActiveMipmapLevel(),Qc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Xt,minFilter:Xt,generateMipmaps:!1,type:Vn,format:$t,colorSpace:Xi,depthBuffer:!1},r=od(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=od(e,t,n);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods}=Eg(s)),this._blurMaterial=Tg(s,e,t),this._ggxMaterial=wg(s,e,t)}return r}_compileMaterial(e){let t=new Oe(new Tt,e);this._renderer.compile(t,qs)}_sceneToCubeUV(e,t,n,r,s){let l=new Gt(90,1,t,n),c=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],u=this._renderer,d=u.autoClear,f=u.toneMapping;u.getClearColor(ad),u.toneMapping=Sn,u.autoClear=!1,u.state.buffers.depth.getReversed()&&(u.setRenderTarget(r),u.clearDepth(),u.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Oe(new Hn,new nn({name:"PMREM.Background",side:Nt,depthWrite:!1,depthTest:!1})));let v=this._backgroundBox,m=v.material,p=!1,w=e.background;w?w.isColor&&(m.color.copy(w),e.background=null,p=!0):(m.color.copy(ad),p=!0);for(let T=0;T<6;T++){let y=T%3;y===0?(l.up.set(0,c[T],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+h[T],s.y,s.z)):y===1?(l.up.set(0,0,c[T]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+h[T],s.z)):(l.up.set(0,c[T],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+h[T]));let b=this._cubeSize;Hr(r,y*b,T>2?b:0,b,b),u.setRenderTarget(r),p&&u.render(v,l),u.render(e,l)}u.toneMapping=f,u.autoClear=d,e.background=w}_textureToCubeUV(e,t){let n=this._renderer,r=e.mapping===Ii||e.mapping===Qi;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=cd()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=ld());let s=r?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=s;let o=s.uniforms;o.envMap.value=e;let l=this._cubeSize;Hr(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(a,qs)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let r=this._lodMeshes.length;for(let s=1;s<r;s++)this._applyGGXFilter(e,s-1,s);t.autoClear=n}_applyGGXFilter(e,t,n){let r=this._renderer,s=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let l=a.uniforms,c=n/(this._lodMeshes.length-1),h=t/(this._lodMeshes.length-1),u=Math.sqrt(c*c-h*h),d=c*1.25,f=u*d,{_lodMax:g}=this,v=this._sizeLods[n],m=3*v*(n>g-zr?n-g+zr:0),p=4*(this._cubeSize-v);l.envMap.value=e.texture,l.roughness.value=f,l.mipInt.value=g-t,Hr(s,m,p,3*v,2*v),r.setRenderTarget(s),r.render(o,qs),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=g-n,Hr(e,m,p,3*v,2*v),r.setRenderTarget(e),r.render(o,qs)}_blur(e,t,n,r){let s=this._pingPongRenderTarget,a=Math.min(r,Math.PI)/Math.SQRT2;this._blurPass(e,s,t,n,a),this._blurPass(s,e,n,n,a)}_blurPass(e,t,n,r,s){let a=this._renderer,o=this._blurMaterial,l=this._lodMeshes[r];l.material=o;let c=o.uniforms;c.envMap.value=e.texture,c.sigma.value=s,c.mipInt.value=this._lodMax-n;let h=this._sizeLods[r],u=3*h*(r>this._lodMax-zr?r-this._lodMax+zr:0),d=4*(this._cubeSize-h);Hr(t,u,d,3*h,2*h),a.setRenderTarget(t),a.render(l,qs)}};function Eg(i){let e=[],t=[],n=i,r=i-zr+1+vg;for(let s=0;s<r;s++){let a=Math.pow(2,n);e.push(a);let o=1/(a-2),l=-o,c=1+o,h=[l,l,c,l,c,c,l,l,c,c,l,c],u=6,d=6,f=3,g=new Float32Array(f*d*u),v=new Float32Array(f*d*u);for(let p=0;p<u;p++){let w=p%3*2/3-1,T=p>2?0:-1,y=[w,T,0,w+2/3,T,0,w+2/3,T+1,0,w,T,0,w+2/3,T+1,0,w,T+1,0];g.set(y,f*d*p);for(let b=0;b<d;b++){let S=h[b*2]*2-1,C=h[b*2+1]*2-1;p===0?tr.set(1,C,S):p===1?tr.set(-S,1,-C):p===2?tr.set(-S,C,1):p===3?tr.set(-1,C,-S):p===4?tr.set(-S,-1,C):tr.set(S,C,-1),tr.toArray(v,(p*d+b)*f)}}let m=new Tt;m.setAttribute("position",new Dt(g,f)),m.setAttribute("outputDirection",new Dt(v,f)),t.push(new Oe(m,null)),n>zr&&n--}return{lodMeshes:t,sizeLods:e}}function od(i,e,t){let n=new qt(i,e,t);return n.texture.mapping=Us,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Hr(i,e,t,n,r){i.viewport.set(e,t,n,r),i.scissor.set(e,t,n,r)}function wg(i,e,t){return new Rt({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:Mg,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:cl(),fragmentShader:`

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
		`,blending:Kn,depthTest:!1,depthWrite:!1})}function Tg(i,e,t){return new Rt({name:"SphericalGaussianBlur",defines:{SAMPLES:bg,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},sigma:{value:0},mipInt:{value:0}},vertexShader:cl(),fragmentShader:`

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
		`,blending:Kn,depthTest:!1,depthWrite:!1})}function ld(){return new Rt({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:cl(),fragmentShader:`

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
		`,blending:Kn,depthTest:!1,depthWrite:!1})}function cd(){return new Rt({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:cl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Kn,depthTest:!1,depthWrite:!1})}function cl(){return`

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`}var ol=class extends qt{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},r=[n,n,n,n,n,n];this.texture=new ys(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new Hn(5,5,5),s=new Rt({name:"CubemapFromEquirect",uniforms:er(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Nt,blending:Kn});s.uniforms.tEquirect.value=t;let a=new Oe(r,s),o=t.minFilter;return t.minFilter===jn&&(t.minFilter=Xt),new fo(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,r=!0){let s=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,r);e.setRenderTarget(s)}};function Ag(i){let e=new WeakMap,t=new WeakMap,n=null;function r(d,f=!1){return d==null?null:f?a(d):s(d)}function s(d){if(d&&d.isTexture){let f=d.mapping;if(f===xo||f===_o)if(e.has(d)){let g=e.get(d).texture;return o(g,d.mapping)}else{let g=d.image;if(g&&g.height>0){let v=new ol(g.height);return v.fromEquirectangularTexture(i,d),e.set(d,v),d.addEventListener("dispose",c),o(v.texture,d.mapping)}else return null}}return d}function a(d){if(d&&d.isTexture){let f=d.mapping,g=f===xo||f===_o,v=f===Ii||f===Qi;if(g||v){let m=t.get(d),p=m!==void 0?m.texture.pmremVersion:0;if(d.isRenderTargetTexture&&d.pmremVersion!==p)return n===null&&(n=new Gr(i)),m=g?n.fromEquirectangular(d,m):n.fromCubemap(d,m),m.texture.pmremVersion=d.pmremVersion,t.set(d,m),m.texture;if(m!==void 0)return m.texture;{let w=d.image;return g&&w&&w.height>0||v&&w&&l(w)?(n===null&&(n=new Gr(i)),m=g?n.fromEquirectangular(d):n.fromCubemap(d),m.texture.pmremVersion=d.pmremVersion,t.set(d,m),d.addEventListener("dispose",h),m.texture):null}}}return d}function o(d,f){return f===xo?d.mapping=Ii:f===_o&&(d.mapping=Qi),d}function l(d){let f=0,g=6;for(let v=0;v<g;v++)d[v]!==void 0&&f++;return f===g}function c(d){let f=d.target;f.removeEventListener("dispose",c);let g=e.get(f);g!==void 0&&(e.delete(f),g.dispose())}function h(d){let f=d.target;f.removeEventListener("dispose",h);let g=t.get(f);g!==void 0&&(t.delete(f),g.dispose())}function u(){e=new WeakMap,t=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:r,dispose:u}}function Rg(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let r=i.getExtension(n);return e[n]=r,r}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let r=t(n);return r===null&&Wi("WebGLRenderer: "+n+" extension not supported."),r}}}function Cg(i,e,t,n){let r={},s=new WeakMap;function a(u){let d=u.target;d.index!==null&&e.remove(d.index);for(let g in d.attributes)e.remove(d.attributes[g]);d.removeEventListener("dispose",a),delete r[d.id];let f=s.get(d);f&&(e.remove(f),s.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function o(u,d){return r[d.id]===!0||(d.addEventListener("dispose",a),r[d.id]=!0,t.memory.geometries++),d}function l(u){let d=u.attributes;for(let f in d)e.update(d[f],i.ARRAY_BUFFER)}function c(u){let d=[],f=u.index,g=u.attributes.position,v=0;if(g===void 0)return;if(f!==null){let w=f.array;v=f.version;for(let T=0,y=w.length;T<y;T+=3){let b=w[T+0],S=w[T+1],C=w[T+2];d.push(b,S,S,C,C,b)}}else{let w=g.array;v=g.version;for(let T=0,y=w.length/3-1;T<y;T+=3){let b=T+0,S=T+1,C=T+2;d.push(b,S,S,C,C,b)}}let m=new(g.count>=65535?ms:ps)(d,1);m.version=v;let p=s.get(u);p&&e.remove(p),s.set(u,m)}function h(u){let d=s.get(u);if(d){let f=u.index;f!==null&&d.version<f.version&&c(u)}else c(u);return s.get(u)}return{get:o,update:l,getWireframeAttribute:h}}function Pg(i,e,t){let n;function r(u){n=u}let s,a;function o(u){s=u.type,a=u.bytesPerElement}function l(u,d){i.drawElements(n,d,s,u*a),t.update(d,n,1)}function c(u,d,f){f!==0&&(i.drawElementsInstanced(n,d,s,u*a,f),t.update(d,n,f))}function h(u,d,f){if(f===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,d,0,s,u,0,f);let v=0;for(let m=0;m<f;m++)v+=d[m];t.update(v,n,1)}this.setMode=r,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h}function Ig(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(s,a,o){switch(t.calls++,a){case i.TRIANGLES:t.triangles+=o*(s/3);break;case i.LINES:t.lines+=o*(s/2);break;case i.LINE_STRIP:t.lines+=o*(s-1);break;case i.LINE_LOOP:t.lines+=o*s;break;case i.POINTS:t.points+=o*s;break;default:Ve("WebGLInfo: Unknown draw mode:",a);break}}function r(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:r,update:n}}function Lg(i,e,t){let n=new WeakMap,r=new St;function s(a,o,l){let c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0,d=n.get(o);if(d===void 0||d.count!==u){let E=function(){C.dispose(),n.delete(o),o.removeEventListener("dispose",E)};d!==void 0&&d.texture.dispose();let f=o.morphAttributes.position!==void 0,g=o.morphAttributes.normal!==void 0,v=o.morphAttributes.color!==void 0,m=o.morphAttributes.position||[],p=o.morphAttributes.normal||[],w=o.morphAttributes.color||[],T=0;f===!0&&(T=1),g===!0&&(T=2),v===!0&&(T=3);let y=o.attributes.position.count*T,b=1;y>e.maxTextureSize&&(b=Math.ceil(y/e.maxTextureSize),y=e.maxTextureSize);let S=new Float32Array(y*b*4*u),C=new ds(S,y,b,u);C.type=fn,C.needsUpdate=!0;let _=T*4;for(let I=0;I<u;I++){let N=m[I],P=p[I],F=w[I],U=y*b*4*I;for(let H=0;H<N.count;H++){let q=H*_;f===!0&&(r.fromBufferAttribute(N,H),S[U+q+0]=r.x,S[U+q+1]=r.y,S[U+q+2]=r.z,S[U+q+3]=0),g===!0&&(r.fromBufferAttribute(P,H),S[U+q+4]=r.x,S[U+q+5]=r.y,S[U+q+6]=r.z,S[U+q+7]=0),v===!0&&(r.fromBufferAttribute(F,H),S[U+q+8]=r.x,S[U+q+9]=r.y,S[U+q+10]=r.z,S[U+q+11]=F.itemSize===4?r.w:1)}}d={count:u,texture:C,size:new De(y,b)},n.set(o,d),o.addEventListener("dispose",E)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",a.morphTexture,t);else{let f=0;for(let v=0;v<c.length;v++)f+=c[v];let g=o.morphTargetsRelative?1:1-f;l.getUniforms().setValue(i,"morphTargetBaseInfluence",g),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",d.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",d.size)}return{update:s}}function Ug(i,e,t,n,r){let s=new WeakMap;function a(c){let h=r.render.frame,u=c.geometry,d=e.get(c,u);if(s.get(d)!==h&&(e.update(d),s.set(d,h)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==h&&(t.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,i.ARRAY_BUFFER),s.set(c,h))),c.isSkinnedMesh){let f=c.skeleton;s.get(f)!==h&&(f.update(),s.set(f,h))}return d}function o(){s=new WeakMap}function l(c){let h=c.target;h.removeEventListener("dispose",l),n.releaseStatesOfObject(h),t.remove(h.instanceMatrix),h.instanceColor!==null&&t.remove(h.instanceColor)}return{update:a,dispose:o}}var Dg={[Rc]:"LINEAR_TONE_MAPPING",[Cc]:"REINHARD_TONE_MAPPING",[Pc]:"CINEON_TONE_MAPPING",[Ic]:"ACES_FILMIC_TONE_MAPPING",[Uc]:"AGX_TONE_MAPPING",[Dc]:"NEUTRAL_TONE_MAPPING",[Lc]:"CUSTOM_TONE_MAPPING"};function Ng(i,e,t,n,r,s){let a=new qt(e,t,{type:i,depthBuffer:r,stencilBuffer:s,samples:n?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),o=null,l=null,c=new Tt;c.setAttribute("position",new nt([-1,3,0,-1,-1,0,3,-1,0],3)),c.setAttribute("uv",new nt([0,2,0,0,2,0],2));let h=new eo({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),u=new Oe(c,h),d=new In(-1,1,1,-1,0,1),f=null,g=null,v=!1,m,p=null,w=[],T=!1;this.setSize=function(y,b){a.setSize(y,b),o!==null&&o.setSize(y,b),l!==null&&l.setSize(y,b);for(let S=0;S<w.length;S++){let C=w[S];C.setSize&&C.setSize(y,b)}},this.setEffects=function(y){w=y,T=w.length>0&&w[0].isRenderPass===!0;let b=a.width,S=a.height;w.length>0&&o===null&&(o=new qt(b,S,{type:Vn,depthBuffer:!1,stencilBuffer:!1}),l=new qt(b,S,{type:Vn,depthBuffer:!1,stencilBuffer:!1}));for(let C=0;C<w.length;C++){let _=w[C];_.setSize&&_.setSize(b,S)}},this.begin=function(y,b){if(v||y.toneMapping===Sn&&w.length===0)return!1;if(p=b,b!==null){let S=b.width,C=b.height;(a.width!==S||a.height!==C)&&this.setSize(S,C)}return T===!1&&y.setRenderTarget(a),m=y.toneMapping,y.toneMapping=Sn,!0},this.hasRenderPass=function(){return T},this.end=function(y,b){y.toneMapping=m,v=!0;let S=a,C=o;for(let _=0;_<w.length;_++){let E=w[_];E.enabled!==!1&&(E.render(y,C,S,b),E.needsSwap!==!1&&(S=C,C=C===o?l:o))}if(f!==y.outputColorSpace||g!==y.toneMapping){f=y.outputColorSpace,g=y.toneMapping,h.defines={},Je.getTransfer(f)===lt&&(h.defines.SRGB_TRANSFER="");let _=Dg[g];_&&(h.defines[_]=""),h.needsUpdate=!0}h.uniforms.tDiffuse.value=S.texture,y.setRenderTarget(p),y.render(u,d),p=null,v=!1},this.isCompositing=function(){return v},this.dispose=function(){a.dispose(),o!==null&&o.dispose(),l!==null&&l.dispose(),c.dispose(),h.dispose()}}var Cd=new ln,nh=new Ei(1,1),Pd=new ds,Id=new Ga,Ld=new ys,hd=[],ud=[],dd=new Float32Array(16),fd=new Float32Array(9),pd=new Float32Array(4);function Wr(i,e,t){let n=i[0];if(n<=0||n>0)return i;let r=e*t,s=hd[r];if(s===void 0&&(s=new Float32Array(r),hd[r]=s),e!==0){n.toArray(s,0);for(let a=1,o=0;a!==e;++a)o+=t,i[a].toArray(s,o)}return s}function Ot(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function Bt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function hl(i,e){let t=ud[e];t===void 0&&(t=new Int32Array(e),ud[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function Fg(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function Og(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Ot(t,e))return;i.uniform2fv(this.addr,e),Bt(t,e)}}function Bg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(Ot(t,e))return;i.uniform3fv(this.addr,e),Bt(t,e)}}function kg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Ot(t,e))return;i.uniform4fv(this.addr,e),Bt(t,e)}}function Hg(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Ot(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),Bt(t,e)}else{if(Ot(t,n))return;pd.set(n),i.uniformMatrix2fv(this.addr,!1,pd),Bt(t,n)}}function zg(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Ot(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),Bt(t,e)}else{if(Ot(t,n))return;fd.set(n),i.uniformMatrix3fv(this.addr,!1,fd),Bt(t,n)}}function Vg(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(Ot(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),Bt(t,e)}else{if(Ot(t,n))return;dd.set(n),i.uniformMatrix4fv(this.addr,!1,dd),Bt(t,n)}}function Gg(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function Wg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Ot(t,e))return;i.uniform2iv(this.addr,e),Bt(t,e)}}function Xg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Ot(t,e))return;i.uniform3iv(this.addr,e),Bt(t,e)}}function qg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Ot(t,e))return;i.uniform4iv(this.addr,e),Bt(t,e)}}function Yg(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function $g(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Ot(t,e))return;i.uniform2uiv(this.addr,e),Bt(t,e)}}function Zg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Ot(t,e))return;i.uniform3uiv(this.addr,e),Bt(t,e)}}function Jg(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Ot(t,e))return;i.uniform4uiv(this.addr,e),Bt(t,e)}}function Kg(i,e,t){let n=this.cache,r=t.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r);let s;this.type===i.SAMPLER_2D_SHADOW?(nh.compareFunction=t.isReversedDepthBuffer()?rl:il,s=nh):s=Cd,t.setTexture2D(e||s,r)}function jg(i,e,t){let n=this.cache,r=t.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),t.setTexture3D(e||Id,r)}function Qg(i,e,t){let n=this.cache,r=t.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),t.setTextureCube(e||Ld,r)}function ex(i,e,t){let n=this.cache,r=t.allocateTextureUnit();n[0]!==r&&(i.uniform1i(this.addr,r),n[0]=r),t.setTexture2DArray(e||Pd,r)}function tx(i){switch(i){case 5126:return Fg;case 35664:return Og;case 35665:return Bg;case 35666:return kg;case 35674:return Hg;case 35675:return zg;case 35676:return Vg;case 5124:case 35670:return Gg;case 35667:case 35671:return Wg;case 35668:case 35672:return Xg;case 35669:case 35673:return qg;case 5125:return Yg;case 36294:return $g;case 36295:return Zg;case 36296:return Jg;case 35678:case 36198:case 36298:case 36306:case 35682:return Kg;case 35679:case 36299:case 36307:return jg;case 35680:case 36300:case 36308:case 36293:return Qg;case 36289:case 36303:case 36311:case 36292:return ex}}function nx(i,e){i.uniform1fv(this.addr,e)}function ix(i,e){let t=Wr(e,this.size,2);i.uniform2fv(this.addr,t)}function rx(i,e){let t=Wr(e,this.size,3);i.uniform3fv(this.addr,t)}function sx(i,e){let t=Wr(e,this.size,4);i.uniform4fv(this.addr,t)}function ax(i,e){let t=Wr(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function ox(i,e){let t=Wr(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function lx(i,e){let t=Wr(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function cx(i,e){i.uniform1iv(this.addr,e)}function hx(i,e){i.uniform2iv(this.addr,e)}function ux(i,e){i.uniform3iv(this.addr,e)}function dx(i,e){i.uniform4iv(this.addr,e)}function fx(i,e){i.uniform1uiv(this.addr,e)}function px(i,e){i.uniform2uiv(this.addr,e)}function mx(i,e){i.uniform3uiv(this.addr,e)}function gx(i,e){i.uniform4uiv(this.addr,e)}function xx(i,e,t){let n=this.cache,r=e.length,s=hl(t,r);Ot(n,s)||(i.uniform1iv(this.addr,s),Bt(n,s));let a;this.type===i.SAMPLER_2D_SHADOW?a=nh:a=Cd;for(let o=0;o!==r;++o)t.setTexture2D(e[o]||a,s[o])}function _x(i,e,t){let n=this.cache,r=e.length,s=hl(t,r);Ot(n,s)||(i.uniform1iv(this.addr,s),Bt(n,s));for(let a=0;a!==r;++a)t.setTexture3D(e[a]||Id,s[a])}function yx(i,e,t){let n=this.cache,r=e.length,s=hl(t,r);Ot(n,s)||(i.uniform1iv(this.addr,s),Bt(n,s));for(let a=0;a!==r;++a)t.setTextureCube(e[a]||Ld,s[a])}function vx(i,e,t){let n=this.cache,r=e.length,s=hl(t,r);Ot(n,s)||(i.uniform1iv(this.addr,s),Bt(n,s));for(let a=0;a!==r;++a)t.setTexture2DArray(e[a]||Pd,s[a])}function bx(i){switch(i){case 5126:return nx;case 35664:return ix;case 35665:return rx;case 35666:return sx;case 35674:return ax;case 35675:return ox;case 35676:return lx;case 5124:case 35670:return cx;case 35667:case 35671:return hx;case 35668:case 35672:return ux;case 35669:case 35673:return dx;case 5125:return fx;case 36294:return px;case 36295:return mx;case 36296:return gx;case 35678:case 36198:case 36298:case 36306:case 35682:return xx;case 35679:case 36299:case 36307:return _x;case 35680:case 36300:case 36308:case 36293:return yx;case 36289:case 36303:case 36311:case 36292:return vx}}var ih=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=tx(t.type)}},rh=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=bx(t.type)}},sh=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let r=this.seq;for(let s=0,a=r.length;s!==a;++s){let o=r[s];o.setValue(e,t[o.id],n)}}},eh=/(\w+)(\])?(\[|\.)?/g;function md(i,e){i.seq.push(e),i.map[e.id]=e}function Mx(i,e,t){let n=i.name,r=n.length;for(eh.lastIndex=0;;){let s=eh.exec(n),a=eh.lastIndex,o=s[1],l=s[2]==="]",c=s[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===r){md(t,c===void 0?new ih(o,i,e):new rh(o,i,e));break}else{let u=t.map[o];u===void 0&&(u=new sh(o),md(t,u)),t=u}}}var Vr=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let a=0;a<n;++a){let o=e.getActiveUniform(t,a),l=e.getUniformLocation(t,o.name);Mx(o,l,this)}let r=[],s=[];for(let a of this.seq)a.type===e.SAMPLER_2D_SHADOW||a.type===e.SAMPLER_CUBE_SHADOW||a.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(a):s.push(a);r.length>0&&(this.seq=r.concat(s))}setValue(e,t,n,r){let s=this.map[t];s!==void 0&&s.setValue(e,n,r)}setOptional(e,t,n){let r=t[n];r!==void 0&&this.setValue(e,n,r)}static upload(e,t,n,r){for(let s=0,a=t.length;s!==a;++s){let o=t[s],l=n[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,r)}}static seqWithValue(e,t){let n=[];for(let r=0,s=e.length;r!==s;++r){let a=e[r];a.id in t&&n.push(a)}return n}};function gd(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var Sx=37297,Ex=0;function wx(i,e){let t=i.split(`
`),n=[],r=Math.max(e-6,0),s=Math.min(e+6,t.length);for(let a=r;a<s;a++){let o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}var xd=new Ge;function Tx(i){Je._getMatrix(xd,Je.workingColorSpace,i);let e=`mat3( ${xd.elements.map(t=>t.toFixed(4))} )`;switch(Je.getTransfer(i)){case cs:return[e,"LinearTransferOETF"];case lt:return[e,"sRGBTransferOETF"];default:return He("WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function _d(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),s=(i.getShaderInfoLog(e)||"").trim();if(n&&s==="")return"";let a=/ERROR: 0:(\d+)/.exec(s);if(a){let o=parseInt(a[1]);return t.toUpperCase()+`

`+s+`

`+wx(i.getShaderSource(e),o)}else return s}function Ax(i,e){let t=Tx(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}var Rx={[Rc]:"Linear",[Cc]:"Reinhard",[Pc]:"Cineon",[Ic]:"ACESFilmic",[Uc]:"AgX",[Dc]:"Neutral",[Lc]:"Custom"};function Cx(i,e){let t=Rx[e];return t===void 0?(He("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+i+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var al=new D;function Px(){Je.getLuminanceCoefficients(al);let i=al.x.toFixed(4),e=al.y.toFixed(4),t=al.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Ix(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter($s).join(`
`)}function Lx(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Ux(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let r=0;r<n;r++){let s=i.getActiveAttrib(e,r),a=s.name,o=1;s.type===i.FLOAT_MAT2&&(o=2),s.type===i.FLOAT_MAT3&&(o=3),s.type===i.FLOAT_MAT4&&(o=4),t[a]={type:s.type,location:i.getAttribLocation(e,a),locationSize:o}}return t}function $s(i){return i!==""}function yd(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_SUN_LIGHTS/g,e.numSunLights).replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,e.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function vd(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Dx=/^[ \t]*#include +<([\w\d./]+)>/gm;function ah(i){return i.replace(Dx,Fx)}var Nx=new Map;function Fx(i,e){let t=Ze[e];if(t===void 0){let n=Nx.get(e);if(n!==void 0)t=Ze[n],He('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+e+">")}return ah(t)}var Ox=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function bd(i){return i.replace(Ox,Bx)}function Bx(i,e,t,n){let r="";for(let s=parseInt(e);s<parseInt(t);s++)r+=n.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return r}function Md(i){let e=`precision ${i.precision} float;
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
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}var kx={[Is]:"SHADOWMAP_TYPE_PCF",[Nr]:"SHADOWMAP_TYPE_VSM"};function Hx(i){return kx[i.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var zx={[Ii]:"ENVMAP_TYPE_CUBE",[Qi]:"ENVMAP_TYPE_CUBE",[Us]:"ENVMAP_TYPE_CUBE_UV"};function Vx(i){return i.envMap===!1?"ENVMAP_TYPE_CUBE":zx[i.envMapMode]||"ENVMAP_TYPE_CUBE"}var Gx={[Qi]:"ENVMAP_MODE_REFRACTION"};function Wx(i){return i.envMap===!1?"ENVMAP_MODE_REFLECTION":Gx[i.envMapMode]||"ENVMAP_MODE_REFLECTION"}var Xx={[go]:"ENVMAP_BLENDING_MULTIPLY",[Hu]:"ENVMAP_BLENDING_MIX",[zu]:"ENVMAP_BLENDING_ADD"};function qx(i){return i.envMap===!1?"ENVMAP_BLENDING_NONE":Xx[i.combine]||"ENVMAP_BLENDING_NONE"}function Yx(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function $x(i,e,t,n){let r=i.getContext(),s=t.defines,a=t.vertexShader,o=t.fragmentShader,l=Hx(t),c=Vx(t),h=Wx(t),u=qx(t),d=Yx(t),f=Ix(t),g=Lx(s),v=r.createProgram(),m,p,w=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter($s).join(`
`),m.length>0&&(m+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter($s).join(`
`),p.length>0&&(p+=`
`)):(m=[Md(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexNormals?"#define HAS_NORMAL":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter($s).join(`
`),p=[Md(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.retroreflection?"#define USE_RETROREFLECTION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas||t.batchingColor?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Sn?"#define TONE_MAPPING":"",t.toneMapping!==Sn?Ze.tonemapping_pars_fragment:"",t.toneMapping!==Sn?Cx("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Ze.colorspace_pars_fragment,Ax("linearToOutputTexel",t.outputColorSpace),Px(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter($s).join(`
`)),a=ah(a),a=yd(a,t),a=vd(a,t),o=ah(o),o=yd(o,t),o=vd(o,t),a=bd(a),o=bd(o),t.isRawShaderMaterial!==!0&&(w=`#version 300 es
`,m=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,p=["#define varying in",t.glslVersion===Gc?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Gc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);let T=w+m+a,y=w+p+o,b=gd(r,r.VERTEX_SHADER,T),S=gd(r,r.FRAGMENT_SHADER,y);r.attachShader(v,b),r.attachShader(v,S),t.index0AttributeName!==void 0?r.bindAttribLocation(v,0,t.index0AttributeName):t.hasPositionAttribute===!0&&r.bindAttribLocation(v,0,"position"),r.linkProgram(v);function C(N){if(i.debug.checkShaderErrors){let P=r.getProgramInfoLog(v)||"",F=r.getShaderInfoLog(b)||"",U=r.getShaderInfoLog(S)||"",H=P.trim(),q=F.trim(),Y=U.trim(),ce=!0,G=!0;if(r.getProgramParameter(v,r.LINK_STATUS)===!1)if(ce=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(r,v,b,S);else{let J=_d(r,b,"vertex"),W=_d(r,S,"fragment");Ve("WebGLProgram: Shader Error "+r.getError()+" - VALIDATE_STATUS "+r.getProgramParameter(v,r.VALIDATE_STATUS)+`

Material Name: `+N.name+`
Material Type: `+N.type+`

Program Info Log: `+H+`
`+J+`
`+W)}else H!==""?He("WebGLProgram: Program Info Log:",H):(q===""||Y==="")&&(G=!1);G&&(N.diagnostics={runnable:ce,programLog:H,vertexShader:{log:q,prefix:m},fragmentShader:{log:Y,prefix:p}})}r.deleteShader(b),r.deleteShader(S),_=new Vr(r,v),E=Ux(r,v)}let _;this.getUniforms=function(){return _===void 0&&C(this),_};let E;this.getAttributes=function(){return E===void 0&&C(this),E};let I=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return I===!1&&(I=r.getProgramParameter(v,Sx)),I},this.destroy=function(){n.releaseStatesOfProgram(this),r.deleteProgram(v),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Ex++,this.cacheKey=e,this.usedTimes=1,this.program=v,this.vertexShader=b,this.fragmentShader=S,this}var Zx=0,oh=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let r=this._getShaderCacheForMaterial(e);return r.has(t)===!1&&(r.add(t),t.usedTimes++),r.has(n)===!1&&(r.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new lh(e),t.set(e,n)),n}},lh=class{constructor(e){this.id=Zx++,this.code=e,this.usedTimes=0}};function Jx(i){return i===Ui||i===ks||i===Hs}function Kx(i,e,t,n,r,s){let a=new fs,o=new oh,l=new Set,c=[],h=new Map,u=n.logarithmicDepthBuffer,d=n.precision,f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function g(_){return l.add(_),_===0?"uv":`uv${_}`}function v(_,E,I,N,P,F){let U=N.fog,H=P.geometry,q=_.isMeshStandardMaterial||_.isMeshLambertMaterial||_.isMeshPhongMaterial?N.environment:null,Y=_.isMeshStandardMaterial||_.isMeshLambertMaterial&&!_.envMap||_.isMeshPhongMaterial&&!_.envMap,ce=e.get(_.envMap||q,Y),G=ce&&ce.mapping===Us?ce.image.height:null,J=f[_.type];_.precision!==null&&(d=n.getMaxPrecision(_.precision),d!==_.precision&&He("WebGLProgram.getParameters:",_.precision,"not supported, using",d,"instead."));let W=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,ue=W!==void 0?W.length:0,pe=0;H.morphAttributes.position!==void 0&&(pe=1),H.morphAttributes.normal!==void 0&&(pe=2),H.morphAttributes.color!==void 0&&(pe=3);let Me,Se,de,X;if(J){let it=ei[J];Me=it.vertexShader,Se=it.fragmentShader}else{Me=_.vertexShader,Se=_.fragmentShader;let it=o.getVertexShaderStage(_),at=o.getFragmentShaderStage(_);o.update(_,it,at),de=it.id,X=at.id}let ne=i.getRenderTarget(),ye=i.state.buffers.depth.getReversed(),Pe=P.isInstancedMesh===!0,_e=P.isBatchedMesh===!0,Ce=!!_.map,qe=!!_.matcap,Be=!!ce,ze=!!_.aoMap,Xe=!!_.lightMap,ke=!!_.bumpMap&&_.wireframe===!1,Qe=!!_.normalMap,gt=!!_.displacementMap,Et=!!_.emissiveMap,pt=!!_.metalnessMap,ht=!!_.roughnessMap,O=_.anisotropy>0,oe=_.clearcoat>0,xe=_.dispersion>0,R=_.retroreflectivity>0,x=_.iridescence>0,z=_.sheen>0,K=_.transmission>0,se=O&&!!_.anisotropyMap,A=oe&&!!_.clearcoatMap,k=oe&&!!_.clearcoatNormalMap,V=oe&&!!_.clearcoatRoughnessMap,$=x&&!!_.iridescenceMap,ae=x&&!!_.iridescenceThicknessMap,le=z&&!!_.sheenColorMap,ie=z&&!!_.sheenRoughnessMap,ee=!!_.specularMap,Z=!!_.specularColorMap,he=!!_.specularIntensityMap,ge=K&&!!_.transmissionMap,L=K&&!!_.thicknessMap,fe=!!_.gradientMap,te=!!_.alphaMap,ve=_.alphaTest>0,be=!!_.alphaHash,me=!!_.extensions,Ne=Sn;_.toneMapped&&(ne===null||ne.isXRRenderTarget===!0)&&(Ne=i.toneMapping);let Ie={shaderID:J,shaderType:_.type,shaderName:_.name,vertexShader:Me,fragmentShader:Se,defines:_.defines,customVertexShaderID:de,customFragmentShaderID:X,isRawShaderMaterial:_.isRawShaderMaterial===!0,glslVersion:_.glslVersion,precision:d,batching:_e,batchingColor:_e&&P._colorsTexture!==null,instancing:Pe,instancingColor:Pe&&P.instanceColor!==null,instancingMorph:Pe&&P.morphTexture!==null,outputColorSpace:ne===null?i.outputColorSpace:ne.isXRRenderTarget===!0?ne.texture.colorSpace:Je.workingColorSpace,alphaToCoverage:!!_.alphaToCoverage,map:Ce,matcap:qe,envMap:Be,envMapMode:Be&&ce.mapping,envMapCubeUVHeight:G,aoMap:ze,lightMap:Xe,bumpMap:ke,normalMap:Qe,displacementMap:gt,emissiveMap:Et,normalMapObjectSpace:Qe&&_.normalMapType===Wu,normalMapTangentSpace:Qe&&_.normalMapType===Vs,packedNormalMap:Qe&&_.normalMapType===Vs&&Jx(_.normalMap.format),metalnessMap:pt,roughnessMap:ht,anisotropy:O,anisotropyMap:se,clearcoat:oe,clearcoatMap:A,clearcoatNormalMap:k,clearcoatRoughnessMap:V,dispersion:xe,retroreflection:R,iridescence:x,iridescenceMap:$,iridescenceThicknessMap:ae,sheen:z,sheenColorMap:le,sheenRoughnessMap:ie,specularMap:ee,specularColorMap:Z,specularIntensityMap:he,transmission:K,transmissionMap:ge,thicknessMap:L,gradientMap:fe,opaque:_.transparent===!1&&_.blending===Pi&&_.alphaToCoverage===!1,alphaMap:te,alphaTest:ve,alphaHash:be,combine:_.combine,mapUv:Ce&&g(_.map.channel),aoMapUv:ze&&g(_.aoMap.channel),lightMapUv:Xe&&g(_.lightMap.channel),bumpMapUv:ke&&g(_.bumpMap.channel),normalMapUv:Qe&&g(_.normalMap.channel),displacementMapUv:gt&&g(_.displacementMap.channel),emissiveMapUv:Et&&g(_.emissiveMap.channel),metalnessMapUv:pt&&g(_.metalnessMap.channel),roughnessMapUv:ht&&g(_.roughnessMap.channel),anisotropyMapUv:se&&g(_.anisotropyMap.channel),clearcoatMapUv:A&&g(_.clearcoatMap.channel),clearcoatNormalMapUv:k&&g(_.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:V&&g(_.clearcoatRoughnessMap.channel),iridescenceMapUv:$&&g(_.iridescenceMap.channel),iridescenceThicknessMapUv:ae&&g(_.iridescenceThicknessMap.channel),sheenColorMapUv:le&&g(_.sheenColorMap.channel),sheenRoughnessMapUv:ie&&g(_.sheenRoughnessMap.channel),specularMapUv:ee&&g(_.specularMap.channel),specularColorMapUv:Z&&g(_.specularColorMap.channel),specularIntensityMapUv:he&&g(_.specularIntensityMap.channel),transmissionMapUv:ge&&g(_.transmissionMap.channel),thicknessMapUv:L&&g(_.thicknessMap.channel),alphaMapUv:te&&g(_.alphaMap.channel),vertexTangents:!!H.attributes.tangent&&(Qe||O),vertexNormals:!!H.attributes.normal,vertexColors:_.vertexColors,vertexAlphas:_.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,pointsUvs:P.isPoints===!0&&!!H.attributes.uv&&(Ce||te),fog:!!U,useFog:_.fog===!0,fogExp2:!!U&&U.isFogExp2,flatShading:_.wireframe===!1&&(_.flatShading===!0||H.attributes.normal===void 0&&Qe===!1&&(_.isMeshLambertMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isMeshPhysicalMaterial)),sizeAttenuation:_.sizeAttenuation===!0,logarithmicDepthBuffer:u,reversedDepthBuffer:ye,skinning:P.isSkinnedMesh===!0,hasPositionAttribute:H.attributes.position!==void 0,morphTargets:H.morphAttributes.position!==void 0,morphNormals:H.morphAttributes.normal!==void 0,morphColors:H.morphAttributes.color!==void 0,morphTargetsCount:ue,morphTextureStride:pe,numSunLights:E.sun.length,numDirLights:E.directional.length,numPointLights:E.point.length,numSpotLights:E.spot.length,numSpotLightMaps:E.spotLightMap.length,numRectAreaLights:E.rectArea.length,numHemiLights:E.hemi.length,numSunLightShadows:E.sunShadowMap.length,numDirLightShadows:E.directionalShadowMap.length,numPointLightShadows:E.pointShadowMap.length,numSpotLightShadows:E.spotShadowMap.length,numSpotLightShadowsWithMaps:E.numSpotLightShadowsWithMaps,numLightProbes:E.numLightProbes,numLightProbeGrids:F.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:_.dithering,shadowMapEnabled:i.shadowMap.enabled&&I.length>0,shadowMapType:i.shadowMap.type,toneMapping:Ne,decodeVideoTexture:Ce&&_.map.isVideoTexture===!0&&Je.getTransfer(_.map.colorSpace)===lt,decodeVideoTextureEmissive:Et&&_.emissiveMap.isVideoTexture===!0&&Je.getTransfer(_.emissiveMap.colorSpace)===lt,premultipliedAlpha:_.premultipliedAlpha,doubleSided:_.side===Ft,flipSided:_.side===Nt,useDepthPacking:_.depthPacking>=0,depthPacking:_.depthPacking||0,index0AttributeName:_.index0AttributeName,extensionClipCullDistance:me&&_.extensions.clipCullDistance===!0&&t.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(me&&_.extensions.multiDraw===!0||_e)&&t.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:t.has("KHR_parallel_shader_compile"),customProgramCacheKey:_.customProgramCacheKey()};return Ie.vertexUv1s=l.has(1),Ie.vertexUv2s=l.has(2),Ie.vertexUv3s=l.has(3),l.clear(),Ie}function m(_){let E=[];if(_.shaderID?E.push(_.shaderID):(E.push(_.customVertexShaderID),E.push(_.customFragmentShaderID)),_.defines!==void 0)for(let I in _.defines)E.push(I),E.push(_.defines[I]);return _.isRawShaderMaterial===!1&&(p(E,_),w(E,_),E.push(i.outputColorSpace)),E.push(_.customProgramCacheKey),E.join()}function p(_,E){_.push(E.precision),_.push(E.outputColorSpace),_.push(E.envMapMode),_.push(E.envMapCubeUVHeight),_.push(E.mapUv),_.push(E.alphaMapUv),_.push(E.lightMapUv),_.push(E.aoMapUv),_.push(E.bumpMapUv),_.push(E.normalMapUv),_.push(E.displacementMapUv),_.push(E.emissiveMapUv),_.push(E.metalnessMapUv),_.push(E.roughnessMapUv),_.push(E.anisotropyMapUv),_.push(E.clearcoatMapUv),_.push(E.clearcoatNormalMapUv),_.push(E.clearcoatRoughnessMapUv),_.push(E.iridescenceMapUv),_.push(E.iridescenceThicknessMapUv),_.push(E.sheenColorMapUv),_.push(E.sheenRoughnessMapUv),_.push(E.specularMapUv),_.push(E.specularColorMapUv),_.push(E.specularIntensityMapUv),_.push(E.transmissionMapUv),_.push(E.thicknessMapUv),_.push(E.combine),_.push(E.fogExp2),_.push(E.sizeAttenuation),_.push(E.morphTargetsCount),_.push(E.morphAttributeCount),_.push(E.numSunLights),_.push(E.numDirLights),_.push(E.numPointLights),_.push(E.numSpotLights),_.push(E.numSpotLightMaps),_.push(E.numHemiLights),_.push(E.numRectAreaLights),_.push(E.numSunLightShadows),_.push(E.numDirLightShadows),_.push(E.numPointLightShadows),_.push(E.numSpotLightShadows),_.push(E.numSpotLightShadowsWithMaps),_.push(E.numLightProbes),_.push(E.shadowMapType),_.push(E.toneMapping),_.push(E.numClippingPlanes),_.push(E.numClipIntersection),_.push(E.depthPacking)}function w(_,E){a.disableAll(),E.instancing&&a.enable(0),E.instancingColor&&a.enable(1),E.instancingMorph&&a.enable(2),E.matcap&&a.enable(3),E.envMap&&a.enable(4),E.normalMapObjectSpace&&a.enable(5),E.normalMapTangentSpace&&a.enable(6),E.clearcoat&&a.enable(7),E.iridescence&&a.enable(8),E.alphaTest&&a.enable(9),E.vertexColors&&a.enable(10),E.vertexAlphas&&a.enable(11),E.vertexUv1s&&a.enable(12),E.vertexUv2s&&a.enable(13),E.vertexUv3s&&a.enable(14),E.vertexTangents&&a.enable(15),E.anisotropy&&a.enable(16),E.alphaHash&&a.enable(17),E.batching&&a.enable(18),E.dispersion&&a.enable(19),E.retroreflection&&a.enable(24),E.batchingColor&&a.enable(20),E.gradientMap&&a.enable(21),E.packedNormalMap&&a.enable(22),E.vertexNormals&&a.enable(23),_.push(a.mask),a.disableAll(),E.fog&&a.enable(0),E.useFog&&a.enable(1),E.flatShading&&a.enable(2),E.logarithmicDepthBuffer&&a.enable(3),E.reversedDepthBuffer&&a.enable(4),E.skinning&&a.enable(5),E.morphTargets&&a.enable(6),E.morphNormals&&a.enable(7),E.morphColors&&a.enable(8),E.premultipliedAlpha&&a.enable(9),E.shadowMapEnabled&&a.enable(10),E.doubleSided&&a.enable(11),E.flipSided&&a.enable(12),E.useDepthPacking&&a.enable(13),E.dithering&&a.enable(14),E.transmission&&a.enable(15),E.sheen&&a.enable(16),E.opaque&&a.enable(17),E.pointsUvs&&a.enable(18),E.decodeVideoTexture&&a.enable(19),E.decodeVideoTextureEmissive&&a.enable(20),E.alphaToCoverage&&a.enable(21),E.numLightProbeGrids>0&&a.enable(22),E.hasPositionAttribute&&a.enable(23),_.push(a.mask)}function T(_){let E=f[_.type],I;if(E){let N=ei[E];I=id.clone(N.uniforms)}else I=_.uniforms;return I}function y(_,E){let I=h.get(E);return I!==void 0?++I.usedTimes:(I=new $x(i,E,_,r),c.push(I),h.set(E,I)),I}function b(_){if(--_.usedTimes===0){let E=c.indexOf(_);c[E]=c[c.length-1],c.pop(),h.delete(_.cacheKey),_.destroy()}}function S(_){o.remove(_)}function C(){o.dispose()}return{getParameters:v,getProgramCacheKey:m,getUniforms:T,acquireProgram:y,releaseProgram:b,releaseShaderCache:S,programs:c,dispose:C}}function jx(){let i=new WeakMap;function e(a){return i.has(a)}function t(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function r(a,o,l){i.get(a)[o]=l}function s(){i=new WeakMap}return{has:e,get:t,remove:n,update:r,dispose:s}}function Qx(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.materialVariant!==e.materialVariant?i.materialVariant-e.materialVariant:i.z!==e.z?i.z-e.z:i.id-e.id}function Sd(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function Ed(){let i=[],e=0,t=[],n=[],r=[];function s(){e=0,t.length=0,n.length=0,r.length=0}function a(d){let f=0;return d.isInstancedMesh&&(f+=2),d.isSkinnedMesh&&(f+=1),f}function o(d,f,g,v,m,p){let w=i[e];return w===void 0?(w={id:d.id,object:d,geometry:f,material:g,materialVariant:a(d),groupOrder:v,renderOrder:d.renderOrder,z:m,group:p},i[e]=w):(w.id=d.id,w.object=d,w.geometry=f,w.material=g,w.materialVariant=a(d),w.groupOrder=v,w.renderOrder=d.renderOrder,w.z=m,w.group=p),e++,w}function l(d,f,g,v,m,p,w){w.reversedDepth===!0&&(m=-m);let T=o(d,f,g,v,m,p);g.transmission>0?n.push(T):g.transparent===!0?r.push(T):t.push(T)}function c(d,f,g,v,m,p){let w=o(d,f,g,v,m,p);g.transmission>0?n.unshift(w):g.transparent===!0?r.unshift(w):t.unshift(w)}function h(d,f){t.length>1&&t.sort(d||Qx),n.length>1&&n.sort(f||Sd),r.length>1&&r.sort(f||Sd)}function u(){for(let d=e,f=i.length;d<f;d++){let g=i[d];if(g.id===null)break;g.id=null,g.object=null,g.geometry=null,g.material=null,g.group=null}}return{opaque:t,transmissive:n,transparent:r,init:s,push:l,unshift:c,finish:u,sort:h}}function e_(){let i=new WeakMap;function e(n,r){let s=i.get(n),a;return s===void 0?(a=new Ed,i.set(n,[a])):r>=s.length?(a=new Ed,s.push(a)):a=s[r],a}function t(){i=new WeakMap}return{get:e,dispose:t}}function t_(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"SunLight":case"DirectionalLight":t={direction:new D,color:new We};break;case"SpotLight":t={position:new D,direction:new D,color:new We,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new D,color:new We,distance:0,decay:0};break;case"HemisphereLight":t={direction:new D,skyColor:new We,groundColor:new We};break;case"RectAreaLight":t={color:new We,position:new D,halfWidth:new D,halfHeight:new D};break}return i[e.id]=t,t}}}function n_(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"SunLight":case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new De};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new De};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new De,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var i_=0;function r_(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function s_(i){let e=new t_,t=n_(),n={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new D);let r=new D,s=new je,a=new je;function o(c){let h=0,u=0,d=0;for(let P=0;P<9;P++)n.probe[P].set(0,0,0);let f=0,g=0,v=0,m=0,p=0,w=0,T=0,y=0,b=0,S=0,C=0,_=0,E=0,I=0;c.sort(r_);for(let P=0,F=c.length;P<F;P++){let U=c[P],H=U.color,q=U.intensity,Y=U.distance,ce=null;if(U.shadow&&U.shadow.map&&(U.shadow.map.texture.format===Ui?ce=U.shadow.map.texture:ce=U.shadow.map.depthTexture||U.shadow.map.texture),U.isAmbientLight)h+=H.r*q,u+=H.g*q,d+=H.b*q;else if(U.isLightProbe){for(let G=0;G<9;G++)n.probe[G].addScaledVector(U.sh.coefficients[G],q);I++}else if(U.isSunLight){let G=e.get(U);if(G.color.copy(U.color).multiplyScalar(U.intensity),U.castShadow){let J=U.shadow,W=t.get(U);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize.copy(J.mapSize).multiply(J.getFrameExtents()),n.sunShadow[g]=W,n.sunShadowMap[g]=ce;let ue=J.getViewportCount();for(let pe=0;pe<ue;pe++)n.sunShadowMatrix[v+pe]=J.getMatrix(pe),n.sunShadowCascade[v+pe]=J._cascadeData[pe];v+=ue,g++}n.sun[f]=G,f++}else if(U.isDirectionalLight){let G=e.get(U);if(G.color.copy(U.color).multiplyScalar(U.intensity),U.castShadow){let J=U.shadow,W=t.get(U);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,n.directionalShadow[m]=W,n.directionalShadowMap[m]=ce,n.directionalShadowMatrix[m]=U.shadow.matrix,b++}n.directional[m]=G,m++}else if(U.isSpotLight){let G=e.get(U);G.position.setFromMatrixPosition(U.matrixWorld),G.color.copy(H).multiplyScalar(q),G.distance=Y,G.coneCos=Math.cos(U.angle),G.penumbraCos=Math.cos(U.angle*(1-U.penumbra)),G.decay=U.decay,n.spot[w]=G;let J=U.shadow;if(U.map&&(n.spotLightMap[_]=U.map,_++,J.updateMatrices(U),U.castShadow&&E++),n.spotLightMatrix[w]=J.matrix,U.castShadow){let W=t.get(U);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,n.spotShadow[w]=W,n.spotShadowMap[w]=ce,C++}w++}else if(U.isRectAreaLight){let G=e.get(U);G.color.copy(H).multiplyScalar(q),G.halfWidth.set(U.width*.5,0,0),G.halfHeight.set(0,U.height*.5,0),n.rectArea[T]=G,T++}else if(U.isPointLight){let G=e.get(U);if(G.color.copy(U.color).multiplyScalar(U.intensity),G.distance=U.distance,G.decay=U.decay,U.castShadow){let J=U.shadow,W=t.get(U);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,W.shadowCameraNear=J.camera.near,W.shadowCameraFar=J.camera.far,n.pointShadow[p]=W,n.pointShadowMap[p]=ce,n.pointShadowMatrix[p]=U.shadow.matrix,S++}n.point[p]=G,p++}else if(U.isHemisphereLight){let G=e.get(U);G.skyColor.copy(U.color).multiplyScalar(q),G.groundColor.copy(U.groundColor).multiplyScalar(q),n.hemi[y]=G,y++}}T>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=Ee.LTC_FLOAT_1,n.rectAreaLTC2=Ee.LTC_FLOAT_2):(n.rectAreaLTC1=Ee.LTC_HALF_1,n.rectAreaLTC2=Ee.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;let N=n.hash;(N.sunLength!==f||N.directionalLength!==m||N.pointLength!==p||N.spotLength!==w||N.rectAreaLength!==T||N.hemiLength!==y||N.numSunShadows!==g||N.numDirectionalShadows!==b||N.numPointShadows!==S||N.numSpotShadows!==C||N.numSpotMaps!==_||N.numLightProbes!==I)&&(n.sun.length=f,n.directional.length=m,n.spot.length=w,n.rectArea.length=T,n.point.length=p,n.hemi.length=y,n.sunShadow.length=g,n.sunShadowMap.length=g,n.sunShadowMatrix.length=v,n.sunShadowCascade.length=v,n.directionalShadow.length=b,n.directionalShadowMap.length=b,n.directionalShadowMatrix.length=b,n.pointShadow.length=S,n.pointShadowMap.length=S,n.pointShadowMatrix.length=S,n.spotShadow.length=C,n.spotShadowMap.length=C,n.spotLightMatrix.length=C+_-E,n.spotLightMap.length=_,n.numSpotLightShadowsWithMaps=E,n.numLightProbes=I,N.sunLength=f,N.directionalLength=m,N.pointLength=p,N.spotLength=w,N.rectAreaLength=T,N.hemiLength=y,N.numSunShadows=g,N.numDirectionalShadows=b,N.numPointShadows=S,N.numSpotShadows=C,N.numSpotMaps=_,N.numLightProbes=I,n.version=i_++)}function l(c,h){let u=0,d=0,f=0,g=0,v=0,m=0,p=h.matrixWorldInverse;for(let w=0,T=c.length;w<T;w++){let y=c[w];if(y.isSunLight){let b=n.sun[u];b.direction.setFromMatrixPosition(y.matrixWorld),b.direction.transformDirection(p),u++}else if(y.isDirectionalLight){let b=n.directional[d];b.direction.setFromMatrixPosition(y.matrixWorld),r.setFromMatrixPosition(y.target.matrixWorld),b.direction.sub(r),b.direction.transformDirection(p),d++}else if(y.isSpotLight){let b=n.spot[g];b.position.setFromMatrixPosition(y.matrixWorld),b.position.applyMatrix4(p),b.direction.setFromMatrixPosition(y.matrixWorld),r.setFromMatrixPosition(y.target.matrixWorld),b.direction.sub(r),b.direction.transformDirection(p),g++}else if(y.isRectAreaLight){let b=n.rectArea[v];b.position.setFromMatrixPosition(y.matrixWorld),b.position.applyMatrix4(p),a.identity(),s.copy(y.matrixWorld),s.premultiply(p),a.extractRotation(s),b.halfWidth.set(y.width*.5,0,0),b.halfHeight.set(0,y.height*.5,0),b.halfWidth.applyMatrix4(a),b.halfHeight.applyMatrix4(a),v++}else if(y.isPointLight){let b=n.point[f];b.position.setFromMatrixPosition(y.matrixWorld),b.position.applyMatrix4(p),f++}else if(y.isHemisphereLight){let b=n.hemi[m];b.direction.setFromMatrixPosition(y.matrixWorld),b.direction.transformDirection(p),m++}}}return{setup:o,setupView:l,state:n}}function wd(i){let e=new s_(i),t=[],n=[],r=[];function s(d){u.camera=d,t.length=0,n.length=0,r.length=0}function a(d){t.push(d)}function o(d){n.push(d)}function l(d){r.push(d)}function c(){e.setup(t)}function h(d){e.setupView(t,d)}let u={lightsArray:t,shadowsArray:n,lightProbeGridArray:r,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:u,setupLights:c,setupLightsView:h,pushLight:a,pushShadow:o,pushLightProbeGrid:l}}function a_(i){let e=new WeakMap;function t(r,s=0){let a=e.get(r),o;return a===void 0?(o=new wd(i),e.set(r,[o])):s>=a.length?(o=new wd(i),a.push(o)):o=a[s],o}function n(){e=new WeakMap}return{get:t,dispose:n}}var o_=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,l_=`uniform sampler2D shadow_pass;
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
}`,c_=[new D(1,0,0),new D(-1,0,0),new D(0,1,0),new D(0,-1,0),new D(0,0,1),new D(0,0,-1)],h_=[new D(0,-1,0),new D(0,-1,0),new D(0,0,1),new D(0,0,-1),new D(0,-1,0),new D(0,-1,0)],Td=new je,Ys=new D,th=new D;function u_(i,e,t){let n=new Lr,r=new De,s=new De,a=new St,o=new wi,l=new to,c={},h=t.maxTextureSize,u={[Jn]:Nt,[Nt]:Jn,[Ft]:Ft},d=new Rt({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new De},radius:{value:4}},vertexShader:o_,fragmentShader:l_}),f=d.clone();f.defines.HORIZONTAL_PASS=1;let g=new Tt;g.setAttribute("position",new Dt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let v=new Oe(g,d),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Is;let p=this.type;this.render=function(S,C,_){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||S.length===0)return;this.type===mo&&(He("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=Is);let E=i.getRenderTarget(),I=i.getActiveCubeFace(),N=i.getActiveMipmapLevel(),P=i.state;P.setBlending(Kn),P.buffers.depth.getReversed()===!0?P.buffers.color.setClear(0,0,0,0):P.buffers.color.setClear(1,1,1,1),P.buffers.depth.setTest(!0),P.setScissorTest(!1);let F=p!==this.type;F&&C.traverse(function(U){U.material&&(Array.isArray(U.material)?U.material.forEach(H=>H.needsUpdate=!0):U.material.needsUpdate=!0)});for(let U=0,H=S.length;U<H;U++){let q=S[U],Y=q.shadow;if(Y===void 0){He("WebGLShadowMap:",q,"has no shadow.");continue}if(Y.autoUpdate===!1&&Y.needsUpdate===!1)continue;r.copy(Y.mapSize);let ce=Y.getFrameExtents();r.multiply(ce),s.copy(Y.mapSize),(r.x>h||r.y>h)&&(r.x>h&&(s.x=Math.floor(h/ce.x),r.x=s.x*ce.x,Y.mapSize.x=s.x),r.y>h&&(s.y=Math.floor(h/ce.y),r.y=s.y*ce.y,Y.mapSize.y=s.y));let G=i.state.buffers.depth.getReversed();if(Y.camera._reversedDepth=G,Y.map===null||F===!0){if(Y.map!==null&&(Y.map.depthTexture!==null&&(Y.map.depthTexture.dispose(),Y.map.depthTexture=null),Y.map.dispose()),this.type===Nr){if(q.isPointLight){He("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}Y.map=new qt(r.x,r.y,{format:Ui,type:Vn,minFilter:Xt,magFilter:Xt,generateMipmaps:!1}),Y.map.texture.name=q.name+".shadowMap",Y.map.depthTexture=new Ei(r.x,r.y,fn),Y.map.depthTexture.name=q.name+".shadowMapDepth",Y.map.depthTexture.format=Yn,Y.map.depthTexture.compareFunction=null,Y.map.depthTexture.minFilter=ut,Y.map.depthTexture.magFilter=ut}else q.isPointLight?(Y.map=new ol(r.x),Y.map.depthTexture=new Xa(r.x,zn)):(Y.map=new qt(r.x,r.y),Y.map.depthTexture=new Ei(r.x,r.y,zn)),Y.map.depthTexture.name=q.name+".shadowMap",Y.map.depthTexture.format=Yn,this.type===Is?(Y.map.depthTexture.compareFunction=G?rl:il,Y.map.depthTexture.minFilter=Xt,Y.map.depthTexture.magFilter=Xt):(Y.map.depthTexture.compareFunction=null,Y.map.depthTexture.minFilter=ut,Y.map.depthTexture.magFilter=ut);Y.camera.updateProjectionMatrix()}Y.map.isWebGLCubeRenderTarget!==!0&&(Y.map.width!==r.x||Y.map.height!==r.y)&&Y.map.setSize(r.x,r.y);let J=Y.map.isWebGLCubeRenderTarget?6:Y.getViewportCount();q.isPointLight!==!0&&Y.updateMatrices(q,_);for(let W=0;W<J;W++){let ue=Y.getCamera(W);if(q.isPointLight){let pe=Y.camera,Me=Y.matrix,Se=q.distance||pe.far;Se!==pe.far&&(pe.far=Se,pe.updateProjectionMatrix()),Ys.setFromMatrixPosition(q.matrixWorld),pe.position.copy(Ys),th.copy(pe.position),th.add(c_[W]),pe.up.copy(h_[W]),pe.lookAt(th),pe.updateMatrixWorld(),Me.makeTranslation(-Ys.x,-Ys.y,-Ys.z),Td.multiplyMatrices(pe.projectionMatrix,pe.matrixWorldInverse),Y._frustum.setFromProjectionMatrix(Td,pe.coordinateSystem,pe.reversedDepth)}if(Y.map.isWebGLCubeRenderTarget)i.setRenderTarget(Y.map,W),i.clear();else{W===0&&(i.setRenderTarget(Y.map),i.clear());let pe=Y.getViewport(W);a.set(s.x*pe.x,s.y*pe.y,s.x*pe.z,s.y*pe.w),P.viewport(a)}n=Y.getFrustum(W),y(C,_,ue,q,this.type)}Y.isPointLightShadow!==!0&&this.type===Nr&&w(Y,_),Y.needsUpdate=!1}p=this.type,m.needsUpdate=!1,i.setRenderTarget(E,I,N)};function w(S,C){let _=e.update(v);d.defines.VSM_SAMPLES!==S.blurSamples&&(d.defines.VSM_SAMPLES=S.blurSamples,f.defines.VSM_SAMPLES=S.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),S.mapPass===null?S.mapPass=new qt(r.x,r.y,{format:Ui,type:Vn}):(S.mapPass.width!==S.map.width||S.mapPass.height!==S.map.height)&&S.mapPass.setSize(S.map.width,S.map.height),d.uniforms.shadow_pass.value=S.map.depthTexture,d.uniforms.resolution.value.set(S.map.width,S.map.height),d.uniforms.radius.value=S.radius,i.setRenderTarget(S.mapPass),i.clear(),i.renderBufferDirect(C,null,_,d,v,null),f.uniforms.shadow_pass.value=S.mapPass.texture,f.uniforms.resolution.value.set(S.map.width,S.map.height),f.uniforms.radius.value=S.radius,i.setRenderTarget(S.map),i.clear(),i.renderBufferDirect(C,null,_,f,v,null)}function T(S,C,_,E){let I=null,N=_.isPointLight===!0?S.customDistanceMaterial:S.customDepthMaterial;if(N!==void 0)I=N;else if(I=_.isPointLight===!0?l:o,i.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let P=I.uuid,F=C.uuid,U=c[P];U===void 0&&(U={},c[P]=U);let H=U[F];H===void 0&&(H=I.clone(),U[F]=H,C.addEventListener("dispose",b)),I=H}if(I.visible=C.visible,I.wireframe=C.wireframe,E===Nr?I.side=C.shadowSide!==null?C.shadowSide:C.side:I.side=C.shadowSide!==null?C.shadowSide:u[C.side],I.alphaMap=C.alphaMap,I.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,I.map=C.map,I.clipShadows=C.clipShadows,I.clippingPlanes=C.clippingPlanes,I.clipIntersection=C.clipIntersection,I.displacementMap=C.displacementMap,I.displacementScale=C.displacementScale,I.displacementBias=C.displacementBias,I.wireframeLinewidth=C.wireframeLinewidth,I.linewidth=C.linewidth,_.isPointLight===!0&&I.isMeshDistanceMaterial===!0){let P=i.properties.get(I);P.light=_}return I}function y(S,C,_,E,I){if(S.visible===!1)return;if(S.layers.test(C.layers)&&(S.isMesh||S.isLine||S.isPoints)&&(S.castShadow||S.receiveShadow&&I===Nr)&&(!S.frustumCulled||S.intersectsFrustum(n))){S.modelViewMatrix.multiplyMatrices(_.matrixWorldInverse,S.matrixWorld);let F=e.update(S),U=S.material;if(Array.isArray(U)){let H=F.groups;for(let q=0,Y=H.length;q<Y;q++){let ce=H[q],G=U[ce.materialIndex];if(G&&G.visible){let J=T(S,G,E,I);S.onBeforeShadow(i,S,C,_,F,J,ce),i.renderBufferDirect(_,null,F,J,S,ce),S.onAfterShadow(i,S,C,_,F,J,ce)}}}else if(U.visible){let H=T(S,U,E,I);S.onBeforeShadow(i,S,C,_,F,H,null),i.renderBufferDirect(_,null,F,H,S,null),S.onAfterShadow(i,S,C,_,F,H,null)}}let P=S.children;for(let F=0,U=P.length;F<U;F++)y(P[F],C,_,E,I)}function b(S){S.target.removeEventListener("dispose",b);for(let _ in c){let E=c[_],I=S.target.uuid;I in E&&(E[I].dispose(),delete E[I])}}}function d_(i,e){function t(){let L=!1,fe=new St,te=null,ve=new St(0,0,0,0);return{setMask:function(be){te!==be&&!L&&(i.colorMask(be,be,be,be),te=be)},setLocked:function(be){L=be},setClear:function(be,me,Ne,Ie,it){it===!0&&(be*=Ie,me*=Ie,Ne*=Ie),fe.set(be,me,Ne,Ie),ve.equals(fe)===!1&&(i.clearColor(be,me,Ne,Ie),ve.copy(fe))},reset:function(){L=!1,te=null,ve.set(-1,0,0,0)}}}function n(){let L=!1,fe=!1,te=null,ve=null,be=null;return{setReversed:function(me){if(fe!==me){let Ne=e.get("EXT_clip_control");me?Ne.clipControlEXT(Ne.LOWER_LEFT_EXT,Ne.ZERO_TO_ONE_EXT):Ne.clipControlEXT(Ne.LOWER_LEFT_EXT,Ne.NEGATIVE_ONE_TO_ONE_EXT),fe=me;let Ie=be;be=null,this.setClear(Ie)}},getReversed:function(){return fe},setTest:function(me){me?ne(i.DEPTH_TEST):ye(i.DEPTH_TEST)},setMask:function(me){te!==me&&!L&&(i.depthMask(me),te=me)},setFunc:function(me){if(fe&&(me=td[me]),ve!==me){switch(me){case La:i.depthFunc(i.NEVER);break;case Ua:i.depthFunc(i.ALWAYS);break;case Da:i.depthFunc(i.LESS);break;case Tr:i.depthFunc(i.LEQUAL);break;case Na:i.depthFunc(i.EQUAL);break;case Fa:i.depthFunc(i.GEQUAL);break;case Oa:i.depthFunc(i.GREATER);break;case Ba:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}ve=me}},setLocked:function(me){L=me},setClear:function(me){be!==me&&(be=me,fe&&(me=1-me),i.clearDepth(me))},reset:function(){L=!1,te=null,ve=null,be=null,fe=!1}}}function r(){let L=!1,fe=null,te=null,ve=null,be=null,me=null,Ne=null,Ie=null,it=null;return{setTest:function(at){L||(at?ne(i.STENCIL_TEST):ye(i.STENCIL_TEST))},setMask:function(at){fe!==at&&!L&&(i.stencilMask(at),fe=at)},setFunc:function(at,Dn,Wn){(te!==at||ve!==Dn||be!==Wn)&&(i.stencilFunc(at,Dn,Wn),te=at,ve=Dn,be=Wn)},setOp:function(at,Dn,Wn){(me!==at||Ne!==Dn||Ie!==Wn)&&(i.stencilOp(at,Dn,Wn),me=at,Ne=Dn,Ie=Wn)},setLocked:function(at){L=at},setClear:function(at){it!==at&&(i.clearStencil(at),it=at)},reset:function(){L=!1,fe=null,te=null,ve=null,be=null,me=null,Ne=null,Ie=null,it=null}}}let s=new t,a=new n,o=new r,l=new WeakMap,c=new WeakMap,h={},u={},d={},f=new WeakMap,g=[],v=null,m=!1,p=null,w=null,T=null,y=null,b=null,S=null,C=null,_=new We(0,0,0),E=0,I=!1,N=null,P=null,F=null,U=null,H=null,q=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),Y=!1,ce=0,G=i.getParameter(i.VERSION);G.indexOf("WebGL")!==-1?(ce=parseFloat(/^WebGL (\d)/.exec(G)[1]),Y=ce>=1):G.indexOf("OpenGL ES")!==-1&&(ce=parseFloat(/^OpenGL ES (\d)/.exec(G)[1]),Y=ce>=2);let J=null,W={},ue=i.getParameter(i.SCISSOR_BOX),pe=i.getParameter(i.VIEWPORT),Me=new St().fromArray(ue),Se=new St().fromArray(pe);function de(L,fe,te,ve){let be=new Uint8Array(4),me=i.createTexture();i.bindTexture(L,me),i.texParameteri(L,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(L,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ne=0;Ne<te;Ne++)L===i.TEXTURE_3D||L===i.TEXTURE_2D_ARRAY?i.texImage3D(fe,0,i.RGBA,1,1,ve,0,i.RGBA,i.UNSIGNED_BYTE,be):i.texImage2D(fe+Ne,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,be);return me}let X={};X[i.TEXTURE_2D]=de(i.TEXTURE_2D,i.TEXTURE_2D,1),X[i.TEXTURE_CUBE_MAP]=de(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),X[i.TEXTURE_2D_ARRAY]=de(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),X[i.TEXTURE_3D]=de(i.TEXTURE_3D,i.TEXTURE_3D,1,1),s.setClear(0,0,0,1),a.setClear(1),o.setClear(0),ne(i.DEPTH_TEST),a.setFunc(Tr),ke(!1),Qe(Sc),ne(i.CULL_FACE),ze(Kn);function ne(L){h[L]!==!0&&(i.enable(L),h[L]=!0)}function ye(L){h[L]!==!1&&(i.disable(L),h[L]=!1)}function Pe(L,fe){return d[L]!==fe?(i.bindFramebuffer(L,fe),d[L]=fe,L===i.DRAW_FRAMEBUFFER&&(d[i.FRAMEBUFFER]=fe),L===i.FRAMEBUFFER&&(d[i.DRAW_FRAMEBUFFER]=fe),!0):!1}function _e(L,fe){let te=g,ve=!1;if(L){te=f.get(fe),te===void 0&&(te=[],f.set(fe,te));let be=L.textures;if(te.length!==be.length||te[0]!==i.COLOR_ATTACHMENT0){for(let me=0,Ne=be.length;me<Ne;me++)te[me]=i.COLOR_ATTACHMENT0+me;te.length=be.length,ve=!0}}else te[0]!==i.BACK&&(te[0]=i.BACK,ve=!0);ve&&i.drawBuffers(te)}function Ce(L){return v!==L?(i.useProgram(L),v=L,!0):!1}let qe={[Ki]:i.FUNC_ADD,[Eu]:i.FUNC_SUBTRACT,[wu]:i.FUNC_REVERSE_SUBTRACT};qe[Tu]=i.MIN,qe[Au]=i.MAX;let Be={[Ru]:i.ZERO,[ji]:i.ONE,[Cu]:i.SRC_COLOR,[Ac]:i.SRC_ALPHA,[Nu]:i.SRC_ALPHA_SATURATE,[Uu]:i.DST_COLOR,[Iu]:i.DST_ALPHA,[Pu]:i.ONE_MINUS_SRC_COLOR,[Fr]:i.ONE_MINUS_SRC_ALPHA,[Du]:i.ONE_MINUS_DST_COLOR,[Lu]:i.ONE_MINUS_DST_ALPHA,[Fu]:i.CONSTANT_COLOR,[Ou]:i.ONE_MINUS_CONSTANT_COLOR,[Bu]:i.CONSTANT_ALPHA,[ku]:i.ONE_MINUS_CONSTANT_ALPHA};function ze(L,fe,te,ve,be,me,Ne,Ie,it,at){if(L===Kn){m===!0&&(ye(i.BLEND),m=!1);return}if(m===!1&&(ne(i.BLEND),m=!0),L!==Ls){if(L!==p||at!==I){if((w!==Ki||b!==Ki)&&(i.blendEquation(i.FUNC_ADD),w=Ki,b=Ki),at)switch(L){case Pi:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Ec:i.blendFunc(i.ONE,i.ONE);break;case wc:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Tc:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:Ve("WebGLState: Invalid blending: ",L);break}else switch(L){case Pi:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Ec:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case wc:Ve("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Tc:Ve("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Ve("WebGLState: Invalid blending: ",L);break}T=null,y=null,S=null,C=null,_.set(0,0,0),E=0,p=L,I=at}return}be=be||fe,me=me||te,Ne=Ne||ve,(fe!==w||be!==b)&&(i.blendEquationSeparate(qe[fe],qe[be]),w=fe,b=be),(te!==T||ve!==y||me!==S||Ne!==C)&&(i.blendFuncSeparate(Be[te],Be[ve],Be[me],Be[Ne]),T=te,y=ve,S=me,C=Ne),(Ie.equals(_)===!1||it!==E)&&(i.blendColor(Ie.r,Ie.g,Ie.b,it),_.copy(Ie),E=it),p=L,I=!1}function Xe(L,fe){L.side===Ft?ye(i.CULL_FACE):ne(i.CULL_FACE);let te=L.side===Nt;fe&&(te=!te),ke(te),L.blending===Pi&&L.transparent===!1?ze(Kn):ze(L.blending,L.blendEquation,L.blendSrc,L.blendDst,L.blendEquationAlpha,L.blendSrcAlpha,L.blendDstAlpha,L.blendColor,L.blendAlpha,L.premultipliedAlpha),a.setFunc(L.depthFunc),a.setTest(L.depthTest),a.setMask(L.depthWrite),s.setMask(L.colorWrite);let ve=L.stencilWrite;o.setTest(ve),ve&&(o.setMask(L.stencilWriteMask),o.setFunc(L.stencilFunc,L.stencilRef,L.stencilFuncMask),o.setOp(L.stencilFail,L.stencilZFail,L.stencilZPass)),Et(L.polygonOffset,L.polygonOffsetFactor,L.polygonOffsetUnits),L.alphaToCoverage===!0?ne(i.SAMPLE_ALPHA_TO_COVERAGE):ye(i.SAMPLE_ALPHA_TO_COVERAGE)}function ke(L){N!==L&&(L?i.frontFace(i.CW):i.frontFace(i.CCW),N=L)}function Qe(L){L!==Mu?(ne(i.CULL_FACE),L!==P&&(L===Sc?i.cullFace(i.BACK):L===Su?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):ye(i.CULL_FACE),P=L}function gt(L){L!==F&&(Y&&i.lineWidth(L),F=L)}function Et(L,fe,te){L?(ne(i.POLYGON_OFFSET_FILL),(U!==fe||H!==te)&&(U=fe,H=te,a.getReversed()&&(fe=-fe),i.polygonOffset(fe,te))):ye(i.POLYGON_OFFSET_FILL)}function pt(L){L?ne(i.SCISSOR_TEST):ye(i.SCISSOR_TEST)}function ht(L){L===void 0&&(L=i.TEXTURE0+q-1),J!==L&&(i.activeTexture(L),J=L)}function O(L,fe,te){te===void 0&&(J===null?te=i.TEXTURE0+q-1:te=J);let ve=W[te];ve===void 0&&(ve={type:void 0,texture:void 0},W[te]=ve),(ve.type!==L||ve.texture!==fe)&&(J!==te&&(i.activeTexture(te),J=te),i.bindTexture(L,fe||X[L]),ve.type=L,ve.texture=fe)}function oe(){let L=W[J];L!==void 0&&L.type!==void 0&&(i.bindTexture(L.type,null),L.type=void 0,L.texture=void 0)}function xe(){try{i.compressedTexImage2D(...arguments)}catch(L){Ve("WebGLState:",L)}}function R(){try{i.compressedTexImage3D(...arguments)}catch(L){Ve("WebGLState:",L)}}function x(){try{i.texSubImage2D(...arguments)}catch(L){Ve("WebGLState:",L)}}function z(){try{i.texSubImage3D(...arguments)}catch(L){Ve("WebGLState:",L)}}function K(){try{i.compressedTexSubImage2D(...arguments)}catch(L){Ve("WebGLState:",L)}}function se(){try{i.compressedTexSubImage3D(...arguments)}catch(L){Ve("WebGLState:",L)}}function A(){try{i.texStorage2D(...arguments)}catch(L){Ve("WebGLState:",L)}}function k(){try{i.texStorage3D(...arguments)}catch(L){Ve("WebGLState:",L)}}function V(){try{i.texImage2D(...arguments)}catch(L){Ve("WebGLState:",L)}}function $(){try{i.texImage3D(...arguments)}catch(L){Ve("WebGLState:",L)}}function ae(L){return u[L]!==void 0?u[L]:i.getParameter(L)}function le(L,fe){u[L]!==fe&&(i.pixelStorei(L,fe),u[L]=fe)}function ie(L){Me.equals(L)===!1&&(i.scissor(L.x,L.y,L.z,L.w),Me.copy(L))}function ee(L){Se.equals(L)===!1&&(i.viewport(L.x,L.y,L.z,L.w),Se.copy(L))}function Z(L,fe){let te=c.get(fe);te===void 0&&(te=new WeakMap,c.set(fe,te));let ve=te.get(L);ve===void 0&&(ve=i.getUniformBlockIndex(fe,L.name),te.set(L,ve))}function he(L,fe){let ve=c.get(fe).get(L);l.get(fe)!==ve&&(i.uniformBlockBinding(fe,ve,L.__bindingPointIndex),l.set(fe,ve))}function ge(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),a.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),i.pixelStorei(i.PACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,!1),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,i.BROWSER_DEFAULT_WEBGL),i.pixelStorei(i.PACK_ROW_LENGTH,0),i.pixelStorei(i.PACK_SKIP_PIXELS,0),i.pixelStorei(i.PACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_ROW_LENGTH,0),i.pixelStorei(i.UNPACK_IMAGE_HEIGHT,0),i.pixelStorei(i.UNPACK_SKIP_PIXELS,0),i.pixelStorei(i.UNPACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_SKIP_IMAGES,0),h={},u={},J=null,W={},d={},f=new WeakMap,g=[],v=null,m=!1,p=null,w=null,T=null,y=null,b=null,S=null,C=null,_=new We(0,0,0),E=0,I=!1,N=null,P=null,F=null,U=null,H=null,Me.set(0,0,i.canvas.width,i.canvas.height),Se.set(0,0,i.canvas.width,i.canvas.height),s.reset(),a.reset(),o.reset()}return{buffers:{color:s,depth:a,stencil:o},enable:ne,disable:ye,bindFramebuffer:Pe,drawBuffers:_e,useProgram:Ce,setBlending:ze,setMaterial:Xe,setFlipSided:ke,setCullFace:Qe,setLineWidth:gt,setPolygonOffset:Et,setScissorTest:pt,activeTexture:ht,bindTexture:O,unbindTexture:oe,compressedTexImage2D:xe,compressedTexImage3D:R,texImage2D:V,texImage3D:$,pixelStorei:le,getParameter:ae,updateUBOMapping:Z,uniformBlockBinding:he,texStorage2D:A,texStorage3D:k,texSubImage2D:x,texSubImage3D:z,compressedTexSubImage2D:K,compressedTexSubImage3D:se,scissor:ie,viewport:ee,reset:ge}}function f_(i,e,t,n,r,s,a){let o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new De,h=new WeakMap,u=new Set,d,f=new WeakMap,g=!1;try{g=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function v(R,x){return g?new OffscreenCanvas(R,x):hs("canvas")}function m(R,x,z){let K=1,se=xe(R);if((se.width>z||se.height>z)&&(K=z/Math.max(se.width,se.height)),K<1)if(typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&R instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&R instanceof ImageBitmap||typeof VideoFrame<"u"&&R instanceof VideoFrame){let A=Math.floor(K*se.width),k=Math.floor(K*se.height);d===void 0&&(d=v(A,k));let V=x?v(A,k):d;return V.width=A,V.height=k,V.getContext("2d").drawImage(R,0,0,A,k),He("WebGLRenderer: Texture has been resized from ("+se.width+"x"+se.height+") to ("+A+"x"+k+")."),V}else return"data"in R&&He("WebGLRenderer: Image in DataTexture is too big ("+se.width+"x"+se.height+")."),R;return R}function p(R){return R.generateMipmaps}function w(R){i.generateMipmap(R)}function T(R){return R.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:R.isWebGL3DRenderTarget?i.TEXTURE_3D:R.isWebGLArrayRenderTarget||R.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function y(R,x,z,K,se,A=!1){if(R!==null){if(i[R]!==void 0)return i[R];He("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+R+"'")}let k;K&&(k=e.get("EXT_texture_norm16"),k||He("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let V=x;if(x===i.RED&&(z===i.FLOAT&&(V=i.R32F),z===i.HALF_FLOAT&&(V=i.R16F),z===i.UNSIGNED_BYTE&&(V=i.R8),z===i.UNSIGNED_SHORT&&k&&(V=k.R16_EXT),z===i.SHORT&&k&&(V=k.R16_SNORM_EXT)),x===i.RED_INTEGER&&(z===i.UNSIGNED_BYTE&&(V=i.R8UI),z===i.UNSIGNED_SHORT&&(V=i.R16UI),z===i.UNSIGNED_INT&&(V=i.R32UI),z===i.BYTE&&(V=i.R8I),z===i.SHORT&&(V=i.R16I),z===i.INT&&(V=i.R32I)),x===i.RG&&(z===i.FLOAT&&(V=i.RG32F),z===i.HALF_FLOAT&&(V=i.RG16F),z===i.UNSIGNED_BYTE&&(V=i.RG8),z===i.UNSIGNED_SHORT&&k&&(V=k.RG16_EXT),z===i.SHORT&&k&&(V=k.RG16_SNORM_EXT)),x===i.RG_INTEGER&&(z===i.UNSIGNED_BYTE&&(V=i.RG8UI),z===i.UNSIGNED_SHORT&&(V=i.RG16UI),z===i.UNSIGNED_INT&&(V=i.RG32UI),z===i.BYTE&&(V=i.RG8I),z===i.SHORT&&(V=i.RG16I),z===i.INT&&(V=i.RG32I)),x===i.RGB_INTEGER&&(z===i.UNSIGNED_BYTE&&(V=i.RGB8UI),z===i.UNSIGNED_SHORT&&(V=i.RGB16UI),z===i.UNSIGNED_INT&&(V=i.RGB32UI),z===i.BYTE&&(V=i.RGB8I),z===i.SHORT&&(V=i.RGB16I),z===i.INT&&(V=i.RGB32I)),x===i.RGBA_INTEGER&&(z===i.UNSIGNED_BYTE&&(V=i.RGBA8UI),z===i.UNSIGNED_SHORT&&(V=i.RGBA16UI),z===i.UNSIGNED_INT&&(V=i.RGBA32UI),z===i.BYTE&&(V=i.RGBA8I),z===i.SHORT&&(V=i.RGBA16I),z===i.INT&&(V=i.RGBA32I)),x===i.RGB&&(z===i.UNSIGNED_SHORT&&k&&(V=k.RGB16_EXT),z===i.SHORT&&k&&(V=k.RGB16_SNORM_EXT),z===i.UNSIGNED_INT_5_9_9_9_REV&&(V=i.RGB9_E5),z===i.UNSIGNED_INT_10F_11F_11F_REV&&(V=i.R11F_G11F_B10F)),x===i.RGBA){let $=A?cs:Je.getTransfer(se);z===i.FLOAT&&(V=i.RGBA32F),z===i.HALF_FLOAT&&(V=i.RGBA16F),z===i.UNSIGNED_BYTE&&(V=$===lt?i.SRGB8_ALPHA8:i.RGBA8),z===i.UNSIGNED_SHORT&&k&&(V=k.RGBA16_EXT),z===i.SHORT&&k&&(V=k.RGBA16_SNORM_EXT),z===i.UNSIGNED_SHORT_4_4_4_4&&(V=i.RGBA4),z===i.UNSIGNED_SHORT_5_5_5_1&&(V=i.RGB5_A1)}return(V===i.R16F||V===i.R32F||V===i.RG16F||V===i.RG32F||V===i.RGBA16F||V===i.RGBA32F)&&e.get("EXT_color_buffer_float"),V}function b(R,x){let z;return R?x===null||x===zn||x===Br?z=i.DEPTH24_STENCIL8:x===fn?z=i.DEPTH32F_STENCIL8:x===Or&&(z=i.DEPTH24_STENCIL8,He("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):x===null||x===zn||x===Br?z=i.DEPTH_COMPONENT24:x===fn?z=i.DEPTH_COMPONENT32F:x===Or&&(z=i.DEPTH_COMPONENT16),z}function S(R,x){return p(R)===!0||R.isFramebufferTexture&&R.minFilter!==ut&&R.minFilter!==Xt?Math.log2(Math.max(x.width,x.height))+1:R.mipmaps!==void 0&&R.mipmaps.length>0?R.mipmaps.length:R.isCompressedTexture&&Array.isArray(R.image)?x.mipmaps.length:1}function C(R){let x=R.target;x.removeEventListener("dispose",C),E(x),x.isVideoTexture&&h.delete(x),x.isHTMLTexture&&u.delete(x)}function _(R){let x=R.target;x.removeEventListener("dispose",_),N(x)}function E(R){let x=n.get(R);if(x.__webglInit===void 0)return;let z=R.source,K=f.get(z);if(K){let se=K[x.__cacheKey];se.usedTimes--,se.usedTimes===0&&I(R),Object.keys(K).length===0&&f.delete(z)}n.remove(R)}function I(R){let x=n.get(R);i.deleteTexture(x.__webglTexture);let z=R.source,K=f.get(z);delete K[x.__cacheKey],a.memory.textures--}function N(R){let x=n.get(R);if(R.depthTexture&&(R.depthTexture.dispose(),n.remove(R.depthTexture)),R.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(x.__webglFramebuffer[K]))for(let se=0;se<x.__webglFramebuffer[K].length;se++)i.deleteFramebuffer(x.__webglFramebuffer[K][se]);else i.deleteFramebuffer(x.__webglFramebuffer[K]);x.__webglDepthbuffer&&i.deleteRenderbuffer(x.__webglDepthbuffer[K])}else{if(Array.isArray(x.__webglFramebuffer))for(let K=0;K<x.__webglFramebuffer.length;K++)i.deleteFramebuffer(x.__webglFramebuffer[K]);else i.deleteFramebuffer(x.__webglFramebuffer);if(x.__webglDepthbuffer&&i.deleteRenderbuffer(x.__webglDepthbuffer),x.__webglMultisampledFramebuffer&&i.deleteFramebuffer(x.__webglMultisampledFramebuffer),x.__webglColorRenderbuffer)for(let K=0;K<x.__webglColorRenderbuffer.length;K++)x.__webglColorRenderbuffer[K]&&i.deleteRenderbuffer(x.__webglColorRenderbuffer[K]);x.__webglDepthRenderbuffer&&i.deleteRenderbuffer(x.__webglDepthRenderbuffer)}let z=R.textures;for(let K=0,se=z.length;K<se;K++){let A=n.get(z[K]);A.__webglTexture&&(i.deleteTexture(A.__webglTexture),a.memory.textures--),n.remove(z[K])}n.remove(R)}let P=0;function F(){P=0}function U(){return P}function H(R){P=R}function q(){let R=P;return R>=r.maxTextures&&He("WebGLTextures: Trying to use "+(R+1)+" texture units while this GPU supports only "+r.maxTextures),P+=1,R}function Y(R){let x=[];return x.push(R.wrapS),x.push(R.wrapT),x.push(R.wrapR||0),x.push(R.magFilter),x.push(R.minFilter),x.push(R.anisotropy),x.push(R.internalFormat),x.push(R.format),x.push(R.type),x.push(R.generateMipmaps),x.push(R.premultiplyAlpha),x.push(R.flipY),x.push(R.unpackAlignment),x.push(R.colorSpace),x.join()}function ce(R,x){let z=n.get(R);if(R.isVideoTexture&&O(R),R.isRenderTargetTexture===!1&&R.isExternalTexture!==!0&&R.version>0&&z.__version!==R.version){let K=R.image;if(K===null)He("WebGLRenderer: Texture marked for update but no image data found.");else if(K.complete===!1)He("WebGLRenderer: Texture marked for update but image is incomplete");else{ye(z,R,x);return}}else R.isExternalTexture&&(z.__webglTexture=R.sourceTexture?R.sourceTexture:null);t.bindTexture(i.TEXTURE_2D,z.__webglTexture,i.TEXTURE0+x)}function G(R,x){let z=n.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&z.__version!==R.version){ye(z,R,x);return}else R.isExternalTexture&&(z.__webglTexture=R.sourceTexture?R.sourceTexture:null);t.bindTexture(i.TEXTURE_2D_ARRAY,z.__webglTexture,i.TEXTURE0+x)}function J(R,x){let z=n.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&z.__version!==R.version){ye(z,R,x);return}t.bindTexture(i.TEXTURE_3D,z.__webglTexture,i.TEXTURE0+x)}function W(R,x){let z=n.get(R);if(R.isCubeDepthTexture!==!0&&R.version>0&&z.__version!==R.version){Pe(z,R,x);return}t.bindTexture(i.TEXTURE_CUBE_MAP,z.__webglTexture,i.TEXTURE0+x)}let ue={[Ar]:i.REPEAT,[yn]:i.CLAMP_TO_EDGE,[ka]:i.MIRRORED_REPEAT},pe={[ut]:i.NEAREST,[Vu]:i.NEAREST_MIPMAP_NEAREST,[Ds]:i.NEAREST_MIPMAP_LINEAR,[Xt]:i.LINEAR,[yo]:i.LINEAR_MIPMAP_NEAREST,[jn]:i.LINEAR_MIPMAP_LINEAR},Me={[Xu]:i.NEVER,[Ju]:i.ALWAYS,[qu]:i.LESS,[il]:i.LEQUAL,[Yu]:i.EQUAL,[rl]:i.GEQUAL,[$u]:i.GREATER,[Zu]:i.NOTEQUAL};function Se(R,x){if(x.type===fn&&e.has("OES_texture_float_linear")===!1&&(x.magFilter===Xt||x.magFilter===yo||x.magFilter===Ds||x.magFilter===jn||x.minFilter===Xt||x.minFilter===yo||x.minFilter===Ds||x.minFilter===jn)&&He("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(R,i.TEXTURE_WRAP_S,ue[x.wrapS]),i.texParameteri(R,i.TEXTURE_WRAP_T,ue[x.wrapT]),(R===i.TEXTURE_3D||R===i.TEXTURE_2D_ARRAY)&&i.texParameteri(R,i.TEXTURE_WRAP_R,ue[x.wrapR]),i.texParameteri(R,i.TEXTURE_MAG_FILTER,pe[x.magFilter]),i.texParameteri(R,i.TEXTURE_MIN_FILTER,pe[x.minFilter]),x.compareFunction&&(i.texParameteri(R,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(R,i.TEXTURE_COMPARE_FUNC,Me[x.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(x.magFilter===ut||x.minFilter!==Ds&&x.minFilter!==jn||x.type===fn&&e.has("OES_texture_float_linear")===!1)return;if(x.anisotropy>1||n.get(x).__currentAnisotropy){let z=e.get("EXT_texture_filter_anisotropic");i.texParameterf(R,z.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(x.anisotropy,r.getMaxAnisotropy())),n.get(x).__currentAnisotropy=x.anisotropy}}}function de(R,x){let z=!1;R.__webglInit===void 0&&(R.__webglInit=!0,x.addEventListener("dispose",C));let K=x.source,se=f.get(K);se===void 0&&(se={},f.set(K,se));let A=Y(x);if(A!==R.__cacheKey){se[A]===void 0&&(se[A]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,z=!0),se[A].usedTimes++;let k=se[R.__cacheKey];k!==void 0&&(se[R.__cacheKey].usedTimes--,k.usedTimes===0&&I(x)),R.__cacheKey=A,R.__webglTexture=se[A].texture}return z}function X(R,x,z){return Math.floor(Math.floor(R/z)/x)}function ne(R,x,z,K){let A=R.updateRanges;if(A.length===0)t.texSubImage2D(i.TEXTURE_2D,0,0,0,x.width,x.height,z,K,x.data);else{A.sort((le,ie)=>le.start-ie.start);let k=0;for(let le=1;le<A.length;le++){let ie=A[k],ee=A[le],Z=ie.start+ie.count,he=X(ee.start,x.width,4),ge=X(ie.start,x.width,4);ee.start<=Z+1&&he===ge&&X(ee.start+ee.count-1,x.width,4)===he?ie.count=Math.max(ie.count,ee.start+ee.count-ie.start):(++k,A[k]=ee)}A.length=k+1;let V=t.getParameter(i.UNPACK_ROW_LENGTH),$=t.getParameter(i.UNPACK_SKIP_PIXELS),ae=t.getParameter(i.UNPACK_SKIP_ROWS);t.pixelStorei(i.UNPACK_ROW_LENGTH,x.width);for(let le=0,ie=A.length;le<ie;le++){let ee=A[le],Z=Math.floor(ee.start/4),he=Math.ceil(ee.count/4),ge=Z%x.width,L=Math.floor(Z/x.width),fe=he,te=1;t.pixelStorei(i.UNPACK_SKIP_PIXELS,ge),t.pixelStorei(i.UNPACK_SKIP_ROWS,L),t.texSubImage2D(i.TEXTURE_2D,0,ge,L,fe,te,z,K,x.data)}R.clearUpdateRanges(),t.pixelStorei(i.UNPACK_ROW_LENGTH,V),t.pixelStorei(i.UNPACK_SKIP_PIXELS,$),t.pixelStorei(i.UNPACK_SKIP_ROWS,ae)}}function ye(R,x,z){let K=i.TEXTURE_2D;(x.isDataArrayTexture||x.isCompressedArrayTexture)&&(K=i.TEXTURE_2D_ARRAY),x.isData3DTexture&&(K=i.TEXTURE_3D);let se=de(R,x),A=x.source;t.bindTexture(K,R.__webglTexture,i.TEXTURE0+z);let k=n.get(A);if(A.version!==k.__version||se===!0){if(t.activeTexture(i.TEXTURE0+z),(typeof ImageBitmap<"u"&&x.image instanceof ImageBitmap)===!1){let te=Je.getPrimaries(Je.workingColorSpace),ve=x.colorSpace===Zt?null:Je.getPrimaries(x.colorSpace),be=x.colorSpace===Zt||te===ve?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,be)}t.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment);let $=m(x.image,!1,r.maxTextureSize);$=oe(x,$);let ae=s.convert(x.format,x.colorSpace),le=s.convert(x.type),ie=y(x.internalFormat,ae,le,x.normalized,x.colorSpace,x.isVideoTexture);Se(K,x);let ee,Z=x.mipmaps,he=x.isVideoTexture!==!0,ge=k.__version===void 0||se===!0,L=A.dataReady,fe=S(x,$);if(x.isDepthTexture)ie=b(x.format===Li,x.type),ge&&(he?t.texStorage2D(i.TEXTURE_2D,1,ie,$.width,$.height):t.texImage2D(i.TEXTURE_2D,0,ie,$.width,$.height,0,ae,le,null));else if(x.isDataTexture)if(Z.length>0){he&&ge&&t.texStorage2D(i.TEXTURE_2D,fe,ie,Z[0].width,Z[0].height);for(let te=0,ve=Z.length;te<ve;te++)ee=Z[te],he?L&&t.texSubImage2D(i.TEXTURE_2D,te,0,0,ee.width,ee.height,ae,le,ee.data):t.texImage2D(i.TEXTURE_2D,te,ie,ee.width,ee.height,0,ae,le,ee.data);x.generateMipmaps=!1}else he?(ge&&t.texStorage2D(i.TEXTURE_2D,fe,ie,$.width,$.height),L&&ne(x,$,ae,le)):t.texImage2D(i.TEXTURE_2D,0,ie,$.width,$.height,0,ae,le,$.data);else if(x.isCompressedTexture)if(x.isCompressedArrayTexture){he&&ge&&t.texStorage3D(i.TEXTURE_2D_ARRAY,fe,ie,Z[0].width,Z[0].height,$.depth);for(let te=0,ve=Z.length;te<ve;te++)if(ee=Z[te],x.format!==$t)if(ae!==null)if(he){if(L)if(x.layerUpdates.size>0){let be=Zc(ee.width,ee.height,x.format,x.type);for(let me of x.layerUpdates){let Ne=ee.data.subarray(me*be/ee.data.BYTES_PER_ELEMENT,(me+1)*be/ee.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,te,0,0,me,ee.width,ee.height,1,ae,Ne)}}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,te,0,0,0,ee.width,ee.height,$.depth,ae,ee.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,te,ie,ee.width,ee.height,$.depth,0,ee.data,0,0);else He("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else he?L&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,te,0,0,0,ee.width,ee.height,$.depth,ae,le,ee.data):t.texImage3D(i.TEXTURE_2D_ARRAY,te,ie,ee.width,ee.height,$.depth,0,ae,le,ee.data);x.layerUpdates.size>0&&x.clearLayerUpdates()}else{he&&ge&&t.texStorage2D(i.TEXTURE_2D,fe,ie,Z[0].width,Z[0].height);for(let te=0,ve=Z.length;te<ve;te++)ee=Z[te],x.format!==$t?ae!==null?he?L&&t.compressedTexSubImage2D(i.TEXTURE_2D,te,0,0,ee.width,ee.height,ae,ee.data):t.compressedTexImage2D(i.TEXTURE_2D,te,ie,ee.width,ee.height,0,ee.data):He("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):he?L&&t.texSubImage2D(i.TEXTURE_2D,te,0,0,ee.width,ee.height,ae,le,ee.data):t.texImage2D(i.TEXTURE_2D,te,ie,ee.width,ee.height,0,ae,le,ee.data)}else if(x.isDataArrayTexture)if(he){if(ge&&t.texStorage3D(i.TEXTURE_2D_ARRAY,fe,ie,$.width,$.height,$.depth),L)if(x.layerUpdates.size>0){let te=Zc($.width,$.height,x.format,x.type);for(let ve of x.layerUpdates){let be=$.data.subarray(ve*te/$.data.BYTES_PER_ELEMENT,(ve+1)*te/$.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,ve,$.width,$.height,1,ae,le,be)}x.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,$.width,$.height,$.depth,ae,le,$.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,ie,$.width,$.height,$.depth,0,ae,le,$.data);else if(x.isData3DTexture)he?(ge&&t.texStorage3D(i.TEXTURE_3D,fe,ie,$.width,$.height,$.depth),L&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,$.width,$.height,$.depth,ae,le,$.data)):t.texImage3D(i.TEXTURE_3D,0,ie,$.width,$.height,$.depth,0,ae,le,$.data);else if(x.isFramebufferTexture){if(ge)if(he)t.texStorage2D(i.TEXTURE_2D,fe,ie,$.width,$.height);else{let te=$.width,ve=$.height;for(let be=0;be<fe;be++)t.texImage2D(i.TEXTURE_2D,be,ie,te,ve,0,ae,le,null),te>>=1,ve>>=1}}else if(x.isHTMLTexture){if("texElementImage2D"in i){let te=i.canvas;if(te.hasAttribute("layoutsubtree")||te.setAttribute("layoutsubtree","true"),$.parentNode!==te){te.appendChild($),u.add(x),te.onpaint=ve=>{let be=ve.changedElements;for(let me of u)be.includes(me.image)&&(me.needsUpdate=!0)},te.requestPaint();return}if(i.texElementImage2D.length===3)i.texElementImage2D(i.TEXTURE_2D,i.RGBA8,$);else{let be=i.RGBA,me=i.RGBA,Ne=i.UNSIGNED_BYTE;i.texElementImage2D(i.TEXTURE_2D,0,be,me,Ne,$)}i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE)}}else if(Z.length>0){if(he&&ge){let te=xe(Z[0]);t.texStorage2D(i.TEXTURE_2D,fe,ie,te.width,te.height)}for(let te=0,ve=Z.length;te<ve;te++)ee=Z[te],he?L&&t.texSubImage2D(i.TEXTURE_2D,te,0,0,ae,le,ee):t.texImage2D(i.TEXTURE_2D,te,ie,ae,le,ee);x.generateMipmaps=!1}else if(he){if(ge){let te=xe($);t.texStorage2D(i.TEXTURE_2D,fe,ie,te.width,te.height)}L&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,ae,le,$)}else t.texImage2D(i.TEXTURE_2D,0,ie,ae,le,$);p(x)&&w(K),k.__version=A.version,x.onUpdate&&x.onUpdate(x)}R.__version=x.version}function Pe(R,x,z){if(x.image.length!==6)return;let K=de(R,x),se=x.source;t.bindTexture(i.TEXTURE_CUBE_MAP,R.__webglTexture,i.TEXTURE0+z);let A=n.get(se);if(se.version!==A.__version||K===!0){t.activeTexture(i.TEXTURE0+z);let k=Je.getPrimaries(Je.workingColorSpace),V=x.colorSpace===Zt?null:Je.getPrimaries(x.colorSpace),$=x.colorSpace===Zt||k===V?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,x.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),t.pixelStorei(i.UNPACK_ALIGNMENT,x.unpackAlignment),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,$);let ae=x.isCompressedTexture||x.image[0].isCompressedTexture,le=x.image[0]&&x.image[0].isDataTexture,ie=[];for(let me=0;me<6;me++)!ae&&!le?ie[me]=m(x.image[me],!0,r.maxCubemapSize):ie[me]=le?x.image[me].image:x.image[me],ie[me]=oe(x,ie[me]);let ee=ie[0],Z=s.convert(x.format,x.colorSpace),he=s.convert(x.type),ge=y(x.internalFormat,Z,he,x.normalized,x.colorSpace),L=x.isVideoTexture!==!0,fe=A.__version===void 0||K===!0,te=se.dataReady,ve=S(x,ee);Se(i.TEXTURE_CUBE_MAP,x);let be;if(ae){L&&fe&&t.texStorage2D(i.TEXTURE_CUBE_MAP,ve,ge,ee.width,ee.height);for(let me=0;me<6;me++){be=ie[me].mipmaps;for(let Ne=0;Ne<be.length;Ne++){let Ie=be[Ne];x.format!==$t?Z!==null?L?te&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne,0,0,Ie.width,Ie.height,Z,Ie.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne,ge,Ie.width,Ie.height,0,Ie.data):He("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):L?te&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne,0,0,Ie.width,Ie.height,Z,he,Ie.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne,ge,Ie.width,Ie.height,0,Z,he,Ie.data)}}}else{if(be=x.mipmaps,L&&fe){be.length>0&&ve++;let me=xe(ie[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,ve,ge,me.width,me.height)}for(let me=0;me<6;me++)if(le){L?te&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,0,0,0,ie[me].width,ie[me].height,Z,he,ie[me].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,0,ge,ie[me].width,ie[me].height,0,Z,he,ie[me].data);for(let Ne=0;Ne<be.length;Ne++){let it=be[Ne].image[me].image;L?te&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne+1,0,0,it.width,it.height,Z,he,it.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne+1,ge,it.width,it.height,0,Z,he,it.data)}}else{L?te&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,0,0,0,Z,he,ie[me]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,0,ge,Z,he,ie[me]);for(let Ne=0;Ne<be.length;Ne++){let Ie=be[Ne];L?te&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne+1,0,0,Z,he,Ie.image[me]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+me,Ne+1,ge,Z,he,Ie.image[me])}}}p(x)&&w(i.TEXTURE_CUBE_MAP),A.__version=se.version,x.onUpdate&&x.onUpdate(x)}R.__version=x.version}function _e(R,x,z,K,se,A){let k=s.convert(z.format,z.colorSpace),V=s.convert(z.type),$=y(z.internalFormat,k,V,z.normalized,z.colorSpace),ae=n.get(x),le=n.get(z);if(le.__renderTarget=x,!ae.__hasExternalTextures){let ie=Math.max(1,x.width>>A),ee=Math.max(1,x.height>>A);se===i.TEXTURE_3D||se===i.TEXTURE_2D_ARRAY?t.texImage3D(se,A,$,ie,ee,x.depth,0,k,V,null):t.texImage2D(se,A,$,ie,ee,0,k,V,null)}t.bindFramebuffer(i.FRAMEBUFFER,R),ht(x)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,K,se,le.__webglTexture,0,pt(x)):(se===i.TEXTURE_2D||se>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&se<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,K,se,le.__webglTexture,A),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Ce(R,x,z){if(i.bindRenderbuffer(i.RENDERBUFFER,R),x.depthBuffer){let K=x.depthTexture,se=K&&K.isDepthTexture?K.type:null,A=b(x.stencilBuffer,se),k=x.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;ht(x)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,pt(x),A,x.width,x.height):z?i.renderbufferStorageMultisample(i.RENDERBUFFER,pt(x),A,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,A,x.width,x.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,k,i.RENDERBUFFER,R)}else{let K=x.textures;for(let se=0;se<K.length;se++){let A=K[se],k=s.convert(A.format,A.colorSpace),V=s.convert(A.type),$=y(A.internalFormat,k,V,A.normalized,A.colorSpace);ht(x)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,pt(x),$,x.width,x.height):z?i.renderbufferStorageMultisample(i.RENDERBUFFER,pt(x),$,x.width,x.height):i.renderbufferStorage(i.RENDERBUFFER,$,x.width,x.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function qe(R,x,z){let K=x.isWebGLCubeRenderTarget===!0;if(t.bindFramebuffer(i.FRAMEBUFFER,R),!(x.depthTexture&&x.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let se=n.get(x.depthTexture);if(se.__renderTarget=x,(!se.__webglTexture||x.depthTexture.image.width!==x.width||x.depthTexture.image.height!==x.height)&&(x.depthTexture.image.width=x.width,x.depthTexture.image.height=x.height,x.depthTexture.needsUpdate=!0),K){if(se.__webglInit===void 0&&(se.__webglInit=!0,x.depthTexture.addEventListener("dispose",C)),se.__webglTexture===void 0){se.__webglTexture=i.createTexture(),t.bindTexture(i.TEXTURE_CUBE_MAP,se.__webglTexture),Se(i.TEXTURE_CUBE_MAP,x.depthTexture);let ae=s.convert(x.depthTexture.format),le=s.convert(x.depthTexture.type),ie;x.depthTexture.format===Yn?ie=i.DEPTH_COMPONENT24:x.depthTexture.format===Li&&(ie=i.DEPTH24_STENCIL8);for(let ee=0;ee<6;ee++)i.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ee,0,ie,x.width,x.height,0,ae,le,null)}}else ce(x.depthTexture,0);let A=se.__webglTexture,k=pt(x),V=K?i.TEXTURE_CUBE_MAP_POSITIVE_X+z:i.TEXTURE_2D,$=x.depthTexture.format===Li?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;if(x.depthTexture.format===Yn)ht(x)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,$,V,A,0,k):i.framebufferTexture2D(i.FRAMEBUFFER,$,V,A,0);else if(x.depthTexture.format===Li)ht(x)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,$,V,A,0,k):i.framebufferTexture2D(i.FRAMEBUFFER,$,V,A,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function Be(R){let x=n.get(R),z=R.isWebGLCubeRenderTarget===!0;if(x.__boundDepthTexture!==R.depthTexture){let K=R.depthTexture;if(x.__depthDisposeCallback&&x.__depthDisposeCallback(),K){let se=()=>{delete x.__boundDepthTexture,delete x.__depthDisposeCallback,K.removeEventListener("dispose",se)};K.addEventListener("dispose",se),x.__depthDisposeCallback=se}x.__boundDepthTexture=K}if(R.depthTexture&&!x.__autoAllocateDepthBuffer)if(z)for(let K=0;K<6;K++)qe(x.__webglFramebuffer[K],R,K);else{let K=R.texture.mipmaps;K&&K.length>0?qe(x.__webglFramebuffer[0],R,0):qe(x.__webglFramebuffer,R,0)}else if(z){x.__webglDepthbuffer=[];for(let K=0;K<6;K++)if(t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer[K]),x.__webglDepthbuffer[K]===void 0)x.__webglDepthbuffer[K]=i.createRenderbuffer(),Ce(x.__webglDepthbuffer[K],R,!1);else{let se=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,A=x.__webglDepthbuffer[K];i.bindRenderbuffer(i.RENDERBUFFER,A),i.framebufferRenderbuffer(i.FRAMEBUFFER,se,i.RENDERBUFFER,A)}}else{let K=R.texture.mipmaps;if(K&&K.length>0?t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer[0]):t.bindFramebuffer(i.FRAMEBUFFER,x.__webglFramebuffer),x.__webglDepthbuffer===void 0)x.__webglDepthbuffer=i.createRenderbuffer(),Ce(x.__webglDepthbuffer,R,!1);else{let se=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,A=x.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,A),i.framebufferRenderbuffer(i.FRAMEBUFFER,se,i.RENDERBUFFER,A)}}t.bindFramebuffer(i.FRAMEBUFFER,null)}function ze(R,x,z){let K=n.get(R);x!==void 0&&_e(K.__webglFramebuffer,R,R.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),z!==void 0&&Be(R)}function Xe(R){let x=R.texture,z=n.get(R),K=n.get(x);R.addEventListener("dispose",_);let se=R.textures,A=R.isWebGLCubeRenderTarget===!0,k=se.length>1;if(k||(K.__webglTexture===void 0&&(K.__webglTexture=i.createTexture()),K.__version=x.version,a.memory.textures++),A){z.__webglFramebuffer=[];for(let V=0;V<6;V++)if(x.mipmaps&&x.mipmaps.length>0){z.__webglFramebuffer[V]=[];for(let $=0;$<x.mipmaps.length;$++)z.__webglFramebuffer[V][$]=i.createFramebuffer()}else z.__webglFramebuffer[V]=i.createFramebuffer()}else{if(x.mipmaps&&x.mipmaps.length>0){z.__webglFramebuffer=[];for(let V=0;V<x.mipmaps.length;V++)z.__webglFramebuffer[V]=i.createFramebuffer()}else z.__webglFramebuffer=i.createFramebuffer();if(k)for(let V=0,$=se.length;V<$;V++){let ae=n.get(se[V]);ae.__webglTexture===void 0&&(ae.__webglTexture=i.createTexture(),a.memory.textures++)}if(R.samples>0&&ht(R)===!1){z.__webglMultisampledFramebuffer=i.createFramebuffer(),z.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,z.__webglMultisampledFramebuffer);for(let V=0;V<se.length;V++){let $=se[V];z.__webglColorRenderbuffer[V]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,z.__webglColorRenderbuffer[V]);let ae=s.convert($.format,$.colorSpace),le=s.convert($.type),ie=y($.internalFormat,ae,le,$.normalized,$.colorSpace,R.isXRRenderTarget===!0),ee=pt(R);i.renderbufferStorageMultisample(i.RENDERBUFFER,ee,ie,R.width,R.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+V,i.RENDERBUFFER,z.__webglColorRenderbuffer[V])}i.bindRenderbuffer(i.RENDERBUFFER,null),R.depthBuffer&&(z.__webglDepthRenderbuffer=i.createRenderbuffer(),Ce(z.__webglDepthRenderbuffer,R,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(A){t.bindTexture(i.TEXTURE_CUBE_MAP,K.__webglTexture),Se(i.TEXTURE_CUBE_MAP,x);for(let V=0;V<6;V++)if(x.mipmaps&&x.mipmaps.length>0)for(let $=0;$<x.mipmaps.length;$++)_e(z.__webglFramebuffer[V][$],R,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+V,$);else _e(z.__webglFramebuffer[V],R,x,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+V,0);p(x)&&w(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(k){for(let V=0,$=se.length;V<$;V++){let ae=se[V],le=n.get(ae),ie=i.TEXTURE_2D;(R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(ie=R.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(ie,le.__webglTexture),Se(ie,ae),_e(z.__webglFramebuffer,R,ae,i.COLOR_ATTACHMENT0+V,ie,0),p(ae)&&w(ie)}t.unbindTexture()}else{let V=i.TEXTURE_2D;if((R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(V=R.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(V,K.__webglTexture),Se(V,x),x.mipmaps&&x.mipmaps.length>0)for(let $=0;$<x.mipmaps.length;$++)_e(z.__webglFramebuffer[$],R,x,i.COLOR_ATTACHMENT0,V,$);else _e(z.__webglFramebuffer,R,x,i.COLOR_ATTACHMENT0,V,0);p(x)&&w(V),t.unbindTexture()}R.depthBuffer&&Be(R)}function ke(R){let x=R.textures;for(let z=0,K=x.length;z<K;z++){let se=x[z];if(p(se)){let A=T(R),k=n.get(se).__webglTexture;t.bindTexture(A,k),w(A),t.unbindTexture()}}}let Qe=[],gt=[];function Et(R){if(R.samples>0){if(ht(R)===!1){let x=R.textures,z=R.width,K=R.height,se=i.COLOR_BUFFER_BIT,A=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,k=n.get(R),V=x.length>1;if(V)for(let ae=0;ae<x.length;ae++)t.bindFramebuffer(i.FRAMEBUFFER,k.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,k.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,k.__webglMultisampledFramebuffer);let $=R.texture.mipmaps;$&&$.length>0?t.bindFramebuffer(i.DRAW_FRAMEBUFFER,k.__webglFramebuffer[0]):t.bindFramebuffer(i.DRAW_FRAMEBUFFER,k.__webglFramebuffer);for(let ae=0;ae<x.length;ae++){if(R.resolveDepthBuffer&&(R.depthBuffer&&(se|=i.DEPTH_BUFFER_BIT),R.stencilBuffer&&R.resolveStencilBuffer&&(se|=i.STENCIL_BUFFER_BIT)),V){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,k.__webglColorRenderbuffer[ae]);let le=n.get(x[ae]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,le,0)}i.blitFramebuffer(0,0,z,K,0,0,z,K,se,i.NEAREST),l===!0&&(Qe.length=0,gt.length=0,Qe.push(i.COLOR_ATTACHMENT0+ae),R.depthBuffer&&R.storeMultisampledDepthBuffer===!1&&(Qe.push(A),gt.push(A),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,gt)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,Qe))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),V)for(let ae=0;ae<x.length;ae++){t.bindFramebuffer(i.FRAMEBUFFER,k.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.RENDERBUFFER,k.__webglColorRenderbuffer[ae]);let le=n.get(x[ae]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,k.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ae,i.TEXTURE_2D,le,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,k.__webglMultisampledFramebuffer)}else if(R.depthBuffer&&R.storeMultisampledDepthBuffer===!1&&l){let x=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[x])}}}function pt(R){return Math.min(r.maxSamples,R.samples)}function ht(R){let x=n.get(R);return R.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&x.__useRenderToTexture!==!1}function O(R){let x=a.render.frame;h.get(R)!==x&&(h.set(R,x),R.update())}function oe(R,x){let z=R.colorSpace,K=R.format,se=R.type;return R.isCompressedTexture===!0||R.isVideoTexture===!0||z!==Xi&&z!==Zt&&(Je.getTransfer(z)===lt?(K!==$t||se!==Wt)&&He("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Ve("WebGLTextures: Unsupported texture color space:",z)),x}function xe(R){return typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement?(c.width=R.naturalWidth||R.width,c.height=R.naturalHeight||R.height):typeof VideoFrame<"u"&&R instanceof VideoFrame?(c.width=R.displayWidth,c.height=R.displayHeight):(c.width=R.width,c.height=R.height),c}this.allocateTextureUnit=q,this.resetTextureUnits=F,this.getTextureUnits=U,this.setTextureUnits=H,this.setTexture2D=ce,this.setTexture2DArray=G,this.setTexture3D=J,this.setTextureCube=W,this.rebindTextures=ze,this.setupRenderTarget=Xe,this.updateRenderTargetMipmap=ke,this.updateMultisampleRenderTarget=Et,this.setupDepthRenderbuffer=Be,this.setupFrameBufferTexture=_e,this.useMultisampledRTT=ht,this.isReversedDepthBuffer=function(){return t.buffers.depth.getReversed()}}function p_(i,e){function t(n,r=Zt){let s,a=Je.getTransfer(r);if(n===Wt)return i.UNSIGNED_BYTE;if(n===bo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===Mo)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Bc)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===kc)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===Fc)return i.BYTE;if(n===Oc)return i.SHORT;if(n===Or)return i.UNSIGNED_SHORT;if(n===vo)return i.INT;if(n===zn)return i.UNSIGNED_INT;if(n===fn)return i.FLOAT;if(n===Vn)return i.HALF_FLOAT;if(n===Hc)return i.ALPHA;if(n===zc)return i.RGB;if(n===$t)return i.RGBA;if(n===Yn)return i.DEPTH_COMPONENT;if(n===Li)return i.DEPTH_STENCIL;if(n===So)return i.RED;if(n===Eo)return i.RED_INTEGER;if(n===Ui)return i.RG;if(n===wo)return i.RG_INTEGER;if(n===To)return i.RGBA_INTEGER;if(n===Ns||n===Fs||n===Os||n===Bs)if(a===lt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(n===Ns)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Fs)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Os)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Bs)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(n===Ns)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Fs)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Os)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Bs)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===Ao||n===Ro||n===Co||n===Po)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(n===Ao)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Ro)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Co)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Po)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Io||n===Lo||n===Uo||n===Do||n===No||n===ks||n===Fo)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(n===Io||n===Lo)return a===lt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(n===Uo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(n===Do)return s.COMPRESSED_R11_EAC;if(n===No)return s.COMPRESSED_SIGNED_R11_EAC;if(n===ks)return s.COMPRESSED_RG11_EAC;if(n===Fo)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===Oo||n===Bo||n===ko||n===Ho||n===zo||n===Vo||n===Go||n===Wo||n===Xo||n===qo||n===Yo||n===$o||n===Zo||n===Jo)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(n===Oo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Bo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===ko)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Ho)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===zo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Vo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Go)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Wo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===Xo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===qo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Yo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===$o)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Zo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Jo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Ko||n===jo||n===Qo)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(n===Ko)return a===lt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===jo)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Qo)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===el||n===tl||n===Hs||n===nl)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(n===el)return s.COMPRESSED_RED_RGTC1_EXT;if(n===tl)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Hs)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===nl)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Br?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}var m_=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,g_=`
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

}`,ch=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new vs(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new Rt({vertexShader:m_,fragmentShader:g_,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Oe(new ct(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},hh=class extends $n{constructor(e,t){super();let n=this,r=null,s=1,a=null,o="local-floor",l=1,c=null,h=null,u=null,d=null,f=null,g=null,v=typeof XRWebGLBinding<"u",m=new ch,p={},w=t.getContextAttributes(),T=null,y=null,b=[],S=[],C=new De,_=null,E=null,I=new Gt;I.viewport=new St;let N=new Gt;N.viewport=new St;let P=[I,N],F=new po,U=null,H=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(X){let ne=b[X];return ne===void 0&&(ne=new Ir,b[X]=ne),ne.getTargetRaySpace()},this.getControllerGrip=function(X){let ne=b[X];return ne===void 0&&(ne=new Ir,b[X]=ne),ne.getGripSpace()},this.getHand=function(X){let ne=b[X];return ne===void 0&&(ne=new Ir,b[X]=ne),ne.getHandSpace()};function q(X){let ne=S.indexOf(X.inputSource);if(ne===-1)return;let ye=b[ne];ye!==void 0&&(ye.update(X.inputSource,X.frame,c||a),ye.dispatchEvent({type:X.type,data:X.inputSource}))}function Y(){r.removeEventListener("select",q),r.removeEventListener("selectstart",q),r.removeEventListener("selectend",q),r.removeEventListener("squeeze",q),r.removeEventListener("squeezestart",q),r.removeEventListener("squeezeend",q),r.removeEventListener("end",Y),r.removeEventListener("inputsourceschange",ce);for(let X=0;X<b.length;X++){let ne=S[X];ne!==null&&(S[X]=null,b[X].disconnect(ne))}U=null,H=null,m.reset();for(let X in p)delete p[X];if(e.setRenderTarget(T),f=null,d=null,u=null,r=null,y=null,de.stop(),n.isPresenting=!1,e.setPixelRatio(_),e.setSize(C.width,C.height,!1),E!==null){let X=E.camera;X.fov=E.fov,X.zoom=E.zoom,X.updateProjectionMatrix(),E=null}n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(X){s=X,n.isPresenting===!0&&He("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(X){o=X,n.isPresenting===!0&&He("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(X){c=X},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u===null&&v&&(u=new XRWebGLBinding(r,t)),u},this.getFrame=function(){return g},this.getSession=function(){return r},this.setSession=async function(X){if(r=X,r!==null){if(T=e.getRenderTarget(),r.addEventListener("select",q),r.addEventListener("selectstart",q),r.addEventListener("selectend",q),r.addEventListener("squeeze",q),r.addEventListener("squeezestart",q),r.addEventListener("squeezeend",q),r.addEventListener("end",Y),r.addEventListener("inputsourceschange",ce),w.xrCompatible!==!0&&await t.makeXRCompatible(),_=e.getPixelRatio(),e.getSize(C),v&&"createProjectionLayer"in XRWebGLBinding.prototype){let ye=null,Pe=null,_e=null;w.depth&&(_e=w.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ye=w.stencil?Li:Yn,Pe=w.stencil?Br:zn);let Ce={colorFormat:t.RGBA8,depthFormat:_e,scaleFactor:s};u=this.getBinding(),d=u.createProjectionLayer(Ce),r.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),y=new qt(d.textureWidth,d.textureHeight,{format:$t,type:Wt,depthTexture:new Ei(d.textureWidth,d.textureHeight,Pe,void 0,void 0,void 0,void 0,void 0,void 0,ye),stencilBuffer:w.stencil,colorSpace:e.outputColorSpace,samples:w.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1,storeMultisampledDepthBuffer:d.ignoreDepthValues===!1,storeMultisampledStencilBuffer:d.ignoreDepthValues===!1})}else{let ye={antialias:w.antialias,alpha:!0,depth:w.depth,stencil:w.stencil,framebufferScaleFactor:s};f=new XRWebGLLayer(r,t,ye),r.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new qt(f.framebufferWidth,f.framebufferHeight,{format:$t,type:Wt,colorSpace:e.outputColorSpace,stencilBuffer:w.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1,storeMultisampledDepthBuffer:f.ignoreDepthValues===!1,storeMultisampledStencilBuffer:f.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await r.requestReferenceSpace(o),de.setContext(r),de.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function ce(X){for(let ne=0;ne<X.removed.length;ne++){let ye=X.removed[ne],Pe=S.indexOf(ye);Pe>=0&&(S[Pe]=null,b[Pe].disconnect(ye))}for(let ne=0;ne<X.added.length;ne++){let ye=X.added[ne],Pe=S.indexOf(ye);if(Pe===-1){for(let Ce=0;Ce<b.length;Ce++)if(Ce>=S.length){S.push(ye),Pe=Ce;break}else if(S[Ce]===null){S[Ce]=ye,Pe=Ce;break}if(Pe===-1)break}let _e=b[Pe];_e&&_e.connect(ye)}}let G=new D,J=new D;function W(X,ne,ye){G.setFromMatrixPosition(ne.matrixWorld),J.setFromMatrixPosition(ye.matrixWorld);let Pe=G.distanceTo(J),_e=ne.projectionMatrix.elements,Ce=ye.projectionMatrix.elements,qe=_e[14]/(_e[10]-1),Be=_e[14]/(_e[10]+1),ze=(_e[9]+1)/_e[5],Xe=(_e[9]-1)/_e[5],ke=(_e[8]-1)/_e[0],Qe=(Ce[8]+1)/Ce[0],gt=qe*ke,Et=qe*Qe,pt=Pe/(-ke+Qe),ht=pt*-ke;if(ne.matrixWorld.decompose(X.position,X.quaternion,X.scale),X.translateX(ht),X.translateZ(pt),X.matrixWorld.compose(X.position,X.quaternion,X.scale),X.matrixWorldInverse.copy(X.matrixWorld).invert(),_e[10]===-1)X.projectionMatrix.copy(ne.projectionMatrix),X.projectionMatrixInverse.copy(ne.projectionMatrixInverse);else{let O=qe+pt,oe=Be+pt,xe=gt-ht,R=Et+(Pe-ht),x=ze*Be/oe*O,z=Xe*Be/oe*O;X.projectionMatrix.makePerspective(xe,R,x,z,O,oe),X.projectionMatrixInverse.copy(X.projectionMatrix).invert()}}function ue(X,ne){ne===null?X.matrixWorld.copy(X.matrix):X.matrixWorld.multiplyMatrices(ne.matrixWorld,X.matrix),X.matrixWorldInverse.copy(X.matrixWorld).invert()}this.updateCamera=function(X){if(r===null)return;let ne=X.near,ye=X.far;m.texture!==null&&(m.depthNear>0&&(ne=m.depthNear),m.depthFar>0&&(ye=m.depthFar)),F.near=N.near=I.near=ne,F.far=N.far=I.far=ye,(U!==F.near||H!==F.far)&&(r.updateRenderState({depthNear:F.near,depthFar:F.far}),U=F.near,H=F.far),F.layers.mask=X.layers.mask|6,I.layers.mask=F.layers.mask&-5,N.layers.mask=F.layers.mask&-3;let Pe=X.parent,_e=F.cameras;ue(F,Pe);for(let Ce=0;Ce<_e.length;Ce++)ue(_e[Ce],Pe);_e.length===2?W(F,I,N):F.projectionMatrix.copy(I.projectionMatrix),E===null&&X.isPerspectiveCamera&&(E={camera:X,fov:X.fov,zoom:X.zoom}),pe(X,F,Pe)};function pe(X,ne,ye){ye===null?X.matrix.copy(ne.matrixWorld):(X.matrix.copy(ye.matrixWorld),X.matrix.invert(),X.matrix.multiply(ne.matrixWorld)),X.matrix.decompose(X.position,X.quaternion,X.scale),X.updateMatrixWorld(!0),X.projectionMatrix.copy(ne.projectionMatrix),X.projectionMatrixInverse.copy(ne.projectionMatrixInverse),X.isPerspectiveCamera&&(X.fov=us*2*Math.atan(1/X.projectionMatrix.elements[5]),X.zoom=1)}this.getCamera=function(){return F},this.getFoveation=function(){if(!(d===null&&f===null))return l},this.setFoveation=function(X){l=X,d!==null&&(d.fixedFoveation=X),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=X)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(F)},this.getCameraTexture=function(X){return p[X]};let Me=null;function Se(X,ne){if(h=ne.getViewerPose(c||a),g=ne,h!==null){let ye=h.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let Pe=!1;ye.length!==F.cameras.length&&(F.cameras.length=0,Pe=!0);for(let Be=0;Be<ye.length;Be++){let ze=ye[Be],Xe=null;if(f!==null)Xe=f.getViewport(ze);else{let Qe=u.getViewSubImage(d,ze);Xe=Qe.viewport,Be===0&&(e.setRenderTargetTextures(y,Qe.colorTexture,Qe.depthStencilTexture),e.setRenderTarget(y))}let ke=P[Be];ke===void 0&&(ke=new Gt,ke.layers.enable(Be),ke.viewport=new St,P[Be]=ke),ke.matrix.fromArray(ze.transform.matrix),ke.matrix.decompose(ke.position,ke.quaternion,ke.scale),ke.projectionMatrix.fromArray(ze.projectionMatrix),ke.projectionMatrixInverse.copy(ke.projectionMatrix).invert(),ke.viewport.set(Xe.x,Xe.y,Xe.width,Xe.height),Be===0&&(F.matrix.copy(ke.matrix),F.matrix.decompose(F.position,F.quaternion,F.scale)),Pe===!0&&F.cameras.push(ke)}let _e=r.enabledFeatures;if(_e&&_e.includes("depth-sensing")&&r.depthUsage=="gpu-optimized"&&v){u=n.getBinding();let Be=u.getDepthInformation(ye[0]);Be&&Be.isValid&&Be.texture&&m.init(Be,r.renderState)}if(_e&&_e.includes("camera-access")&&v){e.state.unbindTexture(),u=n.getBinding();for(let Be=0;Be<ye.length;Be++){let ze=ye[Be].camera;if(ze){let Xe=p[ze];Xe||(Xe=new vs,p[ze]=Xe);let ke=u.getCameraImage(ze);Xe.sourceTexture=ke}}}}for(let ye=0;ye<b.length;ye++){let Pe=S[ye],_e=b[ye];Pe!==null&&_e!==void 0&&_e.update(Pe,ne,c||a)}Me&&Me(X,ne),ne.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ne}),g=null}let de=new Ad;de.setAnimationLoop(Se),this.setAnimationLoop=function(X){Me=X},this.dispose=function(){}}},x_=new je,Ud=new Ge;Ud.set(-1,0,0,0,1,0,0,0,1);function __(i,e){function t(m,p){m.matrixAutoUpdate===!0&&m.updateMatrix(),p.value.copy(m.matrix)}function n(m,p){p.color.getRGB(m.fogColor.value,qc(i)),p.isFog?(m.fogNear.value=p.near,m.fogFar.value=p.far):p.isFogExp2&&(m.fogDensity.value=p.density)}function r(m,p,w,T,y){p.isNodeMaterial?p.uniformsNeedUpdate=!1:p.isMeshBasicMaterial?s(m,p):p.isMeshLambertMaterial?(s(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshToonMaterial?(s(m,p),u(m,p)):p.isMeshPhongMaterial?(s(m,p),h(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshStandardMaterial?(s(m,p),d(m,p),p.isMeshPhysicalMaterial&&f(m,p,y)):p.isMeshMatcapMaterial?(s(m,p),g(m,p)):p.isMeshDepthMaterial?s(m,p):p.isMeshDistanceMaterial?(s(m,p),v(m,p)):p.isMeshNormalMaterial?s(m,p):p.isLineBasicMaterial?(a(m,p),p.isLineDashedMaterial&&o(m,p)):p.isPointsMaterial?l(m,p,w,T):p.isSpriteMaterial?c(m,p):p.isShadowMaterial?(m.color.value.copy(p.color),m.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function s(m,p){m.opacity.value=p.opacity,p.color&&m.diffuse.value.copy(p.color),p.emissive&&m.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.bumpMap&&(m.bumpMap.value=p.bumpMap,t(p.bumpMap,m.bumpMapTransform),m.bumpScale.value=p.bumpScale,p.side===Nt&&(m.bumpScale.value*=-1)),p.normalMap&&(m.normalMap.value=p.normalMap,t(p.normalMap,m.normalMapTransform),m.normalScale.value.copy(p.normalScale),p.side===Nt&&m.normalScale.value.negate()),p.displacementMap&&(m.displacementMap.value=p.displacementMap,t(p.displacementMap,m.displacementMapTransform),m.displacementScale.value=p.displacementScale,m.displacementBias.value=p.displacementBias),p.emissiveMap&&(m.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,m.emissiveMapTransform)),p.specularMap&&(m.specularMap.value=p.specularMap,t(p.specularMap,m.specularMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest);let w=e.get(p),T=w.envMap,y=w.envMapRotation;T&&(m.envMap.value=T,m.envMapRotation.value.setFromMatrix4(x_.makeRotationFromEuler(y)).transpose(),T.isCubeTexture&&T.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(Ud),m.reflectivity.value=p.reflectivity,m.ior.value=p.ior,m.refractionRatio.value=p.refractionRatio),p.lightMap&&(m.lightMap.value=p.lightMap,m.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,m.lightMapTransform)),p.aoMap&&(m.aoMap.value=p.aoMap,m.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,m.aoMapTransform))}function a(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform))}function o(m,p){m.dashSize.value=p.dashSize,m.totalSize.value=p.dashSize+p.gapSize,m.scale.value=p.scale}function l(m,p,w,T){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.size.value=p.size*w,m.scale.value=T*.5,p.map&&(m.map.value=p.map,t(p.map,m.uvTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function c(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.rotation.value=p.rotation,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function h(m,p){m.specular.value.copy(p.specular),m.shininess.value=Math.max(p.shininess,1e-4)}function u(m,p){p.gradientMap&&(m.gradientMap.value=p.gradientMap)}function d(m,p){m.metalness.value=p.metalness,p.metalnessMap&&(m.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,m.metalnessMapTransform)),m.roughness.value=p.roughness,p.roughnessMap&&(m.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,m.roughnessMapTransform)),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)}function f(m,p,w){m.ior.value=p.ior,p.sheen>0&&(m.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),m.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(m.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,m.sheenColorMapTransform)),p.sheenRoughnessMap&&(m.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,m.sheenRoughnessMapTransform))),p.clearcoat>0&&(m.clearcoat.value=p.clearcoat,m.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(m.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,m.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(m.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Nt&&m.clearcoatNormalScale.value.negate())),p.dispersion>0&&(m.dispersion.value=p.dispersion),p.retroreflectivity>0&&(m.retroreflectivity.value=p.retroreflectivity),p.iridescence>0&&(m.iridescence.value=p.iridescence,m.iridescenceIOR.value=p.iridescenceIOR,m.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(m.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,m.iridescenceMapTransform)),p.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),p.transmission>0&&(m.transmission.value=p.transmission,m.transmissionSamplerMap.value=w.texture,m.transmissionSamplerSize.value.set(w.width,w.height),p.transmissionMap&&(m.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,m.transmissionMapTransform)),m.thickness.value=p.thickness,p.thicknessMap&&(m.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=p.attenuationDistance,m.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(m.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(m.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=p.specularIntensity,m.specularColor.value.copy(p.specularColor),p.specularColorMap&&(m.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,m.specularColorMapTransform)),p.specularIntensityMap&&(m.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,p){p.matcap&&(m.matcap.value=p.matcap)}function v(m,p){let w=e.get(p).light;m.referencePosition.value.setFromMatrixPosition(w.matrixWorld),m.nearDistance.value=w.shadow.camera.near,m.farDistance.value=w.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:r}}function y_(i,e,t,n){let r={},s={},a=[],o=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(y,b){let S=b.program;n.uniformBlockBinding(y,S)}function c(y,b){let S=r[y.id];S===void 0&&(m(y),S=h(y),r[y.id]=S,y.addEventListener("dispose",w));let C=b.program;n.updateUBOMapping(y,C);let _=e.render.frame;s[y.id]!==_&&(d(y),s[y.id]=_)}function h(y){let b=u();y.__bindingPointIndex=b;let S=i.createBuffer(),C=y.__size,_=y.usage;return i.bindBuffer(i.UNIFORM_BUFFER,S),i.bufferData(i.UNIFORM_BUFFER,C,_),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,b,S),S}function u(){for(let y=0;y<o;y++)if(a.indexOf(y)===-1)return a.push(y),y;return Ve("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(y){let b=r[y.id],S=y.uniforms,C=y.__cache;i.bindBuffer(i.UNIFORM_BUFFER,b);for(let _=0,E=S.length;_<E;_++){let I=S[_];if(Array.isArray(I))for(let N=0,P=I.length;N<P;N++)f(I[N],_,N,C);else f(I,_,0,C)}i.bindBuffer(i.UNIFORM_BUFFER,null)}function f(y,b,S,C){if(v(y,b,S,C)===!0){let _=y.__offset,E=y.value;if(Array.isArray(E)){let I=0;for(let N=0;N<E.length;N++){let P=E[N],F=p(P);g(P,y.__data,I),typeof P!="number"&&typeof P!="boolean"&&!P.isMatrix3&&!ArrayBuffer.isView(P)&&(I+=F.storage/Float32Array.BYTES_PER_ELEMENT)}}else g(E,y.__data,0);i.bufferSubData(i.UNIFORM_BUFFER,_,y.__data)}}function g(y,b,S){typeof y=="number"||typeof y=="boolean"?b[0]=y:y.isMatrix3?(b[0]=y.elements[0],b[1]=y.elements[1],b[2]=y.elements[2],b[3]=0,b[4]=y.elements[3],b[5]=y.elements[4],b[6]=y.elements[5],b[7]=0,b[8]=y.elements[6],b[9]=y.elements[7],b[10]=y.elements[8],b[11]=0):ArrayBuffer.isView(y)?b.set(new y.constructor(y.buffer,y.byteOffset,b.length)):y.toArray(b,S)}function v(y,b,S,C){let _=y.value,E=b+"_"+S;if(C[E]===void 0)return typeof _=="number"||typeof _=="boolean"?C[E]=_:ArrayBuffer.isView(_)?C[E]=_.slice():C[E]=_.clone(),!0;{let I=C[E];if(typeof _=="number"||typeof _=="boolean"){if(I!==_)return C[E]=_,!0}else{if(ArrayBuffer.isView(_))return!0;if(I.equals(_)===!1)return I.copy(_),!0}}return!1}function m(y){let b=y.uniforms,S=0,C=16;for(let E=0,I=b.length;E<I;E++){let N=Array.isArray(b[E])?b[E]:[b[E]];for(let P=0,F=N.length;P<F;P++){let U=N[P],H=Array.isArray(U.value)?U.value:[U.value];for(let q=0,Y=H.length;q<Y;q++){let ce=H[q],G=p(ce),J=S%C,W=J%G.boundary,ue=J+W;S+=W,ue!==0&&C-ue<G.storage&&(S+=C-ue),U.__data=new Float32Array(G.storage/Float32Array.BYTES_PER_ELEMENT),U.__offset=S,S+=G.storage}}}let _=S%C;return _>0&&(S+=C-_),y.__size=S,y.__cache={},this}function p(y){let b={boundary:0,storage:0};return typeof y=="number"||typeof y=="boolean"?(b.boundary=4,b.storage=4):y.isVector2?(b.boundary=8,b.storage=8):y.isVector3||y.isColor?(b.boundary=16,b.storage=12):y.isVector4?(b.boundary=16,b.storage=16):y.isMatrix3?(b.boundary=48,b.storage=48):y.isMatrix4?(b.boundary=64,b.storage=64):y.isTexture?He("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(y)?(b.boundary=16,b.storage=y.byteLength):He("WebGLRenderer: Unsupported uniform value type.",y),b}function w(y){let b=y.target;b.removeEventListener("dispose",w);let S=a.indexOf(b.__bindingPointIndex);a.splice(S,1),i.deleteBuffer(r[b.id]),delete r[b.id],delete s[b.id]}function T(){for(let y in r)i.deleteBuffer(r[y]);a=[],r={},s={}}return{bind:l,update:c,dispose:T}}var v_=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),Qn=null;function b_(){return Qn===null&&(Qn=new qi(v_,16,16,Ui,Vn),Qn.name="DFG_LUT",Qn.minFilter=Xt,Qn.magFilter=Xt,Qn.wrapS=yn,Qn.wrapT=yn,Qn.generateMipmaps=!1,Qn.needsUpdate=!0),Qn}var ll=class{constructor(e={}){let{canvas:t=ju(),context:n=null,depth:r=!0,stencil:s=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=Wt}=e;this.isWebGLRenderer=!0;let g;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");g=n.getContextAttributes().alpha}else g=a;let v=f,m=new Set([To,wo,Eo]),p=new Set([Wt,zn,Or,Br,bo,Mo]),w=new Uint32Array(4),T=new Int32Array(4),y=new D,b=null,S=null,C=[],_=[],E=null;this.domElement=t,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Sn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let I=this,N=!1,P=null,F=null,U=null,H=null;this._outputColorSpace=Vt;let q=0,Y=0,ce=null,G=-1,J=null,W=new St,ue=new St,pe=null,Me=new We(0),Se=0,de=t.width,X=t.height,ne=1,ye=null,Pe=null,_e=new St(0,0,de,X),Ce=new St(0,0,de,X),qe=!1,Be=new Lr,ze=!1,Xe=!1,ke=new je,Qe=new D,gt=new St,Et={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},pt=!1;function ht(){return ce===null?ne:1}let O=n;function oe(M,B){return t.getContext(M,B)}let xe,R,x,z,K,se,A,k,V,$,ae,le,ie,ee,Z,he,ge,L,fe,te,ve,be,me;try{let M={alpha:!0,depth:r,stencil:s,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"186"}`),t.addEventListener("webglcontextlost",it,!1),t.addEventListener("webglcontextrestored",at,!1),t.addEventListener("webglcontextcreationerror",Dn,!1),O===null){let B="webgl2";if(O=oe(B,M),O===null)throw oe(B)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}Ne()}catch(M){throw t.removeEventListener("webglcontextlost",it,!1),t.removeEventListener("webglcontextrestored",at,!1),t.removeEventListener("webglcontextcreationerror",Dn,!1),Ve("WebGLRenderer: "+M.message),M}function Ne(){xe=new Rg(O),xe.init(),ve=new p_(O,xe),R=new _g(O,xe,e,ve),x=new d_(O,xe),R.reversedDepthBuffer&&d&&x.buffers.depth.setReversed(!0),F=O.createFramebuffer(),U=O.createFramebuffer(),H=O.createFramebuffer(),z=new Ig(O),K=new jx,se=new f_(O,xe,x,K,R,ve,z),A=new Ag(I),k=new Up(O),be=new gg(O,k),V=new Cg(O,k,z,be),$=new Ug(O,V,k,be,z),L=new Lg(O,R,se),Z=new yg(K),ae=new Kx(I,A,xe,R,be,Z),le=new __(I,K),ie=new e_,ee=new a_(xe),ge=new mg(I,A,x,$,g,l),he=new u_(I,$,R),me=new y_(O,z,R,x),fe=new xg(O,xe,z),te=new Pg(O,xe,z),z.programs=ae.programs,I.capabilities=R,I.extensions=xe,I.properties=K,I.renderLists=ie,I.shadowMap=he,I.state=x,I.info=z}v!==Wt&&(E=new Ng(v,t.width,t.height,o,r,s));let Ie=new hh(I,O);this.xr=Ie,this.getContext=function(){return O},this.getContextAttributes=function(){return O.getContextAttributes()},this.forceContextLoss=function(){let M=xe.get("WEBGL_lose_context");M&&M.loseContext()},this.forceContextRestore=function(){let M=xe.get("WEBGL_lose_context");M&&M.restoreContext()},this.getPixelRatio=function(){return ne},this.setPixelRatio=function(M){M!==void 0&&(ne=M,this.setSize(de,X,!1))},this.getSize=function(M){return M.set(de,X)},this.setSize=function(M,B,re=!0){if(Ie.isPresenting){He("WebGLRenderer: Can't change size while VR device is presenting.");return}de=M,X=B,t.width=Math.floor(M*ne),t.height=Math.floor(B*ne),re===!0&&(t.style.width=M+"px",t.style.height=B+"px"),E!==null&&E.setSize(t.width,t.height),this.setViewport(0,0,M,B)},this.getDrawingBufferSize=function(M){return M.set(de*ne,X*ne).floor()},this.setDrawingBufferSize=function(M,B,re){de=M,X=B,ne=re,t.width=Math.floor(M*re),t.height=Math.floor(B*re),this.setViewport(0,0,M,B)},this.setEffects=function(M){if(v===Wt){Ve("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(M){for(let B=0;B<M.length;B++)if(M[B].isOutputPass===!0){He("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}E.setEffects(M||[])},this.getCurrentViewport=function(M){return M.copy(W)},this.getViewport=function(M){return M.copy(_e)},this.setViewport=function(M,B,re,j){M.isVector4?_e.set(M.x,M.y,M.z,M.w):_e.set(M,B,re,j),x.viewport(W.copy(_e).multiplyScalar(ne).round())},this.getScissor=function(M){return M.copy(Ce)},this.setScissor=function(M,B,re,j){M.isVector4?Ce.set(M.x,M.y,M.z,M.w):Ce.set(M,B,re,j),x.scissor(ue.copy(Ce).multiplyScalar(ne).round())},this.getScissorTest=function(){return qe},this.setScissorTest=function(M){x.setScissorTest(qe=M)},this.setOpaqueSort=function(M){ye=M},this.setTransparentSort=function(M){Pe=M},this.getClearColor=function(M){return M.copy(ge.getClearColor())},this.setClearColor=function(){ge.setClearColor(...arguments)},this.getClearAlpha=function(){return ge.getClearAlpha()},this.setClearAlpha=function(){ge.setClearAlpha(...arguments)},this.clear=function(M=!0,B=!0,re=!0){let j=0;if(M){let Q=!1;if(ce!==null){let Te=ce.texture.format;Q=m.has(Te)}if(Q){let Te=ce.texture.type,Re=p.has(Te),we=ge.getClearColor(),Le=ge.getClearAlpha(),Fe=we.r,$e=we.g,et=we.b;Re?(w[0]=Fe,w[1]=$e,w[2]=et,w[3]=Le,O.clearBufferuiv(O.COLOR,0,w)):(T[0]=Fe,T[1]=$e,T[2]=et,T[3]=Le,O.clearBufferiv(O.COLOR,0,T))}else j|=O.COLOR_BUFFER_BIT}B&&(j|=O.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),re&&(j|=O.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),j!==0&&O.clear(j)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(M){M.setRenderer(this),P=M},this.dispose=function(){t.removeEventListener("webglcontextlost",it,!1),t.removeEventListener("webglcontextrestored",at,!1),t.removeEventListener("webglcontextcreationerror",Dn,!1),ge.dispose(),ie.dispose(),ee.dispose(),K.dispose(),A.dispose(),$.dispose(),be.dispose(),me.dispose(),ae.dispose(),Ie.dispose(),Ie.removeEventListener("sessionstart",kh),Ie.removeEventListener("sessionend",Hh),ki.stop()};function it(M){M.preventDefault(),Wc("WebGLRenderer: Context Lost."),N=!0}function at(){Wc("WebGLRenderer: Context Restored."),N=!1;let M=z.autoReset,B=he.enabled,re=he.autoUpdate,j=he.needsUpdate,Q=he.type;Ne(),z.autoReset=M,he.enabled=B,he.autoUpdate=re,he.needsUpdate=j,he.type=Q}function Dn(M){Ve("WebGLRenderer: A WebGL context could not be created. Reason: ",M.statusMessage)}function Wn(M){let B=M.target;B.removeEventListener("dispose",Wn),Nf(B)}function Nf(M){Ff(M),K.remove(M)}function Ff(M){let B=K.get(M).programs;B!==void 0&&(B.forEach(function(re){ae.releaseProgram(re)}),M.isShaderMaterial&&ae.releaseShaderCache(M))}this.renderBufferDirect=function(M,B,re,j,Q,Te){B===null&&(B=Et);let Re=Q.isMesh&&Q.matrixWorld.determinantAffine()<0,we=kf(M,B,re,j,Q);x.setMaterial(j,Re);let Le=re.index,Fe=1;if(j.wireframe===!0){if(Le=V.getWireframeAttribute(re),Le===void 0)return;Fe=2}let $e=re.drawRange,et=re.attributes.position,Ue=$e.start*Fe,ot=($e.start+$e.count)*Fe;Te!==null&&(Ue=Math.max(Ue,Te.start*Fe),ot=Math.min(ot,(Te.start+Te.count)*Fe)),Le!==null?(Ue=Math.max(Ue,0),ot=Math.min(ot,Le.count)):et!=null&&(Ue=Math.max(Ue,0),ot=Math.min(ot,et.count));let Pt=ot-Ue;if(Pt<0||Pt===1/0)return;be.setup(Q,j,we,re,Le);let vt,mt=fe;if(Le!==null&&(vt=k.get(Le),mt=te,mt.setIndex(vt)),Q.isMesh)j.wireframe===!0?(x.setLineWidth(j.wireframeLinewidth*ht()),mt.setMode(O.LINES)):mt.setMode(O.TRIANGLES);else if(Q.isLine){let jt=j.linewidth;jt===void 0&&(jt=1),x.setLineWidth(jt*ht()),Q.isLineSegments?mt.setMode(O.LINES):Q.isLineLoop?mt.setMode(O.LINE_LOOP):mt.setMode(O.LINE_STRIP)}else Q.isPoints?mt.setMode(O.POINTS):Q.isSprite&&mt.setMode(O.TRIANGLES);if(Q.isBatchedMesh)if(xe.get("WEBGL_multi_draw"))mt.renderMultiDraw(Q._multiDrawStarts,Q._multiDrawCounts,Q._multiDrawCount);else{let jt=Q._multiDrawStarts,Ae=Q._multiDrawCounts,on=Q._multiDrawCount,rt=Le?k.get(Le).bytesPerElement:1,Tn=K.get(j).currentProgram.getUniforms();for(let Xn=0;Xn<on;Xn++)Tn.setValue(O,"_gl_DrawID",Xn),mt.render(jt[Xn]/rt,Ae[Xn])}else if(Q.isInstancedMesh)mt.renderInstances(Ue,Pt,Q.count);else if(re.isInstancedBufferGeometry){let jt=re._maxInstanceCount!==void 0?re._maxInstanceCount:1/0,Ae=Math.min(re.instanceCount,jt);mt.renderInstances(Ue,Pt,Ae)}else mt.render(Ue,Pt)};function Bh(M,B,re,j){P!==null&&M.isNodeMaterial&&P.setObject(j,M),ze===!0&&Z.setState(M,re,!1),M.transparent===!0&&M.side===Ft&&M.forceSinglePass===!1?(M.side=Nt,M.needsUpdate=!0,la(M,B,j),M.side=Jn,M.needsUpdate=!0,la(M,B,j),M.side=Ft):la(M,B,j)}this.compile=function(M,B,re=null){re===null&&(re=M),P!==null&&P.renderStart(M,B,re),S=ee.get(re),S.init(B),_.push(S),re.traverseVisible(function(Q){Q.isLight&&Q.layers.test(B.layers)&&(S.pushLight(Q),Q.castShadow&&S.pushShadow(Q))}),M!==re&&M.traverseVisible(function(Q){Q.isLight&&Q.layers.test(B.layers)&&(S.pushLight(Q),Q.castShadow&&S.pushShadow(Q))}),S.setupLights(),P!==null&&P.updateLights(S.state.lightsArray),Xe=this.localClippingEnabled,ze=Z.init(this.clippingPlanes,Xe),ze===!0&&Z.setGlobalState(this.clippingPlanes,B),P!==null&&he.render(S.state.shadowsArray,re,B);let j=new Set;return M.traverse(function(Q){if(!(Q.isMesh||Q.isPoints||Q.isLine||Q.isSprite))return;let Te=Q.material;if(Te)if(Array.isArray(Te))for(let Re=0;Re<Te.length;Re++){let we=Te[Re];Bh(we,re,B,Q),j.add(we)}else Bh(Te,re,B,Q),j.add(Te)}),S=_.pop(),P!==null&&P.renderEnd(),j},this.compileAsync=function(M,B,re=null){let j=this.compile(M,B,re);return new Promise(Q=>{function Te(){if(j.forEach(function(Re){let Le=K.get(Re).currentProgram;(Le===void 0||Le.isReady())&&j.delete(Re)}),j.size===0){Q(M);return}setTimeout(Te,10)}xe.get("KHR_parallel_shader_compile")!==null?Te():setTimeout(Te,10)})};let kl=null;function Of(M){kl&&kl(M)}function kh(){ki.stop()}function Hh(){ki.start()}let ki=new Ad;ki.setAnimationLoop(Of),typeof self<"u"&&ki.setContext(self),this.setAnimationLoop=function(M){kl=M,Ie.setAnimationLoop(M),M===null?ki.stop():ki.start()},Ie.addEventListener("sessionstart",kh),Ie.addEventListener("sessionend",Hh),this.render=function(M,B){if(B!==void 0&&B.isCamera!==!0){Ve("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(N===!0)return;P!==null&&P.renderStart(M,B);let re=Ie.enabled===!0&&Ie.isPresenting===!0,j=E!==null&&(ce===null||re)&&E.begin(I,ce);if(M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),B.parent===null&&B.matrixWorldAutoUpdate===!0&&B.updateMatrixWorld(),Ie.enabled===!0&&Ie.isPresenting===!0&&(E===null||E.isCompositing()===!1)&&(Ie.cameraAutoUpdate===!0&&Ie.updateCamera(B),B=Ie.getCamera()),M.isScene===!0&&M.onBeforeRender(I,M,B,ce),S=ee.get(M,_.length),S.init(B),S.state.textureUnits=se.getTextureUnits(),_.push(S),ke.multiplyMatrices(B.projectionMatrix,B.matrixWorldInverse),Be.setFromProjectionMatrix(ke,kn,B.reversedDepth),Xe=this.localClippingEnabled,ze=Z.init(this.clippingPlanes,Xe),b=ie.get(M,C.length),b.init(),C.push(b),Ie.enabled===!0&&Ie.isPresenting===!0){let Re=I.xr.getDepthSensingMesh();Re!==null&&Hl(Re,B,-1/0,I.sortObjects)}Hl(M,B,0,I.sortObjects),b.finish(),P!==null&&P.updateLights(S.state.lightsArray),I.sortObjects===!0&&b.sort(ye,Pe),pt=Ie.enabled===!1||Ie.isPresenting===!1||Ie.hasDepthSensing()===!1,pt&&ge.addToRenderList(b,M),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),ze===!0&&Z.beginShadows();let Q=S.state.shadowsArray;if(he.render(Q,M,B),ze===!0&&Z.endShadows(),(j&&E.hasRenderPass())===!1){let Re=b.opaque,we=b.transmissive;if(S.setupLights(),B.isArrayCamera){let Le=B.cameras;if(we.length>0)for(let Fe=0,$e=Le.length;Fe<$e;Fe++){let et=Le[Fe];Vh(Re,we,M,et)}pt&&ge.render(M);for(let Fe=0,$e=Le.length;Fe<$e;Fe++){let et=Le[Fe];zh(b,M,et,et.viewport)}}else we.length>0&&Vh(Re,we,M,B),pt&&ge.render(M),zh(b,M,B)}ce!==null&&Y===0&&(se.updateMultisampleRenderTarget(ce),se.updateRenderTargetMipmap(ce)),j&&E.end(I),M.isScene===!0&&M.onAfterRender(I,M,B),be.resetDefaultState(),G=-1,J=null,_.pop(),_.length>0?(S=_[_.length-1],se.setTextureUnits(S.state.textureUnits),ze===!0&&Z.setGlobalState(I.clippingPlanes,S.state.camera)):S=null,C.pop(),C.length>0?b=C[C.length-1]:b=null,P!==null&&P.renderEnd()};function Hl(M,B,re,j){if(M.visible===!1)return;if(M.layers.test(B.layers)){if(M.isGroup)re=M.renderOrder;else if(M.isLOD)M.autoUpdate===!0&&M.update(B);else if(M.isLightProbeGrid)S.pushLightProbeGrid(M);else if(M.isLight)S.pushLight(M),M.castShadow&&S.pushShadow(M);else if(M.isSprite){if(!M.frustumCulled||M.intersectsFrustum(Be)){j&&gt.setFromMatrixPosition(M.matrixWorld).applyMatrix4(ke);let Re=$.update(M),we=M.material;we.visible&&b.push(M,Re,we,re,gt.z,null,B)}}else if((M.isMesh||M.isLine||M.isPoints)&&(!M.frustumCulled||M.intersectsFrustum(Be))){let Re=$.update(M),we=M.material;if(j&&(M.boundingSphere!==void 0?(M.boundingSphere===null&&M.computeBoundingSphere(),gt.copy(M.boundingSphere.center)):(Re.boundingSphere===null&&Re.computeBoundingSphere(),gt.copy(Re.boundingSphere.center)),gt.applyMatrix4(M.matrixWorld).applyMatrix4(ke)),Array.isArray(we)){let Le=Re.groups;for(let Fe=0,$e=Le.length;Fe<$e;Fe++){let et=Le[Fe],Ue=we[et.materialIndex];Ue&&Ue.visible&&b.push(M,Re,Ue,re,gt.z,et,B)}}else we.visible&&b.push(M,Re,we,re,gt.z,null,B)}}let Te=M.children;for(let Re=0,we=Te.length;Re<we;Re++)Hl(Te[Re],B,re,j)}function zh(M,B,re,j){let{opaque:Q,transmissive:Te,transparent:Re}=M;S.setupLightsView(re),ze===!0&&Z.setGlobalState(I.clippingPlanes,re),j&&x.viewport(W.copy(j)),Q.length>0&&oa(Q,B,re),Te.length>0&&oa(Te,B,re),Re.length>0&&oa(Re,B,re),x.buffers.depth.setTest(!0),x.buffers.depth.setMask(!0),x.buffers.color.setMask(!0),x.setPolygonOffset(!1)}function Vh(M,B,re,j){if((re.isScene===!0?re.overrideMaterial:null)!==null)return;if(S.state.transmissionRenderTarget[j.id]===void 0){let Ue=xe.has("EXT_color_buffer_half_float")||xe.has("EXT_color_buffer_float");S.state.transmissionRenderTarget[j.id]=new qt(1,1,{generateMipmaps:!0,type:Ue?Vn:Wt,minFilter:jn,samples:Math.max(4,R.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:Je.workingColorSpace})}let Te=S.state.transmissionRenderTarget[j.id],Re=j.viewport||W;Te.setSize(Re.z*I.transmissionResolutionScale,Re.w*I.transmissionResolutionScale);let we=I.getRenderTarget(),Le=I.getActiveCubeFace(),Fe=I.getActiveMipmapLevel();I.setRenderTarget(Te),I.getClearColor(Me),Se=I.getClearAlpha(),Se<1&&I.setClearColor(16777215,.5),I.clear(),pt&&ge.render(re);let $e=I.toneMapping;I.toneMapping=Sn;let et=j.viewport;if(j.viewport!==void 0&&(j.viewport=void 0),S.setupLightsView(j),ze===!0&&Z.setGlobalState(I.clippingPlanes,j),oa(M,re,j),se.updateMultisampleRenderTarget(Te),se.updateRenderTargetMipmap(Te),xe.has("WEBGL_multisampled_render_to_texture")===!1){let Ue=!1;for(let ot=0,Pt=B.length;ot<Pt;ot++){let vt=B[ot],{object:mt,geometry:jt,material:Ae,group:on}=vt;if(Ae.side===Ft&&mt.layers.test(j.layers)){let rt=Ae.side;Ae.side=Nt,Ae.needsUpdate=!0,Gh(mt,re,j,jt,Ae,on),Ae.side=rt,Ae.needsUpdate=!0,Ue=!0}}Ue===!0&&(se.updateMultisampleRenderTarget(Te),se.updateRenderTargetMipmap(Te))}I.setRenderTarget(we,Le,Fe),I.setClearColor(Me,Se),et!==void 0&&(j.viewport=et),I.toneMapping=$e}function oa(M,B,re){let j=B.isScene===!0?B.overrideMaterial:null;for(let Q=0,Te=M.length;Q<Te;Q++){let Re=M[Q],{object:we,geometry:Le,group:Fe}=Re,$e=Re.material;$e.allowOverride===!0&&j!==null&&($e=j),we.layers.test(re.layers)&&Gh(we,B,re,Le,$e,Fe)}}function Gh(M,B,re,j,Q,Te){P!==null&&Q.isNodeMaterial&&P.setObject(M,Q),M.onBeforeRender(I,B,re,j,Q,Te),M.modelViewMatrix.multiplyMatrices(re.matrixWorldInverse,M.matrixWorld),M.normalMatrix.getNormalMatrix(M.modelViewMatrix),Q.onBeforeRender(I,B,re,j,M,Te),Q.transparent===!0&&Q.side===Ft&&Q.forceSinglePass===!1?(Q.side=Nt,Q.needsUpdate=!0,I.renderBufferDirect(re,B,j,Q,M,Te),Q.side=Jn,Q.needsUpdate=!0,I.renderBufferDirect(re,B,j,Q,M,Te),Q.side=Ft):I.renderBufferDirect(re,B,j,Q,M,Te),M.onAfterRender(I,B,re,j,Q,Te)}function la(M,B,re){B.isScene!==!0&&(B=Et);let j=K.get(M),Q=S.state.lights,Te=S.state.shadowsArray,Re=Q.state.version,we=ae.getParameters(M,Q.state,Te,B,re,S.state.lightProbeGridArray),Le=ae.getProgramCacheKey(we),Fe=j.programs;j.environment=M.isMeshStandardMaterial||M.isMeshLambertMaterial||M.isMeshPhongMaterial?B.environment:null,j.fog=B.fog;let $e=M.isMeshStandardMaterial||M.isMeshLambertMaterial&&!M.envMap||M.isMeshPhongMaterial&&!M.envMap;j.envMap=A.get(M.envMap||j.environment,$e),j.envMapRotation=j.environment!==null&&M.envMap===null?B.environmentRotation:M.envMapRotation,Fe===void 0&&(M.addEventListener("dispose",Wn),Fe=new Map,j.programs=Fe);let et=Fe.get(Le);if(et!==void 0){if(j.currentProgram===et&&j.lightsStateVersion===Re)return Xh(M,we),et}else we.uniforms=ae.getUniforms(M),P!==null&&M.isNodeMaterial&&P.build(M,re,we),M.onBeforeCompile(we,I),et=ae.acquireProgram(we,Le),Fe.set(Le,et),j.uniforms=we.uniforms;let Ue=j.uniforms;return(!M.isShaderMaterial&&!M.isRawShaderMaterial||M.clipping===!0)&&(Ue.clippingPlanes=Z.uniform),Xh(M,we),j.needsLights=zf(M),j.lightsStateVersion=Re,j.needsLights&&(Ue.ambientLightColor.value=Q.state.ambient,Ue.lightProbe.value=Q.state.probe,Ue.sunLights.value=Q.state.sun,Ue.sunLightShadows.value=Q.state.sunShadow,Ue.directionalLights.value=Q.state.directional,Ue.directionalLightShadows.value=Q.state.directionalShadow,Ue.spotLights.value=Q.state.spot,Ue.spotLightShadows.value=Q.state.spotShadow,Ue.rectAreaLights.value=Q.state.rectArea,Ue.ltc_1.value=Q.state.rectAreaLTC1,Ue.ltc_2.value=Q.state.rectAreaLTC2,Ue.pointLights.value=Q.state.point,Ue.pointLightShadows.value=Q.state.pointShadow,Ue.hemisphereLights.value=Q.state.hemi,Ue.sunShadowMatrix.value=Q.state.sunShadowMatrix,Ue.sunShadowCascade.value=Q.state.sunShadowCascade,Ue.directionalShadowMatrix.value=Q.state.directionalShadowMatrix,Ue.spotLightMatrix.value=Q.state.spotLightMatrix,Ue.spotLightMap.value=Q.state.spotLightMap,Ue.pointShadowMatrix.value=Q.state.pointShadowMatrix),j.lightProbeGrid=S.state.lightProbeGridArray.length>0,j.currentProgram=et,j.uniformsList=null,et}function Wh(M){if(M.uniformsList===null){let B=M.currentProgram.getUniforms();M.uniformsList=Vr.seqWithValue(B.seq,M.uniforms)}return M.uniformsList}function Xh(M,B){let re=K.get(M);re.outputColorSpace=B.outputColorSpace,re.batching=B.batching,re.batchingColor=B.batchingColor,re.instancing=B.instancing,re.instancingColor=B.instancingColor,re.instancingMorph=B.instancingMorph,re.skinning=B.skinning,re.morphTargets=B.morphTargets,re.morphNormals=B.morphNormals,re.morphColors=B.morphColors,re.morphTargetsCount=B.morphTargetsCount,re.numClippingPlanes=B.numClippingPlanes,re.numIntersection=B.numClipIntersection,re.vertexAlphas=B.vertexAlphas,re.vertexTangents=B.vertexTangents,re.toneMapping=B.toneMapping}function Bf(M,B){if(M.length===0)return null;if(M.length===1)return M[0].texture!==null?M[0]:null;y.setFromMatrixPosition(B.matrixWorld);for(let re=0,j=M.length;re<j;re++){let Q=M[re];if(Q.texture!==null&&Q.boundingBox.containsPoint(y))return Q}return null}function kf(M,B,re,j,Q){B.isScene!==!0&&(B=Et),se.resetTextureUnits();let Te=B.fog,Re=j.isMeshStandardMaterial||j.isMeshLambertMaterial||j.isMeshPhongMaterial?B.environment:null,we=ce===null?I.outputColorSpace:ce.isXRRenderTarget===!0?ce.texture.colorSpace:Je.workingColorSpace,Le=j.isMeshStandardMaterial||j.isMeshLambertMaterial&&!j.envMap||j.isMeshPhongMaterial&&!j.envMap,Fe=A.get(j.envMap||Re,Le),$e=j.vertexColors===!0&&!!re.attributes.color&&re.attributes.color.itemSize===4,et=!!re.attributes.tangent&&(!!j.normalMap||j.anisotropy>0),Ue=!!re.morphAttributes.position,ot=!!re.morphAttributes.normal,Pt=!!re.morphAttributes.color,vt=Sn;j.toneMapped&&(ce===null||ce.isXRRenderTarget===!0)&&(vt=I.toneMapping);let mt=re.morphAttributes.position||re.morphAttributes.normal||re.morphAttributes.color,jt=mt!==void 0?mt.length:0,Ae=K.get(j),on=S.state.lights;if(ze===!0&&(Xe===!0||M!==J)){let xt=M===J&&j.id===G;Z.setState(j,M,xt)}let rt=!1;j.version===Ae.__version?(Ae.needsLights&&Ae.lightsStateVersion!==on.state.version||Ae.outputColorSpace!==we||Q.isBatchedMesh&&Ae.batching===!1||!Q.isBatchedMesh&&Ae.batching===!0||Q.isBatchedMesh&&Ae.batchingColor===!0&&Q._colorsTexture===null||Q.isBatchedMesh&&Ae.batchingColor===!1&&Q._colorsTexture!==null||Q.isInstancedMesh&&Ae.instancing===!1||!Q.isInstancedMesh&&Ae.instancing===!0||Q.isSkinnedMesh&&Ae.skinning===!1||!Q.isSkinnedMesh&&Ae.skinning===!0||Q.isInstancedMesh&&Ae.instancingColor===!0&&Q.instanceColor===null||Q.isInstancedMesh&&Ae.instancingColor===!1&&Q.instanceColor!==null||Q.isInstancedMesh&&Ae.instancingMorph===!0&&Q.morphTexture===null||Q.isInstancedMesh&&Ae.instancingMorph===!1&&Q.morphTexture!==null||Ae.envMap!==Fe||j.fog===!0&&Ae.fog!==Te||Ae.numClippingPlanes!==void 0&&(Ae.numClippingPlanes!==Z.numPlanes||Ae.numIntersection!==Z.numIntersection)||Ae.vertexAlphas!==$e||Ae.vertexTangents!==et||Ae.morphTargets!==Ue||Ae.morphNormals!==ot||Ae.morphColors!==Pt||Ae.toneMapping!==vt||Ae.morphTargetsCount!==jt||!!Ae.lightProbeGrid!=S.state.lightProbeGridArray.length>0)&&(rt=!0):(rt=!0,Ae.__version=j.version);let Tn=Ae.currentProgram;rt===!0&&(Tn=la(j,B,Q),P&&j.isNodeMaterial&&P.onUpdateProgram(j,Tn,Ae));let Xn=!1,pi=!1,cr=!1,dt=Tn.getUniforms(),At=Ae.uniforms;if(x.useProgram(Tn.program)&&(Xn=!0,pi=!0,cr=!0),j.id!==G&&(G=j.id,pi=!0),Ae.needsLights){let xt=Bf(S.state.lightProbeGridArray,Q);Ae.lightProbeGrid!==xt&&(Ae.lightProbeGrid=xt,pi=!0)}if(Xn||J!==M){x.buffers.depth.getReversed()&&M.reversedDepth!==!0&&(M._reversedDepth=!0,M.updateProjectionMatrix()),dt.setValue(O,"projectionMatrix",M.projectionMatrix),dt.setValue(O,"viewMatrix",M.matrixWorldInverse);let gi=dt.map.cameraPosition;gi!==void 0&&gi.setValue(O,Qe.setFromMatrixPosition(M.matrixWorld)),R.logarithmicDepthBuffer&&dt.setValue(O,"logDepthBufFC",2/(Math.log(M.far+1)/Math.LN2)),(j.isMeshPhongMaterial||j.isMeshToonMaterial||j.isMeshLambertMaterial||j.isMeshBasicMaterial||j.isMeshStandardMaterial||j.isShaderMaterial)&&dt.setValue(O,"isOrthographic",M.isOrthographicCamera===!0),J!==M&&(J=M,pi=!0,cr=!0)}if(Ae.needsLights&&(on.state.sunShadowMap.length>0&&dt.setValue(O,"sunShadowMap",on.state.sunShadowMap,se),on.state.directionalShadowMap.length>0&&dt.setValue(O,"directionalShadowMap",on.state.directionalShadowMap,se),on.state.spotShadowMap.length>0&&dt.setValue(O,"spotShadowMap",on.state.spotShadowMap,se),on.state.pointShadowMap.length>0&&dt.setValue(O,"pointShadowMap",on.state.pointShadowMap,se)),Q.isSkinnedMesh){dt.setOptional(O,Q,"bindMatrix"),dt.setOptional(O,Q,"bindMatrixInverse");let xt=Q.skeleton;xt&&(xt.boneTexture===null&&xt.computeBoneTexture(),dt.setValue(O,"boneTexture",xt.boneTexture,se))}Q.isBatchedMesh&&(dt.setOptional(O,Q,"batchingTexture"),dt.setValue(O,"batchingTexture",Q._matricesTexture,se),dt.setOptional(O,Q,"batchingIdTexture"),dt.setValue(O,"batchingIdTexture",Q._indirectTexture,se),dt.setOptional(O,Q,"batchingColorTexture"),Q._colorsTexture!==null&&dt.setValue(O,"batchingColorTexture",Q._colorsTexture,se));let mi=re.morphAttributes;if((mi.position!==void 0||mi.normal!==void 0||mi.color!==void 0)&&L.update(Q,re,Tn),(pi||Ae.receiveShadow!==Q.receiveShadow)&&(Ae.receiveShadow=Q.receiveShadow,dt.setValue(O,"receiveShadow",Q.receiveShadow)),(j.isMeshStandardMaterial||j.isMeshLambertMaterial||j.isMeshPhongMaterial)&&j.envMap===null&&B.environment!==null&&(At.envMapIntensity.value=B.environmentIntensity),At.dfgLUT!==void 0&&(At.dfgLUT.value=b_()),pi){if(dt.setValue(O,"toneMappingExposure",I.toneMappingExposure),Ae.needsLights&&Hf(At,cr),Te&&j.fog===!0&&le.refreshFogUniforms(At,Te),le.refreshMaterialUniforms(At,j,ne,X,S.state.transmissionRenderTarget[M.id]),Ae.needsLights&&Ae.lightProbeGrid){let xt=Ae.lightProbeGrid;At.probesSH.value=xt.texture,At.probesMin.value.copy(xt.boundingBox.min),At.probesMax.value.copy(xt.boundingBox.max),At.probesResolution.value.copy(xt.resolution)}Vr.upload(O,Wh(Ae),At,se)}if(j.isShaderMaterial&&j.uniformsNeedUpdate===!0&&(Vr.upload(O,Wh(Ae),At,se),j.uniformsNeedUpdate=!1),j.isSpriteMaterial&&dt.setValue(O,"center",Q.center),dt.setValue(O,"modelViewMatrix",Q.modelViewMatrix),dt.setValue(O,"normalMatrix",Q.normalMatrix),dt.setValue(O,"modelMatrix",Q.matrixWorld),j.uniformsGroups!==void 0){let xt=j.uniformsGroups;for(let gi=0,hr=xt.length;gi<hr;gi++){let Yh=xt[gi];me.update(Yh,Tn),me.bind(Yh,Tn)}}return Tn}function Hf(M,B){M.ambientLightColor.needsUpdate=B,M.lightProbe.needsUpdate=B,M.sunLights.needsUpdate=B,M.sunLightShadows.needsUpdate=B,M.directionalLights.needsUpdate=B,M.directionalLightShadows.needsUpdate=B,M.pointLights.needsUpdate=B,M.pointLightShadows.needsUpdate=B,M.spotLights.needsUpdate=B,M.spotLightShadows.needsUpdate=B,M.rectAreaLights.needsUpdate=B,M.hemisphereLights.needsUpdate=B}function zf(M){return M.isMeshLambertMaterial||M.isMeshToonMaterial||M.isMeshPhongMaterial||M.isMeshStandardMaterial||M.isShadowMaterial||M.isShaderMaterial&&M.lights===!0}this.getActiveCubeFace=function(){return q},this.getActiveMipmapLevel=function(){return Y},this.getRenderTarget=function(){return ce},this.setRenderTargetTextures=function(M,B,re){let j=K.get(M);j.__autoAllocateDepthBuffer=M.resolveDepthBuffer===!1,j.__autoAllocateDepthBuffer===!1&&(j.__useRenderToTexture=!1),K.get(M.texture).__webglTexture=B,K.get(M.depthTexture).__webglTexture=j.__autoAllocateDepthBuffer?void 0:re,j.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(M,B){let re=K.get(M);re.__webglFramebuffer=B,re.__useDefaultFramebuffer=B===void 0},this.setRenderTarget=function(M,B=0,re=0){ce=M,q=B,Y=re;let j=null,Q=!1,Te=!1;if(M){let we=K.get(M);if(we.__useDefaultFramebuffer!==void 0){x.bindFramebuffer(O.FRAMEBUFFER,we.__webglFramebuffer),W.copy(M.viewport),ue.copy(M.scissor),pe=M.scissorTest,x.viewport(W),x.scissor(ue),x.setScissorTest(pe),G=-1;return}else if(we.__webglFramebuffer===void 0)se.setupRenderTarget(M);else if(we.__hasExternalTextures)se.rebindTextures(M,K.get(M.texture).__webglTexture,K.get(M.depthTexture).__webglTexture);else if(M.depthBuffer){let $e=M.depthTexture;if(we.__boundDepthTexture!==$e){if($e!==null&&K.has($e)&&(M.width!==$e.image.width||M.height!==$e.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");se.setupDepthRenderbuffer(M)}}let Le=M.texture;(Le.isData3DTexture||Le.isDataArrayTexture||Le.isCompressedArrayTexture)&&(Te=!0);let Fe=K.get(M).__webglFramebuffer;M.isWebGLCubeRenderTarget?(Array.isArray(Fe[B])?j=Fe[B][re]:j=Fe[B],Q=!0):M.samples>0&&se.useMultisampledRTT(M)===!1?j=K.get(M).__webglMultisampledFramebuffer:Array.isArray(Fe)?j=Fe[re]:j=Fe,W.copy(M.viewport),ue.copy(M.scissor),pe=M.scissorTest}else W.copy(_e).multiplyScalar(ne).floor(),ue.copy(Ce).multiplyScalar(ne).floor(),pe=qe;if(re!==0&&(j=F),x.bindFramebuffer(O.FRAMEBUFFER,j)&&x.drawBuffers(M,j),x.viewport(W),x.scissor(ue),x.setScissorTest(pe),Q){let we=K.get(M.texture);O.framebufferTexture2D(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_CUBE_MAP_POSITIVE_X+B,we.__webglTexture,re)}else if(Te){let we=B;for(let Le=0;Le<M.textures.length;Le++){let Fe=K.get(M.textures[Le]);O.framebufferTextureLayer(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0+Le,Fe.__webglTexture,re,we)}}else if(M!==null&&re!==0){let we=K.get(M.texture);O.framebufferTexture2D(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,we.__webglTexture,re)}G=-1};function qh(M){let B=K.get(M);return(B.__readFormat!==M.format||B.__readType!==M.type)&&(B.__readFormat=M.format,B.__readType=M.type,B.__formatReadable=R.textureFormatReadable(M.format),B.__typeReadable=R.textureTypeReadable(M.type)),B}this.readRenderTargetPixels=function(M,B,re,j,Q,Te,Re,we=0){if(!(M&&M.isWebGLRenderTarget)){Ve("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Le=K.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&Re!==void 0&&(Le=Le[Re]),Le){x.bindFramebuffer(O.FRAMEBUFFER,Le);try{let Fe=M.textures[we],$e=Fe.format,et=Fe.type;M.textures.length>1&&O.readBuffer(O.COLOR_ATTACHMENT0+we);let Ue=qh(Fe);if(Ue.__formatReadable===!1){Ve("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(Ue.__typeReadable===!1){Ve("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}B>=0&&B<=M.width-j&&re>=0&&re<=M.height-Q&&O.readPixels(B,re,j,Q,ve.convert($e),ve.convert(et),Te)}finally{let Fe=ce!==null?K.get(ce).__webglFramebuffer:null;x.bindFramebuffer(O.FRAMEBUFFER,Fe)}}},this.readRenderTargetPixelsAsync=async function(M,B,re,j,Q,Te,Re,we=0){if(!(M&&M.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Le=K.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&Re!==void 0&&(Le=Le[Re]),Le)if(B>=0&&B<=M.width-j&&re>=0&&re<=M.height-Q){x.bindFramebuffer(O.FRAMEBUFFER,Le);let Fe=M.textures[we],$e=Fe.format,et=Fe.type;M.textures.length>1&&O.readBuffer(O.COLOR_ATTACHMENT0+we);let Ue=qh(Fe);if(Ue.__formatReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(Ue.__typeReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let ot=O.createBuffer();O.bindBuffer(O.PIXEL_PACK_BUFFER,ot),O.bufferData(O.PIXEL_PACK_BUFFER,Te.byteLength,O.STREAM_READ),O.readPixels(B,re,j,Q,ve.convert($e),ve.convert(et),0),O.bindBuffer(O.PIXEL_PACK_BUFFER,null);let Pt=ce!==null?K.get(ce).__webglFramebuffer:null;x.bindFramebuffer(O.FRAMEBUFFER,Pt);let vt=O.fenceSync(O.SYNC_GPU_COMMANDS_COMPLETE,0);return O.flush(),await ed(O,vt,4),O.bindBuffer(O.PIXEL_PACK_BUFFER,ot),O.getBufferSubData(O.PIXEL_PACK_BUFFER,0,Te),O.bindBuffer(O.PIXEL_PACK_BUFFER,null),O.deleteBuffer(ot),O.deleteSync(vt),Te}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(M,B=null,re=0){let j=Math.pow(2,-re),Q=Math.floor(M.image.width*j),Te=Math.floor(M.image.height*j),Re=B!==null?B.x:0,we=B!==null?B.y:0;se.setTexture2D(M,0),O.copyTexSubImage2D(O.TEXTURE_2D,re,0,0,Re,we,Q,Te),x.unbindTexture()},this.copyTextureToTexture=function(M,B,re=null,j=null,Q=0,Te=0){let Re,we,Le,Fe,$e,et,Ue,ot,Pt,vt=M.isCompressedTexture?M.mipmaps[Te]:M.image;if(re!==null)Re=re.max.x-re.min.x,we=re.max.y-re.min.y,Le=re.isBox3?re.max.z-re.min.z:1,Fe=re.min.x,$e=re.min.y,et=re.isBox3?re.min.z:0;else{let At=Math.pow(2,-Q);Re=Math.floor(vt.width*At),we=Math.floor(vt.height*At),M.isDataArrayTexture?Le=vt.depth:M.isData3DTexture?Le=Math.floor(vt.depth*At):Le=1,Fe=0,$e=0,et=0}j!==null?(Ue=j.x,ot=j.y,Pt=j.z):(Ue=0,ot=0,Pt=0);let mt=ve.convert(B.format),jt=ve.convert(B.type),Ae;B.isData3DTexture?(se.setTexture3D(B,0),Ae=O.TEXTURE_3D):B.isDataArrayTexture||B.isCompressedArrayTexture?(se.setTexture2DArray(B,0),Ae=O.TEXTURE_2D_ARRAY):(se.setTexture2D(B,0),Ae=O.TEXTURE_2D),x.activeTexture(O.TEXTURE0),x.pixelStorei(O.UNPACK_FLIP_Y_WEBGL,B.flipY),x.pixelStorei(O.UNPACK_PREMULTIPLY_ALPHA_WEBGL,B.premultiplyAlpha),x.pixelStorei(O.UNPACK_ALIGNMENT,B.unpackAlignment);let on=x.getParameter(O.UNPACK_ROW_LENGTH),rt=x.getParameter(O.UNPACK_IMAGE_HEIGHT),Tn=x.getParameter(O.UNPACK_SKIP_PIXELS),Xn=x.getParameter(O.UNPACK_SKIP_ROWS),pi=x.getParameter(O.UNPACK_SKIP_IMAGES);x.pixelStorei(O.UNPACK_ROW_LENGTH,vt.width),x.pixelStorei(O.UNPACK_IMAGE_HEIGHT,vt.height),x.pixelStorei(O.UNPACK_SKIP_PIXELS,Fe),x.pixelStorei(O.UNPACK_SKIP_ROWS,$e),x.pixelStorei(O.UNPACK_SKIP_IMAGES,et);let cr=M.isDataArrayTexture||M.isData3DTexture,dt=B.isDataArrayTexture||B.isData3DTexture;if(M.isDepthTexture){let At=K.get(M),mi=K.get(B),xt=K.get(At.__renderTarget),gi=K.get(mi.__renderTarget);x.bindFramebuffer(O.READ_FRAMEBUFFER,xt.__webglFramebuffer),x.bindFramebuffer(O.DRAW_FRAMEBUFFER,gi.__webglFramebuffer);for(let hr=0;hr<Le;hr++)cr&&(O.framebufferTextureLayer(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,K.get(M).__webglTexture,Q,et+hr),O.framebufferTextureLayer(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,K.get(B).__webglTexture,Te,Pt+hr)),O.blitFramebuffer(Fe,$e,Re,we,Ue,ot,Re,we,O.DEPTH_BUFFER_BIT,O.NEAREST);x.bindFramebuffer(O.READ_FRAMEBUFFER,null),x.bindFramebuffer(O.DRAW_FRAMEBUFFER,null)}else if(Q!==0||M.isRenderTargetTexture||K.has(M)){let At=K.get(M),mi=K.get(B);x.bindFramebuffer(O.READ_FRAMEBUFFER,U),x.bindFramebuffer(O.DRAW_FRAMEBUFFER,H);for(let xt=0;xt<Le;xt++)cr?O.framebufferTextureLayer(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,At.__webglTexture,Q,et+xt):O.framebufferTexture2D(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,At.__webglTexture,Q),dt?O.framebufferTextureLayer(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,mi.__webglTexture,Te,Pt+xt):O.framebufferTexture2D(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,mi.__webglTexture,Te),Q!==0?O.blitFramebuffer(Fe,$e,Re,we,Ue,ot,Re,we,O.COLOR_BUFFER_BIT,O.NEAREST):dt?O.copyTexSubImage3D(Ae,Te,Ue,ot,Pt+xt,Fe,$e,Re,we):O.copyTexSubImage2D(Ae,Te,Ue,ot,Fe,$e,Re,we);x.bindFramebuffer(O.READ_FRAMEBUFFER,null),x.bindFramebuffer(O.DRAW_FRAMEBUFFER,null)}else dt?M.isDataTexture||M.isData3DTexture?O.texSubImage3D(Ae,Te,Ue,ot,Pt,Re,we,Le,mt,jt,vt.data):B.isCompressedArrayTexture?O.compressedTexSubImage3D(Ae,Te,Ue,ot,Pt,Re,we,Le,mt,vt.data):O.texSubImage3D(Ae,Te,Ue,ot,Pt,Re,we,Le,mt,jt,vt):M.isDataTexture?O.texSubImage2D(O.TEXTURE_2D,Te,Ue,ot,Re,we,mt,jt,vt.data):M.isCompressedTexture?O.compressedTexSubImage2D(O.TEXTURE_2D,Te,Ue,ot,vt.width,vt.height,mt,vt.data):O.texSubImage2D(O.TEXTURE_2D,Te,Ue,ot,Re,we,mt,jt,vt);x.pixelStorei(O.UNPACK_ROW_LENGTH,on),x.pixelStorei(O.UNPACK_IMAGE_HEIGHT,rt),x.pixelStorei(O.UNPACK_SKIP_PIXELS,Tn),x.pixelStorei(O.UNPACK_SKIP_ROWS,Xn),x.pixelStorei(O.UNPACK_SKIP_IMAGES,pi),Te===0&&B.generateMipmaps&&O.generateMipmap(Ae),x.unbindTexture()},this.initRenderTarget=function(M){K.get(M).__webglFramebuffer===void 0&&se.setupRenderTarget(M)},this.initTexture=function(M){M.isCubeTexture?se.setTextureCube(M,0):M.isData3DTexture?se.setTexture3D(M,0):M.isDataArrayTexture||M.isCompressedArrayTexture?se.setTexture2DArray(M,0):se.setTexture2D(M,0),x.unbindTexture()},this.resetState=function(){q=0,Y=0,ce=null,x.reset(),be.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return kn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=Je._getDrawingBufferColorSpace(e),t.unpackColorSpace=Je._getUnpackColorSpace()}};var ul=class extends vn{constructor(){super(),this.name="RoomEnvironment",this.position.y=-3.5;let e=new Hn;e.deleteAttribute("uv");let t=new Yt({side:Nt}),n=new Yt,r=new Ji(16777215,900,28,2);r.position.set(.418,16.199,.3),this.add(r);let s=new Oe(e,t);s.position.set(-.757,13.219,.717),s.scale.set(31.713,28.305,28.591),this.add(s);let a=new Zn(e,n,6),o=new wt;o.position.set(-10.906,2.009,1.846),o.rotation.set(0,-.195,0),o.scale.set(2.328,7.905,4.651),o.updateMatrix(),a.setMatrixAt(0,o.matrix),o.position.set(-5.607,-.754,-.758),o.rotation.set(0,.994,0),o.scale.set(1.97,1.534,3.955),o.updateMatrix(),a.setMatrixAt(1,o.matrix),o.position.set(6.167,.857,7.803),o.rotation.set(0,.561,0),o.scale.set(3.927,6.285,3.687),o.updateMatrix(),a.setMatrixAt(2,o.matrix),o.position.set(-2.017,.018,6.124),o.rotation.set(0,.333,0),o.scale.set(2.002,4.566,2.064),o.updateMatrix(),a.setMatrixAt(3,o.matrix),o.position.set(2.291,-.756,-2.621),o.rotation.set(0,-.286,0),o.scale.set(1.546,1.552,1.496),o.updateMatrix(),a.setMatrixAt(4,o.matrix),o.position.set(-2.193,-.369,-5.547),o.rotation.set(0,.516,0),o.scale.set(3.875,3.487,2.986),o.updateMatrix(),a.setMatrixAt(5,o.matrix),this.add(a);let l=new Oe(e,Xr(50));l.position.set(-16.116,14.37,8.208),l.scale.set(.1,2.428,2.739),this.add(l);let c=new Oe(e,Xr(50));c.position.set(-16.109,18.021,-8.207),c.scale.set(.1,2.425,2.751),this.add(c);let h=new Oe(e,Xr(17));h.position.set(14.904,12.198,-1.832),h.scale.set(.15,4.265,6.331),this.add(h);let u=new Oe(e,Xr(43));u.position.set(-.462,8.89,14.52),u.scale.set(4.38,5.441,.088),this.add(u);let d=new Oe(e,Xr(20));d.position.set(3.235,11.486,-12.541),d.scale.set(2.5,2,.1),this.add(d);let f=new Oe(e,Xr(100));f.position.set(0,20,0),f.scale.set(1,.1,1),this.add(f)}dispose(){let e=new Set;this.traverse(t=>{t.isMesh&&(e.add(t.geometry),e.add(t.material))});for(let t of e)t.dispose()}};function Xr(i){return new As({color:0,emissive:16777215,emissiveIntensity:i})}var hn=Uint8Array,qr=Uint16Array,M_=Int32Array,Dd=new hn([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Nd=new hn([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),S_=new hn([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Fd=function(i,e){for(var t=new qr(31),n=0;n<31;++n)t[n]=e+=1<<i[n-1];for(var r=new M_(t[30]),n=1;n<30;++n)for(var s=t[n];s<t[n+1];++s)r[s]=s-t[n]<<5|n;return{b:t,r}},Od=Fd(Dd,2),Bd=Od.b,E_=Od.r;Bd[28]=258,E_[258]=28;var kd=Fd(Nd,0),w_=kd.b,GM=kd.r,ph=new qr(32768);for(st=0;st<32768;++st)ui=(st&43690)>>1|(st&21845)<<1,ui=(ui&52428)>>2|(ui&13107)<<2,ui=(ui&61680)>>4|(ui&3855)<<4,ph[st]=((ui&65280)>>8|(ui&255)<<8)>>1;var ui,st,Zs=(function(i,e,t){for(var n=i.length,r=0,s=new qr(e);r<n;++r)i[r]&&++s[i[r]-1];var a=new qr(e);for(r=1;r<e;++r)a[r]=a[r-1]+s[r-1]<<1;var o;if(t){o=new qr(1<<e);var l=15-e;for(r=0;r<n;++r)if(i[r])for(var c=r<<4|i[r],h=e-i[r],u=a[i[r]-1]++<<h,d=u|(1<<h)-1;u<=d;++u)o[ph[u]>>l]=c}else for(o=new qr(n),r=0;r<n;++r)i[r]&&(o[r]=ph[a[i[r]-1]++]>>15-i[r]);return o}),Js=new hn(288);for(st=0;st<144;++st)Js[st]=8;var st;for(st=144;st<256;++st)Js[st]=9;var st;for(st=256;st<280;++st)Js[st]=7;var st;for(st=280;st<288;++st)Js[st]=8;var st,Hd=new hn(32);for(st=0;st<32;++st)Hd[st]=5;var st;var T_=Zs(Js,9,1);var A_=Zs(Hd,5,1),uh=function(i){for(var e=i[0],t=1;t<i.length;++t)i[t]>e&&(e=i[t]);return e},Gn=function(i,e,t){var n=e/8|0;return(i[n]|i[n+1]<<8)>>(e&7)&t},dh=function(i,e){var t=e/8|0;return(i[t]|i[t+1]<<8|i[t+2]<<16)>>(e&7)},R_=function(i){return(i+7)/8|0},dl=function(i,e,t){return(e==null||e<0)&&(e=0),(t==null||t>i.length)&&(t=i.length),new hn(i.subarray(e,t))};var C_=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],pn=function(i,e,t){var n=new Error(e||C_[i]);if(n.code=i,Error.captureStackTrace&&Error.captureStackTrace(n,pn),!t)throw n;return n},zd=function(i,e,t,n){var r=i.length,s=n?n.length:0;if(!r||e.f&&!e.l)return t||new hn(0);var a=!t,o=a||e.i!=2,l=e.i;a&&(t=new hn(r*3));var c=function(_e){var Ce=t.length;if(_e>Ce){var qe=new hn(Math.max(Ce*2,_e));qe.set(t),t=qe}},h=e.f||0,u=e.p||0,d=e.b||0,f=e.l,g=e.d,v=e.m,m=e.n,p=r*8;do{if(!f){h=Gn(i,u,1);var w=Gn(i,u+1,3);if(u+=3,w)if(w==1)f=T_,g=A_,v=9,m=5;else if(w==2){var S=Gn(i,u,31)+257,C=Gn(i,u+10,15)+4,_=S+Gn(i,u+5,31)+1;u+=14;for(var E=new hn(_),I=new hn(19),N=0;N<C;++N)I[S_[N]]=Gn(i,u+N*3,7);u+=C*3;for(var P=uh(I),F=(1<<P)-1,U=Zs(I,P,1),N=0;N<_;){var H=U[Gn(i,u,F)];u+=H&15;var T=H>>4;if(T<16)E[N++]=T;else{var q=0,Y=0;for(T==16?(Y=3+Gn(i,u,3),u+=2,q=E[N-1]):T==17?(Y=3+Gn(i,u,7),u+=3):T==18&&(Y=11+Gn(i,u,127),u+=7);Y--;)E[N++]=q}}var ce=E.subarray(0,S),G=E.subarray(S);v=uh(ce),m=uh(G),f=Zs(ce,v,1),g=Zs(G,m,1)}else pn(1);else{var T=R_(u)+4,y=i[T-4]|i[T-3]<<8,b=T+y;if(b>r){l&&pn(0);break}o&&c(d+y),t.set(i.subarray(T,b),d),e.b=d+=y,e.p=u=b*8,e.f=h;continue}if(u>p){l&&pn(0);break}}o&&c(d+131072);for(var J=(1<<v)-1,W=(1<<m)-1,ue=u;;ue=u){var q=f[dh(i,u)&J],pe=q>>4;if(u+=q&15,u>p){l&&pn(0);break}if(q||pn(2),pe<256)t[d++]=pe;else if(pe==256){ue=u,f=null;break}else{var Me=pe-254;if(pe>264){var N=pe-257,Se=Dd[N];Me=Gn(i,u,(1<<Se)-1)+Bd[N],u+=Se}var de=g[dh(i,u)&W],X=de>>4;de||pn(3),u+=de&15;var G=w_[X];if(X>3){var Se=Nd[X];G+=dh(i,u)&(1<<Se)-1,u+=Se}if(u>p){l&&pn(0);break}o&&c(d+131072);var ne=d+Me;if(d<G){var ye=s-G,Pe=Math.min(G,ne);for(ye+d<0&&pn(3);d<Pe;++d)t[d]=n[ye+d]}for(;d<ne;++d)t[d]=t[d-G]}}e.l=f,e.p=ue,e.b=d,e.f=h,f&&(h=1,e.m=v,e.d=g,e.n=m)}while(!h);return d!=t.length&&a?dl(t,0,d):t.subarray(0,d)};var P_=new hn(0);var Vd=function(i,e){return((i[0]&15)!=8||i[0]>>4>7||(i[0]<<8|i[1])%31)&&pn(6,"invalid zlib data"),(i[1]>>5&1)==+!e&&pn(6,"invalid zlib data: "+(i[1]&32?"need":"unexpected")+" dictionary"),(i[1]>>3&4)+2};var fh=(function(){function i(e,t){typeof e=="function"&&(t=e,e={}),this.ondata=t;var n=e&&e.dictionary&&e.dictionary.subarray(-32768);this.s={i:0,b:n?n.length:0},this.o=new hn(32768),this.p=new hn(0),n&&this.o.set(n)}return i.prototype.e=function(e){if(this.ondata||pn(5),this.d&&pn(4),!this.p.length)this.p=e;else if(e.length){var t=new hn(this.p.length+e.length);t.set(this.p),t.set(e,this.p.length),this.p=t}},i.prototype.c=function(e){this.s.i=+(this.d=e||!1);var t=this.s.b,n=zd(this.p,this.s,this.o);this.ondata(dl(n,t,this.s.b),this.d),this.o=dl(n,this.s.b-32768),this.s.b=this.o.length,this.p=dl(this.p,this.s.p/8|0),this.s.p&=7},i.prototype.push=function(e,t){this.e(e),this.c(t)},i})();var mh=(function(){function i(e,t){fh.call(this,e,t),this.v=e&&e.dictionary?2:1}return i.prototype.push=function(e,t){if(fh.prototype.e.call(this,e),this.v){if(this.p.length<6&&!t)return;this.p=this.p.subarray(Vd(this.p,this.v-1)),this.v=0}t&&(this.p.length<4&&pn(6,"invalid zlib data"),this.p=this.p.subarray(0,-4)),fh.prototype.c.call(this,t)},i})();function Gd(i,e){return zd(i.subarray(Vd(i,e&&e.dictionary),-4),{i:2},e&&e.out,e&&e.dictionary)}var I_=typeof TextDecoder<"u"&&new TextDecoder,L_=0;try{I_.decode(P_,{stream:!0}),L_=1}catch{}function gh(i,e="utf8"){return new TextDecoder(e).decode(i)}var U_=new TextEncoder;function Wd(i){return U_.encode(i)}var D_=1024*8,N_=(()=>{let i=new Uint8Array(4),e=new Uint32Array(i.buffer);return!((e[0]=1)&i[0])})(),xh={int8:globalThis.Int8Array,uint8:globalThis.Uint8Array,int16:globalThis.Int16Array,uint16:globalThis.Uint16Array,int32:globalThis.Int32Array,uint32:globalThis.Uint32Array,uint64:globalThis.BigUint64Array,int64:globalThis.BigInt64Array,float32:globalThis.Float32Array,float64:globalThis.Float64Array},Ks=class i{buffer;byteLength;byteOffset;length;offset;lastWrittenByte;littleEndian;_data;_mark;_marks;constructor(e=D_,t={}){let n=!1;typeof e=="number"?e=new ArrayBuffer(e):(n=!0,this.lastWrittenByte=e.byteLength);let r=t.offset?t.offset>>>0:0,s=e.byteLength-r,a=r;(ArrayBuffer.isView(e)||e instanceof i)&&(e.byteLength!==e.buffer.byteLength&&(a=e.byteOffset+r),e=e.buffer),n?this.lastWrittenByte=s:this.lastWrittenByte=0,this.buffer=e,this.length=s,this.byteLength=s,this.byteOffset=a,this.offset=0,this.littleEndian=!0,this._data=new DataView(this.buffer,a,s),this._mark=0,this._marks=[]}available(e=1){return this.offset+e<=this.length}isLittleEndian(){return this.littleEndian}setLittleEndian(){return this.littleEndian=!0,this}isBigEndian(){return!this.littleEndian}setBigEndian(){return this.littleEndian=!1,this}skip(e=1){return this.offset+=e,this}back(e=1){return this.offset-=e,this}seek(e){return this.offset=e,this}mark(){return this._mark=this.offset,this}reset(){return this.offset=this._mark,this}pushMark(){return this._marks.push(this.offset),this}popMark(){let e=this._marks.pop();if(e===void 0)throw new Error("Mark stack empty");return this.seek(e),this}rewind(){return this.offset=0,this}ensureAvailable(e=1){if(!this.available(e)){let n=(this.offset+e)*2,r=new Uint8Array(n);r.set(new Uint8Array(this.buffer)),this.buffer=r.buffer,this.length=n,this.byteLength=n,this._data=new DataView(this.buffer)}return this}readBoolean(){return this.readUint8()!==0}readInt8(){return this._data.getInt8(this.offset++)}readUint8(){return this._data.getUint8(this.offset++)}readByte(){return this.readUint8()}readBytes(e=1){return this.readArray(e,"uint8")}readArray(e,t){let n=xh[t].BYTES_PER_ELEMENT*e,r=this.byteOffset+this.offset,s=this.buffer.slice(r,r+n);if(this.littleEndian===N_&&t!=="uint8"&&t!=="int8"){let o=new Uint8Array(this.buffer.slice(r,r+n));o.reverse();let l=new xh[t](o.buffer);return this.offset+=n,l.reverse(),l}let a=new xh[t](s);return this.offset+=n,a}readInt16(){let e=this._data.getInt16(this.offset,this.littleEndian);return this.offset+=2,e}readUint16(){let e=this._data.getUint16(this.offset,this.littleEndian);return this.offset+=2,e}readInt32(){let e=this._data.getInt32(this.offset,this.littleEndian);return this.offset+=4,e}readUint32(){let e=this._data.getUint32(this.offset,this.littleEndian);return this.offset+=4,e}readFloat32(){let e=this._data.getFloat32(this.offset,this.littleEndian);return this.offset+=4,e}readFloat64(){let e=this._data.getFloat64(this.offset,this.littleEndian);return this.offset+=8,e}readBigInt64(){let e=this._data.getBigInt64(this.offset,this.littleEndian);return this.offset+=8,e}readBigUint64(){let e=this._data.getBigUint64(this.offset,this.littleEndian);return this.offset+=8,e}readChar(){return String.fromCharCode(this.readInt8())}readChars(e=1){let t="";for(let n=0;n<e;n++)t+=this.readChar();return t}readUtf8(e=1){return gh(this.readBytes(e))}decodeText(e=1,t="utf8"){return gh(this.readBytes(e),t)}writeBoolean(e){return this.writeUint8(e?255:0),this}writeInt8(e){return this.ensureAvailable(1),this._data.setInt8(this.offset++,e),this._updateLastWrittenByte(),this}writeUint8(e){return this.ensureAvailable(1),this._data.setUint8(this.offset++,e),this._updateLastWrittenByte(),this}writeByte(e){return this.writeUint8(e)}writeBytes(e){this.ensureAvailable(e.length);for(let t=0;t<e.length;t++)this._data.setUint8(this.offset++,e[t]);return this._updateLastWrittenByte(),this}writeInt16(e){return this.ensureAvailable(2),this._data.setInt16(this.offset,e,this.littleEndian),this.offset+=2,this._updateLastWrittenByte(),this}writeUint16(e){return this.ensureAvailable(2),this._data.setUint16(this.offset,e,this.littleEndian),this.offset+=2,this._updateLastWrittenByte(),this}writeInt32(e){return this.ensureAvailable(4),this._data.setInt32(this.offset,e,this.littleEndian),this.offset+=4,this._updateLastWrittenByte(),this}writeUint32(e){return this.ensureAvailable(4),this._data.setUint32(this.offset,e,this.littleEndian),this.offset+=4,this._updateLastWrittenByte(),this}writeFloat32(e){return this.ensureAvailable(4),this._data.setFloat32(this.offset,e,this.littleEndian),this.offset+=4,this._updateLastWrittenByte(),this}writeFloat64(e){return this.ensureAvailable(8),this._data.setFloat64(this.offset,e,this.littleEndian),this.offset+=8,this._updateLastWrittenByte(),this}writeBigInt64(e){return this.ensureAvailable(8),this._data.setBigInt64(this.offset,e,this.littleEndian),this.offset+=8,this._updateLastWrittenByte(),this}writeBigUint64(e){return this.ensureAvailable(8),this._data.setBigUint64(this.offset,e,this.littleEndian),this.offset+=8,this._updateLastWrittenByte(),this}writeChar(e){return this.writeUint8(e.charCodeAt(0))}writeChars(e){for(let t=0;t<e.length;t++)this.writeUint8(e.charCodeAt(t));return this}writeUtf8(e){return this.writeBytes(Wd(e))}toArray(){return new Uint8Array(this.buffer,this.byteOffset,this.lastWrittenByte)}getWrittenByteLength(){return this.lastWrittenByte-this.byteOffset}_updateLastWrittenByte(){this.offset>this.lastWrittenByte&&(this.lastWrittenByte=this.offset)}};var qd=[];for(let i=0;i<256;i++){let e=i;for(let t=0;t<8;t++)e&1?e=3988292384^e>>>1:e=e>>>1;qd[i]=e}var Xd=4294967295;function F_(i,e,t){let n=i;for(let r=0;r<t;r++)n=qd[(n^e[r])&255]^n>>>8;return n}function O_(i,e){return(F_(Xd,i,e)^Xd)>>>0}function _h(i,e,t){let n=i.readUint32(),r=O_(new Uint8Array(i.buffer,i.byteOffset+i.offset-e-4,e),e);if(r!==n)throw new Error(`CRC mismatch for chunk ${t}. Expected ${n}, found ${r}`)}function fl(i,e,t){for(let n=0;n<t;n++)e[n]=i[n]}function pl(i,e,t,n){let r=0;for(;r<n;r++)e[r]=i[r];for(;r<t;r++)e[r]=i[r]+e[r-n]&255}function ml(i,e,t,n){let r=0;if(t.length===0)for(;r<n;r++)e[r]=i[r];else for(;r<n;r++)e[r]=i[r]+t[r]&255}function gl(i,e,t,n,r){let s=0;if(t.length===0){for(;s<r;s++)e[s]=i[s];for(;s<n;s++)e[s]=i[s]+(e[s-r]>>1)&255}else{for(;s<r;s++)e[s]=i[s]+(t[s]>>1)&255;for(;s<n;s++)e[s]=i[s]+(e[s-r]+t[s]>>1)&255}}function xl(i,e,t,n,r){let s=0;if(t.length===0){for(;s<r;s++)e[s]=i[s];for(;s<n;s++)e[s]=i[s]+e[s-r]&255}else{for(;s<r;s++)e[s]=i[s]+t[s]&255;for(;s<n;s++)e[s]=i[s]+B_(e[s-r],t[s],t[s-r])&255}}function B_(i,e,t){let n=i+e-t,r=Math.abs(n-i),s=Math.abs(n-e),a=Math.abs(n-t);return r<=s&&r<=a?i:s<=a?e:t}function Yd(i,e,t,n,r,s){switch(i){case 0:fl(e,t,r);break;case 1:pl(e,t,r,s);break;case 2:ml(e,t,n,r);break;case 3:gl(e,t,n,r,s);break;case 4:xl(e,t,n,r,s);break;default:throw new Error(`Unsupported filter: ${i}`)}}var k_=new Uint16Array([255]),H_=new Uint8Array(k_.buffer),z_=H_[0]===255;function $d(i){let{data:e,width:t,height:n,channels:r,depth:s}=i,a=[{x:0,y:0,xStep:8,yStep:8},{x:4,y:0,xStep:8,yStep:8},{x:0,y:4,xStep:4,yStep:8},{x:2,y:0,xStep:4,yStep:4},{x:0,y:2,xStep:2,yStep:4},{x:1,y:0,xStep:2,yStep:2},{x:0,y:1,xStep:1,yStep:2}],o=Math.ceil(s/8)*r,l=new Uint8Array(n*t*o),c=0;for(let h=0;h<7;h++){let u=a[h],d=Math.ceil((t-u.x)/u.xStep),f=Math.ceil((n-u.y)/u.yStep);if(d<=0||f<=0)continue;let g=d*o,v=new Uint8Array(g);for(let m=0;m<f;m++){let p=e[c++],w=e.subarray(c,c+g);c+=g;let T=new Uint8Array(g);Yd(p,w,T,v,g,o),v.set(T);for(let y=0;y<d;y++){let b=u.x+y*u.xStep,S=u.y+m*u.yStep;if(!(b>=t||S>=n))for(let C=0;C<o;C++)l[(S*t+b)*o+C]=T[y*o+C]}}}if(s===16){let h=new Uint16Array(l.buffer);if(z_)for(let u=0;u<h.length;u++)h[u]=V_(h[u]);return h}else return l}function V_(i){return(i&255)<<8|i>>8&255}var G_=new Uint16Array([255]),W_=new Uint8Array(G_.buffer),X_=W_[0]===255,q_=new Uint8Array(0);function yh(i){let{data:e,width:t,height:n,channels:r,depth:s}=i,a=Math.ceil(s/8)*r,o=Math.ceil(s/8*r*t),l=new Uint8Array(n*o),c=q_,h=0,u,d;for(let f=0;f<n;f++){switch(u=e.subarray(h+1,h+1+o),d=l.subarray(f*o,(f+1)*o),e[h]){case 0:fl(u,d,o);break;case 1:pl(u,d,o,a);break;case 2:ml(u,d,c,o);break;case 3:gl(u,d,c,o,a);break;case 4:xl(u,d,c,o,a);break;default:throw new Error(`Unsupported filter: ${e[h]}`)}c=d,h+=o+1}if(s===16){let f=new Uint16Array(l.buffer);if(X_)for(let g=0;g<f.length;g++)f[g]=Y_(f[g]);return f}else return l}function Y_(i){return(i&255)<<8|i>>8&255}var _l=Uint8Array.of(137,80,78,71,13,10,26,10);function vh(i){if(!Zd(i.readBytes(_l.length)))throw new Error("wrong PNG signature")}function Zd(i){if(i.length<_l.length)return!1;for(let e=0;e<_l.length;e++)if(i[e]!==_l[e])return!1;return!0}var Jd="tEXt",Z_=0,Kd=new TextDecoder("latin1");function J_(i){if(j_(i),i.length===0||i.length>79)throw new Error("keyword length must be between 1 and 79")}var K_=/^[\u0000-\u00FF]*$/;function j_(i){if(!K_.test(i))throw new Error("invalid latin1 text")}function jd(i,e,t){let n=bh(e);i[n]=Q_(e,t-n.length-1)}function bh(i){for(i.mark();i.readByte()!==Z_;);let e=i.offset;i.reset();let t=Kd.decode(i.readBytes(e-i.offset-1));return i.skip(1),J_(t),t}function Q_(i,e){return Kd.decode(i.readBytes(e))}var un={UNKNOWN:-1,GREYSCALE:0,TRUECOLOUR:2,INDEXED_COLOUR:3,GREYSCALE_ALPHA:4,TRUECOLOUR_ALPHA:6},js={UNKNOWN:-1,DEFLATE:0},yl={UNKNOWN:-1,ADAPTIVE:0},Qs={UNKNOWN:-1,NO_INTERLACE:0,ADAM7:1},ea={NONE:0,BACKGROUND:1,PREVIOUS:2},vl={SOURCE:0,OVER:1};var ta=class extends Ks{_checkCrc;_inflator;_png;_apng;_end;_hasPalette;_palette;_hasTransparency;_transparency;_compressionMethod;_filterMethod;_interlaceMethod;_colorType;_isAnimated;_numberOfFrames;_numberOfPlays;_frames;_writingDataChunks;_chunks;_inflatorResult;constructor(e,t={}){super(e);let{checkCrc:n=!1}=t;this._checkCrc=n,this._inflator=new mh((r,s)=>{if(this._chunks.push(r),s){let a=this._chunks.reduce((l,c)=>l+c.length,0);this._inflatorResult=new Uint8Array(a);let o=0;for(let l of this._chunks)this._inflatorResult.set(l,o),o+=l.length;this._chunks=[]}}),this._chunks=[],this._png={width:-1,height:-1,channels:-1,data:new Uint8Array(0),depth:1,text:{}},this._apng={width:-1,height:-1,channels:-1,depth:1,numberOfFrames:1,numberOfPlays:0,text:{},frames:[]},this._end=!1,this._hasPalette=!1,this._palette=[],this._hasTransparency=!1,this._transparency=new Uint16Array(0),this._compressionMethod=js.UNKNOWN,this._filterMethod=yl.UNKNOWN,this._interlaceMethod=Qs.UNKNOWN,this._colorType=un.UNKNOWN,this._isAnimated=!1,this._numberOfFrames=1,this._numberOfPlays=0,this._frames=[],this._writingDataChunks=!1,this._inflatorResult=new Uint8Array(0),this.setBigEndian()}decode(){for(vh(this);!this._end;){let e=this.readUint32(),t=this.readChars(4);this.decodeChunk(e,t)}return this._inflator.push(new Uint8Array(0),!0),this.decodeImage(),this._png}decodeApng(){for(vh(this);!this._end;){let e=this.readUint32(),t=this.readChars(4);this.decodeApngChunk(e,t)}return this.decodeApngImage(),this._apng}decodeChunk(e,t){let n=this.offset;switch(t){case"IHDR":this.decodeIHDR();break;case"PLTE":this.decodePLTE(e);break;case"IDAT":this.decodeIDAT(e);break;case"IEND":this._end=!0;break;case"tRNS":this.decodetRNS(e);break;case"iCCP":this.decodeiCCP(e);break;case Jd:jd(this._png.text,this,e);break;case"pHYs":this.decodepHYs();break;default:this.skip(e);break}if(this.offset-n!==e)throw new Error(`Length mismatch while decoding chunk ${t}`);this._checkCrc?_h(this,e+4,t):this.skip(4)}decodeApngChunk(e,t){let n=this.offset;switch(t!=="fdAT"&&t!=="IDAT"&&this._writingDataChunks&&this.pushDataToFrame(),t){case"acTL":this.decodeACTL();break;case"fcTL":this.decodeFCTL();break;case"fdAT":this.decodeFDAT(e);break;default:this.decodeChunk(e,t),this.offset=n+e;break}if(this.offset-n!==e)throw new Error(`Length mismatch while decoding chunk ${t}`);this._checkCrc?_h(this,e+4,t):this.skip(4)}decodeIHDR(){let e=this._png;e.width=this.readUint32(),e.height=this.readUint32(),e.depth=ey(this.readUint8());let t=this.readUint8();this._colorType=t;let n;switch(t){case un.GREYSCALE:n=1;break;case un.TRUECOLOUR:n=3;break;case un.INDEXED_COLOUR:n=1;break;case un.GREYSCALE_ALPHA:n=2;break;case un.TRUECOLOUR_ALPHA:n=4;break;case un.UNKNOWN:default:throw new Error(`Unknown color type: ${t}`)}if(this._png.channels=n,this._compressionMethod=this.readUint8(),this._compressionMethod!==js.DEFLATE)throw new Error(`Unsupported compression method: ${this._compressionMethod}`);this._filterMethod=this.readUint8(),this._interlaceMethod=this.readUint8()}decodeACTL(){this._numberOfFrames=this.readUint32(),this._numberOfPlays=this.readUint32(),this._isAnimated=!0}decodeFCTL(){let e={sequenceNumber:this.readUint32(),width:this.readUint32(),height:this.readUint32(),xOffset:this.readUint32(),yOffset:this.readUint32(),delayNumber:this.readUint16(),delayDenominator:this.readUint16(),disposeOp:this.readUint8(),blendOp:this.readUint8(),data:new Uint8Array(0)};this._frames.push(e)}decodePLTE(e){if(e%3!==0)throw new RangeError(`PLTE field length must be a multiple of 3. Got ${e}`);let t=e/3;this._hasPalette=!0;let n=[];this._palette=n;for(let r=0;r<t;r++)n.push([this.readUint8(),this.readUint8(),this.readUint8()])}decodeIDAT(e){this._writingDataChunks=!0;let t=e,n=this.offset+this.byteOffset;try{this._inflator.push(new Uint8Array(this.buffer,n,t),!1)}catch(r){throw new Error("Error while decompressing the data:",{cause:r})}this.skip(e)}decodeFDAT(e){this._writingDataChunks=!0;let t=e,n=this.offset+this.byteOffset;n+=4,t-=4;try{this._inflator.push(new Uint8Array(this.buffer,n,t),!1)}catch(r){throw new Error("Error while decompressing the data:",{cause:r})}this.skip(e)}decodetRNS(e){switch(this._colorType){case un.GREYSCALE:case un.TRUECOLOUR:{if(e%2!==0)throw new RangeError(`tRNS chunk length must be a multiple of 2. Got ${e}`);if(e/2>this._png.width*this._png.height)throw new Error(`tRNS chunk contains more alpha values than there are pixels (${e/2} vs ${this._png.width*this._png.height})`);this._hasTransparency=!0,this._transparency=new Uint16Array(e/2);for(let t=0;t<e/2;t++)this._transparency[t]=this.readUint16();break}case un.INDEXED_COLOUR:{if(e>this._palette.length)throw new Error(`tRNS chunk contains more alpha values than there are palette colors (${e} vs ${this._palette.length})`);let t=0;for(;t<e;t++){let n=this.readByte();this._palette[t].push(n)}for(;t<this._palette.length;t++)this._palette[t].push(255);break}case un.UNKNOWN:case un.GREYSCALE_ALPHA:case un.TRUECOLOUR_ALPHA:default:throw new Error(`tRNS chunk is not supported for color type ${this._colorType}`)}}decodeiCCP(e){let t=bh(this),n=this.readUint8();if(n!==js.DEFLATE)throw new Error(`Unsupported iCCP compression method: ${n}`);let r=this.readBytes(e-t.length-2);this._png.iccEmbeddedProfile={name:t,profile:Gd(r)}}decodepHYs(){let e=this.readUint32(),t=this.readUint32(),n=this.readByte();this._png.resolution={x:e,y:t,unit:n}}decodeApngImage(){this._apng.width=this._png.width,this._apng.height=this._png.height,this._apng.channels=this._png.channels,this._apng.depth=this._png.depth,this._apng.numberOfFrames=this._numberOfFrames,this._apng.numberOfPlays=this._numberOfPlays,this._apng.text=this._png.text,this._apng.resolution=this._png.resolution;for(let e=0;e<this._numberOfFrames;e++){let t={sequenceNumber:this._frames[e].sequenceNumber,delayNumber:this._frames[e].delayNumber,delayDenominator:this._frames[e].delayDenominator,data:this._apng.depth===8?new Uint8Array(this._apng.width*this._apng.height*this._apng.channels):new Uint16Array(this._apng.width*this._apng.height*this._apng.channels)},n=this._frames.at(e);if(n){if(n.data=yh({data:n.data,width:n.width,height:n.height,channels:this._apng.channels,depth:this._apng.depth}),this._hasPalette&&(this._apng.palette=this._palette),this._hasTransparency&&(this._apng.transparency=this._transparency),e===0||n.xOffset===0&&n.yOffset===0&&n.width===this._png.width&&n.height===this._png.height)t.data=n.data;else{let r=this._apng.frames.at(e-1);this.disposeFrame(n,r,t),this.addFrameDataToCanvas(t,n)}this._apng.frames.push(t)}}return this._apng}disposeFrame(e,t,n){switch(e.disposeOp){case ea.NONE:break;case ea.BACKGROUND:for(let r=0;r<this._png.height;r++)for(let s=0;s<this._png.width;s++){let a=(r*e.width+s)*this._png.channels;for(let o=0;o<this._png.channels;o++)n.data[a+o]=0}break;case ea.PREVIOUS:n.data.set(t.data);break;default:throw new Error("Unknown disposeOp")}}addFrameDataToCanvas(e,t){let n=1<<this._png.depth,r=(s,a)=>{let o=((s+t.yOffset)*this._png.width+t.xOffset+a)*this._png.channels,l=(s*t.width+a)*this._png.channels;return{index:o,frameIndex:l}};switch(t.blendOp){case vl.SOURCE:for(let s=0;s<t.height;s++)for(let a=0;a<t.width;a++){let{index:o,frameIndex:l}=r(s,a);for(let c=0;c<this._png.channels;c++)e.data[o+c]=t.data[l+c]}break;case vl.OVER:for(let s=0;s<t.height;s++)for(let a=0;a<t.width;a++){let{index:o,frameIndex:l}=r(s,a);for(let c=0;c<this._png.channels;c++){let h=t.data[l+this._png.channels-1]/n,u=c%(this._png.channels-1)===0?1:t.data[l+c],d=Math.floor(h*u+(1-h)*e.data[o+c]);e.data[o+c]+=d}}break;default:throw new Error("Unknown blendOp")}}decodeImage(){let e=this._inflatorResult;if(this._filterMethod!==yl.ADAPTIVE)throw new Error(`Filter method ${this._filterMethod} not supported`);if(this._interlaceMethod===Qs.NO_INTERLACE)this._png.data=yh({data:e,width:this._png.width,height:this._png.height,channels:this._png.channels,depth:this._png.depth});else if(this._interlaceMethod===Qs.ADAM7)this._png.data=$d({data:e,width:this._png.width,height:this._png.height,channels:this._png.channels,depth:this._png.depth});else throw new Error(`Interlace method ${this._interlaceMethod} not supported`);this._hasPalette&&(this._png.palette=this._palette),this._hasTransparency&&(this._png.transparency=this._transparency)}pushDataToFrame(){this._inflator.push(new Uint8Array(0),!0);let e=this._inflatorResult,t=this._frames.at(-1);t?t.data=e:this._frames.push({sequenceNumber:0,width:this._png.width,height:this._png.height,xOffset:0,yOffset:0,delayNumber:0,delayDenominator:0,disposeOp:ea.NONE,blendOp:vl.SOURCE,data:e}),this._inflator=new mh((n,r)=>{if(this._chunks.push(n),r){let s=this._chunks.reduce((o,l)=>o+l.length,0);this._inflatorResult=new Uint8Array(s);let a=0;for(let o of this._chunks)this._inflatorResult.set(o,a),a+=o.length;this._chunks=[]}}),this._chunks=[],this._writingDataChunks=!1}};function ey(i){if(i!==1&&i!==2&&i!==4&&i!==8&&i!==16)throw new Error(`invalid bit depth: ${i}`);return i}function na(i,e){return new ta(i,e).decode()}var ty=45455;function ny(i){let e=[137,80,78,71,13,10,26,10];if(i.length<8||e.some((s,a)=>i[a]!==s))throw new Error("png: bad signature");let t=new DataView(i.buffer,i.byteOffset,i.byteLength),n=[],r=8;for(;r+12<=i.length;){let s=t.getUint32(r),a=String.fromCharCode(i[r+4],i[r+5],i[r+6],i[r+7]);if(r+12+s>i.length)throw new Error(`png: truncated chunk ${a}`);if(n.push({type:a,data:i.subarray(r+8,r+8+s)}),r+=12+s,a==="IEND")break}return n}function iy(i,e,t){let n=!1;for(let r=0;r<t;r++)for(let s=0;s<e;s++){let a=i[(r*e+s)*4+3];if(a===0||a===255)continue;n=!0;let o=s===0||r===0||s===e-1||r===t-1;for(let l=-1;l<=1&&!o;l++)for(let c=-1;c<=1&&!o;c++)o=i[((r+l)*e+s+c)*4+3]===0;if(!o)return"soft"}return n?"rim":"hard"}function Mh(i,e){let t=[];i.profile!=="srgb"&&t.push(`profile: ${i.profile} (only srgb)`),i.alpha!=="straight"&&t.push(`alpha: ${i.alpha} (only straight)`);let n;try{n=ny(e)}catch(a){return[...t,`unreadable: ${String(a)}`]}for(let a of n)if((a.type==="iCCP"||a.type==="cHRM")&&t.push(`colour chunk ${a.type}`),a.type==="gAMA"){let o=new DataView(a.data.buffer,a.data.byteOffset,a.data.byteLength).getUint32(0);o!==ty&&t.push(`colour chunk gAMA ${o}`)}let r;try{r=na(e)}catch(a){return t.push(`undecodable: ${String(a)}`),t}if(r.depth!==8||r.channels!==4)return t.push(`format: ${r.depth}-bit, must be RGBA8`),t;let s=iy(r.data,r.width,r.height);return s!==i.edge&&t.push(`edge: declared ${i.edge}, measured ${s}`),t}function Yr(i,e,t){let n=new Uint8Array(i.length),r=e*4;for(let s=0;s<t;s++)n.set(i.subarray(s*r,(s+1)*r),(t-1-s)*r);return n}var Ye={stage:1,"fx-back":2,photo:3,drawn:4,"fx-front":5,ui:6,isolate:7,lightsOnly:30},Qd=1,sn=(i,e=0,t=1)=>Math.min(t,Math.max(e,i)),Mt=(i,e,t)=>i+(e-i)*t,ft=(i,e,t)=>e===i?t>=e?1:0:sn((t-i)/(e-i)),_t=(i,e,t)=>{let n=ft(i,e,t);return n*n*(3-2*n)},ti=i=>1-Math.pow(1-i,3),bl=i=>i*i,nr=i=>i<.5?4*i*i*i:1-Math.pow(-2*i+2,3)/2,Di=(i,e=1.7)=>1+(e+1)*Math.pow(i-1,3)+e*Math.pow(i-1,2);function kt(i){return new We(i).convertSRGBToLinear()}var $r=class{parts=[];next=1;add(e,t,n,r=null){let s=this.next++,a=r?.userData.co,o=new wi({depthPacking:zs,map:r,alphaTest:r?1/512:0}),l=n[0]?.material;o.side=(Array.isArray(l)?l[0]:l)?.side??Jn,o.name=`${e}#${s}#depth`,o.userData.co={cls:t,part_id:s};let c={part_id:s,name:e,cls:t,asset_id:a?.asset_id??null,asset_sha256:t==="photo"?a?.sha256??null:null,objects:n,depthMat:o};for(let h of n){h.layers.set(t==="photo"?Ye.photo:Ye.drawn);let u=d=>{let f=d.userData.co,g=f&&f.part_id!==void 0&&f.part_id!==s?d.clone():d;return g.userData={...d.userData,co:{cls:t,part_id:s}},g};h.material=Array.isArray(h.material)?h.material.map(u):u(h.material)}return this.parts.push(c),c}};function ef(i,e){let t=new nn({map:i,transparent:!0,alphaTest:.001953125,toneMapped:!1,depthWrite:!0,fog:!1,side:Ft,stencilWrite:!0,stencilRef:Qd,stencilFunc:Ws,stencilZPass:Gs});return t.name=e,t}function Sh(i){for(let e of i.parts)if(e.cls==="drawn")for(let t of e.objects)for(let n of Array.isArray(t.material)?t.material:[t.material])n.stencilZPass=ry(n)?Gs:li}function ry(i){let e=i;return i.opacity>=1&&!e.alphaMap&&!(e.transmission&&e.transmission>0)&&!i.alphaHash}function mn(i,e){return i.name=e,i.stencilWrite=!0,i.stencilRef=0,i.stencilFunc=Ws,i.stencilZPass=Gs,Zr(i),i}function Zr(i){i.onBeforeCompile=e=>{e.fragmentShader=e.fragmentShader.replace("#include <colorspace_fragment>",`#include <colorspace_fragment>
	gl_FragColor = clamp( sRGBTransferOETF( gl_FragColor ), 0.0, 1.0 );`)},i.customProgramCacheKey=()=>"crunchy-srgb-out"}function Lt(i,e,t){return i.name=e,i.userData.co={cls:"graphic",part_id:null},t&&(i.stencilWrite=!0,i.stencilRef=Qd,i.stencilFunc=Vc,i.stencilWriteMask=0,i.stencilFail=li,i.stencilZFail=li,i.stencilZPass=li),i}function Ni(i,e){return i.name=e,i.userData.co={cls:"graphic",asset_id:e,sha256:null},i}function Eh(i,e){return i.name=e,i.userData.co={cls:"drawn",asset_id:e,sha256:null},i}function Fi(i,e,t){let n=document.createElement("canvas");n.width=i,n.height=e,t(n.getContext("2d"));let r=new Si(n);return r.colorSpace=Zt,r.generateMipmaps=!0,r.minFilter=jn,r}var sy=new Uint32Array([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),ni=(i,e)=>i>>>e|i<<32-e;function tf(i){let e=i.length,t=new Uint8Array(e+9+63>>6<<6);t.set(i),t[e]=128;let n=new DataView(t.buffer);n.setUint32(t.length-8,Math.floor(e/536870912)),n.setUint32(t.length-4,e<<3>>>0);let r=new Uint32Array([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]),s=new Uint32Array(64);for(let l=0;l<t.length;l+=64){for(let p=0;p<16;p++)s[p]=n.getUint32(l+p*4);for(let p=16;p<64;p++){let w=s[p-15],T=s[p-2],y=ni(w,7)^ni(w,18)^w>>>3,b=ni(T,17)^ni(T,19)^T>>>10;s[p]=s[p-16]+y+s[p-7]+b>>>0}let c=r[0],h=r[1],u=r[2],d=r[3],f=r[4],g=r[5],v=r[6],m=r[7];for(let p=0;p<64;p++){let w=ni(f,6)^ni(f,11)^ni(f,25),T=f&g^~f&v,y=m+w+T+sy[p]+s[p]>>>0,b=ni(c,2)^ni(c,13)^ni(c,22),S=c&h^c&u^h&u,C=b+S>>>0;m=v,v=g,g=f,f=d+y>>>0,d=u,u=h,h=c,c=y+C>>>0}r[0]=r[0]+c>>>0,r[1]=r[1]+h>>>0,r[2]=r[2]+u>>>0,r[3]=r[3]+d>>>0,r[4]=r[4]+f>>>0,r[5]=r[5]+g>>>0,r[6]=r[6]+v>>>0,r[7]=r[7]+m>>>0}let a=new Uint8Array(32),o=new DataView(a.buffer);for(let l=0;l<8;l++)o.setUint32(l*4,r[l]);return a}function Ml(i){if(i===null)return"null";if(typeof i=="number"){if(!Number.isFinite(i))throw new Error("canonicalJson: non-finite number");return JSON.stringify(i)}if(typeof i=="string"||typeof i=="boolean")return JSON.stringify(i);if(Array.isArray(i))return"["+i.map(Ml).join(",")+"]";if(typeof i=="object"){let e=i;return"{"+Object.keys(e).sort().map(t=>{if(e[t]===void 0)throw new Error(`canonicalJson: undefined at ${t}`);return JSON.stringify(t)+":"+Ml(e[t])}).join(",")+"}"}throw new Error(`canonicalJson: unsupported ${typeof i}`)}function ir(i){let e=typeof i=="string"?new TextEncoder().encode(i):i;return Array.from(tf(e),t=>t.toString(16).padStart(2,"0")).join("")}var ay=["04","05","06","07","09","11","13","20"].map(i=>`cb-p-chip-${i}`),oy={whole:{add:[],state:"cb-s01-whole-series"},slice:{add:[],state:"cb-s02-sliced"},gut:{add:[],state:"cb-s03-gutted-series"},aioli:{add:["cb-p-aioli"],state:"cb-s04-aioli"},chips:{add:ay,state:"cb-s05-chips"},provolone:{add:["cb-p-provolone"],state:"cb-s06-provolone"},turkey:{add:["cb-p-turkey"],state:"cb-s07-turkey"},onions:{add:["cb-p-onion"],state:null},pickles:{add:Array.from({length:7},(i,e)=>`cb-p-pickle-0${e+1}`),state:"cb-s09-onions"},shredduce:{add:["cb-p-shredduce"],state:"cb-s10-shredduce"},"oil-vinegar":{add:[],state:"cb-s11-oil-vinegar"},oregano:{add:["cb-p-oregano"],state:"cb-s12-oregano"}},nf="cb-f-built-angle",ly=new Set(["chips","shredduce"]);function Sl(i,e,t){let n=Object.entries(oy).map(([a,o])=>{if(i==="studio-3d")return{key:a,rep:"drawn",add:[],state:null,reason:"studio-3d is drawn"};let l=o.state&&t.has(o.state)?o.state:null;if(e==="c2"&&ly.has(a))return{key:a,rep:"drawn",add:[],state:l,reason:"C2 drawn accent"};let c=o.add.filter(h=>!t.has(h));return o.add.length>0&&c.length===0?{key:a,rep:"photo",add:o.add,state:l,reason:null}:l?{key:a,rep:"photo",add:[],state:l,reason:null}:{key:a,rep:"drawn",add:[],state:null,reason:`missing photo ${[...c,...o.state?[o.state]:[]].join(", ")}`}}),r=i==="stage-show"&&t.has(nf)?nf:null,s=n.filter(a=>a.rep==="drawn").map(a=>a.key);return{look:i,variant:e,steps:n,hero:r,tag:s.length?"drawn":"real-photo",drawnFood:s}}var rf=i=>[...i.beats].sort((e,t)=>e.step-t.step),cy=i=>(i.mode??"show")!=="elide";function El(i,e){let t=new Set;for(let s of i.beats){if(!Number.isInteger(s.step)||s.step<1||s.step>e)throw new Error(`narrative ${i.id}: bad step ${s.step}`);if(t.has(s.step))throw new Error(`narrative ${i.id}: step ${s.step} twice`);if(t.add(s.step),!(s.t0>=0&&s.dur>=0&&s.t0+s.dur<=i.duration+1e-9))throw new Error(`narrative ${i.id}: step ${s.step} outside [0, ${i.duration}]`)}for(let s=1;s<=e;s++)if(!t.has(s))throw new Error(`narrative ${i.id}: step ${s} missing`);let n=rf(i);for(let s=1;s<n.length;s++)if(n[s].t0<n[s-1].t0-1e-9)throw new Error(`narrative ${i.id}: reorder, step ${n[s].step} starts before step ${n[s-1].step}`);let r=n.filter(cy);for(let s=1;s<r.length;s++){let a=r[s-1],o=r[s];if(Math.abs(a.t0-o.t0)<=1e-9&&o.step!==a.step+1)throw new Error(`narrative ${i.id}: simultaneous reveal of non-adjacent steps ${a.step} and ${o.step}`)}}function wh(i,e){let t=i.beats.find(n=>n.step===e);if(!t)throw new Error(`narrative ${i.id}: no step ${e}`);return t}function ia(i,e){let t=wh(i,e);return t.t0+t.dur}function di(i,e){return wh(i,e)}function sf(i,e){let t=rf(i),n=0;for(let a of t)if(a.t0<=e+1e-9)n=a.step;else break;if(n===0)return{executed:0,current:0,progress:0};let r=t[n-1],s=r.dur<=0||e>=r.t0+r.dur-1e-9?1:Math.max(0,(e-r.t0)/r.dur);return{executed:n,current:n,progress:s}}function af(i,e,t){let n=wh(i,e);return t<n.t0?0:n.dur<=0||t>=n.t0+n.dur-1e-9?1:(t-n.t0)/n.dur}var of={id:"crunchy-stage-show-v1",duration:18,beats:[{step:1,t0:.35,dur:.75},{step:2,t0:1.4,dur:.8},{step:3,t0:2.5,dur:.8},{step:4,t0:3.6,dur:1},{step:5,t0:4.65,dur:2.35},{step:6,t0:7.1,dur:1},{step:7,t0:8.4,dur:1},{step:8,t0:9.7,dur:1.4},{step:9,t0:9.7,dur:1.4},{step:10,t0:11.4,dur:1.1},{step:11,t0:12.8,dur:.9},{step:12,t0:14,dur:1}]},wl={id:"crunchy-studio-3d-v1",duration:18,beats:[{step:1,t0:.35,dur:.75},{step:2,t0:1.4,dur:.9},{step:3,t0:2.5,dur:.8},{step:4,t0:3.6,dur:1},{step:5,t0:4.65,dur:2.35},{step:6,t0:7.1,dur:1},{step:7,t0:8.4,dur:1},{step:8,t0:9.7,dur:.8},{step:9,t0:10.6,dur:.9},{step:10,t0:11.8,dur:1.1},{step:11,t0:13.1,dur:.8},{step:12,t0:14.1,dur:1}]},tt=15.4;var Tl=null,Th=[];function Ah(i){Tl=i}function Rh(){Tl=null}function Al(){let i=Th;return Th=[],i}function cf(i){return i==="photo"||i==="drawn"||i==="graphic"?i:"unlabeled"}function hy(i){let e=[];for(let t of Object.values(i))if(t&&t.isTexture){let n=t.userData.co??{};e.push({asset_id:n.asset_id??null,cls:cf(n.cls),sha256:n.sha256??null})}return e}var lf=!1;function Ch(){lf||(lf=!0,wt.prototype.onBeforeRender=function(...i){let e=i[4];if(Tl===null||!e||!e.isMaterial)return;let t=e.userData.co??{};Th.push({pass:Tl,object:this.name,material:e.name,material_cls:cf(t.cls),part_id:typeof t.part_id=="number"?t.part_id:null,textures:hy(e),color_write:e.colorWrite})})}function Rl(i){i.traverse(e=>{if(Object.prototype.hasOwnProperty.call(e,"onBeforeRender"))throw new Error(`drawlog: ${e.name} overrides onBeforeRender`)})}function Ph(i,e,t){let n=i*e;for(let l of t){if(!Number.isInteger(l.part_id)||l.part_id<1||l.part_id>65534)throw new Error(`ids: bad part_id ${l.part_id}`);if(l.coverage.length!==n)throw new Error(`ids: coverage length ${l.coverage.length} != ${n}`)}let r=new Uint16Array(n*4),s=new Uint16Array(n*4),a=0,o=[];for(let l=0;l<n;l++){o.length=0;for(let h of t)h.coverage[l]>0&&o.push({part_id:h.part_id,coverage:h.coverage[l]});o.sort((h,u)=>u.coverage-h.coverage||h.part_id-u.part_id);let c=o;o.length>4&&(c=[...o.slice(0,3),{part_id:65535,coverage:0}],a++);for(let h=0;h<c.length;h++){let u=h<2?r:s,d=l*4+h%2*2;u[d]=c[h].part_id,u[d+1]=c[h].coverage}}return{a:r,b:s,overflow_pixels:a}}function uy(i){let e=i.filter(r=>r.alpha>0).sort((r,s)=>r.depth-s.depth||r.part_id-s.part_id),t=[],n=1;for(let r of e){if(n<=0)break;t.push({part_id:r.part_id,cls:r.cls,coverage:r.alpha*n,rgb:[r.rgb[0]*n,r.rgb[1]*n,r.rgb[2]*n]}),n*=1-r.alpha}return t}var hf=i=>Math.min(255,Math.max(0,Math.round(i*255)));function Ih(i,e,t){let n=i*e,r=t.map(l=>({part_id:l.part_id,coverage:new Uint16Array(n)})),s=new Map(t.map((l,c)=>[l.part_id,c])),a=new Uint8Array(n*4),o=new Uint8Array(n*4);for(let l=0;l<n;l++){let c=t.map(u=>({part_id:u.part_id,cls:u.cls,alpha:u.color[l*4+3]/255,depth:u.depth[l],rgb:[u.color[l*4]/255,u.color[l*4+1]/255,u.color[l*4+2]/255]})),h={photo:[0,0,0,0],drawn:[0,0,0,0]};for(let u of uy(c)){r[s.get(u.part_id)].coverage[l]=Math.round(u.coverage*65535);let d=h[u.cls];d[0]+=u.rgb[0],d[1]+=u.rgb[1],d[2]+=u.rgb[2],d[3]+=u.coverage}for(let u=0;u<4;u++)a[l*4+u]=hf(h.photo[u]),o[l*4+u]=hf(h.drawn[u])}return{layers:r,photo:a,drawn:o}}function uf(i){let e="";for(let t=0;t<i.length;t+=32768)e+=String.fromCharCode(...i.subarray(t,t+32768));return btoa(e)}function dy(i,e){if(i===8)return new Uint8Array(e.buffer,e.byteOffset,e.byteLength);let t=e,n=new Uint8Array(t.length*2);for(let r=0;r<t.length;r++)n[r*2]=t[r]&255,n[r*2+1]=t[r]>>>8;return n}function fy(i){return ir(Ml({pass:i.pass,run_id:i.run_id,frame:i.frame,t:i.t,pixel_sha256:i.pixel_sha256}))}function ra(i,e,t,n,r,s,a,o){let l=dy(a,o),c=ir(l);return{pass:i,run_id:e,frame:t,t:n,width:r,height:s,depth:a,pixel_sha256:c,bind_sha256:fy({pass:i,run_id:e,frame:t,t:n,pixel_sha256:c}),b64:uf(l)}}var rr=1e-9,py=["alphaMap","lightMap","aoMap","envMap","specularMap"];function my(i){let e=new ct(i.parameters.width,i.parameters.height,1,1);return{pos:e.attributes.position.array,uv:e.attributes.uv.array}}var df=(i,e)=>i.length===e.length&&Array.from(i).every((t,n)=>Math.abs(t-e[n])<1e-12);function Lh(i,e){let t=[];i.updateMatrixWorld(!0),e?.updateMatrixWorld(!0);let n=e?e.matrixWorldInverse.clone().copy(e.matrixWorld).invert():new je;return i.traverse(r=>{let s=r,a=s.material===void 0?[]:Array.isArray(s.material)?s.material:[s.material];for(let o of a){if(o.userData?.co?.cls!=="photo")continue;let l=w=>t.push(`photo:${r.name}: ${w}`);if(s.isMesh||l(`${r.type} is not a Mesh`),!o.isMeshBasicMaterial){l(`${o.type} (only unlit MeshBasicMaterial)`);continue}let c=o;c.toneMapped!==!1&&l("toneMapped must be false"),c.fog!==!1&&l("fog must be false"),c.vertexColors&&l("vertexColors"),c.color.getHex()!==16777215&&l(`tint ${c.color.getHexString()}`),c.blending!==Pi&&l(`blending ${c.blending} (only NormalBlending)`),c.premultipliedAlpha&&l("premultipliedAlpha must be false (sources are straight alpha)"),c.alphaTest>1/255&&l(`alphaTest ${c.alphaTest} would crop visible texels`);for(let w of py)c[w]&&l(`${w} present`);(Object.prototype.hasOwnProperty.call(c,"onBeforeCompile")||c.onBeforeCompile!==Cn.prototype.onBeforeCompile)&&l("shader hook (onBeforeCompile)"),(s.castShadow||s.receiveShadow)&&l("shadows");let h=c.map;h?(h.colorSpace!==Zt&&l(`texture colorSpace ${h.colorSpace} (identity path: NoColorSpace)`),h.premultiplyAlpha&&l("texture premultiplyAlpha"),h.flipY&&l("texture flipY (the loader orders rows)"),(h.magFilter!==ut||h.minFilter!==ut)&&l("filter must be nearest"),h.generateMipmaps&&l("mipmaps"),(h.wrapS!==yn||h.wrapT!==yn)&&l("wrap must clamp"),h.matrixAutoUpdate&&h.updateMatrix(),h.matrix.equals(new Ge)||l("texture transform (offset/repeat/rotation)")):l("no texture: a photo part draws exactly its source");let u=s.geometry;if(!u||u.type!=="PlaneGeometry")l(`geometry ${u?.type} (only PlaneGeometry)`);else{(u.parameters.widthSegments!==1||u.parameters.heightSegments!==1)&&l("segmented plane");let w=my(u);df(u.attributes.position.array,w.pos)||l("displaced vertices"),(!u.attributes.uv||!df(u.attributes.uv.array,w.uv))&&l("UVs changed"),Object.keys(u.morphAttributes).length&&l("morph targets");let T=h?.image;if(T?.width&&T?.height){let y=u.parameters.width/T.width,b=u.parameters.height/T.height;Math.abs(y-b)>rr*Math.max(1,y)&&l(`plane ${u.parameters.width}x${u.parameters.height} stretches a ${T.width}x${T.height} texture (non-uniform texel scale)`)}}let d=new je().multiplyMatrices(n,s.matrixWorld).elements,f=[d[0],d[1],d[2]],g=[d[4],d[5],d[6]],v=[d[8],d[9],d[10]];(Math.abs(f[2])>rr||Math.abs(g[2])>rr||Math.abs(v[0])>rr||Math.abs(v[1])>rr||v[2]<=0)&&l("not in the image plane (tilt)");let m=Math.hypot(f[0],f[1]),p=Math.hypot(g[0],g[1]);Math.abs(m-p)>rr*Math.max(1,m)&&l(`non-uniform scale ${m}/${p}`),Math.abs(f[0]*g[0]+f[1]*g[1])>rr*Math.max(1,m*p)&&l("shear"),f[0]*g[1]-f[1]*g[0]<=0&&l("mirrored")}}),t}var eE=1/16;var tE=1/16;function ff(i,e,t,n){let r=i.material,s=i.geometry,a=r.map,o=a?.image??{},l=o.width??0,c=o.height??0,{width:h,height:u}=s.parameters;i.updateWorldMatrix(!0,!1),e.updateMatrixWorld(!0);let d=(p,w)=>{let T=new D(l?p/l*h-h/2:0,c?u/2-w/c*u:0,0);return T.applyMatrix4(i.matrixWorld).project(e),[(T.x+1)/2*t,(1-T.y)/2*n]},f=d(0,0),g=d(1,0),v=d(0,1),m=[g[0]-f[0],g[1]-f[1],v[0]-f[0],v[1]-f[1],f[0],f[1]].map(p=>p+0);return{part_id:r.userData.co?.part_id??null,asset_sha256:a?.userData?.co?.sha256??null,tex_w:l,tex_h:c,m,opacity:r.opacity}}function Uh(i,e,t){let n=t==="r-msb"?[0,1,2,3]:[3,2,1,0];return i[e*4+n[0]]/256+i[e*4+n[1]]/65536+i[e*4+n[2]]/16777216+i[e*4+n[3]]/4294967296}function sa(i,e,t){Ch();let{w:n,h:r}=t,s=new qt(n,r,{type:Wt,format:$t,depthBuffer:!0,stencilBuffer:!0,samples:0,minFilter:ut,magFilter:ut,generateMipmaps:!1}),a=()=>{let v=new Uint8Array(n*r*4);return i.readRenderTargetPixels(s,0,0,n,r,v),Yr(v,n,r)},o=new qt(n,r,{type:fn,format:$t,depthBuffer:!0,stencilBuffer:!0,samples:0,minFilter:ut,magFilter:ut,generateMipmaps:!1}),l=()=>{let v=new Float32Array(n*r*4);i.readRenderTargetPixels(o,0,0,n,r,v);let m=new Uint8Array(v.length);for(let p=0;p<v.length;p++)m[p]=Math.round(Math.min(1,Math.max(0,v[p]))*255);return Yr(m,n,r)},c=(()=>{let v=new vn,m=new In(-1,1,1,-1,.1,100);m.position.z=50;let p=new wi({depthPacking:zs}),w={"r-msb":[],"a-msb":[]};for(let b of[10,0,-20]){let S=new Oe(new ct(4,4),p);S.position.z=b,v.add(S),i.setRenderTarget(s),i.setClearColor(16777215,1),i.clear(!0,!0,!0),i.render(v,m);let C=a(),_=(r>>1)*n+(n>>1);for(let E of["r-msb","a-msb"])w[E].push(Uh(C,_,E));v.remove(S)}i.setRenderTarget(null);let T=b=>(50-b-.1)/(100-.1),y=["r-msb","a-msb"].filter(b=>[10,0,-20].every((S,C)=>Math.abs(w[b][C]-T(S))<.01));if(y.length!==1)throw new Error(`crunchy: depth calibration failed ${JSON.stringify(w)}`);return y[0]})(),h=e.camera;function u(v,m,p=!1){let w=p?e.hud.camera:h;w.layers.disableAll();for(let T of m)w.layers.enable(T);i.setRenderTarget(v),i.render(p?e.hud.scene:e.scene,w)}function d(){e.shadows&&(i.shadowMap.autoUpdate=!1,i.shadowMap.needsUpdate=!0,h.layers.set(Ye.lightsOnly),i.setRenderTarget(null),i.render(e.scene,h))}function f(v){let m=i.getDrawingBufferSize(new De);e.viewport?.(m.y),e.pose(v),Sh(e.registry),d(),i.autoClear=!1,i.setRenderTarget(null),i.setClearColor(e.background,1),i.clear(!0,!0,!0),u(null,[Ye.stage]),u(null,[Ye["fx-back"]]),u(null,[Ye.photo,Ye.drawn]),u(null,[Ye["fx-front"]]),u(null,[Ye.ui],!0)}function g(v,m,p){Rl(e.scene),Rl(e.hud.scene),e.viewport?.(r),e.pose(v),Sh(e.registry),d(),Al(),i.autoClear=!1;let w=[],T=(P,F)=>w.push(ra(P,p,m,v,n,r,8,F)),y=(P,F)=>{Ah(P);try{F()}finally{Rh()}},b=(P=s)=>{i.setRenderTarget(P),i.setClearColor(0,0),i.clear(!0,!0,!0)},S=(P=s)=>{i.setRenderTarget(P),i.setClearColor(0,0),i.clear(!0,!1,!1)};b(o),y("stage",()=>u(o,[Ye.stage])),T("stage",l()),b(o),y("fx-back",()=>u(o,[Ye["fx-back"]])),T("fx-back",l()),b(o),y("food",()=>u(o,[Ye.photo,Ye.drawn])),T("food",l()),S(o),y("fx-front",()=>u(o,[Ye["fx-front"]])),T("fx-front",l()),S(o),y("ui",()=>u(o,[Ye.ui],!0)),T("ui",l());let C=Lh(e.scene,e.camera),_=[];for(let P of e.registry.parts){if(P.cls!=="photo")continue;let F=P.objects.filter(U=>U.visible&&pf(U));F.length>1&&C.push(`photo:${P.name}: a photo part is drawn by ${F.length} objects (one plane per part)`),F.length===1&&_.push(ff(F[0],e.camera,n,r))}let E=[];for(let P of e.registry.parts){let F=P.objects.filter(q=>q.visible&&pf(q));if(F.length===0)continue;let U=P.cls==="photo"?"food-photo":"food-drawn",H=F.map(q=>q.material);for(let q of F)q.layers.enable(Ye.isolate);try{b(),y(U,()=>u(s,[Ye.isolate]));let q=a();for(let G of F)G.material=P.depthMat;i.setRenderTarget(s),i.setClearColor(16777215,1),i.clear(!0,!0,!0),y(U,()=>u(s,[Ye.isolate]));let Y=a(),ce=new Float32Array(n*r);for(let G=0;G<ce.length;G++)ce[G]=Uh(Y,G,c);E.push({part_id:P.part_id,cls:P.cls,color:q,depth:ce})}finally{F.forEach((q,Y)=>{q.material=H[Y],q.layers.disable(Ye.isolate)})}}i.setRenderTarget(null);let I=Ih(n,r,E);T("food-photo",I.photo),T("food-drawn",I.drawn);let N=Ph(n,r,I.layers);return w.push(ra("ids-a",p,m,v,n,r,16,N.a)),w.push(ra("ids-b",p,m,v,n,r,16,N.b)),{run_id:p,frame:m,t:v,passes:w,draws:Al(),ids_overflow_pixels:N.overflow_pixels,law:C,placements:_}}return{renderBeauty:f,renderLayers:g,depthOrder:c}}function pf(i){for(let e=i;e;e=e.parent)if(!e.visible)return!1;return!0}function mf(i,e){if(!e)return i;let t=i.pose.bind(i);return i.pose=n=>{t(n),e(i,n)},i}var Ct={w:540,h:960},Oi='system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',En={red:"#FF3A44",ink:"#141414",cream:"#FFF9E4",gold:"#FFE560"},gf={pillBg:En.cream,pillFg:En.ink,accent:En.red,kicker:En.gold,rail:"rgba(255,249,228,0.22)",railOn:En.gold},xf={pillBg:"rgba(20,20,20,0.82)",pillFg:En.cream,accent:En.red,kicker:"#e9dcc0",rail:"rgba(255,249,228,0.18)",railOn:En.red};function Cl(i,e,t,n){let r=new vn,s=new In(-Ct.w/2,Ct.w/2,Ct.h/2,-Ct.h/2,-10,10),a=2,o=(P,F,U,H,q)=>{let Y=Ni(Fi(Math.ceil(P*a),Math.ceil(F*a),J=>{J.scale(a,a),H(J)}),U),ce=Lt(new nn({map:Y,transparent:!0,depthTest:!1,depthWrite:!1,toneMapped:!1}),U,!0),G=new Oe(new ct(P,F),ce);return G.name=U,G.renderOrder=q,G.frustumCulled=!1,G.layers.set(Ye.ui),r.add(G),{mesh:G,w:P,h:F,mat:ce}},l=(P,F)=>{let U=document.createElement("canvas").getContext("2d");return U.font=P,U.measureText(F).width},c=`700 20px ${Oi}`,h=Math.ceil(l(c,"Compliments Only"))+32,u=o(h,34,"hud-wordmark",P=>{P.font=c,P.fillStyle=En.cream,P.textBaseline="middle",P.fillText("Compliments Only",24,17),P.fillStyle=En.red,P.beginPath(),P.arc(9,17,5,0,Math.PI*2),P.fill()},5),d=`800 44px ${Oi}`,f=Math.ceil(l(d,"Compliments Only"))+16,g=o(f,64,"hud-hero-wordmark",P=>{P.font=d,P.fillStyle=En.cream,P.textBaseline="middle",P.shadowColor="rgba(0,0,0,.55)",P.shadowBlur=14,P.fillText("Compliments Only",8,33)},6),v=`800 30px ${Oi}`,m=Math.ceil(l(v,"The Crunchy Boi"))+16,p=o(m,44,"hud-hero-name",P=>{P.font=v,P.fillStyle=En.gold,P.textBaseline="middle",P.shadowColor="rgba(0,0,0,.55)",P.shadowBlur=12,P.fillText("The Crunchy Boi",8,23)},6),w=`800 30px ${Oi}`,T=`700 13px ${Oi}`,y=i.map(P=>{let F=`STEP ${P.n} \xB7 ${P.action.toUpperCase()}`,U=P.name??P.label,H=P.amount,q=l(w,U),Y=H?l(`600 26px ${Oi}`,` \xB7 ${H}`):0,ce=Math.ceil(Math.max(q+Y,l(T,F)*1.05)+56),G=86;return o(ce+20,G+20,`hud-step-${P.key}`,J=>{J.shadowColor="rgba(0,0,0,.45)",J.shadowBlur=16,J.shadowOffsetY=5,J.fillStyle=t.pillBg,J.beginPath(),J.roundRect(10,8,ce,G,26),J.fill(),J.shadowColor="transparent",J.fillStyle=t.accent,J.font=T,J.textBaseline="middle",J.fillText(F,38,34),J.fillStyle=t.pillFg,J.font=w,J.fillText(U,38,66),H&&(J.font=`600 26px ${Oi}`,J.fillStyle=t.accent,J.fillText(` \xB7 ${H}`,38+q,67))},8)}),b=`800 34px ${Oi}`,S=Array.from({length:25},(P,F)=>o(90,56,`hud-tally-${F}`,U=>{U.fillStyle=t.accent,U.beginPath(),U.roundRect(4,4,82,48,24),U.fill(),U.font=b,U.fillStyle=En.cream,U.textAlign="center",U.textBaseline="middle",U.fillText(`\xD7${F}`,45,30)},9)),C=360,_=C/i.length,E=i.map((P,F)=>{let U=o(_-6,6,`hud-rail-on-${F}`,Y=>{Y.fillStyle=t.railOn,Y.beginPath(),Y.roundRect(0,0,_-6,6,3),Y.fill()},7),H=o(_-6,6,`hud-rail-off-${F}`,Y=>{Y.fillStyle=t.rail,Y.beginPath(),Y.roundRect(0,0,_-6,6,3),Y.fill()},7),q=-C/2+_*F+_/2;return U.mesh.position.set(q,-300,0),H.mesh.position.set(q,-300,0),{on:U,off:H}}),I=(P,F,U,H,q=1)=>{P.mesh.visible=H>.001,P.mesh.position.set(F,U,0),P.mesh.scale.setScalar(q),P.mat.opacity=H};function N(P,F){let U=_t(n,n+.5,P),H=ti(ft(.1,.6,P));I(u,0,440+10*(1-H),H*.92*(1-U));let{executed:q}=sf(e,P);E.forEach(({on:G,off:J},W)=>{let ue=W<q,pe=H*(1-U);I(G,G.mesh.position.x,-300,ue?pe:0),I(J,J.mesh.position.x,-300,ue?0:pe*.9)}),y.forEach((G,J)=>{let W=di(e,J+1),ue=i.map((Ce,qe)=>di(e,qe+1)).filter(Ce=>Math.abs(Ce.t0-W.t0)<1e-9).map(Ce=>Ce.step).sort((Ce,qe)=>Ce-qe),pe=ue.indexOf(J+1),Me=i.map((Ce,qe)=>di(e,qe+1).t0).filter(Ce=>Ce>W.t0+1e-9),Se=Me.length?Math.min(...Me):n,de=(W.mode??"show")!=="elide",X=Di(ft(W.t0+pe*.12,W.t0+pe*.12+.28,P)),ne=_t(Se-.05,Se+.15,P),ye=de&&P>=W.t0?sn(X*1.3)*(1-ne):0,Pe=ue.length>1?.78:1,_e=ue.length>1?-352-pe*80:-372;I(G,0,_e-24*(1-X)+30*ne,ye,Pe)}),S.forEach(G=>{G.mesh.visible=!1});let Y=q>0?y[q-1]:null,ce=q>0?F(q,P):null;if(Y&&ce!==null&&ce>0&&Y.mat.opacity>.01){let G=S[Math.min(ce,S.length-1)];I(G,Y.w/2+28,-372,Y.mat.opacity,1)}I(g,0,-372-16*(1-ti(ft(n+.3,n+.8,P))),_t(n+.3,n+.6,P)),I(p,0,-318,_t(n+.55,n+.9,P))}return{scene:r,camera:s,pose:N}}function fi(i){let e=i>>>0;return()=>{e=e+1831565813>>>0;let t=e;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}}var gn=[1,229/255,96/255],Un=[1,249/255,228/255],Il=[1,58/255,68/255],sr=class{list=[];mat=null;points=null;add(e){this.list.push({life:.6,vel:[0,0,0],drag:2,grav:0,size:.2,type:0,col:gn,spin:0,...e})}puff(e,t,n,r,s,a,o,l=3,c=Un){for(let h=0;h<o;h++){let u=e()*6.28;this.add({t:t+e()*.03,life:.45+e()*.25,pos:[n+Math.cos(u)*a,r,s+Math.sin(u)*a*1.4],vel:[Math.cos(u)*(1.6+e()*2),.3+e()*.6,Math.sin(u)*(1.6+e()*2)],drag:4,size:.11+e()*.08,type:2,col:e()<.5?c:gn})}for(let h=0;h<l;h++){let u=e()*6.28;this.add({t:t+e()*.05,life:.4+e()*.3,pos:[n+Math.cos(u)*a*.8,r+.15,s+Math.sin(u)*a*1.2],vel:[Math.cos(u)*1.2,1.4+e(),Math.sin(u)*1.2],drag:2.5,grav:-1.5,size:.3+e()*.25,type:0,spin:(e()-.5)*4})}}build(e,t,n,r,s){let a=this.list.length,o=new Float32Array(a*3),l=new Float32Array(a*3),c=new Float32Array(a*4),h=new Float32Array(a*4),u=new Float32Array(a*3);this.list.forEach((v,m)=>{o.set(v.pos,m*3),l.set(v.vel,m*3),u.set(v.col,m*3),c.set([v.t,v.life,v.size,v.type],m*4),h.set([v.drag,v.grav,v.spin,0],m*4)});let d=new Tt;d.setAttribute("position",new Dt(o,3)),d.setAttribute("vel",new Dt(l,3)),d.setAttribute("meta",new Dt(c,4)),d.setAttribute("phys",new Dt(h,4)),d.setAttribute("pcol",new Dt(u,3));let f=new Rt({uniforms:{uTime:{value:0},uPx:{value:r()},uOrtho:{value:s?1:0}},vertexShader:`
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
      }`,transparent:!0,depthWrite:!1,depthTest:!1});Ll(f),Lt(f,e,n);let g=new _s(d,f);return g.name=e,g.frustumCulled=!1,g.renderOrder=200,g.layers.set(t),this.mat=f,this.points=g,g}pose(e,t){this.mat&&(this.mat.uniforms.uTime.value=e,this.mat.uniforms.uPx.value=t)}},Pl=class{constructor(e){this.parent=e}parent;rings=[];add(e,t,n,r,s,a,o,l=.05,c=1){let h=Lt(new Rt({uniforms:{uR:{value:0},uW:{value:l},uA:{value:0},uCol:{value:new D(...o)}},vertexShader:"varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",fragmentShader:`uniform float uR, uW, uA; uniform vec3 uCol; varying vec2 vUv;
      void main(){ float d = length(vUv-0.5)*2.0; float band = exp(-pow((d-uR)/uW, 2.0)); float inner = smoothstep(uR, 0.0, d)*0.12*uR;
        float a = (band+inner)*uA; if (a < 0.003) discard; gl_FragColor = vec4(uCol*a, a); }`,transparent:!0,depthWrite:!1,depthTest:!1}),`ring-${this.rings.length}`,!1);Ll(h);let u=new Oe(new ct(1,1).rotateX(-Math.PI/2),h);u.name=h.name,u.position.set(t,n,r),u.scale.setScalar(s),u.frustumCulled=!1,u.visible=!1,u.layers.set(Ye["fx-back"]),u.renderOrder=3,this.parent.add(u),this.rings.push({m:u,mat:h,t:e,dur:a,a:c,w:l})}pose(e){for(let t of this.rings){let n=e>=t.t&&e<=t.t+t.dur;if(t.m.visible=n,!n)continue;let r=ft(t.t,t.t+t.dur,e),s=t.mat.uniforms;s.uR.value=Mt(.04,.96,ti(r)),s.uA.value=t.a*(1-r)*(1-r)*_t(0,.08,r),s.uW.value=t.w*(1+r)}}};function Ll(i){i.blending=Ls,i.blendSrc=ji,i.blendDst=ji,i.blendSrcAlpha=ji,i.blendDstAlpha=Fr}function Bi(i){return fi(i)}var Jr=class extends Tt{constructor(e=(r,s,a)=>a.set(r,s,Math.cos(r)*Math.sin(s)),t=8,n=8){super(),this.type="ParametricGeometry",this.parameters={func:e,slices:t,stacks:n};let r=[],s=[],a=[],o=[],l=1e-5,c=new D,h=new D,u=new D,d=new D,f=new D,g=t+1;for(let v=0;v<=n;v++){let m=v/n;for(let p=0;p<=t;p++){let w=p/t;e(w,m,h),s.push(h.x,h.y,h.z),w-l>=0?(e(w-l,m,u),d.subVectors(h,u)):(e(w+l,m,u),d.subVectors(u,h)),m-l>=0?(e(w,m-l,u),f.subVectors(h,u)):(e(w,m+l,u),f.subVectors(u,h)),c.crossVectors(d,f).normalize(),a.push(c.x,c.y,c.z),o.push(w,m)}}for(let v=0;v<n;v++)for(let m=0;m<t;m++){let p=v*g+m,w=v*g+m+1,T=(v+1)*g+m+1,y=(v+1)*g+m;r.push(p,w,y),r.push(w,T,y)}this.setIndex(r),this.setAttribute("position",new nt(s,3)),this.setAttribute("normal",new nt(a,3)),this.setAttribute("uv",new nt(o,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}};var Dl=1,an=3.2,gy=.3,xy=.38,ar=.58,_y=0,Kt=Dl/2+_y;function lr(i,e,t=0){return new D(i*2*Kt*.96,t,e*(an/2)*.92)}function Ul(i,e,t){let n=Math.imul(i|0,374761393)+Math.imul(e|0,668265263)+Math.imul(t|0,1442695041)|0;return n=Math.imul(n^n>>>13,1274126177),n^=n>>>16,(n>>>0)/4294967296}function yy(i,e,t=0){let n=Math.floor(i),r=Math.floor(e),s=i-n,a=e-r,o=s*s*(3-2*s),l=a*a*(3-2*a),c=Ul(n,r,t),h=Ul(n+1,r,t),u=Ul(n,r+1,t),d=Ul(n+1,r+1,t);return c+(h-c)*o+(u-c)*l+(c-h-u+d)*o*l}function Jt(i,e,t=0,n=4){let r=0,s=.5,a=1,o=0;for(let l=0;l<n;l++)r+=s*yy(i*a,e*a,t+l*17),o+=s,a*=2.03,s*=.5;return r/o}var wn=(i,e,t)=>{let n=sn((t-i)/(e-i));return n*n*(3-2*n)},or=(i,e)=>Math.sign(i)*Math.pow(Math.abs(i),e),yt=i=>{let e=parseInt(i.slice(1),16);return[e>>16&255,e>>8&255,e&255]};function Ht(i,e,t,n){for(let r=0;r<3;r++)n[r]=i[r]+(e[r]-i[r])*t;return n}function Kr(i,e,t,n){let r=document.createElement("canvas");r.width=e,r.height=t;let s=document.createElement("canvas");s.width=e,s.height=t;let a=r.getContext("2d").createImageData(e,t),o=s.getContext("2d").createImageData(e,t),l=[0,0,0];for(let u=0;u<t;u++)for(let d=0;d<e;d++){let f=n(d/e,u/t,l),g=(u*e+d)*4;a.data[g]=l[0],a.data[g+1]=l[1],a.data[g+2]=l[2],a.data[g+3]=255;let v=sn(f)*255;o.data[g]=o.data[g+1]=o.data[g+2]=v,o.data[g+3]=255}r.getContext("2d").putImageData(a,0,0),s.getContext("2d").putImageData(o,0,0);let c=Eh(new Si(r),`drawn:${i}`);c.colorSpace=Vt,c.anisotropy=4;let h=Eh(new Si(s),`drawn:${i}-bump`);return h.colorSpace=Zt,{map:c,bump:h}}function Dh(i,e){i.computeVertexNormals();let t=i.attributes.position,n=i.attributes.normal,r=0;for(let s=0;s<t.count;s++)r+=(t.getX(s)-e.x)*n.getX(s)+(t.getY(s)-e.y)*n.getY(s)+(t.getZ(s)-e.z)*n.getZ(s);if(r<0&&i.index){let s=i.index.array;for(let a=0;a<s.length;a+=3){let o=s[a+1];s[a+1]=s[a+2],s[a+2]=o}i.index.needsUpdate=!0,i.computeVertexNormals()}return i}function Nl({rings:i=10,segs:e=48,R:t=.5,radius:n,disp:r,thick:s}){let a=[],o=[],l=[],c=(b,S,C)=>(a.push(b,S,C),o.push(b/(2*t)+.5,C/(2*t)+.5),a.length/3-1),h=[];for(let b of[1,-1]){let S=c(0,r(0,0)+b*s(0,0,0)/2,0),C=[];for(let _=1;_<=i;_++){let E=_/i,I=[];for(let N=0;N<e;N++){let P=N/e*Math.PI*2,F=E*n(P),U=F*Math.cos(P),H=F*Math.sin(P);I.push(c(U,r(U,H)+b*s(U,H,E)/2,H))}C.push(I)}h.push({c:S,rows:C,sgn:b})}let u=new D,d=new D,f=new D,g=new D,v=(b,S)=>S.set(a[b*3],a[b*3+1],a[b*3+2]),m=(b,S,C,_)=>{v(b,u),v(S,d),v(C,f),g.subVectors(d,u).cross(f.clone().sub(u)),_(g,u)<0?l.push(b,C,S):l.push(b,S,C)};for(let{c:b,rows:S,sgn:C}of h){let _=E=>E.y*C;for(let E=0;E<e;E++){let I=(E+1)%e;m(b,S[0][E],S[0][I],_);for(let N=0;N<i-1;N++){let P=S[N][E],F=S[N][I],U=S[N+1][E],H=S[N+1][I];m(P,U,H,_),m(P,H,F,_)}}}let p=h[0].rows[i-1],w=h[1].rows[i-1],T=(b,S)=>b.x*S.x+b.z*S.z;for(let b=0;b<e;b++){let S=(b+1)%e;m(p[b],w[b],w[S],T),m(p[b],w[S],p[S],T)}let y=new Tt;return y.setAttribute("position",new nt(a,3)),y.setAttribute("uv",new nt(o,2)),y.setIndex(l),y.computeVertexNormals(),y}function _f(){let i=C=>Kr(C?"crust-top":"crust-bottom",512,256,(_,E,I)=>{let N=Math.sin(E*Math.PI),P=Jt(_*38,E*11,C?31:32,5),F=Jt(_*150,E*44,33,3);C?(Ht(yt("#e8c88f"),yt("#bd7832"),wn(.05,.75,N),I),Ht(I,yt("#9a5a22"),wn(.45,.8,P)*wn(.3,1,N)*.7,I)):(Ht(yt("#e6c68e"),yt("#caa062"),wn(.2,1,N),I),Ht(I,yt("#b98446"),wn(.6,.9,P)*.45,I));let U=.92+.16*P;return I[0]*=U,I[1]*=U,I[2]*=U,F>.8&&Ht(I,yt("#f0dcb4"),(F-.8)*1.4,I),.55*P+.45*F}),e=Kr("crumb",256,768,(C,_,E)=>{let I=Jt(C*70,_*55,41,4),N=Jt(C*6,_*14,42,4);Ht(yt("#dccba4"),yt("#efe2c4"),I*.7+N*.3,E);let P=Math.pow(Math.pow(Math.abs((C-.5)*2),2/ar)+Math.pow(Math.abs((_-.5)*2),2/ar),ar/2);return Ht(E,yt("#e3c793"),wn(.8,.95,P)*.7,E),Ht(E,yt("#c28a45"),wn(.955,.985,P),E),.55+(I-.5)*.6}),t=(C,_)=>mn(new Yt({map:C.map,bumpMap:C.bump,bumpScale:1.2,roughness:.72}),_),n=mn(new Yt({map:e.map,bumpMap:e.bump,bumpScale:2,roughness:.93,side:Ft}),"drawn-crumb"),r=i(!0),s=i(!1),a=.16,o=(C,_)=>Math.sign(C)===_?a:ar,l=C=>{let _=C?xy:gy,E=C?.62:.42,I=new Jr((F,U,H)=>{let q=F*Math.PI*2-Math.PI,Y=U*Math.PI/2,ce=Math.cos(Y),G=Math.sin(Y),J=Dl/2*or(ce,E)*or(Math.cos(q),o(Math.cos(q),-1)),W=an/2*or(ce,E)*or(Math.sin(q),ar),ue=_*or(G,E),pe=1+(Jt(J*3+5,W*3,C?5:6,2)-.5)*.08*G;J*=pe,W*=pe,ue*=pe*(C?1+.035*Math.sin(W*5.2+.4)*G*G:1),H.set(J,C?ue:-ue,W)},96,20),N=I.attributes.position,P=I.attributes.uv;for(let F=0;F<N.count;F++)P.setXY(F,N.getZ(F)/an+.5,sn(Math.abs(Math.atan2(N.getY(F),N.getX(F)))/Math.PI));return Dh(I,new D(0,C?_*.3:-_*.3,0))},c=(C,_,E)=>{let I=new Jr((F,U,H)=>{let q=F*Math.PI*2-Math.PI,Y=U,ce=Y*(Dl/2)*.985*or(Math.cos(q),o(Math.cos(q),E)),G=Y*(an/2)*.985*or(Math.sin(q),ar),J=-.004-C*(1-Math.pow(Y,4))+(Jt(ce*9,G*9,8,2)-.5)*.012*(1-Y);_&&(J-=.17*Math.exp(-Math.pow(ce/.22,4))*wn(.97,.7,Math.abs(G)/(an/2))*(.85+.3*Jt(G*4,1,9,2))),H.set(ce,J,G)},72,18),N=I.attributes.position,P=I.attributes.uv;for(let F=0;F<N.count;F++)P.setXY(F,N.getX(F)/Dl+.5,N.getZ(F)/an+.5);return Dh(I,new D(0,-1,0))},h=new Ut,u=new Ut;u.position.x=Kt,h.add(u);let d=new Oe(l(!1),t(s,"drawn-crust-bottom")),f=new Oe(c(.03,!1,-1),n);u.add(d,f);let g=new Ut;h.add(g);let v=new Ut;v.position.x=-Kt,g.add(v);let m=new Oe(l(!0),t(r,"drawn-crust-top"));m.rotation.z=Math.PI;let p=new Oe(c(.03,!1,1),n),w=new Oe(c(.03,!0,1),n);v.add(m,p,w);let T=new Zn(new Es(.035,0),mn(new Yt({color:kt("#e9d6aa"),roughness:.95}),"drawn-crumb-bits"),40);T.instanceMatrix.setUsage(kr),h.add(T);let y=new Jr((C,_,E)=>{let I=(C-.5)*an*.97,N=Math.pow(Math.max(0,1-Math.pow(Math.abs(I)/(an/2),2/ar)),.5),P=_*Math.PI*2,F=.028*N;E.set(Math.cos(P)*F,-.03*N+Math.sin(P)*F*.8,I)},64,12),b=new Oe(Dh(y,new D(0,-.03,0)),t(s,"drawn-crust-hinge"));h.add(b);let S=[d,f,m,p,w,T,b];for(let C of S)C.castShadow=!0,C.receiveShadow=!0;return{group:h,hinge:g,meshes:S,crumbTopFlat:p,crumbTopGut:w,crumbs:T,hingeCrust:b,bottom:u,top:v}}function vy(){return Kr("chip",256,256,(i,e,t)=>{let n=i-.5,r=e-.5,s=Math.sqrt(n*n+r*r)*2,a=Jt(i*6,e*6,701,4),o=Jt(i*30,e*30,702,3);return Ht(yt("#f3d273"),yt("#e3ad45"),a,t),o>.66&&Ht(t,yt("#b57b2c"),(o-.66)*2.4,t),Ht(t,yt("#d39a3a"),wn(.75,.95,s)*.6,t),.5+(o-.5)*.6+.12*Math.sin((n*.8+r*.6)*90)})}function by(i){return Array.from({length:i},(e,t)=>{let n=fi(710+t),r=n()*Math.PI,s=Math.cos(r),a=Math.sin(r),o=.8+n()*.9,l=-.3-n()*.8,c=n()*6,h=.82+n()*.18;return Nl({R:.26,rings:10,segs:48,radius:u=>(.23+(Jt(Math.cos(u)*1.8+t*3,Math.sin(u)*1.8,720+t,3)-.5)*.09)*(Math.abs(Math.cos(u))*(1-h)+h),disp:(u,d)=>{let f=u*s+d*a,g=-u*a+d*s;return .012*Math.sin(g*52+c)+o*f*f*.5+l*g*g*.5},thick:(u,d,f)=>.011*(1-.4*Math.pow(f,6))})})}function Fl(i){let e=mn(new bn({color:kt("#f6efd8"),roughness:.2,clearcoat:1,clearcoatRoughness:.08,emissive:kt("#1c1812"),emissiveIntensity:.2}),"drawn-aioli"),t=[];for(let ue=0;ue<=13;ue++){let pe=Mt(-1.3,1.3,ue/13),Me=-Kt+(ue%2?1:-1)*.09*(.6+.4*Math.sin(ue*2.3));t.push(new D(Me,-.1,pe))}let n=new Ur(t,!1,"centripetal"),r=260,s=10,a=new Ts(n,r,.05,s,!1),o={mesh:new Oe(a,e),curve:n,segs:r,rad:s},l=vy(),c=mn(new bn({map:l.map,bumpMap:l.bump,bumpScale:1.4,roughness:.28,clearcoat:.65,clearcoatRoughness:.25,emissive:kt("#4a3008"),emissiveIntensity:.12,side:Ft}),"drawn-chips"),h=by(4),u=i.chips.map(ue=>new Oe(h[ue.i%4],c)),d=Kr("provolone",256,256,(ue,pe,Me)=>{let Se=Jt(ue*7,pe*7,81,4);return Ht(yt("#f3e4b6"),yt("#ead38f"),Se*.8,Me),.5+(Jt(ue*40,pe*40,82,3)-.5)*.3}),f=mn(new bn({map:d.map,bumpMap:d.bump,bumpScale:.6,roughness:.4,clearcoat:.25,emissive:kt("#40361a"),emissiveIntensity:.08,side:Ft}),"drawn-provolone"),g=[-.62,.62].map((ue,pe)=>{let Me=fi(200+pe),Se=Me()*6;return new Oe(Nl({R:.56,rings:10,segs:56,radius:de=>.5+.012*Math.sin(de*3+Se),disp:(de,X)=>-.25*Math.pow(Math.max(0,Math.abs(de)-.34),1.2)+.012*Math.sin(X*6+Se),thick:(de,X,ne)=>.014*(1-.5*Math.pow(ne,6))}),f)}),v=Kr("turkey",256,256,(ue,pe,Me)=>{let Se=Jt(ue*5,pe*5,51,4),de=Jt(ue*8,pe*8,52,3),X=.5+.5*Math.sin((ue*.9+pe*.35)*90+de*16);Ht(yt("#e8cfbb"),yt("#d6b19b"),Se,Me),Ht(Me,yt("#cfa590"),X*.1,Me);let ne=Math.hypot(ue-.5,pe-.5)*2;return Ht(Me,yt("#c39468"),wn(.78,.96,ne)*.6,Me),.5+(X-.5)*.35}),m=mn(new bn({map:v.map,bumpMap:v.bump,bumpScale:1.5,roughness:.58,clearcoat:.15,sheen:.6,sheenRoughness:.5,sheenColor:kt("#ffc9b4"),emissive:kt("#4a1a10"),emissiveIntensity:.05,side:Ft}),"drawn-turkey"),p=[-.95,0,.95].map((ue,pe)=>{let Me=fi(100+pe),Se=Me()*6,de=Me()*6;return new Oe(Nl({R:.62,rings:12,segs:60,radius:X=>(.55+(Jt(Math.cos(X)*1.6+4,Math.sin(X)*1.6+pe,60+pe,3)-.5)*.18)*(1+.12*Math.cos(2*X)),disp:(X,ne)=>-.08*Math.pow(Math.max(0,Math.abs(X)-.34),1.3)+.06*Math.sin(ne*5.5+Se)+.03*Math.sin(X*5+de+ne*2)+(Jt(X*4+9,ne*4,70+pe,3)-.5)*.09,thick:(X,ne,ye)=>.016*(1-.6*Math.pow(ye,5))}),m)}),w=mn(new bn({color:kt("#efe4ea"),roughness:.14,clearcoat:1,clearcoatRoughness:.05,emissive:kt("#2a2030"),emissiveIntensity:.15}),"drawn-onions"),T=[],y=[[-1.05,.08],[-.38,-.12],[.3,.1],[.98,-.06]].map(([ue,pe],Me)=>{let Se=new Ut,de=fi(400+Me);return[.15,.115,.082].forEach((X,ne)=>{let ye=new ws(X,.012-ne*.0015,8,40);ye.rotateX(Math.PI/2),ye.scale(1+(de()-.5)*.18,.5,1+(de()-.5)*.18);let Pe=new Oe(ye,w);Pe.position.set((de()-.5)*.03,.004*ne,(de()-.5)*.03),Se.add(Pe),T.push(Pe)}),Se.userData={zc:ue,xc:pe,yaw:de()*6},Se}),b=Kr("pickle",256,256,(ue,pe,Me)=>{let Se=ue-.5,de=pe-.5,X=Math.sqrt(Se*Se+de*de)*2,ne=Math.atan2(de,Se),ye=Jt(ue*10,pe*10,91,4);Ht(yt("#dcd276"),yt("#aeaa3e"),wn(.1,.8,X)*.8+ye*.25,Me);let Pe=.42+.05*Math.sin(ne*3),_e=(ne/(Math.PI*2)*11%1+1)%1,Ce=Math.exp(-Math.pow((_e-.5)*5,2))*Math.exp(-Math.pow((X-Pe)*16,2));return Ht(Me,yt("#f1ebbd"),Ce*.85,Me),Ht(Me,yt("#6f7c26"),wn(.8,.9,X),Me),Ht(Me,yt("#3c4a12"),wn(.9,.96,X),Me),.5+Ce*.3}),S=mn(new bn({map:b.map,bumpMap:b.bump,roughness:.22,clearcoat:1,clearcoatRoughness:.06,emissive:kt("#2a3006"),emissiveIntensity:.15}),"drawn-pickles"),C=[0,1].map(ue=>{let pe=fi(500+ue),Me=pe()*6;return Nl({R:.15,rings:7,segs:44,radius:Se=>.135+.008*Math.sin(Se*2+Me),disp:Se=>.007*Math.sin(Se*78),thick:(Se,de,X)=>.032*(1-.35*Math.pow(X,6))})}),_=i.pickles.map(ue=>new Oe(C[ue.i%2],S)),E=mn(new bn({roughness:.35,clearcoat:.6,clearcoatRoughness:.2,emissive:kt("#1c2a08"),emissiveIntensity:.12,side:Ft}),"drawn-shredduce"),I=5,N=Math.ceil(i.strands.length/I),P=["#f4f6de","#e8f0c0","#d9e8a2","#c8de86","#b3d06a","#98bf50"].map(ue=>kt(ue)),F=Array.from({length:I},(ue,pe)=>{let Me=fi(310+pe),Se=.3+Me()*.14,de=.026+Me()*.01,X=new ct(de,Se,2,12);X.rotateX(-Math.PI/2);let ne=X.attributes.position,ye=.015+Me()*.02,Pe=7+Me()*8,_e=Me()*6,Ce=(Me()-.5)*3,qe=(Me()-.5)*.35;for(let ze=0;ze<ne.count;ze++){let Xe=ne.getX(ze),ke=ne.getZ(ze),Qe=ke/Se,gt=Ce*Qe;ne.setXYZ(ze,Xe*Math.cos(gt)+.035*Math.sin(Qe*3.3+_e),ye*Math.sin(Qe*Pe+_e)+qe*Qe*Qe+Xe*Math.sin(gt),ke)}X.computeVertexNormals();let Be=new Zn(X,E,N);return Be.instanceMatrix.setUsage(kr),Be}),U=i.strands.map((ue,pe)=>({p:ue,k:Math.floor(pe/I),v:pe%I}));for(let ue of U)F[ue.v].setColorAt(ue.k,P[ue.p.i%P.length]);for(let ue of F)ue.instanceColor&&(ue.instanceColor.needsUpdate=!0);let H=mn(new bn({color:kt("#6b4a1c"),roughness:.05,clearcoat:1}),"drawn-oil-streak"),q=new ct(.16,2.7,1,20);q.rotateX(-Math.PI/2);let Y=new Oe(q,H),ce=mn(new bn({color:kt("#c89a2c"),roughness:.02,clearcoat:1}),"drawn-oil-drops"),G=new Zn(new Yi(.02,10,8),ce,i.oilDrops.length);G.instanceMatrix.setUsage(kr);let J=new Zn(new bs(.009,4).rotateX(-Math.PI/2),mn(new Yt({roughness:.8,side:Ft}),"drawn-oregano"),i.oregano.length),W=["#4c5a26","#5f6d31","#3a4520","#6d6a36","#7b6a3c"].map(ue=>kt(ue));return i.oregano.forEach((ue,pe)=>J.setColorAt(pe,W[ue.variant])),J.instanceColor&&(J.instanceColor.needsUpdate=!0),J.instanceMatrix.setUsage(kr),{aioli:o,chips:u,provolone:g,turkey:p,onions:y,onionMeshes:T,pickles:_,strands:{meshes:F,data:U},oil:{streak:Y,drops:G},oregano:J}}var jr=5.2,Nh=jr*Ct.w/Ct.h,Ol=6.2,bf=1.72,Mf=2.85,My=1315860,aa=(i,e)=>[i*bf,e*Mf],Fh=i=>Math.round(i*1e4),yf={aioli:{u:-.46,v:0,long:.7,rot:.02},provolone:{u:-.3,v:0,long:.8,rot:0},turkey:{u:-.02,v:.02,long:.76,rot:.02},onions:{u:.02,v:-.05,long:.42,rot:.3},shredduce:{u:0,v:0,long:.92,rot:0},oregano:{u:.02,v:0,long:.34,rot:0}},Sy=.11,Ey=.09,vf={land:.8,maxFlight:.95};function Sf(i,e,t,n,r){let s=new vn,a=new $r,o=new In(-Nh,Nh,jr,-jr,1,100);o.position.set(0,40,0),o.up.set(0,0,-1),o.lookAt(0,0,0),s.add(o);let l=Object.fromEntries(i.map(A=>[A.key,A])),c=t.provolone,h=A=>c.reduce((k,V)=>k+A(V),0)/c.length,u={...yf,provolone:{u:h(A=>A.u),v:h(A=>A.v),long:yf.provolone.long,rot:h(A=>A.rot)*.5}},d=Object.fromEntries(n.steps.map(A=>[A.key,A])),f=Bi(24301),g=A=>new D(A[0],A[1],A[2]),v=Lt(new Rt({uniforms:{uTime:{value:0},uBurst:{value:0},uGlow:{value:1},uRed:{value:g(Il)},uGold:{value:g(gn)},uCream:{value:g(Un)}},vertexShader:"varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }",fragmentShader:`uniform float uTime, uBurst, uGlow; uniform vec3 uRed, uGold, uCream; varying vec3 vW;
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
    }`}),"stage-floor",!1),m=new Oe(new ct(60,60).rotateX(-Math.PI/2),v);m.name="stage-floor",m.position.y=-1,m.layers.set(Ye.stage),s.add(m);let p=2.3,w=1.75,T=`float sdStad(vec2 p){ p.y = abs(p.y) - ${w.toFixed(3)}; p.y = max(p.y, 0.0); return length(p) - ${p.toFixed(3)}; }`,y=Lt(new Rt({uniforms:{uSweep:{value:-10},uPulse:{value:0},uRed:{value:g(Il)},uGold:{value:g(gn)},uCream:{value:g(Un)}},vertexShader:"varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }",fragmentShader:`uniform float uSweep, uPulse; uniform vec3 uRed, uGold, uCream; varying vec3 vW; ${T}
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
    }`}),"stage-tray",!1),b=new Oe(new ct(2*p+1,2*(w+p)+1).rotateX(-Math.PI/2),y);b.name="stage-tray",b.position.y=0,b.layers.set(Ye.stage),s.add(b);let S=Lt(new Rt({vertexShader:"varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }",fragmentShader:`varying vec3 vW; ${T} void main(){ float d = sdStad(vW.xz - vec2(0.14, 0.2)); float a = 0.75*exp(-max(d,0.0)*2.6)*step(-0.3,d); gl_FragColor = vec4(0.0,0.0,0.0,a); }`,transparent:!0,depthWrite:!1}),"stage-tray-ao",!1),C=new Oe(new ct(16,20).rotateX(-Math.PI/2),S);C.name="stage-tray-ao",C.position.y=-.5,C.layers.set(Ye.stage),s.add(C);let _=Lt(new Rt({uniforms:{uTime:{value:0},uI:{value:0},uGold:{value:g(gn)},uCream:{value:g(Un)}},vertexShader:"varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",fragmentShader:`uniform float uTime, uI; uniform vec3 uGold, uCream; varying vec2 vUv;
    void main(){
      vec2 p = vec2(vUv.x*0.5625, vUv.y); vec2 d = p - vec2(-0.03, 1.1);
      float ang = atan(d.y, d.x), r = length(d);
      float b = pow(0.5+0.5*sin(ang*23.0 + uTime*0.35), 8.0) + 0.7*pow(0.5+0.5*sin(ang*37.0 - uTime*0.5 + 2.0), 12.0) + 0.5*pow(0.5+0.5*sin(ang*11.0 + uTime*0.2 + 4.0), 6.0);
      float a = b * exp(-r*1.35) * smoothstep(0.0, 0.25, r) * uI;
      gl_FragColor = vec4(mix(uCream, uGold, 0.5)*a, a);
    }`,transparent:!0,depthTest:!1,depthWrite:!1}),"fx-rays",!1);Ll(_);let E=new Oe(new ct(1,1),_);E.name="fx-rays",E.position.z=-20,E.renderOrder=2,E.frustumCulled=!1,E.layers.set(Ye["fx-back"]),o.add(E);let I=Ni(Fi(64,64,A=>{let k=A.createRadialGradient(32,32,0,32,32,32);k.addColorStop(0,"rgba(0,0,0,1)"),k.addColorStop(.55,"rgba(0,0,0,.6)"),k.addColorStop(1,"rgba(0,0,0,0)"),A.fillStyle=k,A.fillRect(0,0,64,64)}),"stage-blob"),N=new Map,P=new Map;function F(A,k,V,$,ae){let le=r.get(k);if(!le)throw new Error(`stage: texture ${k} not loaded`);let ie=le.image,ee=ie.width/ie.height,Z=$.h??1,he=Z*ee;$.long&&(ee>=1?(he=$.long,Z=he/ee):(Z=$.long,he=Z*ee));let ge=ef(le,`photo:${A}`),L=new Oe(new ct(he,Z),ge);L.rotation.set(-Math.PI/2,0,0,"YXZ"),L.name=`photo:${A}`,L.frustumCulled=!1,L.visible=!1,L.renderOrder=Fh(ae),s.add(L);let fe=a.add(V,"photo",[L],le);P.set(A,fe.part_id);let te=Lt(new nn({map:I,transparent:!0,depthWrite:!1,toneMapped:!1,opacity:0}),`shadow:${A}`,!1),ve=new Oe(new ct(he*1.02,Z*1.02).rotateX(-Math.PI/2),te);ve.name=`shadow:${A}`,ve.layers.set(Ye.stage),ve.visible=!1,ve.renderOrder=1,s.add(ve);let be={mesh:L,mat:ge,w:he,h:Z,shadow:ve,shMat:te,base:ae};return N.set(A,be),be}function U(A,k,V,$={}){let ae=$.op??1,le=$.s??1,ie=$.lift??0;A.mesh.visible=ae>.002,A.mesh.position.set(k,A.base+ie*.01,V),A.mesh.renderOrder=Fh(A.mesh.position.y),A.mesh.rotation.set(-Math.PI/2,$.rot??0,0,"YXZ"),A.mesh.scale.setScalar(le),A.mat.opacity=ae,A.req={rot:$.rot??0,s:le,op:ae},A.shadow.visible=A.mesh.visible,A.shadow.position.set(k+.07+ie*.5,.02,V+.12+ie*.4),A.shadow.rotation.set(0,$.rot??0,0),A.shadow.scale.setScalar(le*(1+ie*.15)),A.shMat.opacity=ae*.5*sn(1-ie*.5)}let H=A=>{A.mesh.visible=!1,A.shadow.visible=!1},q=A=>A.kind==="state"?`bread-${A.state}`:`build-state-${String(A.n).padStart(2,"0")}`,Y=i.filter(A=>d[A.key]?.state);Y.forEach(A=>F(`state:${A.key}`,d[A.key].state,q(A),{h:Ol},.1+A.n*.04));let ce=n.hero?F("hero",n.hero,"finished-3q",{long:5.5},2):null;for(let A of i){let k=d[A.key];!k||k.rep!=="photo"||k.add.length===0||A.key==="chips"||A.key==="pickles"||F(`add:${A.key}`,k.add[0],A.ingredient,{long:u[A.key].long*Ol},.1+A.n*.04-.02)}let G=d.chips?.rep==="photo"&&d.chips.add.length?t.chips.map(A=>F(`add:chips:${A.i}`,d.chips.add[A.variant%d.chips.add.length],l.chips.ingredient,{long:Sy*Ol*A.scale},.1+5*.04-.035+A.y*.1+A.i*4e-4)):[],J=d.pickles?.rep==="photo"&&d.pickles.add.length?t.pickles.map(A=>F(`add:pickles:${A.i}`,d.pickles.add[A.variant%d.pickles.add.length],l.pickles.ingredient,{long:Ey*Ol*A.scale},.1+9*.04-.02+A.i*.001)):[],W=new Set(n.drawnFood),ue=new Ut;ue.scale.set(bf/(2*Kt*.96),1.8,Mf/(an/2*.92)),ue.position.y=.28;let pe=A=>Fh(.1+A*.04+.02);s.add(ue);let Me=new Zi(16774108,2757652,1.1);Me.layers.enableAll(),s.add(Me);let Se=new Ci(16774370,2.2);Se.position.set(-3,12,4),Se.layers.enableAll(),s.add(Se);for(let A of W)if(l[A].kind==="state")throw new Error(`stage: bread state "${A}" has no photo and no drawn stand-in; refused`);let de=W.size?Fl(t):null;de&&W.has("chips")&&(de.chips.forEach((A,k)=>{A.name=`drawn:chip:${k}`,ue.add(A)}),de.chips.forEach(A=>{A.renderOrder=pe(l.chips.n)}),P.set("drawn:chips",a.add(l.chips.ingredient,"drawn",de.chips).part_id)),de&&W.has("shredduce")&&(de.strands.meshes.forEach((A,k)=>{A.name=`drawn:shredduce:${k}`,ue.add(A)}),de.strands.meshes.forEach(A=>{A.renderOrder=pe(l.shredduce.n)}),P.set("drawn:shredduce",a.add(l.shredduce.ingredient,"drawn",de.strands.meshes).part_id));let X=new Map;if(de){let A=new je,k=new tn,V=new D,$=new D,ae=new cn,le=ie=>{switch(ie){case"aioli":return de.aioli.mesh.position.set(0,.12,0),{objs:[de.aioli.mesh],meshes:[de.aioli.mesh]};case"provolone":return de.provolone.forEach((ee,Z)=>{let he=t.provolone[Z];ee.position.set(he.u*2*Kt*.96,.03+he.y+.1,he.v*(an/2)*.92),ee.rotation.set(0,he.rot,0)}),{objs:de.provolone,meshes:de.provolone};case"turkey":return de.turkey.forEach((ee,Z)=>{ee.position.set(.05,.1+Z*.022,(Z-1)*.95),ee.rotation.set(0,(Z-1)*.2,0)}),{objs:de.turkey,meshes:de.turkey};case"onions":return de.onions.forEach(ee=>{let Z=ee.userData;ee.position.set(Z.xc,.18,Z.zc),ee.rotation.set(0,Z.yaw,0)}),{objs:de.onions,meshes:de.onionMeshes};case"pickles":return de.pickles.forEach((ee,Z)=>{let he=t.pickles[Z];ee.position.set(he.u*2*Kt*.96,.2,he.v*(an/2)*.92),ee.rotation.set(0,he.rot,0)}),{objs:de.pickles,meshes:de.pickles};case"oil-vinegar":return de.oil.streak.position.set(.02,.5,0),t.oilDrops.forEach((ee,Z)=>{V.set(ee.u*2*Kt*.96,.52,ee.v*(an/2)*.92),k.identity(),$.set(ee.scale,ee.scale*.45,ee.scale),A.compose(V,k,$),de.oil.drops.setMatrixAt(Z,A)}),de.oil.drops.instanceMatrix.needsUpdate=!0,{objs:[de.oil.streak,de.oil.drops],meshes:[de.oil.streak,de.oil.drops]};case"oregano":return t.oregano.forEach((ee,Z)=>{V.set(ee.u*2*Kt*.96,.54,ee.v*(an/2)*.92),ae.set(.3,ee.rot,.2),k.setFromEuler(ae),$.set(ee.scale*1.6,ee.scale,ee.scale*.7),A.compose(V,k,$),de.oregano.setMatrixAt(Z,A)}),de.oregano.instanceMatrix.needsUpdate=!0,{objs:[de.oregano],meshes:[de.oregano]};default:throw new Error(`stage: no drawn stand-in for "${ie}"`)}};for(let ie of W){if(ie==="chips"||ie==="shredduce")continue;let{objs:ee,meshes:Z}=le(ie),he=new Ut;he.scale.set(ue.scale.x,.25,ue.scale.z),he.position.y=.1+l[ie].n*.04-.035,he.traverse(ge=>{ge.renderOrder=pe(l[ie].n)}),ee.forEach(ge=>he.add(ge)),Z.forEach((ge,L)=>{ge.name=`drawn:${ie}:${L}`}),s.add(he),P.set(`stand-in:${ie}`,a.add(l[ie].ingredient,"drawn",Z).part_id),X.set(ie,{g:he,objs:ee})}}let ne=new sr,ye=new sr,Pe=new Pl(s),_e=A=>di(e,l[A].n),Ce=(A,k,V,$,ae=!1)=>{Pe.add(A,k,.03,V,ae?11:7,ae?.9:.6,ae?gn:Un,ae?.03:.035,ae?.7:.45),ne.puff(f,A,k,.05,V,$,12,3),ye.puff(f,A,k,.3,V,$*1.15,6,2)};Ce(_e("whole").t0+_e("whole").dur*.6,0,0,1.6,!0),Ce(_e("slice").t0+_e("slice").dur*.5,0,0,2,!0),Ce(_e("gut").t0+_e("gut").dur*.5,-.9,0,1.2);for(let A of["aioli","provolone","turkey","onions","shredduce","oregano"]){let k=u[A],[V,$]=aa(k.u,k.v);Ce(_e(A).t0+_e(A).dur*.5,V,$,1.1)}Ce(_e("oil-vinegar").t0+.2,0,0,1.3);let qe=t.chips.map((A,k)=>{let V=Bi(50207+k);return{dur:Mt(.55,.95,V()),sx:Mt(-2.6,3.4,V()),sz:-6.6-V()*1.2,s:Mt(1.7,2.3,V()),spin:(V()<.5?-1:1)*Mt(2,6,V()),jit:(V()-.5)*.05}}),Be=t.chips.map((A,k)=>{let V=_e("chips"),$=t.chips.length,ae=V.dur*vf.land-vf.maxFlight-.04,le=V.t0+qe[k].dur+ae*Math.pow(k/Math.max(1,$-1),.85)+Math.abs(qe[k].jit)*.5,[ie,ee]=aa(A.u,A.v);Pe.add(le,ie,.03,ee,1.6,.32,gn,.07,.55);for(let Z=0;Z<3;Z++){let he=f()*6.28;ye.add({t:le,life:.5+f()*.3,pos:[ie,.5,ee],vel:[Math.cos(he)*2,2.5,Math.sin(he)*2],drag:1.2,grav:-9,size:.12,type:1,col:f()<.6?gn:Il,spin:(f()-.5)*20})}return le}),ze=t.pickles.map((A,k)=>_e("pickles").t0+.55+k*.07);Pe.add(tt+.1,0,.03,0,18,1.1,Un,.03,.9);for(let A=0;A<40;A++){let k=A/40*6.28;ye.add({t:tt+.1+f()*.05,life:.6+f()*.5,pos:[Math.cos(k)*2.9,.9,Math.sin(k)*1.9],vel:[Math.cos(k)*3,1,Math.sin(k)*3],drag:2.5,size:.3+f()*.3,type:0,col:f()<.7?gn:Un,spin:(f()-.5)*6})}for(let A=0;A<60;A++)ye.add({t:tt+.6+f()*2.2,life:.35+f()*.35,pos:[(f()-.5)*6,1,(f()-.5)*3.6],vel:[0,.25,0],drag:0,size:.25+f()*.3,type:0,col:f()<.7?gn:Un,spin:(f()-.5)*3});for(let A=0;A<80;A++)ne.add({t:-10,life:100,pos:[(f()-.5)*8,-.5,(f()-.5)*12],vel:[(f()-.5)*.12,0,(f()-.5)*.12],drag:0,size:.05+f()*.07,type:3,col:f()<.6?Un:gn});let Xe=Ct.h/(2*jr);s.add(ne.build("fx-back-particles",Ye["fx-back"],!1,()=>Xe,!0)),s.add(ye.build("fx-front-particles",Ye["fx-front"],!0,()=>Xe,!0));let ke=[[0,1.14,0,0,-5],[1.4,1,0,0,-2],[3.4,1,0,0,0],[3.9,1.1,-.45,0,1],[4.9,1.08,.35,.1,0],[6.8,1,0,0,-1],[9.7,1.05,0,0,1],[12.8,1,0,0,0],[tt,1,0,0,0],[18,1.05,0,-.1,0]],Qe=[_e("whole").t0+_e("whole").dur*.6,_e("slice").t0+_e("slice").dur*.5,tt+.1];function gt(A){let k=0;for(;k<ke.length-2&&A>ke[k+1][0];)k++;let V=ke[k],$=ke[k+1],ae=nr(ft(V[0],$[0],A)),le=0;for(let Z of Qe)A>Z&&(le+=.05*Math.exp(-(A-Z)*9));let ie=Mt(V[1],$[1],ae),ee=Mt(V[4],$[4],ae)*Math.PI/180+le*.06*Math.sin(A*63);o.zoom=ie,o.updateProjectionMatrix(),o.position.set(Mt(V[2],$[2],ae)+le*Math.sin(A*91),40,Mt(V[3],$[3],ae)+le*Math.cos(A*77)),o.up.set(Math.sin(ee),0,-Math.cos(ee)),o.lookAt(o.position.x,0,o.position.z),E.scale.set(2*Nh/ie,2*jr/ie,1)}let Et=Cl(i,e,gf,tt),pt=A=>{let k=di(e,A.n),V=d[A.key];if(A.kind==="state")return A.n===1?[k.t0,k.t0+k.dur*.7]:[k.t0+k.dur*.15,k.t0+k.dur*.75];if(A.key==="oil-vinegar")return[k.t0+.12,k.t0+k.dur*.85];let $=V.add.length>0||W.has(A.key)||A.key==="chips"&&G.length>0;return A.key==="chips"&&$?[k.t0+k.dur*.82,k.t0+k.dur]:$?[k.t0+k.dur*.72,k.t0+k.dur]:[k.t0+k.dur*.2,k.t0+k.dur]},ht=Y.map(A=>({s:A,w:pt(A)})),O=.25,oe=A=>ht.find(k=>k.s.key===A)?.w[1]??1/0,xe=A=>ht.find(k=>k.s.n>=A)?.w[1]??1/0;function R(A,k,V,$,ae,le,ie=.42,ee={dx:.9,dz:-1.6,s:1.5,spin:.5},Z=1/0){let he=V-ie;if(k<he||k>=Z){H(A);return}let ge=ft(he,V,k),L=bl(ge),fe=1-ti(ge),te=k-V,ve=te>0?1-.035*Math.sin(te*26)*Math.exp(-te*9):1;U(A,$+ee.dx*(1-L),ae+ee.dz*(1-L),{rot:le+ee.spin*fe,s:Mt(ee.s,1,L)*ve,op:_t(0,.3,ge),lift:(1-L)*1.5})}function x(A){gt(A);let k=ce?_t(tt,tt+.6,A):0,V=.3+.3*_t(4.9,6.8,A)+.5*_t(tt,tt+.8,A);v.uniforms.uTime.value=A,v.uniforms.uBurst.value=V*_t(0,.6,A),v.uniforms.uGlow.value=.55+.45*_t(0,1,A)+.35*k,y.uniforms.uSweep.value=Mt(-6,6,ft(.2,1.4,A))+(A>tt?Mt(-6,6,ft(tt+.2,tt+1.4,A))+12:0),y.uniforms.uPulse.value=A>tt+.1?.8*Math.exp(-(A-tt-.1)*3):0,_.uniforms.uTime.value=A,_.uniforms.uI.value=(.24+.16*_t(4.9,6.8,A)+.14*k)*_t(0,.8,A),Pe.pose(A),ne.pose(A,Xe*o.zoom),ye.pose(A,Xe*o.zoom),ht.forEach(({s:le,w:ie},ee)=>{let Z=N.get(`state:${le.key}`),he=ht[ee+1],ge=he?A>=he.w[1]:!1,L=ft(ie[0],ie[1],A)*(1-k);if(L<=0||ge){H(Z);return}let fe=le.n===1?Di(ft(ie[0],ie[1],A),1.2):1,te=.02*(1-ft(ie[0],ie[1],A));U(Z,0,0,{s:le.n===1?Mt(1.28,1,fe):1+te,op:le.n===1?_t(0,.4,ft(ie[0],ie[1],A)):L,lift:le.n===1?(1-fe)*1.2:0})});for(let le of["aioli","provolone","turkey","onions","shredduce","oregano"]){let ie=N.get(`add:${le}`);if(!ie)continue;let ee=_e(le),Z=u[le],[he,ge]=aa(Z.u,Z.v);R(ie,A,ee.t0+ee.dur*(le==="onions"?.3:.5),he,ge,Z.rot,.42,{dx:.8,dz:-1.8,s:1.45,spin:.45},xe(l[le].n))}let $=xe(l.chips.n);G.forEach((le,ie)=>{let ee=t.chips[ie],[Z,he]=aa(ee.u,ee.v),ge=qe[ie];R(le,A,Be[ie],Z,he,ee.rot,ge.dur,{dx:ge.sx-Z,dz:ge.sz-he,s:ge.s,spin:ge.spin},$)});let ae=xe(l.pickles.n);if(J.forEach((le,ie)=>{let ee=t.pickles[ie],[Z,he]=aa(ee.u,ee.v);R(le,A,ze[ie],Z,he,ee.rot,.35,{dx:-2.5-Z*.2,dz:-1.5,s:1.6,spin:2},ae)}),de&&W.has("chips")){let le=de.chips[0].material,ie=1-ft(oe("chips"),oe("chips")+O,A);le.transparent=ie<1,le.opacity=ie,de.chips.forEach((ee,Z)=>{let he=t.chips[Z],ge=Be[Z],L=.45;if(A<ge-L||A>=oe("chips")+O){ee.visible=!1;return}ee.visible=!0;let fe=ft(ge-L,ge,A),te=bl(fe),ve=1-ti(fe),be=he.u*2*Kt*.96,me=he.v*(an/2)*.92;ee.position.set(Mt(2.2,be,te),.1+he.y*2+(1-te)*3,Mt(-3.4,me,te)),ee.rotation.set(.3*Math.sin(he.rot)+ve*6,he.rot+ve*4,.3*Math.cos(he.rot)+ve*3,"YXZ"),ee.scale.setScalar(he.scale*.95)})}if(de&&W.has("shredduce")){let le=_e("shredduce"),ie=oe("shredduce")+O,ee=new je,Z=new tn,he=new cn,ge=new D,L=new D,fe=new je().makeScale(0,0,0);for(let be of de.strands.data){let me=le.t0+.15+be.p.i%97/97*le.dur*.5,Ne=.42,Ie=de.strands.meshes[be.v];if(A<me-Ne||A>=ie){Ie.setMatrixAt(be.k,fe);continue}let it=ft(me-Ne,me,A);ge.set(be.p.u*2*Kt*.96*Mt(1.4,1,it),.12+be.p.y+(1-it*it)*2.5,be.p.v*(an/2)*.92),he.set((1-it)*5+.2,be.p.rot+(1-it)*3,(1-it)*2),Z.setFromEuler(he),L.setScalar(be.p.scale),ee.compose(ge,Z,L),Ie.setMatrixAt(be.k,ee)}let te=de.strands.meshes[0].material,ve=1-ft(oe("shredduce"),oe("shredduce")+O,A);te.transparent=ve<1,te.opacity=ve;for(let be of de.strands.meshes)be.instanceMatrix.needsUpdate=!0,be.visible=A>=le.t0&&A<ie}for(let[le,ie]of X){let ee=_e(le),Z=ee.t0+ee.dur*.5,he=xe(l[le].n),ge=A>=Z-.35&&A<he;if(ie.g.visible=ge,ge){let L=bl(ft(Z-.35,Z,A));ie.g.position.x=(1-L)*.8,ie.g.position.z=(1-L)*-1.6}if(le==="aioli"){let L=Math.floor(nr(ft(ee.t0,Z,A))*de.aioli.segs);de.aioli.mesh.geometry.setDrawRange(0,L*de.aioli.rad*6)}}if(ce)if(A<tt)H(ce);else{let le=ft(tt,tt+.6,A);U(ce,0,-.35,{s:Mt(1.08,1,Di(ft(tt,tt+.85,A),2.5))*(1+.035*_t(tt+.8,18,A)),op:_t(0,1,le),rot:0})}Et.pose(A,se)}function z(A){let k={},V=(ae,le)=>{le!==void 0&&(k[ae]??=[]).push(le)},$=ce?A>=tt+.6:!1;ht.forEach(({s:ae,w:le},ie)=>{let ee=ht[ie+1];A>le[0]+.05&&!(ee&&A>=ee.w[1])&&!$&&V(`state:${ae.key}`,P.get(`state:${ae.key}`))});for(let ae of["aioli","provolone","turkey","onions","shredduce","oregano"]){if(!N.has(`add:${ae}`))continue;let le=_e(ae),ie=le.t0+le.dur*(ae==="onions"?.3:.5);A>=ie&&A<xe(l[ae].n)&&V(ae,P.get(`add:${ae}`))}G.forEach((ae,le)=>{A>=Be[le]&&A<xe(l.chips.n)&&V("chips",P.get(`add:chips:${le}`))}),J.forEach((ae,le)=>{A>=ze[le]&&A<xe(l.pickles.n)&&V("pickles",P.get(`add:pickles:${le}`))});for(let ae of X.keys()){let le=_e(ae);A>=le.t0+le.dur*.5&&A<xe(l[ae].n)&&V(ae,P.get(`stand-in:${ae}`))}return P.has("drawn:chips")&&A>=Math.min(...Be)&&A<oe("chips")+O&&V("chips",P.get("drawn:chips")),$&&V("hero",P.get("hero")),k}function K(A){let k=N.get(A);if(!k)return null;k.mesh.updateWorldMatrix(!0,!1);let V=new D,$=new tn,ae=new D;k.mesh.matrixWorld.decompose(V,$,ae);let le=new D(1,0,0).applyQuaternion($),ie=new D(0,0,1).applyQuaternion($);return{req:k.req??null,visible:k.mesh.visible,rotY:Math.atan2(-le.z,le.x),scale:ae.x,opacity:k.mat.opacity,faceUp:ie.y}}function se(A,k){return A!==l.chips.n?null:Be.filter(V=>V<=k).length}return{scene:s,camera:o,hud:Et,registry:a,pose:x,tally:se,expected:z,cardPose:K,background:My,shadows:!1,viewport(A){Xe=A/(2*jr)}}}function Bl(i,e,t){let n=new vn,r=new $r,s=new Gt(32,Ct.w/Ct.h,.1,60);n.add(s);let a=Object.fromEntries(i.map(oe=>[oe.key,oe])),o=oe=>di(e,a[oe].n),l=(oe,xe)=>af(e,a[oe].n,xe),c=Ni(Fi(256,256,oe=>{let xe=Bi(3);oe.fillStyle="#1b1614",oe.fillRect(0,0,256,256);for(let R=0;R<2600;R++)oe.fillStyle=`rgba(${40+xe()*20},${30+xe()*14},${26+xe()*12},${.2+xe()*.3})`,oe.fillRect(xe()*256,xe()*256,1+xe()*3,1+xe()*3)}),"studio-slab");c.colorSpace=Vt,c.wrapS=c.wrapT=Ar,c.repeat.set(8,8);let h=Lt(new Yt({map:c,roughness:.8}),"studio-slab",!1);Zr(h);let u=new Oe(new ct(40,40).rotateX(-Math.PI/2),h);u.name="studio-slab",u.position.y=-.345,u.receiveShadow=!0,u.layers.set(Ye.stage),n.add(u);let d=Lt(new nn({color:789002,side:Nt,toneMapped:!1}),"studio-dome",!1),f=new Oe(new Yi(30,24,12),d);f.name="studio-dome",f.layers.set(Ye.stage),n.add(f);let g=Ni(Fi(512,768,oe=>{let xe=Bi(11);oe.fillStyle="#d8ceb3",oe.fillRect(0,0,512,768);for(let R=0;R<5e3;R++)oe.fillStyle=`rgba(${200+xe()*30},${190+xe()*30},${160+xe()*30},0.25)`,oe.fillRect(xe()*512,xe()*768,1,3+xe()*8);oe.strokeStyle="#e0333b",oe.lineWidth=5,oe.strokeRect(24,24,464,720),oe.lineWidth=2,oe.strokeRect(34,34,444,700)}),"studio-paper");g.colorSpace=Vt;let v=Lt(new Yt({map:g,roughness:.85}),"studio-paper",!1);Zr(v);let m=new Oe(new ct(3.4,4.9).rotateX(-Math.PI/2),v),p=Ni(Fi(128,192,oe=>{let xe=oe.createRadialGradient(64,96,6,64,96,92);xe.addColorStop(0,"rgba(0,0,0,0.5)"),xe.addColorStop(.5,"rgba(0,0,0,0.22)"),xe.addColorStop(1,"rgba(0,0,0,0)"),oe.fillStyle=xe,oe.fillRect(0,0,128,192)}),"studio-contact"),w=Lt(new nn({map:p,transparent:!0,depthWrite:!1,toneMapped:!1}),"studio-contact",!1),T=new Oe(new ct(2.5,3.8).rotateX(-Math.PI/2),w);T.name="studio-contact",T.position.set(.2,-.325,.05),T.renderOrder=1,T.layers.set(Ye.stage),n.add(T),m.name="studio-paper",m.rotation.y=.06,m.position.set(0,-.33,.05),m.receiveShadow=!0,m.layers.set(Ye.stage),n.add(m);let y=new Zi(16774112,2759188,.28),b=new Ci(16773338,3);b.position.set(-3.2,6.5,3.6),b.castShadow=!0,b.shadow.mapSize.set(1024,1024),Object.assign(b.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:1,far:16}),b.shadow.bias=-5e-4,b.shadow.normalBias=.02,b.shadow.radius=4;let S=new Ci(14082815,.45);S.position.set(4,2.2,4.5);let C=new Ps(16767370,0,14,.55,1,1.2);C.position.set(1.5,3.2,-4.5),C.target.position.set(0,.3,0);let _=new Ji(16726596,0,9,1.6);_.position.set(3.2,1.2,.6);for(let oe of[y,b,S,C,_])oe.layers.enableAll(),n.add(oe);n.add(C.target),b.shadow.camera.layers.enableAll();let E=_f();E.group.traverse(oe=>{oe.isMesh&&(oe.name=oe.name||"drawn:roll")}),n.add(E.group);let[I,N,P,,,F]=E.meshes;r.add("bread-whole","drawn",[I,N,P,E.crumbTopFlat,E.crumbTopGut,F,E.hingeCrust]);let U=Array.from({length:40},(oe,xe)=>{let R=Bi(900+xe);return{p0:new D(-Kt+(R()-.5)*.3,.02,(R()-.5)*2.6),v:new D((R()-.5)*1.6,1+R()*1.3,(R()-.5)*.6),s:.6+R()*1.2,rot:R()*6}}),H=new Ut,q=Lt(new Yt({color:kt("#c9ced6"),metalness:.9,roughness:.25}),"studio-knife-blade",!0);Zr(q);let Y=Lt(new Yt({color:kt("#3a2418"),roughness:.6}),"studio-knife-handle",!0);Zr(Y);let ce=new Oe(new Hn(.5,.012,1.4),q);ce.name="studio-knife-blade";let G=new Oe(new Hn(.12,.08,.6),Y);G.name="studio-knife-handle",G.position.set(.12,0,-1),H.add(ce,G),H.traverse(oe=>oe.layers.set(Ye["fx-front"])),H.visible=!1,n.add(H);let J=.5,W=Fl(t),ue=.5,pe=.56,Me=new Ut;n.add(Me);let Se=(oe,xe)=>{xe.forEach((R,x)=>{R.name=`drawn:${oe}:${x}`,R.castShadow=!0,R.receiveShadow=!0}),r.add(a[oe].ingredient,"drawn",xe)};Me.add(W.aioli.mesh),Se("aioli",[W.aioli.mesh]),W.chips.forEach(oe=>Me.add(oe)),Se("chips",W.chips),W.provolone.forEach(oe=>Me.add(oe)),Se("provolone",W.provolone),W.turkey.forEach(oe=>Me.add(oe)),Se("turkey",W.turkey),W.onions.forEach(oe=>Me.add(oe)),Se("onions",W.onionMeshes),W.pickles.forEach((oe,xe)=>{Me.add(oe),oe.name=`drawn:pickles:${xe}`,oe.castShadow=!0,oe.receiveShadow=!0,r.add(a.pickles.ingredient,"drawn",[oe])}),W.strands.meshes.forEach(oe=>Me.add(oe)),Se("shredduce",W.strands.meshes),Me.add(W.oil.streak,W.oil.drops),Se("oil-vinegar",[W.oil.streak,W.oil.drops]),Me.add(W.oregano),Se("oregano",[W.oregano]);let de=Bi(745197),X=new sr;for(let oe of["whole","slice","provolone","turkey"]){let xe=o(oe);X.puff(de,xe.t0+xe.dur*.6,.2,.3,0,.8,8,3)}for(let oe=0;oe<40;oe++){let xe=de()*6.28;X.add({t:tt+.2+de()*1.6,life:.4+de()*.4,pos:[Math.cos(xe)*1.3,.4+de()*.6,Math.sin(xe)*2],vel:[0,.3,0],drag:0,size:.06+de()*.05,type:0,col:de()<.7?gn:Un,spin:2})}let ne=Ct.h;n.add(X.build("fx-front-sparkles",Ye["fx-front"],!0,()=>ne/(2*Math.tan(s.fov*Math.PI/360)),!1));let ye=[{t:0,p:[4.6,6.2,8.2],q:[.4,0,0]},{t:.9,p:[2.6,5.8,6.2],q:[.35,0,0]},{t:1.4,p:[.9,5.4,4],q:[.2,0,0]},{t:2.5,p:[-.9,4.6,3],q:[-.4,-.05,0]},{t:3.6,p:[-.9,4.2,2.8],q:[-.45,-.05,0]},{t:4.9,p:[1.4,4.4,3.2],q:[.45,0,.1]},{t:7.1,p:[.1,5.2,3.7],q:[-.1,.05,0]},{t:9.7,p:[.3,4.8,3.4],q:[0,.1,0]},{t:11.8,p:[0,5,3.6],q:[0,.15,0]},{t:14.1,p:[.4,4.6,3.3],q:[0,.2,.1]},{t:tt,p:[2.7,2.3,4.6],q:[.05,.15,.1]},{t:18,p:[3.3,1.8,4.2],q:[0,.16,.2]}],Pe=(oe,xe,R,x,z)=>.5*(2*xe+(-oe+R)*z+(2*oe-5*xe+4*R-x)*z*z+(-oe+3*xe-3*R+x)*z*z*z);function _e(oe){let xe=0;for(;xe<ye.length-2&&oe>ye[xe+1].t;)xe++;let R=ye[Math.max(0,xe-1)],x=ye[xe],z=ye[xe+1],K=ye[Math.min(ye.length-1,xe+2)],se=sn((oe-x.t)/(z.t-x.t)),A=nr(se)*.4+se*.6;s.position.set(...[0,1,2].map(k=>Pe(R.p[k],x.p[k],z.p[k],K.p[k],A))),s.lookAt(...[0,1,2].map(k=>Pe(R.q[k],x.q[k],z.q[k],K.q[k],A)))}let Ce=Cl(i,e,xf,tt),qe=new je,Be=new tn,ze=new cn,Xe=new D,ke=new D,Qe=new je().makeScale(0,0,0),gt=t.chips.map((oe,xe)=>{let R=o("chips");return R.t0+.3+(R.dur*.85-.3)*(xe/Math.max(1,t.chips.length-1))});function Et(oe,xe,R,x,z,K,se,A=.34,k=2.2,V=.6){if(xe<R-A){oe.visible=!1;return}oe.visible=!0;let $=sn((xe-(R-A))/A),ae=1-$*$,le=Math.max(0,xe-R),ie=.07*Math.exp(-le*9)*Math.sin(le*30);oe.position.set(x+.25*ae,z+k*ae,K-.3*ae),oe.rotation.set(V*ae+ie,se+.8*ae,-.35*ae)}function pt(oe){_e(oe);let xe=o("whole"),R=Di(ft(xe.t0,xe.t0+xe.dur*.7,oe),1.1);E.group.visible=oe>=xe.t0,E.group.position.y=(1-R)*2.4,T.visible=E.group.visible,w.opacity=_t(.2,1,R);let x=o("slice"),z=ft(x.t0,x.t0+x.dur*.45,oe),K=Di(ft(x.t0+x.dur*.45,x.t0+x.dur,oe),.6);E.hinge.rotation.z=Math.PI*(1-K),E.hinge.position.set(0,0,0),H.visible=oe>=x.t0-.15&&oe<x.t0+x.dur*.5,H.position.set(Kt+J*.55,.005,Mt(-2.4,2.4,nr(z))),H.rotation.set(0,0,0);let se=l("gut",oe);E.crumbTopFlat.visible=se<.5,E.crumbTopGut.visible=se>=.5;let A=o("gut"),k=F;U.forEach((Z,he)=>{let ge=oe-(A.t0+A.dur*.45);if(ge<0||ge>1.3){k.setMatrixAt(he,Qe);return}let L=Math.min(ge,.6);Xe.set(Z.p0.x+Z.v.x*L,Math.max(-.32,Z.p0.y+Z.v.y*L-4.9*L*L),Z.p0.z+Z.v.z*L),ze.set(Z.rot+ge*8,Z.rot,0),Be.setFromEuler(ze),ke.setScalar(Z.s),qe.compose(Xe,Be,ke),k.setMatrixAt(he,qe)}),k.instanceMatrix.needsUpdate=!0;let V=l("aioli",oe),$=Math.floor(nr(V)*W.aioli.segs);W.aioli.mesh.visible=$>0,W.aioli.mesh.geometry.setDrawRange(0,$*W.aioli.rad*6),W.chips.forEach((Z,he)=>{let ge=t.chips[he],L=lr(ge.u,ge.v,.05+ge.y);L.x=Kt+(L.x-Kt)*.8,Et(Z,oe,gt[he],L.x,L.y,L.z,ge.rot,.4,1.8,2.4),Z.scale.setScalar(ge.scale*.8)}),W.provolone.forEach((Z,he)=>{let ge=o("provolone"),L=t.provolone[he],fe=lr(L.u,L.v,.03+L.y+.1);Et(Z,oe,ge.t0+ge.dur*(.4+he*.3),fe.x,fe.y,fe.z,L.rot)}),W.turkey.forEach((Z,he)=>{let ge=o("turkey");Et(Z,oe,ge.t0+ge.dur*(.3+he*.22),.05,.34+he*.022,(he-1)*.95,(he-1)*.2)}),W.onions.forEach((Z,he)=>{let ge=o("onions"),L=Z.userData;Et(Z,oe,ge.t0+ge.dur*(.3+he*.15),L.xc,ue,L.zc,L.yaw,.3,1.8,1.2)}),W.pickles.forEach((Z,he)=>{let ge=o("pickles"),L=t.pickles[he],fe=lr(L.u,L.v,pe);Et(Z,oe,ge.t0+ge.dur*(.2+he*.1),fe.x,fe.y,fe.z,L.rot,.28,1.7,2.2)});let ae=o("shredduce");for(let Z of W.strands.data){let he=ae.t0+.2+Z.p.i%97/97*ae.dur*.7,ge=.42,L=W.strands.meshes[Z.v];if(oe<he-ge){L.setMatrixAt(Z.k,Qe);continue}let fe=sn((oe-(he-ge))/ge),te=lr(Z.p.u,Z.p.v,.46+Z.p.y);Xe.set(te.x*Mt(1.3,1,fe),te.y+(1-fe*fe)*2.2,te.z),ze.set((1-fe)*5+.25*Math.sin(Z.p.rot),Z.p.rot+(1-fe)*3,(1-fe)*2),Be.setFromEuler(ze),ke.setScalar(Z.p.scale),qe.compose(Xe,Be,ke),L.setMatrixAt(Z.k,qe)}W.strands.meshes.forEach(Z=>{Z.instanceMatrix.needsUpdate=!0,Z.visible=oe>=ae.t0});let le=o("oil-vinegar"),ie=l("oil-vinegar",oe);W.oil.streak.visible=ie>0,W.oil.streak.position.set(.02,.88,0),W.oil.streak.scale.set(1,1,Math.max(.001,ti(ie))),W.oil.drops.visible=oe>=le.t0,t.oilDrops.forEach((Z,he)=>{let ge=le.t0+.1+he/t.oilDrops.length*le.dur*.6,L=.3;if(oe<ge-L){W.oil.drops.setMatrixAt(he,Qe);return}let fe=sn((oe-(ge-L))/L),te=lr(Z.u,Z.v,.88);Xe.set(te.x,te.y+(1-fe*fe)*1.5,te.z),Be.identity(),ke.set(Z.scale,Z.scale*(fe<1?1.3:.45),Z.scale),qe.compose(Xe,Be,ke),W.oil.drops.setMatrixAt(he,qe)}),W.oil.drops.instanceMatrix.needsUpdate=!0;let ee=o("oregano");W.oregano.visible=oe>=ee.t0,t.oregano.forEach((Z,he)=>{let ge=ee.t0+.15+he%61/61*ee.dur*.6,L=.26;if(oe<ge-L){W.oregano.setMatrixAt(he,Qe);return}let fe=sn((oe-(ge-L))/L),te=lr(Z.u,Z.v,.9);Xe.set(te.x+(1-fe)*.2,te.y+(1-fe*fe)*1.3,te.z),ze.set(.3,Z.rot,.2),Be.setFromEuler(ze),ke.set(Z.scale*1.6,Z.scale,Z.scale*.7),qe.compose(Xe,Be,ke),W.oregano.setMatrixAt(he,qe)}),W.oregano.instanceMatrix.needsUpdate=!0,C.intensity=4+8*_t(4.9,5.6,oe)*(1-.4*_t(6.4,7,oe))+16*_t(tt,tt+.9,oe),C.position.set(Mt(1.5,-2.2,_t(tt,18,oe)),3.2,-4.5),_.intensity=3*_t(tt+.2,tt+1.1,oe),X.pose(oe,ne/(2*Math.tan(s.fov*Math.PI/360))),Ce.pose(oe,O)}function ht(){E.group.updateWorldMatrix(!0,!0);let oe=new D(J,0,0).applyMatrix4(E.top.matrixWorld),xe=new D(-J,0,0).applyMatrix4(E.bottom.matrixWorld);return{hingeGap:xe.x-oe.x,hingeVisible:E.group.visible&&E.hingeCrust.visible,topAttached:oe.distanceTo(xe)<.02}}function O(oe,xe){return oe!==a.chips.n?null:gt.filter(R=>R<=xe).length}return{scene:n,camera:s,hud:Ce,registry:r,pose:pt,tally:O,bread:ht,background:789002,shadows:!0,viewport(oe){ne=oe}}}async function Ef(i){let e=new Map;for(let t of i){let n=await wy(t.bytes);if(n!==t.sha256)throw new Error(`crunchy loader: ${t.asset_id} sha ${n} != ${t.sha256}`);let r=Mh({asset_id:t.asset_id,path:t.asset_id,sha256:t.sha256,cls:"photo",profile:t.profile,alpha:t.alpha,edge:t.edge},t.bytes);if(r.length)throw new Error(`crunchy loader: ${t.asset_id} breaks the asset law: ${r.join("; ")}`);let s=na(t.bytes);if(s.channels!==4||s.depth!==8)throw new Error(`crunchy loader: ${t.asset_id} must be RGBA8`);let a=new qi(Yr(s.data,s.width,s.height),s.width,s.height,$t,Wt);a.premultiplyAlpha=!1,a.magFilter=ut,a.minFilter=ut,a.generateMipmaps=!1,a.colorSpace=Zt,a.name=t.asset_id,a.userData.co={cls:"photo",asset_id:t.asset_id,sha256:t.sha256},a.needsUpdate=!0,e.set(t.asset_id,a)}return e}async function wy(i){let e=globalThis.crypto?.subtle;if(e){let t=await e.digest("SHA-256",i.slice().buffer);return[...new Uint8Array(t)].map(n=>n.toString(16).padStart(2,"0")).join("")}return ir(i)}function wf(i,e,t={}){Je.enabled=!1;let n=new ll({canvas:i,antialias:t.antialias??!0,alpha:!1,stencil:!0,preserveDrawingBuffer:!0,powerPreference:"high-performance"});return n.setPixelRatio(e),n.setSize(t.w??Ct.w,t.h??Ct.h,!1),n.outputColorSpace=Xi,n.toneMapping=Sn,n.shadowMap.enabled=!0,n.shadowMap.type=mo,n.autoClear=!1,n}function Tf(i,e){let t=new Set(e.textures.keys()),n=Sl(e.look,e.variant,t),r=e.look==="stage-show"?of:wl;El(r,e.steps.length);let s=e.look==="stage-show"?Sf(e.steps,r,e.layout,n,e.textures):Bl(e.steps,r,e.layout);if(e.look==="studio-3d"){let h=new Gr(i);s.scene.environment=h.fromScene(new ul,.04).texture,s.scene.environmentIntensity=.14,h.dispose()}mf(s,e.poseHook);let a=e.probe?Ty(s):[],o=null,l=()=>o??=sa(i,s,e.capture??{w:270,h:480}),c=sa(i,s,{w:4,h:4});return{plan:n,world:s,narrative:r,duration:r.duration,heroT:tt,render:h=>c.renderBeauty(Math.min(r.duration,Math.max(0,h))),async prepare(){let h=new Set;for(let d of[s.scene,s.hud.scene])d.traverse(f=>{let g=f.material;for(let v of g?Array.isArray(g)?g:[g]:[])for(let m of Object.values(v))m&&m.isTexture&&h.add(m)});for(let d of s.registry.parts){let f=d.depthMat;f.map&&h.add(f.map)}for(let d of h)i.initTexture(d);s.camera.layers.enableAll(),await i.compileAsync(s.scene,s.camera),await i.compileAsync(s.hud.scene,s.hud.camera);for(let d of r.beats)c.renderBeauty(d.t0+d.dur*.35),c.renderBeauty(d.t0+d.dur);c.renderBeauty(tt+1),c.renderBeauty(0)},setStep(h){let u=ia(r,h);return c.renderBeauty(u),u},stepTime:h=>ia(r,h),renderLayers:(h,u,d)=>l().renderLayers(h,u,d),parts:()=>s.registry.parts.map(h=>({part_id:h.part_id,name:h.name,cls:h.cls,asset_sha256:h.asset_sha256})),cardPose(h,u){return s.pose(u),"cardPose"in s?s.cardPose(h):null},bread(h){return s.pose(h),"bread"in s?s.bread():null},setProbe(h){for(let u of a)u.visible=h},expected:h=>"expected"in s?s.expected(h):null,dispose(){s.scene.traverse(h=>{h.geometry?.dispose?.()})}}}function Ty(i){let e=(r,s)=>Lt(new nn({color:s,transparent:!0,opacity:.5,depthTest:!1,depthWrite:!1,toneMapped:!1}),r,!0),t=new Oe(new ct(1e3,1e3),e("probe-fx-front",65535));t.name="probe-fx-front",t.position.z=-5,t.frustumCulled=!1,t.renderOrder=999,t.layers.set(Ye["fx-front"]),i.camera.add(t),i.camera.parent||i.scene.add(i.camera);let n=new Oe(new ct(4e3,4e3),e("probe-ui",16711935));return n.name="probe-ui",n.frustumCulled=!1,n.renderOrder=999,n.layers.set(Ye.ui),i.hud.scene.add(n),[t,n]}function Ay(i){return ir(i.trim().toLowerCase())}var Ry={"49a7401dc52a86d430b5bd19b7370cfcb9c43c2ed939544ba0d1af4869c05624":{label:{en:"Oil and vinegar",es:"Aceite y vinagre"}},"6864c7c5474ec1f3c0109e1d10b9e71f7cc2b4a69a68359c8b6b43ce86596c6b":{each:{one:{en:"slice",es:"rebanada"},other:{en:"slices",es:"rebanadas"}}},bd3da3e78e76cb1952256002b7ca284d03433fc9e7a73d45fef3124be7f348f6:{handful:{min:20,max:25,typical:22,noun:{en:"chips",es:"papitas"}}}};function Af(i){return Ry[Ay(i)]??null}function Rf(i){return i==="stage"?"stage-show":"studio-3d"}function Cf(i,e,t={}){i.forEach((s,a)=>{if(s.n!==a+1)throw new Error(`crunchy-adapter: step order broken at "${s.key}" (n=${s.n}, expected ${a+1})`)});let n=new Map(e.steps.map(s=>[s.key,s.rep])),r=new Set(i.map(s=>s.key));for(let s of Object.keys(t))if(!r.has(s))throw new Error(`crunchy-adapter: how-to note for unknown step "${s}"`);return i.map(s=>{let a=n.get(s.key);if(!a)throw new Error(`crunchy-adapter: look plan has no entry for step "${s.key}"`);let o={n:s.n,key:s.key,action:s.action,ingredient:s.ingredient,amount:s.amount,label:s.label,drawn:a==="drawn"};return t[s.key]&&(o.howto={...t[s.key]}),o})}function Pf(i,e){if(!i.ingredient||!e||i.amount===null)return;let t=e.label?.es??i.ingredient,n=i.amount;return i.presentation==="handful"?n="un pu\xF1ado":e.each&&i.count!==null&&(n=`${i.count} ${i.count===1?e.each.one.es:e.each.other.es}`),{label:`${t} \xB7 ${n}`,draft:!0}}function Oh(i,e){let t=new Set(e),n=i.filter(r=>!t.has(r));if(n.length)throw new Error(`crunchy-web: ${n.length} part(s) not in the card's part inventory`)}function If(i,e){let t=e.filter(r=>r.ingredient!==null).sort((r,s)=>r.n-s.n),n=new Map(t.map((r,s)=>[r.ingredient,s+1]));return i.map(r=>n.get(r.name)??0)}function Lf(i,e,t){let n=new Map;i.forEach((a,o)=>{for(let l of a.objects)n.has(l)||n.set(l,e[o]??0)});let r=new Map,s=()=>{for(let[a,o]of r)a.position.y-=o;r=new Map};return{restore:s,apply(a){s();let o=Math.min(1,Math.max(0,a));if(o!==0)for(let[l,c]of n){if(c===0)continue;let h=c*o*t;l.position.y+=h,r.set(l,h)}}}}function Cy(i){let e=new URL(i,location.href);if(e.origin!==location.origin)throw new Error(`crunchy-web: refusing off-origin asset ${e.href}`);return e.href}function Py(i){for(let t=i;t;t=t.parent)if(!t.visible)return!1;let e=i;return!(e.isInstancedMesh&&e.count===0)}function Uf(i,e){return Cf(i.steps,e,i.notes).map((t,n)=>{let r=Pf(i.steps[n],i.steps[n].ingredient?Af(i.steps[n].ingredient):null);return r?{...t,i18n:{es:{...t.i18n?.es,label:r.label,draft:!0}}}:t})}function Df(i){i.traverse(e=>{let t=e;t.geometry?.dispose?.();for(let n of Array.isArray(t.material)?t.material:t.material?[t.material]:[])n.dispose()})}function O1(i){return async(e,t)=>{let n=await i(),r=Rf(t.look),s=wf(e,1,{antialias:t.quality!=="phone"}),a=(y,b,S)=>{s.setPixelRatio(Math.min(2,Math.max(.5,y*S/Ct.w))),s.setSize(Ct.w,Ct.h,!1)},o=Ct.w/Ct.h;if(r==="stage-show"){let y=await Promise.all(n.assets.map(async E=>{let I=await fetch(Cy(E.url),{redirect:"error"});if(!I.ok)throw new Error(`crunchy-web: ${E.asset_id} HTTP ${I.status}`);return{asset_id:E.asset_id,sha256:E.sha256,profile:"srgb",alpha:"straight",edge:E.edge,bytes:new Uint8Array(await I.arrayBuffer())}})),b=await Ef(y),S=Tf(s,{look:r,variant:"c1",steps:n.steps,layout:n.layout,textures:b});Oh(S.parts().map(E=>E.name),n.inventory),await S.prepare();let C=Uf(n,S.plan),_=S.plan.drawnFood.length>0||S.parts().some(E=>E.cls==="drawn");return{steps:C,duration:S.duration,canExplode:!1,aspect:o,stepTime:E=>E<=0?0:S.stepTime(Math.min(E,C.length)),render:E=>S.render(E),drawnVisible:()=>_,resize:a,dispose(){S.dispose();for(let E of b.values())E.dispose();s.dispose(),s.forceContextLoss()}}}let l=Sl(r,"b",new Set),c=wl;El(c,n.steps.length);let h=Bl(n.steps,c,n.layout),u=h.registry.parts;Oh(u.map(y=>y.name),n.inventory);let d=Uf(n,l),f=h.pose.bind(h);h.pose(c.duration);let g=new Rn;for(let y of u)for(let b of y.objects)g.expandByObject(b);let v=Lf(u,If(u,n.steps),g.getSize(new D).x*.022),m=0;h.pose=y=>{v.restore(),f(y),v.apply(m)};let p=sa(s,h,{w:4,h:4}),w=new Set;for(let y of[h.scene,h.hud.scene])y.traverse(b=>{let S=b.material;for(let C of S?Array.isArray(S)?S:[S]:[])for(let _ of Object.values(C))_&&_.isTexture&&w.add(_)});for(let y of w)s.initTexture(y);h.camera.layers.enableAll(),await s.compileAsync(h.scene,h.camera),await s.compileAsync(h.hud.scene,h.hud.camera);for(let y of c.beats)p.renderBeauty(y.t0+y.dur);p.renderBeauty(tt+1),p.renderBeauty(0);let T=!1;return{steps:d,duration:c.duration,canExplode:!0,aspect:o,stepTime:y=>y<=0?0:ia(c,Math.min(y,d.length)),render(y,b){m=b.explode,p.renderBeauty(Math.min(c.duration,Math.max(0,y))),T=u.some(S=>S.cls==="drawn"&&S.objects.some(Py))},drawnVisible:()=>T,resize:a,dispose(){Df(h.scene),Df(h.hud.scene),s.dispose(),s.forceContextLoss()}}}}export{O1 as crunchyFactory};
