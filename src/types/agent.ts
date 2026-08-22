export interface AgentTool {
  tool_class: string
  tool_name: string
  /** Resolved icon key (3-layer chain applied server-side: tool.icon → plugin.icon → 'puzzle').
   *  Optional; null falls back to 'puzzle' via the <Icon> component's own fallback. */
  icon?: string | null
}

import type { ProfilePicture } from './profilePicture'

/**
 * Backward-compat alias — the agent-side picture wire shape is
 * structurally identical to the cross-subject `ProfilePicture`. Kept
 * under its historical name so the existing `Agent.profile_picture`
 * typing at every call site stays byte-identical (the property name
 * itself is unchanged too). New code should import `ProfilePicture`
 * directly.
 */
export type AgentProfilePicture = ProfilePicture

import type { Principal } from './principal'

export interface Agent {
  id: number
  name: string
  description: string | null
  system_prompt: string | null
  /**
   * Owning principal id — every agent has exactly one after migration
   * 0067 cut `agents.user_id` and re-keyed on `principals.id`. Always
   * emitted by `AgentResource::toArray`.
   */
  principal_id: number
  /**
   * Resolved principal block (`{id, type, name, user_id, group_id}`)
   * matching the frontend's `Principal` shape. Always emitted by
   * `AgentResource::toArray`; null only on legacy fixtures where
   * `principal_id` was null pre-cutover.
   */
  principal: Principal | null
  /**
   * Other principals the current principal can transfer ownership to
   * (filtered server-side by group membership + role). Optional — the
   * transfer dialog populates it; the dashboard does not currently
   * consume it.
   */
  transferable_to?: Principal[]
  /**
   * Operator-facing markdown notes attached to the agent. Readable/writable
   * by operators via PATCH /agents/{id} and by the agent itself via the
   * `AgentTool` (read_notes / write_notes). The field is intentionally not
   * mutable through `AgentTool.update_agent` — only `write_notes` touches it.
   */
  notes?: string | null
  llm_driver_config_id: number | null
  /** Whether the configured LLM driver + model accepts image content blocks. */
  llm_supports_image_input?: boolean
  max_steps: number
  is_active: boolean
  allow_followup?: boolean
  retry_after_minutes?: number
  max_retries?: number
  /**
   * When this agent was created. Optional until the backend surfaces it
   * on `AgentResource`; consumers must fall back to last-task `updated_at`
   * when absent.
   */
  created_at?: string
  /**
   * Whether the operator has pinned this agent to the top of the dashboard.
   * Optional because the backend does not yet emit it; consumers must
   * tolerate undefined as `false`.
   */
  is_pinned?: boolean
  /**
   * Whether the agent has been archived (hidden from the default view).
   * Optional because the backend does not yet emit it; consumers must
   * tolerate undefined as `false`.
   */
  is_archived?: boolean
  /**
   * Whether the operator has favorited this agent for quick access on
   * the dashboard. Optional because the backend only started emitting
   * it with the favorites-flag PR; consumers must tolerate undefined
   * as `false`.
   */
  is_favorite?: boolean
  tools: AgentTool[]
  /**
   * Resolved profile picture (archetype avatar or uploaded image).
   * Optional because the backend may omit it under `?select=` projections;
   * consumers must fall back to the initial-letter Avatar when absent.
   */
  profile_picture?: AgentProfilePicture | null
}

export interface LLMConfigSettings {
  'core.openai.api_key'?: string
  'core.anthropic.api_key'?: string
  'core.openai.base_url'?: string
  'core.anthropic.base_url'?: string
}
