/**
 * Archetype iconography — 8 archetypes × 3 variants = 24 icons.
 *
 * Each archetype ships as an array of basic SVG primitives
 * (`path` / `circle` / `rect` / etc.) matching the shape used by
 * `Icon.vue`. The {@see renderArchetype} helper renders the primitives
 * inside an `<svg>` element via Vue's template syntax, so no `v-html`
 * is needed and SonarCloud's HTML-injection rules don't fire. All
 * primitives use `currentColor` for stroke / fill so the
 * server-resolved `fg_color` flows through a `color: <fg>` style
 * binding; the tile background is a separate `bg_color` div behind
 * the SVG.
 *
 * Adding a new archetype:
 *   1. Add the value to the Archetype enum on the backend.
 *   2. Add a `case` below with the three variants (`v0`, `v1`, `v2`).
 *   3. Update the in-picker labels (no migration — both repos ship in
 *      lockstep with the Composer release train).
 *
 * The viewBox is `0 0 24 24`. Stroke-width is `1.6`; shapes are inset
 * 2px from the edges so the silhouette does not touch the rounded
 * square. The icons are exposed as a single lookup function so
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

export type ArchetypeElement =
  | { tag: 'path'; d: string; fill?: string; stroke?: string; opacity?: number }
  | { tag: 'circle'; cx: string; cy: string; r: string; fill?: string; stroke?: string; opacity?: number }
  | { tag: 'rect'; x: string; y: string; width: string; height: string; rx?: string; fill?: string; stroke?: string }
  | { tag: 'line'; x1: string; y1: string; x2: string; y2: string; stroke?: string }
  | { tag: 'polyline'; points: string; fill?: string; stroke?: string }
  | { tag: 'polygon'; points: string; fill?: string; stroke?: string }

type ArchetypeMap = Record<ArchetypeKey, Record<VariantKey, ArchetypeElement[]>>

const stroke = 'currentColor'
const fill = 'currentColor'

const ARCHETYPES_MAP: ArchetypeMap = {
  assistant: {
    v0: [
      { tag: 'circle', cx: '12', cy: '8', r: '3.5', fill: 'none', stroke },
      { tag: 'path', d: 'M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5', fill: 'none', stroke },
    ],
    v1: [
      { tag: 'circle', cx: '12', cy: '12', r: '7', fill: 'none', stroke },
      { tag: 'circle', cx: '12', cy: '12', r: '3', fill },
    ],
    v2: [
      { tag: 'rect', x: '5', y: '5', width: '14', height: '14', rx: '2', fill: 'none', stroke },
      { tag: 'circle', cx: '9.5', cy: '10', r: '1.4', fill },
      { tag: 'circle', cx: '14.5', cy: '10', r: '1.4', fill },
      { tag: 'path', d: 'M9 14.5c1 .8 4 1 6 0', fill: 'none', stroke },
    ],
  },
  researcher: {
    v0: [
      { tag: 'circle', cx: '11', cy: '11', r: '5.5', fill: 'none', stroke },
      { tag: 'line', x1: '15', y1: '15', x2: '19', y2: '19', stroke },
    ],
    v1: [
      { tag: 'circle', cx: '12', cy: '12', r: '7', fill: 'none', stroke },
      { tag: 'circle', cx: '12', cy: '12', r: '3.5', fill: 'none', stroke },
      { tag: 'circle', cx: '12', cy: '12', r: '1.2', fill },
    ],
    v2: [
      { tag: 'circle', cx: '11', cy: '11', r: '5.5', fill: 'none', stroke },
      { tag: 'circle', cx: '11', cy: '11', r: '1.6', fill },
      { tag: 'line', x1: '15', y1: '15', x2: '19', y2: '19', stroke },
    ],
  },
  analyst: {
    v0: [
      { tag: 'rect', x: '4', y: '14', width: '3', height: '6', fill },
      { tag: 'rect', x: '10.5', y: '9', width: '3', height: '11', fill },
      { tag: 'rect', x: '17', y: '4', width: '3', height: '16', fill },
    ],
    v1: [
      { tag: 'polyline', points: '4,17 9,12 13,14 20,6', fill: 'none', stroke },
    ],
    v2: [
      { tag: 'circle', cx: '7', cy: '7', r: '3', fill },
      { tag: 'circle', cx: '17', cy: '7', r: '3', fill: 'none', stroke },
      { tag: 'circle', cx: '7', cy: '17', r: '3', fill: 'none', stroke },
      { tag: 'circle', cx: '17', cy: '17', r: '3', fill },
    ],
  },
  writer: {
    v0: [
      { tag: 'path', d: 'M5 19l3-1 11-11-2-2L6 16l-1 3z', fill: 'none', stroke },
      { tag: 'line', x1: '14', y1: '7', x2: '17', y2: '10', stroke },
    ],
    v1: [
      { tag: 'path', d: 'M5 5h10l4 4v10H5z', fill: 'none', stroke },
      { tag: 'line', x1: '8', y1: '12', x2: '16', y2: '12', stroke },
      { tag: 'line', x1: '8', y1: '15', x2: '14', y2: '15', stroke },
    ],
    v2: [
      { tag: 'path', d: 'M5 5h14M5 9h14M5 13h10M5 17h7', stroke },
    ],
  },
  coder: {
    v0: [
      { tag: 'polyline', points: '8,8 4,12 8,16', fill: 'none', stroke },
      { tag: 'polyline', points: '16,8 20,12 16,16', fill: 'none', stroke },
    ],
    v1: [
      { tag: 'polyline', points: '8,8 4,12 8,16', fill: 'none', stroke },
      { tag: 'polyline', points: '16,8 20,12 16,16', fill: 'none', stroke },
      { tag: 'line', x1: '14', y1: '6', x2: '10', y2: '18', stroke },
    ],
    v2: [
      { tag: 'rect', x: '3', y: '6', width: '18', height: '12', rx: '1.5', fill: 'none', stroke },
      { tag: 'polyline', points: '9,10 6,12 9,14', fill: 'none', stroke },
      { tag: 'polyline', points: '15,10 18,12 15,14', fill: 'none', stroke },
    ],
  },
  explorer: {
    v0: [
      { tag: 'circle', cx: '12', cy: '12', r: '8', fill: 'none', stroke },
      { tag: 'line', x1: '4', y1: '12', x2: '20', y2: '12', stroke },
      { tag: 'path', d: 'M12 4c2.5 3 2.5 13 0 16', fill: 'none', stroke },
      { tag: 'path', d: 'M12 4c-2.5 3-2.5 13 0 16', fill: 'none', stroke },
    ],
    v1: [
      { tag: 'polygon', points: '12,3 21,20 3,20', fill: 'none', stroke },
    ],
    v2: [
      { tag: 'circle', cx: '12', cy: '12', r: '8', fill: 'none', stroke },
      { tag: 'polygon', points: '12,6 14.2,12 12,18 9.8,12', fill },
    ],
  },
  advisor: {
    v0: [
      { tag: 'path', d: 'M9 18h6', stroke },
      { tag: 'path', d: 'M10 21h4', stroke },
      { tag: 'path', d: 'M12 3a6 6 0 0 1 4 10.5c-.7.7-1 1.5-1 2.5h-6c0-1-.3-1.8-1-2.5A6 6 0 0 1 12 3z', fill: 'none', stroke },
    ],
    v1: [
      { tag: 'path', d: 'M12 3l8 4v6c0 4-3 7-8 8-5-1-8-4-8-8V7z', fill: 'none', stroke },
      { tag: 'polyline', points: '9,12 11,14 15,10', fill: 'none', stroke },
    ],
    v2: [
      { tag: 'path', d: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-7l-4 3v-3H6a2 2 0 0 1-2-2V7z', fill: 'none', stroke },
      { tag: 'circle', cx: '8.5', cy: '10', r: '0.8', fill },
      { tag: 'circle', cx: '12', cy: '10', r: '0.8', fill },
      { tag: 'circle', cx: '15.5', cy: '10', r: '0.8', fill },
    ],
  },
  creative: {
    v0: [
      { tag: 'path', d: 'M12 4l2.5 5.5L20 10l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z', fill: 'none', stroke },
    ],
    v1: [
      { tag: 'circle', cx: '8', cy: '9', r: '3', fill },
      { tag: 'circle', cx: '16', cy: '9', r: '3', fill, opacity: 0.7 },
      { tag: 'circle', cx: '6', cy: '16', r: '2.5', fill, opacity: 0.5 },
      { tag: 'circle', cx: '18', cy: '16', r: '2.5', fill, opacity: 0.85 },
      { tag: 'circle', cx: '12', cy: '14', r: '2', fill },
    ],
    v2: [
      { tag: 'rect', x: '3', y: '6', width: '18', height: '12', rx: '2', fill: 'none', stroke },
      { tag: 'circle', cx: '8', cy: '11', r: '1.4', fill },
      { tag: 'path', d: 'M5 16l3-3 3 3 3-3', fill: 'none', stroke },
      { tag: 'path', d: 'M14 9l6 3-6 3z', fill },
    ],
  },
}

/**
 * Look up the icon elements for a given archetype + variant. Unknown
 * values fall back to `assistant / v0` so the operator never sees a
 * blank tile (e.g. on a stale enum shipped before this release).
 */
export function archetypeElements(archetype: string, variant: string): ArchetypeElement[] {
  const archetypeKey = (ARCHETYPES as readonly string[]).includes(archetype)
    ? (archetype as ArchetypeKey)
    : 'assistant'
  const variantKey = (VARIANTS as readonly string[]).includes(variant)
    ? (variant as VariantKey)
    : 'v0'
  return ARCHETYPES_MAP[archetypeKey][variantKey]
}

/** Public lookup for the picker (test seam). */
export const archetypeSvgMap: ArchetypeMap = ARCHETYPES_MAP
