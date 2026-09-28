/**
 * ProfilePicture — cross-subject wire shape for the avatar / image
 * picture pipeline (agents and groups).
 *
 * The shape itself is owned by `@spora-ai/components` so every Spora
 * frontend reads the same contract; this module stays as the local
 * import site so the ~12 call sites keep resolving through `@/` and the
 * backend-mirroring rationale below has a home. The agent and group
 * pipelines share this shape; subject-specific type aliases
 * (`AgentProfilePicture` in `types/agent.ts`) exist for the
 * `profile_picture: AgentProfilePicture` property on Agent so the call
 * sites stay typed without consumers importing this file.
 *
 * Upstream mirrors `Spora\Services\ProfilePictures\ProfilePictureService::toWireShape()`
 * — the server resolves the concrete `fg_color` / `bg_color` from the
 * stored `palette_key` so the frontend never has to know the palette
 * map. Adding a field there is a backend + package + frontend change;
 * edit the package, not this file.
 */
export type { ProfilePicture } from '@spora-ai/components/types'
