<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterView, useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { setupSessionHandler } from '@/api/client'
import ToastContainer from '@/components/ui/ToastContainer.vue'

const theme = useThemeStore()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const toast = useToast()
const { t } = useI18n()

const isHandlingSessionExpiry = ref(false)
let sessionExpiryRedirectTimer: ReturnType<typeof setTimeout> | null = null

function clearSessionExpiryRedirect(): void {
  if (sessionExpiryRedirectTimer !== null) {
    clearTimeout(sessionExpiryRedirectTimer)
    sessionExpiryRedirectTimer = null
  }
}

// `login` is a guest-only route, so the router bounces a still-authenticated
// visitor back to the dashboard — the session has to be cleared before the
// push, not alongside it.
async function logoutAndGoToLogin(): Promise<void> {
  await auth.logout()
  await router.push({ name: 'login' })
}

onBeforeUnmount(clearSessionExpiryRedirect)

onMounted(() => {
  theme.init()
  // Initial notification fetch is owned by useRealtime (called from
  // GlobalNavbar and AgentPage). It waits for auth to finish initializing and
  // fires the fetch on the SSE success path or the polling fallback.

  setupSessionHandler(() => {
    // Prevent duplicate handling if multiple 401s fire simultaneously
    if (isHandlingSessionExpiry.value) return
    isHandlingSessionExpiry.value = true

    // Don't redirect if already on login page
    if (router.currentRoute.value.name === 'login') return

    toast.error(t('Your session has expired. Redirecting to login...'), {
      action: t('Login now'),
      onAction: () => {
        clearSessionExpiryRedirect()
        void logoutAndGoToLogin()
      },
    })

    // Auto-redirect after 3 seconds if user doesn't click the action button
    sessionExpiryRedirectTimer = setTimeout(() => {
      sessionExpiryRedirectTimer = null
      if (router.currentRoute.value.name !== 'login') {
        void logoutAndGoToLogin()
      }
    }, 3000)
  })
})
</script>

<template>
  <!--
    `path`, not `fullPath`: layouts render inside this RouterView, so a
    query-only remount restarts their data layer (GlobalSettingsLayout
    refetching `/tools` from empty). Param changes must still remount.
  -->
  <RouterView :key="route.path" />
  <ToastContainer
    :toasts="toast.toasts"
    :on-dismiss="toast.dismiss"
  />
</template>
