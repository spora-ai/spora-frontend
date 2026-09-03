/**
 * TaskChatPage — thin shell over the TaskChat sub-components.
 *
 * Mounts the page with stubbed sub-components that re-emit the documented
 * events so we can assert the layout wiring (loading state, sub-component
 * presence, and event → handler pass-through) without duplicating the
 * per-sub-component assertions in `tests/components/agent/TaskChat/`.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick, reactive, ref, defineComponent, h } from 'vue'

// Drain the queue the watcher schedules (post-flush callbacks, microtasks,
// and a `flushPromises` pass) so route-change assertions don't race the
// watcher's async body.
async function flushWatchers(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.vm.$nextTick()
  await nextTick()
  await flushPromises()
  await wrapper.vm.$nextTick()
}

// `reactive` (not `ref`) so the page's `computed(() => route.params.id)`
// picks up param mutations through the Vue proxy. A plain object inside a
// ref would not be tracked.
const routeRef = reactive<{ params: { id: string } }>({ params: { id: '1' } })
const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => routeRef,
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

const activeTaskRef = ref<Record<string, unknown> | null>(null)
const pendingToolCallsRef = ref<unknown[]>([])
const subTaskCacheRef = ref(new Map<number, { status: string }>())

const stopDetailPolling = vi.fn()
const clearActiveTask = vi.fn()
const clearSubTaskCache = vi.fn()
const fetchTaskDetail = vi.fn()
const startDetailPolling = vi.fn()
const cancelRetryChain = vi.fn()
const fetchTask = vi.fn()
const retryTask = vi.fn()
const continueTask = vi.fn()
const approveTask = vi.fn()
const rejectTask = vi.fn()
const abortTask = vi.fn()
let isTerminal = false

vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => ({
    get activeTask() { return activeTaskRef.value },
    get pendingToolCalls() { return pendingToolCallsRef.value },
    get isTerminal() { return isTerminal },
    get subTaskCache() { return subTaskCacheRef.value },
    stopDetailPolling,
    clearActiveTask,
    clearSubTaskCache,
    fetchTaskDetail,
    startDetailPolling,
    cancelRetryChain,
    fetchTask,
    retryTask,
    continueTask,
    approveTask,
    rejectTask,
    abortTask,
  }),
}))

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    currentAgent: { allow_followup: true },
    fetchAgents: vi.fn().mockResolvedValue(undefined),
    fetchAgent: vi.fn().mockResolvedValue(undefined),
  }),
}))

const toastMock = { error: vi.fn(), success: vi.fn() }
vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMock,
}))

vi.mock('@/api/client', () => ({
  ApiError: class FakeApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ApiError' }
  },
}))

// Stubs emit the documented events on mount so the page-level handler
// bindings are exercised by V8 coverage. Real sub-components are tested
// in tests/components/agent/TaskChat/.
const AgentLayoutStub = { name: 'AgentLayout', template: '<div class="agent-layout-stub"><slot /></div>' }
const TaskStatusBadgeStub = { name: 'TaskStatusBadge', template: '<span class="badge-stub" />' }

// The split usage UI: summary in the header, details as a sibling below.
// Both register their modelled v-model prop so the page's v-model wires
// up correctly under @vue/test-utils.
const TaskUsageSummaryStub = defineComponent({
  name: 'TaskUsageSummary',
  props: ['detailsOpen', 'history', 'totals'],
  emits: ['update:detailsOpen'],
  setup(_, { attrs }) {
    return () => h('div', { class: 'taskusagesummary-stub', 'data-testid': 'usage-summary-stub' }, [
      h('button', {
        class: 'usage-summary-toggle',
        type: 'button',
        onClick: () => {
          const open = (attrs.detailsOpen as boolean | undefined) ?? false
          // Emit the v-model update via the parent's emit binding.
          ;(_ as unknown as { $emit: (e: string, ...a: unknown[]) => void }).$emit?.('update:detailsOpen', !open)
        },
      }, 'toggle'),
    ])
  },
})
const TaskUsageDetailsStub = defineComponent({
  name: 'TaskUsageDetails',
  props: ['detailsOpen', 'history', 'totals', 'provider'],
  setup(props) {
    return () => props.detailsOpen
      ? h('div', { class: 'taskusagedetails-stub', 'data-testid': 'usage-details-stub' })
      : h('div', { class: 'taskusagedetails-stub-hidden', 'data-testid': 'usage-details-stub' })
  },
})

// A "render-prop" stub whose emit function is reachable from the test via
// wrapper.vm.$emit(event, ...args).
function makeEventStub(name: string, eventNames: string[]) {
  return defineComponent({
    name,
    emits: eventNames,
    setup(_, { emit }) {
      return () => h('div', { class: `${name.toLowerCase()}-stub` })
    },
  })
}
const TaskChatBannersStub = makeEventStub('TaskChatBanners', [
  'retryNow', 'cancelRetryChain', 'dismissBanner', 'updateFollowupPrompt', 'submitFollowup',
])
const TaskChatMessageListStub = defineComponent({
  name: 'TaskChatMessageList',
  emits: ['toggleExpanded', 'abort'],
  setup(_, { emit }) {
    const button = document && document.createElement
      ? document.createElement('button')
      : null
    return () => h('div', { class: 'taskchatmessagelist-stub' }, [
      h(
        'button',
        {
          'data-testid': 'abort-button',
          onClick: () => emit('abort'),
        },
        'abort',
      ),
    ])
  },
  methods: {
    scrollToBottom() { /* noop stub */ },
  },
})
const focusStub = vi.fn()
const TaskChatFollowupStub = defineComponent({
  name: 'TaskChatFollowup',
  emits: ['updateFollowupPrompt', 'submitFollowup'],
  setup(_, { emit }) {
    return () => h('div', { class: 'taskchatfollowup-stub' })
  },
  methods: {
    // Exposed via defineExpose on the real component (Plan C focus
    // path). The page wires its `ref="followupBarRef"` to this stub
    // and calls `.focus()` after dispatching the focus event.
    focus() { focusStub() },
  },
})
const ToolApprovalBarStub = makeEventStub('ToolApprovalBar', [
  'submit-decisions', 'reject-all',
])

