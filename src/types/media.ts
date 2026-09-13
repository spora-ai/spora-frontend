/**
 * Media asset shape returned by GET /api/v1/media and accepted by the
 * composer attachment chip list. Lives here (not in MediaPickerOverlay.vue)
 * so the composer draft utility can depend on it without a Vue SFC import.
 */
export interface MediaAsset {
  id: string
  filename: string | null
  media_type: string | null
  mime_type: string | null
  byte_size: number | null
  asset_url: string | null
  has_markdown: boolean
  /**
   * Backend flag controlling per-(user, agent) retention. Voice-message
   * uploads stage `is_temporary=true`; the cleaner job trims back to
   * `agents.voice_message_retention_count` per pair and the user-side
   * `/media/{id}/keep` endpoint promotes a row out of the GC set
   * (pre-PR mirror of the email-attachment keep-pin pattern). Optional
   * because the field is omitted by callers that never touched the
   * voice pipeline, so feature-gating here stays a non-breaking read.
   */
  is_temporary?: boolean
}
