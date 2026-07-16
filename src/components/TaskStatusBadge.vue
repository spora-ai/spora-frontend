<script setup lang="ts">
/**
 * Legacy TaskStatusBadge — re-export of the generic StatusBadge atom.
 *
 * Kept as a thin wrapper so existing callers keep compiling while the
 * dashboard redesign migrates to `src/components/ui/StatusBadge.vue`.
 */
import type { TaskStatus } from '@/types/task'
import StatusBadge from '@/components/ui/StatusBadge.vue'

withDefaults(defineProps<{ status: TaskStatus; pulse?: boolean }>(), { pulse: true })
</script>

<template>
  <StatusBadge :status="status" :pulse="pulse" />
</template>