import TaskChatPage from '@/pages/TaskChatPage.vue'

const globalStubs = {
  AgentLayout: AgentLayoutStub,
  TaskStatusBadge: TaskStatusBadgeStub,
  TaskUsageSummary: TaskUsageSummaryStub,
  TaskUsageDetails: TaskUsageDetailsStub,
  TaskChatBanners: TaskChatBannersStub,
  TaskChatMessageList: TaskChatMessageListStub,
  TaskChatFollowup: TaskChatFollowupStub,
  ToolApprovalBar: ToolApprovalBarStub,
}

// Track every wrapper created in this file so the afterEach can unmount
// them. Without this, tests that don't call wrapper.unmount() leave their
// component instance (and its watchers) running — Vue Test Utils doesn't
// auto-cleanup on `setActivePinia(createPinia())`. Leaked watchers
// continue to respond to reactive changes on `activeTaskRef`, which is
// a separate module-level ref reused by every test, so an unmounted
// wrapper from a previous test can still trigger side effects (e.g. the
// `focusStub` counter) during a later test's transitions.
const mountedWrappers: Array<ReturnType<typeof mount>> = []

function mountPage() {
  const wrapper = mount(TaskChatPage, { global: { stubs: globalStubs } })
  mountedWrappers.push(wrapper)
  return wrapper
}

function loadedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    agent_id: 7,
    user_prompt: 'hello',
    status: 'RUNNING',
    step_count: 1,
    history: [],
    final_response: null,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  routeRef.params = { id: '1' }
  activeTaskRef.value = null
  pendingToolCallsRef.value = []
  subTaskCacheRef.value = new Map()
  isTerminal = false
  stopDetailPolling.mockReset()
  clearActiveTask.mockReset()
  clearSubTaskCache.mockReset()
  fetchTaskDetail.mockReset()
  fetchTaskDetail.mockResolvedValue(false)
  startDetailPolling.mockReset()
  cancelRetryChain.mockReset()
  cancelRetryChain.mockResolvedValue(undefined)
  fetchTask.mockReset()
  fetchTask.mockResolvedValue(undefined)
  fetchTaskDetail.mockResolvedValue(true)
  retryTask.mockReset()
  retryTask.mockResolvedValue({ id: 99 })
  continueTask.mockReset()
  continueTask.mockResolvedValue(undefined)
  approveTask.mockReset()
  approveTask.mockResolvedValue(undefined)
  rejectTask.mockReset()
  rejectTask.mockResolvedValue(undefined)
  abortTask.mockReset()
  abortTask.mockResolvedValue({ id: 1, status: 'ABORTED' })
  pushMock.mockReset()
  focusStub.mockReset()
  toastMock.error.mockReset()
  toastMock.success.mockReset()
})

