/**
 * Imperative wrapper around `MediaPickerOverlay` so plugin SPAs (which
 * can't reach the host's component tree) can open the same picker the
 * prompt composer uses. Mounts a fresh Vue app at body level and
 * resolves with the selected assets, or `[]` on cancel.
 *
 * Returns a Promise plus a `cancel()` for callers that need to abort
 * (e.g. on route change). The contract is encoded as a single object so
 * the cancel handle stays attached to the same picker instance.
 */
import { createApp, defineComponent, h } from 'vue'
import MediaPickerOverlay from '@/components/MediaPickerOverlay.vue'
import type { MediaAsset } from '@/types/media'

export interface MediaPickerOptions {
  /** Allow multi-select. Default `false`. */
  multi?: boolean
  /** Filter the listing by media kind. Default `'image+document'`. */
  mediaKind?: 'image' | 'image+document'
  /** Override the modal title. Default `'Attach media'`. */
  title?: string
}

export interface MediaPickerHandle {
  /** Resolves with the attached assets, or `[]` when closed without selection. */
  promise: Promise<MediaAsset[]>
  /** Force-close and resolve `[]`. Idempotent. */
  cancel: () => void
}

export function openMediaPicker(options: MediaPickerOptions = {}): Promise<MediaAsset[]> {
  const handle = openMediaPickerWithHandle(options)
  return handle.promise
}

/**
 * Lower-level entry point that exposes the `cancel()` handle alongside
 * the promise. Plugin callers can ignore the handle and just await the
 * returned promise from `openMediaPicker`; host-side callers that need
 * to abort a picker (e.g. on route change) use this form.
 */
export function openMediaPickerWithHandle(options: MediaPickerOptions = {}): MediaPickerHandle {
  // Non-DOM environments (SSR, unit tests outside happy-dom) can't
  // mount a modal; surface as a no-op so callers don't have to
  // special-case the test environment.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    let resolve!: (assets: MediaAsset[]) => void
    const promise = new Promise<MediaAsset[]>((res) => { resolve = res })
    queueMicrotask(() => resolve([]))
    return { promise, cancel: () => resolve([]) }
  }

  const root = document.createElement('div')
  root.dataset.testid = 'open-media-picker-root'
  document.body.appendChild(root)

  let resolve!: (assets: MediaAsset[]) => void
  let settled = false
  const promise = new Promise<MediaAsset[]>((res) => { resolve = res })
  let app: ReturnType<typeof createApp> | null = null

  function settle(assets: MediaAsset[]): void {
    if (settled) return
    settled = true
    if (app !== null) {
      try { app.unmount() } catch { /* may already be unmounted */ }
      app = null
    }
    if (root.parentNode !== null) root.parentNode.removeChild(root)
    resolve(assets)
  }

  // Fresh app per call: reusing one would carry stale selection,
  // debounce timers, and pagination state into the next session.
  // The wrapper owns the `modelValue` flag — without a parent to bind
  // `v-model` to, the picker would open and immediately try to close.
  const Wrapper = defineComponent({
    name: 'OpenMediaPickerWrapper',
    data(): { open: boolean } { return { open: true } },
    methods: {
      onUpdate(value: boolean): void {
        if (value === false) { settle([]); return }
        this.open = value
      },
      onAttach(assets: MediaAsset[]): void {
        settle(assets)
      },
    },
    render(): unknown {
      return h(MediaPickerOverlay, {
        modelValue: this.open,
        // Pass `null` (not `undefined`) so plugin callers are explicit
        // about the absence of an agent context. The component treats
        // both equivalently via its `agentId: number | null` typing.
        agentId: null,
        'onUpdate:modelValue': (value: boolean) => this.onUpdate(value),
        onAttach: (assets: MediaAsset[]) => this.onAttach(assets),
        mediaKind: options.mediaKind ?? 'image+document',
        title: options.title ?? 'Attach media',
      })
    },
  })

  app = createApp(Wrapper)
  app.mount(root)

  return { promise, cancel: () => settle([]) }
}
