# Landing chunk A dependency baseline

- Existing lockfile retained: Node 22.x (local 22.20.0), Next 16.2.4, React/React DOM 19.2.4, TypeScript strict, Tailwind 4, Vitest 4.1.10 and Playwright 1.63.0.
- `npm ci` was completed by the lead before this task. Installed Next proxy, headers, routing/metadata guides were read before implementation.
- Accessibility uses the already installed/locked `axe-core` 4.11.3 directly through Playwright `addScriptTag`; it is promoted to an explicit exact devDependency without changing its resolved artifact. Its declared engine is Node >=4. No wrapper package is needed.
- Lighthouse CI is pinned to 0.15.1 in `perf:ci` (https://github.com/GoogleChrome/lighthouse-ci/releases/tag/v0.15.1). Registry access returned EACCES and offline wrapper/LHCI install attempts returned ENOTCACHED. Therefore LHCI transitive lockfile/engine resolution and local performance results are still unverified; the command fails rather than claiming a score.
- Browser install attempted Chromium + WebKit; default cache lock creation returned EPERM. Installed binaries are checked separately. CI installs both with dependencies and retains reports.
- Production harness uses installed Next CLI, builds without landing environment, then starts enabled/disabled servers with synthetic auth credentials and no provider/database credentials. It never reuses another server.
- PGlite is already installed. Its in-memory SQL harness never reads a deployment connection string.

## Next 16.2.4 compatibility findings

Production browser checks reproduced two framework behaviors absent from pure tests:

1. The built-in trailing-slash 308 precedes proxy host checks. `skipTrailingSlashRedirect` now lets host checks run first; the proxy retains the staff-host 308 explicitly.
2. `node_modules/next/dist/build/templates/app-page.js:454` replaces Vary after proxy/config headers. The Node instrumentation hook installs `lib/landing/vary-server.ts` only when LANDING_HOSTS is nonempty. It preserves only an already-present Host token while retaining Next's RSC tokens. Staff responses without that token are unchanged. This runtime compatibility guard is an implementation deviation requiring CC review and a deployment smoke; remove it when the framework preserves prior Vary. The existing sim network guard remains independently gated.

Browser harness ports are 43170/43171 because 3100 was already occupied. Installed Chromium and WebKit both launched successfully despite the installer cache-lock EPERM. A teardown hook stops only the child PIDs created by this harness; Windows process-tree termination otherwise left the two test servers alive.
