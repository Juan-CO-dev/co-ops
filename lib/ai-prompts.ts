/**
 * AI prompt templates — Phase 6.
 *
 * Model: claude-sonnet-4-6 (server-side via @anthropic-ai/sdk).
 * Prompts are role-scoped — different role levels get different system
 * prompts and different data access (per spec Section 7.2 ai.insights.run).
 *
 * Templates planned:
 *   - dailySynthesis(date, locationId)
 *   - weeklySynthesis(weekStart, locationId)
 *   - executiveSummary(timeRange, locationId)
 *   - forecastNarrative(timeRange, locationId)  -- CGS only
 */
export const AI_MODEL = "claude-sonnet-4-6" as const;
