<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import Icon from '@/components/ui/Icon.vue'
import NotificationSubscriptionsSection from '@/components/profile/NotificationSubscriptionsSection.vue'
import { ApiError } from '@/api/client'
import {
  notificationSubscriptionsApi,
  type NotificationSubscription,
} from '@/api/notificationSubscriptions'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// Display name form

const displayName = ref(auth.user?.name ?? '')
const displayNameSaving = ref(false)
const displayNameError = ref<string | null>(null)
const displayNameSuccess = ref(false)

async function saveDisplayName(): Promise<void> {
  const val = displayName.value.trim()
  if (!val) return
  displayNameSaving.value = true
  displayNameError.value = null
  displayNameSuccess.value = false
  try {
    await auth.updateAccount(val)
    displayNameSuccess.value = true
    setTimeout(() => { displayNameSuccess.value = false }, 3000)
  } catch (e) {
    displayNameError.value = e instanceof ApiError ? e.message : 'Failed to update display name.'
  } finally {
    displayNameSaving.value = false
  }
}

// Email change form

const newEmail = ref('')
const emailSaving = ref(false)
const emailError = ref<string | null>(null)
const emailSuccess = ref(false)

async function saveEmail(): Promise<void> {
  emailSaving.value = true
  emailError.value = null
  emailSuccess.value = false
  try {
    await auth.changeEmail(newEmail.value)
    emailSuccess.value = true
    newEmail.value = ''
    setTimeout(() => { emailSuccess.value = false }, 5000)
  } catch (e) {
    emailError.value = e instanceof ApiError ? e.message : 'Failed to request email change.'
  } finally {
    emailSaving.value = false
  }
}

// Password form

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordSaving = ref(false)
const passwordError = ref<string | null>(null)
const passwordSuccess = ref(false)

const passwordsMatch = computed(() => newPassword.value === confirmPassword.value)

async function savePassword(): Promise<void> {
  if (!currentPassword.value || !newPassword.value) return
  if (!passwordsMatch.value) {
    passwordError.value = 'New passwords do not match.'
    return
  }
  if (newPassword.value.length < 8) {
    passwordError.value = 'New password must be at least 8 characters.'
    return
  }
  passwordSaving.value = true
  passwordError.value = null
  try {
    await auth.changePassword(currentPassword.value, newPassword.value)
    passwordSuccess.value = true
    setTimeout(() => { passwordSuccess.value = false }, 3000)
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e) {
    passwordError.value = e instanceof ApiError ? e.message : 'Failed to change password.'
  } finally {
    passwordSaving.value = false
  }
}

// Notification subscriptions

const subscriptions = ref<NotificationSubscription[]>([])
const emailEnabled = ref<boolean | null>(null)
const userPrincipalId = ref<number | null>(null)
const subscriptionListReady = ref(true)

onMounted(async () => {
  try {
    const res = await notificationSubscriptionsApi.list()
    subscriptions.value = res.subscriptions
    emailEnabled.value = res.email_enabled
    userPrincipalId.value = res.user_principal_id
    subscriptionListReady.value = true
  } catch {
    subscriptionListReady.value = false
  }
})

/**
 * Two-letter initials badge for the identity card. Falls back to "?" when
 * the name is missing or whitespace-only.
 */
