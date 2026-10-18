<script setup lang="ts">
/**
 * SettingsSectionNav — in-page jump links for the agent settings sections.
 *
 * The settings page is a single scrolling column of cards, so without this
 * there is no way to reach the last one without scrolling the whole page.
 * A horizontal pill bar beats a second sidebar here: the page already has
 * AgentLayout's own navigation, and a second column would fight it on
 * narrower screens.
 *
 * The active pill is tracked with an IntersectionObserver rather than a
 * scroll listener, so it costs nothing while the page is idle and does not
 * need throttling.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface SettingsSectionLink {
  /** Fragment id, matching the `id` on the section component's root. */
  id: string
  /** Pill label. */
  label: string
}

const props = defineProps<{
  sections: SettingsSectionLink[]
  /** Height of the sticky header, so a jump does not land under it. */
  offset?: number
}>()

const OFFSET = computed(() => props.offset ?? 96)

const active = ref<string>(props.sections[0]?.id ?? '')

let observer: IntersectionObserver | null = null

function scrollTo(id: string): void {
  const target = document.getElementById(id)
  if (!target) return

  const top = target.getBoundingClientRect().top + window.scrollY - OFFSET.value
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' })

  // The observer will settle on the right pill shortly, but setting it now
  // stops the bar flickering through every section on the way down.
  active.value = id
  history.replaceState(null, '', `#${id}`)
}

function observe(): void {
  observer?.disconnect()
  observer = null

  // Not supported (jsdom, older browsers): the pills still navigate, they
  // just do not highlight. Not worth a polyfill for a highlight.
  if (typeof IntersectionObserver === 'undefined') return

  observer = new IntersectionObserver(
    (entries) => {
      // `isIntersecting` with the top margin keeps the pill for a section
      // active while it occupies the upper part of the viewport.
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

      if (visible[0]) {
        active.value = visible[0].target.id
      }
    },
    {
      // A band just below the sticky header: a section counts as current
      // once its top edge crosses it.
      rootMargin: `-${OFFSET.value}px 0px -70% 0px`,
      threshold: 0,
    },
  )

  for (const section of props.sections) {
    const element = document.getElementById(section.id)
    if (element) observer.observe(element)
  }
}

onMounted(() => {
  // A deep link like /agents/7/settings#api-keys should land on that
  // section rather than the top, and the nav must reflect it.
  const fromHash = window.location.hash.replace('#', '')
  if (fromHash && props.sections.some((section) => section.id === fromHash)) {
    requestAnimationFrame(() => scrollTo(fromHash))
  }

  observe()
})

onBeforeUnmount(() => observer?.disconnect())

// The API keys section is conditional, so the list can change length after
// mount; the observer holds element references and would be stale.
watch(
  () => props.sections.map((section) => section.id).join(','),
  () => {
    if (!active.value) active.value = props.sections[0]?.id ?? ''
    observe()
  },
)
</script>

<template>
  <nav
    aria-label="Settings sections"
    class="sticky top-0 z-10 -mx-6 bg-background/95 px-6 py-3 backdrop-blur"
  >
    <ul class="flex gap-2 overflow-x-auto pb-1">
      <li
        v-for="section in sections"
        :key="section.id"
      >
        <a
          :href="`#${section.id}`"
          :aria-current="active === section.id ? 'true' : undefined"
          class="block whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors"
          :class="
            active === section.id
              ? 'border-primary bg-primary/10 font-medium text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted'
          "
          @click.prevent="scrollTo(section.id)"
        >
          {{ section.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>