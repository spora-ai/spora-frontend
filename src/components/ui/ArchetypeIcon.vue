<script setup lang="ts">
/**
 * ArchetypeIcon — renders an archetype + variant as native SVG primitives
 * (no `v-html`).
 *
 * Mirrors the render pattern from `Icon.vue`: each shape is a typed
 * `ArchetypeElement` (path / circle / rect / line / polyline / polygon)
 * and we render the right Vue element for each tag with a `v-if` chain.
 * That keeps the SVG content as Vue-managed DOM nodes (no innerHTML,
 * no SonarCloud S6819/S6853 flags) while still letting the
 * `archetypeSvgs.ts` registry stay a single source of truth.
 *
 * `currentColor` on every primitive's `stroke` / `fill` is what makes
 * the icon pick up the surrounding `color: <fg>` style — the wrapper
 * tile (in the picker / Avatar) is responsible for setting that color.
 */
import { computed } from 'vue'
import { archetypeElements, type ArchetypeKey, type VariantKey } from '@/lib/archetypeSvgs'

const props = withDefaults(defineProps<{
  archetype: ArchetypeKey | string
  variant: VariantKey | string
  /** Optional `class` passthrough for sizing / positioning the wrapping <svg>. */
  svgClass?: string
  /** Optional inline style passthrough for the wrapping <svg>. */
  svgStyle?: string
}>(), {
  svgClass: '',
  svgStyle: '',
})

const elements = computed(() => archetypeElements(props.archetype, props.variant))
</script>

<template>
  <svg
    class="h-2/3 w-2/3"
    :class="svgClass"
    :style="svgStyle"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-for="(el, i) in elements" :key="`${el.tag}-${i}`">
      <path
        v-if="el.tag === 'path'"
        :d="el.d"
        :fill="el.fill ?? 'none'"
        :stroke="el.stroke ?? 'currentColor'"
        :opacity="el.opacity"
      />
      <circle
        v-else-if="el.tag === 'circle'"
        :cx="el.cx"
        :cy="el.cy"
        :r="el.r"
        :fill="el.fill ?? 'none'"
        :stroke="el.stroke ?? 'currentColor'"
        :opacity="el.opacity"
      />
      <rect
        v-else-if="el.tag === 'rect'"
        :x="el.x"
        :y="el.y"
        :width="el.width"
        :height="el.height"
        :rx="el.rx"
        :fill="el.fill ?? 'none'"
        :stroke="el.stroke ?? 'currentColor'"
      />
      <line
        v-else-if="el.tag === 'line'"
        :x1="el.x1"
        :y1="el.y1"
        :x2="el.x2"
        :y2="el.y2"
        :stroke="el.stroke ?? 'currentColor'"
      />
      <polyline
        v-else-if="el.tag === 'polyline'"
        :points="el.points"
        :fill="el.fill ?? 'none'"
        :stroke="el.stroke ?? 'currentColor'"
      />
      <polygon
        v-else-if="el.tag === 'polygon'"
        :points="el.points"
        :fill="el.fill ?? 'none'"
        :stroke="el.stroke ?? 'currentColor'"
      />
    </template>
  </svg>
</template>
