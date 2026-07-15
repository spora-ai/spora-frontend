<script setup lang="ts">
/**
 * Avatar — initial-letter circle for the agent card / member list.
 *
 * Pass uppercase initials (the dashboard derives them from the agent name).
 * Use `tone="primary"` when the avatar needs to stand out against the
 * page background (e.g. inline with a heading); `tone="muted"` (default)
 * reads as a quiet identifier beside prose.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  initials: string
  size?: 'sm' | 'md' | 'lg'
  tone?: 'muted' | 'primary'
}>(), {
  size: 'md',
  tone: 'muted',
})

const sizeClasses: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8 w-8 text-[0.65rem]',
  md: 'h-11 w-11 text-xs',
  lg: 'h-14 w-14 text-sm',
}

const toneClasses: Record<'muted' | 'primary', string> = {
  muted: 'bg-muted text-foreground',
  primary: 'bg-foreground text-background',
}

const classes = computed(() => [
  'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase tracking-wider',
  sizeClasses[props.size],
  toneClasses[props.tone],
])
</script>

<template>
  <span :class="classes" :aria-label="initials">
    {{ initials }}
  </span>
</template>