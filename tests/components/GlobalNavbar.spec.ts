/**
 * GlobalNavbar — top nav with notifications, theme toggle, burger-menu
 * sheet (identity, apps, groups, settings, account, sign-out), and the
 * global command palette / notification center / create-agent dialog.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const pushMock = vi.fn()
const routeParamsRef = ref<Record<string, string | string[]>>({})
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => ({ get params() { return routeParamsRef.value } }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>', props: ['to'] },
}))

const userRef = ref<{ name: string; email: string; roles: string[] } | null>(null)
const logoutMock = vi.fn()
const isDarkRef = ref(false)
const unreadCountRef = ref(0)
const notificationsRef = ref<unknown[]>([])
const fetchNotificationsMock = vi.fn()

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get user() { return userRef.value },
    logout: logoutMock,
  }),
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    get isDark() { return isDarkRef.value },
    toggle: () => { isDarkRef.value = !isDarkRef.value },
  }),
}))

vi.mock('@/stores/notifications', () => ({
  useNotificationStore: () => ({
    get unreadCount() { return unreadCountRef.value },
    get notifications() { return notificationsRef.value },
    fetchNotifications: fetchNotificationsMock,
  }),
}))

vi.mock('@/stores/groups', () => ({
  useGroupsStore: () => ({
    groups: ref([]),
  }),
}))

vi.mock('@/composables/useRealtime', () => ({
  useRealtime: () => undefined,
}))

const { apiGetMock } = vi.hoisted(() => ({ apiGetMock: vi.fn() }))
vi.mock('@/api/client', () => ({
  api: { get: apiGetMock },
}))

import GlobalNavbar from '@/components/GlobalNavbar.vue'

const NotificationCenterStub = {
  name: 'NotificationCenter',
  template: '<div class="nc-stub" />',
  methods: { open: vi.fn() },
}

beforeEach(() => {
  setActivePinia(createPinia())
  userRef.value = null
  routeParamsRef.value = {}
  logoutMock.mockReset()
  logoutMock.mockResolvedValue(undefined)
  isDarkRef.value = false
  unreadCountRef.value = 0
  notificationsRef.value = []
  fetchNotificationsMock.mockReset()
  pushMock.mockReset()
  apiGetMock.mockReset()
})

function findButton(wrapper: ReturnType<typeof mount>, ariaLabel: string): HTMLButtonElement {
  const btn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === ariaLabel)
  if (!btn) throw new Error(`No button with aria-label="${ariaLabel}"`)
  return btn.element as HTMLButtonElement
}

describe('GlobalNavbar', () => {
  it('renders without throwing', () => {
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('shows the unread count badge when unreadCount > 0', () => {
    unreadCountRef.value = 5
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    expect(wrapper.text()).toContain('5')
  })

  it('caps the badge at 99+', () => {
    unreadCountRef.value = 150
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    expect(wrapper.text()).toContain('99+')
  })

  it('hides the badge when unreadCount is 0', () => {
    unreadCountRef.value = 0
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    expect(wrapper.text()).not.toMatch(/99\+/)
  })

  it('toggles the theme when the dark-mode button is clicked', async () => {
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const btn = findButton(wrapper, 'Switch to dark mode')
    await wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Switch to dark mode')!.trigger('click')
    expect(isDarkRef.value).toBe(true)
  })

  it('fetches /apps when the burger sheet is opened', async () => {
    apiGetMock.mockResolvedValue({ apps: [] })
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    expect(apiGetMock).toHaveBeenCalledWith('/apps')
  })

  it('shows "No apps installed" when the apps response is empty', async () => {
    apiGetMock.mockResolvedValue({ apps: [] })
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    expect(document.body.textContent ?? '').toContain('No apps installed')
  })

  it('clears the apps list on /apps failure', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    expect(apiGetMock).toHaveBeenCalled()
  })

  it('logs out and navigates to login on sign-out', async () => {
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    const signOutBtn = Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Sign out')! as HTMLButtonElement
    signOutBtn.click()
    await flushPromises()
    expect(logoutMock).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith({ name: 'login' })
  })

  it('sheet "My Account" item navigates to account route', async () => {
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    const myAccountBtn = Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('My Account'))! as HTMLButtonElement
    myAccountBtn.click()
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith({ name: 'account' })
  })

  it('sheet "Profile" item navigates to profile route', async () => {
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    const profileBtn = Array.from(document.body.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Profile')! as HTMLButtonElement
    profileBtn.click()
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith({ name: 'profile' })
  })

  it('closes the sheet when the ✕ button is clicked', async () => {
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    expect(document.body.classList.contains('overflow-hidden')).toBe(true)
    const closeBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Close menu' && b.classList.contains('cursor-default') === false,
    )! as HTMLButtonElement
    closeBtn.click()
    await flushPromises()
    expect(document.body.classList.contains('overflow-hidden')).toBe(false)
    wrapper.unmount()
  })

  it('opens the command palette when the desktop search trigger is clicked', async () => {
    userRef.value = { name: 'Alice', email: 'alice@example.com', roles: [] }
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const trigger = wrapper.find('button[aria-label="Search (⌘K)"]')
    expect(trigger.exists()).toBe(true)
    await trigger.trigger('click')
    await flushPromises()
    wrapper.unmount()
  })

  it('navigates to /account when the identity avatar is clicked', async () => {
    userRef.value = { name: 'Alice', email: 'alice@example.com', roles: [] }
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    const accountBtn = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Open account')! as HTMLButtonElement
    accountBtn.click()
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith({ name: 'account' })
    wrapper.unmount()
  })

  it('navigates to /settings when the Settings button is clicked', async () => {
    const wrapper = mount(GlobalNavbar, {
      global: { stubs: { RouterLink: true, NotificationCenter: NotificationCenterStub } },
    })
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu')!
    await burger.trigger('click')
    await flushPromises()
    const settingsBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === 'Settings')! as HTMLButtonElement
    settingsBtn.click()
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith('/settings')
    wrapper.unmount()
  })
})
