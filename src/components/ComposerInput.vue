<script setup lang="ts">
/**
 * ComposerInput — prompt composer with template selection, scheduling, media
 * attachments, and task submission. Used on the AgentPage to create new tasks.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentStore } from '@/stores/agent'
import { useLlmConfigsStore } from '@/stores/llmConfigs'
import { useLlmPreferencesStore } from '@/stores/llmPreferencesStore'
import { usePromptTemplatesStore } from '@/stores/promptTemplates'
import SharedScheduleEditor from '@/components/shared/ScheduleEditor/index.vue'
import PromptTemplateDialog from '@/components/PromptTemplateDialog.vue'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import MediaPickerOverlay from '@/components/MediaPickerOverlay.vue'
import type { MediaAsset } from '@/types/media'
import { isSubmitKeystroke } from '@/composables/useComposerInput'
import { useComposerSubmit } from '@/composables/useComposerSubmit'
import { useComposerTemplate } from '@/composables/useComposerTemplate'
import { useMediaAllowedTypes } from '@/composables/useMediaAllowedTypes'
import { usePlatform } from '@/composables/usePlatform'
import Icon from '@/components/ui/Icon.vue'
const props = defineProps<{
  agentId: number
  disabled?: boolean
}>()

const router = useRouter()
const agentStore = useAgentStore()
const llmConfigsStore = useLlmConfigsStore()
const preferenceStore = useLlmPreferencesStore()
const promptTemplatesStore = usePromptTemplatesStore()
const allowedTypes = useMediaAllowedTypes()

const currentLlmConfig = computed(() =>
  llmConfigsStore.configs.find(c => c.id === agentStore.currentAgent?.llm_driver_config_id)
)
const configName = computed(() => currentLlmConfig.value?.name ?? 'Custom LLM config')

const promptText = computed({
  get: () => agentStore.getComposerDraft(props.agentId).promptText,
  set: (value: string) => {
    agentStore.getComposerDraft(props.agentId).promptText = value
  },
})

const { submitShortcutHint } = usePlatform()

const showScheduleEditor = ref(false)

// Media attachments — both buttons (Attach file / Attach image) delegate
// selection to the MediaPickerOverlay below, which manages its own
// listing, search, upload, and selection state. The composer reads
// attachments from the agent store's per-agent draft so the chip list
// survives component remounts (e.g. leaving and returning to the page).
const attachedMedia = computed<MediaAsset[]>({
  get: () => agentStore.getComposerDraft(props.agentId).attachments,
  set: (value: MediaAsset[]) => {
    agentStore.getComposerDraft(props.agentId).attachments = value
  },
})
const showMediaPicker = ref(false)
const pickerMediaKind = ref<'image' | 'image+document'>('image+document')
const pickerAccept = ref('')
const uploadError = ref<string | null>(null)
// `fetchAgent()`. We surface three states so the button reflects the
// load lifecycle: `loading` while the agent detail has not resolved,
// `active` once it does and the effective LLM supports images, and
// `unsupported` when the resolved agent cannot accept images. The
// submit-time guard at `submitWithMedia` still defends against
// races where an image is attached after a LLM change.
type ImageSupport = 'loading' | 'active' | 'unsupported'
const { submitting, error: submitError, submit } = useComposerSubmit(props.agentId)
const imageSupport = computed<ImageSupport>(() => {
    const agent = agentStore.currentAgent
    if (agent === null) {
        return 'loading'
    }
    return agent.llm_supports_image_input === true ? 'active' : 'unsupported'
})
const supportsImages = computed<boolean>(() => imageSupport.value === 'active')
const imageButtonTitle = computed<string>(() => {
    switch (imageSupport.value) {
        case 'active':
            return 'Attach an image'
        case 'unsupported':
            return 'This LLM does not support image attachments'
        case 'loading':
            return 'Checking image support…'
    }
})
const template = useComposerTemplate(props.agentId, (v) => { promptText.value = v })
const composerError = computed(() => submitError.value || template.error.value || uploadError.value)

onMounted(async () => {
  try {
    await allowedTypes.load(props.agentId)
  } catch {
    // Allowed-types is best-effort — the upload affordance falls back to
    // a generic accept attribute if the request fails.
  }
})

// "Attach file" opens the picker with the full extension list supported by
// the agent. The picker re-issues an ownership-scoped `GET /media` request
// on open and lets the user either re-pick an existing asset or upload a new
// one inline.
function onUploadClick(): void {
  uploadError.value = null
  pickerMediaKind.value = 'image+document'
  pickerAccept.value = uploadAccept.value
  showMediaPicker.value = true
}

// "Attach image" → open the picker pre-filtered to images. The hidden
// file input inside the picker uses `allowedTypes.imageAccept()` so the
// OS file dialog only offers raster formats the agent's LLM accepts;
// serverside `MediaAllowedTypesService` still gates the upload.
function onImageUploadClick(): void {
  uploadError.value = null
  pickerMediaKind.value = 'image'
  pickerAccept.value = allowedTypes.imageAccept()
  showMediaPicker.value = true
}

// Picker committed — append all selected/uploaded assets to the
// chip list. The picker closes itself on emit so this stays one-way.
function onPickerAttach(assets: MediaAsset[]): void {
  attachedMedia.value = [...attachedMedia.value, ...assets]
}
function removeAttachment(id: string): void {
  attachedMedia.value = attachedMedia.value.filter(m => m.id !== id)
}

function isImageAsset(asset: MediaAsset): boolean {
  return (asset.media_type ?? '').toLowerCase() === 'image'
}

function onComposerKeydown(e: KeyboardEvent): void {
  if (isSubmitKeystroke(e)) {
    e.preventDefault()
    void submitWithMedia()
  }
}

async function submitWithMedia(): Promise<void> {
  if (attachedMedia.value.some(isImageAsset) && !supportsImages.value) {
    uploadError.value = 'This LLM does not support image attachments.'
    return
  }

  uploadError.value = null
  const mediaIds = attachedMedia.value.map(m => m.id)
  await submit(promptText.value, mediaIds)
  if (submitError.value === null) {
    attachedMedia.value = []
  }
}

function onScheduleSaved(): void {
  showScheduleEditor.value = false
  promptText.value = ''
  template.selectedTemplateId.value = null
  attachedMedia.value = []
}

const uploadAccept = computed(() => allowedTypes.extensionList() || '')
</script>

<template>
  <div class="px-6 py-6 border-b border-border border-b-2">
    <div class="relative flex flex-col w-full rounded-2xl border border-border bg-card shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary/20">

      <div class="flex items-center justify-between px-3 py-2 border-b border-muted bg-muted/20 rounded-t-2xl">
        <div class="flex items-center gap-2">
          <template v-if="promptTemplatesStore.templates.length > 0">
            <select
              aria-label="Choose a prompt template"
              v-model="template.selectedTemplateId.value"
              @change="template.onTemplateChange(template.selectedTemplateId.value)"
              class="h-8 rounded-[8px] border border-border bg-background px-3 pr-8 text-xs font-medium text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer"
            >
              <option :value="null">Choose a template…</option>
              <option v-for="tmpl in promptTemplatesStore.templates" :key="tmpl.id" :value="tmpl.id">
                {{ tmpl.name }}
              </option>
            </select>
          </template>

          <button
            v-if="template.selectedTemplateId.value"
            @click="template.deleteSelectedTemplate"
            class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Delete template"
            type="button"
          >
            <Icon name="trash" class="h-3.5 w-3.5" />
          </button>

          <button
            v-if="promptText.trim()"
            @click="template.openSaveDialog"
            class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Save prompt as template"
            type="button"
          >
            <Icon name="star" class="h-3.5 w-3.5" />
            <span>Save</span>
          </button>
        </div>

        <button
          @click="showScheduleEditor = true"
          class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors shadow-sm"
          title="Schedule a run"
          type="button"
        >
          <Icon name="clock" class="h-3 w-3" />
          Schedule
        </button>
      </div>

      <div class="px-2 pt-2 relative border-0">
        <MarkdownEditor
          v-model="promptText"
          mode="bubble"
          :rows="2"
          :auto-grow="true"
          :max-rows="15"
          :disabled="submitting || disabled"
          :placeholder="`Message this agent... ${submitShortcutHint}`"
          data-testid="composer-input"
          @keydown="onComposerKeydown"
        />

        <!-- Attachment chips -->
        <div v-if="attachedMedia.length > 0" class="flex flex-wrap gap-1.5 px-3 pt-2">
          <span
            v-for="m in attachedMedia"
            :key="m.id"
            class="inline-flex items-center gap-1.5 rounded-full bg-muted pl-1 pr-2 py-0.5 text-xs"
            :title="m.filename ?? m.id"
          >
            <img
              v-if="isImageAsset(m) && m.asset_url"
              :src="m.asset_url"
              :alt="m.filename ?? m.id"
              class="h-5 w-5 rounded-full object-cover"
            />
            <Icon v-else name="file" class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="max-w-[120px] truncate">{{ m.filename ?? m.id.slice(0, 8) }}</span>
            <button
              @click="removeAttachment(m.id)"
              class="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
              title="Remove attachment"
              type="button"
            >
              ×
            </button>
          </span>
        </div>

        <p v-if="composerError" role="alert" class="px-3 pb-2 text-xs text-destructive">{{ composerError }}</p>
      </div>

      <div class="flex items-center justify-between px-4 pb-3 pt-1">
        <div class="flex items-center gap-2">
          <button
            type="button"
            @click="onUploadClick"
            :disabled="submitting || disabled"
            :title="'Attach a file'"
            class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
            data-testid="composer-upload-file"
          >
            <Icon name="paperclip" class="h-3.5 w-3.5" />
            <span>Attach file</span>
          </button>
          <button
            type="button"
            @click="onImageUploadClick"
            :disabled="!supportsImages || submitting || disabled"
            :title="imageButtonTitle"
            class="inline-flex h-8 items-center gap-1.5 px-3 rounded-[8px] border border-border text-xs font-medium bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
            data-testid="composer-upload-image"
          >
            <Icon name="image" class="h-3.5 w-3.5" />
            <span>Attach image</span>
          </button>
        </div>
        <button
          @click="submitWithMedia"
          :disabled="submitting || !promptText.trim() || disabled"
          class="shrink-0 h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center z-10"
          type="button"
        >
          <Icon name="arrow-right" />
        </button>
      </div>
    </div>

    <template v-if="agentStore.currentAgent">
      <div class="px-4 pb-3 pt-1 flex flex-wrap items-center gap-3 text-[11px] font-medium text-muted-foreground">
        <button
          @click="router.push({ name: 'agent-settings', params: { id: agentId } })"
          class="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          title="Go to agent settings"
          type="button"
        >
          <Icon name="computer" class="h-3 w-3 shrink-0" />
          <span v-if="agentStore.currentAgent.llm_driver_config_id">
            {{ configName }}
          </span>
          <span v-else-if="preferenceStore.preference">
            {{ preferenceStore.preference.config.name }} (preferred)
          </span>
          <span v-else>
            Global default
          </span>
        </button>

        <button
          @click="router.push({ name: 'agent-settings', params: { id: agentId } })"
          class="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          title="Go to agent tools"
          type="button"
        >
          <Icon name="tools" class="h-3 w-3 shrink-0" />
          <span>{{ agentStore.currentAgent.tools.length }} tools</span>
        </button>

        <button
          @click="router.push({ name: 'agent-settings', params: { id: agentId } })"
          class="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          title="Go to agent settings"
          type="button"
        >
          <Icon name="zap" class="h-3 w-3 shrink-0" />
          <span>Max {{ agentStore.currentAgent.max_steps }} steps</span>
        </button>

        <span v-if="uploadAccept" class="text-[10px] text-muted-foreground/70">
          Allowed: {{ uploadAccept.replace(/\./g, '').replace(/,/g, ', ') }}
        </span>
      </div>
    </template>
  </div>

  <PromptTemplateDialog
    v-model="template.showSaveDialog.value"
    :agent-id="agentId"
    :initial-prompt="promptText"
    :existing-template-id="template.selectedTemplateId.value"
    @saved="template.onTemplateSaved"
  />

  <SharedScheduleEditor
    v-model="showScheduleEditor"
    :agentId="agentId"
    :initialData="template.selectedTemplateId.value !== null ? { template_id: template.selectedTemplateId.value, raw_prompt: promptText.trim() || undefined } : { raw_prompt: promptText.trim() || undefined }"
    @saved="onScheduleSaved"
    @closed="showScheduleEditor = false"
  />

  <MediaPickerOverlay
    v-model="showMediaPicker"
    :agent-id="agentId"
    :media-kind="pickerMediaKind"
    :accept="pickerAccept"
    @attach="onPickerAttach"
  />
</template>

<style scoped>
/* Scrollbar-hiding rules were removed when the textarea was replaced
 * with MarkdownEditor — the editor manages its own scrollbar. */
</style>
