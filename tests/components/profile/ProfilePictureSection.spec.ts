/**
 * ProfilePictureSection — subject-agnostic avatar / image picker used
 * by both `AgentProfilePictureSection` and the group overview modal.
 *
 * Mounts the section with the same baseline picture used by the agent
 * tests; the test exercises both the agent and group subject labels
 * to assert the section picks up the right title / helper subline.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const commitMock = vi.fn()
const uploadMock = vi.fn()
const removeMock = vi.fn()

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

import ProfilePictureSection from '@/components/profile/ProfilePictureSection.vue'
import { ARCHETYPES } from '@/lib/archetypeSvgs'

const basePicture = {
  kind: 'avatar',
  archetype: 'assistant',
  variant_key: 'v0',
  palette_key: 'slate',
  fg_color: '#ffffff',
  bg_color: '#475569',
  image_url: null,
  image_updated_at: null,
}

beforeEach(() => {
  commitMock.mockReset()
  uploadMock.mockReset()
  removeMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  commitMock.mockResolvedValue(undefined)
  uploadMock.mockResolvedValue(undefined)
  removeMock.mockResolvedValue(undefined)
})

function mountSection(subject: 'agent' | 'group', overrides: Record<string, unknown> = {}) {
  return mount(ProfilePictureSection, {
    props: {
      subject,
      initials: subject === 'agent' ? 'A' : 'G',
      profilePicture: { ...basePicture, ...overrides },
      commit: commitMock,
      upload: uploadMock,
      remove: removeMock,
    },
  })
}

describe('ProfilePictureSection', () => {
  it('renders all 12 archetype buttons (8 agent + 4 group)', () => {
    const wrapper = mountSection('agent')
    const archetypeButtons = wrapper.findAll('[data-testid="archetype-grid"] [data-testid^="archetype-"]')
    expect(archetypeButtons).toHaveLength(ARCHETYPES.length)
    expect(ARCHETYPES).toContain('collaborative')
    expect(ARCHETYPES).toContain('ensemble')
    expect(ARCHETYPES).toContain('project')
    expect(ARCHETYPES).toContain('community')
  })

  it('renders the agent section title for subject=agent', () => {
    const wrapper = mountSection('agent')
    expect(wrapper.text()).toContain('Profile Picture')
    expect(wrapper.text()).not.toContain('Group Picture')
  })

  it('renders the group section title for subject=group', () => {
    const wrapper = mountSection('group')
    expect(wrapper.text()).toContain('Group Picture')
    expect(wrapper.text()).not.toContain('Profile Picture')
  })

  it('commits an archetype change through the supplied callback', async () => {
    const wrapper = mountSection('agent')
    await wrapper.find('[data-testid="archetype-researcher"]').trigger('click')
    await flushPromises()
    expect(commitMock).toHaveBeenCalledWith({ archetype: 'researcher' })
  })

  it('commits a palette change through the supplied callback', async () => {
    const wrapper = mountSection('group')
    await wrapper.find('[data-testid="palette-violet"]').trigger('click')
    await flushPromises()
    expect(commitMock).toHaveBeenCalledWith({ palette_key: 'violet' })
  })

  it('cycles the variant through v0 → v1 → v2 → v0', async () => {
    const wrapper = mountSection('agent')

    async function cycleAndCommit(): Promise<void> {
      const previous = commitMock.mock.calls.length
      await wrapper.find('[data-testid="variant-cycle"]').trigger('click')
      await flushPromises()
      expect(commitMock.mock.calls.length).toBe(previous + 1)
      const patch = commitMock.mock.calls.at(-1)?.[0] as { variant_key?: string }
      expect(patch.variant_key).toMatch(/^v[0-2]$/)
      wrapper.setProps({
        profilePicture: { ...basePicture, variant_key: patch.variant_key },
      })
      await flushPromises()
    }

    expect(wrapper.find('[data-testid="variant-cycle"]').text()).toContain('v0')
    await cycleAndCommit()
    expect(wrapper.find('[data-testid="variant-cycle"]').text()).toContain('v1')
    await cycleAndCommit()
    expect(wrapper.find('[data-testid="variant-cycle"]').text()).toContain('v2')
    await cycleAndCommit()
    expect(wrapper.find('[data-testid="variant-cycle"]').text()).toContain('v0')
  })

  it('uploads a pending file and surfaces a subject-specific success toast', async () => {
    const wrapper = mountSection('group')
    await wrapper.find('[data-testid="tab-image"]').trigger('click')
    const file = new File(['fake'], 'group.png', { type: 'image/png' })
    const fileInput = wrapper.find('[data-testid="picture-file"]')
    Object.defineProperty(fileInput.element, 'files', { value: [file] })
    await fileInput.trigger('change')

    await wrapper.find('[data-testid="upload-image"]').trigger('click')
    await flushPromises()
    expect(uploadMock).toHaveBeenCalledWith(file)
    expect(toastSuccess).toHaveBeenCalledWith('Group Picture updated.')
  })

  it('removes the uploaded image and reverts to the archetype', async () => {
    const wrapper = mountSection('group', {
      kind: 'image',
      archetype: null,
      variant_key: null,
      palette_key: null,
      fg_color: null,
      bg_color: null,
      image_url: '/media/x.png',
      image_updated_at: '2026-01-02T03:04:05+00:00',
    })
    await wrapper.find('[data-testid="tab-image"]').trigger('click')
    await wrapper.find('[data-testid="remove-image"]').trigger('click')
    await flushPromises()
    expect(removeMock).toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('Picture reverted to avatar.')
  })
})
