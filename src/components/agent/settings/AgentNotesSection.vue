<script setup lang="ts">
/**
 * AgentNotesSection — markdown notes attached to the agent.
 *
 * The notes field is also reachable from the agent itself via AgentTool
 * (read_notes / write_notes). Operator-side edits go through PATCH /agents/{id}.
 * Same form-state + save flow as AgentIdentitySection — only the payload
 * and field set differ.
 */
import { ref, useId, watch } from 'vue'
import { ApiError, api } from '@/api/client'
import {
  buildInitialIdentityForm,
  buildIdentityPayload,
  type IdentityForm,
} from '@/composables/useAgentSettingsForm'
import MarkdownEditor from '@/components/MarkdownEditor.vue'

interface Agent {
  id: number
  name: string
  notes?: string | null
}

const props = defineProps<{
  agent: Agent
  agentId: number
}>()

const form = ref<IdentityForm>(buildInitialIdentityForm(props.agent))
const saving = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)

// Per-instance id scope so this section's ids don't collide with
// AgentIdentitySection's (web:S1117).
const scope = useId()
const notesId = `${scope}-agent-notes`

watch(
  () => props.agent,
  (next) => {
    form.value = buildInitialIdentityForm(next)
  },
)

async function save(): Promise<void> {
  error.value = null
  saved.value = false
  saving.value = true
  try {
    await api.patch(`/agents/${props.agentId}`, buildIdentityPayload(form.value))
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Failed to save.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <h2 class="text-base font-semibold">Notes</h2>
      <p class="text-xs text-muted-foreground">
        Operator-facing markdown — runbooks, behaviour hints, or context the agent should remember.
        Also readable and writable by the agent itself via the <code class="text-xs">agent</code> tool's
        <code class="text-xs">read_notes</code> / <code class="text-xs">write_notes</code> operations.
      </p>
    </div>
    <div class="flex flex-col gap-1.5">
      <label :for="notesId" class="sr-only">Notes</label>
      <MarkdownEditor
        :id="notesId"
        v-model="form.notes"
        :rows="12"
        placeholder="Markdown notes (headings, lists, links)…"
      />
    </div>
    <div class="flex items-center justify-between">
      <p v-if="error" role="alert" data-testid="notes-error" class="text-xs text-destructive">{{ error }}</p>
      <span v-else-if="saved" data-testid="notes-saved" class="text-xs text-green-600 dark:text-green-400">Saved!</span>
      <span v-else />
      <button
        data-testid="save-notes"
        @click="save"
        :disabled="saving"
        class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        type="button"
      >
        {{ saving ? 'Saving…' : 'Save Notes' }}
      </button>
    </div>
  </section>
</template>
