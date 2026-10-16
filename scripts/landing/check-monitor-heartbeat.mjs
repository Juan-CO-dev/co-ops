import { pathToFileURL } from 'node:url';

export function heartbeat(completedAt, now = Date.now()) {
  const timestamp = typeof completedAt === 'string' ? Date.parse(completedAt) : NaN;
  const age = now - timestamp;
  const ok = Number.isFinite(age) && age >= 0 && age <= 2 * 60 * 60 * 1000;
  return { ok, reviewRequired: !ok, pauseRequired: false, reason: ok ? 'fresh-report' : 'missing-or-stale-heartbeat', completedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null };
}

export async function latestReport(runs, artifactsForRun) {
  let latest = null;
  for (const run of runs) {
    if (run.status !== 'completed' || !['success', 'failure'].includes(run.conclusion)) continue;
    for (const artifact of await artifactsForRun(run.id)) {
      if (artifact.name !== 'money-path-report' || artifact.expired || !Number.isFinite(Date.parse(artifact.created_at))) continue;
      if (!latest || Date.parse(artifact.created_at) > Date.parse(latest)) latest = artifact.created_at;
    }
  }
  return latest;
}

async function main() {
  let result;
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !process.env.GITHUB_TOKEN) throw Error('config');
    const get = async path => {
      const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!response.ok) throw Error('api');
      return response.json();
    };
    const { workflow_runs: runs } = await get('actions/workflows/launch-monitor.yml/runs?per_page=30');
    const latest = await latestReport(runs, async id => (await get(`actions/runs/${id}/artifacts?per_page=100`)).artifacts);
    result = heartbeat(latest);
  } catch { result = { ok: false, reviewRequired: true, pauseRequired: false, reason: 'heartbeat-unavailable' }; }
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
