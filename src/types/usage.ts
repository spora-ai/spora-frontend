/**
 * LLM usage accounting types — round-tripped from the backend on every
 * assistant history entry and aggregated into a top-level `totals` block
 * on the task detail response.
 *
 * These shapes are a stable wire contract with the backend PR #1: the
 * server strips server-only fields (`raw_usage`, `driver_meta_info`,
 * thinking-block `signature` and `data` bytes) before serializing so the
 * frontend never sees them. Do NOT add those fields to these interfaces
 * without a matching backend change.
 */

/** LLM provider that produced a given turn's usage row. */
export type UsageProvider = 'openai' | 'anthropic' | 'unknown'

/** Per-assistant-turn token accounting. */
export interface Usage {
  /** Tokens billed as input. For OpenAI this INCLUDES `cached_tokens`. */
  input_tokens: number
  /** Tokens billed as output. */
  output_tokens: number
  /**
   * Tokens spent on chain-of-thought reasoning.
   *
   * - OpenAI Chat Completions: never returned; stays 0.
   * - OpenAI Responses API: billed but opaque to the consumer in Chat
   *   Completions; surfaced via the Responses API's encrypted `output[]`
   *   items. When Spora adopts that driver, this counter will populate.
   * - Anthropic: always populated for extended-thinking turns.
   */
  reasoning_tokens: number
  /**
   * OpenAI prompt-cache hit count. Only set when the upstream driver
   * actually reports it. The OpenAI Chat Completions API includes
   * cached tokens INSIDE `input_tokens`, so `cacheHitRate` divides this
   * by `input_tokens` rather than by an independent total.
   */
  cached_tokens: number
  /** Anthropic: tokens written into the prompt cache this turn. */
  cache_creation_tokens: number
  /** Anthropic: tokens served from the prompt cache this turn. */
  cache_read_tokens: number
  provider: UsageProvider
}

/**
 * Aggregate `totals` block surfaced on the TaskDetail wire shape. Same
 * six counters as {@link Usage} but without the `provider` discriminator
 * (totals are a per-role aggregate that intentionally does NOT collapse
 * across providers — see backend PR #1).
 */
export interface UsageTotals {
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cached_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
}

/** Discriminated content block that makes up a structured assistant message. */
export type ContentBlockType =
  | 'text'
  | 'image'
  | 'thinking'
  | 'redacted_thinking'
  | 'tool_use'

/**
 * One structured piece of an assistant message. Mirrors the backend
 * `ContentBlock` schema after server-side stripping of `signature` (the
 * Anthropic extended-thinking byte-identical proof) and `data` (the
 * encrypted reasoning blob). Those are server-only because the frontend
 * has no use for them and they would bloat every history fetch.
 */
export interface ContentBlock {
  type: ContentBlockType
  text?: string | null
  /** Image MIME type, e.g. `image/png`. */
  mediaType?: string | null
  /**
   * Pre-signed data URL or a transient upload URL. For text / thinking
   * blocks this is null. The page never persists these URLs — they're
   * served short-lived by the backend.
   */
  url?: string | null
  /** Anthropic `tool_use.id`. The model-side identifier that the matching tool result must reference. */
  toolUseId?: string | null
  /** Tool name, e.g. `web_search`. */
  toolName?: string | null
  /** Tool input parameters as a JSON object. */
  toolInput?: Record<string, unknown> | null
  /**
   * Free-form provider metadata kept for forward compatibility (e.g. a
   * future backend might attach the source URL of a citation block).
   * Frontend code should not depend on specific keys.
   */
  metadata?: Record<string, unknown> | null
}

