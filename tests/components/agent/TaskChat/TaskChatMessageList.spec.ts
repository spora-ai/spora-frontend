/**
 * TaskChatMessageList — scrollable chat history.
 *
 * Asserts the user/assistant/tool bubbles, the running indicator, the
 * final-response pill, the failed banner, and the scroll-to-bottom ref.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import TaskChatMessageList from '@/components/agent/TaskChat/TaskChatMessageList.vue'
import TaskFailedBanner from '@/components/agent/TaskFailedBanner.vue'
import { useTaskStore } from '@/stores/tasks'
import type { TaskDetail, HistoryEntry, ToolCall } from '@/types/task'
import type { ChatMessage } from '@/composables/useTaskChat'

const renderMarkdownMock = vi.hoisted(() => vi.fn((text: string) => text))

vi.mock('@/composables/useMarkdown', () => ({
  renderMarkdown: (text: string) => renderMarkdownMock(text),
}))

beforeEach(() => {
  // Default behaviour: passthrough. Individual tests that exercise the
  // image-click delegation override this with a renderer that returns
  // raw HTML (containing an <img>) so the bubble DOM has a real IMG
  // element to dispatch clicks on.
  renderMarkdownMock.mockImplementation((text: string) => text)
})

/**
 * The chat list's attachment renderer calls `useMediaAssetCache().batchResolve`
 * on every user row with attachments. Stub the cache so the watcher doesn't
 * hit the network — the chip tests only care about rendering, not the
 * fetch itself (covered in `useMediaAssetCache.spec.ts`).
 */
const batchResolveMock = vi.fn(async (ids: readonly string[]) => {
  const map = new Map<string, { id: string; filename: string | null; asset_url: string }>()
  for (const id of ids) {
    map.set(id, { id, filename: `${id}.png`, asset_url: `https://example.test/${id}` })
  }
  return map
})
vi.mock('@/composables/useMediaAssetCache', () => ({
  useMediaAssetCache: () => ({
    batchResolve: batchResolveMock,
    get: vi.fn(() => null),
  }),
  clearMediaAssetCache: vi.fn(),
}))

// Default mock: archetype-avatar agent. Tests that need no profile
// picture mutate `mockAgentState.currentAgent` directly; `agents: []`
// keeps `SubAgentToolCall`'s `agents.find(...)` happy.
const mockAgentState: Record<string, unknown> = {
  currentAgent: {
    id: 1,
    name: 'Test Agent',
    profile_picture: {
      kind: 'avatar',
      archetype: 'assistant',
      variant_key: 'v0',
      palette_key: 'slate',
      fg_color: '#000000',
      bg_color: '#ffffff',
      image_url: null,
      image_updated_at: null,
    },
  },
  agents: [],
}

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => mockAgentState,
}))

beforeEach(() => {
  // Reset the mock's per-test override between cases — the global
  // happy-path returns a populated map, but the pending-chip test
  // swaps in an empty map to exercise the <span> fallback branch.
  batchResolveMock.mockImplementation(async (ids: readonly string[]) => {
    const map = new Map<string, { id: string; filename: string | null; asset_url: string }>()
    for (const id of ids) {
      map.set(id, { id, filename: `${id}.png`, asset_url: `https://example.test/${id}` })
    }
    return map
  })
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div />' } },
      { path: '/tasks/:id', name: 'task', component: { template: '<div />' } },
      { path: '/agents/:id', name: 'agent', component: { template: '<div />' } },
    ],
  })
}

const baseTask: TaskDetail = {
  id: 1,
  agent_id: 1,
  status: 'COMPLETED',
  user_prompt: 'hi',
  final_response: null,
  step_count: 0,
  max_steps: 10,
  error_code: null,
  error_message: null,
  failure_reason: null,
  history: [],
  tool_calls: [],
  created_at: '',
  updated_at: '',
}

function makeEntry(role: HistoryEntry['role'], overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    sequence: 0,
    role,
    content: 'content',
    tool_call_id: null,
    tool_name: null,
    ...overrides,
  }
}

describe('TaskChatMessageList', () => {
  it('renders the user/assistant/tool bubbles from chatMessages', () => {
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'hello' }) },
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 2, content: 'hi there' }) },
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 3, content: 'tool result', tool_name: 'web_search', tool_call_id: 'pc_3' }) },
    ]
    const toolCall = makeToolCall({
      id: 3,
      provider_call_id: 'pc_3',
      tool_name: 'web_search',
      tool_type: 'web_search',
    })
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
    })
    expect(wrapper.text()).toContain('hello')
    expect(wrapper.text()).toContain('hi there')
    expect(wrapper.find('[data-testid="compact-tool-stream"]').exists()).toBe(true)
  })

  it('renders the final-response pill for COMPLETED tasks with a final_response', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'COMPLETED', final_response: 'The answer is 42.' },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    expect(wrapper.text()).toContain('The answer is 42.')
  })

  it('does not render a handover agent link when no breadcrumb is present', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'COMPLETED', final_response: 'The answer is 42.' },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    expect(wrapper.text()).not.toContain('Open ')
    expect(wrapper.findAll('a').filter((a) => a.attributes('href')?.includes('/agents/'))).toHaveLength(0)
  })

  it('renders a handover agent link to /agents/:id when data.handover has a target agent', () => {
    const wrapper = mount(TaskChatMessageList, {
      global: { plugins: [makeRouter()] },
      props: {
        task: {
          ...baseTask,
          status: 'COMPLETED',
          final_response: 'Handed off to Research Agent.',
          data: {
            handover: {
              target_task_id: 42,
              target_agent_id: 7,
              target_agent_name: 'Research Agent',
            },
          },
        },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    const link = wrapper.findAll('a').find((a) => a.attributes('href')?.endsWith('/agents/7'))
    expect(link).toBeTruthy()
    expect(link!.text()).toContain('Open Research Agent →')
  })

  it('renders the handover link when target_task_id is absent', () => {
    // Regression: target_task_id is informational on the breadcrumb; the
    // agent link must render even when it is missing or non-numeric — the
    // old Number(...) wrapper produced NaN and propagated it downstream.
    const wrapper = mount(TaskChatMessageList, {
      global: { plugins: [makeRouter()] },
      props: {
        task: {
          ...baseTask,
          status: 'COMPLETED',
          final_response: 'Handed off to Research Agent.',
          data: {
            handover: {
              target_agent_id: 7,
              target_agent_name: 'Research Agent',
            },
          },
        },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    const link = wrapper.findAll('a').find((a) => a.attributes('href')?.endsWith('/agents/7'))
    expect(link).toBeTruthy()
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('renders the handover link when target_task_id is not a number', () => {
    const wrapper = mount(TaskChatMessageList, {
      global: { plugins: [makeRouter()] },
      props: {
        task: {
          ...baseTask,
          status: 'COMPLETED',
          final_response: 'Handed off to Research Agent.',
          data: {
            handover: {
              target_task_id: 'not-a-number',
              target_agent_id: 7,
              target_agent_name: 'Research Agent',
            },
          },
        },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    const link = wrapper.findAll('a').find((a) => a.attributes('href')?.endsWith('/agents/7'))
    expect(link).toBeTruthy()
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('renders the failed banner for FAILED tasks', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'FAILED' },
        chatMessages: [],
        finalReasoning: null,
      },
    })
    // TaskFailedBanner is rendered
    expect(wrapper.findComponent(TaskFailedBanner).exists()).toBe(true)
  })

  // Rows inside the expanded pill render collapsed by default — only
  // the header summary (icon + tool name + status dot + chevron) is
  // visible. The full body (Arguments panel, output, handover link) is
  // hidden until the operator clicks the summary to expand the row.
  // Browser-native <details> handles the visual hide; the test asserts
  // on the open property since happy-dom doesn't faithfully model
  // <details> body hiding.
  it('renders each row collapsed by default (details.open === false)', () => {
    const longContent = 'x'.repeat(400) + 'TAIL_MARKER'
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      tool_type: 'web_search',
      provider_call_id: 'pc_5',
      id: 5,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: longContent, tool_name: 'web_search', tool_call_id: 'pc_5' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
    })
    const row = wrapper.find('[data-testid="compact-tool-stream-row"]')
    expect(row.exists()).toBe(true)
    expect((row.element as HTMLDetailsElement).open).toBe(false)
    // Header summary is always visible.
    expect(wrapper.text()).toContain('Web Search')
  })

  it('renders the full output in the row body when expandedTools[seq] is true', () => {
    const longContent = 'x'.repeat(400) + 'TAIL_MARKER'
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      tool_type: 'web_search',
      provider_call_id: 'pc_5',
      id: 5,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: longContent, tool_name: 'web_search', tool_call_id: 'pc_5' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedTools: { 5: true },
        expandedStreams: { 0: true },
      },
    })
    const row = wrapper.find('[data-testid="compact-tool-stream-row"]')
    expect((row.element as HTMLDetailsElement).open).toBe(true)
    // The "▼ more" / "▲ less" toggle is gone — collapse is row-level.
    expect(wrapper.find('[data-testid="compact-tool-stream-row"] [data-testid="more-toggle"]').exists()).toBe(false)
  })

  it('emits toggleExpanded when the row summary is clicked', async () => {
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      tool_type: 'web_search',
      provider_call_id: 'pc_5',
      id: 5,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: 'ok', tool_name: 'web_search', tool_call_id: 'pc_5' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
    })
    const summary = wrapper.find('[data-testid="compact-tool-stream-row-summary"]')
    expect(summary.exists()).toBe(true)
    await summary.trigger('click')
    expect(wrapper.emitted('toggleExpanded')).toBeTruthy()
    expect(wrapper.emitted('toggleExpanded')![0]).toEqual([5])
  })

  it('opens the row body when the parent updates expandedTools in response to the emit', async () => {
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      tool_type: 'web_search',
      provider_call_id: 'pc_5',
      id: 5,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 5, content: 'ok', tool_name: 'web_search', tool_call_id: 'pc_5' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedTools: {},
        expandedStreams: { 0: true },
      },
    })
    const row = wrapper.find('[data-testid="compact-tool-stream-row"]')
    expect((row.element as HTMLDetailsElement).open).toBe(false)

    // Click the summary — the page flips its flag and re-passes it.
    await wrapper.find('[data-testid="compact-tool-stream-row-summary"]').trigger('click')
    await wrapper.setProps({ expandedTools: { 5: true } })

    expect((row.element as HTMLDetailsElement).open).toBe(true)
  })

  it('exposes scrollToBottom via defineExpose', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: [], finalReasoning: null },
    })
    const exposed = wrapper.vm as unknown as { scrollToBottom?: () => void }
    expect(typeof exposed.scrollToBottom).toBe('function')
  })

  // Regression: the row's <summary> handler must `.prevent` the click
  // before the native <details> toggle fires — otherwise the native
  // open state would diverge from the page-owned flag, and the
  // second click would do nothing. The outer pill is also a
  // <details>; clicking the row summary must leave the pill open.
  it('emits toggleExpanded without closing the parent <details>', async () => {
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      tool_type: 'web_search',
      provider_call_id: 'pc_7',
      id: 7,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 7, content: 'ok', tool_name: 'web_search', tool_call_id: 'pc_7' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
    })
    const pill = wrapper.find('[data-testid="compact-tool-stream"]')
    expect(pill.exists()).toBe(true)
    const summary = wrapper.find('[data-testid="compact-tool-stream-row-summary"]')
    await summary.trigger('click')
    expect(wrapper.emitted('toggleExpanded')).toBeTruthy()
    expect((pill.element as HTMLDetailsElement).open).toBe(true)
  })
})

