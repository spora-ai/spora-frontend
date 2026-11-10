<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import GlobalNavbar from '@/components/GlobalNavbar.vue'
import LocationsSection from '@/components/shared/LocationsSection.vue'
import { ApiError, api } from '@/api/client'
import { emptyProfile, type UserProfile } from '@/composables/useProfileSettings'
import { useFlashFlag } from '@/composables/useFlashFlag'
import type { Location, LocationPayload } from '@/types/location'

// Profile form

const { t } = useI18n()

const profile = ref<UserProfile>(emptyProfile())
const profileLoading = ref(false)
const profileSaving = ref(false)
const profileError = ref<string | null>(null)
const profileSuccess = useFlashFlag()
const healthSuccess = useFlashFlag()


const locations = ref<Location[]>([])
const locationsLoading = ref(false)
const locationsError = ref<string | null>(null)

async function createLocation(payload: LocationPayload): Promise<void> {
  locationsError.value = null
  try {
    const created = await api.post<Location>('/me/locations', payload)
    // The server demotes the previous default; the list has to show that,
    // or two rows carry the badge until the next reload.
    locations.value = [
      ...locations.value.map((l) => (created.is_default ? { ...l, is_default: false } : l)),
      created,
    ]
  } catch (e) {
    locationsError.value = e instanceof ApiError ? e.message : t('Failed to save location.')
    throw e
  }
}

async function updateLocation(locationId: number, payload: LocationPayload): Promise<void> {
  locationsError.value = null
  try {
    const updated = await api.put<Location>(`/me/locations/${locationId}`, payload)
    locations.value = locations.value.map((l) => {
      if (l.id === locationId) return updated
      return updated.is_default ? { ...l, is_default: false } : l
    })
  } catch (e) {
    locationsError.value = e instanceof ApiError ? e.message : t('Failed to save location.')
    throw e
  }
}

async function deleteLocation(locationId: number): Promise<void> {
  locationsError.value = null
  try {
    await api.delete(`/me/locations/${locationId}`)
    locations.value = locations.value.filter((l) => l.id !== locationId)
  } catch (e) {
    locationsError.value = e instanceof ApiError ? e.message : t('Failed to delete location.')
  }
}

// Load data

onMounted(async () => {
  profileLoading.value = true
  locationsLoading.value = true

  try {
    const [profileRes, locationsRes] = await Promise.all([
      api.get<UserProfile>('/me/profile'),
      api.get<{ locations: Location[] }>('/me/locations'),
    ])

    profile.value = profileRes
    locations.value = locationsRes.locations ?? []
  } catch (e) {
    profileError.value = e instanceof ApiError ? e.message : t('Failed to load profile.')
    locationsError.value = e instanceof ApiError ? e.message : t('Failed to load locations.')
  } finally {
    profileLoading.value = false
    locationsLoading.value = false
  }
})

// Save profile

async function saveProfile(): Promise<void> {
  profileSaving.value = true
  profileError.value = null
  profileSuccess.hide()
  try {
    const res = await api.put<UserProfile>('/me/profile', profile.value)
    profile.value = res
    profileSuccess.show(3000)
  } catch (e) {
    profileError.value = e instanceof ApiError ? e.message : t('Failed to save profile.')
  } finally {
    profileSaving.value = false
  }
}

async function saveHealthData(): Promise<void> {
  profileSaving.value = true
  profileError.value = null
  healthSuccess.hide()
  try {
    const res = await api.put<UserProfile>('/me/profile', profile.value)
    profile.value = res
    healthSuccess.show(3000)
  } catch (e) {
    profileError.value = e instanceof ApiError ? e.message : t('Failed to save health data.')
  } finally {
    profileSaving.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <GlobalNavbar />
    <main class="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-lg font-semibold">
          {{ t('Profile') }}
        </h1>
      </div>
      <div class="space-y-6">
        <section class="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {{ t('Base Data') }}
          </h3>
          <div
            v-if="profileLoading"
            class="text-sm text-muted-foreground"
          >
            {{ t('Loading…') }}
          </div>
          <div
            v-else
            class="space-y-3"
          >
            <div class="flex flex-col gap-1.5">
              <label
                for="profile-name"
                class="text-sm font-medium"
              >{{ t('Name for AI Agents') }}</label>
              <input
                id="profile-name"
                v-model="profile.name"
                type="text"
                :placeholder="t('How agents address you')"
                class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
              <p class="text-xs text-muted-foreground">
                {{ t('Personalizes how agents refer to you in conversations.') }}
              </p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                for="profile-dob"
                class="text-sm font-medium"
              >{{ t('Date of Birth') }}</label>
              <input
                id="profile-dob"
                v-model="profile.date_of_birth"
                type="date"
                class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                for="profile-about"
                class="text-sm font-medium"
              >{{ t('About Me') }}</label>
              <textarea
                id="profile-about"
                v-model="profile.about_me"
                rows="3"
                :placeholder="t('A short description about yourself…')"
                class="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div class="flex items-center justify-between">
              <p
                v-if="profileError"
                role="alert"
                class="text-xs text-destructive"
              >
                {{ profileError }}
              </p>
              <span
                v-else-if="profileSuccess.value"
                class="text-xs text-green-600"
              >{{ t('Saved!') }}</span>
              <span v-else />
              <button
                @click="saveProfile"
                :disabled="profileSaving"
                class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                type="button"
              >
                {{ profileSaving ? t('Saving…') : t('Save Base Data') }}
              </button>
            </div>
          </div>
        </section>

        <LocationsSection
          :locations="locations"
          :loading="locationsLoading"
          :error="locationsError"
          :create-location="createLocation"
          :update-location="updateLocation"
          @delete="deleteLocation"
        />

        <section class="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {{ t('Health Data') }}
          </h3>
          <div class="space-y-3">
            <div class="flex flex-col gap-1.5">
              <label
                for="health-height"
                class="text-sm font-medium"
              >{{ t('Height (cm)') }}</label>
              <input
                id="health-height"
                v-model="profile.height_cm"
                type="number"
                min="0"
                step="0.01"
                :placeholder="t('e.g. 175.5')"
                class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
            </div>
            <div class="flex flex-col gap-1.5">
              <label
                for="health-weight"
                class="text-sm font-medium"
              >{{ t('Weight (kg)') }}</label>
              <input
                id="health-weight"
                v-model="profile.weight_kg"
                type="number"
                min="0"
                step="0.01"
                :placeholder="t('e.g. 70.5')"
                class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
            </div>
            <div class="flex items-center justify-between">
              <p
                v-if="profileError"
                role="alert"
                class="text-xs text-destructive"
              >
                {{ profileError }}
              </p>
              <span
                v-else-if="healthSuccess.value"
                class="text-xs text-green-600"
              >{{ t('Saved!') }}</span>
              <span v-else />
              <button
                @click="saveHealthData"
                :disabled="profileSaving"
                class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                type="button"
              >
                {{ profileSaving ? t('Saving…') : t('Save Health Data') }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
