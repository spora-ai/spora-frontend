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
   * Per-(user, agent) cap on temporary media rows (voice-message audio
   * and other GC-eligible uploads flagged via `is_temporary`). Backend
   * trims rows above this count when a new temporary upload lands and
   * when the cleanup job runs; `0` disables the cap and lets the
   * operator manage retention manually via `/media/{id}/keep`. Lives
   * on `agents.voice_message_retention_count` (Laravel migration
   * `add_voice_message_retention_to_agents`). Range 0–100, default 5 —
   * picked to bound the disk usage for casual voice users while
   * keeping a meaningful recent-history window for re-listening.
   */
  voice_message_retention_count: number
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

/** Build the identity form's initial values from a backend Agent resource. */
export function buildInitialIdentityForm(agent: {
  name: string
  description?: string | null
  system_prompt?: string | null
  notes?: string | null
  max_steps?: number | null
  allow_followup?: boolean | null
  retry_after_minutes?: number | null
  max_retries?: number | null
  voice_message_retention_count?: number | null
}): IdentityForm {
  return {
    name: agent.name,
    description: agent.description ?? '',
    system_prompt: agent.system_prompt ?? '',
    notes: agent.notes ?? '',
    max_steps: agent.max_steps ?? 10,
    allow_followup: agent.allow_followup !== false,
    retry_after_minutes: agent.retry_after_minutes ?? 0,
    max_retries: agent.max_retries ?? 0,
    voice_message_retention_count: agent.voice_message_retention_count ?? 5,
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

/** Convert the identity form into a PATCH /agents/{id} payload. */
export function buildIdentityPayload(form: IdentityForm): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description || null,
    system_prompt: form.system_prompt || null,
    notes: form.notes || null,
    max_steps: form.max_steps,
    allow_followup: form.allow_followup,
    retry_after_minutes: form.retry_after_minutes,
    max_retries: form.max_retries,
    voice_message_retention_count: form.voice_message_retention_count,
  }
}

/** Convert the LLM settings form into a PATCH /agents/{id} payload. */
export function buildLlmSettingsPayload(form: LlmSettingsForm): Record<string, unknown> {
  return {
    llm_driver_config_id: form.llm_driver_config_id,
  }
}
