<script setup lang="ts">
/**
 * SpeechProviderCreateForm — provider-class picker that hands off to
 * SpeechProviderConfigForm for the chosen class.
 *
 * The picker renders one card per known provider class (OpenAI
 * Compatible, Meta Muse, etc.) sourced from
 * `GET /speech/provider-configs/schema`. After the operator picks a
 * class, the same form component used in edit mode renders the schema
 * fields. Submission is delegated to the store's `upsert` action — the
 * store handles cache invalidation and returns the new config.
 */
import { ref, computed } from 'vue'
import { useSpeechProviderConfigsStore } from '@/stores/speechProviderConfigs'
import SpeechProviderConfigForm from './SpeechProviderConfigForm.vue'
import type {
  SpeechProviderClassSchema,
  SpeechProviderConfig,
  SpeechProviderScope,
} from '@/types/speechProviderConfig'

const props = defineProps<{
  scope: SpeechProviderScope
}>()

const emit = defineEmits<{
  created: [config: SpeechProviderConfig]
  cancel: []
}>()

const store = useSpeechProviderConfigsStore()

const selectedProvider = ref<SpeechProviderClassSchema | null>(null)

const availableProviders = computed<SpeechProviderClassSchema[]>(() => store.providers)

function pickProvider(provider: SpeechProviderClassSchema): void {
  selectedProvider.value = provider
}

function back(): void {
  selectedProvider.value = null
}

async function onSaved(config: SpeechProviderConfig): Promise<void> {
  emit('created', config)
}
</script>

<template>
  <div class="mb-6">
    <button
      type="button"
      @click="emit('cancel')"
      class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      ← All configurations
    </button>
    <h1 class="text-lg font-semibold">
      New Speech Provider Configuration
    </h1>
    <p class="text-sm text-muted-foreground mt-0.5">
      Pick a provider class to configure.
    </p>
  </div>

  <!-- Provider picker -->
  <div v-if="!selectedProvider">
    <div
      v-if="store.loadingProviders"
      class="text-sm text-muted-foreground py-8 text-center"
    >
      Loading providers…
    </div>

    <div
      v-else-if="availableProviders.length === 0"
      class="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground"
    >
      No speech provider classes are registered.
    </div>

    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      <button
        v-for="provider in availableProviders"
        :key="provider.class"
        type="button"
        @click="pickProvider(provider)"
        class="rounded-xl border border-border bg-card p-5 text-left hover:border-primary/50 hover:bg-muted/50 transition-colors"
      >
        <p class="text-sm font-semibold">
          {{ provider.display_name }}
        </p>
        <p class="text-xs text-muted-foreground mt-1 font-mono break-all">
          {{ provider.class }}
        </p>
        <p class="text-xs text-muted-foreground mt-2">
          {{ provider.settings_schema.length }} settings
        </p>
      </button>
    </div>
  </div>

  <!-- Form for the chosen class -->
  <div v-else>
    <button
      type="button"
      @click="back"
      class="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      ← Pick a different provider
    </button>
    <SpeechProviderConfigForm
      :provider="selectedProvider"
      :config="null"
      :scope="props.scope"
      @saved="onSaved"
      @cancel="back"
    />
  </div>
</template>
