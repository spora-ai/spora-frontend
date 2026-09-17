<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
// error state. Closed by clicking the backdrop, pressing Escape, or
// clicking the indicator again.
const isOpen = ref(false)
const buttonRef = ref<HTMLButtonElement | null>(null)
const dialogEl = ref<HTMLDialogElement | null>(null)
// Anchored to the button's position when the popover opens. The indicator
// moved to the LEFT of the navbar so the popover follows the button
// instead of the previous hard-coded `left-4` (which pinned it to the
// far-left of the viewport regardless of where the button sat).
const popoverStyle = ref<{ left: string; top: string } | null>(null)

// Sync isOpen <-> the native <dialog>. showModal() places the dialog
// in the top-layer (which SonarQube Web:S6842 requires for a real
// modal dialog). The .open guard prevents calling close() on a dialog
// that was dismissed by the user-agent's own Escape handling — the
// browser closes the dialog first, then our @close handler updates
// isOpen, which would otherwise re-enter .close() and throw.
watch(isOpen, async (open) => {
  if (open) {
    await nextTick()
    dialogEl.value?.showModal()
  } else if (dialogEl.value?.open) {
    dialogEl.value.close()
  }
})

// Native Escape on the dialog dispatches cancel (cancelable) + close
// (non-cancelable). close fires whether the dialog was dismissed by
// Escape or by an explicit .close() call, so mirroring it back into
// isOpen keeps the two state machines in sync without an extra watcher.
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

// Window-level Escape handler. The listener is paired with onBeforeUnmount
// so it doesn't leak across logout/login (GlobalNavbar is unmounted when
// the user is signed out and remounted on the next sign-in). The native
// <dialog>'s own ESC handling also closes the popover; this handler is a
// belt-and-braces fallback for any future case where the dialog loses
// focus while the indicator is still mounted.
onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown)
  }
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
  }
})

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
      <span
        :class="['inline-block h-2 w-2 rounded-full', dotClass]"
        aria-hidden="true"
      />
      <span>{{ label }}</span>
    </button>

    <Teleport to="body">
      <!--
        Native <dialog> replaces a div + role="dialog" so the popover
        gets top-layer semantics (SonarQube Web:S6842) and the dialog
        pattern comes for free (SonarQube Web:S6819). The `m-0
        h-screen w-screen p-0 border-0 bg-transparent` overrides the
        user-agent default styles that would otherwise center a 0×0
        white box over the page.
      -->
      <dialog
        v-if="isOpen"
        ref="dialogEl"
        class="fixed inset-0 z-50 m-0 h-screen w-screen p-0 border-0 bg-transparent"
        data-testid="client-worker-popover"
        :aria-label="bodyTitle"
        @close="onDialogClose"
      >
        <button
          type="button"
          aria-label="Close"
          class="absolute inset-0 cursor-default"
          data-testid="client-worker-backdrop"
          @click.self="onBackdropClick"
        />
        <div
          class="absolute w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background shadow-lg overflow-hidden"
          :style="popoverStyle ?? {}"
        >
          <header class="flex items-center justify-between border-b border-border px-4 py-3">
            <div class="flex items-center gap-2">
              <span
                :class="['inline-block h-2 w-2 rounded-full', dotClass]"
                aria-hidden="true"
              />
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

            <p
              v-if="hintText"
              class="text-xs text-muted-foreground leading-relaxed"
            >
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