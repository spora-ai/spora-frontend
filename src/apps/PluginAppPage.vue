<script setup lang="ts">
/**
 * PluginAppPage — generic root shell for `/apps/:appName`.
 *
 * Responsibilities:
 *  1. Resolve `appName` against the apps store (loaded once on mount).
 *  2. If the app has a `frontendEntry`, dynamically import the plugin's
 *     IIFE bundle and mount it into the dedicated slot element.
 *  3. (Removed in v0.12.0: no core-owned SPA children remain that need a
 *     legacy fallback. Memories is now `spora-plugin-memories`; `plugins`
 *     already routes directly through vue-router.)
 *  4. When `apps` doesn't know the slug (plugin uninstalled), show a
 *     friendly empty state with a deep-link to `/apps/plugins`.
 *
 * Slot ownership: the `<div ref="slotRef">` is the plugin's mount target.
 * Its previous contents are cleared on unmount via the registry contract.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Puzzle } from 'lucide-vue-next'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import Icon from '@/components/ui/Icon.vue'
import { useAppsStore } from '@/apps/stores/apps'
import { usePluginApp } from '@/composables/usePluginApp'
import { buildHostContext } from '@/apps/registry'
import { useAuthStore } from '@/stores/auth'
import { getActivePinia } from 'pinia'

const route = useRoute()
const router = useRouter()
const appsStore = useAppsStore()
const auth = useAuthStore()
const { loading, error, mounted, mount, unmount } = usePluginApp()

const slotRef = ref<HTMLElement | null>(null)

const appName = computed<string>(() => {
  const p = route.params.appName
  if (typeof p === 'string') return p
  if (Array.isArray(p) && p.length > 0) return p[0]
  return ''
})

const resolved = computed(() => (appName.value ? appsStore.resolveApp(appName.value) : null))
const isMountable = computed(() => {
  const a = resolved.value
  return a !== null && typeof a.frontendEntry === 'string' && typeof a.slug === 'string'
})

async function mountForCurrent(): Promise<void> {
  if (!isMountable.value || !slotRef.value) return
  const app = resolved.value
  if (!app || !app.frontendEntry || !app.slug) return
  const pinia = getActivePinia()
  if (!pinia) return
  const ctx = buildHostContext(pinia, router, route)
  await mount(slotRef.value, app.slug, app.frontendEntry, ctx)
}

onMounted(async () => {
  // Auth init must run before the apps endpoint so the session cookie is present.
  if (!auth.initialized) {
    await auth.init()
  }
  await appsStore.load()
  // After `appsStore.load()` resolves, `isMountable` flips true and the
  // slot div is queued for render — but the DOM write happens in the
  // next tick. Mounting before that tick targets a detached element
  // (Vue renders into it, then the render is replaced when the slot
  // is finally attached). `nextTick()` flushes the pending patch
  // before we capture the slot ref.
  await nextTick()
  await mountForCurrent()
})

// Re-mount when the user navigates between sibling segments (router does
// not rebuild the page component for those — `/apps/foo` → `/apps/bar`
// keeps the same component instance). `flush: 'post'` fires after Vue
// has patched the new keyed slot element into the DOM, so
// `mountForCurrent()` captures the fresh ref rather than the slot's
// previous instance.
watch(appName, async (next, prev) => {
  if (next === prev) return
  unmount()
  if (!appsStore.apps.length) {
    await appsStore.load()
  }
  await nextTick()
  await mountForCurrent()
}, { flush: 'post' })

onBeforeUnmount(() => {
  unmount()
})

function goBack(): void {
  router.push({ path: '/apps' })
}
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <GlobalNavbar />

    <header
      class="border-b border-border bg-background"
      data-testid="plugin-app-header"
    >
      <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <div v-if="resolved" class="flex items-center gap-2 min-w-0">
          <div class="rounded-md bg-primary/10 p-1.5 shrink-0">
            <Icon :name="resolved.icon" class="w-4 h-4 text-primary" />
          </div>
          <h1 class="text-base font-semibold truncate">{{ resolved.displayName }}</h1>
        </div>
        <div v-else class="flex items-center gap-2 min-w-0 text-muted-foreground">
          <Puzzle class="w-4 h-4" />
          <span class="text-sm">{{ appName }}</span>
        </div>
      </div>
    </header>

    <main class="flex-1">
      <div class="max-w-6xl mx-auto px-4 py-6">
        <!-- The slot itself is a LEAF — no v-if children. When the host
             re-renders, Vue's patcher walks the slot's children to
             reconcile vDOM vs DOM. If the slot has v-if children, the
             vDOM has comment placeholders, but the actual DOM has the
             plugin's render (from app.mount). Reconciling those fails
             with "Cannot read properties of null (reading 'insertBefore')".
             Keeping the slot empty on the host side lets the plugin own
             the slot's contents exclusively. The slot's v-if does NOT
             include `loading` because toggling `loading` would remove
             the slot mid-mount and detach the plugin's render target. -->
        <div
          v-if="resolved && isMountable"
          :key="`plugin-slot-${resolved.name}`"
          ref="slotRef"
          data-testid="plugin-app-slot"
          class="rounded-xl min-h-[200px]"
        />

        <!-- Plugin mount lifecycle: loading / error / initialising as
             siblings of the slot. They render in the slot area but
             don't touch the slot's vDOM tree. -->
        <div
          v-if="resolved && isMountable && loading"
          class="flex items-center gap-3 text-sm text-muted-foreground"
          data-testid="plugin-app-loading"
        >
          <span class="inline-block w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
          Loading plugin UI…
        </div>

        <div
          v-if="resolved && isMountable && error"
          class="rounded-xl border border-border bg-card p-8 text-center"
          data-testid="plugin-app-error"
        >
          <AlertTriangle class="w-8 h-8 text-warning mx-auto mb-3" />
          <template v-if="error.kind === 'uninstalled'">
            <h2 class="text-sm font-semibold mb-1">Plugin uninstalled</h2>
            <p class="text-xs text-muted-foreground max-w-md mx-auto mb-4">
              The plugin providing <code class="font-mono">{{ appName }}</code> is no longer
              installed. Reinstall it via the Plugins page to restore its UI.
            </p>
            <RouterLink
              to="/apps/plugins"
              class="inline-flex items-center h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Go to Plugins
            </RouterLink>
          </template>
          <template v-else>
            <h2 class="text-sm font-semibold mb-1">Plugin failed to load</h2>
            <p class="text-xs text-muted-foreground max-w-md mx-auto mb-4">
              {{ error.message }}
            </p>
            <button
              type="button"
              @click="goBack"
              class="inline-flex items-center h-9 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-colors"
            >
              Back to Apps
            </button>
          </template>
        </div>

        <div
          v-if="resolved && isMountable && !loading && !error && !mounted"
          class="flex items-center gap-3 text-sm text-muted-foreground"
        >
          <span class="inline-block w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
          Initialising…
        </div>

        <!-- Error from the registry when the app isn't mountable (e.g. the
             slot was never created because resolved was null). The mountable
             case is already handled by the dedicated error block above. -->
        <div
          v-else-if="error && (!resolved || !isMountable)"
          class="rounded-xl border border-border bg-card p-8 text-center"
          data-testid="plugin-app-error"
        >
          <AlertTriangle class="w-8 h-8 text-warning mx-auto mb-3" />
          <template v-if="error.kind === 'uninstalled'">
            <h2 class="text-sm font-semibold mb-1">Plugin uninstalled</h2>
            <p class="text-xs text-muted-foreground max-w-md mx-auto mb-4">
              The plugin providing <code class="font-mono">{{ appName }}</code> is no longer
              installed. Reinstall it via the Plugins page to restore its UI.
            </p>
            <RouterLink
              to="/apps/plugins"
              class="inline-flex items-center h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Go to Plugins
            </RouterLink>
          </template>
          <template v-else>
            <h2 class="text-sm font-semibold mb-1">Plugin failed to load</h2>
            <p class="text-xs text-muted-foreground max-w-md mx-auto mb-4">
              {{ error.message }}
            </p>
            <button
              type="button"
              @click="goBack"
              class="inline-flex items-center h-9 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-colors"
            >
              Back to Apps
            </button>
          </template>
        </div>

        <!-- Apps endpoint still pending -->
        <div
          v-else-if="appsStore.loading"
          class="text-sm text-muted-foreground"
        >
          Loading…
        </div>

        <!-- Apps endpoint errored — surface the failure rather than letting
             it fall through to the "Unknown app" state (apps would be an
             empty array and `resolved` would be null, misleadingly
             suggesting the slug is unknown when the list never loaded). -->
        <div
          v-else-if="appsStore.error"
          class="rounded-xl border border-border bg-card p-8 text-center"
          data-testid="plugin-app-store-error"
        >
          <AlertTriangle class="w-8 h-8 text-warning mx-auto mb-3" />
          <h2 class="text-sm font-semibold mb-1">Couldn't load apps</h2>
          <p class="text-xs text-muted-foreground max-w-md mx-auto mb-4">
            {{ appsStore.error }}
          </p>
          <button
            type="button"
            @click="appsStore.load(true)"
            class="inline-flex items-center h-9 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-colors"
          >
            Retry
          </button>
        </div>

        <!-- Unknown slug (not found in /apps) -->
        <div
          v-else-if="!resolved"
          class="rounded-xl border border-dashed border-border bg-card p-12 text-center"
          data-testid="plugin-app-unknown"
        >
          <Puzzle class="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h2 class="text-sm font-semibold mb-1">Unknown app</h2>
          <p class="text-xs text-muted-foreground max-w-md mx-auto mb-4">
            <code class="font-mono">{{ appName }}</code> is not registered with this Spora
            instance. Browse installed plugins to see what's available, or install a new one.
          </p>
          <RouterLink
            to="/apps/plugins"
            class="inline-flex items-center h-9 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-colors"
          >
            Open Plugins
          </RouterLink>
        </div>
      </div>
    </main>
  </div>
</template>