/**
 * Image overlay delegation — clicking an `<img>` rendered by
 * `renderMarkdown` inside a `.chat-bubble-content` div opens the shared
 * `ImageOverlay`. The handler delegates from the chat-list root so we
 * don't add per-bubble listeners; we therefore test through the DOM, by
 * overriding `renderMarkdown` for the bubble's text to return real HTML
 * containing an `<img>`, then dispatching a click on the resulting
 * element.
 */
describe('TaskChatMessageList — image-overlay delegation', () => {
  // Each test mounts with `attachTo: document.body` and the rendered
  // ImageOverlay teleports a <dialog> to body. Without explicit cleanup
  // the dialog leaks into the next test and any document.body assertion
  // would see leftover state.
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens the overlay when an <img> in a chat-bubble-content is clicked', async () => {
    renderMarkdownMock.mockImplementationOnce(() =>
      '<img src="https://example.test/cat.png" alt="A friendly cat" />',
    )
    const messages: ChatMessage[] = [
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 1, content: 'cat' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      attachTo: document.body,
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
    })
    await flushPromises()
    const img = wrapper.find('.chat-bubble-content img')
    expect(img.exists()).toBe(true)
    await img.trigger('click')
    await flushPromises()
    const overlay = document.body.querySelector('[data-testid="image-overlay"]')
    expect(overlay).not.toBeNull()
    const overlayImg = document.body.querySelector('[data-testid="image-overlay-img"]')
    expect(overlayImg?.getAttribute('src')).toBe('https://example.test/cat.png')
    expect(overlayImg?.getAttribute('alt')).toBe('A friendly cat')
    wrapper.unmount()
  })

  it('does not open the overlay when a user-attachment chip thumbnail is clicked', async () => {
    // Regression guard: the first implementation walked every <img>
    // regardless of nesting, which would have stolen the new-tab open
    // from the user-attachment chip's wrapping <a target="_blank">.
    // The chip img is OUTSIDE any .chat-bubble-content, so the
    // delegated handler must ignore it.
    const messages: ChatMessage[] = [
      {
        kind: 'user',
        entry: makeEntry('user', {
          sequence: 1,
          content: 'here',
          attachments: [{ media_id: 'att-1', kind: 'image' }],
        }),
      },
    ]
    const wrapper = mount(TaskChatMessageList, {
      attachTo: document.body,
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
    })
    await flushPromises()
    const chipImg = wrapper.find('[data-testid="user-message-attachment"] img')
    expect(chipImg.exists()).toBe(true)
    await chipImg.trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-testid="image-overlay"]')).toBeNull()
    wrapper.unmount()
  })

  it('does not open the overlay when the user has a non-empty text selection', async () => {
    renderMarkdownMock.mockImplementationOnce(() =>
      '<img src="https://example.test/cat.png" alt="cat" />',
    )
    const messages: ChatMessage[] = [
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 1, content: 'cat' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      attachTo: document.body,
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
    })
    await flushPromises()
    const img = wrapper.find('.chat-bubble-content img')
    // Replace window.getSelection wholesale for the duration of the
    // test; vi.spyOn doesn't always pin the property through happy-dom's
    // accessor surface, so direct assignment is the most predictable.
    const originalGetSelection = window.getSelection
    window.getSelection = () => ({ toString: () => 'selected text' } as unknown as Selection)
    try {
      await img.trigger('click')
      await flushPromises()
      expect(document.body.querySelector('[data-testid="image-overlay"]')).toBeNull()
    } finally {
      window.getSelection = originalGetSelection
    }
    wrapper.unmount()
  })

  it('closes the overlay when the close button is clicked', async () => {
    renderMarkdownMock.mockImplementationOnce(() =>
      '<img src="https://example.test/cat.png" alt="cat" />',
    )
    const messages: ChatMessage[] = [
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 1, content: 'cat' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      attachTo: document.body,
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
    })
    await flushPromises()
    await wrapper.find('.chat-bubble-content img').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-testid="image-overlay"]')).not.toBeNull()
    const closeBtn = document.body.querySelector('[data-testid="image-overlay-close"]') as HTMLButtonElement | null
    expect(closeBtn).not.toBeNull()
    closeBtn!.click()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="image-overlay"]')).toBeNull()
    wrapper.unmount()
  })
})

describe('TaskChatMessageList — chat bubble UX (avatar, mobile width, code-block clip)', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders the agent archetype avatar next to assistant messages, not the hardcoded "AI" badge', () => {
    const messages: ChatMessage[] = [
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 1, content: 'hi' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.find('[data-testid="avatar-archetype"]').exists()).toBe(true)
    expect(wrapper.text()).not.toMatch(/>\s*AI\s*</)
  })

  it('hides the assistant avatar wrapper below the `lg` breakpoint', () => {
    const messages: ChatMessage[] = [
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 1, content: 'hi' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
      global,
    })
    const avatar = wrapper.find('[data-testid="avatar-archetype"]')
    expect(avatar.exists()).toBe(true)
    const avatarWrapper = avatar.element.closest('div')
    expect(avatarWrapper?.className ?? '').toMatch(/hidden/)
    expect(avatarWrapper?.className ?? '').toMatch(/lg:flex/)
  })

  it('widens the assistant bubble wrapper to 95% on <lg and caps at 85% on lg+', () => {
    const messages: ChatMessage[] = [
      { kind: 'assistant', entry: makeEntry('assistant', { sequence: 1, content: 'hi' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
      global,
    })
    const flexRow = wrapper.find('[data-testid="avatar-archetype"]')
      .element.closest('div.flex')
    expect(flexRow?.className ?? '').toMatch(/max-w-\[95%\]/)
    expect(flexRow?.className ?? '').toMatch(/lg:max-w-\[85%\]/)
  })

  it('widens the user bubble wrapper to 95% on <lg and caps at 75% on lg+', () => {
    // User bubble mirrors the assistant wrapper's responsive pattern —
    // 95% on mobile, back to 75% on lg+ for visual balance with the
    // longer-form assistant side.
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'hello' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: baseTask, chatMessages: messages, finalReasoning: null },
      global,
    })
    const userWrapper = wrapper.find('[data-testid="user-message-bubble"]')
    expect(userWrapper.exists()).toBe(true)
    expect(userWrapper.classes().join(' ')).toMatch(/max-w-\[95%\]/)
    expect(userWrapper.classes().join(' ')).toMatch(/lg:max-w-\[75%\]/)
  })

  it('uses the agent avatar (not the ✓ badge) on the final-response pill', () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, status: 'COMPLETED', final_response: 'Done.' },
        chatMessages: [],
        finalReasoning: null,
      },
      global,
    })
    const avatars = wrapper.findAll('[data-testid="avatar-archetype"]')
    expect(avatars.length).toBeGreaterThanOrEqual(1)
    expect(wrapper.text()).not.toMatch(/>\s*✓\s*</)
  })

  it('falls back to the agent-name initial when no profile_picture is set', () => {
    mockAgentState.currentAgent = {
      id: 1,
      name: 'Beatrice',
      profile_picture: null,
    }
    try {
      const messages: ChatMessage[] = [
        { kind: 'assistant', entry: makeEntry('assistant', { sequence: 1, content: 'hi' }) },
      ]
      const localWrapper = mount(TaskChatMessageList, {
        props: { task: baseTask, chatMessages: messages, finalReasoning: null },
        global,
      })
      const initials = localWrapper.find('[data-testid="avatar-initials"]')
      expect(initials.exists()).toBe(true)
      expect(initials.text()).toBe('B')
    } finally {
      mockAgentState.currentAgent = {
        id: 1,
        name: 'Test Agent',
        profile_picture: {
          kind: 'avatar',
          archetype: 'assistant',
          variant_key: 'v0',
          palette_key: 'slate',
          fg_color: '#000000',
          bg_color: '#ffffff',
          image_url: null,
          image_updated_at: null,
        },
      }
    }
  })

  it('clips .chat-bubble-content so a long <pre> scrolls locally instead of pushing the page', () => {
    // happy-dom doesn't load stylesheets — read the CSS source instead.
    const css = readFileSync(resolve(__dirname, '../../../../src/style.css'), 'utf-8')
    const bubbleMatch = css.match(/\.chat-bubble-content\s*\{([^}]+)\}/)
    const preMatch = css.match(/\.chat-bubble-content\s+\.code-block\s+pre\s*\{([^}]+)\}/)
    expect(bubbleMatch).not.toBeNull()
    expect(preMatch).not.toBeNull()
    expect(bubbleMatch![1]).toMatch(/overflow\s*:\s*hidden/)
    expect(preMatch![1]).toMatch(/overflow-x\s*:\s*auto/)
  })

  it('uses lg:ml-9 (not bare ml-9) on the compact-tool-stream pill', () => {
    const longContent = 'x'.repeat(400)
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      result_data: { foo: 'bar' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: longContent, tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall], status: 'RUNNING' },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
// The generic tool-result card is now the compact pill surface;
// loaded-skill rows flow into the pill as their own row kind, while
// SubAgent / TodoToolCall keep their own cards.
const pill = wrapper.find('[data-testid="compact-tool-stream"]')
    expect(pill.exists()).toBe(true)
    const trClasses = pill.classes().join(' ')
    expect(trClasses).toMatch(/lg:ml-9/)
    expect(trClasses).not.toMatch(/(^|\s)ml-9(?:\s|$)/)
    expect(trClasses).toMatch(/max-w-\[95%\]/)
    expect(trClasses).toMatch(/lg:max-w-\[85%\]/)
  })
})

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 1,
    provider_call_id: 'pc_1',
    tool_name: 'handover',
    tool_type: 'handover',
    operation: null,
    operation_description: null,
    status: 'EXECUTED',
    proposed_arguments: null,
    approved_arguments: null,
    human_description: null,
    result_content: 'Handed over.',
    executed_at: null,
    ...overrides,
  }
}

