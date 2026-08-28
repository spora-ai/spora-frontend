<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClientWorkerStore } from '@/stores/clientWorker'
import { restartClientWorker } from '@/composables/useClientWorker'
import { log } from '@/utils/logger'

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

// Popover — state-specific body + an action when the worker is in the
// error state. Closed by clicking outside, pressing Escape, or clicking
// the indicator again.
const isOpen = ref(false)

function toggle(): void {
  isOpen.value = !isOpen.value
}

function close(): void {
  isOpen.value = false
}

function onBackdropClick(): void {
  close()
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && isOpen.value) {
    close()
  }
}

// Window-level Escape handler. The indicator is a singleton (only one
// navbar in the SPA) so the listener is registered once and never
// duplicated. We don't register cleanup via onBeforeUnmount because
// the navbar never unmounts during the page session — it persists
// across route changes.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeydown)
}

const restarting = ref(false)

async function onRestart(): Promise<void> {
  restarting.value = true
  try {
    await restartClientWorker()
    close()
  } catch (e) {
    log.error('[ClientWorkerIndicator] restart failed', e)
  } finally {
    restarting.value = false
  }
}

const bodyTitle = computed(() => {
  if (store.isActive) return 'Your browser drives your tasks'
  if (store.isDegraded) return 'Single-tab mode'
  if (store.isError) return 'Worker disconnected'
  return 'Starting up…'
})

const bodyText = computed(() => {
  if (store.isActive) {
    return 'This browser ticks your tasks at ~2 s intervals and dispatches scheduled runs every 5 minutes while it is open. Tasks you started and scheduled runs for agents you can see all run from here.'
  }
  if (store.isDegraded) {
    return 'This browser does not support SharedWorker, so each tab runs its own worker. Only tabs with an open chat will tick tasks. Try Chrome, Firefox, or Edge for cross-tab efficiency.'
  }
  if (store.isError) {
    return 'The SharedWorker disconnected. It normally reconnects on its own; click Restart if it does not recover.'
  }
  return 'Booting the browser worker…'
})

const hintText = computed(() => {
  if (store.isActive) return 'Keep this browser tab open while tasks are running.'
  if (store.isDegraded) return 'Open in a SharedWorker-capable browser for full coverage.'
  if (store.isError) return 'If restart keeps failing, check the browser console.'
  return ''
})
</script>

<template>
  <output
    v-if="visible"
    class="relative flex items-center"
    :data-status="store.status"
    aria-live="polite"
  >
    <button
      type="button"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      :aria-label="`Client worker status: ${label}. Click for details.`"
      class="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      :data-testid="'client-worker-indicator'"
      @click="toggle"
    >
      <span :class="['inline-block h-2 w-2 rounded-full', dotClass]" aria-hidden="true" />
      <span>{{ label }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50"
        role="dialog"
        aria-modal="true"
        :aria-label="bodyTitle"
        data-testid="client-worker-popover"
        @click="onBackdropClick"
      >
        <div
          class="absolute left-4 top-14 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background shadow-lg overflow-hidden"
          @click.stop
        >
          <header class="flex items-center justify-between border-b border-border px-4 py-3">
            <div class="flex items-center gap-2">
              <span :class="['inline-block h-2 w-2 rounded-full', dotClass]" aria-hidden="true" />
              <h2 class="text-sm font-semibold text-foreground">{{ bodyTitle }}</h2>
            </div>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
              @click="close"
            >
              ✕
            </button>
          </header>

          <div class="px-4 py-3 space-y-3">
            <p class="text-sm text-foreground leading-relaxed">{{ bodyText }}</p>

            <p v-if="hintText" class="text-xs text-muted-foreground leading-relaxed">
              {{ hintText }}
            </p>

            <dl
              v-if="store.isActive || store.isDegraded"
              class="grid grid-cols-2 gap-2 text-xs"
            >
              <div class="rounded-md bg-muted px-2 py-1.5">
                <dt class="text-muted-foreground">Driven tasks</dt>
                <dd class="font-mono font-semibold text-foreground">{{ store.drivenTaskCount }}</dd>
              </div>
              <div class="rounded-md bg-muted px-2 py-1.5">
                <dt class="text-muted-foreground">Tick interval</dt>
                <dd class="font-mono font-semibold text-foreground">~2 s</dd>
              </div>
            </dl>
          </div>

          <footer
            v-if="store.isError"
            class="border-t border-border bg-muted px-4 py-3 flex items-center justify-between"
          >
            <span class="text-xs text-muted-foreground">Worker disconnected.</span>
            <button
              type="button"
              :disabled="restarting"
              class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="client-worker-restart"
              @click="onRestart"
            >
              {{ restarting ? 'Restarting…' : 'Restart worker' }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </output>
</template>