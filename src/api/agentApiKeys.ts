import { api } from './client'
import type {
  AgentApiKey,
  CreateAgentApiKeyPayload,
  CreatedAgentApiKey,
} from '@/types/agentApiKey'

/**
 * Admin surface for an agent's Agent API keys.
 *
 * Not to be confused with the Agent API itself: these routes are
 * session-authenticated and CSRF-protected like the rest of the admin,
 * because this is where an operator mints credentials. The bearer
 * endpoints an external caller would use are not reachable from here.
 */
export const agentApiKeysApi = {
  /**
   * Key metadata only — a secret is never present on this response, and
   * cannot be: the server keeps a SHA-256 digest and nothing else.
   */
  list: (agentId: number): Promise<AgentApiKey[]> =>
    api.get<{ keys: AgentApiKey[] }>(`/agents/${agentId}/api-keys`).then((r) => r.keys),

  /**
   * The one call that returns a plaintext `secret`. It exists only in
   * this response and cannot be retrieved again, so callers must surface
   * it before discarding the value.
   */
  create: (agentId: number, payload: CreateAgentApiKeyPayload): Promise<CreatedAgentApiKey> =>
    api.post<{ key: CreatedAgentApiKey['key']; secret: string }>(
      `/agents/${agentId}/api-keys`,
      payload,
    ).then((r) => ({ key: r.key, secret: r.secret })),

  /** Idempotent: a deleted key answers 204 whether or not it existed. */
  remove: (agentId: number, keyId: string): Promise<void> =>
    api.delete(`/agents/${agentId}/api-keys/${encodeURIComponent(keyId)}`),
}
