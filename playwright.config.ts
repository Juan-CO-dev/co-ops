import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  globalTeardown: './scripts/landing/e2e-teardown.ts',
  testDir: './tests/e2e/landing', fullyParallel: true, workers: 3, timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:43170', trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 375, height: 812 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width:375,height:812 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width:375,height:812 } } },
  ],
  webServer: { command: 'node scripts/landing/e2e-server.mjs', url: 'http://localhost:43170/robots.txt', reuseExistingServer: false, stdout: 'pipe', timeout: 600000 },
});
