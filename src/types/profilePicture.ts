/**
 * ProfilePicture — cross-subject wire shape for the avatar / image
 * picture pipeline (agents and groups).
 *
 * Mirrors `Spora\Services\ProfilePictures\ProfilePictureService::toWireShape()` —
 * the server resolves the concrete `fg_color` / `bg_color` from the
 * stored `palette_key` so the frontend never has to know the palette
 * map.
 *
 * The picture is either an operator-picked archetype avatar
 * (`kind === 'avatar'`, with concrete `fg_color` / `bg_color` resolved
 * server-side) or an uploaded image (`kind === 'image'`, with
 * `image_url` pointing at the Media Archive asset). All other fields
 * are null in the inactive branch.
 *
 * The agent and group pipelines share this shape; subject-specific
 * type aliases (`AgentProfilePicture` in `types/agent.ts`) exist for
 * the `profile_picture: AgentProfilePicture` property on Agent so the
 * call sites stay typed without consumers importing this file.
 */
export interface ProfilePicture {
  kind: 'avatar' | 'image'
  /**
   * One of the 12 `Archetype` enum values when kind='avatar'
   * (8 agent archetypes + 4 group archetypes); null when kind='image'.
   */
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
