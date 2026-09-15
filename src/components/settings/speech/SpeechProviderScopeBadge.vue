<script setup lang="ts">
import { computed } from 'vue'
import type { SpeechProviderScope } from '@/types/speechProviderConfig'

const props = defineProps<{
  scope: SpeechProviderScope
}>()

const label = computed<string>(() => {
  switch (props.scope) {
    case 'global': return 'Global'
    case 'group': return 'Group'
    case 'user': return 'Mine'
    case 'agent': return 'Agent'
    default: return props.scope
  }
})

const toneClass = computed<string>(() => {
  switch (props.scope) {
    case 'global':
      return 'bg-muted text-muted-foreground'
    case 'group':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
    case 'agent':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'user':
    default:
      return 'bg-primary/10 text-primary'
  }
})
</script>

<template>
  <span
    class="text-xs rounded-full px-1.5 py-0.5 font-medium"
    :class="toneClass"
  >
    {{ label }}
  </span>
</template>
