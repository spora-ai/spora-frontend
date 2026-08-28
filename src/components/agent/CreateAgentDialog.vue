<script setup lang="ts">
/**
 * CreateAgentDialog — unified entry point for creating an agent.
 *
 * The wizard drives these modes:
 *   1. 'choice'    — three-card landing (Blank / From template / Upload)
 *   2. 'owner'     — pick who owns the agent (yourself, or one of your
 *                    groups). Skipped automatically when the caller
 *                    has no groups to target — flows directly from
 *                    'choice' to the chosen sub-mode in that case.
 *                    Also skipped when the store's `forcedPrincipalId`
 *                    is set (group page entry points) — the owner is
 *                    already decided.
 *   3. 'blank'     — a form (name required; description + system_prompt optional)
 *   4. 'template'  — gallery of built-in + plugin templates, grouped by source
 *   5. 'upload'    — single-file picker for a template JSON
 *   6. 'preview'   — warning preview for an imported template, then import
 *
 * Mounted once at the app root inside GlobalNavbar and driven by
 * {@link useCreateAgentDialogStore}. Any component can open it via
 * the store's open() action; the dialog re-opens in the requested
 * mode each time.
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import Icon from '@/components/ui/Icon.vue'
import { useCreateAgentDialogStore, type CreateAgentMode } from '@/stores/createAgentDialog'
import { useAgentStore } from '@/stores/agent'
import { useAgentTemplateStore } from '@/stores/agentTemplates'
import { useGroupsStore } from '@/stores/groups'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { ApiError } from '@/api/client'
import type { AgentTemplate, AgentTemplateSummary, TemplateWarning } from '@/types/agentTemplate'

const dialog = useCreateAgentDialogStore()
const agentStore = useAgentStore()
const templateStore = useAgentTemplateStore()
const groupsStore = useGroupsStore()
const authStore = useAuthStore()
const toast = useToast()
const router = useRouter()

const mode = computed<CreateAgentMode>({
  get: () => dialog.mode,
  set: (v) => dialog.setMode(v),
})
const isOpen = computed<boolean>({
  get: () => dialog.isOpen,
  set: (v) => {
    if (!v) dialog.close()
  },
})

// Reset transient state when the dialog opens. The companion
// `onMounted()` block below kicks off the groups fetch on the very
// first mount — Vue watchers don't fire on the initial value, so
// without that hook a user who opened the dialog before the router
// pre-fetch finished would land on an empty owner-step dropdown.
watch(isOpen, (open) => {
  if (open) {
    name.value = ''
    description.value = ''
    systemPrompt.value = ''
    // Seed the owner from the dialog's forced principal (group page
    // entry points) when one was set; otherwise default to 'Myself'.
    ownerPrincipalId.value = dialog.forcedPrincipalId
    pendingPath.value = null
    templateWarnings.value = []
    pendingTemplate.value = null
    if (dialog.forcedPrincipalId === null) {
      void loadGroupsIfNeeded()
    }
  }
})

// `pendingPath` remembers which sub-mode ('blank' | 'template' | 'upload')
// the caller picked on the 'choice' screen so the 'owner' step can route
// back to the right sub-mode after the owner is chosen. Reset to null on
// dialog re-open so it never leaks between sessions.
const pendingPath = ref<'blank' | 'template' | 'upload' | null>(null)
const ownerPrincipalId = ref<number | null>(null)
const ownerId = useId()

// Groups the caller can target as owner — admins see every group, non-
// admins see only groups they own/admin (server-side role filter on
// /api/v1/groups, so anything returned is fair game).
const ownerOptions = computed(() => {
  const self = authStore.user
    ? { value: null, label: `Myself (${authStore.user.email})` }
    : { value: null, label: 'Myself' }
  const groups = groupsStore.groups.map((g) => ({
    value: g.principal_id,
    label: g.name,
  }))
  return [self, ...groups]
})

// Has the caller any group to target? The 'owner' step only renders when
// there's a choice to make — if the only option is 'Myself' the wizard
// flows straight from 'choice' to the sub-mode. A forced principal
// (group page entry points) also bypasses the step: the owner is
// already decided.
const hasOwnerChoice = computed(
  () => dialog.forcedPrincipalId === null && ownerOptions.value.length > 1,
)

async function loadGroupsIfNeeded(): Promise<void> {
  if (groupsStore.groups.length > 0) return
  try {
    await groupsStore.fetchGroups()
  } catch {
    // Non-fatal: the owner step just won't render, the wizard goes
    // straight from 'choice' to the chosen sub-mode with ownerPrincipalId
    // staying null (i.e. user-owned).
  }
}

watch(mode, (m) => {
  if (m === 'choice') void loadGroupsIfNeeded()
})

function pickPath(next: 'blank' | 'template' | 'upload'): void {
  pendingPath.value = next
  if (hasOwnerChoice.value) {
    mode.value = 'owner'
  } else {
    ownerPrincipalId.value = null
    mode.value = next
  }
}

function confirmOwner(): void {
  if (pendingPath.value === null) {
    // Defensive: the 'owner' step is only rendered when pendingPath is
    // set, but guard so a stale state can't crash the wizard.
    mode.value = 'choice'
    return
  }
  mode.value = pendingPath.value
}

// --- Blank-agent form state -----------------------------------------
const name = ref('')
const description = ref('')
const systemPrompt = ref('')
const blankSubmitting = ref(false)
const nameId = useId()
const descriptionId = useId()
const systemPromptId = useId()

// Fire the groups fetch on first mount IF the dialog happens to be
// already open. The watcher above only sees isOpen transitions, not
// its initial value, so without this a caller who somehow opened the
// dialog on the first render (e.g. a future deep-link trigger) would
// land on the owner step with no groups. In the normal session-start
// flow, isOpen is false on mount and the fetch is driven by the
// watcher's transition to `true`. We also seed the owner from any
// forced principal here — group page entry points open the dialog
// before mounting, so the watcher wouldn't otherwise see the
// transition.
onMounted(() => {
  if (isOpen.value) {
    ownerPrincipalId.value = dialog.forcedPrincipalId
    if (dialog.forcedPrincipalId === null) {
      void loadGroupsIfNeeded()
    }
  }
})

async function submitBlank(): Promise<void> {
  const trimmedName = name.value.trim()
  if (!trimmedName) return
  blankSubmitting.value = true
  try {
    const descriptionValue = description.value.trim()
    const systemPromptValue = systemPrompt.value.trim()
    const created = await agentStore.createAgent({
      name: trimmedName,
      description: descriptionValue === '' ? undefined : descriptionValue,
      system_prompt: systemPromptValue === '' ? undefined : systemPromptValue,
      principal_id: ownerPrincipalId.value,
    })
    dialog.close()
    toast.success(`Agent '${created.name}' created.`)
    router.push({ name: 'agent', params: { id: created.id } })
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Failed to create agent.')
  } finally {
    blankSubmitting.value = false
  }
}

// --- Template-gallery state -----------------------------------------
// Reads the templates list from the store so the gallery and the
// "Create agent" entry point share a single source of truth.
const templatesLoading = ref(false)
const templatesError = ref<string | null>(null)

async function loadTemplates(): Promise<void> {
  if (templateStore.templates.length > 0) return
  templatesLoading.value = true
  templatesError.value = null
  try {
    await templateStore.fetchTemplates()
  } catch (e) {
    templatesError.value = e instanceof ApiError ? e.message : 'Failed to load templates.'
  } finally {
    templatesLoading.value = false
  }
}

watch(mode, (m) => {
  if (m === 'template') loadTemplates()
})

const groupedTemplates = computed(() => {
  const bySource = new Map<string, AgentTemplateSummary[]>()
  for (const t of templateStore.templates) {
    const list = bySource.get(t.source) ?? []
    list.push(t)
    bySource.set(t.source, list)
  }
  return Array.from(bySource.entries()).sort(([a], [b]) => {
    if (a === 'core') return -1
    if (b === 'core') return 1
    return a.localeCompare(b)
  })
})

// --- Template import state -----------------------------------------
const pendingTemplate = ref<AgentTemplate | null>(null)
const templateWarnings = ref<TemplateWarning[]>([])
const importSubmitting = ref(false)
const importError = ref<string | null>(null)

async function onTemplateSelected(summary: AgentTemplateSummary): Promise<void> {
  importError.value = null
  try {
    const show = await templateStore.getTemplate(summary.id)
    pendingTemplate.value = show.template
    const result = await templateStore.validatePayload(show.template)
    templateWarnings.value = [...result.errors, ...result.warnings]
    mode.value = 'preview'
  } catch (e) {
    importError.value = e instanceof ApiError ? e.message : 'Failed to load template.'
  }
}

async function confirmImport(): Promise<void> {
  if (!pendingTemplate.value) return
  importSubmitting.value = true
  try {
    const result = await templateStore.importPayload(
      pendingTemplate.value,
      ownerPrincipalId.value,
    )
    const warningCount = result.warnings.length
    dialog.close()
    pendingTemplate.value = null
    templateWarnings.value = []
    toast.success(formatImportToast(result.agent.id, warningCount))
    router.push({ name: 'agent', params: { id: result.agent.id } })
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : 'Import failed.')
  } finally {
    importSubmitting.value = false
  }
}

function formatImportToast(agentId: number, warningCount: number): string {
  if (warningCount === 0) {
    return `Agent #${agentId} created.`
  }
  const suffix = warningCount === 1 ? 'warning' : 'warnings'
  return `Agent #${agentId} created (${warningCount} ${suffix}).`
}

// --- Upload state --------------------------------------------------
const fileInputId = useId()
const uploadError = ref<string | null>(null)
const uploadSubmitting = ref(false)

async function onFileChosen(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  // Guard against pathologically large payloads — agent templates are
  // small JSON documents; anything over 1 MB is almost certainly an
  // operator mistake (or a malicious file the validator would have to
  // reject anyway).
  if (file.size > 1_000_000) {
    uploadError.value = `File is too large (${(file.size / 1_000_000).toFixed(2)} MB). Max 1 MB.`
    target.value = ''
    return
  }
  uploadSubmitting.value = true
  uploadError.value = null
  try {
    const text = await file.text()
    const payload = JSON.parse(text) as AgentTemplate
    pendingTemplate.value = payload
    const result = await templateStore.validatePayload(payload)
    templateWarnings.value = [...result.errors, ...result.warnings]
    if (!result.valid) {
      uploadError.value = result.errors
        .map((e: TemplateWarning) => e.message)
        .join('; ')
      pendingTemplate.value = null
      return
    }
    mode.value = 'preview'
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : 'Failed to read template file.'
  } finally {
    uploadSubmitting.value = false
    target.value = ''
  }
}

// --- Mode navigation ----------------------------------------------
function pickMode(next: CreateAgentMode): void {
  if (next === 'choice') {
    // Reset to landing when the user backs out of a sub-mode.
    templateWarnings.value = []
    pendingTemplate.value = null
    uploadError.value = null
    pendingPath.value = null
  }
  mode.value = next
}

const modeTitle = computed(() => {
  switch (mode.value) {
    case 'owner':    return 'Pick an owner'
    case 'blank':    return 'New blank agent'
    case 'template': return 'Create agent from template'
    case 'upload':   return 'Import template'
    case 'preview':  return `Warnings — ${pendingTemplate.value?.name ?? 'template'}`
    case 'choice':
    default:         return 'Create agent'
  }
})

// Friendly label for the owner chosen on the 'owner' step (or null if
// none / defaulting to 'Myself'). Used in the preview banner so the
// caller sees which principal will own the imported agent before they
// commit. Kept in sync with ownerOptions to surface the same strings.
const ownerLabel = computed<string | null>(() => {
  const match = ownerOptions.value.find(
    (opt) => opt.value === ownerPrincipalId.value,
  )
  return match?.label ?? null
})
</script>

<template>
  <Modal
    :model-value="isOpen"
    :title="modeTitle"
    size="lg"
    @update:model-value="(v: boolean) => { if (!v) dialog.close() }"
  >
    <!-- LANDING: three cards --------------------------------------- -->
    <div v-if="mode === 'choice'" class="flex flex-col gap-5">
      <p class="text-sm text-muted-foreground">
        Pick how you'd like to start. You can always tweak tools and
        the system prompt afterwards.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          type="button"
          class="text-left rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors flex flex-col gap-3"
          @click="pickPath('blank')"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="plus" class="h-5 w-5" />
          </div>
          <div>
            <div class="text-sm font-semibold">Blank agent</div>
            <p class="text-xs text-muted-foreground mt-1">
              Start from a name and an optional system prompt. Tools can
              be added in the next step.
            </p>
          </div>
        </button>

        <button
          type="button"
          class="text-left rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors flex flex-col gap-3"
          @click="pickPath('template')"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Icon name="layout-template" class="h-5 w-5" />
          </div>
          <div>
            <div class="text-sm font-semibold">From template</div>
            <p class="text-xs text-muted-foreground mt-1">
              Browse curated agents shipped with spora-core and installed
              plugins. One click to set up.
            </p>
          </div>
        </button>

        <button
          type="button"
          class="text-left rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors flex flex-col gap-3"
          @click="pickPath('upload')"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Icon name="upload" class="h-5 w-5" />
          </div>
          <div>
            <div class="text-sm font-semibold">Upload template</div>
            <p class="text-xs text-muted-foreground mt-1">
              Import a template <code>.json</code> file you downloaded
              from another Spora instance.
            </p>
          </div>
        </button>
      </div>
    </div>

    <!-- OWNER PICKER (skipped when caller has no groups or when a
         forced principal locks the owner — group page entry points). -->
    <div v-else-if="mode === 'owner' && dialog.forcedPrincipalId === null" class="flex flex-col gap-4">
      <button
        type="button"
        class="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="pickMode('choice')"
      >
        <Icon name="chevron-left" class="h-3.5 w-3.5" />
        Back
      </button>

      <div class="flex flex-col gap-1.5">
        <label :for="ownerId" class="text-sm font-medium">
          Who owns this agent?
        </label>
        <select
          :id="ownerId"
          v-model="ownerPrincipalId"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option v-for="opt in ownerOptions" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</option>
        </select>
        <p class="text-xs text-muted-foreground">
          Group-owned agents can be run by any member of the group; user-owned
          agents are private to you.
        </p>
      </div>
    </div>

    <!-- BLANK FORM ------------------------------------------------ -->
    <form
      v-else-if="mode === 'blank'"
      class="flex flex-col gap-4"
      @submit.prevent="submitBlank"
    >
      <button
        type="button"
        class="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="pickMode('choice')"
      >
        <Icon name="chevron-left" class="h-3.5 w-3.5" />
        Back
      </button>

      <div class="flex flex-col gap-1.5">
        <label :for="nameId" class="text-sm font-medium">
          Name <span class="text-destructive">*</span>
        </label>
        <input
          :id="nameId"
          v-model="name"
          type="text"
          required
          maxlength="100"
          placeholder="e.g. Research Assistant"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          autofocus
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label :for="descriptionId" class="text-sm font-medium">
          Description <span class="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          :id="descriptionId"
          v-model="description"
          type="text"
          maxlength="2000"
          placeholder="Short tagline shown in the agent list"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label :for="systemPromptId" class="text-sm font-medium">
          System prompt <span class="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          :id="systemPromptId"
          v-model="systemPrompt"
          rows="5"
          placeholder="Tell the agent what it is, who it serves, and how to behave. Leave blank to start without one."
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
        />
        <p class="text-xs text-muted-foreground">
          You can refine this in the agent's settings after creation.
        </p>
      </div>
    </form>

    <!-- TEMPLATE GALLERY ----------------------------------------- -->
    <div v-else-if="mode === 'template'" class="flex flex-col gap-4">
      <button
        type="button"
        class="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="pickMode('choice')"
      >
        <Icon name="chevron-left" class="h-3.5 w-3.5" />
        Back
      </button>

      <p
        v-if="templatesError"
        role="alert"
        class="text-xs text-destructive"
      >{{ templatesError }}</p>

      <div v-if="templatesLoading && templateStore.templates.length === 0" class="text-sm text-muted-foreground">
        Loading templates…
      </div>
      <div v-else-if="!templatesLoading && templateStore.templates.length === 0" class="text-sm text-muted-foreground">
        No templates available. Install a plugin or ship one with spora-core.
      </div>

      <div v-else class="flex flex-col gap-5 max-h-[55vh] overflow-y-auto pr-1">
        <section v-for="[source, items] in groupedTemplates" :key="source">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {{ source === 'core' ? 'Core' : source }}
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              v-for="t in items"
              :key="t.id"
              type="button"
              :disabled="templatesLoading"
              class="text-left rounded-lg border border-border bg-card p-4 hover:border-primary/50 disabled:opacity-50 transition-colors"
              @click="onTemplateSelected(t)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-sm font-semibold truncate">{{ t.name }}</div>
                  <div class="text-xs text-muted-foreground mt-0.5">{{ t.id }} · v{{ t.version }}</div>
                </div>
                <span
                  v-if="t.has_warnings"
                  class="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-amber-600 dark:text-amber-400"
                >
                  <Icon name="alert-triangle" class="h-3.5 w-3.5" />
                  {{ t.required_plugins.length }}
                </span>
              </div>
              <p v-if="t.description" class="text-xs text-muted-foreground mt-2 line-clamp-2">
                {{ t.description }}
              </p>
              <div class="mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                {{ t.tools_count }} tool{{ t.tools_count === 1 ? '' : 's' }}
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>

    <!-- UPLOAD ---------------------------------------------------- -->
    <div v-else-if="mode === 'upload'" class="flex flex-col gap-4">
      <button
        type="button"
        class="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="pickMode('choice')"
      >
        <Icon name="chevron-left" class="h-3.5 w-3.5" />
        Back
      </button>

      <p class="text-sm text-muted-foreground">
        Pick a template <code>.json</code> file. We'll validate it
        and surface any missing plugins or settings before creating
        the agent.
      </p>

      <p
        v-if="uploadError"
        role="alert"
        class="text-xs text-destructive"
      >{{ uploadError }}</p>

      <div class="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-8 text-center">
        <Icon name="upload" class="h-8 w-8 text-muted-foreground" />
        <label
          :for="fileInputId"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 cursor-pointer"
        >
          Choose file…
        </label>
        <input
          :id="fileInputId"
          ref="fileInputRef"
          type="file"
          accept="application/json,.json,.yaml,.yml,text/yaml,application/x-yaml"
          class="sr-only"
          @change="onFileChosen"
        />
        <p class="text-xs text-muted-foreground">
          File is read locally — never uploaded to a server.
        </p>
      </div>
    </div>

    <!-- PREVIEW (template picked or file uploaded) ----------------- -->
    <div v-else-if="mode === 'preview'" class="flex flex-col gap-4">
      <button
        type="button"
        class="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="pickMode('choice')"
      >
        <Icon name="chevron-left" class="h-3.5 w-3.5" />
        Back
      </button>

      <div v-if="ownerLabel" class="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
        Owner: <span class="font-medium">{{ ownerLabel }}</span>
      </div>

      <div v-if="templateWarnings.length === 0" class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
        <div class="font-semibold text-emerald-700 dark:text-emerald-300">Ready to import</div>
        <p class="text-xs text-muted-foreground mt-0.5">
          This template has no outstanding warnings.
        </p>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="w in templateWarnings"
          :key="w.message"
          class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
        >
          <div class="font-semibold text-amber-700 dark:text-amber-300 text-xs uppercase tracking-wide">
            {{ w.code }}
          </div>
          <div class="text-sm mt-0.5">{{ w.message }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          v-if="mode === 'choice'"
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          @click="dialog.close()"
        >
          Close
        </button>

        <button
          v-else-if="mode === 'owner'"
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          @click="confirmOwner"
        >
          Continue
        </button>

        <button
          v-else-if="mode === 'blank'"
          type="button"
          :disabled="blankSubmitting || !name.trim()"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          @click="submitBlank"
        >
          {{ blankSubmitting ? 'Creating…' : 'Create agent' }}
        </button>

        <button
          v-else-if="mode === 'preview'"
          type="button"
          :disabled="importSubmitting"
          class="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
          @click="confirmImport"
        >
          {{ importSubmitting ? 'Importing…' : templateWarnings.length === 0 ? 'Import' : 'Import anyway' }}
        </button>

        <button
          v-else
          type="button"
          class="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          @click="dialog.close()"
        >
          Close
        </button>
      </div>
    </template>
  </Modal>
</template>