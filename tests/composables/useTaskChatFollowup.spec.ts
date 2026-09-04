/**
 * useTaskChatFollowup — follow-up prompt state + submit handler.
 *
 * Mocks the task store + agent store. Covers the showFollowupBar visibility
 * matrix, the success and error branches of submitFollowup, the empty-
 * prompt no-op, and the attachment state machine introduced for the
 * image/file follow-up attachments feature.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

const activeTaskRef = ref<Record<string, unknown> | null>(null)
const taskStoreMock = {
  get activeTask() { return activeTaskRef.value },
  continueTask: vi.fn(),
  fetchTaskDetail: vi.fn(),
  startDetailPolling: vi.fn(),
  isTerminal: false,
}
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskStoreMock,
}))

const currentAgentRef = ref<{ allow_followup?: boolean; llm_supports_image_input?: boolean } | null>(null)
const agentStoreMock = {
  get currentAgent() { return currentAgentRef.value },
}
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => agentStoreMock,
}))

/** `useMediaAllowedTypes` hits `GET /media/allowed-types` — stub it for tests. */
vi.mock('@/composables/useMediaAllowedTypes', () => ({
  useMediaAllowedTypes: () => ({
    data: ref(null),
    load: vi.fn().mockResolvedValue({ mime_types: [], extensions: [] }),
    extensionList: () => '.png,.jpg',
    imageMimeList: () => ['image/png', 'image/jpeg'],
    imageAccept: () => 'image/png,image/jpeg',
  }),
}))

import { useTaskChatFollowup } from '@/composables/useTaskChatFollowup'
import type { MediaAsset } from '@/types/media'

function setActiveTask(overrides: Record<string, unknown> = {}): void {
  activeTaskRef.value = { id: 1, status: 'COMPLETED', ...overrides }
}

function setAgent(allowContinuation: boolean | undefined = true): void {
  // Default to vision-capable so legacy `setAgent()` calls don't trip the
  // image-capability guard. Tests that want to exercise non-vision
  // behaviour override `currentAgentRef.value` directly.
  currentAgentRef.value = { allow_followup: allowContinuation, llm_supports_image_input: true }
}

function imageAsset(id: string): MediaAsset {
  return {
    id,
    filename: `${id}.png`,
    media_type: 'image',
    mime_type: 'image/png',
    byte_size: 1024,
    asset_url: `https://example.test/${id}`,
    has_markdown: false,
  }
}

function documentAsset(id: string): MediaAsset {
  return {
    id,
    filename: `${id}.pdf`,
    media_type: 'document',
    mime_type: 'application/pdf',
    byte_size: 2048,
    asset_url: `https://example.test/${id}`,
    has_markdown: false,
  }
}

beforeEach(() => {
  activeTaskRef.value = null
  currentAgentRef.value = null
  taskStoreMock.continueTask.mockReset()
  taskStoreMock.continueTask.mockResolvedValue(undefined)
  taskStoreMock.fetchTaskDetail.mockReset()
  taskStoreMock.fetchTaskDetail.mockResolvedValue(undefined)
  taskStoreMock.startDetailPolling.mockReset()
  taskStoreMock.isTerminal = false
})

