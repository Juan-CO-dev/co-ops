import { portBase } from '../../../scripts/landing/e2e-ports.cjs';
import { test, expect } from '@playwright/test';
test('staff vault remains authenticated and landing refuses it', async ({request})=>{
  const staff=await request.get(`http://127.0.0.1:${portBase}/vault`,{maxRedirects:0});
  expect(staff.status()).toBe(307);
  expect(new URL(staff.headers().location!, `http://127.0.0.1:${portBase}`).pathname).toBe('/');
  const landing=await request.get('/vault',{maxRedirects:0});
  expect(landing.status()).toBe(404);expect(landing.headers()['set-cookie']).toBeUndefined();
});
