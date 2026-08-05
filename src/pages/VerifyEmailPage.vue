<script setup lang="ts">
/**
 * VerifyEmailPage — handles email verification links from the backend.
 * Route: /auth/verify/:selector?token=xxx
 *
 * The backend returns `kind: 'signup'` for an initial verification
 * (logged-out recipient clicks the link in the welcome email) and
 * `kind: 'change'` for an email-address change (logged-in user clicks
 * the link in the change-confirmation email). The two flows render
 * different copy so the user knows whether to log in or just keep going.
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/client'
import type { AuthVerifyResponse } from '@/types/auth'
import Icon from '@/components/ui/Icon.vue'

type Status = 'loading' | 'success-signup' | 'success-change' | 'error'

/**
 * Map a backend `kind` discriminator to the local UI status. Exhaustive
 * over the union so a future backend addition triggers a compile-time
 * error instead of silently rendering the wrong copy.
 */
function statusForKind(kind: AuthVerifyResponse['kind']): Status {
  switch (kind) {
    case 'change':
      return 'success-change'
    case 'signup':
      return 'success-signup'
  }
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const status = ref<Status>('loading')
const errorMessage = ref('')
const verifiedEmail = ref('')

onMounted(async () => {
  const selector = route.params.selector as string
  const token = route.query.token as string

  if (!selector || !token) {
    status.value = 'error'
    errorMessage.value = 'Invalid verification link. Please check your email and try again.'
    return
  }

  try {
    const res = await auth.verifyEmail(selector, token)
    verifiedEmail.value = res.new_email
    status.value = statusForKind(res.kind)
  } catch (e) {
    status.value = 'error'
    if (e instanceof ApiError) {
      errorMessage.value = e.message
    } else {
      errorMessage.value = 'Verification failed. Please try again.'
    }
  }
})

function goToLogin(): void {
  router.push({ name: 'login' })
}

function goToDashboard(): void {
  router.push({ name: 'dashboard' })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm space-y-8 text-center">

      <!-- Loading -->
      <div v-if="status === 'loading'" class="space-y-4">
        <div class="h-12 w-12 mx-auto rounded-full bg-muted flex items-center justify-center animate-pulse">
          <Icon name="mail" class="h-6 w-6 text-muted-foreground" />
        </div>
        <p class="text-sm text-muted-foreground">Verifying your email…</p>
      </div>

      <!-- Initial signup: take the user to sign in -->
      <div v-else-if="status === 'success-signup'" class="space-y-6">
        <div class="h-12 w-12 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Icon name="check" class="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>
        <div class="space-y-2">
          <h1 class="text-xl font-semibold">Email verified!</h1>
          <p class="text-sm text-muted-foreground">
            Your account at <span class="font-medium text-foreground">{{ verifiedEmail }}</span> has been verified. You can now sign in.
          </p>
        </div>
        <button
          @click="goToLogin"
          class="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors w-full"
          type="button"
        >
          Sign in
        </button>
      </div>

      <!-- Email change: keep the user logged in -->
      <div v-else-if="status === 'success-change'" class="space-y-6">
        <div class="h-12 w-12 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Icon name="check" class="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>
        <div class="space-y-2">
          <h1 class="text-xl font-semibold">Email updated</h1>
          <p class="text-sm text-muted-foreground">
            Your email address was changed to <span class="font-medium text-foreground">{{ verifiedEmail }}</span>.
          </p>
        </div>
        <button
          @click="goToDashboard"
          class="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors w-full"
          type="button"
        >
          Back to dashboard
        </button>
      </div>

      <!-- Error -->
      <div v-else class="space-y-6">
        <div class="h-12 w-12 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <Icon name="x-circle" class="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <div class="space-y-2">
          <h1 class="text-xl font-semibold">Verification failed</h1>
          <p class="text-sm text-muted-foreground">{{ errorMessage }}</p>
        </div>
        <button
          @click="goToLogin"
          class="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted px-6 text-sm font-medium transition-colors w-full"
          type="button"
        >
          Back to sign in
        </button>
      </div>

    </div>
  </div>
</template>
