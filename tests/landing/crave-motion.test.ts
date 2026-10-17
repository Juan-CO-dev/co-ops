import {describe,expect,it} from 'vitest';
import {craveProgress,canAnimateCrave,fieldGuideAnchors} from '../../lib/landing/crave-motion-shared';
describe('native crave motion',()=>{
  it('clamps progress, reverses and recalculates after resize',()=>{
    expect(craveProgress(20,1000,600)).toBe(0);
    expect(craveProgress(-200,1000,600)).toBe(.5);
    expect(craveProgress(-400,1000,600)).toBe(1);
    expect(craveProgress(-100,1000,600)).toBe(.25);
    expect(craveProgress(-200,1200,600)).toBeCloseTo(1/3);
    expect(craveProgress(-900,1000,600)).toBe(1);
    expect(craveProgress(0,600,600)).toBe(0);
  });
  it('omits runways for still, reduced motion, data saving and short viewports',()=>{
    expect(canAnimateCrave({still:false,reducedMotion:false,saveData:false,height:812})).toBe(true);
    for(const overrides of [{still:true},{reducedMotion:true},{saveData:true},{height:499}])
      expect(canAnimateCrave({still:false,reducedMotion:false,saveData:false,height:812,...overrides})).toBe(false);
  });
  it('anchors only visually inspected ingredients on the full-frame L083 crop',()=>{
    expect(fieldGuideAnchors.map(a=>a.id)).toEqual(['bread','chips','turkey','iceberg','pickles','provolone']);
    for(const a of fieldGuideAnchors){expect(a.x).toBeGreaterThan(0);expect(a.x).toBeLessThan(1);expect(a.y).toBeGreaterThan(0);expect(a.y).toBeLessThan(1);}
  });
});