const initials = computed<string>(() => {
  const name = (auth.user?.name ?? '').trim()
  if (name === '') return '?'
  const parts = name.split(/\s+/u).filter((p) => p !== '')
  if (parts.length === 0) return '?'
  if (parts.length === 1) {
    const first = parts[0]
    return (first.length >= 2 ? first.slice(0, 2) : first).toUpperCase()
  }
  return ((parts[0][0] ?? '') + (parts[1][0] ?? '')).toUpperCase()
})
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <GlobalNavbar />

    <main class="flex-1 flex items-start justify-center px-4 py-8">
      <div class="w-full max-w-xl space-y-6">

        <!-- Identity card -->
        <header class="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
          <div
            class="h-14 w-14 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-base font-semibold"
            aria-hidden="true"
          >
            {{ initials }}
          </div>
          <div class="flex-1 min-w-0">
            <h1 class="text-lg font-semibold truncate">
              {{ auth.user?.name ?? 'My Account' }}
            </h1>
            <p class="text-sm text-muted-foreground truncate">
              {{ auth.user?.email }}
            </p>
          </div>
        </header>

        <!-- Display Name -->
        <section class="rounded-xl border border-border bg-card p-5 space-y-4">
          <div class="flex items-center gap-2">
            <Icon name="user" class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold text-foreground">Display Name</h2>
          </div>
          <p class="text-xs text-muted-foreground">
            Your display name appears in conversations and notifications.
          </p>
          <div class="flex gap-2">
            <div class="flex-1 space-y-1">
              <label class="sr-only" for="account-display-name">Display Name</label>
              <input
                id="account-display-name"
                v-model="displayName"
                type="text"
                placeholder="Your display name"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <button
              type="button"
              @click="saveDisplayName"
              :disabled="displayNameSaving || !displayName.trim()"
              class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {{ displayNameSaving ? 'Saving…' : 'Save' }}
            </button>
          </div>
          <p v-if="displayNameError" role="alert" class="text-xs text-destructive">{{ displayNameError }}</p>
          <output v-if="displayNameSuccess" class="text-xs text-green-600">Display name updated.</output>
        </section>

        <!-- Email Notifications · Scheduled Runs -->
        <NotificationSubscriptionsSection
          v-model:subscriptions="subscriptions"
          :email-enabled="emailEnabled"
          :user-principal-id="userPrincipalId"
          :subscription-list-ready="subscriptionListReady"
        />

        <!-- Change Email Address -->
        <section class="rounded-xl border border-border bg-card p-5 space-y-4">
          <div class="flex items-center gap-2">
            <Icon name="mail" class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold text-foreground">Change Email Address</h2>
          </div>
          <p class="text-xs text-muted-foreground">
            We'll send a confirmation link to your new email address.
          </p>
          <form @submit.prevent="saveEmail" class="space-y-3">
            <div class="space-y-2">
              <label for="new-email" class="text-sm font-medium">New Email Address</label>
              <input
                id="new-email"
                v-model="newEmail"
                type="email"
                autocomplete="email"
                placeholder="new@example.com"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <p v-if="emailError" role="alert" class="text-xs text-destructive">{{ emailError }}</p>
            <output v-if="emailSuccess" class="text-xs text-green-600">
              Confirmation email sent. Please check your new email inbox.
            </output>
            <button
              type="submit"
              :disabled="emailSaving || !newEmail"
              class="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {{ emailSaving ? 'Sending…' : 'Send Confirmation Email' }}
            </button>
          </form>
        </section>

        <!-- Change Password -->
        <section class="rounded-xl border border-border bg-card p-5 space-y-4">
          <div class="flex items-center gap-2">
            <Icon name="lock" class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold text-foreground">Change Password</h2>
          </div>
          <form @submit.prevent="savePassword" class="space-y-3">
            <!-- Required a11y signal: a form with type=password must have a (possibly hidden) username field. Also lets password managers prefill. -->
            <input
              id="account-username"
              type="email"
              name="email"
              :value="auth.user?.email ?? ''"
              autocomplete="username"
              tabindex="-1"
              aria-hidden="true"
              aria-label="Account email"
              class="absolute -left-[9999px] h-px w-px overflow-hidden"
            />
            <div class="space-y-2">
              <label for="current-pw" class="text-sm font-medium">Current Password</label>
              <input
                id="current-pw"
                v-model="currentPassword"
                type="password"
                autocomplete="current-password"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div class="space-y-2">
              <label for="new-pw" class="text-sm font-medium">New Password</label>
              <input
                id="new-pw"
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div class="space-y-2">
              <label for="confirm-pw" class="text-sm font-medium">Confirm New Password</label>
              <input
                id="confirm-pw"
                v-model="confirmPassword"
                type="password"
                autocomplete="new-password"
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <p v-if="passwordError" role="alert" class="text-xs text-destructive">{{ passwordError }}</p>
            <output v-if="passwordSuccess" class="text-xs text-green-600">Password updated successfully.</output>
            <button
              type="submit"
              :disabled="passwordSaving || !currentPassword || !newPassword || !confirmPassword"
              class="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {{ passwordSaving ? 'Updating…' : 'Update Password' }}
            </button>
          </form>
        </section>

      </div>
    </main>
  </div>
</template>
