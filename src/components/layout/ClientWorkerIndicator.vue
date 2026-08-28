<script setup lang="ts">
import { computed } from 'vue'
import { useClientWorkerStore } from '@/stores/clientWorker'

const store = useClientWorkerStore()
const visible = computed(() => !store.isServerMode)

const dotClass = computed(() => {
  if (store.isActive) return 'bg-green-500'
  if (store.isDegraded) return 'bg-amber-500'
  if (store.isError) return 'bg-destructive'
  return 'bg-muted-foreground'
})

const label = computed(() => {
  if (store.isActive) return 'Client worker active'
  if (store.isDegraded) return store.degradedReason ?? 'Single-tab mode'
  if (store.isError) return 'Worker offline'
  return 'Client worker booting'
})
</script>

<template>
  <output
    v-if="visible"
    class="flex items-center gap-2 text-xs text-muted-foreground"
    :data-status="store.status"
    aria-live="polite"
  >
    <span :class="['inline-block h-2 w-2 rounded-full', dotClass]" aria-hidden="true" />
    <span>{{ label }}</span>
  </output>
</template>