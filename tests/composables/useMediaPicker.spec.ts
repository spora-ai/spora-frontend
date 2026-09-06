/**
 * useMediaPicker — verifies the imperative mount resolves correctly
 * across attach/cancel paths. Mocks `MediaPickerOverlay` so we don't
 * depend on the full picker stack (modal, search, pagination, upload)
 * — those are covered in `MediaPickerOverlay.spec.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

const overlayStub = vi.hoisted(() => ({
  api: {} as { calls: Array<{ event: string; payload: unknown }> },
  install(): void {
    this.api = { calls: [] }
  },
  reset(): void {
    this.api = { calls: [] }
  },
}))

vi.mock('@/components/MediaPickerOverlay.vue', () => ({
  default: defineComponent({
    name: 'MediaPickerOverlayStub',
    props: ['modelValue', 'agentId', 'agentPrincipalId', 'mediaKind', 'accept', 'title'],
    emits: ['update:modelValue', 'attach'],
    setup(props, { emit }) {
      return () =>
        h('div', { 'data-testid': 'media-picker-stub' }, [
          h('button', {
            'data-testid': 'picker-attach-one',
            onClick: () => emit('attach', [{ id: 'a', filename: 'one.png', media_type: 'image', mime_type: 'image/png', byte_size: 1, asset_url: '/u1', has_markdown: false }]),
          }),
          h('button', {
            'data-testid': 'picker-attach-two',
            onClick: () => emit('attach', [{ id: 'b', filename: 'two.png', media_type: 'image', mime_type: 'image/png', byte_size: 2, asset_url: '/u2', has_markdown: false }]),
          }),
          h('button', {
            'data-testid': 'picker-close',
            onClick: () => emit('update:modelValue', false),
          }),
          h('button', {
            'data-testid': 'picker-record-props',
            onClick: () =>
              overlayStub.api.calls.push({
                event: 'open',
                payload: {
                  modelValue: props.modelValue,
                  agentId: props.agentId,
                  mediaKind: props.mediaKind,
                  title: props.title,
                },
              }),
          }),
        ])
    },
  }),
}))

import { openMediaPicker, openMediaPickerWithHandle } from '@/composables/useMediaPicker'

beforeEach(() => {
  overlayStub.install()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('openMediaPicker', () => {
  it('mounts MediaPickerOverlay into the document body', async () => {
    const promise = openMediaPicker()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="open-media-picker-root"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="media-picker-stub"]')).not.toBeNull()
    // Resolve the promise to clean up before assertions end.
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-close"]')?.click()
    await flushPromises()
    await promise
  })

  it('passes mediaKind and title options through to MediaPickerOverlay', async () => {
    const promise = openMediaPicker({ mediaKind: 'image', title: 'Pick a hero image' })
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-record-props"]')?.click()
    await flushPromises()
    expect(overlayStub.api.calls[0]?.payload).toMatchObject({
      modelValue: true,
      agentId: null,
      mediaKind: 'image',
      title: 'Pick a hero image',
    })
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-close"]')?.click()
    await flushPromises()
    await promise
  })

  it('defaults to mediaKind="image+document" and title="Attach media"', async () => {
    const promise = openMediaPicker()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-record-props"]')?.click()
    await flushPromises()
    expect(overlayStub.api.calls[0]?.payload).toMatchObject({
      mediaKind: 'image+document',
      title: 'Attach media',
    })
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-close"]')?.click()
    await flushPromises()
    await promise
  })

  it('resolves with the attached assets and unmounts the picker', async () => {
    const promise = openMediaPicker()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-attach-one"]')?.click()
    await flushPromises()
    const assets = await promise
    expect(assets).toHaveLength(1)
    expect(assets[0]?.id).toBe('a')
    // Wrapper must have been removed on settle.
    expect(document.body.querySelector('[data-testid="open-media-picker-root"]')).toBeNull()
  })

  it('resolves with [] when the picker emits update:modelValue=false (cancel)', async () => {
    const promise = openMediaPicker()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-close"]')?.click()
    await flushPromises()
    const assets = await promise
    expect(assets).toEqual([])
    expect(document.body.querySelector('[data-testid="open-media-picker-root"]')).toBeNull()
  })

  it('cancel() forces resolution with [] and unmounts the picker', async () => {
    const { promise, cancel } = openMediaPickerWithHandle()
    await flushPromises()
    cancel()
    const assets = await promise
    expect(assets).toEqual([])
    expect(document.body.querySelector('[data-testid="open-media-picker-root"]')).toBeNull()
  })

  it('cancel() is idempotent on an already-resolved picker', async () => {
    const { promise, cancel } = openMediaPickerWithHandle()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="picker-attach-one"]')?.click()
    await flushPromises()
    const first = await promise
    expect(first).toHaveLength(1)
    cancel()
    // Calling cancel after resolve must not throw.
  })

  it('isolates concurrent calls — each owns its own root', async () => {
    const a = openMediaPickerWithHandle({ title: 'A' })
    const b = openMediaPickerWithHandle({ title: 'B' })
    await flushPromises()
    const roots = document.querySelectorAll('[data-testid="open-media-picker-root"]')
    expect(roots).toHaveLength(2)
    a.cancel()
    b.cancel()
    await Promise.all([a.promise, b.promise])
    expect(document.querySelectorAll('[data-testid="open-media-picker-root"]')).toHaveLength(0)
  })
})
