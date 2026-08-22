<script setup lang="ts">
/**
 * GroupSettingsPage — picture + name + description form + danger zone.
 *
 * Owner + admin can edit. Member-only sees a read-only view of the
 * group name, description, and picture. Danger zone (transfer + delete)
 * is owner only — see `<GroupDangerZone>` for the visibility check.
 *
 * Mirrors `AgentSettingsPage`: the picture picker is a sibling section
 * above the identity form, not a modal opened from the overview. The
 * previous overview-modal approach had a self-closing `@vue:mounted`
 * listener (a hack) and the picker never actually opened in practice.
 */
import { computed, ref, watch } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError } from '@/api/client'
import GroupDangerZone from '@/components/groups/GroupDangerZone.vue'
import GroupProfilePictureSection from '@/components/groups/GroupProfilePictureSection.vue'

const detailStore = useGroupDetailStore()
const authStore = useAuthStore()
const toast = useToast()

const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

const form = ref<{ name: string; description: string }>({ name: '', description: '' })
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
    })
    savedFlash.value = true
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { savedFlash.value = false }, 2000)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to update group.')
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
  return formName !== savedName || formDesc !== savedDesc
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-lg font-semibold">Settings</h1>
      <p class="text-sm text-muted-foreground mt-0.5">
        Update the group's metadata or perform destructive actions.
      </p>
    </div>

    <div v-if="savedFlash" role="alert" class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
      Group settings saved.
    </div>

    <section v-if="detailStore.group">
      <h2 class="text-sm font-semibold mb-3">Picture</h2>
      <div class="rounded-xl border border-border bg-card p-5">
        <GroupProfilePictureSection :group="detailStore.group" :group-id="detailStore.group.id" />
      </div>
    </section>

    <section>
      <h2 class="text-sm font-semibold mb-3">Profile</h2>
      <form @submit.prevent="submit" class="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label for="group-settings-name" class="text-sm font-medium">Name</label>
          <input
            id="group-settings-name"
            v-model="form.name"
            type="text"
            required
            :disabled="!canEdit"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="group-settings-description" class="text-sm font-medium">Description</label>
          <textarea
            id="group-settings-description"
            v-model="form.description"
            rows="3"
            :disabled="!canEdit"
            placeholder="Optional"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
        </div>
        <div class="flex items-center justify-end gap-2">
          <span v-if="!canEdit" class="text-xs text-muted-foreground mr-auto">
            You need owner or admin role to edit this group.
          </span>
          <button
            type="submit"
            :disabled="!canEdit || saving || !dirty"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
          >
            {{ saving ? 'Saving…' : 'Save Changes' }}
          </button>
        </div>
      </form>
    </section>

    <section v-if="detailStore.group">
      <h2 class="text-sm font-semibold mb-3">Danger zone</h2>
      <GroupDangerZone :group="detailStore.group" />
    </section>
  </div>
</template>
