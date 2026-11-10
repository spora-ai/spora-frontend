<script setup lang="ts">
/**
 * GroupSettingsPage — picture + name + description + information form +
 * locations + danger zone.
 *
 * Owner + admin can edit. Member-only sees a read-only view of the group name,
 * description, and picture. Danger zone (transfer + delete) is owner only —
 * see `<GroupDangerZone>` for the visibility check.
 *
 * Mirrors `AgentSettingsPage`: the picture picker is a sibling section above
 * the identity form, not a modal opened from the overview.
 */
import { computed, ref, watch } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError } from '@/api/client'
import GroupDangerZone from '@/components/groups/GroupDangerZone.vue'
import GroupProfilePictureSection from '@/components/groups/GroupProfilePictureSection.vue'
import GroupApiKeysSection from '@/components/groups/GroupApiKeysSection.vue'
import LocationsSection from '@/components/shared/LocationsSection.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import type { LocationPayload } from '@/types/location'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const detailStore = useGroupDetailStore()
const authStore = useAuthStore()
const toast = useToast()

const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

const groupId = computed<number>(() => detailStore.group?.id ?? 0)

const form = ref<{ name: string; description: string; information: string }>({
  name: '',
  description: '',
  information: '',
})
const saving = ref(false)
const savedFlash = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => detailStore.group,
  (group) => {
    if (group !== null) {
      form.value = {
        name: group.name,
        description: group.description ?? '',
        information: group.information ?? '',
      }
    }
  },
  { immediate: true },
)

async function submit(): Promise<void> {
  if (detailStore.group === null) return
  if (!dirty.value) return
  if (!form.value.name.trim()) return
  saving.value = true
  try {
    await detailStore.updateGroup(detailStore.group.id, {
      name: form.value.name.trim(),
      description: form.value.description || undefined,
      information: form.value.information,
    })
    savedFlash.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('Failed to update group.'))
  } finally {
    saving.value = false
  }
}

const dirty = computed<boolean>(() => {
  const group = detailStore.group
  if (group === null) return false
  const formName = form.value.name.trim()
  const savedName = group.name.trim()
  const formDesc = form.value.description.trim() || null
  const savedDesc = (group.description ?? '').trim() || null
  const formInfo = form.value.information.trim() || null
  const savedInfo = (group.information ?? '').trim() || null
  return formName !== savedName || formDesc !== savedDesc || formInfo !== savedInfo
})

/**
 * The store records a location failure in `locationsError` and the section
 * renders it, so the page only has to keep the rejection from escaping.
 */
function ignoreFailure(failure: Promise<unknown>): void {
  void failure.catch(() => undefined)
}

/**
 * The locations load when the group id becomes known, not on mount.
 *
 * `GroupLayout` fetches the group detail in its own `onMounted`, and a child
 * component's `onMounted` runs first — so at mount time the store still has no
 * group and the id is still 0. Watching the id catches the group whenever it
 * arrives, and a second navigation to another group re-loads them.
 */
watch(
  groupId,
  (id) => {
    if (id === 0) return
    ignoreFailure(detailStore.fetchLocations(id))
  },
  { immediate: true },
)

async function createLocation(payload: LocationPayload): Promise<void> {
  await detailStore.createLocation(groupId.value, payload)
}

async function updateLocation(locationId: number, payload: LocationPayload): Promise<void> {
  await detailStore.updateLocation(groupId.value, locationId, payload)
}

function deleteLocation(locationId: number): void {
  ignoreFailure(detailStore.deleteLocation(groupId.value, locationId))
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-lg font-semibold">
        {{ t('Settings') }}
      </h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        {{ t('Update the group\'s metadata or perform destructive actions.') }}
      </p>
    </div>

    <div
      v-if="savedFlash"
      role="alert"
      class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
    >
      {{ t('Group settings saved.') }}
    </div>

    <section v-if="detailStore.group">
      <h2 class="text-sm font-semibold mb-3">
        {{ t('Picture') }}
      </h2>
      <div class="rounded-xl border border-border bg-card p-5">
        <GroupProfilePictureSection
          :group="detailStore.group"
          :group-id="detailStore.group.id"
        />
      </div>
    </section>

    <section>
      <h2 class="text-sm font-semibold mb-3">
        {{ t('Profile') }}
      </h2>
      <form
        @submit.prevent="submit"
        class="rounded-xl border border-border bg-card p-5 flex flex-col gap-4"
      >
        <div class="flex flex-col gap-1.5">
          <label
            for="group-settings-name"
            class="text-sm font-medium"
          >{{ t('Name') }}</label>
          <input
            id="group-settings-name"
            v-model="form.name"
            type="text"
            required
            :disabled="!canEdit"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label
            for="group-settings-description"
            class="text-sm font-medium"
          >{{ t('Description') }}</label>
          <textarea
            id="group-settings-description"
            v-model="form.description"
            rows="3"
            :disabled="!canEdit"
            :placeholder="t('Optional')"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label
            for="group-settings-information"
            class="text-sm font-medium"
          >{{ t('Group Information') }}</label>
          <MarkdownEditor
            id="group-settings-information"
            v-model="form.information"
            mode="full"
            :rows="6"
            :disabled="!canEdit"
            :placeholder="t('Anything your agents should know about this group — its address, how to reach it, its opening hours. Markdown is supported.')"
          />
        </div>
        <div class="flex items-center justify-end gap-2">
          <span
            v-if="!canEdit"
            class="text-xs text-muted-foreground mr-auto"
          >
            {{ t('You need owner or admin role to edit this group.') }}
          </span>
          <button
            type="submit"
            :disabled="!canEdit || saving || !dirty"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
          >
            {{ saving ? t('Saving…') : t('Save Changes') }}
          </button>
        </div>
      </form>
    </section>

    <LocationsSection
      v-if="detailStore.group"
      :locations="detailStore.locations"
      :can-edit="canEdit"
      :loading="detailStore.locationsLoading"
      :error="detailStore.locationsError"
      :create-location="createLocation"
      :update-location="updateLocation"
      @delete="deleteLocation"
    />

    <section v-if="detailStore.group && canEdit">
      <h2 class="text-sm font-semibold mb-3">
        {{ t('Developer access') }}
      </h2>
      <GroupApiKeysSection :group-id="detailStore.group.id" />
    </section>

    <section v-if="detailStore.group">
      <h2 class="text-sm font-semibold mb-3">
        {{ t('Danger zone') }}
      </h2>
      <GroupDangerZone :group="detailStore.group" />
    </section>
  </div>
</template>