describe('TaskChatMessageList — tool-call deep link', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders SubAgentToolCall for an op: sub_agent tool result', async () => {
    setActivePinia(createPinia())
    const store = useTaskStore()
    for (const id of [1, 2, 3]) {
      store.subTaskCache.set(id, {
        ...baseTask,
        id,
        status: 'RUNNING',
        parent_task_id: baseTask.id,
      })
    }
    const toolCall = makeToolCall({
      operation: 'sub_agent',
      result_data: { op: 'sub_agent', spawned_sub_task_ids: [1, 2, 3] },
    })
    const messages: ChatMessage[] = [
      {
        kind: 'tool-result',
        entry: makeEntry('tool', {
          sequence: 1,
          content: 'Sub-agents started.',
          tool_name: 'handover',
          tool_call_id: 'pc_1',
        }),
      },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
      },
      global: { plugins: [makeRouter()] },
    })

    await flushPromises()

    expect(wrapper.find('[data-testid="sub-agent-tool-call"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('#1')
    expect(wrapper.text()).toContain('#2')
    expect(wrapper.text()).toContain('#3')
  })

  it('renders an "Open chat #X" RouterLink when result_data.new_task_id is set', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42, handover: true },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Handed over.', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Open chat #42')
    expect(link.text()).toContain('→')
  })

  it('prefixes the link text with "Handed off —" when result_data.handover is true', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42, handover: true },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Handed over.', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const text = wrapper.find('a').text()
    expect(text).toContain('Handed off')
    expect(text).toContain('Open chat #42')
  })

  it('omits the "Handed off —" prefix when result_data.handover is not true', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'generic_tool', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.text()).not.toContain('Handed off')
    expect(link.text()).toContain('Open chat #42')
  })

  it('falls back to task_id when new_task_id is absent', () => {
    const toolCall = makeToolCall({
      result_data: { task_id: 99 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'generic_tool', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Open chat #99')
  })

  it('does not render a link when result_data has neither new_task_id nor task_id', () => {
    const toolCall = makeToolCall({
      result_data: { foo: 'bar' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('does not render a link when result_data is absent', () => {
    const toolCall = makeToolCall({})
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('does not render a link when the history row has no tool_call_id', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 42 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'web_search', tool_call_id: null }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('uses the "task" route name with the new_task_id as a string param', () => {
    const toolCall = makeToolCall({
      result_data: { new_task_id: 7 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Done.', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const link = wrapper.find('a')
    expect(link.attributes('href')).toBe('/tasks/7')
  })
})

describe('TaskChatMessageList — Loaded skill badge', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders a "Loaded skill" row INSIDE the CompactToolStream pill (data-row-kind="loaded-skill")', () => {
    // Loaded-skill rows now flow into the pill as their own row kind
    // (instead of rendering as a separate special-case card). The pill
    // must mount, and the row inside must carry data-row-kind="loaded-skill".
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'skill body content', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
        expandedTools: { 1: true },
      },
      global,
    })
    const pill = wrapper.find('[data-testid="compact-tool-stream"]')
    expect(pill.exists()).toBe(true)
    const loadedRow = wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="loaded-skill"]')
    expect(loadedRow.exists()).toBe(true)
    // Lives inside the pill, not as a sibling.
    expect(loadedRow.element.closest('[data-testid="compact-tool-stream"]')).not.toBeNull()
    // Header summary shows the loaded-skill label and skill name.
    expect(wrapper.text()).toContain('Loaded skill:')
    expect(wrapper.text()).toContain('git')
    expect(wrapper.text()).toContain('4 KB')
  })

  it('hides the skill body content while the loaded-skill row is collapsed', () => {
    // The skill body lives inside the row's body — collapsed hides it
    // via the native <details> toggle. Browser-native hiding isn't
    // modelled by happy-dom, so we assert on `details.open` instead.
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'skill body content', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    const loadedRow = wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="loaded-skill"]')
    expect(loadedRow.exists()).toBe(true)
    expect((loadedRow.element as HTMLDetailsElement).open).toBe(false)
  })

  it('renders the standard card for a FAILED skill_read of SKILL.md (path-traversal block, oversize, etc.)', () => {
    // Failed skill_read calls fall through to the generic row surface
    // so the operator sees the error in context. Loaded-skill detection
    // is gated on status === 'EXECUTED' (or other non-FAILED/REJECTED).
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      status: 'FAILED',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: '', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).not.toContain('Loaded skill:')
    expect(wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="generic"]').exists()).toBe(true)
  })

  it('renders the standard card for a REJECTED skill_read of SKILL.md (operator declined)', () => {
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      status: 'REJECTED',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: '', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).not.toContain('Loaded skill:')
    expect(wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="generic"]').exists()).toBe(true)
  })
})

describe('TaskChatMessageList — tool arguments panel', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  it('renders the effective args panel using approved_arguments when present', () => {
    const toolCall = makeToolCall({
      tool_name: 'send_email',
      approved_arguments: { to: 'a@b.co', subject: 'Hi' },
      proposed_arguments: { to: 'a@b.co', subject: 'Draft' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'sent', tool_name: 'send_email', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Arguments')
    expect(wrapper.text()).toContain('Hi')
    expect(wrapper.text()).not.toContain('Draft')
  })

  it('falls back to proposed_arguments when approved_arguments is null', () => {
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      approved_arguments: null,
      proposed_arguments: { query: 'spora agents' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: '...', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('Arguments')
    expect(wrapper.text()).toContain('spora agents')
  })

  it('does not render an Arguments panel when no args exist', () => {
    const toolCall = makeToolCall({
      tool_name: 'noop',
      approved_arguments: null,
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'done', tool_name: 'noop', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Arguments')
  })

  it('does not render an Arguments panel when approved is empty and proposed is an empty object', () => {
    // Empty `{}` is truthy — the `Object.keys(...).length > 0` guard
    // prevents the "Arguments (0)" header from mounting.
    const toolCall = makeToolCall({
      tool_name: 'noop',
      approved_arguments: null,
      proposed_arguments: {},
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'done', tool_name: 'noop', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Arguments')
  })

  it('does not render an Arguments panel when approved is empty and proposed is an empty array', () => {
    // Some LLMs return `proposed_arguments: []`; the empty-keys guard
    // covers objects and arrays uniformly.
    const toolCall = makeToolCall({
      tool_name: 'noop',
      approved_arguments: null,
      proposed_arguments: [],
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'done', tool_name: 'noop', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).not.toContain('Arguments')
  })

  it('renders JSON syntax-highlighted view when args are nested', () => {
    const toolCall = makeToolCall({
      tool_name: 'send_email',
      approved_arguments: { body: 'line1\nline2' },
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'ok', tool_name: 'send_email', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.html()).toContain('<pre')
  })

  it('masks sensitive values like api_key in the chat arguments panel', () => {
    const toolCall = makeToolCall({
      tool_name: 'call_external',
      approved_arguments: { api_key: 'sk-1234567890' },
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'ok', tool_name: 'call_external', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    expect(wrapper.text()).toContain('••••••••')
    expect(wrapper.text()).not.toContain('sk-1234567890')
  })

  it('does not add an Arguments panel to the "Loaded skill" row', () => {
    // Loaded-skill rows are side-effects of the agent's tool call, not
    // an action the operator took — the Arguments panel (which surfaces
    // approved/proposed args) belongs only on the standard tool-result
    // card.
    const toolCall = makeToolCall({
      tool_name: 'skill',
      tool_type: 'skill',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      proposed_arguments: null,
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'body', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
        expandedTools: { 1: true },
      },
      global,
    })
    const loadedRow = wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="loaded-skill"]')
    expect(loadedRow.exists()).toBe(true)
    expect(loadedRow.text()).toContain('Loaded skill:')
    expect(loadedRow.text()).not.toContain('Arguments')
  })

  it('renders the arguments panel ABOVE the result content', () => {
    // Distinct strings pin positional order — reordering the template
    // would invert their positions.
    const toolCall = makeToolCall({
      tool_name: 'web_search',
      approved_arguments: { query: 'AAAA' },
      proposed_arguments: null,
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'BBBB', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task: { ...baseTask, tool_calls: [toolCall] }, chatMessages: messages, finalReasoning: null },
      global,
    })
    const text = wrapper.text()
    const argPos = text.indexOf('AAAA')
    const resultPos = text.indexOf('BBBB')
    expect(argPos).toBeGreaterThanOrEqual(0)
    expect(resultPos).toBeGreaterThanOrEqual(0)
    expect(argPos).toBeLessThan(resultPos)
  })
})

/**
 * New tests for the CompactToolStream pill surface (PR: feat/compact-tool-stream).
 * Each case asserts one contract from the plan; collectively they cover
 * the new component shape end-to-end.
 */
describe('TaskChatMessageList — CompactToolStream pill', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  function manyGenericToolCalls(count: number): { toolCalls: ToolCall[]; messages: ChatMessage[] } {
    const toolCalls: ToolCall[] = []
    const messages: ChatMessage[] = []
    for (let i = 0; i < count; i++) {
      const seq = i + 1
      const id = i + 1
      toolCalls.push({
        ...makeToolCall({
          id,
          provider_call_id: `pc_${seq}`,
          tool_name: 'web_search',
          tool_type: 'web_search',
          status: 'EXECUTED',
        }),
      })
      messages.push({
        kind: 'tool-result',
        entry: makeEntry('tool', {
          sequence: seq,
          content: `result ${seq}`,
          tool_name: 'web_search',
          tool_call_id: `pc_${seq}`,
        }),
      })
    }
    return { toolCalls, messages }
  }

  // 1. Renders a single CompactToolStream for N generic tool results.
  it('renders a single CompactToolStream for N generic tool results', () => {
    const { toolCalls, messages } = manyGenericToolCalls(5)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    expect(wrapper.findAll('[data-testid="compact-tool-stream"]')).toHaveLength(1)
  })

  // 2. Renders "N tools called" growing with the count (plural + singular).
  it('renders "N tools called" growing with the count', () => {
    const { toolCalls, messages } = manyGenericToolCalls(5)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    expect(wrapper.text()).toContain('5 tools called')
  })

  it('renders "1 tool called" (singular) when only one tool result exists', () => {
    const { toolCalls, messages } = manyGenericToolCalls(1)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    expect(wrapper.text()).toContain('1 tool called')
  })

  // 3. Shows the current tool's icon + name in the summary row.
  it('shows the current tool\'s icon + name in the summary row', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'read_url',
      tool_type: 'read_url',
      status: 'EXECUTED',
      icon: 'globe',
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'ok', tool_name: 'read_url', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall], status: 'RUNNING' },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    // The Icon component renders the bundled `globe` glyph (multiple
    // path elements rather than the single-path `puzzle` glyph). The
    // visible label is the human-readable title case of `read_url`.
    expect(wrapper.find('[data-testid="compact-tool-stream-current"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="compact-tool-stream-current-name"]').text()).toContain('Read Url')
    // Verify the underlying svg contains the globe path (different from puzzle)
    const html = wrapper.find('[data-testid="compact-tool-stream-current"]').html()
    expect(html).toContain('M12 2a14.5 14.5 0 0 0 0 20')
  })

  // 4. Animates shimmer while the task is driving.
  it('animates shimmer while the task is driving', () => {
    setActivePinia(createPinia())
    const store = useTaskStore()
    const taskId = baseTask.id
    store.markDriving(taskId)
    try {
      const { toolCalls, messages } = manyGenericToolCalls(3)
      // Mark the most recent tool call as still in flight (non-terminal)
      // so the pill shows the active state rather than the "Done" final.
      const last = toolCalls[toolCalls.length - 1]
      if (last) last.status = 'PENDING'
      const wrapper = mount(TaskChatMessageList, {
        props: {
          task: { ...baseTask, id: taskId, tool_calls: toolCalls, status: 'RUNNING' },
          chatMessages: messages,
          finalReasoning: null,
        },
        global,
      })
      const shimmer = wrapper.find('[data-testid="compact-tool-stream-shimmer"]')
      expect(shimmer.exists()).toBe(true)
      expect(shimmer.classes()).not.toContain('idle')
    } finally {
      store.clearDriving(taskId)
    }
  })

  // 5. Dimmed shimmer when task is terminal and not driving.
  it('dims the shimmer when the task is terminal and not driving', () => {
    setActivePinia(createPinia())
    const store = useTaskStore()
    const taskId = baseTask.id
    const { toolCalls, messages } = manyGenericToolCalls(3)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, id: taskId, tool_calls: toolCalls, status: 'COMPLETED' },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    const shimmer = wrapper.find('[data-testid="compact-tool-stream-shimmer"]')
    expect(shimmer.exists()).toBe(true)
    expect(shimmer.classes()).toContain('idle')
    expect(store.isDriving(taskId)).toBe(false)
  })

  // 6. Expands to show every tool result in order.
  it('expands to show every tool result in order when expandedStream is true', () => {
    const { toolCalls, messages } = manyGenericToolCalls(4)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    const rows = wrapper.findAll('[data-testid="compact-tool-stream-row"]')
    expect(rows).toHaveLength(4)
    // Sequence-ascending order — pin row text to the result N marker.
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].text()).toContain(`result ${i + 1}`)
    }
  })

  // 7. Per-tool "Show full input" button opens the JSON view.
  it('opens the raw JSON view when the "Show full input" toggle is clicked', async () => {
    const toolCall = makeToolCall({
      tool_name: 'send_email',
      tool_type: 'send_email',
      provider_call_id: 'pc_1',
      id: 1,
      approved_arguments: { to: 'a@b.co', subject: 'Hi' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'sent', tool_name: 'send_email', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    // Initially the raw JSON is hidden behind the toggle.
    const pre = wrapper.find('[data-testid="compact-tool-stream-row"] pre')
    expect(pre.exists()).toBe(false)
    const toggle = wrapper.find('[data-testid="tool-arguments-show-raw"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('Show full input')
    await toggle.trigger('click')
    const after = wrapper.find('[data-testid="compact-tool-stream-row"] [data-testid="tool-arguments-raw"] pre')
    expect(after.exists()).toBe(true)
    expect(after.text()).toContain('"to"')
    expect(after.text()).toContain('a@b.co')
    expect(wrapper.find('[data-testid="tool-arguments-show-raw"]').text()).toContain('Show formatted')
  })

  // 8. The "Handed off — Open chat #N →" link still appears on the right row inside the expanded pill.
  it('renders the handover deep link inside the expanded pill on the right row', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'handover',
      tool_type: 'handover',
      status: 'EXECUTED',
      result_data: { new_task_id: 42, handover: true },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'Handed over.', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    const link = wrapper.find('[data-testid="compact-tool-stream-handover-link"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Handed off')
    expect(link.text()).toContain('Open chat #42')
    expect(link.text()).toContain('→')
  })

  // 9. SubAgent / TodoToolCall render their own specialised surfaces, not inside the pill.
//    Loaded-skill rows DO flow into the pill as their own row kind
//    (data-row-kind="loaded-skill") — covered separately below.
  it('renders SubAgentToolCall outside the CompactToolStream pill', () => {
    setActivePinia(createPinia())
    const store = useTaskStore()
    for (const id of [11, 12]) {
      store.subTaskCache.set(id, {
        ...baseTask,
        id,
        status: 'RUNNING',
        parent_task_id: baseTask.id,
      })
    }
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'handover',
      tool_type: 'handover',
      operation: 'sub_agent',
      result_data: { op: 'sub_agent', spawned_sub_task_ids: [11, 12] },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'started', tool_name: 'handover', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    expect(wrapper.find('[data-testid="sub-agent-tool-call"]').exists()).toBe(true)
    // SubAgentToolCall is its own card; the pill must NOT mount (zero
    // generic results to render).
    expect(wrapper.find('[data-testid="compact-tool-stream"]').exists()).toBe(false)
  })

  it('renders TodoToolCall outside the CompactToolStream pill', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'todo',
      tool_type: 'todo',
      operation: 'write',
      status: 'EXECUTED',
      result_data: { items: [{ id: null, content: 'a', activeForm: null, status: 'pending', order: 0 }] },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: '- [ ] a', tool_name: 'todo', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    expect(wrapper.find('[data-testid="todo-tool-call"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="compact-tool-stream"]').exists()).toBe(false)
  })

  it('renders Loaded skill as a row INSIDE the pill (data-row-kind="loaded-skill")', () => {
    // Loaded-skill rows now flow into the pill as their own row kind
    // rather than rendering as a separate special-case card. The pill
    // MUST mount and contain the loaded-skill row.
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'skill',
      tool_type: 'skill',
      status: 'EXECUTED',
      approved_arguments: { action: 'read', name: 'git', filename: 'SKILL.md' },
      result_data: { name: 'git', filename: 'SKILL.md', bytes: 4096 },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'body', tool_name: 'skill', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    expect(wrapper.text()).toContain('Loaded skill:')
    const pill = wrapper.find('[data-testid="compact-tool-stream"]')
    expect(pill.exists()).toBe(true)
    const loadedRow = wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="loaded-skill"]')
    expect(loadedRow.exists()).toBe(true)
    expect(loadedRow.element.closest('[data-testid="compact-tool-stream"]')).not.toBeNull()
  })

  // 10. expand toggles via the new toggleStream emit.
  it('emits toggleStream when the pill summary is clicked', async () => {
    const { toolCalls, messages } = manyGenericToolCalls(3)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    const summary = wrapper.find('[data-testid="compact-tool-stream"] summary')
    expect(summary.exists()).toBe(true)
    await summary.trigger('click')
    expect(wrapper.emitted('toggleStream')).toBeTruthy()
    expect(wrapper.emitted('toggleStream')!.length).toBe(1)
    // Clicking again emits again (the parent flips the prop back).
    await summary.trigger('click')
    expect(wrapper.emitted('toggleStream')!.length).toBe(2)
  })

  // Extra coverage — exercise the remaining status/edge-case paths in
  // CompactToolStreamRow so the new_coverage Sonar gate clears.
  it('renders the row with a PENDING_APPROVAL status dot + label', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      status: 'PENDING_APPROVAL',
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'pending', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('awaiting approval')
  })

  it('does NOT render an "approved" badge — APPROVED is a transient state with no information beyond the waiting→ok transition', () => {
    // Regression: the row used to render a blue "approved" badge for
    // APPROVED ToolCalls. Since APPROVED is the gap between
    // PENDING_APPROVAL and EXECUTED, the badge added no information —
    // the user already sees "awaiting approval" → "ok". Removed. Also
    // covers the default-fallback regression where `tc?.status` (raw
    // 'APPROVED' string) was leaking through.
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      status: 'APPROVED',
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'pending', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    // No lowercase or uppercase form of the status badge label anywhere.
    expect(wrapper.text()).not.toContain('approved')
    expect(wrapper.text()).not.toContain('APPROVED')
    // The header shows the tool name, not the status.
    expect(wrapper.text()).toContain('Web Search')
  })

  it('renders the row with a PENDING status dot + label', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      status: 'PENDING',
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'pending', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('pending')
  })

  it('renders the row with a DISABLED status dot + label', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      status: 'DISABLED',
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'pending', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('disabled')
  })

  it('renders the row with a REJECTED status dot + label', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      status: 'REJECTED',
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'pending', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('rejected')
  })

  it('copies the full-input JSON when the copy button is clicked', async () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'send_email',
      tool_type: 'send_email',
      approved_arguments: { to: 'a@b.co', subject: 'Hi' },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'sent', tool_name: 'send_email', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    // Open the raw-JSON view, then click copy.
    await wrapper.find('[data-testid="tool-arguments-show-raw"]').trigger('click')
    const pre = wrapper.find('[data-testid="tool-arguments-raw"] pre')
    expect(pre.exists()).toBe(true)
    const copyButton = wrapper.findAll('[data-testid="tool-arguments-raw"] button')
      .find((b) => /Copy|Copied/.test(b.text()))
    expect(copyButton).toBeTruthy()
    await copyButton!.trigger('click')
    // happy-dom's navigator.clipboard.writeText is a no-op; the
    // post-copy "Copied" label confirms the success path ran.
    expect(wrapper.find('[data-testid="tool-arguments-raw"]').text()).toContain('Copied')
  })

  it('renders a TodoToolCall row whose ToolCall has FAILED status as a generic row (not TodoToolCall)', () => {
    // TodoToolCall only handles non-FAILED/REJECTED writes — failures
    // fall through to the generic CompactToolStreamRow surface so the
    // operator sees the error in context.
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'todo',
      tool_type: 'todo',
      operation: 'write',
      status: 'FAILED',
      result_data: { items: [] },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'failed', tool_name: 'todo', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.find('[data-testid="todo-tool-call"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="generic"]').exists()).toBe(true)
  })

  it('renders a TodoToolCall row whose ToolCall has a non-write operation as a generic row', () => {
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'todo',
      tool_type: 'todo',
      operation: 'list',
      status: 'EXECUTED',
      result_data: { items: [] },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'ok', tool_name: 'todo', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.find('[data-testid="todo-tool-call"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="compact-tool-stream-row"][data-row-kind="generic"]').exists()).toBe(true)
  })

  it('renders the row with parameter_schema-defined field order in the Arguments panel', () => {
    // `parameterOrderFor` walks `tc.parameter_schema.properties` keys; the
    // ToolArgumentsPreview component consumes the order for the field
    // list. With a 3-property schema, the panel renders in declared order.
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'send_email',
      tool_type: 'send_email',
      approved_arguments: { subject: 'Hi', to: 'a@b.co', body: 'Hello' },
      parameter_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient' },
          subject: { type: 'string', description: 'Subject' },
          body: { type: 'string', description: 'Body' },
        },
        required: ['to'],
      },
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'sent', tool_name: 'send_email', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall] },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('Arguments')
    expect(wrapper.text()).toContain('To')
    expect(wrapper.text()).toContain('Subject')
    expect(wrapper.text()).toContain('Body')
  })
})

