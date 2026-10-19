/**
 * Wire types for an agent's Agent API keys.
 *
 * Hand-written against `Spora\Http\AgentApi\AgentApiKeyController` in
 * spora-core. The SPA does not consume `openapi.json` — the controller is
 * the source of truth, and this file is the transcription of its wire
 * shape.
 */

/**
 * Key metadata as listed by `GET /agents/{id}/api-keys`.
 *
 * There is no `secret` field: the plaintext is returned exactly once, by
 * the create call, and only its SHA-256 digest is stored server-side.
 */
export interface AgentApiKey {
  id: string;
  agent_id: number;
  name: string;
  /** ISO-8601, or null if the key has never authenticated a request. */
  last_used_at: string | null;
  created_at: string | null;
}

export interface CreateAgentApiKeyPayload {
  name: string;
}

/**
 * The one response that carries a secret. `secret` is unrecoverable
 * afterwards, so the UI must show it before the dialog closes and must
 * never offer to fetch it again.
 */
export interface CreatedAgentApiKey {
  key: AgentApiKey;
  secret: string;
}
