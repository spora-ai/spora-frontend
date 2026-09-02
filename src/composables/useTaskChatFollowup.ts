/**
 * useTaskChatFollowup — follow-up prompt state + submit for TaskChatPage.
 *
 * Shown when the task is COMPLETED, FAILED, or ABORTED and the agent allows
 * continuation. Submits via `taskStore.continueTask` and restarts detail
 * polling on the RUNNING/COMPLETED source branch. The auto-abort path
 * (sending a message to a RUNNING task) routes through the same submission
 * entry point — Orchestrator::continue flips the status to ABORTED and
 * writes the user's prompt + a marker row in one transaction.
 *
 * Attachment state lives here (not on `agentStore` like the initial
 * composer draft) because follow-ups are per-task, not per-agent, and
 * the chat page navigates away from the agent detail view when the
 * user clicks into a task. Per-task persistence across reloads is
 * deliberately deferred (see the open question in
 * `spora-workspace/plans/follow-up-chat-attachments.md`).
 */
import { ref, computed } from 'vue'
import { useTaskStore } from '@/stores/tasks'
import { useAgentStore } from '@/stores/agent'
import { useMediaAllowedTypes } from '@/composables/useMediaAllowedTypes'
import { ApiError } from '@/api/client'
import type { MediaAsset } from '@/types/media'

/**
 * Reusable predicate exposed for templates that want to render their own
 * "send follow-up" affordance outside the standard follow-up bar.
 */
export function shouldShowFollowupBar(status: string | undefined): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'ABORTED'
}

export function useTaskChatFollowup() {
  const taskStore = useTaskStore()
  const agentStore = useAgentStore()
  const allowedTypes = useMediaAllowedTypes()

  const followupPrompt = ref('')
  const submittingFollowup = ref(false)
  const followupError = ref<string | null>(null)

  /**
   * Attachments staged for the next follow-up submission. Cleared on
   * successful submit (`clearOnSubmit` branch in `submitFollowup`).
   * Local state — see the file header for the per-task persistence
   * trade-off.
   */
  const attachedMedia = ref<MediaAsset[]>([])
  /** UI state for the `MediaPickerOverlay` modal. */
  const showMediaPicker = ref(false)
  /** Which kind of assets the picker is filtering to. */
  const pickerMediaKind = ref<'image' | 'image+document'>('image+document')
  /** Optional `accept` override forwarded to the picker's hidden file input. */
  const pickerAccept = ref('')
  /**
   * Pre-flight error surfaced in the same slot as `followupError` —
   * shown when the user tries to send an image on a non-vision LLM.
   * Kept separate from `followupError` so the upload-error toast
   * doesn't clobber a server-side submit error from a previous attempt.
   */
  const uploadError = ref<string | null>(null)

  const task = computed(() => taskStore.activeTask)

  const showFollowupBar = computed(() => {
    if (!task.value) return false
    if (!shouldShowFollowupBar(task.value.status)) return false
    const agent = agentStore.currentAgent
    if (!agent) return false
    return agent.allow_followup !== false
  })

  /**
   * State-aware placeholder string for the follow-up input. ABORTED
   * surfaces a redirect cue so the user knows the typed message will
   * resume the agent rather than start a new turn.
   */
  const followupPlaceholder = computed(() => {
    if (task.value?.status === 'ABORTED') {
      return 'Send a new instruction to continue…'
    }
    return 'Ask a follow-up question…'
  })

  /**
   * Compose-time capability tri-state for the "Attach image" affordance:
   *   - `loading` — agent detail hasn't resolved yet; affordance disabled
   *     with a "Checking image support…" tooltip so the UI doesn't
   *     flicker between disabled states during navigation.
   *   - `active`  — agent's LLM accepts images; button enabled.
   *   - `unsupported` — agent's LLM does not accept images; button
   *     disabled with an explanatory tooltip.
   *
   * Mirrors `ComposerInput.vue` (initial composer) so the two
   * surfaces feel consistent.
   */
  const imageSupport = computed<'loading' | 'active' | 'unsupported'>(() => {
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

  /**
   * Combined submit/upload error for the inline error slot. Either
   * non-null surfaces to the user; the upload branch wins if both
   * fire on the same submit.
   */
  const composerError = computed(() => uploadError.value ?? followupError.value)

  /** Wire-up hook the template calls when the picker emits `attach`. */
  function onPickerAttach(assets: MediaAsset[]): void {
    attachedMedia.value = [...attachedMedia.value, ...assets]
  }

  /** Remove a single staged attachment (chip × click). */
  function removeAttachment(id: string): void {
    attachedMedia.value = attachedMedia.value.filter((m) => m.id !== id)
  }

  /**
   * Open the picker filtered to a specific media kind. Sets the
   * `accept` attribute to match the dynamic allowlist so the OS file
   * dialog pre-filters correctly:
   *   - `image` → vision-LLM image MIME list (via `useMediaAllowedTypes`)
   *   - `image+document` → full extension list
   */
  function openPicker(kind: 'image' | 'image+document'): void {
    pickerMediaKind.value = kind
    pickerAccept.value = kind === 'image' ? allowedTypes.imageAccept() : allowedTypes.extensionList()
    showMediaPicker.value = true
  }

  async function submitFollowup(): Promise<void> {
    const text = followupPrompt.value.trim()
    if (!text || !task.value) return
    uploadError.value = null
    followupError.value = null

    // Server-side guard for races where the user attaches an image
    // after the LLM support check resolved; matches ComposerInput's
    // submit-time check.
    const imageAttached = attachedMedia.value.some(
      (m) => (m.media_type ?? '').toLowerCase() === 'image',
    )
    if (imageAttached && !supportsImages.value) {
      uploadError.value = 'This LLM does not support image attachments.'
      return
    }

    submittingFollowup.value = true
    try {
      const mediaIds = attachedMedia.value.map((m) => m.id)
      await taskStore.continueTask(task.value.id, text, undefined, mediaIds)
      await taskStore.fetchTaskDetail(task.value.id)
      if (!taskStore.isTerminal) {
        taskStore.startDetailPolling(task.value.id)
      }
      followupPrompt.value = ''
      attachedMedia.value = []
    } catch (e) {
      followupError.value = e instanceof ApiError ? e.message : 'Failed to submit follow-up.'
    } finally {
      submittingFollowup.value = false
    }
  }

  return {
    followupPrompt,
    submittingFollowup,
    followupError,
    attachedMedia,
    showMediaPicker,
    pickerMediaKind,
    pickerAccept,
    uploadError,
    composerError,
    showFollowupBar,
    followupPlaceholder,
    imageSupport,
    supportsImages,
    imageButtonTitle,
    onPickerAttach,
    removeAttachment,
    openPicker,
    submitFollowup,
  }
}
