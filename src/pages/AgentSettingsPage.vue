<script setup lang="ts">
/**
 * AgentSettingsPage — agent configuration. Route: /agents/:id/settings.
 *
 * A thin layout shell that fetches the agent, then delegates the sections
 * (Identity, LLM, Speech, Profile Picture, Notes, Ownership, API Keys, Danger
 * Zone) to focused sub-components. Tool configuration lives on its own page at
 * /agents/:id/tools (AgentToolsPage).
 *
 * Sections are anchored and reachable from `SettingsSectionNav`. The anchor ids
 * are plain `id` attributes on the child components, which Vue falls through to
 * each one's root element — so the sections themselves need no knowledge that
 * they are linkable.
 *
 * Post-delete redirect: when the danger-zone child deletes the agent, the store
 * clears `currentAgent`. Watching that state change is more reliable than
 * listening to the child's `@deleted` event — the child unmounts in the same
 * microtask window as the store mutation, and the listener can be detached
 * before the parent's `onDeleted` runs. A state-driven watch fires regardless of
 * component-lifecycle ordering.
 */
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import { useLlmPreferencesStore } from '@/stores/llmPreferencesStore'
import { useFeatureEnabled } from '@/composables/useFeatureEnabled'
import { useToast } from '@/composables/useToast'
import AgentLayout from '@/components/layout/AgentLayout.vue'
import SettingsSectionNav, {
  type SettingsSectionLink,
} from '@/components/agent/settings/SettingsSectionNav.vue'
import AgentIdentitySection from '@/components/agent/settings/AgentIdentitySection.vue'
import AgentLlmSection from '@/components/agent/settings/AgentLlmSection.vue'
import AgentToolsSpeechSection from '@/components/agent/settings/AgentToolsSpeechSection.vue'
import AgentProfilePictureSection from '@/components/agent/settings/AgentProfilePictureSection.vue'
import AgentNotesSection from '@/components/agent/settings/AgentNotesSection.vue'
import AgentOwnershipSection from '@/components/agent/settings/AgentOwnershipSection.vue'
import AgentApiKeysSection from '@/components/agent/settings/AgentApiKeysSection.vue'
import AgentDangerZone from '@/components/agent/settings/AgentDangerZone.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const agentStore = useAgentStore()
const llmConfigsStore = useLlmConfigsStore()
const preferenceStore = useLlmPreferencesStore()
const featureEnabled = useFeatureEnabled('agent_api')
const toast = useToast()

const agentId = computed(() => Number(route.params.id))

/**
 * The nav order and the template's fall-through `id`s are two declarations of
 * the same thing, and a pill renders fine against an id nothing renders — so
 * they have to be edited together. `AgentSettingsPage.sections.spec.ts` pins one
 * against the other.
 *
 * API keys is omitted here when the feature is off, so the nav does not
 * advertise a section it is not linking to. The section itself stays rendered:
 * keys must remain listable and revocable whether or not the API is mounted.
 */
const sections = computed<SettingsSectionLink[]>(() => [
  { id: 'identity', label: t('Identity') },
  { id: 'llm', label: t('LLM') },
  { id: 'speech', label: t('Speech') },
  { id: 'picture', label: t('Picture') },
  { id: 'notes', label: t('Notes') },
  { id: 'ownership', label: t('Owner') },
  ...(featureEnabled.value ? [{ id: 'api-keys', label: t('API keys') }] : []),
  { id: 'danger', label: t('Danger Zone') },
])

onMounted(async () => {
  await Promise.all([
    agentStore.fetchAgents(),
    agentStore.fetchAgent(agentId.value),
    llmConfigsStore.ensure(),
    preferenceStore.loadPreference(),
  ])
})

watch(
  () => agentStore.currentAgent,
  (newAgent, oldAgent) => {
    if (oldAgent !== null && newAgent === null) {
      toast.success(t('Agent deleted'))
      void router.push({ name: 'dashboard' })
    }
  },
)
</script>

<template>
  <AgentLayout :agent-id="agentId">
    <div
      v-if="!agentStore.currentAgent"
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground"
    >
      {{ t('Loading…') }}
    </div>

    <main
      v-else
      class="flex-1 py-8 px-6 flex flex-col gap-8"
    >
      <SettingsSectionNav :sections="sections" />

      <!-- `id` falls through to each child's root section, which is what the
           nav anchors and `scroll-mt` offset target. -->
      <div class="flex flex-col gap-8">
        <AgentIdentitySection
          id="identity"
          class="scroll-mt-24"
          :agent="agentStore.currentAgent"
          :agent-id="agentId"
        />
        <AgentLlmSection
          id="llm"
          class="scroll-mt-24"
          :agent="agentStore.currentAgent"
          :agent-id="agentId"
        />
        <AgentToolsSpeechSection
          id="speech"
          class="scroll-mt-24"
          :agent="agentStore.currentAgent"
          :agent-id="agentId"
        />
        <AgentProfilePictureSection
          id="picture"
          class="scroll-mt-24"
          :agent="agentStore.currentAgent"
          :agent-id="agentId"
        />
        <AgentNotesSection
          id="notes"
          class="scroll-mt-24"
          :agent="agentStore.currentAgent"
          :agent-id="agentId"
        />
        <AgentOwnershipSection
          id="ownership"
          class="scroll-mt-24"
          :agent="agentStore.currentAgent"
        />
        <AgentApiKeysSection
          id="api-keys"
          class="scroll-mt-24"
          :agent-id="agentId"
        />
        <AgentDangerZone
          id="danger"
          class="scroll-mt-24"
          :agent="agentStore.currentAgent"
          :agent-id="agentId"
        />
      </div>
    </main>
  </AgentLayout>
</template>
