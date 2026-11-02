# Landing WAF rules

Preparation only; CC installs rules after Juan approves. No challenge action on `/api/landing/*` or the landing HTML.

| Rule | Condition | Action |
|---|---|---|
| `landing-api-method` | /api/landing/{events,order-click,ad-code}, method ≠ POST | deny |
| `landing-capi-ip` | /api/landing/events | 30/60 s per IP → 429 |
| `landing-counter-ip` | /api/landing/order-click | 60/min per IP → 429 |
| `landing-adcode-ip` | /api/landing/ad-code | 30/min per IP → 429 |
| `landing-capi-aggregate` | /api/landing/events | 600/min keyed on host if the plan supports header keys; else recorded as N/A and Juan accepts it |

Scope custom rules to the landing host, never staff. Use ingress client identity, not supplied forwarding headers. Record actual entitlement and rules in the [attestation](../evidence/landing-waf-attestation-TEMPLATE.md). Re-tune after week 1.

## Authorized operator proof (D2)

Do not run during a build. CC first verifies remote `LANDING_CAPI_ENABLED=false` and `LANDING_COUNTER_ENABLED=false`, redeployed, and records this in the attestation. Set both false in the runner process and supply `--confirm-flags-off`. This attests a manual deployment check; it cannot detect remote flags. Events/counter then return 204 with no Meta call or DB write. Ad-code uses `unattributed` (200, no registry lookup).

Invocation: `node scripts/landing/waf-burst-proof.mjs --origin <approved-HTTPS-origin> --rule-ids <comma-separated-IDs> --runner-label runner-alpha --confirm-juan-ok --confirm-flags-off --phase <a-through-g>`. Primary origin refuses `STAFF_ORIGIN`, the existing staff deployment and `--staff-origin`. The latter defaults to the existing staff deployment. Phase f alone probes staff once per endpoint, never bursts. Bare HTTPS origins only, without credentials/query/fragment. Runner labels are `runner-` plus 1–12 lowercase letters, no personal data.

Run phases in order with at least 65 seconds of quiet before each invocation. No unrelated traffic. All phases cover all three endpoints except c (events only); endpoints are separated by 65 seconds. A saved file is not a passing verdict.

| Phase | Procedure and acceptance |
|---|---|
| a | 120 POSTs in 10 seconds per endpoint. Initial 204 (ad-code 200), then 429 at the approved limit; no unexpected statuses. |
| b | Same from at least two independent egress runners simultaneously. Identical future `--start-at <UTC-ISO>` and `--runner-count 2`, distinct labels. Verify overlapping intervals and independent egress privately, never record IPs. Each bucket enforces its own limit. |
| c | At least 25 independent egress runners each send 25 events in 10 seconds: 625 total, each below its IP limit. Same future start and `--runner-count 25`. Review all files for host aggregate 429s above 600 without per-IP confounding. Unsupported header keys require N/A and Juan's explicit acceptance instead. |
| d | First 90 POSTs exhaust the bucket; last 30 rotate XFF/X-Real-IP/True-Client-IP documentation addresses. Every spoof-segment request must remain 429. |
| e | GET returns 403/405 on every endpoint. |
| f | Staff host returns 404 on every endpoint. Separately prove staff browsing sends zero Meta requests. |
| g | After 65 seconds, normal POSTs recover to 204 (ad-code 200). |

Output is exclusively created at `tmp/landing-waf-proof/<ts>.json`: phase/endpoint labels, runner label, declared runner count, request counts, status histograms and UTC times only. No bodies, IPs, headers, tokens, origins, rule IDs or exception text. Network errors are a fixed status, never a pass. Runner count is declared, not independently proven. CC reviews all evidence; Juan approves D3 before WAF env is set. See [go-live](../runbooks/landing-go-live.md) for D4 and D6.
