/**
 * Wire shapes for the speech-to-text pipeline:
 *
 *   GET  /api/v1/speech/capability
 *     → {@link SpeechCapability}
 *
 *   POST /api/v1/speech/transcribe  body: { media_id, language? }
 *     → {@link TranscriptionResultDto}
 *
 * `api.get<T>` and `api.post<T>` strip the `{ data: ... }` envelope from
 * successful responses (see `api/client.ts#request`), so the typed return
 * is the inner payload directly — never the `{ data: ... }` wrapper.
 * The capability response is read once on composer mount and cached for
 * the SPA session via `useSpeechCapability` — see that composable for the
 * invalidation strategy. The transcribe response is one-shot and never
 * cached client-side (the server persists it on the MediaAsset row).
 */

/**
 * Source tier from the backend's five-tier cascade
 * (`SpeechToTextRegistry::resolveEffectiveClassWithSource`):
 *
 *   - `agent_override`    → per-agent override row exists
 *   - `user_preference`   → `principal_preferences.preferred_speech_provider_class`
 *   - `group_preference`  → same column on a group principal the user belongs to
 *   - `global_default`    → `tool_configurations.is_default = true`
 *   - `fallback`          → nothing matched, `effective_class` is null
 */
export type SpeechProviderSource =
  | 'agent_override'
  | 'user_preference'
  | 'group_preference'
  | 'global_default'
  | 'fallback'
  | null

export interface SpeechCapabilityProvider {
  name: string
  display_name: string
  configured: boolean
  /**
   * Resolved provider class for the calling principal (string FQCN), or
   * null when no provider is configured. Same on every row of the
   * `providers[]` array — the registry surfaces the resolved class
   * alongside each provider description so the SPA can render
   * "Currently using: X" with the actual class, not a guessed one.
   */
  effective_class: string | null
  /**
   * Which tier of the cascade supplied `effective_class`. See
   * {@link SpeechProviderSource}. Null when no resolution happened.
   */
  effective_source: SpeechProviderSource
}

export interface SpeechCapability {
  available: boolean
  configured: boolean
  providers: SpeechCapabilityProvider[]
}

export interface TranscriptionResultDto {
  text: string
  language: string | null
  duration_ms: number | null
}

/** Body for `POST /api/v1/speech/transcribe`. */
export interface TranscribeRequestBody {
  media_id: string
  language?: string
}
