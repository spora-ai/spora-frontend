import { api } from "./client";
import type {
  ApiKey,
  ApiKeyScope,
  CreateApiKeyPayload,
  CreatedApiKey,
} from "@/types/apiKey";

/**
 * Admin surface for the API keys of a scope.
 *
 * Not to be confused with the API itself: these routes are
 * session-authenticated and CSRF-protected like the rest of the admin, because
 * this is where an operator mints credentials. The bearer endpoints an
 * external caller would use are not reachable from here.
 */

/**
 * The collection the scope's keys live in.
 *
 * The global scope has no target — its keys are the install's — so it gets a
 * collection of its own rather than a target id the server would ignore.
 */
function collectionPath(scope: ApiKeyScope, targetId: number | null): string {
  switch (scope) {
    case "agent":
      return `/agents/${targetId}/api-keys`;
    case "group":
      return `/groups/${targetId}/api-keys`;
    case "global":
      return "/global-api-keys";
  }
}

export const apiKeysApi = {
  /**
   * Key metadata only — a secret is never present on this response, and
   * cannot be: the server keeps a SHA-256 digest and nothing else.
   */
  list: (scope: ApiKeyScope, targetId: number | null): Promise<ApiKey[]> =>
    api
      .get<{ keys: ApiKey[] }>(collectionPath(scope, targetId))
      .then((r) => r.keys),

  /**
   * The one call that returns a plaintext `secret`. It exists only in this
   * response and cannot be retrieved again, so callers must surface it before
   * discarding the value.
   */
  create: (
    scope: ApiKeyScope,
    targetId: number | null,
    payload: CreateApiKeyPayload,
  ): Promise<CreatedApiKey> =>
    api
      .post<{ key: CreatedApiKey["key"]; secret: string }>(
        collectionPath(scope, targetId),
        payload,
      )
      .then((r) => ({ key: r.key, secret: r.secret })),

  /**
   * 200 with `{revoked, key_id}` rather than a 204: a 204 goes out with no
   * body and no Content-Length, which Vite's dev proxy turns into a 502.
   */
  remove: (
    scope: ApiKeyScope,
    targetId: number | null,
    keyId: string,
  ): Promise<{ revoked: boolean; key_id: string }> =>
    api.delete(
      `${collectionPath(scope, targetId)}/${encodeURIComponent(keyId)}`,
    ),
};