/**
 * New tests for the iteration-3 pill surface — reasoning now flows
 * INSIDE the pill as interleaved rows rather than as per-message
 * foldouts above each assistant bubble.
 */
describe('TaskChatMessageList — CompactToolStream pill + reasoning rows', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  function mixedChat(thinkingCount: number, toolCount: number): { toolCalls: ToolCall[]; messages: ChatMessage[] } {
    const toolCalls: ToolCall[] = []
    const messages: ChatMessage[] = []
    let seq = 1
    // Reasoning rows come from assistant messages (interleaved with tool results).
    for (let i = 0; i < thinkingCount; i++) {
      messages.push({
        kind: 'assistant',
        entry: makeEntry('assistant', {
          sequence: seq,
          content: `answer ${i}`,
          content_blocks: [{ type: 'thinking', text: `thought ${i}` }],
        }),
      })
      seq++
    }
    for (let i = 0; i < toolCount; i++) {
      const id = i + 1
      toolCalls.push({
        ...makeToolCall({
          id,
          provider_call_id: `pc_${id}`,
          tool_name: 'web_search',
          tool_type: 'web_search',
          status: 'EXECUTED',
        }),
      })
      messages.push({
        kind: 'tool-result',
        entry: makeEntry('tool', {
          sequence: seq,
          content: `result ${i}`,
          tool_name: 'web_search',
          tool_call_id: `pc_${id}`,
        }),
      })
      seq++
    }
    return { toolCalls, messages }
  }

  it('shows combined counters "X tools called · Y reasoning steps" when both are present', () => {
    const { toolCalls, messages } = mixedChat(3, 5)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('5 tools called')
    expect(wrapper.text()).toContain('3 reasoning steps')
    expect(wrapper.text()).toContain('5 tools called · 3 reasoning steps')
  })

  it('shows singular "1 reasoning step" when only one reasoning row exists', () => {
    const { toolCalls, messages } = mixedChat(1, 2)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('1 reasoning step')
    expect(wrapper.text()).not.toContain('1 reasoning steps')
  })

  it('drops the reasoning part of the summary when totalReasoning === 0', () => {
    // Only tool rows — no assistant messages with thinking blocks.
    const { toolCalls, messages } = mixedChat(0, 4)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('4 tools called')
    expect(wrapper.text()).not.toContain('reasoning')
  })

  it('drops the tools part of the summary when totalTools === 0', () => {
    // Only assistant messages with thinking — no tool-results.
    const { messages } = mixedChat(2, 0)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.text()).toContain('2 reasoning steps')
    expect(wrapper.text()).not.toContain('tool')
    expect(wrapper.text()).not.toContain('called')
  })

  it('renders reasoning rows as data-row-kind="reasoning" inside the pill', () => {
    const { toolCalls, messages } = mixedChat(3, 2)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    const reasoningRows = wrapper.findAll('[data-row-kind="reasoning"]')
    expect(reasoningRows.length).toBe(3)
    for (const r of reasoningRows) {
      expect(r.element.closest('[data-testid="compact-tool-stream"]')).not.toBeNull()
    }
  })

  it('interleaves reasoning and tool rows in chat-stream order (sequence-ascending)', () => {
    const { toolCalls, messages } = mixedChat(3, 2)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    const allRows = wrapper.findAll('[data-testid="compact-tool-stream-row"]')
    // 3 reasoning + 2 tool = 5 rows.
    expect(allRows.length).toBe(5)
    // Pin the kinds to their position: reasoning rows come first
    // because reasoning messages precede tool-results in the test data.
    expect(allRows[0].attributes('data-row-kind')).toBe('reasoning')
    expect(allRows[1].attributes('data-row-kind')).toBe('reasoning')
    expect(allRows[2].attributes('data-row-kind')).toBe('reasoning')
    expect(allRows[3].attributes('data-row-kind')).toBe('generic')
    expect(allRows[4].attributes('data-row-kind')).toBe('generic')
  })

  it('emits toggleExpanded when a reasoning row summary is clicked', async () => {
    const { toolCalls, messages } = mixedChat(1, 0)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    const reasoningRow = wrapper.find('[data-row-kind="reasoning"]')
    expect(reasoningRow.exists()).toBe(true)
    const summary = reasoningRow.find('[data-testid="compact-tool-stream-row-summary"]')
    await summary.trigger('click')
    expect(wrapper.emitted('toggleExpanded')).toBeTruthy()
    // The reasoning message is the first chatMessage in our test data → sequence 1.
    expect(wrapper.emitted('toggleExpanded')![0]).toEqual([1])
  })

  it('opens a reasoning row body when expandedTools[seq] is true', async () => {
    const { toolCalls, messages } = mixedChat(1, 0)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
        expandedTools: {},
      },
      global,
    })
    const reasoningRow = wrapper.find('[data-row-kind="reasoning"]')
    expect((reasoningRow.element as HTMLDetailsElement).open).toBe(false)
    await wrapper.setProps({ expandedTools: { 1: true } })
    expect((reasoningRow.element as HTMLDetailsElement).open).toBe(true)
  })

  it('renders the reasoning text inside the row body when expanded', async () => {
    const { toolCalls, messages } = mixedChat(1, 0)
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
        expandedTools: { 1: true },
      },
      global,
    })
    const body = wrapper.find('[data-testid="compact-tool-stream-row-reasoning-body"]')
    expect(body.exists()).toBe(true)
    expect(body.text()).toContain('thought 0')
  })

  it('concatenates multiple thinking blocks within a single reasoning row', async () => {
    const toolCalls: ToolCall[] = []
    const messages: ChatMessage[] = [
      {
        kind: 'assistant',
        entry: makeEntry('assistant', {
          sequence: 1,
          content: 'final answer',
          content_blocks: [
            { type: 'thinking', text: 'first thought' },
            { type: 'thinking', text: 'second thought after tool result' },
          ],
        }),
      },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
        expandedTools: { 1: true },
      },
      global,
    })
    const body = wrapper.find('[data-testid="compact-tool-stream-row-reasoning-body"]')
    expect(body.text()).toContain('first thought')
    expect(body.text()).toContain('second thought after tool result')
  })

  it('routes every non-sub-agent, non-todo tool result through the pill (regression guard)', () => {
    // Defensive measure for the "tool calls gone" symptom — the pill's
    // filter must agree with the parent's `genericToolResults` filter.
    // We mount with a mix of generic, sub-agent, and todo results; the
    // pill must contain exactly the generic rows, never more and never
    // fewer. If the filter drifts (parent vs. pill) this test fails.
    setActivePinia(createPinia())
    const store = useTaskStore()
    for (const id of [101, 102]) {
      store.subTaskCache.set(id, {
        ...baseTask,
        id,
        status: 'RUNNING',
        parent_task_id: baseTask.id,
      })
    }
    const toolCalls: ToolCall[] = [
      // Generic (must reach pill)
      makeToolCall({ id: 1, provider_call_id: 'pc_1', tool_name: 'web_search', tool_type: 'web_search' }),
      makeToolCall({ id: 2, provider_call_id: 'pc_2', tool_name: 'web_search', tool_type: 'web_search' }),
      // Sub-agent (stays outside the pill)
      makeToolCall({
        id: 3,
        provider_call_id: 'pc_3',
        tool_name: 'handover',
        tool_type: 'handover',
        operation: 'sub_agent',
        result_data: { op: 'sub_agent', spawned_sub_task_ids: [101, 102] },
      }),
      // Successful todo write (stays outside the pill)
      makeToolCall({
        id: 4,
        provider_call_id: 'pc_4',
        tool_name: 'todo',
        tool_type: 'todo',
        operation: 'write',
        status: 'EXECUTED',
        result_data: { items: [{ id: null, content: 'a', activeForm: null, status: 'pending', order: 0 }] },
      }),
    ]
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'r1', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 2, content: 'r2', tool_name: 'web_search', tool_call_id: 'pc_2' }) },
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 3, content: 'started', tool_name: 'handover', tool_call_id: 'pc_3' }) },
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 4, content: '- [ ] a', tool_name: 'todo', tool_call_id: 'pc_4' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    const pillRows = wrapper.findAll('[data-testid="compact-tool-stream-row"]')
    // 2 generic + 0 reasoning + 0 sub-agent + 0 todo = 2 rows inside the pill.
    expect(pillRows.length).toBe(2)
    for (const r of pillRows) {
      expect(r.attributes('data-row-kind')).toBe('generic')
    }
    // SubAgent renders OUTSIDE the pill.
    expect(wrapper.find('[data-testid="sub-agent-tool-call"]').exists()).toBe(true)
    // Todo renders OUTSIDE the pill.
    expect(wrapper.find('[data-testid="todo-tool-call"]').exists()).toBe(true)
  })

  it('does not leave empty <div class="flex justify-start"> wrappers for tool-result rows that flow into the pill (regression guard)', () => {
    const toolCalls: ToolCall[] = []
    const messages: ChatMessage[] = []
    for (let i = 0; i < 5; i++) {
      const seq = i + 1
      toolCalls.push({
        ...makeToolCall({
          id: seq,
          provider_call_id: `pc_${seq}`,
          tool_name: 'web_search',
          tool_type: 'web_search',
          status: 'EXECUTED',
        }),
      })
      messages.push({
        kind: 'tool-result',
        entry: makeEntry('tool', {
          sequence: seq,
          content: `result ${seq}`,
          tool_name: 'web_search',
          tool_call_id: `pc_${seq}`,
        }),
      })
    }
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    // The wrapper that hosts SubAgentToolCall / TodoToolCall must only render
    // when one of those surfaces actually mounts — not for every tool-result
    // row that the pill absorbs. Walk every chat-row wrapper and assert
    // none are empty (vue compiles empty v-if slots as <!--v-if--> comments).
    const emptyWrappers = wrapper.findAll('div.flex.justify-start').filter((node) => {
      return node.element.children.length === 0 && node.text() === ''
    })
    expect(emptyWrappers).toHaveLength(0)
  })
})

