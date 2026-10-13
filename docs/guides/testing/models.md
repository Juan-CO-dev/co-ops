# Guides v2 tester models

Pinned 2026-10-13. GLM and DeepSeek IDs come from each provider's `/models` list (`python scripts/guide-test/api_tester.py --list-models <provider>`).

| Label | Family | Lane | Model ID |
|---|---|---|---|
| opus | Claude | claude (Agent tool) | `opus` → Opus 5.5 |
| sonnet | Claude | claude | `sonnet` → Sonnet 5.5 |
| haiku | Claude | claude, run on the CO desktop | `claude -p --model haiku` there = `claude-haiku-5-5` (checked 2026-10-13; this laptop's alias still gives Haiku 4.5). The desktop session reaches the laptop daemon through an SSH tunnel (`ssh -R 3199:127.0.0.1:3199 co-desktop`). |
| fable | Claude | claude | `fable` → Fable 5.1 |
| astra | OpenAI | codex | `gpt-6-astra` |
| sol | OpenAI | codex | `gpt-5.6` |
| terra | OpenAI | codex | `gpt-5.6-terra` |
| luna | OpenAI | codex | `gpt-5.6-luna` |
| glm | GLM (flagship) | api | `glm-5.3` |
| glmflash | GLM (flash) | api | `glm-5.3-flash` |
| deepseek | DeepSeek (flagship) | api | `deepseek-v4-pro` |
| dsflash | DeepSeek (flash) | api | `deepseek-flash` |

Every report starts with a "Model I am" line; the API loop also stamps the exact ID in the report's header comment.
