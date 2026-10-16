import { describe,it,expect } from 'vitest';
import { ServerResponse, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { installLandingVaryGuard } from '@/lib/landing/vary-server';
describe('Next page Vary replacement compatibility',()=>{
  it('retains proxy Host when Next replaces Vary, without touching staff headers',()=>{
    installLandingVaryGuard(); installLandingVaryGuard();
    const response=new ServerResponse(new IncomingMessage(new Socket()));
    response.setHeader('Vary','Host');
    response.setHeader('Vary','RSC, Next-Router-State-Tree');
    expect(response.getHeader('Vary')).toBe('RSC, Next-Router-State-Tree, Host');
    response.setHeader('vary','RSC, Host');
    expect(response.getHeader('vary')).toBe('RSC, Host');
    const staff=new ServerResponse(new IncomingMessage(new Socket()));
    staff.setHeader('Vary','RSC'); staff.setHeader('Vary','Accept-Encoding');
    expect(staff.getHeader('Vary')).toBe('Accept-Encoding');
  });
});
