/**
 * useAgentSettingsForm — pure helpers for AgentSettingsPage.
 *
 * Owns the identity/LLM form initialization, payload building, and label
 * formatting. Tool-category grouping lives in `@/utils/toolCategories` since
 * it's a pure utility shared with other features.
 */

/** Identity fields editable from AgentSettingsPage → PATCH /agents/{id}. */
export interface IdentityForm {
  name: string
  description: string
  system_prompt: string
  notes: string
  max_steps: number
  allow_followup: boolean
  retry_after_minutes: number
  max_retries: number
  /**
   * Per-(user, agent) cap on temporary media rows (voice-message audio and
   * other GC-eligible uploads flagged via `is_temporary`). The backend trims
   * rows above this count when a new temporary upload lands and when the
   * cleanup job runs; `0` disables the cap and lets the operator manage
   * retention manually via `/media/{id}/keep`. Lives on
   * `agents.voice_message_retention_count` (migration 0081). Range 0–100,
   * default 5 — picked to bound the disk usage for casual voice users while
   * keeping a meaningful recent-history window for re-listening.
   */
  voice_message_retention_count: number
  /**
   * The reasoning-effort level the agent runs at when a message names
   * none. `null` inherits the effective configuration's default.
   */
  default_effort: string | null
}

/** LLM selection — single foreign key into llm_driver_configs. */
export interface LlmSettingsForm {
  llm_driver_config_id: number | null
}

/** Format the human label for an LLM config row in the dropdown. */
export function formatLlmConfigLabel(config: {
  name: string
  driver_display_name: string
  is_global: boolean
}): string {
  return config.is_global
    ? `${config.name} (${config.driver_display_name}) — Global`
    : `${config.name} (${config.driver_display_name})`
}

/**
 * The step cap within the instance's ceiling.
 *
 * The ceiling (`SPORA_MAX_STEPS`) is the largest cap the installation
 * allows, so a stored cap above it is lowered to it rather than refused:
 * the instance accepts no other value, and refusing the whole PATCH would
 * block every other field's edit. A cap below one is raised to one, which
 * is the other end of the same range.
 *
 * An absent ceiling leaves the value alone: an older backend does not
 * publish one, and the value it stored is the value it accepts.
 */
export function clampMaxSteps(value: number, maxSteps?: number): number {
  if (maxSteps === undefined || maxSteps <= 0) {
    return value
  }
  return Math.min(Math.max(value, 1), maxSteps)
}

/** Build the identity form's initial values from a backend Agent resource. */
export function buildInitialIdentityForm(
  agent: {
    name: string
    description?: string | null
    system_prompt?: string | null
    notes?: string | null
    max_steps?: number | null
    allow_followup?: boolean | null
    retry_after_minutes?: number | null
    max_retries?: number | null
    voice_message_retention_count?: number | null
    default_effort?: string | null
  },
  maxSteps?: number,
): IdentityForm {
  return {
    name: agent.name,
    description: agent.description ?? '',
    system_prompt: agent.system_prompt ?? '',
    notes: agent.notes ?? '',
    max_steps: clampMaxSteps(agent.max_steps ?? 10, maxSteps),
    allow_followup: agent.allow_followup !== false,
    retry_after_minutes: agent.retry_after_minutes ?? 0,
    max_retries: agent.max_retries ?? 0,
    voice_message_retention_count: agent.voice_message_retention_count ?? 5,
    default_effort: agent.default_effort ?? null,
  }
}

/** Build the LLM settings form's initial values. */
export function buildInitialLlmSettings(agent: {
  llm_driver_config_id?: number | null
}): LlmSettingsForm {
  return {
    llm_driver_config_id: agent.llm_driver_config_id ?? null,
  }
}

/**
 * Convert the identity form into a PATCH /agents/{id} payload.
 *
 * The cap is bounded by the instance's ceiling here, where the value
 * becomes a request. The browser's `max` attribute does not clamp it — it
 * only fails native form validation, and these sections save on a click
 * rather than on a submit — so without this the cap the operator typed
 * would travel to the server and the server would refuse the whole PATCH.
 */
export function buildIdentityPayload(
  form: IdentityForm,
  maxSteps?: number,
): {
  name: string
  description: string | null
  system_prompt: string | null
  notes: string | null
  max_steps: number
  allow_followup: boolean
  retry_after_minutes: number
  max_retries: number
  voice_message_retention_count: number
  default_effort: string | null
} {
  return {
    name: form.name,
    description: form.description || null,
    system_prompt: form.system_prompt || null,
    notes: form.notes || null,
    max_steps: clampMaxSteps(form.max_steps, maxSteps),
    allow_followup: form.allow_followup,
    retry_after_minutes: form.retry_after_minutes,
    max_retries: form.max_retries,
    voice_message_retention_count: form.voice_message_retention_count,
    default_effort: form.default_effort,
  }
}

/** Convert the LLM settings form into a PATCH /agents/{id} payload. */
export function buildLlmSettingsPayload(form: LlmSettingsForm): { llm_driver_config_id: number | null } {
  return {
    llm_driver_config_id: form.llm_driver_config_id,
  }
}
