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

function selectConfig(config: SpeechProviderConfig): void {
  selectedConfigId.value = config.id
  viewMode.value = 'edit'
  router.replace({
    name: props.scope === 'global' ? 'settings-admin-speech-providers' : 'settings-speech',
    query: { config: String(config.id) },
  })
}

function startCreate(): void {
  selectedConfigId.value = null
  viewMode.value = 'create'
  router.replace({
    name: props.scope === 'global' ? 'settings-admin-speech-providers' : 'settings-speech',
    query: { create: '1' },
  })
}

function onCreated(config: SpeechProviderConfig): void {
  selectedConfigId.value = config.id
  viewMode.value = 'edit'
  router.replace({
    name: props.scope === 'global' ? 'settings-admin-speech-providers' : 'settings-speech',
    query: { config: String(config.id) },
  })
}

function onDeleted(): void {
  selectedConfigId.value = null
  viewMode.value = 'list'
  router.replace({
    name: props.scope === 'global' ? 'settings-admin-speech-providers' : 'settings-speech',
  })
}

function cancel(): void {
  viewMode.value = 'list'
  selectedConfigId.value = null
  router.replace({
    name: props.scope === 'global' ? 'settings-admin-speech-providers' : 'settings-speech',
  })
}

const selectedProviderClass = computed<string | null>(
  () => selectedConfig.value?.provider_class ?? null,
)

const selectedProviderSchema = computed(() => {
  const className = selectedProviderClass.value
  if (!className) return null
  return store.providerByClass(className) ?? null
})
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

    <!-- List view -->
    <template v-if="viewMode === 'list'">
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
        @select="selectConfig"
        @create="startCreate"
      />
    </template>

    <!-- Create form -->
    <SpeechProviderCreateForm
      v-else-if="viewMode === 'create'"
      :scope="props.scope"
      @created="onCreated"
      @cancel="cancel"
    />

    <!-- Edit form -->
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
