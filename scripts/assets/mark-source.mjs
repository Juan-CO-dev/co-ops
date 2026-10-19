// Deterministic delivery simplification of the authentic mark, never a redraw.
// Coordinates remain in the original 805x894 viewBox. Each path stays separate.
const distance=(p,a,b)=>{
 const dx=b[0]-a[0],dy=b[1]-a[1];
 const t=dx*dx+dy*dy?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
 return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};
const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
function curve(a,b,c,d,result){
 // Convex-hull distance bounds every point on the Bezier to its chord.
 if(Math.max(distance(b,a,d),distance(c,a,d))<=0.05){result.push(d);return;}
 const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),center=mid(abc,bcd);
 curve(a,ab,abc,center,result);curve(center,bcd,cd,d,result);
}
function simplify(points,tolerance){
 if(points.length<3)return points;
 let max=0,index=0;
 for(let i=1;i<points.length-1;i++){const d=distance(points[i],points[0],points.at(-1));if(d>max){max=d;index=i;}}
 return max>tolerance?[...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)]:[points[0],points.at(-1)];
}
export function deriveMarkSvg(input,tolerance=0.25){
 const source=input.toString();
 const paths=[...source.matchAll(/<path d="([^"]+)"/g)].map(match=>{
  const tokens=match[1].match(/[A-Za-z]|-?\d+(?:\.\d+)?/g);let i=0,p=[0,0],points=[];const contours=[];
  const close=()=>{if(points.length){contours.push(points);points=[];}};
  while(i<tokens.length){
   const cmd=tokens[i++];
   if(cmd==='M'||cmd==='L'){if(cmd==='M')close();p=[+tokens[i++],+tokens[i++]];points.push(p);}
   else if(cmd==='C'){
    const b=[+tokens[i++],+tokens[i++]],c=[+tokens[i++],+tokens[i++]],d=[+tokens[i++],+tokens[i++]];
    curve(p,b,c,d,points);p=d;
   }else if(cmd==='Z')close();else throw Error('Unsupported mark source command');
  }
  close();if(!contours.length)throw Error('Empty mark path');
  return '<path d="'+contours.map(points=>{
   const vertices=simplify([...points,points[0]],tolerance);
   return vertices.map((point,index)=>(index?'L':'M')+point.map(value=>Math.round(value*100)/100).join(' ')).join('')+'Z';
  }).join('')+'"/>';
 });
 if(paths.length!==42)throw Error('Unexpected mark path count');
 return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 805 894" width="805" height="894"><g fill="#141414">'+paths.join('')+'</g></svg>\n');
}
