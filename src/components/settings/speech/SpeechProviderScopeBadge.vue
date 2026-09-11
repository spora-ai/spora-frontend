<script setup lang="ts">
/**
 * SpeechProviderScopeBadge — small badge for the scope (Global / Mine)
 * column in the speech provider list and config rows.
 */
import type { SpeechProviderScope } from '@/types/speechProviderConfig'

defineProps<{
  scope: SpeechProviderScope
}>()
</script>

<template>
  <span
    class="text-xs rounded-full px-1.5 py-0.5 font-medium"
    :class="
      scope === 'global'
        ? 'bg-muted text-muted-foreground'
        : 'bg-primary/10 text-primary'
    "
  >
    {{ scope === 'global' ? 'Global' : 'Mine' }}
  </span>
</template>
