<script setup lang="ts">
/**
 * SettingsSectionNav — in-page jump links for the agent settings sections.
 *
 * The settings page is a single scrolling column of cards, so without this
 * there is no way to reach the last one without scrolling the whole page.
 * A wrapping pill bar beats a second sidebar here: the page already has
 * AgentLayout's own navigation, and a second column would fight it on
 * narrower screens.
 *
 * The pills wrap rather than scroll sideways. With eight sections they do not
 * fit beside a sidebar on a laptop, and a horizontally scrolling nav hides
 * the overflow behind a scrollbar nobody thinks to look for — which is how
 * "Danger Zone" and "API keys" ended up invisible at 820px.
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

/**
 * Suppresses the observer briefly after a programmatic scroll.
 *
 * Scrolling to a section passes every one in between, and the observer fires
 * for all of them, so the last one it saw would win and leave the wrong pill
 * lit. This is a UI-only lock; it does not stop the scroll itself.
 */
let activeLockedUntil = 0

let observer: IntersectionObserver | null = null

/**
 * The element that actually scrolls on this page.
 *
 * The settings page lives inside AgentLayout's inner `overflow-y: auto`
 * surface; the window does not scroll. `window.scrollTo` therefore drags the
 * whole `h-screen` shell up and past the viewport, leaving a page of white
 * space below it — which is what every hash link used to do.
 */
function scrollContainer(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement

  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY

    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node
    }

    node = node.parentElement
  }

  return null
}

/**
 * Scrolls the section into view. Returns false when it is not rendered yet.
 *
 * `instant` is for arriving at a deep link, where the reader asked to be
 * somewhere and an animation only delays it. A pill click animates, because
 * there the movement is the point.
 */
function scrollToSection(id: string, instant = false): boolean {
  const target = document.getElementById(id)

  if (!target) return false

  const container = scrollContainer(target)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = instant || reduceMotion ? 'auto' : 'smooth'

  // Measured as a delta rather than an absolute position, because the
  // container may already be scrolled.
  const origin = container ?? document.documentElement
  const delta = target.getBoundingClientRect().top - origin.getBoundingClientRect().top - OFFSET.value

  if (container) {
    container.scrollTo({ top: container.scrollTop + delta, behavior })
  } else {
    window.scrollTo({ top: window.scrollY + delta, behavior })
  }

  // Stops the bar flickering through every section on the way down; the
  // observer would otherwise settle on whatever it last saw pass by.
  active.value = id
  activeLockedUntil = performance.now() + 800

  return true
}

function scrollTo(id: string): void {
  if (!scrollToSection(id)) return

  // `replaceState` rather than assigning `location.hash`: it keeps the
  // section shareable without the browser performing its own fragment
  // scroll, which would move the shell.
  history.replaceState(null, '', `#${id}`)
}

/**
 * Handles a hash that arrived from a link or the address bar while the page
 * was already mounted.
 *
 * The browser's own fragment navigation scrolls the nearest scrollport, and
 * on this layout the document is one — so without this the shell jumps and
 * the page below it goes white. The hash is then cleared, because leaving it
 * in place means the next re-render can trigger the same jump.
 */
function onHashChange(): void {
  const id = window.location.hash.slice(1)

  if (!props.sections.some((section) => section.id === id)) return

  scrollToSection(id, true)
  resetDocumentScroll()
  clearHash()
}

/**
 * Puts the document back at the top if anything moved it.
 *
 * Navigating to a fragment makes the browser scroll the nearest scrollport,
 * and here that is the document rather than the settings column — so the
 * `h-screen` shell slides up and the page below it shows through. The layout
 * does not scroll at all, so any window scroll is spurious.
 */
function resetDocumentScroll(): void {
  if (window.scrollY !== 0) window.scrollTo(0, 0)
}

/**
 * The section is usually not rendered yet on first load — the page shows a
 * loading state until the agent arrives — so watch for it rather than
 * guessing a delay and measuring a layout that is about to change.
 */
function scrollToHashWhenReady(): void {
  const id = window.location.hash.slice(1)

  if (!id || !props.sections.some((section) => section.id === id)) return

  const attempt = (): boolean => {
    // Measured a frame later: the section exists but the sticky nav has not
    // settled into its scrolled position, so a rect read now is off by
    // exactly the nav's height.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!scrollToSection(id, true)) return

        resetDocumentScroll()
        clearHash()
        observer?.disconnect()
      }),
    )

    return true
  }

  if (document.getElementById(id)) {
    attempt()

    return
  }

  const watcher = new MutationObserver(() => {
    if (!document.getElementById(id)) return

    watcher.disconnect()
    attempt()
  })

  watcher.observe(document.body, { childList: true, subtree: true })

  // A hash that never appears must not leave an observer running for the life
  // of the page.
  setTimeout(() => watcher.disconnect(), 10000)
}

function clearHash(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search)
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

      if (visible[0] && performance.now() > activeLockedUntil) {
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
  // A deep link like /agents/7/settings#api-keys lands on that section
  // rather than the top, and the nav reflects it.
  scrollToHashWhenReady()
  window.addEventListener('hashchange', onHashChange)
  observe()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('hashchange', onHashChange)
})

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
    <ul class="flex flex-wrap gap-2">
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