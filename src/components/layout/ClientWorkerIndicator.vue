<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useClientWorkerStore } from '@/stores/clientWorker'
import { useRuntimeConfigStore } from '@/stores/runtimeConfig'
import { restartClientWorker } from '@/composables/useClientWorker'
import { log } from '@/utils/logger'

const store = useClientWorkerStore()
const runtimeConfig = useRuntimeConfigStore()
const visible = computed(() => !store.isServerMode)

// Read from the server-pushed runtime config so the indicator never
// drifts out of sync if the operator changes `tick_interval_ms`. The
// store always returns a number once `init()` has resolved; the
// fallback is the bootstrap default from the config endpoint.
const tickIntervalMs = computed(
  () => runtimeConfig.clientWorker.tick_interval_ms ?? 2000,
)

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
const buttonRef = ref<HTMLButtonElement | null>(null)
const dialogEl = ref<HTMLDialogElement | null>(null)
// Anchored to the button's position when the popover opens. The indicator
// moved to the LEFT of the navbar so the popover follows the button
// instead of the previous hard-coded `left-4` (which pinned it to the
// far-left of the viewport regardless of where the button sat).
const popoverStyle = ref<{ left: string; top: string } | null>(null)

/**
 * Drive the native <dialog> in lockstep with `isOpen`. `.showModal()`
 * promotes the element to the top layer with a backdrop, focus trap,
 * and native ESC handling; `.close()` tears it down and fires a
 * `close` event we mirror back into `isOpen` via `onDialogClose`.
 *
 * The `await nextTick()` on the open path is needed because `v-if`
 * provisions the element on the next render — the watcher fires
 * before Vue mounts the node. The close path runs before v-if unmounts
 * the element, so `dialogEl.value` is still the live element and
 * `.close()` removes the `open` attribute synchronously.
 */
watch(isOpen, async (open) => {
  if (open) {
    await nextTick()
    dialogEl.value?.showModal()
  } else {
    dialogEl.value?.close()
  }
})

/** Mirror the dialog's native `close` event (ESC, or any external
 * `.close()` caller) back into `isOpen` so the trigger button's
 * `aria-expanded` stays in sync. No-op when already closed. */
function onDialogClose(): void {
  if (isOpen.value) {
    isOpen.value = false
  }
}

function toggle(): void {
  if (!isOpen.value && buttonRef.value !== null) {
    const rect = buttonRef.value.getBoundingClientRect()
    popoverStyle.value = {
      left: `${rect.left}px`,
      top: `${rect.bottom + 8}px`,
    }
  }
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
      ref="buttonRef"
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
      <dialog
        ref="dialogEl"
        v-if="isOpen"
        class="fixed inset-0 z-50 m-0 h-screen w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
        aria-modal="true"
        :aria-label="bodyTitle"
        data-testid="client-worker-popover"
        @close="onDialogClose"
        @click="onBackdropClick"
      >
        <div
          class="absolute w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background shadow-lg overflow-hidden"
          :style="popoverStyle ?? {}"
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
                <dd class="font-mono font-semibold text-foreground">
                  {{ Math.round(tickIntervalMs / 1000) }} s
                </dd>
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
      </dialog>
    </Teleport>
  </output>
</template>