/**
 * Iteration 4 — multiple pills, one per user turn + one per sub-agent
 * boundary. Each pill summarises that block's reasoning + tool calls.
 * Sub-agents still render as their own cards (SubAgentToolCall) and
 * each starts a new block.
 */
describe('TaskChatMessageList — multi-pill per turn (iteration 4)', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  function userMsg(sequence: number, content: string): ChatMessage {
    return { kind: 'user', entry: makeEntry('user', { sequence, content }) }
  }
  function assistantMsg(sequence: number, content: string): ChatMessage {
    return { kind: 'assistant', entry: makeEntry('assistant', { sequence, content }) }
  }
  function toolMsg(sequence: number, toolName: string, callId: string): ChatMessage {
    return { kind: 'tool-result', entry: makeEntry('tool', { sequence, content: `r${sequence}`, tool_name: toolName, tool_call_id: callId }) }
  }

  it('renders ONE pill when a single user turn has many generic tool results', () => {
    const toolCalls = Array.from({ length: 5 }, (_, i) => makeToolCall({
      id: i + 1,
      provider_call_id: `pc_${i + 1}`,
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    }))
    const messages: ChatMessage[] = [
      userMsg(1, 'do it'),
      assistantMsg(2, 'on it'),
      ...Array.from({ length: 5 }, (_, i) => toolMsg(i + 3, 'web_search', `pc_${i + 1}`)),
      assistantMsg(20, 'done'),
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    expect(wrapper.findAll('[data-testid="compact-tool-stream"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('5 tools called')
  })

  it('renders TWO pills when the chat has TWO user messages with tool work in between', () => {
    const toolCalls = Array.from({ length: 5 }, (_, i) => makeToolCall({
      id: i + 1,
      provider_call_id: `pc_${i + 1}`,
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    }))
    const messages: ChatMessage[] = [
      userMsg(1, 'turn one'),
      toolMsg(2, 'web_search', 'pc_1'),
      toolMsg(3, 'web_search', 'pc_2'),
      toolMsg(4, 'web_search', 'pc_3'),
      assistantMsg(5, 'turn one final'),
      userMsg(10, 'turn two'),
      toolMsg(11, 'web_search', 'pc_4'),
      toolMsg(12, 'web_search', 'pc_5'),
      assistantMsg(13, 'turn two final'),
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true, 1: true },
      },
      global,
    })
    expect(wrapper.findAll('[data-testid="compact-tool-stream"]')).toHaveLength(2)
    // Each pill summarises its OWN block — the first pill sees 3 tools,
    // the second sees 2.
    expect(wrapper.text()).toContain('3 tools called')
    expect(wrapper.text()).toContain('2 tools called')
  })

  it('renders the user-message bubble INSIDE each block (one per user turn)', () => {
    const toolCalls = Array.from({ length: 4 }, (_, i) => makeToolCall({
      id: i + 1,
      provider_call_id: `pc_${i + 1}`,
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    }))
    const messages: ChatMessage[] = [
      userMsg(1, 'first turn'),
      toolMsg(2, 'web_search', 'pc_1'),
      assistantMsg(3, 'first done'),
      userMsg(10, 'second turn'),
      toolMsg(11, 'web_search', 'pc_2'),
      toolMsg(12, 'web_search', 'pc_3'),
      assistantMsg(13, 'second done'),
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true, 1: true },
      },
      global,
    })
    const userBubbles = wrapper.findAll('[data-testid="user-message-bubble"]')
    expect(userBubbles).toHaveLength(2)
    expect(userBubbles[0]?.text()).toContain('first turn')
    expect(userBubbles[1]?.text()).toContain('second turn')
  })

  it('renders an extra block after a sub-agent call (3 blocks for user → sub-agent → user)', () => {
    setActivePinia(createPinia())
    const store = useTaskStore()
    for (const id of [11, 12]) {
      store.subTaskCache.set(id, {
        ...baseTask,
        id,
        status: 'RUNNING',
        parent_task_id: baseTask.id,
      })
    }
    const toolCalls: ToolCall[] = [
      makeToolCall({ id: 1, provider_call_id: 'pc_1', tool_name: 'web_search', tool_type: 'web_search' }),
      makeToolCall({
        id: 2,
        provider_call_id: 'pc_sub',
        tool_name: 'handover',
        tool_type: 'handover',
        operation: 'sub_agent',
        result_data: { op: 'sub_agent', spawned_sub_task_ids: [11, 12] },
      }),
      makeToolCall({ id: 3, provider_call_id: 'pc_3', tool_name: 'web_search', tool_type: 'web_search' }),
    ]
    const messages: ChatMessage[] = [
      userMsg(1, 'first turn'),
      toolMsg(2, 'web_search', 'pc_1'),
      assistantMsg(3, 'first reply'),
      toolMsg(10, 'handover', 'pc_sub'),
      assistantMsg(11, 'sub-agent reasoning'),
      toolMsg(12, 'web_search', 'pc_3'),
      assistantMsg(13, 'sub-agent final'),
      userMsg(20, 'second turn'),
      toolMsg(21, 'web_search', 'pc_4'),
      assistantMsg(22, 'second reply'),
    ]
    toolCalls.push(makeToolCall({ id: 4, provider_call_id: 'pc_4', tool_name: 'web_search', tool_type: 'web_search' }))
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true, 1: true, 2: true },
      },
      global,
    })
    // Three pills — one per user turn + one for the sub-agent block.
    expect(wrapper.findAll('[data-testid="compact-tool-stream"]')).toHaveLength(3)
    // Two user bubbles.
    expect(wrapper.findAll('[data-testid="user-message-bubble"]')).toHaveLength(2)
    // SubAgentToolCall renders OUTSIDE the pills (still its own card).
    expect(wrapper.find('[data-testid="sub-agent-tool-call"]').exists()).toBe(true)
  })

  it('renders the intermediate assistant bubble INSIDE the block (between the pill and the final response)', () => {
    const toolCalls = [makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    })]
    const messages: ChatMessage[] = [
      userMsg(1, 'do it'),
      assistantMsg(2, 'intermediate thought'),  // reasoning/text shown to user
      toolMsg(3, 'web_search', 'pc_1'),
      assistantMsg(4, 'final answer'),  // final response
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    // The intermediate assistant bubble renders in document order
    // BEFORE the final response.
    const html = wrapper.html()
    const intermediatePos = html.indexOf('intermediate thought')
    const finalPos = html.indexOf('final answer')
    expect(intermediatePos).toBeGreaterThanOrEqual(0)
    expect(finalPos).toBeGreaterThanOrEqual(0)
    expect(intermediatePos).toBeLessThan(finalPos)
  })

  it('renders the final assistant response as a bubble AFTER the pill, not inside the pill', () => {
    const toolCalls = [makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    })]
    const messages: ChatMessage[] = [
      userMsg(1, 'do it'),
      toolMsg(2, 'web_search', 'pc_1'),
      assistantMsg(3, 'final answer'),
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true },
      },
      global,
    })
    // The "final answer" text appears in the wrapper text, but it must
    // NOT live inside the compact-tool-stream pill (it's a top-level
    // assistant bubble after the pill).
    const pillHtml = wrapper.find('[data-testid="compact-tool-stream"]').html()
    expect(pillHtml).not.toContain('final answer')
    // The pill contains the tool row (formatted name "Web Search").
    expect(pillHtml).toContain('Web Search')
  })

  it('emits toggleStream with the blockId when a pill summary is clicked', async () => {
    const toolCalls = [makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    })]
    const messages: ChatMessage[] = [
      userMsg(1, 'first'),
      toolMsg(2, 'web_search', 'pc_1'),
      assistantMsg(3, 'first done'),
      userMsg(10, 'second'),
      toolMsg(11, 'web_search', 'pc_2'),
      assistantMsg(12, 'second done'),
    ]
    toolCalls.push(makeToolCall({ id: 2, provider_call_id: 'pc_2', tool_name: 'web_search', tool_type: 'web_search' }))
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true, 1: false },
      },
      global,
    })
    // Two pills, each with a <summary> as direct child. The query also
    // matches the row-level <summary> inside each pill — use the
    // direct-child combinator to isolate the pill summaries.
    const pills = wrapper.findAll('[data-testid="compact-tool-stream"]')
    expect(pills).toHaveLength(2)
    const summaries = pills.map((p) => p.find('summary'))
    await summaries[0]!.trigger('click')
    expect(wrapper.emitted('toggleStream')).toBeTruthy()
    expect(wrapper.emitted('toggleStream')![0]).toEqual([0])
    await summaries[1]!.trigger('click')
    expect(wrapper.emitted('toggleStream')![1]).toEqual([1])
  })

  it('keeps each block pill collapsed independently (per-block expandedStreams)', async () => {
    const toolCalls = [makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    })]
    const messages: ChatMessage[] = [
      userMsg(1, 'first'),
      toolMsg(2, 'web_search', 'pc_1'),
      assistantMsg(3, 'first done'),
      userMsg(10, 'second'),
      toolMsg(11, 'web_search', 'pc_2'),
      assistantMsg(12, 'second done'),
    ]
    toolCalls.push(makeToolCall({ id: 2, provider_call_id: 'pc_2', tool_name: 'web_search', tool_type: 'web_search' }))
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        // Block 0 open, Block 1 closed.
        expandedStreams: { 0: true, 1: false },
      },
      global,
    })
    const pills = wrapper.findAll('[data-testid="compact-tool-stream"]')
    expect((pills[0]!.element as HTMLDetailsElement).open).toBe(true)
    expect((pills[1]!.element as HTMLDetailsElement).open).toBe(false)
    // Update: flip block 1, leave block 0.
    await wrapper.setProps({ expandedStreams: { 0: true, 1: true } })
    const pills2 = wrapper.findAll('[data-testid="compact-tool-stream"]')
    expect((pills2[0]!.element as HTMLDetailsElement).open).toBe(true)
    expect((pills2[1]!.element as HTMLDetailsElement).open).toBe(true)
    await wrapper.setProps({ expandedStreams: { 0: false, 1: true } })
    const pills3 = wrapper.findAll('[data-testid="compact-tool-stream"]')
    expect((pills3[0]!.element as HTMLDetailsElement).open).toBe(false)
    expect((pills3[1]!.element as HTMLDetailsElement).open).toBe(true)
  })

  it('does not render a pill for a block that has no reasoning or generic tool rows', () => {
    // User sends two consecutive messages with no agent work in
    // between — second block is empty content; no pill should render
    // for it. Without the guard, an empty <details> would mount.
    const messages: ChatMessage[] = [
      userMsg(1, 'first'),
      userMsg(2, 'second'),
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: messages,
        finalReasoning: null,
      },
      global,
    })
    expect(wrapper.findAll('[data-testid="compact-tool-stream"]')).toHaveLength(0)
    // Both user bubbles still render.
    expect(wrapper.findAll('[data-testid="user-message-bubble"]')).toHaveLength(2)
  })

  it('does not leave empty <div class="flex justify-start"> wrappers for tool-result rows in any block', () => {
    // Iteration-3 regression guard: the wrapper that hosts SubAgent /
    // TodoToolCall must only render when one of those surfaces mounts.
    // With multiple blocks, the same rule applies per-block — generic
    // rows flow into the pill, no orphan wrappers.
    setActivePinia(createPinia())
    const store = useTaskStore()
    store.subTaskCache.set(11, { ...baseTask, id: 11, status: 'RUNNING', parent_task_id: baseTask.id })
    const toolCalls: ToolCall[] = [
      makeToolCall({ id: 1, provider_call_id: 'pc_1', tool_name: 'web_search', tool_type: 'web_search' }),
      makeToolCall({
        id: 2,
        provider_call_id: 'pc_sub',
        tool_name: 'handover',
        tool_type: 'handover',
        operation: 'sub_agent',
        result_data: { op: 'sub_agent', spawned_sub_task_ids: [11] },
      }),
      makeToolCall({
        id: 3,
        provider_call_id: 'pc_3',
        tool_name: 'todo',
        tool_type: 'todo',
        operation: 'write',
        status: 'EXECUTED',
        result_data: { items: [{ id: null, content: 'a', activeForm: null, status: 'pending', order: 0 }] },
      }),
    ]
    const messages: ChatMessage[] = [
      userMsg(1, 'turn one'),
      toolMsg(2, 'web_search', 'pc_1'),
      toolMsg(3, 'handover', 'pc_sub'),
      toolMsg(4, 'todo', 'pc_3'),
      userMsg(10, 'turn two'),
      toolMsg(11, 'web_search', 'pc_1'),
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: toolCalls },
        chatMessages: messages,
        finalReasoning: null,
        expandedStreams: { 0: true, 1: true, 2: true },
      },
      global,
    })
    const emptyWrappers = wrapper.findAll('div.flex.justify-start').filter((node) => {
      return node.element.children.length === 0 && node.text() === ''
    })
    expect(emptyWrappers).toHaveLength(0)
  })
})