// The page's onMounted registers a `spora:focus-followup` listener on
// `document`; Vue Test Utils does not call onUnmounted when a wrapper
// isn't explicitly unmounted, so listeners leak across tests. Track
// every (target, event, handler) tuple added via addEventListener and
// replay the matching removeEventListener in afterEach. This keeps the
// document event registry clean between tests so the new Resume-button
// test can assert on the count fired by *its* wrapper alone.
const capturedDocumentListeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = []
const originalAdd = document.addEventListener.bind(document)
const originalRemove = document.removeEventListener.bind(document)
;(document as unknown as { addEventListener: typeof document.addEventListener }).addEventListener = function (
  this: Document,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  if (this === document) {
    capturedDocumentListeners.push([this, type, listener])
  }
  return originalAdd(type, listener, options)
} as typeof document.addEventListener
;(document as unknown as { removeEventListener: typeof document.removeEventListener }).removeEventListener = function (
  this: Document,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions,
): void {
  if (this === document) {
    const idx = capturedDocumentListeners.findIndex(([, t, l]) => t === type && l === listener)
    if (idx !== -1) capturedDocumentListeners.splice(idx, 1)
  }
  return originalRemove(type, listener, options)
} as typeof document.removeEventListener
afterEach(() => {
  // Replay every captured addEventListener as a removeEventListener. The
  // page's onUnmounted already does this for its own listener, but tests
  // that don't unmount their wrapper leave the listener behind. The
  // captured list now drains them all.
  for (const [target, type, listener] of [...capturedDocumentListeners]) {
    originalRemove.call(target, type, listener)
  }
  capturedDocumentListeners.length = 0
  // Tear down any wrapper the test didn't unmount itself. Without this,
  // watchers from previous tests stay alive and respond to shared
  // reactive state (activeTaskRef, etc.), causing cross-test
  // contamination — see the `mountPage` note above.
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
})

