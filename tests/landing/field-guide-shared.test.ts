import {expect,it} from 'vitest';
import {leaderPath} from '@/lib/landing/field-guide-shared';

it('draws a smooth curve from the word down to its ingredient',()=>{
  expect(leaderPath({x:40,y:50},{x:200,y:450})).toBe('M40 50 C40 230 200 310 200 450');
});
it('rounds coordinates to one decimal so markup stays compact and stable',()=>{
  expect(leaderPath({x:1.234,y:2.26},{x:3.333,y:4.449})).toBe('M1.2 2.3 C1.2 3.2 3.3 3.7 3.3 4.4');
});
