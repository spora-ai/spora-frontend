/**
 * Archetype iconography — 8 archetypes × 3 variants = 24 inline SVGs.
 *
 * Each SVG renders a single shape composed of basic primitives
 * (circle, rect, path, polygon). They are designed to read as
 * silhouettes — the operator picks them as visual identifiers, not as
 * illustrations. All shapes use `currentColor` for their stroke/fill so
 * the `<Avatar>` component can apply the server-resolved `fg_color` via
 * a `color: <fg>` style binding; the tile background is a separate
 * `bg_color` div behind the SVG.
 *
 * Adding a new archetype:
 *   1. Add the value to the Archetype enum on the backend.
 *   2. Add a `case` below with the three SVGs (`v0`, `v1`, `v2`).
 *   3. Update the in-picker labels (no migration — both repos ship in
 *      lockstep with the Composer release train).
 *
 * The viewBox is `0 0 24 24` and stroke-width defaults to 1.6; shapes
 * are inset 2px from the edges so the silhouette does not touch the
 * rounded square. The SVGs are exposed as a single lookup function so
 * callers do not have to import the map directly.
 */

export type ArchetypeKey =
  | 'assistant'
  | 'researcher'
  | 'analyst'
  | 'writer'
  | 'coder'
  | 'explorer'
  | 'advisor'
  | 'creative'

export type VariantKey = 'v0' | 'v1' | 'v2'

/** Ordered list of all archetypes — used by the picker. */
export const ARCHETYPES: readonly ArchetypeKey[] = [
  'assistant',
  'researcher',
  'analyst',
  'writer',
  'coder',
  'explorer',
  'advisor',
  'creative',
] as const

/** Ordered list of all variants — used by the variant cycler. */
export const VARIANTS: readonly VariantKey[] = ['v0', 'v1', 'v2'] as const

type SvgMap = Record<ArchetypeKey, Record<VariantKey, string>>

const SVGS: SvgMap = {
  assistant: {
    v0: '<circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    v1: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    v2: '<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.5" cy="10" r="1.4" fill="currentColor"/><circle cx="14.5" cy="10" r="1.4" fill="currentColor"/><path d="M9 14.5c1 .8 4 1 6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  researcher: {
    v0: '<circle cx="11" cy="11" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="15" y1="15" x2="19" y2="19" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    v1: '<circle cx="11" cy="11" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="8" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    v2: '<circle cx="11" cy="11" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="11" cy="11" r="1.6" fill="currentColor"/><line x1="15" y1="15" x2="19" y2="19" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  analyst: {
    v0: '<rect x="4" y="14" width="3" height="6" fill="currentColor"/><rect x="10.5" y="9" width="3" height="11" fill="currentColor"/><rect x="17" y="4" width="3" height="16" fill="currentColor"/>',
    v1: '<polyline points="4,17 9,12 13,14 20,6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    v2: '<circle cx="7" cy="7" r="3" fill="currentColor"/><circle cx="17" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="17" r="3" fill="currentColor"/>',
  },
  writer: {
    v0: '<path d="M5 19l3-1 11-11-2-2L6 16l-1 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="14" y1="7" x2="17" y2="10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    v1: '<path d="M5 5h10l4 4v10H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="8" y1="15" x2="14" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    v2: '<path d="M5 5h14M5 9h14M5 13h10M5 17h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  coder: {
    v0: '<polyline points="8,8 4,12 8,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><polyline points="16,8 20,12 16,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    v1: '<polyline points="8,8 4,12 8,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><polyline points="16,8 20,12 16,16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="6" x2="10" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    v2: '<rect x="3" y="6" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><polyline points="9,10 6,12 9,14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><polyline points="15,10 18,12 15,14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  explorer: {
    v0: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12h16M12 4c2.5 3 2.5 13 0 16M12 4c-2.5 3-2.5 13 0 16" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    v1: '<polygon points="12,3 21,20 3,20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    v2: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 9l3 2-2 3 4 1 2 4 2-4 4-1-2-3 3-2-3-2 2-3-4-1-2-4-2 4-4 1 2 3z" fill="currentColor" opacity="0.85"/>',
  },
  advisor: {
    v0: '<path d="M12 4a6 6 0 016 6c0 4-3 6-6 6s-6-2-6-6a6 6 0 016-6z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 19c1 1 5 1 6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 9h4M10 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    v1: '<path d="M12 3l8 4v6c0 4-3 7-8 8-5-1-8-4-8-8V7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><polyline points="9,12 11,14 15,10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    v2: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="16" text-anchor="middle" font-family="ui-serif,Georgia,serif" font-size="11" font-weight="600" fill="currentColor">?</text>',
  },
  creative: {
    v0: '<path d="M12 4l2.5 5.5L20 10l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    v1: '<circle cx="8" cy="9" r="3" fill="currentColor"/><circle cx="16" cy="9" r="3" fill="currentColor" opacity="0.7"/><circle cx="6" cy="16" r="2.5" fill="currentColor" opacity="0.5"/><circle cx="18" cy="16" r="2.5" fill="currentColor" opacity="0.85"/><circle cx="12" cy="14" r="2" fill="currentColor"/>',
    v2: '<path d="M6 18l3-9 3 6 3-9 3 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>',
  },
}

/**
 * Return the raw `<svg>` inner markup for a given archetype + variant.
 * The caller is responsible for wrapping it in a `<svg viewBox="0 0 24 24">`
 * with the desired color/size — this is what `Avatar.vue` does.
 */
export function archetypeSvg(archetype: string, variant: string): string {
  const archetypeKey = (ARCHETYPES as readonly string[]).includes(archetype)
    ? (archetype as ArchetypeKey)
    : 'assistant'
  const variantKey = (VARIANTS as readonly string[]).includes(variant)
    ? (variant as VariantKey)
    : 'v0'
  return SVGS[archetypeKey][variantKey]
}

/** Public lookup for the picker (test seam). */
export const archetypeSvgMap: SvgMap = SVGS
