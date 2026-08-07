export interface AgentTool {
  tool_class: string
  tool_name: string
  /** Resolved icon key (3-layer chain applied server-side: tool.icon → plugin.icon → 'puzzle').
   *  Optional; null falls back to 'puzzle' via the <Icon> component's own fallback. */
  icon?: string | null
}

/**
 * Agent profile picture wire shape — single source of truth for the
 * `Agent.profile_picture` JSON contract emitted by
 * `Spora\Services\AgentPictures\AgentPictureService::toWireShape()`.
 *
 * The picture is either an operator-picked archetype avatar
 * (`kind === 'avatar'`, with concrete `fg_color` / `bg_color` resolved
 * server-side) or an uploaded image (`kind === 'image'`, with `image_url`
 * pointing at the Media Archive asset). All other fields are null in
 * the inactive branch.
 */
export interface AgentProfilePicture {
  kind: 'avatar' | 'image'
  /** One of the 8 `Archetype` enum values when kind='avatar'; null when kind='image'. */
  archetype: string | null
  /** 'v0' | 'v1' | 'v2' when kind='avatar'; null when kind='image'. */
  variant_key: string | null
  /** One of the 10 `Palette` enum values when kind='avatar'; null when kind='image'. */
  palette_key: string | null
  /** Hex (#rrggbb) for the icon stroke / fill when kind='avatar'; null when kind='image'. */
  fg_color: string | null
  /** Hex (#rrggbb) for the tile background when kind='avatar'; null when kind='image'. */
  bg_color: string | null
  /** Resolved media-archive asset URL when kind='image'; null when kind='avatar'. */
  image_url: string | null
  /** ISO 8601 timestamp of the underlying `media_assets.updated_at` (cache buster) when kind='image'. */
  image_updated_at: string | null
}

export interface Agent {
  id: number
  name: string
  description: string | null
  system_prompt: string | null
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