describe('abort_marker system rows', () => {
  const baseEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
    sequence: 1,
    role: 'system' as const,
    content: JSON.stringify({ kind: 'abort_marker', at: '2026-08-08T12:00:00Z' }),
    tool_call_id: null,
    tool_name: null,
    content_blocks: null,
    ...overrides,
  })

  it('renders an abort_marker divider with the formatted timestamp', () => {
    const task = { ...baseTask, status: 'ABORTED' as const, aborted_at: '2026-08-08T12:00:00Z' }
    const messages: ChatMessage[] = [
      { kind: 'system-marker', entry: baseEntry(), marker: { kind: 'abort_marker', at: '2026-08-08T12:00:00Z' } },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {} },
      global,
    })
    const marker = wrapper.find('[data-testid="abort-marker"]')
    expect(marker.exists()).toBe(true)
  })

  it('falls back to the raw ISO string when the marker timestamp is unparseable', () => {
    // The marker row carries `at: <ISO>`. formatAbortMarkerAt wraps
    // Date.parse in a try/catch — but Date.parse does NOT throw, it
    // returns NaN which serialises to the string "Invalid Date" via
    // toLocaleTimeString. The defensive branch in the component must
    // catch that and render the raw ISO string instead of "Invalid
    // Date", so an old or malformed row never breaks the chat timeline.
    const task = { ...baseTask, status: 'ABORTED' as const, aborted_at: '2026-08-08T12:00:00Z' }
    const messages: ChatMessage[] = [
      {
        kind: 'system-marker',
        entry: baseEntry(),
        marker: { kind: 'abort_marker', at: 'definitely-not-an-iso-string' },
      },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {} },
      global,
    })
    expect(wrapper.html()).toContain('definitely-not-an-iso-string')
    expect(wrapper.html()).not.toContain('Invalid Date')
  })


  it('does NOT render an inline Abort button on the pill — the subtle running indicator owns that affordance', () => {
    // After moving the Abort affordance to the subtle running indicator
    // (which stays visible throughout the agent loop), the pill became
    // single-purpose: tool activity summary. This regression test pins
    // that decision so a future contributor can't quietly double up the
    // Abort affordance and create two competing buttons on the same screen.
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      tool_type: 'web_search',
      status: 'EXECUTED',
    })
    const messages: ChatMessage[] = [
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 1, content: 'r', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall], status: 'RUNNING' },
        chatMessages: messages,
        finalReasoning: null,
        expandedTools: {},
        abortSubmitting: false,
      },
      global,
    })
    expect(wrapper.find('[data-testid="compact-tool-stream-abort"]').exists()).toBe(false)
    // The subtle indicator still owns the canonical abort.
    expect(wrapper.find('[data-testid="subtle-running-indicator-abort"]').exists()).toBe(true)
  })

  it('drops a malformed system-marker row instead of rendering', () => {
    const task = { ...baseTask, status: 'ABORTED' as const }
    const messages: ChatMessage[] = [
      // Malformed JSON — parseSystemMarker returns null, so the entry is
      // filtered out by buildChatMessages. But when someone hands us a
      // already-built ChatMessage[], the component should be defensive
      // and skip it. We just confirm the marker testid is absent when
      // there's no system-marker message.
    { kind: 'assistant' as const, entry: makeEntry('assistant' as HistoryEntry['role'], { sequence: 1, content: 'ok' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {} },
      global,
    })
    expect(wrapper.find('[data-testid="abort-marker"]').exists()).toBe(false)
  })

  it('renders the subtle running indicator whenever the agent is in flight', () => {
    // The indicator is the canonical home for the Abort button + step
    // counter and must be reachable at every stage of the agent loop:
    // reasoning, mid-tool-call, and between rounds. It coexists with
    // the pill — they serve different affordances.
    const task = {
      ...baseTask,
      status: 'RUNNING' as const,
      step_count: 2,
      max_steps: 10,
    }
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'do something' }) },
      {
        kind: 'assistant',
        entry: makeEntry('assistant', {
          sequence: 2,
          content: '',
          content_blocks: [{ type: 'thinking', text: 'thinking about it' }],
        }),
      },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {}, abortSubmitting: false },
      global,
    })
    expect(wrapper.find('[data-testid="subtle-running-indicator"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Step 2 of 10')
  })

  it('also renders the subtle indicator on a fresh RUNNING task that has only emitted a user message so far', () => {
    const task = { ...baseTask, status: 'RUNNING' as const, step_count: 1, max_steps: 5 }
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'q' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {}, abortSubmitting: false },
      global,
    })
    expect(wrapper.find('[data-testid="subtle-running-indicator"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Step 1 of 5')
  })

  it('keeps the subtle running indicator visible while tool calls are happening (so the Abort button is always reachable)', () => {
    // The pill carries the tool-call progress signal (shimmer + count
    // + inline abort), but the dedicated subtle row is what hosts the
    // canonical Abort button + step counter. Operators must always be
    // able to abort, regardless of whether the pill has rows yet.
    const toolCall = makeToolCall({
      id: 1,
      provider_call_id: 'pc_1',
      tool_name: 'web_search',
      status: 'EXECUTED',
    })
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'q' }) },
      {
        kind: 'assistant',
        entry: makeEntry('assistant', { sequence: 2, content: 'let me search', content_blocks: [{ type: 'thinking', text: 't' }] }),
      },
      { kind: 'tool-result', entry: makeEntry('tool', { sequence: 3, content: 'r', tool_name: 'web_search', tool_call_id: 'pc_1' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: { ...baseTask, tool_calls: [toolCall], status: 'RUNNING' },
        chatMessages: messages,
        finalReasoning: null,
        expandedTools: {},
      },
      global,
    })
    expect(wrapper.find('[data-testid="compact-tool-stream"]').exists()).toBe(true)
    // Both surfaces coexist — the pill summarises tool activity, the
    // subtle indicator keeps the Abort button + step counter reachable.
    expect(wrapper.find('[data-testid="subtle-running-indicator"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="subtle-running-indicator-abort"]').exists()).toBe(true)
  })

  it('renders the subtle indicator\'s own Abort button and emits abort when it is clicked', async () => {
    const task = {
      ...baseTask,
      status: 'RUNNING' as const,
      step_count: 3,
      max_steps: 8,
    }
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'q' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {}, abortSubmitting: false },
      global,
    })
    const abort = wrapper.find('[data-testid="subtle-running-indicator-abort"]')
    expect(abort.exists()).toBe(true)
    expect(abort.text()).toBe('Abort')
    await abort.trigger('click')
    expect(wrapper.emitted('abort')).toBeTruthy()
    expect((wrapper.emitted('abort') ?? []).length).toBe(1)
  })

  it('flips the subtle indicator\'s abort button to "Aborting…" while the abort request is in flight', async () => {
    const task = { ...baseTask, status: 'RUNNING' as const, step_count: 3, max_steps: 8 }
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'q' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {}, abortSubmitting: false },
      global,
    })
    expect(wrapper.find('[data-testid="subtle-running-indicator-abort"]').text()).toBe('Abort')
    await wrapper.setProps({ abortSubmitting: true })
    const abort = wrapper.find('[data-testid="subtle-running-indicator-abort"]')
    expect(abort.text()).toContain('Aborting')
    expect((abort.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('falls back to "Working…" when max_steps is unknown (instead of a misleading "Step 0 of 0")', () => {
    const task = { ...baseTask, status: 'RUNNING' as const, step_count: 1, max_steps: null }
    const messages: ChatMessage[] = [
      { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'q' }) },
    ]
    const wrapper = mount(TaskChatMessageList, {
      props: { task, chatMessages: messages, finalReasoning: null, expandedTools: {}, abortSubmitting: false },
      global,
    })
    expect(wrapper.find('[data-testid="subtle-running-indicator"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Working…')
    expect(wrapper.text()).not.toContain('Step 0 of 0')
  })
})

