/**
 * Palette preview colours — mirrors `Spora\Services\AgentPictures\Palette`
 * on the backend so the in-picker swatch matches the server-resolved
 * avatar tile exactly. The fg/bg hex pairs are resolved server-side on
 * every AgentResource read; this map is the source of truth for the
 * pre-API preview rendered inside `AgentProfilePictureSection`.
 *
 * Keeping the map in lockstep with the backend is a release-train
 * concern: any new palette must be added to both repos before tagging.
 * A lint check (`scripts/check-palette-parity.ts` in CI) fails the
 * frontend build when the two lists drift.
 */

export type PaletteKey =
  | 'slate'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink'

export interface PaletteSwatch {
  readonly key: PaletteKey
  readonly label: string
  readonly background: string
  readonly foreground: string
}

export const PALETTES: readonly PaletteSwatch[] = [
  { key: 'slate',  label: 'Slate',  background: '#475569', foreground: '#F8FAFC' },
  { key: 'red',    label: 'Red',    background: '#DC2626', foreground: '#FEF2F2' },
  { key: 'orange', label: 'Orange', background: '#EA580C', foreground: '#FFF7ED' },
  { key: 'amber',  label: 'Amber',  background: '#D97706', foreground: '#FFFBEB' },
  { key: 'green',  label: 'Green',  background: '#15803D', foreground: '#F0FDF4' },
  { key: 'teal',   label: 'Teal',   background: '#0F766E', foreground: '#F0FDFA' },
  { key: 'blue',   label: 'Blue',   background: '#1D4ED8', foreground: '#EFF6FF' },
  { key: 'indigo', label: 'Indigo', background: '#4338CA', foreground: '#EEF2FF' },
  { key: 'violet', label: 'Violet', background: '#6D28D9', foreground: '#F5F3FF' },
  { key: 'pink',   label: 'Pink',   background: '#BE185D', foreground: '#FDF2F8' },
] as const

const PALETTE_MAP: ReadonlyMap<PaletteKey, PaletteSwatch> = new Map(
  PALETTES.map((p) => [p.key, p]),
)

export function paletteFor(key: string): PaletteSwatch {
  const match = PALETTE_MAP.get(key as PaletteKey)
  return match ?? PALETTE_MAP.get('slate')!
}