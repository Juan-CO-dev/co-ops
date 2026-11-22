# Demand signals: AI insights (item 4 PR 7)

**Ships OFF.** Nothing runs on its own. Nothing here changes an order, a par, a prep number or a schedule.

## What it is

On the demand signals page (`/admin/demand-signals`), a section "AI insights". Once a day per shop a manager may press "Ask for today's insights". An AI model then picks which of the facts already on the page to look at first. Every sentence shown is written by the app from those facts. Nothing the model writes is shown or stored.

## The four keys (all needed)

| Key | Who sets it | Without it |
|---|---|---|
| `DEMAND_SIGNALS=1` | CC, in Vercel | The page does not exist (404). |
| `DEMAND_AI=1` | CC, in Vercel, on Juan's word | The section does not exist. |
| `DEMAND_AI_API_KEY` | **Juan** (his own key, in Vercel; CC and builders never set, read, print or log it) | The section says "AI insights are not configured: no key is set for them. Nothing is sent anywhere." The route answers 503. Nothing is read, reserved or sent. |
| Migration 0352 applied | CC. **Done:** sim 2026-11-20 (20261120024511), prod 2026-11-20 UTC (schema_migrations version 20261120033423) | The section says "not set up in this system yet." |

This feature never uses `ANTHROPIC_API_KEY` (the receipt parser's key). The two are separate on purpose.

Optional:

- `DEMAND_AI_MODEL`: default `claude-opus-5-5`. Only a model with a price row in `lib/demand-signals/insights-shared.ts` (`AI_PRICES`) can be called. Today: `claude-opus-5-5` ($4 / $20 per million tokens in / out) and `claude-sonnet-5-5` ($2 / $10), read from the Claude models overview on 2026-11-19. Re-read that page before changing a row.
- `DEMAND_AI_MONTHLY_CAP_CENTS`: a whole number of cents. It can only LOWER the built-in limit of $5.00 a month (all shops together). A value that is not a whole number means 0: nothing is sent.

## Turning it on (in order)

1. **Done 2026-11-20 UTC** (sim 20261120024511, prod 20261120033423): apply 0352 to sim, verify, then prod on Juan's word (after 0343). It creates two tables and six functions and touches nothing that exists. Pre-flight is in the file header. The prepared scripts are named in the PR.
2. Juan sets `DEMAND_AI_API_KEY` in Vercel.
3. CC sets `DEMAND_AI=1`. Redeploy.
4. Open the page as a GM or above. The section should show the button and "This month: $0.00 of at most $5.00".

## What a request costs

- At most one request per shop per ET day, whatever happens to it.
- Before the call, the WORST case is set aside (every byte sent counted as a token, plus the full 2,000-token answer). With today's prices that is about 5 to 7 cents set aside per request on `claude-opus-5-5`.
- There is exactly one request per press. It is never retried: a request whose answer did not arrive is recorded as failed and keeps its full set-aside.
- After the call, the real cost replaces it. A typical request is small: on the order of one cent. That is an estimate from the size of what is sent; no request has ever been made, so it is not measured.
- A call that failed or crashed keeps its full set-aside for the month. Nothing ever releases one.
- When the month's total would pass the limit, the request is refused before anything is sent.

## Checking it

```sql
-- this month's attempts, newest first
select r.day_et, r.location_id, r.model, r.reserved_micro, s.outcome, s.actual_micro, s.input_tokens, s.output_tokens, s.stop_reason, s.error_code, s.rejected_count
from demand_ai_reservations r left join demand_ai_settlements s on s.reservation_id = r.id
order by r.reserved_at desc limit 20;

-- what this month has cost so far (microdollars; 1,000,000 = $1.00)
select demand_ai_month_spent_micro(demand_today_et());

-- who asked
select created_at, actor_id, metadata from audit_log where action = 'demand_ai.request' order by created_at desc limit 20;
```

A row in `demand_ai_reservations` with no row in `demand_ai_settlements` is a call that crashed before it could be recorded. It counts in full.

## What the page says when it does not answer

| The page says | Meaning |
|---|---|
| Not configured: no key is set | `DEMAND_AI=1` but `DEMAND_AI_API_KEY` is empty. |
| Not configured: the chosen model has no price on record | `DEMAND_AI_MODEL` names a model with no row in `AI_PRICES`. |
| Today's one request for this shop has been made | One a day. Tomorrow (ET) it can be asked again. |
| This month's spending limit is reached | The month's total plus the worst case of one more request would pass the limit. |
| The model refused the key | The key is wrong or revoked. Juan checks it. The day's request is used. |
| N things picked earlier are no longer on this page | A fact the answer cited has left the page since (an event was taken back, a source was revoked, a forecast arrived). It is not shown any more. |
| The model's answer was not in the form we accept | The model returned something other than the list we asked for. None of it is shown. The cost is recorded. |

## Turning it off

Unset `DEMAND_AI` and redeploy. The section disappears. Stored rows stay (there is no delete path).
