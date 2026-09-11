<script setup lang="ts">
/**
 * SpeechProviderEmptyState — shown when no speech provider configs
 * exist for the current scope. The CTA emits `create` so the parent
 * page transitions into the create view.
 */
import type { SpeechProviderScope } from '@/types/speechProviderConfig'

defineProps<{
  scope: SpeechProviderScope
}>()

defineEmits<{
  create: []
}>()
</script>

<template>
  <div class="rounded-xl border border-border bg-card p-8 text-center">
    <p class="text-sm text-muted-foreground mb-4">
      <template v-if="scope === 'global'">
        No global speech provider configurations yet.
      </template>
      <template v-else>
        You have not configured a personal speech provider yet.
      </template>
    </p>
    <button
      type="button"
      @click="$emit('create')"
      class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
    >
      Set up your first provider
    </button>
  </div>
</template>
