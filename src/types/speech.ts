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
export interface SpeechCapabilityProvider {
  name: string
  display_name: string
  configured: boolean
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
