import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * useClientWorkerStore — UI-side state for the client-worker indicator.
 *
 * The runtime worker lives in a SharedWorker (or dedicated Worker
 * fallback); this store holds the last `status` it emitted plus the
 * `drivenTaskCount`. The actual worker lifecycle lives in
 * `useClientWorker`; this store is the read side that
 * `ClientWorkerIndicator.vue` binds to.
 *
 * `idle` is the "server mode" sentinel — when `runtimeConfig` reports
 * `worker_runtime_mode === 'server'` the indicator is hidden. Any
 * other status is a signal that the worker is alive (or degraded/error).
 */

export type ClientWorkerStatus = 'idle' | 'booting' | 'active' | 'degraded' | 'error'

export const useClientWorkerStore = defineStore('clientWorker', () => {
  const status = ref<ClientWorkerStatus>('idle')
  const degradedReason = ref<string | null>(null)
  const lastEventAt = ref<number | null>(null)
  const drivenTaskCount = ref<number>(0)

  function setStatus(next: ClientWorkerStatus, reason?: string | null): void {
    status.value = next
    degradedReason.value = reason ?? null
    lastEventAt.value = Date.now()
  }

  function setDrivenTaskCount(n: number): void {
    drivenTaskCount.value = n
  }

  const isActive = computed(() => status.value === 'active')
  const isDegraded = computed(() => status.value === 'degraded')
  const isError = computed(() => status.value === 'error')
  const isServerMode = computed(() => status.value === 'idle')

  return {
    status,
    degradedReason,
    lastEventAt,
    drivenTaskCount,
    isActive,
    isDegraded,
    isError,
    isServerMode,
    setStatus,
    setDrivenTaskCount,
  }
})