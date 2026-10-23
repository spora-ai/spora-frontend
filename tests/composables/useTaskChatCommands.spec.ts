/**
 * useTaskChatCommands — the conversation commands the chat offers.
 *
 * Mocks the task store + the toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const toastMock = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMock,
}))

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
  compactTask: vi.fn(),
}
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskStoreMock,
}))

import { useTaskChatCommands } from '@/composables/useTaskChatCommands'

beforeEach(() => {
  vi.clearAllMocks()
  activeTaskRef.value = { id: 1, status: 'COMPLETED' }
  taskStoreMock.compactTask.mockResolvedValue({ task: {}, compacted: true })
})

describe('useTaskChatCommands', () => {
  it('offers a compact command', () => {
    const { commands } = useTaskChatCommands()

    expect(commands.value.map((c) => c.id)).toContain('compact')
  })

  it('compacts the conversation and says so', async () => {
    const { commands, compactConversation } = useTaskChatCommands()

    await compactConversation()

    expect(taskStoreMock.compactTask).toHaveBeenCalledWith(1)
    expect(toastMock.success).toHaveBeenCalledWith('Conversation compacted.')
  })

  it('says that there was nothing to compact', async () => {
    taskStoreMock.compactTask.mockResolvedValue({ task: {}, compacted: false })
    const { compactConversation } = useTaskChatCommands()

    await compactConversation()

    expect(toastMock.info).toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('reports a failure', async () => {
    taskStoreMock.compactTask.mockRejectedValue(new Error('boom'))
    const { compactConversation } = useTaskChatCommands()

    await compactConversation()

    expect(toastMock.error).toHaveBeenCalled()
  })

  it('does nothing without a task', async () => {
    activeTaskRef.value = null
    const { compactConversation } = useTaskChatCommands()

    await compactConversation()

    expect(taskStoreMock.compactTask).not.toHaveBeenCalled()
  })

  it('runs the compaction when the command is selected', async () => {
    const { commands } = useTaskChatCommands()

    const compact = commands.value.find((c) => c.id === 'compact')
    await compact?.onSelect()

    expect(taskStoreMock.compactTask).toHaveBeenCalledWith(1)
  })

  it('disables the command while a compaction is in flight', async () => {
    let resolve: (value: unknown) => void = () => {}
    taskStoreMock.compactTask.mockReturnValue(new Promise((r) => { resolve = r }))
    const { commands, compactConversation } = useTaskChatCommands()

    const pending = compactConversation()
    expect(commands.value.find((c) => c.id === 'compact')?.disabled).toBe(true)

    resolve({ task: {}, compacted: true })
    await pending
    expect(commands.value.find((c) => c.id === 'compact')?.disabled).toBe(false)
  })
})
