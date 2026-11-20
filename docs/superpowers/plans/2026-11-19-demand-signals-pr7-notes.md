# Demand signals (item 4): PR 7 build notes: AI insights

Plan: CHIEF `item-04-DEMAND-SIGNALS-PLAN-r2.md`, section 8 (AI safeguards), with Astra r2 P2 #4 and the contract PR 1 wrote for this PR (`lib/demand-signals/contracts-shared.ts`). Stacked on PR 6a (#613), which is stacked on PR 5 (#611). Migration `0352_demand_ai_insights.sql`, file only. **OFF behind `DEMAND_AI`. No key is present, and none was used to build or test this.**

## What it is

A section on the signals page. Once a day per shop a manager may ask an AI model which of the facts already on the page to look at first. The app writes every sentence.

## How each safeguard of plan section 8 is held

| Plan | Here |
|---|---|
| Grounded only in stored facts; an allow-listed DTO; each fact has an evidence id | `buildInsightFacts`: ids, kinds, dates and closed-list codes. Built from what the page read whole, or not at all. |
| The model returns claim types plus evidence ids | One JSON schema (`output_config.format`); `parseModelClaims` refuses anything else as a whole. |
| Deterministic en + es templates supply every number, shop and date | `insightSentenceKey` + the stored facts. The model's text is never rendered, stored or logged. |
| The optional plain sentence | **Withdrawn** by Astra r2 P2 #4. There is no free-text channel and no field that could carry one. |
| No PII; manual event notes excluded; events as category and date only | No title, no note, no name, no shop id. A test sends a title with a name and an address and asserts none of it is in the request. |
| Spend cap enforced in code; a definer RPC reserves the worst case under a lock and settles after | `demand_ai_reserve` / `demand_ai_settle` (0352). The cap is in code and in SQL. |
| A crashed call keeps its reservation | Nothing releases a reservation. No settlement row = counted in full. |
| The env var can only lower the code cap | `aiConfig`: `min(code cap, env)`; unreadable = 0. 0352 refuses a cap above its own ceiling. |
| A model with no entry in the price table refuses | `model_unpriced`: no call, the page says so. |
| Token limits, a 20-second timeout, one retry, one call per shop per night | 2,000 output tokens, 16 KB in, 20 s, one retry, one attempt per shop per ET day. |
| Cache key | The stored row for the shop and day carries the input hash (facts, model, prompt version, schema, system text, audience policy). The page says when the facts have changed since. Language is not in the key: a claim has no language, the template does. |
| Never auto-acts; an import-closure test | `tests/demand-signals-insights.test.ts`. |
| Ships OFF until Juan sets the key and the cap | `DEMAND_AI` unset by default; without the key it is "not configured". |

## Decisions (CC to confirm)

1. **A person asks; there is no nightly call.** The plan said "one call per shop per night". This PR makes it "at most one per shop per ET day, when a manager presses the button". No cron, no lease, no cost when nobody asks.
2. **Its own key, `DEMAND_AI_API_KEY`.** `ANTHROPIC_API_KEY` belongs to the receipt parser. Using it here would let `DEMAND_AI=1` spend a key nobody chose for this.
3. **The Anthropic SDK (`@anthropic-ai/sdk` 1.11.0) is added**, as the build instruction asked. The receipt parser calls the API directly and still does; the SDK is imported by one module only. The commit is separate.
4. **Model `claude-opus-5-5` by default**, with `claude-sonnet-5-5` selectable. Both prices were read from the Claude models overview on 2026-11-19. `claude-haiku-5-5` is not in the table because its listed price is "from", not one figure.
5. **The cap is $5.00 a month for all shops.** Juan can lower it with `DEMAND_AI_MONTHLY_CAP_CENTS`; raising it is a code and migration change.
6. **Only two of the six claim types are offered today** (`event_on_date`, `data_missing`), because only their evidence can be produced from stored data. The other four need stored scores and qualifications (the second half of PR 6).
7. **A failed attempt uses the day.** Simple and safe; it also means a bad key costs at most one attempt per shop per day.
8. **Asking takes no password.** One capped request a day by a GM or above, writing only its own ledger rows.
9. **GM and above see the month's AI spend** (cents). It is not labor or sales money.

## What is NOT verified

- **No request has ever been made.** No key exists. The request shape (`output_config.format` with a JSON schema, `effort: "low"`) is taken from the SDK's own types (1.11.0) and the structured-outputs documentation, not from a live answer. The first real request is the canary: if the API refuses the shape, the page says "the model did not accept the request" and one attempt is used.
- **The cost of a real request is an estimate.** The worst case is computed; the typical case is not measured.
- **"One token is never shorter than one byte"** is the assumption behind the worst case. It is conservative for every tokenizer we know of, and the reservation adds a margin and counts a retry.
- Not rendered in a browser.

## Later

- Scores, qualifications and episodes as evidence, once they are stored.
- A reader of past days' answers (only today's is shown).