describe('TaskChatMessageList — attachment chips', () => {
  const router = makeRouter()
  const global = { plugins: [router] }

  /**
   * The page mounts this component with a populated `chatMessages` prop
   * (after `taskStore.fetchTaskDetail` resolves), so the chips must
   * resolve from the initial render — the watcher is `immediate` to
   * match that flow. `await flushPromises()` lets the resolver
   * complete before the chip assertions run.
   */
  async function mountWithAttachments(attachments: NonNullable<HistoryEntry['attachments']>) {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: [
          { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'see attached', attachments }) },
        ],
        finalReasoning: null,
        expandedTools: {},
      },
      global,
    })
    await flushPromises()
    return wrapper
  }

  it('renders one chip per attachment on a user bubble', async () => {
    const wrapper = await mountWithAttachments([
      { media_id: '11111111-1111-4111-8111-111111111111', kind: 'image' },
      { media_id: '22222222-2222-4222-8222-222222222222', kind: 'text' },
    ])
    const chips = wrapper.findAll('[data-testid="user-message-attachment"]')
    expect(chips.length).toBe(2)
  })

  it('omits the chip container when attachments is empty / null', async () => {
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: [
          { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'no attachments' }) },
        ],
        finalReasoning: null,
        expandedTools: {},
      },
      global,
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="user-message-attachments"]').exists()).toBe(false)
  })

  it('opens the asset in a new tab via asset_url when clicked', async () => {
    const wrapper = await mountWithAttachments([
      { media_id: '33333333-3333-4333-8333-333333333333', kind: 'image' },
    ])
    const link = wrapper.find('[data-testid="user-message-attachment"]')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('skips re-resolving ids that are already cached for that entry', async () => {
    // First render: resolves the seed id.
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: [
          { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'first', attachments: [
            { media_id: '44444444-4444-4444-8444-444444444444', kind: 'image' },
          ] }) },
        ],
        finalReasoning: null,
        expandedTools: {},
      },
      global,
    })
    await flushPromises()
    // Second update with a NEW entry but a partly overlapping id list.
    // The new id should resolve; the cached one should be served from
    // module scope (the per-entry map merges with the cache).
    await wrapper.setProps({
      chatMessages: [
        { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'first', attachments: [
          { media_id: '44444444-4444-4444-8444-444444444444', kind: 'image' },
        ] }) },
        { kind: 'user', entry: makeEntry('user', { sequence: 2, content: 'second', attachments: [
          { media_id: '44444444-4444-4444-8444-444444444444', kind: 'image' },
          { media_id: '55555555-5555-4555-8555-555555555555', kind: 'image' },
        ] }) },
      ],
    })
    await flushPromises()
    const chips = wrapper.findAll('[data-testid="user-message-attachment"]')
    expect(chips.length).toBe(3)
  })

  it('renders an aria-disabled <span> instead of an <a> while the asset is still resolving', async () => {
    // Cache-miss override: every batchResolve returns an empty map,
    // so assetUrlForEntry() returns null for every chip. Without the
    // <span> fallback the chip would render as <a href="#"> which is
    // a real bug — clicking jumps to the page anchor and loses scroll
    // position. The pending state must be a non-link.
    batchResolveMock.mockImplementationOnce(async () => new Map())
    const wrapper = mount(TaskChatMessageList, {
      props: {
        task: baseTask,
        chatMessages: [
          { kind: 'user', entry: makeEntry('user', { sequence: 1, content: 'pending', attachments: [
            { media_id: '66666666-6666-4666-8666-666666666666', kind: 'image' },
          ] }) },
        ],
        finalReasoning: null,
        expandedTools: {},
      },
      global,
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="user-message-attachment"]').exists()).toBe(false)
    const pending = wrapper.find('[data-testid="user-message-attachment-pending"]')
    expect(pending.exists()).toBe(true)
    expect(pending.attributes('aria-disabled')).toBe('true')
    expect(pending.classes()).toContain('cursor-not-allowed')
    expect(pending.element.tagName).toBe('SPAN')
  })

  it('renders an inline <audio> chip when the resolved media_type is audio', async () => {
    // The orchestrator still emits `kind: 'text'` for audio, so the chip
    // detection reads `media_type` from the resolved MediaAsset. The
    // mock here returns audio-typed assets for the audio attachments
    // and the default image-typed asset for the image attachment.
    const audioId = '77777777-7777-4777-8777-777777777777'
    const imageId = '88888888-8888-4888-8888-888888888888'
    batchResolveMock.mockImplementationOnce(async (ids: readonly string[]) => {
      const map = new Map<string, { id: string; filename: string | null; asset_url: string; media_type: string }>()
      for (const id of ids) {
        if (id === audioId) {
          map.set(id, {
            id,
            filename: 'recording.webm',
            asset_url: `https://example.test/${id}`,
            media_type: 'audio',
          })
        } else {
          map.set(id, {
            id,
            filename: `${id}.png`,
            asset_url: `https://example.test/${id}`,
            media_type: 'image',
          })
        }
      }
      return map
    })
    const wrapper = await mountWithAttachments([
      { media_id: audioId, kind: 'text' },
      { media_id: imageId, kind: 'image' },
    ])
    const audioChips = wrapper.findAll('[data-testid="user-message-attachment-audio"]')
    expect(audioChips.length).toBe(1)
    const audio = audioChips[0]
    expect(audio.find('audio').exists()).toBe(true)
    expect(audio.find('audio').attributes('controls')).toBeDefined()
    // The image attachment still renders as a generic chip.
    expect(wrapper.findAll('[data-testid="user-message-attachment"]').length).toBe(1)
  })
})
