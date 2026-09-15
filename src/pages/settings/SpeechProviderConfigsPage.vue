<script setup lang="ts">
/**
 * SpeechProviderConfigsPage — list / create / edit views for speech
 * provider configurations. Same page is mounted at `/settings/speech`
 * (caller's own user-scope) and `/admin/settings/speech-providers`
 * (admin's global-scope) with a different `scope` prop each.
 *
 * View mode is driven by query params so deep links like
 *   /settings/speech?create=1
 *   /settings/speech?config=7
 * land directly in the right view.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useToast } from '@/composables/useToast'
import SpeechProviderConfigList from '@/components/settings/speech/SpeechProviderConfigList.vue'
import SpeechProviderCreateForm from '@/components/settings/speech/SpeechProviderCreateForm.vue'
import SpeechProviderConfigForm from '@/components/settings/speech/SpeechProviderConfigForm.vue'
import AlertBanner from '@/components/ui/AlertBanner.vue'
import AdminForbidden from '@/components/admin/AdminForbidden.vue'
import type { SpeechProviderConfig, SpeechProviderScope } from '@/types/speechProviderConfig'

const props = defineProps<{
  scope: SpeechProviderScope
}>()

const route = useRoute()
const router = useRouter()
const store = useSpeechProviderConfigsStore()
const { isAdmin } = useAdminAuth()
const toast = useToast()

type ViewMode = 'list' | 'create' | 'edit'
const viewMode = ref<ViewMode>('list')
const selectedConfigId = ref<number | null>(null)

const visibleConfigs = computed<SpeechProviderConfig[]>(() =>
  props.scope === 'global' ? store.globalConfigs : store.personalConfigs,
)

const selectedConfig = computed<SpeechProviderConfig | null>(
  () => visibleConfigs.value.find((c) => c.id === selectedConfigId.value) ?? null,
)

// Apply query params to determine view mode. The list view is the
// default; ?create=1 jumps to create; ?config=<id> jumps to edit for
// that id (or list if the id doesn't exist on this scope).
function applyQueryParams(): void {
  const configParam = route.query.config
  const createParam = route.query.create

  if (createParam === '1') {
    viewMode.value = 'create'
    selectedConfigId.value = null
  } else if (configParam) {
    const id = Number(configParam)
    if (visibleConfigs.value.some((c) => c.id === id)) {
      selectedConfigId.value = id
      viewMode.value = 'edit'
    } else {
      viewMode.value = 'list'
      selectedConfigId.value = null
    }
  } else {
    viewMode.value = 'list'
    selectedConfigId.value = null
  }
}

onMounted(async () => {
  await store.ensure()
  applyQueryParams()
})

watch(
  () => [route.query.config, route.query.create],
  () => applyQueryParams(),
)

const scopeRouteName = computed(() =>
  props.scope === 'global' ? 'settings-admin-speech-providers' : 'settings-speech',
)

function startCreate(): void {
  selectedConfigId.value = null
  viewMode.value = 'create'
  router.replace({ name: scopeRouteName.value, query: { create: '1' } })
}

function openEditView(id: number): void {
  selectedConfigId.value = id
  viewMode.value = 'edit'
  router.replace({ name: scopeRouteName.value, query: { config: String(id) } })
}

function onDeleted(): void {
  toast.success(
    props.scope === 'global'
      ? 'Global speech provider deleted.'
      : 'Speech provider configuration deleted.',
  )
  void cancel()
}

// Vue Router 5.x preserves the current query when none is specified —
// passing `{ name }` from `?config=5` would land on `?config=5`. Pass
// an explicit empty `query` to force a clean list URL.
function cancel(): void {
  viewMode.value = 'list'
  selectedConfigId.value = null
  router.replace({ name: scopeRouteName.value, query: {} })
}

const selectedProviderClass = computed<string | null>(
  () => selectedConfig.value?.provider_class ?? null,
)

const selectedProviderSchema = computed(() => {
  const className = selectedProviderClass.value
  if (!className) return null
  return store.providerByClass(className) ?? null
})

const preferredConfigId = ref<number | null>(
  store.preferredSpeech?.config_id ?? null,
)
const savingPreferred = ref(false)
const preferredCandidates = computed<SpeechProviderConfig[]>(
  () => [...store.personalConfigs, ...store.globalConfigs],
)

async function savePreferred(): Promise<void> {
  savingPreferred.value = true
  try {
    const updated = await store.setPreferred({
      config_id: preferredConfigId.value,
      scope: 'user',
    })
    store.preferredSpeech = updated
  } catch {
    // The store's `error` ref carries the user-facing message; the
    // page-level AlertBanner surfaces it.
  } finally {
    savingPreferred.value = false
  }
}
</script>

<template>
  <AdminForbidden
    v-if="props.scope === 'global' && !isAdmin"
    message="Admin privileges are required to manage global speech provider configurations."
  />

  <template v-else>
    <AlertBanner
      v-if="store.error"
      type="error"
      :message="store.error"
      class="mb-4"
    />

    <template v-if="viewMode === 'list'">
      <!-- Preferred STT widget — user scope only. Group and global pages
           have their own scope-aware widgets (see GroupSpeechSettingsPage
           and the global admin page). The widget mirrors the "Preferred
           LLM" card on SettingsLLMPage.vue:107-135. -->
      <section
        v-if="props.scope === 'user'"
        class="mb-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 class="text-sm font-semibold">
          Preferred STT
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5 mb-3">
          Pick the speech-to-text class that wins the cascade when no
          agent override is set. Falls back to the global default if
          unset.
        </p>
        <div class="flex items-center gap-3">
          <label
            for="preferred-stt-select"
            class="sr-only"
          >
            Preferred STT class
          </label>
          <select
            id="preferred-stt-select"
            v-model.number="preferredConfigId"
            data-testid="preferred-stt-select"
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
            :disabled="savingPreferred || preferredConfigId === (store.preferredSpeech?.config_id ?? null)"
            class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            @click="savePreferred"
          >
            Save preference
          </button>
        </div>
      </section>

      <div class="mb-6">
        <h1 class="text-lg font-semibold">
          <template v-if="props.scope === 'global'">
            Speech Providers
          </template>
          <template v-else>
            Speech
          </template>
        </h1>
        <p class="text-sm text-muted-foreground mt-0.5">
          <template v-if="props.scope === 'global'">
            Manage global speech-to-text provider configurations.
          </template>
          <template v-else>
            Configure your personal speech-to-text provider override.
          </template>
        </p>
      </div>
      <SpeechProviderConfigList
        :scope="props.scope"
        @select="(c: SpeechProviderConfig) => openEditView(c.id)"
        @create="startCreate"
      />
    </template>

    <SpeechProviderCreateForm
      v-else-if="viewMode === 'create'"
      :scope="props.scope"
      @created="(c: SpeechProviderConfig) => openEditView(c.id)"
      @cancel="cancel"
    />

    <template v-else-if="viewMode === 'edit' && selectedConfig">
      <div v-if="!selectedProviderSchema && !store.loadingProviders">
        <AlertBanner
          type="error"
          :message="`Provider class '${selectedConfig.provider_class}' is no longer registered.`"
          class="mb-4"
        />
        <button
          type="button"
          @click="cancel"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
      </div>
      <SpeechProviderConfigForm
        v-else-if="selectedProviderSchema"
        :key="selectedConfig.id"
        :provider="selectedProviderSchema"
        :config="selectedConfig"
        :scope="props.scope"
        @saved="() => {}"
        @deleted="onDeleted"
        @cancel="cancel"
      />
    </template>
  </template>
</template>
