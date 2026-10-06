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
 *   - GET /search: debounce coalescing, stale-response rejection, per-type
 *     sections, href navigation, null-href rows, and the no-flash empty state
 *   - retyping a previous session's query, rows dropped on the keystroke,
 *     selection parked on an activatable row, and a failed search reported as
 *     unavailable rather than as "no matches"
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

/** Mirrors `CommandPalette.vue`'s SEARCH_DEBOUNCE_MS. */
const SEARCH_DEBOUNCE_MS = 200

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

const createAgentOpenMock = vi.fn()
vi.mock('@/stores/createAgentDialog', () => ({
  useCreateAgentDialogStore: () => ({ open: createAgentOpenMock }),
}))

const createGroupOpenMock = vi.fn()
vi.mock('@/stores/createGroupDialog', () => ({
  useCreateGroupDialogStore: () => ({ open: createGroupOpenMock }),
}))

// The palette now calls GET /search for the server-backed sections. Mocked at
// the api module (not at `fetch`) so these tests assert the palette's own
// request lifecycle — debounce coalescing and stale-response rejection —
// without touching the transport. The arrow wrapper defers the read of
// `searchMock`, which the hoisted factory would otherwise evaluate before the
// `const` initialises.
const searchMock = vi.fn()
vi.mock('@/api/search', () => ({
  searchApi: { search: (query: string) => searchMock(query) },
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
  // Fake timers so the search debounce is deterministic: a test that asserts
  // "one request after a burst of keystrokes" cannot rely on wall-clock luck.
  vi.useFakeTimers()
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
  createAgentOpenMock.mockReset()
  createGroupOpenMock.mockReset()
  searchMock.mockReset()
  // Default to "server found nothing" so the pre-existing tests keep their
  // local-only behaviour. Tests that care about hits override this per case.
  searchMock.mockResolvedValue({ hits: [], query: '' })
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Let the palette's 200 ms search debounce elapse, then drain the mocked
 * response. Every assertion that depends on the server sections — including
 * the pre-existing empty-state assertions, which the palette now holds back
 * until the server has answered — must go through this rather than a bare
 * `flushPromises()`.
 */
async function settleSearch(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10)
  await flushPromises()
}

async function typeQuery(value: string): Promise<void> {
  const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

function makeHit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'skill',
    id: 'some-skill',
    label: 'Some Skill',
    subLabel: null,
    badge: null,
    href: null,
    ...overrides,
  }
}

const mountedWrappers: Array<ReturnType<typeof mount>> = []

function mountPalette(props: Record<string, unknown> = {}) {
  // Each mount gets its own container so Teleport targets don't
  // leak DOM between tests — `document.body` is shared across the
  // suite and a previous test's palette elements would otherwise
  // survive `wrapper.unmount()` and trip `querySelector` lookups.
  const container = document.createElement('div')
  document.body.appendChild(container)
  const wrapper = mount(CommandPalette, {
    props,
    global: { stubs: { Icon: IconStub, Avatar: AvatarStub } },
    attachTo: container,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

// The per-test `wrapper.unmount()` handles the happy path; this handles the
// unhappy one. A test that throws mid-assertion never reaches its unmount,
// and its still-live palette would then keep its watchers on the shared
// `isOpenRef`/`searchMock` and satisfy the next test's
// `document.body.querySelector` — turning one real failure into a cascade of
// unrelated ones.
afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  document.body.innerHTML = ''
})

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

    // Type something completely unrelated → empty state. The palette holds
    // the empty block back until the server has answered the query, so the
    // debounce has to elapse before this assertion is meaningful.
    inputEl.value = 'zzzzz'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await settleSearch()
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

  it('activating "Create new agent" opens the create-agent dialog (no navigation)', async () => {
    userRef.value = { id: 99 }
    agentsRef.value = [
      makeAgent({ id: 1, name: 'One', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const btn = document.body.querySelector('[data-testid="palette-item-create-agent"]') as HTMLButtonElement | null
    expect(btn).not.toBeNull()
    btn?.click()
    await flushPromises()

    expect(createAgentOpenMock).toHaveBeenCalledWith('choice')
    expect(pushMock).not.toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('activating "Create new group" opens the create-group dialog (no navigation)', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const btn = document.body.querySelector('[data-testid="palette-item-create-group"]') as HTMLButtonElement | null
    expect(btn).not.toBeNull()
    btn?.click()
    await flushPromises()

    expect(createGroupOpenMock).toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
    expect(closeMock).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('empty stores → no sections render, footer reads 0 results', async () => {
    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    // With no agents, no groups, no tasks, no actions are eligible
    // either (create-agent requires a user-owned agent, create-group
    // requires at least one loaded group), so every section is hidden.
    expect(document.body.querySelector('[data-testid="palette-section-actions"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-groups"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-my-agents"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-recent-chats"]')).toBeNull()

    expect(document.body.querySelector('[data-testid="palette-results-count"]')?.textContent?.trim()).toBe('0 results')

    wrapper.unmount()
  })

  it('the header close button closes the palette', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    // The header X button — `aria-label="Close palette"`, distinct from
    // the fullscreen backdrop's `aria-label="Close command palette"` —
    // is the always-reachable close affordance (the backdrop is hidden
    // when focus is inside the panel, and Esc handling depends on the
    // user-agent's dialog escape behaviour).
    const headerClose = document.body.querySelector('[data-testid="command-palette"] button[aria-label="Close palette"]') as HTMLButtonElement | null
    expect(headerClose).not.toBeNull()
    headerClose?.click()
    await flushPromises()
    expect(closeMock).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('actions stay searchable when the query is non-empty', async () => {
    userRef.value = { id: 99 }
    agentsRef.value = [
      makeAgent({ id: 1, name: 'Mine', principal_id: 100, principal: { id: 100, type: 'user', name: 'You', user_id: 99 } }),
    ]
    principalsRef.value = [
      makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 }),
    ]

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    // Empty query: both actions present.
    expect(document.body.querySelector('[data-testid="palette-item-create-agent"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-create-group"]')).not.toBeNull()

    // Query "agent" — only create-agent matches ("Create new agent"
    // contains "agent"; "Create new group" does not).
    const inputEl = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    inputEl.value = 'agent'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('[data-testid="palette-item-create-agent"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-create-group"]')).toBeNull()

    // Query "group" — only create-group matches.
    inputEl.value = 'group'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('[data-testid="palette-item-create-agent"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-create-group"]')).not.toBeNull()

    // Query "dialog" — only create-agent matches via its subLabel
    // "Open the create-agent dialog". SubLabel search lets the user
    // find actions through context the label doesn't show.
    inputEl.value = 'dialog'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('[data-testid="palette-item-create-agent"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-create-group"]')).toBeNull()

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
    await settleSearch()

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

describe('CommandPalette — server search (GET /search)', () => {
  it('issues no request on a cold open', async () => {
    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    // Even past the debounce window, an empty box never reaches the network:
    // the backend short-circuits it to zero hits anyway.
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 5)

    expect(searchMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('coalesces a burst of keystrokes into a single request', async () => {
    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    await typeQuery('i')
    await vi.advanceTimersByTimeAsync(50)
    await typeQuery('in')
    await vi.advanceTimersByTimeAsync(50)
    await typeQuery('inv')
    await typeQuery('invo')
    await typeQuery('invoi')

    // Every keystroke restarts the timer; none of the intermediate values
    // reached the network.
    expect(searchMock).not.toHaveBeenCalled()

    await settleSearch()

    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith('invoi')

    wrapper.unmount()
  })

  it('drops a stale response that resolves after a newer one', async () => {
    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    // Two deferred responses, resolved newest-first to simulate the slow
    // early request finishing last. Debouncing cannot prevent this — both
    // requests were legitimately issued — so only the generation token can.
    let resolveSlow: ((value: { hits: unknown[]; query: string }) => void) | null = null
    searchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSlow = resolve
    }))
    await typeQuery('in')
    await settleSearch()
    expect(searchMock).toHaveBeenCalledTimes(1)

    searchMock.mockResolvedValueOnce({ hits: [makeHit({ id: 'invoice', label: 'Invoice skill' })], query: 'invoice' })
    await typeQuery('invoice')
    await settleSearch()
    expect(searchMock).toHaveBeenCalledTimes(2)

    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).not.toBeNull()

    // The `in` response lands last. Its hits must not appear.
    resolveSlow!({ hits: [makeHit({ id: 'inbox', label: 'Inbox skill' })], query: 'in' })
    await flushPromises()

    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-inbox"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('renders one section per hit type, with badge and subLabel', async () => {
    searchMock.mockResolvedValueOnce({
      query: 'inv',
      hits: [
        makeHit({ type: 'skill', id: 'invoice', label: 'Invoice skill', subLabel: 'Reads invoices', badge: '1 warning', href: '/apps/media/skill/invoice' }),
        makeHit({ type: 'skill', id: 'invoicing', label: 'Invoicing skill', subLabel: null, badge: null, href: null }),
        makeHit({ type: 'recipe', id: 'quarterly', label: 'Quarterly report', subLabel: null, badge: null, href: '/recipes/quarterly' }),
      ],
    })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('inv')
    await settleSearch()

    // One section per distinct type, header title-cased.
    const skillSection = document.body.querySelector('[data-testid="palette-section-hits-skill"]')
    const recipeSection = document.body.querySelector('[data-testid="palette-section-hits-recipe"]')
    expect(skillSection).not.toBeNull()
    expect(recipeSection).not.toBeNull()
    expect(skillSection?.querySelector('header')?.textContent).toContain('Skill')
    expect(recipeSection?.querySelector('header')?.textContent).toContain('Recipe')
    // Counts reflect the hits actually rendered.
    expect(skillSection?.querySelector('header span:last-child')?.textContent).toBe('2')
    expect(recipeSection?.querySelector('header span:last-child')?.textContent).toBe('1')

    // Exactly the two types the backend emitted — no extra section, and
    // none rendered empty. The palette's rule is a section appears only
    // when it has rows; a header with a 0 next to it is a phantom group.
    const hitSectionIds = Array.from(document.body.querySelectorAll('section[data-testid^="palette-section-hits-"]'))
      .map((el) => el.getAttribute('data-testid'))
    expect(hitSectionIds).toEqual(['palette-section-hits-skill', 'palette-section-hits-recipe'])
    for (const id of hitSectionIds) {
      expect(document.body.querySelector(`[data-testid="${id}"] ul`)?.children.length).toBeGreaterThan(0)
    }

    // Rows group by type rather than staying in the backend's interleaved
    // order: the two skills sit together under Skills, the recipe separate.
    expect(Array.from(skillSection?.querySelectorAll('[data-testid^="palette-item-hit-skill-"]:not([data-testid*="-badge"]):not([data-testid*="-sublabel"])') ?? [])
      .map((el) => el.getAttribute('data-testid')))
      .toEqual(['palette-item-hit-skill-invoice', 'palette-item-hit-skill-invoicing'])

    // Badge and subLabel come straight from the wire.
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice-badge"]')?.textContent).toBe('1 warning')
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice-sublabel"]')?.textContent).toBe('Reads invoices')
    // A null badge/subLabel renders nothing rather than an empty element.
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoicing-badge"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoicing-sublabel"]')).toBeNull()

    // Server hits are appended AFTER the local sections and counted in the
    // footer alongside them.
    const sections = Array.from(document.body.querySelectorAll('section[data-testid^="palette-section-"]'))
    const lastSection = sections[sections.length - 1]
    expect(lastSection.getAttribute('data-testid')).toBe('palette-section-hits-recipe')
    expect(document.body.querySelector('[data-testid="palette-results-count"]')?.textContent?.trim()).toBe('3 results')

    wrapper.unmount()
  })

  it('a hit with an href navigates via router.push', async () => {
    searchMock.mockResolvedValueOnce({
      query: 'invoice',
      hits: [makeHit({ id: 'invoice', label: 'Invoice skill', href: '/apps/media-archive/skill/invoice' })],
    })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('invoice')
    await settleSearch()

    const row = document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]') as HTMLElement | null
    expect(row).not.toBeNull()
    // Rendered as a real control, not the inert variant.
    expect(row?.tagName).toBe('BUTTON')
    expect(row?.getAttribute('aria-disabled')).toBeNull()

    row?.click()
    await flushPromises()

    // The href is a host path, so it is pushed as a string rather than a
    // named route.
    expect(pushMock).toHaveBeenCalledWith('/apps/media-archive/skill/invoice')
    expect(closeMock).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('a null-href hit renders inert: no click, no Enter, not selectable', async () => {
    // The inert row sits BETWEEN two routable ones, so a ↓ from the first
    // row has to step over it to reach the third. Were the inert row last,
    // a buggy selection could land on a routable neighbour and still pass.
    searchMock.mockResolvedValueOnce({
      query: 'invoice',
      hits: [
        makeHit({ id: 'first', label: 'First skill', href: '/apps/x/skill/first' }),
        makeHit({ id: 'orphan', label: 'Orphan skill', href: null }),
        makeHit({ id: 'third', label: 'Third skill', href: '/apps/x/skill/third' }),
      ],
    })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('invoice')
    await settleSearch()

    const inert = document.body.querySelector('[data-testid="palette-item-hit-skill-orphan"]') as HTMLElement | null
    expect(inert).not.toBeNull()
    // Not a control at all — no button, and marked disabled for assistive tech.
    expect(inert?.tagName).toBe('DIV')
    expect(inert?.getAttribute('aria-disabled')).toBe('true')

    // Clicking it does nothing: no navigation, and the palette stays open.
    inert?.click()
    await flushPromises()
    expect(pushMock).not.toHaveBeenCalled()
    expect(closeMock).not.toHaveBeenCalled()

    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    const selected = (): (string | null)[] => Array.from(document.body.querySelectorAll('[data-testid^="palette-item-"]'))
      .filter((el) => el.getAttribute('aria-selected') === 'true')
      .map((el) => el.getAttribute('data-testid'))

    // Selection starts on the first row. ↓ must hop over the inert row —
    // Enter on an unopenable row would be a dead keystroke.
    expect(selected()).toEqual(['palette-item-hit-skill-first'])
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(selected()).toEqual(['palette-item-hit-skill-third'])

    // And ↑ from there must hop back over it rather than land on it.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    expect(selected()).toEqual(['palette-item-hit-skill-first'])

    // The inert row never reports itself as selected.
    expect(inert?.getAttribute('aria-selected')).toBe('false')

    wrapper.unmount()
  })

  it('Enter on a null-href row is a no-op even when it is the only hit', async () => {
    // When every row is inert the loop in `moveSelection` has nowhere to
    // land, so the selection stays put — and Enter must do nothing rather
    // than navigate to an invented destination.
    searchMock.mockResolvedValueOnce({
      query: 'invoice',
      hits: [makeHit({ id: 'orphan', label: 'Orphan skill', href: null })],
    })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('invoice')
    await settleSearch()

    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(pushMock).not.toHaveBeenCalled()
    expect(closeMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('does not flash the empty state before the first response lands', async () => {
    // A response that never resolves during the assertion window models the
    // real round-trip: the box is filled, the request is in flight.
    searchMock.mockImplementationOnce(() => new Promise(() => {}))

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('zzzzzz')

    // Still inside the debounce window — nothing has been asked yet.
    expect(document.body.querySelector('[data-testid="palette-empty"]')).toBeNull()

    // Request issued and in flight. "No results yet" is not the same answer
    // as "no results", so the block must still be absent.
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10)
    await flushPromises()
    expect(searchMock).toHaveBeenCalledWith('zzzzzz')
    expect(document.body.querySelector('[data-testid="palette-empty"]')).toBeNull()

    wrapper.unmount()
  })

  it('shows the empty state once the server has answered with no hits', async () => {
    searchMock.mockResolvedValueOnce({ hits: [], query: 'zzzzzz' })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('zzzzzz')
    await settleSearch()

    const empty = document.body.querySelector('[data-testid="palette-empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.textContent).toContain('zzzzzz')

    wrapper.unmount()
  })

  it('closing the palette cancels a pending debounce and drops a late response', async () => {
    searchMock.mockResolvedValueOnce({ hits: [makeHit({ id: 'invoice', label: 'Invoice skill' })], query: 'invoice' })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('invoice')

    // Close before the debounce fires: no request should ever be issued.
    isOpenRef.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 3)
    await flushPromises()
    expect(searchMock).not.toHaveBeenCalled()

    // Reopening must not surface the previous session's query either.
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).toBeNull()
    expect((document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement).value).toBe('')

    wrapper.unmount()
  })

  it('retyping the same query in a new session issues a second request', async () => {
    // A settled debounced value is only reachable through the debounce ref, so
    // the palette has to return that ref to empty on reset: Vue skips a
    // watcher when a ref is assigned an equal primitive, and a second session
    // typing the previous session's query would therefore reach nothing at
    // all — no rows and no empty state, because the request never ran.
    searchMock.mockResolvedValue({ hits: [makeHit({ id: 'invoice', label: 'Invoice skill' })], query: 'inv' })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    await typeQuery('inv')
    await settleSearch()
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenLastCalledWith('inv')
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).not.toBeNull()

    // Close and reopen — the Esc / ⌘K / re-paste round trip.
    isOpenRef.value = false
    await nextTick()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    expect((document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement).value).toBe('')

    // The identical query again.
    await typeQuery('inv')
    await settleSearch()

    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(searchMock).toHaveBeenLastCalledWith('inv')
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('drops the previous query’s rows on the keystroke, not when the request goes out', async () => {
    searchMock.mockResolvedValueOnce({
      hits: [makeHit({ id: 'invoice', label: 'Invoice skill', href: '/apps/x/skill/invoice' })],
      query: 'invoice',
    })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('invoice')
    await settleSearch()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).not.toBeNull()

    // One more keystroke, still inside the debounce window: nothing has been
    // asked yet, but the row on screen answers 'invoice', not 'invoicee'.
    await typeQuery('invoicee')
    await nextTick()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).toBeNull()
    // So ↓+Enter must not be able to open it either.
    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(pushMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('a response landing in the debounce window cannot repopulate stale rows', async () => {
    // The reverse race: the previous query's answer arrives after the
    // keystroke but before the next request is issued, which is exactly the
    // window the keystroke invalidation exists for.
    let resolveSlow: ((value: { hits: unknown[]; query: string }) => void) | null = null
    searchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSlow = resolve
    }))

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('inv')
    await settleSearch()
    expect(searchMock).toHaveBeenCalledTimes(1)

    // A second, unrelated query supersedes it.
    searchMock.mockResolvedValueOnce({ hits: [], query: 'invoice' })
    await typeQuery('invoice')
    await flushPromises()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-inbox"]')).toBeNull()

    // The superseded answer lands last, inside the debounce window.
    resolveSlow!({ hits: [makeHit({ id: 'inbox', label: 'Inbox skill', href: '/apps/x/skill/inbox' })], query: 'inv' })
    await flushPromises()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-inbox"]')).toBeNull()

    await settleSearch()
    // …and the current query's own (empty) answer is what renders.
    expect(document.body.querySelector('[data-testid="palette-empty"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('keeps the settled rows when an edit leaves the needle unchanged', async () => {
    // The other half of invalidating on the keystroke: a trailing space is an
    // edit to the box but not to the query, so the rows answering it must
    // survive rather than blanking for 200 ms of nothing.
    searchMock.mockResolvedValueOnce({ hits: [makeHit({ id: 'invoice', label: 'Invoice skill' })], query: 'inv' })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('inv')
    await settleSearch()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).not.toBeNull()

    await typeQuery('inv ')
    await nextTick()
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-invoice"]')).not.toBeNull()

    // Still one request: the trimmed needle never changed.
    await settleSearch()
    expect(searchMock).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('parks the selection on the first activatable row when row 0 is inert', async () => {
    // A leading null-href hit used to leave the selection on an unopenable
    // row until the operator pressed an arrow key, so nothing rendered as
    // selected and Enter was a dead keystroke.
    searchMock.mockResolvedValueOnce({
      query: 'invoice',
      hits: [
        makeHit({ id: 'orphan', label: 'Orphan skill', href: null }),
        makeHit({ id: 'invoice', label: 'Invoice skill', href: '/apps/x/skill/invoice' }),
      ],
    })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('invoice')
    await settleSearch()

    const selected = Array.from(document.body.querySelectorAll('[data-testid^="palette-item-"]'))
      .filter((el) => el.getAttribute('aria-selected') === 'true')
      .map((el) => el.getAttribute('data-testid'))
    expect(selected).toEqual(['palette-item-hit-skill-invoice'])
    expect(document.body.querySelector('[data-testid="palette-item-hit-skill-orphan"]')?.getAttribute('aria-selected')).toBe('false')

    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith('/apps/x/skill/invoice')

    wrapper.unmount()
  })

  it('explains an all-inert server section instead of leaving ↑/↓ inert', async () => {
    searchMock.mockResolvedValueOnce({
      query: 'invoice',
      hits: [
        makeHit({ id: 'orphan', label: 'Orphan skill', href: null }),
        makeHit({ id: 'other', label: 'Other skill', href: null }),
      ],
    })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('invoice')
    await settleSearch()

    // No row can be selected, so nothing claims to be — and the section says
    // why rather than looking like a broken keyboard.
    expect(document.body.querySelector('[aria-selected="true"]')).toBeNull()
    const hint = document.body.querySelector('[data-testid="palette-section-hits-skill-inert"]')
    expect(hint?.textContent).toContain('Nothing here can be opened')

    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      await nextTick()
    }
    expect(pushMock).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="palette-section-hits-skill-inert"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('a failing search with no local match never claims there are no matches', async () => {
    searchMock.mockRejectedValueOnce(new Error('500'))

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('zzzzzz')
    await settleSearch()

    // A 500 proves nothing about what matches, so the verdict must not render…
    const empty = document.body.querySelector('[data-testid="palette-empty"]')
    expect(empty).toBeNull()
    expect(document.body.textContent).not.toContain('No matches')
    // …and the palette says what it does know instead.
    const failed = document.body.querySelector('[data-testid="palette-search-failed"]')
    expect(failed?.textContent?.trim()).toBe('Search is unavailable')

    wrapper.unmount()
  })

  it('a failing search with a local match still renders the local rows, not the notice', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 })]
    searchMock.mockRejectedValueOnce(new Error('500'))

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('Eng')
    await settleSearch()

    expect(document.body.querySelector('[data-testid="palette-section-groups"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-search-failed"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-empty"]')).toBeNull()

    wrapper.unmount()
  })

  it('a later successful query clears the failed-search notice', async () => {
    searchMock.mockRejectedValueOnce(new Error('500'))
    searchMock.mockResolvedValueOnce({ hits: [], query: 'invoic' })

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('zzzzzz')
    await settleSearch()
    expect(document.body.querySelector('[data-testid="palette-search-failed"]')).not.toBeNull()

    await typeQuery('invoic')
    await settleSearch()

    expect(document.body.querySelector('[data-testid="palette-search-failed"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-empty"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('a failing search contributes nothing without breaking the local sections', async () => {
    userRef.value = { id: 99 }
    principalsRef.value = [makePrincipal({ id: 10, type: 'group', name: 'Engineering', group_id: 1 })]
    searchMock.mockRejectedValueOnce(new Error('500'))

    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()
    await typeQuery('Eng')
    await settleSearch()

    // The local section the query matches still renders; ⌘K stays usable.
    expect(document.body.querySelector('[data-testid="palette-section-groups"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="palette-section-hits-skill"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="palette-empty"]')).toBeNull()

    wrapper.unmount()
  })

  it('the input placeholder advertises the server-side results', async () => {
    const wrapper = mountPalette()
    isOpenRef.value = true
    await nextTick()
    await flushPromises()

    const input = document.body.querySelector('input[aria-label="Search"]') as HTMLInputElement
    expect(input.getAttribute('placeholder')).toContain('skills')

    wrapper.unmount()
  })
})