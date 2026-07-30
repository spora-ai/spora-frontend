/**
 * AgentProfilePictureSection — avatar tab (archetype / variant / palette
 * selection) and image tab (upload / remove) flows.
 *
 * Mounts the section with a baseline agent, stubs the store methods,
 * and asserts the PATCH/POST/DELETE plumbing plus the immediate-save
 * UX (no separate Save button).
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const updateProfilePictureMock = vi.fn()
const uploadProfilePictureImageMock = vi.fn()
const deleteProfilePictureImageMock = vi.fn()

vi.mock('@/stores/agent', () => ({
  useAgentStore: () => ({
    updateProfilePicture: updateProfilePictureMock,
    uploadProfilePictureImage: uploadProfilePictureImageMock,
    deleteProfilePictureImage: deleteProfilePictureImageMock,
  }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

import AgentProfilePictureSection from '@/components/agent/settings/AgentProfilePictureSection.vue'
import { ARCHETYPES } from '@/lib/archetypeSvgs'

const baseAgent = {
  id: 1,
  name: 'Test Agent',
  description: 'desc',
  system_prompt: 'be helpful',
  max_steps: 10,
  tools: [],
  profile_picture: {
    kind: 'avatar',
    archetype: 'assistant',
    variant_key: 'v0',
    palette_key: 'slate',
    fg_color: '#ffffff',
    bg_color: '#475569',
    image_url: null,
    image_updated_at: null,
  },
}

beforeEach(() => {
  updateProfilePictureMock.mockReset()
  uploadProfilePictureImageMock.mockReset()
  deleteProfilePictureImageMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  // Default: PATCH resolves to the agent with the saved picture echoed back.
  updateProfilePictureMock.mockImplementation(async (id, patch) => ({
    ...baseAgent,
    id,
    profile_picture: { ...baseAgent.profile_picture, ...patch },
  }))
  uploadProfilePictureImageMock.mockResolvedValue({
    ...baseAgent,
    profile_picture: {
      kind: 'image',
      archetype: null,
      variant_key: null,
      palette_key: null,
      fg_color: null,
      bg_color: null,
      image_url: '/media/abc/picture.png',
      image_updated_at: '2026-01-02T03:04:05+00:00',
    },
  })
  deleteProfilePictureImageMock.mockResolvedValue({
    ...baseAgent,
    profile_picture: { ...baseAgent.profile_picture, kind: 'avatar' },
  })
})

function mountSection(overrides: Record<string, unknown> = {}) {
  return mount(AgentProfilePictureSection, {
    props: { agent: { ...baseAgent, ...overrides }, agentId: 1 },
  })
}

describe('AgentProfilePictureSection', () => {
  it('shows the avatar tab by default and renders all 8 archetype buttons', () => {
    const wrapper = mountSection()
    expect(wrapper.find('[data-testid="panel-avatar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="panel-image"]').exists()).toBe(false)
    // Use the explicit grid testid to count only the buttons (not the
    // surrounding `archetype-grid` wrapper itself).
    const archetypeButtons = wrapper.findAll('[data-testid="archetype-grid"] [data-testid^="archetype-"]')
    expect(archetypeButtons).toHaveLength(ARCHETYPES.length)
    for (const a of ARCHETYPES) {
      expect(wrapper.find(`[data-testid="archetype-${a}"]`).exists()).toBe(true)
    }
  })

  it('switches to the image tab when Image is clicked', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-testid="tab-image"]').trigger('click')
    expect(wrapper.find('[data-testid="panel-image"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="panel-avatar"]').exists()).toBe(false)
  })

  it('clicking an archetype commits the change via updateProfilePicture', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-testid="archetype-researcher"]').trigger('click')
    await flushPromises()
    expect(updateProfilePictureMock).toHaveBeenCalledWith(1, { archetype: 'researcher' })
  })

  it('clicking a palette commits the change via updateProfilePicture', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-testid="palette-blue"]').trigger('click')
    await flushPromises()
    expect(updateProfilePictureMock).toHaveBeenCalledWith(1, { palette_key: 'blue' })
  })

  it('cycling the variant advances v0 -> v1 -> v2 -> v0', async () => {
    const wrapper = mountSection()
    const cycle = () => wrapper.find('[data-testid="variant-cycle"]')

    // Helper: simulate the parent re-rendering the agent prop after the
    // store updated `currentAgent` (the production flow).
    async function clickAndSync(): Promise<void> {
      const previous = updateProfilePictureMock.mock.calls.length
      await cycle().trigger('click')
      await flushPromises()
      expect(updateProfilePictureMock.mock.calls.length).toBe(previous + 1)
      const patch = updateProfilePictureMock.mock.calls.at(-1)?.[1] as { variant_key?: string }
      wrapper.setProps({
        agent: {
          ...baseAgent,
          profile_picture: { ...baseAgent.profile_picture, variant_key: patch.variant_key ?? 'v0' },
        },
      })
      await flushPromises()
    }

    expect(cycle().text()).toContain('v0')
    await clickAndSync()
    expect(cycle().text()).toContain('v1')
    await clickAndSync()
    expect(cycle().text()).toContain('v2')
    await clickAndSync()
    expect(cycle().text()).toContain('v0')
  })

  it('surfaces an error toast + inline error on PATCH failure', async () => {
    const { ApiError } = await import('@/api/client')
    // Real ApiError signature is (message, code, status) — the second
    // argument is the code, not the human-readable message.
    updateProfilePictureMock.mockRejectedValueOnce(new ApiError('bad type', 'PROFILE_PICTURE_TYPE', 422))
    const wrapper = mountSection()
    await wrapper.find('[data-testid="palette-red"]').trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('bad type')
    expect(wrapper.find('[data-testid="picture-error"]').text()).toBe('bad type')
  })

  it('uploads a pending file and clears it on success', async () => {
    const wrapper = mountSection()
    await wrapper.find('[data-testid="tab-image"]').trigger('click')
    const file = new File(['fake-png-bytes'], 'picture.png', { type: 'image/png' })
    const fileInput = wrapper.find('[data-testid="picture-file"]')
    Object.defineProperty(fileInput.element, 'files', { value: [file] })
    await fileInput.trigger('change')
    expect(wrapper.find('[data-testid="pending-file-name"]').text()).toBe('picture.png')

    await wrapper.find('[data-testid="upload-image"]').trigger('click')
    await flushPromises()
    expect(uploadProfilePictureImageMock).toHaveBeenCalledWith(1, file)
    expect(toastSuccess).toHaveBeenCalledWith('Profile picture updated.')
    expect(wrapper.find('[data-testid="pending-file-name"]').exists()).toBe(false)
  })

  it('opens directly on the image tab when the agent already has an image configured', async () => {
    // After a page reload, the persisted `profile_picture.kind` is the
    // source of truth for the active tab — if the agent has an image,
    // the operator should land on the Image tab without having to click.
    const wrapper = mountSection({
      profile_picture: {
        kind: 'image',
        archetype: null,
        variant_key: null,
        palette_key: null,
        fg_color: null,
        bg_color: null,
        image_url: '/media/abc/picture.png',
        image_updated_at: '2026-01-02T03:04:05+00:00',
      },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="panel-image"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="panel-avatar"]').exists()).toBe(false)
  })

  it('removes the uploaded image and reverts to the archetype', async () => {
    const wrapper = mountSection({
      profile_picture: {
        kind: 'image',
        archetype: null,
        variant_key: null,
        palette_key: null,
        fg_color: null,
        bg_color: null,
        image_url: '/media/abc/picture.png',
        image_updated_at: '2026-01-02T03:04:05+00:00',
      },
    })
    await wrapper.find('[data-testid="tab-image"]').trigger('click')
    await wrapper.find('[data-testid="remove-image"]').trigger('click')
    await flushPromises()
    expect(deleteProfilePictureImageMock).toHaveBeenCalledWith(1)
    expect(toastSuccess).toHaveBeenCalledWith('Picture reverted to avatar.')
  })

  it('renders the picker preview with the palette fg_color, not white', async () => {
    // The pre-API preview tile mirrors the server-resolved fg_color so
    // operators see what the actual avatar will look like. Slate's fg is
    // #F8FAFC, not #fff — picking it should set the inline `color` style
    // on the inner swatch (not bg, which is `#475569`).
    const wrapper = mountSection()
    await flushPromises()
    const swatch = wrapper.find('[data-testid="archetype-assistant"] > span')
    const style = swatch.attributes('style') ?? ''
    expect(style).toContain('background-color: #475569')
    expect(style).toContain('color: #F8FAFC')
    expect(style).not.toContain('color: #fff')
  })

  it('updates the picker preview fg_color when the palette changes', async () => {
    // After picking violet, the preview swatch's `color` should switch
    // from slate's #F8FAFC to violet's #F5F3FF — the operator sees
    // exactly what the avatar tile will render.
    const wrapper = mountSection()
    await wrapper.find('[data-testid="palette-violet"]').trigger('click')
    await flushPromises()
    // The store mock echoes back the patched palette so the wrapper
    // re-renders with violet applied.
    wrapper.setProps({
      agent: {
        ...baseAgent,
        profile_picture: { ...baseAgent.profile_picture, palette_key: 'violet' },
      },
    })
    await flushPromises()
    const swatch = wrapper.find('[data-testid="archetype-assistant"] > span')
    const style = swatch.attributes('style') ?? ''
    expect(style).toContain('background-color: #6D28D9')
    expect(style).toContain('color: #F5F3FF')
  })

  it('groups archetype and palette buttons inside accessible fieldsets', () => {
    // SonarCloud S6853 fires on orphan `<label>` elements — the
    // archetype/palette heads are group labels for their respective
    // button grids, so they live inside <fieldset>/<legend> instead of
    // a free-floating <label>. The legend text is still rendered, and
    // the fieldset is aria-labelledby itself for SR announcement.
    const wrapper = mountSection()
    const archetypeGroup = wrapper.find('[data-testid="archetype-grid"]')
    expect(archetypeGroup.exists()).toBe(true)
    const archetypeFieldset = archetypeGroup.element.closest('fieldset')
    expect(archetypeFieldset).not.toBeNull()
    expect(archetypeFieldset?.querySelector('legend')?.textContent).toBe('Archetype')

    const paletteGroup = wrapper.find('[data-testid="palette-grid"]')
    expect(paletteGroup.exists()).toBe(true)
    const paletteFieldset = paletteGroup.element.closest('fieldset')
    expect(paletteFieldset).not.toBeNull()
    expect(paletteFieldset?.querySelector('legend')?.textContent).toBe('Palette')
  })
})
