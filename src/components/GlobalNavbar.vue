<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useNotificationStore } from '@/stores/notifications'
import { useRealtime } from '@/composables/useRealtime'
import { useClientWorker } from '@/composables/useClientWorker'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { api } from '@/api/client'
import { log } from '@/utils/logger'
import NotificationCenter from './NotificationCenter.vue'
import CreateAgentDialog from './agent/CreateAgentDialog.vue'
import CommandPalette from './CommandPalette.vue'
import ClientWorkerIndicator from './layout/ClientWorkerIndicator.vue'
import GlobalBar from './navbar/GlobalBar.vue'
import GlobalSheet from './navbar/GlobalSheet.vue'
import GlobalSheetIdentity from './navbar/GlobalSheetIdentity.vue'
import GlobalSheetDashboard from './navbar/GlobalSheetDashboard.vue'
import GlobalSheetApps from './navbar/GlobalSheetApps.vue'
import GlobalSheetGroups from './navbar/GlobalSheetGroups.vue'
import ListItemButton from './ui/ListItemButton.vue'
import Icon from './ui/Icon.vue'
import type { AppResource } from '@/apps/types'

const router = useRouter()
const auth = useAuthStore()
const theme = useThemeStore()
const notificationStore = useNotificationStore()

// Initialize real-time connection (auto-cleans up on unmount)
useRealtime()

// Boot the browser-driven task worker. The composable is a singleton —
// subsequent calls are idempotent and no-op. It auto-tears-down on logout
// (the `auth.user` watcher inside the composable owns that lifecycle).
void useClientWorker()

// Register the ⌘K / Ctrl-K hotkey listener for the global command
// palette. The composable is a singleton so all callers share state;
// this call only attaches the window keydown listener.
const { toggle: toggleCommandPalette } = useCommandPalette()

const notificationCenter = ref<InstanceType<typeof NotificationCenter> | null>(null)
const menuOpen = ref(false)

async function logout(): Promise<void> {
  menuOpen.value = false
  await auth.logout()
  router.push({ name: 'login' })
}

function openNotifications(): void {
  notificationCenter.value?.open()
}

function navigateToApp(app: AppResource): void {
  menuOpen.value = false
  router.push(app.route)
}

function goTo(name: string): void {
  menuOpen.value = false
  router.push({ name })
}

// `/settings` is a parent route without a name (its child `settings-overview`
// is the actual landing page). Push the path string so we hit the redirect
// the parent declares, rather than failing on a non-existent route name.
function goToSettings(): void {
  menuOpen.value = false
  router.push('/settings')
}

function onPageShow(ev: PageTransitionEvent): void {
  // Pages restored from bfcache may have missed SSE messages while the
  // page was frozen (the SharedWorker's tick loop keeps running, but the
  // page didn't render them). A bare refetch brings the visible tasks back
  // in sync — failures are silent because the worker's tick loop is the
  // authoritative driver and will reconcile on the next interval anyway.
  if (ev.persisted) {
    api.get<{ tasks: unknown[] }>('/tasks?since=null').catch((e) => {
      log.debug('[GlobalNavbar] bfcache resync /tasks failed', e)
    })
  }
}

onMounted(() => {
  window.addEventListener('pageshow', onPageShow)
})

onBeforeUnmount(() => {
  window.removeEventListener('pageshow', onPageShow)
})
</script>

<template>
  <GlobalBar
    :unread-count="notificationStore.unreadCount"
    :is-dark="theme.isDark"
    :logged-in="auth.user !== null"
    v-model:menu-open="menuOpen"
    @open-search="toggleCommandPalette"
    @open-notifications="openNotifications"
    @toggle-theme="theme.toggle()"
  >
    <template #status>
      <ClientWorkerIndicator />
    </template>
  </GlobalBar>

  <GlobalSheet
    v-model:open="menuOpen"
  >
    <template #identity="{ close }">
      <GlobalSheetIdentity
        :user="auth.user"
        @close="close"
        @navigate="() => { close(); goTo('account') }"
      />
    </template>

    <GlobalSheetDashboard />

    <GlobalSheetApps @navigate="navigateToApp" />

    <GlobalSheetGroups />

    <section class="px-5 py-4 border-t border-border">
      <h2 class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Settings
      </h2>
      <button
        type="button"
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-muted/60 transition-colors text-left"
        @click="goToSettings"
      >
        <Icon
          name="settings"
          class="h-4 w-4 text-muted-foreground"
        />
        Settings
      </button>
    </section>

    <section class="px-5 py-4 border-t border-border">
      <h2 class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Account
      </h2>
      <div class="space-y-1">
        <ListItemButton
          title="My Account"
          @click="goTo('account')"
        />
        <ListItemButton
          title="Profile"
          @click="goTo('profile')"
        />
      </div>
    </section>

    <template #footer="{ close }">
      <div class="px-5 py-4 border-t border-border">
        <button
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors text-left"
          @click="() => { close(); void logout() }"
        >
          <Icon
            name="logout"
            class="h-4 w-4"
          />
          Sign out
        </button>
      </div>
    </template>
  </GlobalSheet>

  <!-- Notification center panel — opens via the bell in the bar. -->
  <NotificationCenter ref="notificationCenter" />

  <!-- Unified Create Agent dialog. Mounted here so it works from every page. -->
  <CreateAgentDialog />

  <!-- Global command palette (⌘K). Mounted globally so the keyboard
       shortcut works from any page. -->
  <CommandPalette v-if="auth.user" />
</template>