describe('useTaskChatFollowup', () => {
  describe('showFollowupBar', () => {
    it('is false when there is no active task', () => {
      const c = useTaskChatFollowup()
      expect(c.showFollowupBar.value).toBe(false)
    })

    it('is true when task is COMPLETED and agent allows continuation', () => {
      setActiveTask({ status: 'COMPLETED' })
      setAgent(true)
      const c = useTaskChatFollowup()
      expect(c.showFollowupBar.value).toBe(true)
    })

    it('is true when task is FAILED and agent allows continuation', () => {
      setActiveTask({ status: 'FAILED' })
      setAgent(true)
      const c = useTaskChatFollowup()
      expect(c.showFollowupBar.value).toBe(true)
    })

    it('is false for running tasks', () => {
      setActiveTask({ status: 'RUNNING' })
      setAgent(true)
      const c = useTaskChatFollowup()
      expect(c.showFollowupBar.value).toBe(false)
    })

    it('is true when task is ABORTED and agent allows continuation', () => {
      setActiveTask({ status: 'ABORTED', aborted_at: '2026-08-08T12:00:00+00:00' })
      setAgent(true)
      const c = useTaskChatFollowup()
      expect(c.showFollowupBar.value).toBe(true)
    })

    it('placeholder is "Send a new instruction…" when task is ABORTED', () => {
      setActiveTask({ status: 'ABORTED' })
      setAgent(true)
      const c = useTaskChatFollowup()
      expect(c.followupPlaceholder.value).toBe('Send a new instruction to continue…')
    })

    it('placeholder is the standard follow-up cue when task is COMPLETED or FAILED', () => {
      setActiveTask({ status: 'COMPLETED' })
      setAgent(true)
      const c1 = useTaskChatFollowup()
      expect(c1.followupPlaceholder.value).toBe('Ask a follow-up question…')
      // Reset and check FAILED
      setActiveTask({ status: 'FAILED' })
      const c2 = useTaskChatFollowup()
      expect(c2.followupPlaceholder.value).toBe('Ask a follow-up question…')
    })

    it('is false when agent disallows continuation', () => {
      setActiveTask({ status: 'COMPLETED' })
      setAgent(false)
      const c = useTaskChatFollowup()
      expect(c.showFollowupBar.value).toBe(false)
    })

    it('is false when there is no current agent', () => {
      setActiveTask({ status: 'COMPLETED' })
      const c = useTaskChatFollowup()
      expect(c.showFollowupBar.value).toBe(false)
    })
  })

  describe('submitFollowup', () => {
    it('calls continueTask and starts detail polling for non-terminal tasks', async () => {
      setActiveTask()
      setAgent()
      taskStoreMock.isTerminal = false
      const c = useTaskChatFollowup()
      c.followupPrompt.value = 'follow-up question'
      await c.submitFollowup()
      expect(taskStoreMock.continueTask).toHaveBeenCalledWith(1, 'follow-up question', undefined, [])
      expect(taskStoreMock.fetchTaskDetail).toHaveBeenCalledWith(1)
      expect(taskStoreMock.startDetailPolling).toHaveBeenCalledWith(1)
      expect(c.followupPrompt.value).toBe('')
      expect(c.submittingFollowup.value).toBe(false)
    })

    it('does NOT start polling for terminal tasks', async () => {
      setActiveTask()
      setAgent()
      taskStoreMock.isTerminal = true
      const c = useTaskChatFollowup()
      c.followupPrompt.value = 'done'
      await c.submitFollowup()
      expect(taskStoreMock.continueTask).toHaveBeenCalled()
      expect(taskStoreMock.startDetailPolling).not.toHaveBeenCalled()
    })

    it('captures ApiError message into followupError', async () => {
      setActiveTask()
      setAgent()
      const { ApiError } = await import('@/api/client')
      taskStoreMock.continueTask.mockRejectedValueOnce(new ApiError('limit reached'))
      const c = useTaskChatFollowup()
      c.followupPrompt.value = 'hi'
      await c.submitFollowup()
      expect(c.followupError.value).toBe('limit reached')
      expect(c.followupPrompt.value).toBe('hi') // prompt preserved on error
      expect(c.submittingFollowup.value).toBe(false)
    })

    it('uses a generic fallback for non-ApiError rejections', async () => {
      setActiveTask()
      setAgent()
      taskStoreMock.continueTask.mockRejectedValueOnce(new Error('boom'))
      const c = useTaskChatFollowup()
      c.followupPrompt.value = 'hi'
      await c.submitFollowup()
      expect(c.followupError.value).toBe('Failed to submit follow-up.')
    })

    it('is a no-op for an empty prompt', async () => {
      setActiveTask()
      const c = useTaskChatFollowup()
      c.followupPrompt.value = '   '
      await c.submitFollowup()
      expect(taskStoreMock.continueTask).not.toHaveBeenCalled()
    })

    it('is a no-op when there is no active task', async () => {
      const c = useTaskChatFollowup()
      c.followupPrompt.value = 'hi'
      await c.submitFollowup()
      expect(taskStoreMock.continueTask).not.toHaveBeenCalled()
    })

    it('clears followupError at the start of the call', async () => {
      setActiveTask()
      setAgent()
      const c = useTaskChatFollowup()
      c.followupError.value = 'old'
      c.followupPrompt.value = 'new'
      await c.submitFollowup()
      expect(c.followupError.value).toBeNull()
    })

    it('forwards attached media ids as the 4th argument', async () => {
      setActiveTask()
      setAgent()
      const c = useTaskChatFollowup()
      c.attachedMedia.value = [imageAsset('a'), documentAsset('b')]
      c.followupPrompt.value = 'see attached'
      await c.submitFollowup()
      expect(taskStoreMock.continueTask).toHaveBeenCalledWith(1, 'see attached', undefined, ['a', 'b'])
    })

    it('clears attachedMedia on successful submit', async () => {
      setActiveTask()
      setAgent()
      const c = useTaskChatFollowup()
      c.attachedMedia.value = [imageAsset('a')]
      c.followupPrompt.value = 'hi'
      await c.submitFollowup()
      expect(c.attachedMedia.value).toEqual([])
    })

    it('preserves attachedMedia when the submit fails', async () => {
      setActiveTask()
      setAgent()
      const { ApiError } = await import('@/api/client')
      taskStoreMock.continueTask.mockRejectedValueOnce(new ApiError('limit reached'))
      const c = useTaskChatFollowup()
      c.attachedMedia.value = [imageAsset('a')]
      c.followupPrompt.value = 'hi'
      await c.submitFollowup()
      expect(c.attachedMedia.value).toHaveLength(1)
    })
  })

  describe('attachment image-capability guard', () => {
    it('refuses to submit an image when the agent LLM does not support images', async () => {
      setActiveTask()
      setAgent(true)
      currentAgentRef.value = { allow_followup: true, llm_supports_image_input: false }
      const c = useTaskChatFollowup()
      c.attachedMedia.value = [imageAsset('a')]
      c.followupPrompt.value = 'describe this'
      await c.submitFollowup()
      expect(taskStoreMock.continueTask).not.toHaveBeenCalled()
      expect(c.uploadError.value).toBe('This LLM does not support image attachments.')
    })

    it('allows submitting documents on a non-vision agent', async () => {
      setActiveTask()
      setAgent(true)
      currentAgentRef.value = { allow_followup: true, llm_supports_image_input: false }
      const c = useTaskChatFollowup()
      c.attachedMedia.value = [documentAsset('a')]
      c.followupPrompt.value = 'summarise'
      await c.submitFollowup()
      expect(taskStoreMock.continueTask).toHaveBeenCalled()
      expect(c.uploadError.value).toBeNull()
    })

    it('clears uploadError at the start of the next submit', async () => {
      setActiveTask()
      setAgent(true)
      currentAgentRef.value = { allow_followup: true, llm_supports_image_input: false }
      const c = useTaskChatFollowup()
      c.attachedMedia.value = [imageAsset('a')]
      c.followupPrompt.value = 'first'
      await c.submitFollowup()
      expect(c.uploadError.value).not.toBeNull()
      // Remove image; guard no longer triggers; submitError should clear.
      c.attachedMedia.value = []
      await c.submitFollowup()
      expect(c.uploadError.value).toBeNull()
    })

    it('imageSupport is "active" when agent LLM supports images', () => {
      setActiveTask()
      currentAgentRef.value = { allow_followup: true, llm_supports_image_input: true }
      const c = useTaskChatFollowup()
      expect(c.imageSupport.value).toBe('active')
      expect(c.supportsImages.value).toBe(true)
      expect(c.imageButtonTitle.value).toBe('Attach an image')
    })

    it('imageSupport is "unsupported" when agent LLM does not support images', () => {
      setActiveTask()
      currentAgentRef.value = { allow_followup: true, llm_supports_image_input: false }
      const c = useTaskChatFollowup()
      expect(c.imageSupport.value).toBe('unsupported')
      expect(c.supportsImages.value).toBe(false)
      expect(c.imageButtonTitle.value).toContain('does not support')
    })

    it('imageSupport is "loading" when there is no current agent', () => {
      setActiveTask()
      const c = useTaskChatFollowup()
      expect(c.imageSupport.value).toBe('loading')
    })
  })

  describe('attachment helpers', () => {
    it('onPickerAttach appends to attachedMedia', () => {
      setActiveTask()
      const c = useTaskChatFollowup()
      c.onPickerAttach([imageAsset('a')])
      c.onPickerAttach([documentAsset('b')])
      expect(c.attachedMedia.value.map((m) => m.id)).toEqual(['a', 'b'])
    })

    it('removeAttachment drops a single chip', () => {
      setActiveTask()
      const c = useTaskChatFollowup()
      c.attachedMedia.value = [imageAsset('a'), imageAsset('b')]
      c.removeAttachment('a')
      expect(c.attachedMedia.value.map((m) => m.id)).toEqual(['b'])
    })

    it('openPicker flips the modal and sets the accept from the allowlist', () => {
      setActiveTask()
      const c = useTaskChatFollowup()
      c.openPicker('image')
      expect(c.showMediaPicker.value).toBe(true)
      expect(c.pickerMediaKind.value).toBe('image')
      expect(c.pickerAccept.value).toBe('image/png,image/jpeg')
      c.openPicker('image+document')
      expect(c.pickerMediaKind.value).toBe('image+document')
      expect(c.pickerAccept.value).toBe('.png,.jpg')
    })
  })
})
