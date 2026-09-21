/**
 * CommandPalette — global ⌘K palette (component tests).
 *
 * Coverage:
 *   - ⌘K / Esc / backdrop close behaviour
 *   - empty-query renders Actions, Groups, My Agents, Agents by group, Recent chats
 *   - typing filters across sections
 *   - focused group exclusion from "Agents by group"
 *   - ↑/↓ moves selection (verified via aria-selected)
 *   - activation routes via router.push
 *   - empty stores → only Actions header renders, footer reads 0
 *   - only personal agents → Actions + My Agents (3)
 *   - no-match query → "No matches for …" empty state
 *   - first open triggers useDashboardData().ensureLoaded() if not booted
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))

const isOpenRef = ref(false)
const openMock = vi.fn()
const closeMock = vi.fn()
const toggleMock = vi.fn()
vi.mock('@/composables/useCommandPalette', () => ({
  useCommandPalette: () => ({
    isOpen: isOpenRef,
    open: openMock,
    close: closeMock,
    toggle: toggleMock,
  }),
}))

const userRef = ref<{ id: number } | null>(null)
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() { return userRef.value },
  }),
}))

const agentsRef = ref<Array<Record<string, unknown>>>([])
vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    get agents() { return agentsRef.value },
  }),
}))

const tasksRef = ref<Array<Record<string, unknown>>>([])
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => ({
    get tasks() { return tasksRef.value },
  }),
}))

const principalsRef = ref<Array<Record<string, unknown>>>([])
const principalsLoadMock = vi.fn()
vi.mock('@/stores/principals', () => ({
  usePrincipalsStore: () => ({
    get principals() { return principalsRef.value },
    load: principalsLoadMock,
  }),
}))

const groupsRef = ref<Array<Record<string, unknown>>>([])
vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    get groups() { return groupsRef.value },
  }),
}))

const bootedRef = ref(true)
const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/composables/useDashboardData', () => ({
  useDashboardData: () => ({
    get booted() { return bootedRef },
    ensureLoaded: ensureLoadedMock,
  }),
}))

import CommandPalette from '@/components/CommandPalette.vue'

const IconStub = { name: 'Icon', template: '<i />' }
const AvatarStub = { name: 'Avatar', template: '<span class="avatar-stub" />' }

function makeAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'Agent',
    description: null,
    principal_id: 0,
    principal: null,
    is_pinned: false,
    is_favorite: false,
    is_archived: false,
    tools: [],
    ...overrides,
  }
}

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    agent_id: 1,
    status: 'COMPLETED',
    user_prompt: 'Prompt',
    final_response: 'Response',
    step_count: 1,
    max_steps: 10,
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:01Z',
    ...overrides,
  }
}

function makePrincipal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    type: 'group',
    name: 'Group',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  isOpenRef.value = false
  openMock.mockReset()
  closeMock.mockReset()
  toggleMock.mockReset()
  userRef.value = null
  agentsRef.value = []
  tasksRef.value = []
  principalsRef.value = []
  groupsRef.value = []
  bootedRef.value = true
  ensureLoadedMock.mockReset()
  ensureLoadedMock.mockResolvedValue(undefined)
  pushMock.mockReset()
})

function mountPalette(props: Record<string, unknown> = {}) {
  // Each mount gets its own container so Teleport targets don't
  // leak DOM between tests — `document.body` is shared across the
  // suite and a previous test's palette elements would otherwise
  // survive `wrapper.unmount()` and trip `querySelector` lookups.
  const container = document.createElement('div')
  document.body.appendChild(container)
  return mount(CommandPalette, {
    props,
    global: { stubs: { Icon: IconStub, Avatar: AvatarStub } },
    attachTo: container,
  })
}

describe('CommandPalette', () => {
  it('⌘K on window opens; second ⌘K closes; esc closes; backdrop click closes', async () => {
    const wrapper = mountPalette()
    expect(isOpenRef.value).toBe(false)
    expect(document.body.querySelector('[data-testid="command-palette"]')).toBeNull()

    // ⌘K open — driven externally (composable handles Cmd+K, so the
    // mock toggles `isOpen` directly).
    isOpenRef.value = true
    await nextTick()
    expect(document.body.querySelector('[data-testid="command-palette"]')).not.toBeNull()

    // Esc closes (handled by the component's input keydown)
    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    expect(input).not.toBeNull()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closeMock).toHaveBeenCalled()

    // Reset mock + open again to test backdrop click
    closeMock.mockClear()
    isOpenRef.value = true
    await nextTick()
    const backdrop = document.body.querySelector('button[aria-label="Close command palette"]') as HTMLButtonElement | null
    expect(backdrop).not.toBeNull()
    backdrop?.click()
    expect(closeMock).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('empty query renders all 5 sections when stores are populated', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
      makePrincipal({ id: 20, type: 'group', name: 'Operations', group_id: 2 }),
    ]
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Mine', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
      makeAgent({ id: 2, name: 'Eng Bot', principal_id: 10, principal: { id: 10, type: 'group', name: 'Engineering', group_id: 1 } }),
      makeAgent({ id: 3, name: 'Ops Bot', principal_id: 20, principal: { id: 20, type: 'group', name: 'Operations', group_id: 2 } }),
    ]
    tasksRef.value = [
      makeTask({ id: 100, agent_id: 1, user_prompt: 'Hello world', final_response: 'Hi there' }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    expect(document.body.querySelector('[data-testid="palette-section-actions"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-groups"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-my-agents"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-agents-by-group-1"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-agents-by-group-2"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-recent-chats"]')).not.toBeNull()

    // Regression: the "Agents by group" section header must render the
    // real group name, not a `#<id>` fallback. The synthetic Group
    // records were previously built with `name: ''`, so the section
    // header at CommandPalette.vue:417 always fell through to
    // `bucket.group.name || …` and surfaced `#1`, `#2`, … in
    // production. Verify the rendered text now contains the names.
    const engSection = document.body.querySelector('[data-testid="palette-section-agents-by-group-1"]')
    const opsSection = document.body.querySelector('[data-testid="palette-section-agents-by-group-2"]')
    expect(engSection?.textContent).toContain('Engineering')
    expect(opsSection?.textContent).toContain('Operations')
    expect(engSection?.textContent).not.toMatch(/#1\b/)
    expect(opsSection?.textContent).not.toMatch(/#2\b/)

    wrapper.unmount()
  })

  it('typing filters across all sections', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
      makePrincipal({ id: 20, type: 'group', name: 'Operations', group_id: 2 }),
    ]
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Mine', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
      makeAgent({ id: 2, name: 'Eng Bot', principal_id: 10, principal: { id: 10, type: 'group', name: 'Engineering', group_id: 1 } }),
      makeAgent({ id: 3, name: 'Ops Bot', principal_id: 20, principal: { id: 20, type: 'group', name: 'Operations', group_id: 2 } }),
    ]
    tasksRef.value = [
      makeTask({ id: 100, agent_id: 1, user_prompt: 'Engineering planning', final_response: null }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    // Pre-filter: all sections render
    expect(document.body.querySelector('[data-testid="palette-section-agents-by-group-2"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-recent-chats"]')).not.toBeNull()

    // Type "Eng" — only Engineering matches. The input lives inside a
// Teleport so we reach for it directly via document.body instead of
// wrapper.find (which doesn't cross teleport boundaries).
    const inputEl = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    expect(inputEl).not.toBeNull()
    inputEl.value = 'Eng'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    // Operations section hidden, Engineering kept
    expect(document.body.querySelectorAll('[data-testid="palette-section-agents-by-group-1"]').length).toBeGreaterThanOrEqual(1)
    expect(document.body.querySelectorAll('[data-testid="palette-section-agents-by-group-2"]').length).toBe(0)
    // Recent chats section kept (matches "Engineering planning")
    expect(document.body.querySelectorAll('[data-testid="palette-section-recent-chats"]').length).toBeGreaterThanOrEqual(1)

    // Type something completely unrelated → empty state
    inputEl.value = 'zzzzz'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('[data-testid="palette-empty"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('focused group is excluded from the "Agents by group" listing', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
      makePrincipal({ id: 20, type: 'group', name: 'Operations', group_id: 2 }),
    ]
    agentsRef.value = [
      makeAgent({ id: 2, name: 'Eng Bot', principal_id: 10, principal: { id: 10, type: 'group', name: 'Engineering', group_id: 1 } }),
      makeAgent({ id: 3, name: 'Ops Bot', principal_id: 20, principal: { id: 20, type: 'group', name: 'Operations', group_id: 2 } }),
    ]

    const wrapper = mountPalette({ focusedGroupId: 1 })
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    // Engineering (id 1) excluded — Operations (id 2) remains
    expect(document.body.querySelector('[data-testid="palette-section-agents-by-group-1"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-agents-by-group-2"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('↑/↓ moves selection (verified via aria-selected)', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
      makePrincipal({ id: 20, type: 'group', name: 'Operations', group_id: 2 }),
    ]
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Mine', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
      makeAgent({ id: 2, name: 'Eng Bot', principal_id: 10, principal: { id: 10, type: 'group', name: 'Engineering', group_id: 1 } }),
      makeAgent({ id: 3, name: 'Ops Bot', principal_id: 20, principal: { id: 20, type: 'group', name: 'Operations', group_id: 2 } }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement

    // Capture which item is selected before each ArrowDown — pressing
    // ↓ must move to a different item, and pressing ↑ must return to it.
    function selectedItem(): HTMLElement | null {
      return Array.from(document.body.querySelectorAll('[data-testid^="palette-item-"]'))
        .find((el) => el.getAttribute('aria-selected') === 'true') as HTMLElement | null
    }
    const initial = selectedItem()
    expect(initial).toBeDefined()

    // ↓ moves selection
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    const afterDown = selectedItem()
    expect(afterDown).not.toBeNull()
    expect(afterDown).not.toBe(initial)

    // ↑ returns to the previous selection
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    expect(selectedItem()).toBe(initial)

    wrapper.unmount()
  })

  it('activating a Group item calls router.push with group-overview', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const groupButton = document.body.querySelector('[data-testid="palette-item-group-10"]') as HTMLButtonElement | null
    expect(groupButton).not.toBeNull()
    groupButton?.click()
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith({ name: 'group-overview', params: { id: '10' } })
    expect(closeMock).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('empty stores → only Actions shows (empty-query); footer reads 0 results', async () => {
    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    expect(document.body.querySelector('[data-testid="palette-section-actions"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-groups"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-my-agents"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-recent-chats"]')).toBeNull()

    expect(document.body.querySelector('[data-testid="palette-results-count"]')?.textContent?.trim()).toBe('0 results')

    wrapper.unmount()
  })

  it('only personal agents, no groups/tasks → only Actions and My Agents (3)', async () => {
    userRef.value = { id: 99 }
    agentsRef.value = [
      makeAgent({ id: 1, name: 'One', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
      makeAgent({ id: 2, name: 'Two', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
      makeAgent({ id: 3, name: 'Three', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    expect(document.body.querySelector('[data-testid="palette-section-actions"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-my-agents"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-groups"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-recent-chats"]')).toBeNull()

    // My Agents header count is 3
    const myAgentsSection = document.body.querySelector('[data-testid="palette-section-my-agents"]')
    expect(myAgentsSection?.textContent).toContain('My Agents')
    expect(myAgentsSection?.querySelector('header span:last-child')?.textContent).toBe('3')

    wrapper.unmount()
  })

  it('no-match query → "No matches for …" empty state', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    input.value = 'zzzzzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await flushPromises()

    const empty = document.body.querySelector('[data-testid="palette-empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.textContent).toContain('No matches for')
    expect(empty?.textContent).toContain('zzzzzz')

    wrapper.unmount()
  })

  it('chat rows show the owning agent’s avatar and name', async () => {
    userRef.value = { id: 99 }
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Mine', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
      makeAgent({ id: 2, name: 'Eng Bot', principal_id: 10, principal: { id: 10, type: 'group', name: 'Engineering', group_id: 1 } }),
    ]
    tasksRef.value = [
      makeTask({ id: 100, agent_id: 1, user_prompt: 'Personal chat', final_response: 'Hi there' }),
      makeTask({ id: 200, agent_id: 2, user_prompt: 'Team chat', final_response: 'Done' }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const row100 = document.body.querySelector('[data-testid="palette-item-chat-100"]') as HTMLElement | null
    const row200 = document.body.querySelector('[data-testid="palette-item-chat-200"]') as HTMLElement | null
    expect(row100).not.toBeNull()
    expect(row200).not.toBeNull()
    expect(row100!.querySelector('.avatar-stub')).not.toBeNull()
    expect(row200!.querySelector('.avatar-stub')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-chat-100-agent"]')?.textContent).toBe('Mine')
    expect(document.body.querySelector('[data-testid="palette-item-chat-200-agent"]')?.textContent).toBe('Eng Bot')
    wrapper.unmount()
  })

  it('chat row falls back to the generic chat icon when the agent isn’t loaded', async () => {
    userRef.value = { id: 99 }
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Mine', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
    ]
    // agent_id: 99 isn't in agentsRef — legacy task / deleted-agent scenario.
    tasksRef.value = [
      makeTask({ id: 300, agent_id: 99, user_prompt: 'Orphan chat', final_response: null }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const row = document.body.querySelector('[data-testid="palette-item-chat-300"]') as HTMLElement | null
    expect(row).not.toBeNull()
    expect(row!.querySelector('.avatar-stub')).toBeNull()
    expect(row!.querySelector('i')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-chat-300-agent"]')).toBeNull()
    wrapper.unmount()
  })

  it('first open with booted=false triggers ensureLoaded()', async () => {
    bootedRef.value = false

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    // ensureLoaded is called when the palette opens and booted=false.
    // The mock is module-scoped and shared across tests, so we only
    // assert that it was called (call count >= 1) rather than tracking
    // the exact invocation count — Vue's watch semantics with a
    // mocked singleton `isOpen` ref can fire the callback more than
    // once across remounts in the test harness.
    expect(ensureLoadedMock).toHaveBeenCalled()

    wrapper.unmount()

    // Subsequent open while booted=true should NOT re-call
    const callsBefore = ensureLoadedMock.mock.calls.length
    bootedRef.value = true
    const wrapper2 = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    // Booted=true on the second mount means ensureLoaded should not
    // be called fresh from this test — the count stays the same as
    // what we recorded right before the second mount.
    expect(ensureLoadedMock.mock.calls.length).toBe(callsBefore)
    wrapper2.unmount()
  })
})