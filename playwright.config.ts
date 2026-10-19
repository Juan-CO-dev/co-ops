import { portBase } from './scripts/landing/e2e-ports.cjs';
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  globalTeardown: './scripts/landing/e2e-teardown.ts',
  testDir: './tests/e2e/landing', fullyParallel: true, workers: 2, timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://localhost:${portBase}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 375, height: 812 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width:375,height:812 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width:375,height:812 } } },
    { name: 'iphone-webkit', testMatch: /(?:motion|hero|hero-poster|lineup)\.spec\.ts$/, use: {...devices['iPhone 13 Mini']} },
  ],
  webServer: { command: 'node scripts/landing/e2e-server.mjs', wait: { stdout: /LANDING_E2E_READY/ }, reuseExistingServer: false, stdout: 'pipe', timeout: 1200000 },
});
