/**
 * Demand signals (item 4 PR 7): THE ONE MODULE THAT TALKS TO THE MODEL. Server-only.
 *
 * It is reached only from insights.ts, after the switch, the key, the price table, the size limit and the
 * spend reservation have all said yes. It reads NO environment: the key is handed in, and a client is NEVER
 * built without one (the SDK would otherwise pick up a key another feature set in the environment).
 * It asks for JSON of ONE schema and returns the raw text of the first text block for `parseModelClaims` to
 * accept or refuse. It never logs, stores or returns anything else the model wrote, and an error is a fixed
 * code, never a message.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export interface AskArgs { apiKey: string; model: string; system: string; user: string; schema: Record<string, unknown>; maxTokens: number; timeoutMs: number; maxRetries: number }
export type AskResult =
  | { ok: true; text: string | null; stopReason: string | null; inputTokens: number; outputTokens: number }
  | { ok: false; code: "ai_timeout" | "ai_auth" | "ai_rate_limited" | "ai_refused_request" | "ai_unavailable" };

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0);

export async function askForClaims(args: AskArgs): Promise<AskResult> {
  if (typeof args.apiKey !== "string" || args.apiKey.trim() === "") throw new Error("ai_key_missing");
  const client = new Anthropic({ apiKey: args.apiKey, timeout: args.timeoutMs, maxRetries: args.maxRetries });
  try {
    const message = await client.messages.create({
      model: args.model, max_tokens: args.maxTokens, system: args.system,
      messages: [{ role: "user", content: args.user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: args.schema } },
    });
    const block = message.content.find((b) => b.type === "text");
    const usage = message.usage;
    return {
      ok: true, text: block && block.type === "text" ? block.text : null, stopReason: message.stop_reason ?? null,
      // Cache tokens, if the API ever reports any, are counted as input at the full price (an upper bound).
      inputTokens: count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens),
      outputTokens: count(usage.output_tokens),
    };
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, code: "ai_timeout" };
    if (error instanceof Anthropic.APIError) {
      if (error.status === 401 || error.status === 403) return { ok: false, code: "ai_auth" };
      if (error.status === 429) return { ok: false, code: "ai_rate_limited" };
      if (error.status === 400 || error.status === 404 || error.status === 413 || error.status === 422) return { ok: false, code: "ai_refused_request" };
    }
    return { ok: false, code: "ai_unavailable" };
  }
}
