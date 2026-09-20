/**
 * Pending questions — the store selector + Mercure merge + answer action.
 *
 * The picker reads `pendingQuestions` from the store; the SSE path
 * pushes fresh batches via `applyTaskUpdate`; the answer action
 * posts the batched payload and refreshes the detail.
 */
import { setActivePinia, createPinia } from 'pinia'
import { useTaskStore } from '@/stores/tasks'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AnswerTaskPayload, PendingQuestionBatch, TaskDetail } from '@/types/task'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly code: string = 'UNKNOWN', public readonly status = 0) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

vi.mock('@/api/tasks', () => ({
  tasksApi: {
    answerTask: vi.fn(),
  },
}))

const baseTask: TaskDetail = {
  id: 7,
  agent_id: 1,
  status: 'AWAITING_INPUT',
  user_prompt: 'go',
  final_response: null,
  step_count: 1,
  max_steps: 10,
  error_code: null,
  error_message: null,
  failure_reason: null,
  history: [],
  tool_calls: [],
  totals: null,
  created_at: '',
  updated_at: '',
  data: null,
}

const sampleBatch: PendingQuestionBatch = {
  toolCallId: 'tc_99',
  questions: [
    {
      question: 'Pick a backend',
      header: 'Backend',
      options: [{ label: 'SQLite', description: null, preview: null }],
      multiple: false,
      allowFreeText: false,
    },
  ],
}

async function importMocks() {
  const { tasksApi } = await import('@/api/tasks')
  const { api } = await import('@/api/client')
  return { tasksApi, api }
}

describe('useTaskStore — pending questions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
  })

  describe('pendingQuestions selector', () => {
    it('returns null when no batch is outstanding', () => {
      const store = useTaskStore()
      store.activeTask = { ...baseTask, data: {} }
      expect(store.pendingQuestions).toBeNull()
    })

    it('returns the batch list when one or more batches are outstanding', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { pending_questions: [sampleBatch] },
      }
      expect(store.pendingQuestions).toEqual([sampleBatch])
    })
  })

  describe('SSE merge — applyTaskUpdate', () => {
    it('merges top-level pending_questions into activeTask.data without clobbering siblings', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { spawned_sub_task_ids: [99], handover: { target_agent_id: 7 } },
      }

      store.applyTaskUpdate(7, { pending_questions: [sampleBatch] })

      expect(store.activeTask?.data).toEqual({
        spawned_sub_task_ids: [99],
        handover: { target_agent_id: 7 },
        pending_questions: [sampleBatch],
      })
    })

    it('clears pending_questions when the backend publishes null', () => {
      const store = useTaskStore()
      store.activeTask = {
        ...baseTask,
        data: { pending_questions: [sampleBatch] },
      }
      store.applyTaskUpdate(7, { pending_questions: null })
      expect(store.activeTask?.data?.pending_questions).toBeNull()
    })
  })

  describe('answerPendingQuestions', () => {
    it('POSTs the payload via tasksApi and refreshes the task detail', async () => {
      const { tasksApi, api } = await importMocks()
      ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ task: { ...baseTask, status: 'RUNNING' } })
      ;(tasksApi.answerTask as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

      const store = useTaskStore()
      store.activeTask = { ...baseTask }
      const payload: AnswerTaskPayload = {
        toolCallId: 'tc_99',
        answers: [{ header: 'Backend', selections: ['SQLite'], freeText: null }],
      }

      await store.answerPendingQuestions(payload)

      expect(tasksApi.answerTask).toHaveBeenCalledWith(7, payload)
      expect(api.get).toHaveBeenCalledWith('/tasks/7')
    })

    it('throws ApiError when there is no active task', async () => {
      const store = useTaskStore()
      await expect(
        store.answerPendingQuestions({
          toolCallId: 'tc_99',
          answers: [],
        }),
      ).rejects.toThrow(/No active task/)
    })
  })
})
