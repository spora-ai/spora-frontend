/**
 * The effort recovery — the race between a refused level and the agent the
 * operator moves on to.
 *
 * A level the driver's level set no longer holds is refused with 422
 * EFFORT_LEVEL_UNSUPPORTED, and the recovery asks the backend for the
 * capability again. The refusal lands after the request that carried it,
 * and the operator may have moved on in between: the recovery must not
 * follow them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/api/client', () => ({
  api: apiMock,
  ApiError: class FakeApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number,
    ) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

const routerPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

const activeTask = ref<Record<string, unknown> | null>(null)
const taskStoreMock = {
  get activeTask() { return activeTask.value },
  createTaskForAgent: vi.fn(),
  continueTask: vi.fn(),
  fetchTaskDetail: vi.fn(),
  startDetailPolling: vi.fn(),
  isTerminal: true,
}
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskStoreMock,
}))

import { useAgentEffort } from '@/composables/useAgentEffort'
import { useComposerSubmit } from '@/composables/useComposerSubmit'
import { useTaskChatFollowup } from '@/composables/useTaskChatFollowup'
import { clearAgentEffortCache } from '@/composables/agentEffortCache'

/** The capability of an agent whose driver offers one level. */
function capability(value: string, label: string): Record<string, unknown> {
  return {
    supported: true,
    levels: [{ value, label }],
    default: value,
  }
}

beforeEach(() => {
  apiMock.get.mockReset()
  routerPush.mockReset()
  taskStoreMock.createTaskForAgent.mockReset()
  taskStoreMock.continueTask.mockReset()
  taskStoreMock.fetchTaskDetail.mockReset()
  taskStoreMock.startDetailPolling.mockReset()
  activeTask.value = null
  clearAgentEffortCache()
})

describe('the effort recovery', () => {
  it('the composer keeps the agent the operator switched to when the refusal lands', async () => {
    const { ApiError } = await import('@/api/client')

    // The capability of the agent the operator is on.
    apiMock.get.mockResolvedValueOnce({
      supported: true,
      levels: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      default: 'high',
    })
    const effort = useAgentEffort()
    await effort.load(1)

    // The message goes to the first agent, and the backend refuses the
    // level its driver no longer offers.
    let refuse!: (error: Error) => void
    taskStoreMock.createTaskForAgent.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      refuse = reject
    }))
    const submit = useComposerSubmit(() => 1, () => effort.selection.value, effort.refresh)
    const submitted = submit.submit('hello')

    // The operator switches to another agent before the refusal lands.
    apiMock.get.mockResolvedValueOnce(capability('medium', 'Medium'))
    await effort.load(2)

    // The refusal lands, and the recovery asks for the first agent's
    // capability again.
    apiMock.get.mockResolvedValueOnce(capability('high', 'High'))
    refuse(new ApiError('level not supported', 'EFFORT_LEVEL_UNSUPPORTED', 422))
    await submitted

    // The message carried the first agent's level.
    expect(taskStoreMock.createTaskForAgent).toHaveBeenCalledWith(1, 'hello', {
      mediaIds: [],
      effort: 'high',
    })

    // The composer still shows the agent on screen, so the next message to
    // it carries that agent's level.
    expect(effort.levels.value).toEqual([{ value: 'medium', label: 'Medium' }])
    expect(effort.selection.value).toBe('medium')
  })

  it('the follow-up bar keeps the task the operator moved on to when the refusal lands', async () => {
    const { ApiError } = await import('@/api/client')

    activeTask.value = { id: 10, status: 'COMPLETED', agent_id: 1 }

    // The capability of the first task's agent.
    apiMock.get.mockResolvedValueOnce({
      supported: true,
      levels: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      default: 'high',
    })
    const effort = useAgentEffort()
    await effort.load(1)

    // The follow-up goes to the first task, and the backend refuses the
    // level its agent's driver no longer offers.
    let refuse!: (error: Error) => void
    taskStoreMock.continueTask.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      refuse = reject
    }))
    const followup = useTaskChatFollowup(() => effort.selection.value, effort.refresh)
    followup.followupPrompt.value = 'and again'
    const submitted = followup.submitFollowup()

    // The operator opens another task — another agent — before the refusal
    // lands.
    activeTask.value = { id: 11, status: 'COMPLETED', agent_id: 2 }
    apiMock.get.mockResolvedValueOnce(capability('medium', 'Medium'))
    await effort.load(2)

    // The refusal lands, and the recovery asks for the first agent's
    // capability again.
    apiMock.get.mockResolvedValueOnce(capability('high', 'High'))
    refuse(new ApiError('level not supported', 'EFFORT_LEVEL_UNSUPPORTED', 422))
    await submitted

    // The follow-up bar still shows the agent of the task on screen.
    expect(effort.levels.value).toEqual([{ value: 'medium', label: 'Medium' }])
    expect(effort.selection.value).toBe('medium')
  })
})