describe('TaskChatPage', () => {
  it('shows the loading state when no task is loaded', () => {
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Loading')
  })

  it('renders the sub-components when a task is loaded', () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    expect(wrapper.find('.taskchatbanners-stub').exists()).toBe(true)
    expect(wrapper.find('.taskchatmessagelist-stub').exists()).toBe(true)
  })

  it('mounts TaskUsageSummary inside the chat header and TaskUsageDetails as a sibling below', () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const summary = wrapper.find('.taskusagesummary-stub').element
    const details = wrapper.find('[data-testid="usage-details-stub"]').element
    const messageList = wrapper.find('.taskchatmessagelist-stub').element
    const header = wrapper.find('button[aria-label="Back"]').element.parentElement

    // Summary is nested inside the header (the chat header wraps it).
    expect(header?.contains(summary)).toBe(true)
    // Details is a sibling of the header (same parent), not nested.
    expect(header?.contains(details)).toBe(false)
    expect(details.parentElement).toBe(header?.parentElement)
    // Details renders before the message list.
    expect(details.compareDocumentPosition(messageList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('mounts without throwing', () => {
    expect(() => mountPage()).not.toThrow()
  })

  it('clears the shared sub-task cache when the page unmounts', () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()

    wrapper.unmount()

    expect(clearSubTaskCache).toHaveBeenCalledOnce()
  })

  it('clears the shared sub-task cache when the route taskId changes between parents', async () => {
    // Seed a child row for parent A so we can prove the cache wipe runs
    // when the operator navigates to parent B without remounting the page.
    activeTaskRef.value = loadedTask({ id: 1, data: { spawned_sub_task_ids: [100] } })
    const wrapper = mountPage()
    clearSubTaskCache.mockClear()
    // Vue Router reuses the component when only the param changes; mutate
    // the reactive route to trigger the page's `watch(taskId, ...)` handler.
    routeRef.params = { id: '2' }
    await flushWatchers(wrapper)
    expect(clearSubTaskCache).toHaveBeenCalled()
  })
  it('shows the parent task breadcrumb when parent_task_id is set', () => {
    activeTaskRef.value = loadedTask({ parent_task_id: 42 })
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Source task #42')
  })

  it('hides the parent task breadcrumb when parent_task_id is absent', () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    expect(wrapper.text()).not.toContain('Source task')
  })

  it('shows the sub-agent count badge in the header when spawned children are recorded', () => {
    activeTaskRef.value = loadedTask({
      data: { spawned_sub_task_ids: [10, 11, 12] },
    })
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('3 sub-agents')
  })

  it('shows live child status counts in the header badge', () => {
    activeTaskRef.value = loadedTask({
      data: { spawned_sub_task_ids: [10, 11, 12, 13, 14] },
    })
    subTaskCacheRef.value.set(10, { status: 'PENDING_APPROVAL' })
    subTaskCacheRef.value.set(11, { status: 'RUNNING' })
    subTaskCacheRef.value.set(12, { status: 'COMPLETED' })
    subTaskCacheRef.value.set(13, { status: 'FAILED' })
    subTaskCacheRef.value.set(14, { status: 'CANCELLED' })

    const wrapper = mountPage()

    expect(wrapper.text()).toContain(
      '5 sub-agents · 1 needs approval · 1 running · 1 completed · 1 failed · 1 cancelled',
    )
  })

  it('falls back to the running count when no child awaits approval', () => {
    activeTaskRef.value = loadedTask({
      data: { spawned_sub_task_ids: [10, 11, 12] },
    })
    subTaskCacheRef.value.set(10, { status: 'RUNNING' })
    subTaskCacheRef.value.set(11, { status: 'RUNNING' })
    subTaskCacheRef.value.set(12, { status: 'COMPLETED' })

    const wrapper = mountPage()

    expect(wrapper.text()).toContain('3 sub-agents · 2 running · 1 completed')
  })

  it('hides the sub-agent badge when no spawned children are recorded', () => {
    activeTaskRef.value = loadedTask({ data: {} })
    const wrapper = mountPage()
    expect(wrapper.text()).not.toContain('sub-agents')
  })

  it('scrolls to the first child awaiting approval', async () => {
    activeTaskRef.value = loadedTask({
      data: { spawned_sub_task_ids: [10, 11] },
    })
    subTaskCacheRef.value.set(10, { status: 'PENDING_APPROVAL' })
    subTaskCacheRef.value.set(11, { status: 'PENDING_APPROVAL' })
    const wrapper = mountPage()
    const badge = wrapper.find('a[href="#sub-agent-tool-call"]')
    const marker = document.createElement('div')
    const scrollIntoView = vi.fn()
    marker.setAttribute('data-testid', 'sub-agent-needs-approval-10')
    marker.scrollIntoView = scrollIntoView
    document.body.appendChild(marker)

    try {
      await badge.trigger('click')
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    } finally {
      marker.remove()
    }
  })

  it('scrolls to the first widget when no child awaits approval', async () => {
    activeTaskRef.value = loadedTask({
      data: { spawned_sub_task_ids: [10] },
    })
    subTaskCacheRef.value.set(10, { status: 'RUNNING' })
    const wrapper = mountPage()
    const badge = wrapper.find('a[href="#sub-agent-tool-call"]')
    const marker = document.createElement('div')
    const scrollIntoView = vi.fn()
    marker.setAttribute('data-testid', 'sub-agent-tool-call')
    marker.scrollIntoView = scrollIntoView
    document.body.appendChild(marker)

    try {
      await badge.trigger('click')
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    } finally {
      marker.remove()
    }
  })

  it('singularizes the sub-agent label when only one child is spawned', () => {
    activeTaskRef.value = loadedTask({
      data: { spawned_sub_task_ids: [10] },
    })
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('1 sub-agent')
    expect(wrapper.text()).not.toContain('1 sub-agents')
  })

  it('shows the chat layout when the task is loaded', () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    expect(wrapper.find('.taskchatbanners-stub').exists()).toBe(true)
    expect(wrapper.find('.taskchatmessagelist-stub').exists()).toBe(true)
    expect(wrapper.find('.taskchatfollowup-stub').exists()).toBe(true)
  })

  it('hides the ToolApprovalBar when the task is not pending approval', () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    expect(wrapper.find('.toolapprovalbar-stub').exists()).toBe(false)
  })

  it('shows the ToolApprovalBar when the task is PENDING_APPROVAL with pending tool calls', () => {
    activeTaskRef.value = loadedTask({ status: 'PENDING_APPROVAL' })
    pendingToolCallsRef.value = [{ id: 1, tool_name: 'web_search' }]
    const wrapper = mountPage()
    expect(wrapper.find('.toolapprovalbar-stub').exists()).toBe(true)
  })

  it('navigates back to the agent when the Back button is clicked', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const back = wrapper.find('button[aria-label="Back"]')
    expect(back.exists()).toBe(true)
    await back.trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'agent', params: { id: 7 } })
  })

  it('navigates back to the dashboard when the task has no agent_id', async () => {
    activeTaskRef.value = loadedTask({ agent_id: null })
    const wrapper = mountPage()
    const back = wrapper.find('button[aria-label="Back"]')
    await back.trigger('click')
    expect(pushMock).toHaveBeenCalledWith({ name: 'dashboard' })
  })

  it('Toggles the details visibility through the v-model wiring', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()

    // Initially the details stub is in its "hidden" branch.
    expect(wrapper.find('.taskusagedetails-stub-hidden').exists()).toBe(true)

    // Click the summary's toggle stub — it emits `update:detailsOpen`
    // with the new value, which the parent's v-model catches.
    const summary = wrapper.findComponent(TaskUsageSummaryStub)
    summary.vm.$emit('update:detailsOpen', true)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.taskusagedetails-stub').exists()).toBe(true)
    expect(wrapper.find('.taskusagedetails-stub-hidden').exists()).toBe(false)

    // Flip back to closed.
    summary.vm.$emit('update:detailsOpen', false)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.taskusagedetails-stub-hidden').exists()).toBe(true)
  })
})

