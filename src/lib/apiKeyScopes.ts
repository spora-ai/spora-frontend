import type { ApiKeyScope } from '@/types/apiKey'
import type { FeatureFlag } from '@/composables/useFeatureEnabled'

/**
 * What each scope reaches and where it lives.
 *
 * Two maps that have to move together — a scope's toggle and its path are
 * one fact about the feature, not two — so they sit next to each other
 * rather than being spelled out at each use.
 */

/**
 * The bearer surface a scope's key drives.
 *
 * A path, not copy: the sections name the path so an operator can see which
 * endpoints their key is for.
 */
export const API_KEY_SCOPE_PATHS: Record<ApiKeyScope, string> = {
  agent: '/api/v1/agent-api/*',
  group: '/api/v1/group-api/*',
  global: '/api/v1/global-api/*',
}

/**
 * The setting that mounts a scope's surface.
 *
 * The three scopes are independent — there is no master switch — so each
 * names its own toggle.
 */
export const API_KEY_SCOPE_FLAGS: Record<ApiKeyScope, FeatureFlag> = {
  agent: 'agent_api',
  group: 'group_api',
  global: 'global_api',
}
