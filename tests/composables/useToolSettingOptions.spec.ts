import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { useToolSettingOptions, type MultiSelectOption } from '@/composables/useToolSettingOptions'

// Mock the api client so we don't hit the network.
const mockApiGet = vi.fn()
vi.mock('@/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

describe('useToolSettingOptions', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
  })

  it('fetches and normalizes the agents endpoint shape (`{id, name}`)', async () => {
    mockApiGet.mockResolvedValueOnce({
      agents: [
        { id: 1, name: 'Legal' },
        { id: 2, name: 'Sales' },
      ],
    })

    const { options, loading, load } = useToolSettingOptions('/agents?select=id,name')
    await load()

    expect(loading.value).toBe(false)
    expect(options.value).toEqual<MultiSelectOption[]>([
      { value: 1, label: 'Legal #1' },
      { value: 2, label: 'Sales #2' },
    ])
    expect(mockApiGet).toHaveBeenCalledWith('/agents?select=id,name')
  })

  it('reads the latest URL from a reactive endpoint on each load', async () => {
    mockApiGet.mockResolvedValue({ options: [] })
    const endpoint = ref('/api/v1/skills?select=name,description')
    const { load } = useToolSettingOptions(endpoint)

    await load()
    endpoint.value = '/agents?select=id,name'
    await load()

    expect(mockApiGet).toHaveBeenNthCalledWith(1, '/api/v1/skills?select=name,description')
    expect(mockApiGet).toHaveBeenNthCalledWith(2, '/agents?select=id,name')
  })

  it('fetches and normalizes the skills endpoint shape (`{name, description}`)', async () => {
    mockApiGet.mockResolvedValueOnce({
      skills: [
        { name: 'git', description: 'Guides the agent through safe git operations.' },
        { name: 'pdf-processing', description: 'Extract PDF text, fill forms, merge files.' },
      ],
    })

    const { options, load } = useToolSettingOptions('/api/v1/skills?select=name,description')
    await load()

    expect(options.value).toEqual<MultiSelectOption[]>([
      {
        value: 'git',
        label: 'git',
        description: 'Guides the agent through safe git operations.',
      },
      {
        value: 'pdf-processing',
        label: 'pdf-processing',
        description: 'Extract PDF text, fill forms, merge files.',
      },
    ])
  })

  it('preserves a top-level array response when the endpoint returns a bare list', async () => {
    mockApiGet.mockResolvedValueOnce([
      { id: 7, name: 'Solo' },
    ])

    const { options, load } = useToolSettingOptions('/api/v1/things')
    await load()

    expect(options.value).toEqual<MultiSelectOption[]>([
      { value: 7, label: 'Solo #7' },
    ])
  })

  it('renders an empty option list when the fetch fails (no unhandled rejection)', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('network down'))

    const { options, loading, error, load } = useToolSettingOptions('/api/v1/skills')
    await load()

    expect(loading.value).toBe(false)
    expect(options.value).toEqual([])
    expect(error.value).toBeInstanceOf(Error)
  })

  it('drops the description when it is an empty string', async () => {
    mockApiGet.mockResolvedValueOnce({
      skills: [
        { name: 'x', description: '' },
        { name: 'y' },
      ],
    })

    const { options, load } = useToolSettingOptions('/api/v1/skills')
    await load()

    expect(options.value).toEqual<MultiSelectOption[]>([
      { value: 'x', label: 'x' },
      { value: 'y', label: 'y' },
    ])
  })

  it('resets loading to false after the request settles', async () => {
    // Resolve on the next tick so the test reliably observes the
    // mid-flight `loading: true` state.
    mockApiGet.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ skills: [] }), 0)),
    )

    const { loading, load } = useToolSettingOptions('/api/v1/skills')
    expect(loading.value).toBe(false)
    const p = load()
    // Let the synchronous `loading.value = true` flush through Vue's
    // reactivity, then await the in-flight request.
    await nextTick()
    expect(loading.value).toBe(true)
    await p
    expect(loading.value).toBe(false)
  })

  it('unwraps `{options: [...]}` response wrappers', async () => {
    mockApiGet.mockResolvedValueOnce({
      options: [
        { name: 'alpha', description: 'first' },
        { name: 'beta', description: 'second' },
      ],
    })

    const { options, load } = useToolSettingOptions('/api/v1/options')
    await load()

    expect(options.value).toEqual<MultiSelectOption[]>([
      { value: 'alpha', label: 'alpha', description: 'first' },
      { value: 'beta', label: 'beta', description: 'second' },
    ])
  })

  it('unwraps `{data: [...]}` response wrappers', async () => {
    mockApiGet.mockResolvedValueOnce({
      data: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
    })

    const { options, load } = useToolSettingOptions('/api/v1/things')
    await load()

    expect(options.value).toEqual<MultiSelectOption[]>([
      { value: 1, label: 'A #1' },
      { value: 2, label: 'B #2' },
    ])
  })

  it('returns an empty list when the response is not an object', async () => {
    mockApiGet.mockResolvedValueOnce('not-an-object')

    const { options, load } = useToolSettingOptions('/api/v1/whatever')
    await load()

    expect(options.value).toEqual([])
  })

  it('returns an empty list when the response shape is unrecognised', async () => {
    mockApiGet.mockResolvedValueOnce({ unexpected: { nested: true } })

    const { options, load } = useToolSettingOptions('/api/v1/whatever')
    await load()

    expect(options.value).toEqual([])
  })
})