describe('TaskChatPage — event wiring', () => {
  it('forwards TaskChatBanners @retryNow to retry.retryNow (no task-route navigation)', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const banner = wrapper.findComponent(TaskChatBannersStub)
    banner.vm.$emit('retryNow')
    await Promise.resolve()
    await Promise.resolve()
    expect(retryTask).toHaveBeenCalledWith(1)
    // Retry is in place on the backend — same task_id, same URL. The returned
    // { id: 99 } is ignored, so the page must NOT navigate to the new task.
    // (pushMock may still record the onMounted fetch-failed redirect.)
    expect(pushMock).not.toHaveBeenCalledWith({ name: 'task', params: { id: 99 } })
  })

  it('forwards TaskChatBanners @cancelRetryChain to retry.cancelRetryChain', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const banner = wrapper.findComponent(TaskChatBannersStub)
    banner.vm.$emit('cancelRetryChain')
    await Promise.resolve()
    expect(cancelRetryChain).toHaveBeenCalledWith(1)
    expect(fetchTask).toHaveBeenCalledWith(1)
  })

  it('forwards TaskChatBanners @dismissBanner to retry.dismissBanner', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const banner = wrapper.findComponent(TaskChatBannersStub)
    banner.vm.$emit('dismissBanner')
    expect(() => banner.vm.$emit('dismissBanner')).not.toThrow()
  })

  it('forwards TaskChatBanners @updateFollowupPrompt to followup.followupPrompt', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const banner = wrapper.findComponent(TaskChatBannersStub)
    banner.vm.$emit('updateFollowupPrompt', 'hello from banner')
    await Promise.resolve()
    const followup = wrapper.findComponent(TaskChatFollowupStub)
    expect(followup.exists()).toBe(true)
  })

  it('forwards TaskChatBanners @submitFollowup to followup.submitFollowup', async () => {
    activeTaskRef.value = loadedTask({ status: 'COMPLETED' })
    const wrapper = mountPage()
    const banner = wrapper.findComponent(TaskChatBannersStub)
    banner.vm.$emit('submitFollowup')
    await Promise.resolve()
    // submitFollowup early-returns when followupPrompt is empty, so the store
    // isn't called — but the call must not throw.
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('forwards TaskChatFollowup @updateFollowupPrompt', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const followup = wrapper.findComponent(TaskChatFollowupStub)
    followup.vm.$emit('updateFollowupPrompt', 'new prompt')
    expect(() => followup.vm.$emit('updateFollowupPrompt', 'x')).not.toThrow()
  })

  it('forwards TaskChatFollowup @submitFollowup', async () => {
    activeTaskRef.value = loadedTask({ status: 'COMPLETED' })
    const wrapper = mountPage()
    const followup = wrapper.findComponent(TaskChatFollowupStub)
    followup.vm.$emit('submitFollowup')
    await Promise.resolve()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('forwards ToolApprovalBar @submit-decisions to approvals.onSubmitDecisions', async () => {
    activeTaskRef.value = loadedTask({ status: 'PENDING_APPROVAL' })
    pendingToolCallsRef.value = [{ id: 1, tool_name: 'web_search' }]
    const wrapper = mountPage()
    const bar = wrapper.findComponent(ToolApprovalBarStub)
    bar.vm.$emit('submit-decisions', { decisions: [{ providerCallId: 'c1', decision: 'approve', arguments: { q: 'x' } }] })
    await Promise.resolve()
    expect(approveTask).toHaveBeenCalledWith(1, [{ providerCallId: 'c1', decision: 'approve', arguments: { q: 'x' } }])
  })

  it('forwards ToolApprovalBar @reject-all to approvals.onRejectAll', async () => {
    activeTaskRef.value = loadedTask({ status: 'PENDING_APPROVAL' })
    pendingToolCallsRef.value = [{ id: 1, tool_name: 'web_search' }]
    const wrapper = mountPage()
    const bar = wrapper.findComponent(ToolApprovalBarStub)
    bar.vm.$emit('reject-all', { reason: 'no thanks' })
    await Promise.resolve()
    expect(rejectTask).toHaveBeenCalledWith(1, 'no thanks')
  })

  it('forwards TaskChatMessageList @toggleExpanded', async () => {
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    const list = wrapper.findComponent(TaskChatMessageListStub)
    list.vm.$emit('toggleExpanded', 5)
    expect(() => list.vm.$emit('toggleExpanded', 7)).not.toThrow()
  })

  it('catches @abort from TaskChatMessageList and calls store.abortTask with the active task id', async () => {
    activeTaskRef.value = loadedTask({ id: 42 })
    const wrapper = mountPage()
    const list = wrapper.findComponent(TaskChatMessageListStub)
    list.vm.$emit('abort')
    await flushPromises()
    expect(abortTask).toHaveBeenCalledTimes(1)
    expect(abortTask).toHaveBeenCalledWith(42)
  })

  it('swallows abort errors and surfaces them via the toast', async () => {
    activeTaskRef.value = loadedTask({ id: 7 })
    abortTask.mockReset()
    abortTask.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mountPage()
    const list = wrapper.findComponent(TaskChatMessageListStub)
    list.vm.$emit('abort')
    await flushPromises()
    await flushPromises()
    expect(toastMock.error).toHaveBeenCalledWith('boom')
  })

  it('focuses the follow-up composer when spora:focus-followup fires (Plan C)', async () => {
    // Plan C: the Aborted banner dispatches this event when the user clicks
    // the new Resume button. The page listens and routes through the
    // TaskChatFollowup component ref, which exposes `focus()` so the
    // page doesn't have to reach into md-editor-v3's nested
    // `[contenteditable]` subtree.
    activeTaskRef.value = loadedTask()
    const wrapper = mountPage()
    await flushPromises()

    try {
      document.dispatchEvent(new CustomEvent('spora:focus-followup', { bubbles: true }))
      await flushPromises()
      expect(focusStub).toHaveBeenCalledTimes(1)
    } finally {
      wrapper.unmount()
    }
  })

  it('focuses the follow-up composer when the active task transitions to ABORTED', async () => {
    // The auto-focus-on-ABORTED watch path. Same focus endpoint as the
    // Resume button (TaskChatFollowup.focus()) — the user just clicked
    // Abort and the next keystroke belongs in the composer.
    activeTaskRef.value = loadedTask({ status: 'RUNNING' })
    const wrapper = mountPage()
    await flushPromises()
    focusStub.mockClear()
    expect(focusStub).not.toHaveBeenCalled()

    activeTaskRef.value = loadedTask({ status: 'ABORTED' })
    await flushPromises()
    await flushPromises()
    expect(focusStub).toHaveBeenCalledTimes(1)

    // Re-firing on a status that's already ABORTED must not refocus.
    activeTaskRef.value = loadedTask({ status: 'ABORTED' })
    await flushPromises()
    await flushPromises()
    expect(focusStub).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
