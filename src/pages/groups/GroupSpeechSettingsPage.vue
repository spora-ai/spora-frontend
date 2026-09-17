<script setup lang="ts">
/**
 * GroupSpeechSettingsPage — speech-to-text provider configurations
 * scoped to one group.
 *
 * Mirrors `GroupLlmDriversPage.vue`: list / create / edit / delete on
 * the same rows that back `/api/v1/speech/provider-configs` with
 * `scope: 'group'` + `?group_id=N`. Auth matches the LLM equivalent —
 * group admin OR global admin can write; everyone else sees a
 * read-only list.
 *
 * Routing: `/groups/:id/speech` — wired in `src/router/index.ts`. The
 * sub-nav entry lives in `GroupSubNav.vue` (edit-only).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useGroupDetailStore } from '@/stores/groupDetail'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError } from '@/api/client'
import SpeechProviderConfigList from '@/components/settings/speech/SpeechProviderConfigList.vue'
import SpeechProviderCreateForm from '@/components/settings/speech/SpeechProviderCreateForm.vue'
import SpeechProviderConfigForm from '@/components/settings/speech/SpeechProviderConfigForm.vue'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import type { SpeechProviderConfig } from '@/types/speechProviderConfig'

type ViewMode = 'list' | 'create' | 'edit'

const detailStore = useGroupDetailStore()
const speechStore = useSpeechProviderConfigsStore()
const authStore = useAuthStore()
const toast = useToast()

const groupId = computed<number>(() => detailStore.group?.id ?? 0)

// Per-group slot, keyed on the group's id. The page owns this slot
// exclusively — the user-slot lives separately, so navigating between
// groups doesn't leak rows across visits.
const groupSlot = computed(() => speechStore.getSlot(groupId.value))
const globalConfigs = computed<SpeechProviderConfig[]>(
  () => speechStore.getSlot('user').configs.filter((c) => c.scope === 'global'),
)

const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await speechStore.loadConfigsFor(groupId.value)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load speech provider configurations.')
  }
})

const viewMode = ref<ViewMode>('list')
// Hold the selected config directly so the form keeps rendering even
// when the freshly-created row hasn't made it into the group slot yet
// (the create endpoint returns the row but the cache refresh is
// async). Looking up by id alone loses the row during that window.
const selectedConfig = ref<SpeechProviderConfig | null>(null)

const selectedProviderSchema = computed(() => {
  const cfg = selectedConfig.value
  if (!cfg) return null
  return speechStore.providerByClass(cfg.provider_class) ?? null
})

function startCreate(): void {
  selectedConfig.value = null
  viewMode.value = 'create'
}

function openEdit(config: SpeechProviderConfig): void {
  selectedConfig.value = config
  viewMode.value = 'edit'
}

function cancel(): void {
  selectedConfig.value = null
  viewMode.value = 'list'
}

async function onCreated(config: SpeechProviderConfig): Promise<void> {
  toast.success('Speech provider configuration created.')
  openEdit(config)
}

async function onSaved(): Promise<void> {
  toast.success('Speech provider configuration updated.')
  try {
    if (groupId.value !== 0) {
      await speechStore.loadConfigsFor(groupId.value)
    }
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to refresh configurations.')
  }
}

async function onDeleted(): Promise<void> {
  toast.success('Speech provider configuration deleted.')
  // Refresh the cache BEFORE cancelling so the list view shows the
  // updated row count. Mirrors SpeechProviderConfigsPage.onDeleted.
  try {
    if (groupId.value !== 0) {
      await speechStore.loadConfigsFor(groupId.value)
    }
  } catch {
    // Load failure surfaces via store.error; we still navigate away so
    // the operator isn't stranded on the deleted row.
  }
  cancel()
}

const saving = computed<boolean>(() => speechStore.saving)

// Group-scope slice of the group's slot. The full slot also carries
// globals + the operator's user-scope rows the backend includes for
// every visit, but the list view shows only this group's rows.
const groupConfigs = computed<SpeechProviderConfig[]>(
  () => groupSlot.value.configs.filter((c) => c.scope === 'group'),
)

const preferredConfigId = ref<number | null>(
  groupSlot.value.preferredSpeech?.config_id ?? null,
)
// Keep the local select in sync with whatever the server returns from
// loadPreferenceFor(). The initial ref captures the value at setup
// time, which is `null` because the page hasn't called the preference
// endpoint yet — without this watcher the dropdown stays blank even
// when the operator already has a saved preference. `setPreferredSlot()`
// updates the named slot's `preferredSpeech` from the same code path
// that mutates `preferredConfigId`, so the watcher is a no-op for the
// user's own save.
watch(
  () => groupSlot.value.preferredSpeech?.config_id ?? null,
  (next) => {
    preferredConfigId.value = next
  },
)
const savingPreferred = ref(false)
const preferredCandidates = computed<SpeechProviderConfig[]>(
  () => [...groupConfigs.value, ...globalConfigs.value],
)

async function savePreferred(): Promise<void> {
  savingPreferred.value = true
  try {
    const updated = await speechStore.setPreferred({
      config_id: preferredConfigId.value,
      scope: 'group',
      group_id: groupId.value,
    })
    speechStore.setPreferredSlot(groupId.value, updated)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to save speech provider preference.')
  } finally {
    savingPreferred.value = false
  }
}
</script>

<template>
  <AdminForbidden
    v-if="!detailStore.group"
    message="Group is loading."
  />

  <div
    v-else-if="!canEdit && groupConfigs.length === 0"
    class="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center"
  >
    <p class="text-sm text-muted-foreground">
      This group has no speech provider configurations yet.
    </p>
    <p class="text-xs text-muted-foreground mt-1">
      A group admin can set one — its members will inherit it.
    </p>
  </div>

  <div
    v-else
    class="flex flex-col gap-4"
  >
    <div v-if="viewMode === 'list'">
      <!-- Preferred STT widget — group scope only. Mirrors the widget on
           SpeechProviderConfigsPage (user scope). The candidates are the
           group's own configs plus global configs; user-scope rows are
           scoped to a single user and don't surface here. -->
      <section
        class="mb-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 class="text-sm font-semibold">
          Preferred STT
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5 mb-3">
          Pick the speech-to-text class that wins the cascade for group
          members when no agent override is set. Falls back to the
          global default if unset.
        </p>
        <div class="flex items-center gap-3">
          <label
            for="group-preferred-stt-select"
            class="sr-only"
          >
            Preferred STT class for this group
          </label>
          <select
            id="group-preferred-stt-select"
            v-model.number="preferredConfigId"
            data-testid="group-preferred-stt-select"
            class="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option :value="null">
              — Use global default —
            </option>
            <option
              v-for="cfg in preferredCandidates"
              :key="cfg.id"
              :value="cfg.id"
            >
              {{ cfg.display_name }}{{ cfg.display_name !== cfg.provider_display_name && cfg.provider_display_name ? ` (${cfg.provider_display_name})` : '' }}
            </option>
          </select>
          <button
            type="button"
            :disabled="savingPreferred || preferredConfigId === (groupSlot.preferredSpeech?.config_id ?? null)"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            @click="savePreferred"
          >
            Save preference
          </button>
        </div>
      </section>

      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-lg font-semibold">
            Speech
          </h1>
          <p class="text-sm text-muted-foreground mt-0.5">
            Speech-to-text provider configurations for this group. Members inherit them automatically.
          </p>
        </div>
        <button
          v-if="canEdit"
          type="button"
          data-testid="group-speech-create"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          @click="startCreate"
        >
          + Add Configuration
        </button>
      </div>

      <p
        v-if="speechStore.error"
        role="alert"
        data-testid="group-speech-error"
        class="mb-3 text-xs text-destructive"
      >
        {{ speechStore.error }}
      </p>

      <SpeechProviderConfigList
        :scope="'group'"
        :principal-key="groupId"
        @select="openEdit"
        @create="startCreate"
      />
    </div>

    <div v-else-if="viewMode === 'create'">
      <SpeechProviderCreateForm
        :scope="'group'"
        :group-id="groupId"
        @created="onCreated"
        @cancel="cancel"
      />
    </div>

    <div v-else-if="viewMode === 'edit' && selectedConfig">
      <div v-if="!selectedProviderSchema && !speechStore.loadingProviders">
        <p class="text-sm text-muted-foreground mb-4">
          Provider class '{{ selectedConfig.provider_class }}' is no longer registered.
        </p>
        <button
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          @click="cancel"
        >
          ← Back
        </button>
      </div>
      <SpeechProviderConfigForm
        v-else-if="selectedProviderSchema"
        :key="selectedConfig.id"
        :provider="selectedProviderSchema"
        :config="selectedConfig"
        scope="group"
        :group-id="groupId"
        :saving="saving"
        @saved="onSaved"
        @deleted="onDeleted"
        @cancel="cancel"
      />
    </div>
  </div>
</template>
