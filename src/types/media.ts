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
}
