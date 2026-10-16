module.exports = {
  ci: {
    collect: { url: ['http://localhost:44170/'], numberOfRuns: 3,
      puppeteerScript: 'scripts/landing/perf-consent.cjs',
      // Match Playwright's local browser launch in restricted test environments.
      puppeteerLaunchOptions: { args: process.env.LANDING_PERF_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] },
      startServerCommand: 'node scripts/landing/e2e-server.mjs', startServerReadyPattern: 'Ready', startServerReadyTimeout: 600000,
      settings: { formFactor: 'mobile', throttlingMethod:'simulate', throttling:{rttMs:150,throughputKbps:1600,cpuSlowdownMultiplier:4}, screenEmulation: { mobile:true, width:375, height:812, deviceScaleFactor:1, disabled:false } } },
    assert: { assertions: {
      'categories:performance': ['error', { minScore:0.85, aggregationMethod:'median' }],
      'categories:accessibility': ['error', { minScore:0.95, aggregationMethod:'median' }],
      'largest-contentful-paint': ['error', { maxNumericValue:2499.999, aggregationMethod:'median' }],
      'cumulative-layout-shift': ['error', { maxNumericValue:0.1, aggregationMethod:'median' }],
      'total-blocking-time': ['error', { maxNumericValue:200, aggregationMethod:'median' }],
      // perf-ci gates measured first-party transfer bytes (500 KB per cold run).
      // Accepted consent reports the real third-party Pixel cost separately.
    } },
    upload: { target: 'filesystem', outputDir: `.lighthouseci/reports-${process.env.LANDING_PERF_CONSENT === 'accepted' ? 'accepted' : 'unset'}` },
  },
};
