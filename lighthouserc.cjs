module.exports = {
  ci: {
    collect: { url: ['http://localhost:43170/'], numberOfRuns: 3,
      startServerCommand: 'node scripts/landing/e2e-server.mjs', startServerReadyPattern: 'Ready', startServerReadyTimeout: 600000,
      settings: { formFactor: 'mobile', screenEmulation: { mobile:true, width:375, height:812, deviceScaleFactor:1, disabled:false } } },
    assert: { assertions: {
      'categories:performance': ['error', { minScore:0.85 }],
      'categories:accessibility': ['error', { minScore:0.95 }],
      'largest-contentful-paint': ['error', { maxNumericValue:2500 }],
      'total-byte-weight': ['error', { maxNumericValue:600000 }],
    } },
    upload: { target: 'filesystem', outputDir: '.lighthouseci/reports' },
  },
};
