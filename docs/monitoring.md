# Launch monitoring (E5)

Preparation only; no monitor, runner, resource, variable or external service has been activated. Paid spend remains blocked until a successful external US run, intentional alert receipt, heartbeat coverage and merchant evidence are recorded. The workflow is disabled unless CC sets repository variable `LANDING_MONITOR_ENABLED=true` after authorization. It requires an existing authorized external US self-hosted Linux runner labeled `landing-probe-us`; runner location must be verified, not inferred from a GitHub-hosted label. No resources are provisioned by this change.

The cron is `*/15 * * * *`, separate from PR gates. `scripts/probe-money-path.mjs` reads the tenant's current two order URLs, active catering flag and inquiry URL directly from `config/tenant/landing.ts`, plus a reviewed landing origin. All five probes run independently. It makes only GET requests, never orders, login attempts or tracking events. Each request has a 15-second deadline across up to four redirects, exact approved HTTPS hosts and a 2 MB body bound; page probes permit one transient retry, except the first landing 5xx is preserved immediately for incident rechecks. 403, 429, challenges, timeouts, wrong hosts, wrong/missing branches, missing baselines and digest drift all fail. No response body, full URL, customer data or exception text enters a report. Reports retain bounded status/host/digests and incident timestamps for 14 days.

## Merchant inspection and reviewed baseline

Redirects are followed only within the approved hosts and bound, then reported with their hop count and refused even if the final body is unchanged. A merchant redirect requires review and an approved canonical destination change before activation; a response hash alone cannot approve a new routing path. Payload redirects have the same rule.

The actual Appfront data endpoint/schema is still unknown. A 200 SPA shell is insufficient. CC must inspect the real merchant flow, identify the data endpoint and branch array schema, and verify both configured branch IDs and `servingOptionType=a` on launch day. Do not guess an API URL or approve a baseline automatically. Challenge or geo-block evidence needs the US runner or manual investigation; it cannot be waived as a passing probe.

Add the reviewed, non-secret `docs/landing-monitor-baseline.json` only after inspection. Shape:

```json
{
  "reviewedBy": "CC",
  "reviewedAt": "<ISO timestamp>",
  "landingOrigin": "<approved public HTTPS origin>",
  "staffOrigin": "<approved staff HTTPS origin, needed when cateringPortalLive is true>",
  "probes": {
    "landing": { "hosts": ["<approved host>"], "sha256": "<64 lowercase hex>" },
    "order-capitol-hill": {
      "hosts": ["<approved order host>"], "sha256": "<shell hash>",
      "data": {
        "url": "<merchant-inspected public HTTPS payload URL>",
        "hosts": ["<approved payload host>"],
        "sha256": "<payload response hash>",
        "arrayPath": ["<actual branch-array property path>"],
        "idField": "<actual branch ID field>",
        "fields": ["<actual branch ID field>", "<reviewed stable non-personal field>"],
        "branchSha256": "<normalized branch digest>"
      }
    },
    "order-dupont": { "hosts": ["<approved order host>"], "sha256": "<shell hash>", "data": "<same object shape, merchant-reviewed for Dupont>" },
    "catering": { "hosts": ["<active catering host>"], "sha256": "<response hash>" },
    "inquiry": { "hosts": ["<approved inquiry host>"], "sha256": "<response hash>" }
  }
}
```

This is a schema illustration, deliberately not runnable config. `arrayPath: []` supports a root array. Selected fields must be scalar string/number/boolean and include the actual ID field. `branchDigest` sorts field keys and branch records before hashing, so ordering changes do not cause branch drift; missing IDs/fields fail. Response hashes separately detect shell/payload drift. Review dynamic-shell changes independently; never suppress a missing-branch failure. Inspect candidate bodies locally without saving personal data, use exported `digest`/`branchDigest` to calculate candidates, and obtain CC review before checking in hashes. Do not include credentials, tokens, private endpoint URLs or personal fields. Update the baseline whenever approved destinations/portal flag change; never automatically accept drift.

Run after the baseline is reviewed:

```sh
node --experimental-strip-types scripts/probe-money-path.mjs docs/landing-monitor-baseline.json
npx vitest run tests/landing/monitor.test.ts --maxWorkers=3
```

## Alert, heartbeat, pause and recovery

Default alert delivery is GitHub Actions failure email to the repository owner. Juan enables Actions notifications and confirms the recipient; after activation CC deliberately tests a bad baseline in a manual workflow run, records run URL, failure timestamp, receipt timestamp and recipient, then restores the reviewed baseline and verifies green. A failed workflow alone is not proof an alert reached anyone. No automatic outbound messaging or spend changes are implemented here.

GitHub schedules may be delayed or dropped. An independently operated scheduler/heartbeat checker must inspect this workflow's latest **completed report** every minute and alert Juan if no completion occurs within 20 minutes, the runner is offline, the job is skipped, or no report exists. A job start or disabled/skipped workflow is not a healthy heartbeat. Record checker owner, tested stale-alert receipt, observed cron intervals and maximum delay before spend. If 15-minute cadence cannot be demonstrated, use an authorized external scheduler for these probes. Nothing in this repository alone can detect a GitHub scheduler outage while GitHub is not running it.

A broken order probe requests immediate spend pause by Juan. First observed landing 5xx initiates one-minute incident rechecks through more than ten minutes (11 rechecks); the initial failure remains an alert even if it recovers. A successful probe records recovery, while missing/blocked probes never imply recovery. An unresolved incident past ten minutes requests pause conservatively, including lost visibility. Pause immediately if existing external evidence already proves a >10-minute landing 5xx outage. Typical worst-case initial detection is 15 minutes plus scheduler delay and bounded probe time; these rechecks prevent waiting another 15 minutes after detection. Record actual delay, first failure, each recheck, recovery and Juan's action. An external faster monitor is required if that initial delay is unacceptable.

After a failure, Juan verifies fresh green probes, both real store/serving-option flows and landing HTTPS on a phone before resuming spend. Never auto-resume on a missing probe or a single successful workflow. Release evidence must link: reviewed baseline; merchant/manual store checks; US runner proof; successful external run; deliberate failure and email receipt; heartbeat test; measured cadence; named pause owner and recovery record. These activation proofs remain OPEN.
