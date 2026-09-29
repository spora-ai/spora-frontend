/**
 * Re-export of the package-owned `ProfilePicture` wire shape, mirroring
 * `ProfilePictureService::toWireShape()`. The server resolves the
 * concrete `fg_color` / `bg_color` from `palette_key`, so the frontend
 * never needs the palette map. Adding a field is a backend + package +
 * frontend change — edit the package, not this file.
 */
export type { ProfilePicture } from '@spora-ai/components/types'
