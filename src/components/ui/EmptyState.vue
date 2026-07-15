<script setup lang="ts">
/**
 * EmptyState — centered placeholder for empty lists / filtered results.
 *
 * Callers can either pass `title` and `description` props, or use the
 * default slot for richer content (e.g. a reset button). An optional
 * `action-label` + `@action` pair renders a small primary button below
 * the description for the common "no results, reset filters" case — the
 * default slot still wins when both are present.
 *
 * The `icon` slot overrides the default puzzle icon.
 */
withDefaults(defineProps<{
  title?: string
  description?: string
  actionLabel?: string
}>(), {})

const emit = defineEmits<{
  action: []
}>()

const defaultIcon =
  '<svg viewBox="0 0 24 24" class="h-7 w-7 text-muted-foreground" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>'
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
    <div
      v-if="$slots.icon"
      class="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <slot name="icon" />
    </div>
    <div
      v-else
      class="flex h-14 w-14 items-center justify-center rounded-full bg-muted"
      v-html="defaultIcon"
      aria-hidden="true"
    />

    <template v-if="$slots.default">
      <slot />
    </template>
    <template v-else>
      <p v-if="title" class="text-sm font-medium text-foreground">{{ title }}</p>
      <p v-if="description" class="max-w-xs text-xs text-muted-foreground">{{ description }}</p>
      <button
        v-if="actionLabel"
        type="button"
        class="mt-2 inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
        @click="emit('action')"
      >
        {{ actionLabel }}
      </button>
    </template>
  </div>
</template>