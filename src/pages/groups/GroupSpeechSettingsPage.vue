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
import { computed, onMounted, ref } from 'vue'
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

const canEdit = computed<boolean>(() => {
  if (authStore.user?.is_admin) return true
  return detailStore.group?.my_role === 'owner' || detailStore.group?.my_role === 'admin'
})

onMounted(async () => {
  if (groupId.value === 0) return
  try {
    await speechStore.loadForGroup(groupId.value)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to load speech provider configurations.')
  }
})

const groupConfigs = computed<SpeechProviderConfig[]>(() => speechStore.groupConfigs)

const viewMode = ref<ViewMode>('list')
// Hold the selected config directly so the form keeps rendering even
// when the freshly-created row hasn't made it into `speechStore.groupConfigs`
// yet (the create endpoint returns the row but the cache refresh is
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
      await speechStore.loadForGroup(groupId.value)
    }
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to refresh configurations.')
  }
}

async function onDeleted(): Promise<void> {
  toast.success('Speech provider configuration deleted.')
  cancel()
}

const saving = computed<boolean>(() => speechStore.saving)
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
