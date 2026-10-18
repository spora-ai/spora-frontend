import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import ApiKeyTable from '@/components/agent/apiKeys/ApiKeyTable.vue'

vi.mock('@/api/agentApiKeys', () => ({
  agentApiKeysApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}))

vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}))

import { agentApiKeysApi } from '@/api/agentApiKeys'

const mockApi = agentApiKeysApi as unknown as {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}
const confirmMock = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

const key = {
  id: 'abc123',
  agent_id: 7,
  name: 'n8n',
  last_used_at: null,
  created_at: '2026-10-01T08:00:00Z',
}

function render() {
  return mount(ApiKeyTable, {
    props: { agentId: 7 },
    global: {
      stubs: {
        Icon: true,
        ApiKeyCreateModal: true,
        ApiKeyRevealModal: true,
      },
    },
  })
}

describe('ApiKeyTable', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockApi.list.mockResolvedValue([key])
  })

  it('lists the agent\'s keys on mount', async () => {
    const wrapper = render()
    await flushPromises()

    expect(mockApi.list).toHaveBeenCalledWith(7)
    expect(wrapper.get(`[data-testid="api-key-row-abc123"]`).text()).toContain('n8n')
  })

  it('says so when there are none', async () => {
    mockApi.list.mockResolvedValue([])
    const wrapper = render()
    await flushPromises()

    expect(wrapper.text()).toContain('No API keys yet')
  })

  it('never renders a secret in the table', async () => {
    mockApi.list.mockResolvedValue([{ ...key, secret: 'spk_leaked' } as never])
    const wrapper = render()
    await flushPromises()

    // Defence in depth: the server never sends one, and if it ever did the
    // list must not put it on screen.
    expect(wrapper.text()).not.toContain('spk_leaked')
  })

  it('shows "Never" for a key that has not been used', async () => {
    const wrapper = render()
    await flushPromises()

    expect(wrapper.text()).toContain('Never')
  })

  it('revokes only after the operator confirms', async () => {
    confirmMock.mockResolvedValue(false)
    mockApi.remove.mockResolvedValue(undefined)

    const wrapper = render()
    await flushPromises()

    await wrapper.get('[data-testid="revoke-api-key-abc123"]').trigger('click')

    expect(mockApi.remove).not.toHaveBeenCalled()
  })

  it('revokes and drops the row once confirmed', async () => {
    confirmMock.mockResolvedValue(true)
    mockApi.remove.mockResolvedValue(undefined)

    const wrapper = render()
    await flushPromises()

    await wrapper.get('[data-testid="revoke-api-key-abc123"]').trigger('click')
    await flushPromises()

    expect(mockApi.remove).toHaveBeenCalledWith(7, 'abc123')
    expect(wrapper.find('[data-testid="api-key-row-abc123"]').exists()).toBe(false)
    expect(toastSuccess).toHaveBeenCalledWith('API key revoked')
  })

  it('surfaces a load failure rather than an empty table', async () => {
    mockApi.list.mockRejectedValue(new Error('boom'))

    const wrapper = render()
    await flushPromises()

    expect(wrapper.get('[data-testid="api-keys-error"]').exists()).toBe(true)
  })
})
