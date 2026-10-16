module.exports = {
  ci: {
    collect: { url: ['http://localhost:44170/'], numberOfRuns: 3,
      puppeteerScript: 'scripts/landing/perf-consent.cjs',
      startServerCommand: 'node scripts/landing/e2e-server.mjs', startServerReadyPattern: 'Ready', startServerReadyTimeout: 600000,
      settings: { formFactor: 'mobile', throttlingMethod:'simulate', throttling:{rttMs:150,throughputKbps:1600,cpuSlowdownMultiplier:4}, screenEmulation: { mobile:true, width:375, height:812, deviceScaleFactor:1, disabled:false } } },
    assert: { assertions: {
      'categories:performance': ['error', { minScore:0.85, aggregationMethod:'median' }],
      'categories:accessibility': ['error', { minScore:0.95, aggregationMethod:'median' }],
      'largest-contentful-paint': ['error', { maxNumericValue:2499.999, aggregationMethod:'median' }],
      'cumulative-layout-shift': ['error', { maxNumericValue:0.1, aggregationMethod:'median' }],
      'total-blocking-time': ['error', { maxNumericValue:200, aggregationMethod:'median' }],
      'total-byte-weight': ['error', { maxNumericValue:500000, aggregationMethod:'median' }],
    } },
    upload: { target: 'filesystem', outputDir: `.lighthouseci/reports-${process.env.LANDING_PERF_CONSENT === 'accepted' ? 'accepted' : 'unset'}` },
  },
};
