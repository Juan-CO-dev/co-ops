// Test infrastructure only; production configuration never reads this variable.
const value = process.env.LANDING_E2E_PORT_BASE ?? '44170';
if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65530) throw new Error('Invalid landing e2e port base');
const portBase = Number(value);
exports.portBase = portBase;
exports.pidFile = portBase === 44170 ? 'tmp-landing-server-pids.json' : `tmp-landing-server-pids-${portBase}.json`;
