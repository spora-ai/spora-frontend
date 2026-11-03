/**
 * Wire types for the API keys of the agent, group and global scopes.
 *
 * Hand-written against `Spora\Http\AgentApi\AgentApiKeyController` and
 * `Spora\Http\ScopedApi\ScopedApiKeyController` in spora-core. The SPA does
 * not consume `openapi.json` — the controller is the source of truth, and
 * this file is the transcription of its wire shape.
 */

/**
 * What a credential may reach.
 *
 * `agent` — one agent, its chats and their media.
 * `group` — every agent of one group, their chats and their media.
 * `global` — every group, their agents and their chats.
 *
 * A personal agent is reachable only by an `agent` key: there is no
 * user-scoped key, and the global scope does not reach one.
 */
export type ApiKeyScope = 'agent' | 'group' | 'global'

/**
 * Key metadata as listed by the scope's key-management endpoint.
 *
 * There is no `secret` field: the plaintext is returned exactly once, by the
 * create call, and only its SHA-256 digest is stored server-side.
 */
export interface ApiKey {
  id: string;
  /** The scope the key was minted for. */
  scope: ApiKeyScope;
  /** The agent, for an `agent`-scoped key. */
  agent_id: number | null;
  /** The group, for a `group`-scoped key. */
  group_id: number | null;
  name: string;
  /** ISO-8601, or null if the key has never authenticated a request. */
  last_used_at: string | null;
  created_at: string | null;
}

export interface CreateApiKeyPayload {
  name: string;
}

/**
 * The one response that carries a secret. `secret` is unrecoverable
 * afterwards, so the UI must show it before the dialog closes and must never
 * offer to fetch it again.
 */
export interface CreatedApiKey {
  key: ApiKey;
  secret: string;
}
