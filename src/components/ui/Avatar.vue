<script setup lang="ts">
/**
 * Avatar — renders an agent's profile picture (archetype avatar or
 * uploaded image) with a fallback to initial letters.
 *
 * Resolution order:
 *   1. `profilePicture.kind === 'image'`  → `<img>` from `image_url`
 *   2. `profilePicture.kind === 'avatar'` → inline SVG with `fg_color`
 *                                            on a `bg_color` tile
 *   3. otherwise                          → uppercase initial letters
 *                                            (the `initials` prop)
 *
 * `tone="muted"` (default) reads as a quiet identifier beside prose;
 * `tone="primary"` flips the background to the page foreground and
 * inverts the text — use for inline-with-a-heading callouts. The
 * `tone` prop is only consulted in the initials-fallback branch
 * because the avatar and image branches have their own background.
 */
import { computed } from 'vue'
import type { AgentProfilePicture } from '@/types/agent'
import ArchetypeIcon from '@/components/ui/ArchetypeIcon.vue'

const props = withDefaults(defineProps<{
  /** Initial letters shown when no profile picture is available. */
  initials: string
  /** Optional profile picture. When provided, takes precedence over `initials`. */
  profilePicture?: AgentProfilePicture | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  tone?: 'muted' | 'primary'
}>(), {
  size: 'md',
  tone: 'muted',
  profilePicture: null,
})

const sizeClasses: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'h-8 w-8 text-[0.65rem]',
  md: 'h-11 w-11 text-xs',
  lg: 'h-14 w-14 text-sm',
  xl: 'h-20 w-20 text-base',
}

const toneClasses: Record<'muted' | 'primary', string> = {
  muted: 'bg-muted text-foreground',
  primary: 'bg-foreground text-background',
}

const isImage = computed<boolean>(
  () => props.profilePicture?.kind === 'image' && typeof props.profilePicture.image_url === 'string',
)

const isAvatar = computed<boolean>(
  () => props.profilePicture?.kind === 'avatar'
    && typeof props.profilePicture.archetype === 'string'
    && typeof props.profilePicture.variant_key === 'string'
    && typeof props.profilePicture.fg_color === 'string'
    && typeof props.profilePicture.bg_color === 'string',
)

const wrapperClasses = computed<string[]>(() => [
  'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-xl font-semibold uppercase tracking-wider',
  sizeClasses[props.size],
])

const initialsClasses = computed<string>(() => [
  wrapperClasses.value.join(' '),
  'rounded-full',
  toneClasses[props.tone],
].join(' '))

const avatarBgStyle = computed<string | null>(() => {
  if (!isAvatar.value || props.profilePicture === null) return null
  return `background-color: ${props.profilePicture.bg_color}; color: ${props.profilePicture.fg_color};`
})

const avatarArchetype = computed<string>(() => {
  if (!isAvatar.value || props.profilePicture === null) return 'assistant'
  return props.profilePicture.archetype ?? 'assistant'
})

const avatarVariant = computed<string>(() => {
  if (!isAvatar.value || props.profilePicture === null) return 'v0'
  return props.profilePicture.variant_key ?? 'v0'
})

const ariaLabel = computed<string>(() => {
  if (isImage.value && props.profilePicture !== null) {
    return `Agent picture (uploaded at ${props.profilePicture.image_updated_at ?? 'unknown'})`
  }
  if (isAvatar.value && props.profilePicture !== null) {
    return `Agent picture (${props.profilePicture.archetype ?? 'avatar'})`
  }
  return props.initials
})

const imageSrc = computed<string>(() => {
  // The image_updated_at timestamp is the deterministic cache-buster —
  // appending it as a query string forces the browser to re-fetch when
  // the operator re-uploads (the underlying MediaArchive URL is stable
  // across uploads of the same file). Without the query string the
  // browser would serve the cached image and the operator would never
  // see their replacement.
  if (!isImage.value || props.profilePicture === null) return ''
  const url = props.profilePicture.image_url ?? ''
  if (url === '') return ''
  const cacheBuster = props.profilePicture.image_updated_at ?? ''
  return cacheBuster === '' ? url : `${url}?v=${encodeURIComponent(cacheBuster)}`
})
</script>

<template>
  <span
    v-if="isImage && profilePicture"
    :class="wrapperClasses"
    :style="{ backgroundColor: '#f1f5f9' }"
    role="img"
    :aria-label="ariaLabel"
    data-testid="avatar-image"
  >
    <img
      :src="imageSrc"
      class="h-full w-full object-cover"
      :alt="ariaLabel"
      loading="lazy"
      :data-image-updated-at="profilePicture.image_updated_at ?? ''"
    />
  </span>
  <span
    v-else-if="isAvatar && profilePicture"
    :class="wrapperClasses"
    :style="avatarBgStyle"
    role="img"
    :aria-label="ariaLabel"
    data-testid="avatar-archetype"
  >
    <ArchetypeIcon :archetype="avatarArchetype" :variant="avatarVariant" svg-class="h-2/3 w-2/3" />
  </span>
  <span
    v-else
    :class="initialsClasses"
    :aria-label="ariaLabel"
    data-testid="avatar-initials"
  >
    {{ initials }}
  </span>
</template>
