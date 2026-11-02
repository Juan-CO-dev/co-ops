# Landing WAF attestation — TEMPLATE

Status: NOT ATTESTED. Blank fields block approval. No credentials, IPs, user data, headers or bodies; reference evidence by non-sensitive artifact name only.

- Commit / deployment revision:
- Plan / rate-limit and header-key entitlement:
- Approved landing target and staff origin checked:
- Remote CAPI/counter flags false; redeployment date:
- Juan approval to run bursts (date):

| Rule name | Actual ID | Host/path/method condition | Action / limit | Verified |
|---|---|---|---|---|
| landing-api-method | | | deny | |
| landing-capi-ip | | | 30/60 s per IP → 429 | |
| landing-counter-ip | | | 60/min per IP → 429 | |
| landing-adcode-ip | | | 30/min per IP → 429 | |
| landing-capi-aggregate | | | 600/min per host or accepted N/A | |

No challenge action on `/api/landing/*` or landing HTML confirmed:

| Runner label | Phase a–g | Proof JSON | UTC start/end | Counts / statuses | Verdict |
|---|---|---|---|---|---|
| | | | | | |

- b: independent egress and overlapping intervals for at least two runners:
- c: 25 independent runners × 25 events; or unsupported header keys, N/A and Juan acceptance/date:
- d: each spoof header checked; exhausted bucket stays 429:
- e: GET 403/405 per endpoint:
- f: staff 404 per endpoint and zero Meta requests:
- g: recovery 204 (ad-code 200):
- Deviations / remediation / retest evidence:
- CC review date / decision:
- Juan approval date / decision:

## Env values to set after approval (D4)

- `LANDING_WAF_STATE=active`
- `LANDING_WAF_RULE_IDS`: reviewed IDs above
- `LANDING_WAF_VERIFIED_AT`: verification date YYYY-MM-DD
- Keep `LANDING_CAPI_ENABLED=false` and `LANDING_COUNTER_ENABLED=false` until their ordered go-live gates.

## Remaining D6 launch evidence

- Rules recorded; phases a–g pass (aggregate N/A explicitly accepted); CC review and Juan approval:
- `landingRateLimit(env) === 'allowed'`:
- Pixel IDs match (boolean only):
- Token present (boolean only); version v25.0:
- No test code in Production; UA disclosure approved:
- Preview Test Events: Lead, OrderClick, CateringClick all Deduplicated:
- Production Browser + Server received:
- Reject / withdraw / DNT / GPC each send zero Meta requests:
- Staff isolation: no Meta, landing APIs 404:
- Rollback tested: CAPI false + redeploy; recovery approval:

EMQ accepted as-is; never enrich with IP, email or phone. Navigating resolution taps are server-only; PageView/ViewContent are pixel-only. Prove dedup with paired dispatches for the three supported action events.
