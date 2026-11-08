/**
 * The embed descriptor for a script-capable asset.
 *
 * Present only when the operator has permitted the format. The server
 * decides whether it exists and whether the embedded scripts may run; the
 * client mirrors that decision in the frame's `sandbox` attribute, and the
 * response's CSP header is the ceiling the browser enforces.
 */
export interface MediaEmbedDescriptor {
  /** The embed route serving the asset's bytes. */
  url: string
  /** The asset's MIME type. */
  mime: string
  /** Whether the operator permitted the embedded scripts to run. */
  scripts: boolean
}

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
  /**
   * The embed descriptor for a script-capable asset the operator has
   * permitted, or null. Absent on an install that permits nothing.
   */
  embed_descriptor?: MediaEmbedDescriptor | null
  /**
   * Backend flag controlling per-(user, agent) retention. Voice-message
   * uploads stage `is_temporary=true`; the cleaner job trims back to
   * `agents.voice_message_retention_count` per pair and the user-side
   * `/media/{id}/keep` endpoint promotes a row out of the GC set. Optional
   * because the field is omitted by callers that never touched the voice
   * pipeline, so feature-gating here stays a non-breaking read.
   */
  is_temporary?: boolean
}
