<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { setupSessionHandler } from '@/api/client'
import ToastContainer from '@/components/ui/ToastContainer.vue'

const theme = useThemeStore()
const auth = useAuthStore()
const router = useRouter()
const toast = useToast()

const isHandlingSessionExpiry = ref(false)
let sessionExpiryRedirectTimer: ReturnType<typeof setTimeout> | null = null

function clearSessionExpiryRedirect(): void {
  if (sessionExpiryRedirectTimer !== null) {
    clearTimeout(sessionExpiryRedirectTimer)
    sessionExpiryRedirectTimer = null
  }
}

onBeforeUnmount(clearSessionExpiryRedirect)

onMounted(() => {
  theme.init()
  // Initial notification fetch is owned by useRealtime (called from GlobalNavbar
  // and AgentPage). It waits for auth to finish initializing and fires the
  // fetch on the SSE success path or the polling fallback.

  setupSessionHandler(() => {
    // Prevent duplicate handling if multiple 401s fire simultaneously
    if (isHandlingSessionExpiry.value) return
    isHandlingSessionExpiry.value = true

    // Don't redirect if already on login page
    if (router.currentRoute.value.name === 'login') return

    toast.error('Your session has expired. Redirecting to login...', {
      action: 'Login now',
      onAction: () => {
        clearSessionExpiryRedirect()
        auth.logout()
        router.push({ name: 'login' })
      },
    })

    // Auto-redirect after 3 seconds if user doesn't click the action button
    sessionExpiryRedirectTimer = setTimeout(() => {
      sessionExpiryRedirectTimer = null
      if (router.currentRoute.value.name !== 'login') {
        auth.logout()
        router.push({ name: 'login' })
      }
    }, 3000)
  })
})
</script>

<template>
  <RouterView />
  <ToastContainer
    :toasts="toast.toasts"
    :on-dismiss="toast.dismiss"
  />
</template>
