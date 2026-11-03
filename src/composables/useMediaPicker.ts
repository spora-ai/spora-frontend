/**
 * Imperative wrapper around `MediaPickerOverlay` so plugin SPAs (which can't
 * reach the host's component tree) can open the same picker the prompt
 * composer uses. Mounts a fresh Vue app at body level and resolves with the
 * selected assets, or `[]` on cancel.
 *
 * Returns a Promise plus a `cancel()` for callers that need to abort (e.g. on
 * route change). The contract is encoded as a single object so the cancel
 * handle stays attached to the same picker instance.
 */
import { createApp, defineComponent, h, watch } from 'vue'
import MediaPickerOverlay from '@/components/MediaPickerOverlay.vue'
import { createAppI18n, i18n } from '@/i18n'
import type { MediaAsset } from '@/types/media'

export interface MediaPickerOptions {
  /** Allow multi-select. Default `true`. */
  multi?: boolean
  /** Filter the listing by media kind. Default `'image+document'`. */
  mediaKind?: 'image' | 'image+document'
  /** Override the modal title. Default: the overlay's own translated title. */
  title?: string
  /**
   * The principal the listing is scoped to.
   *
   * The overlay filters by `?principal_id=<id>` when it is given one and
   * falls back to `?ownership=mine` when it is not, so a plugin that works
   * for one principal has to say which. A filter would not be enough: the
   * foreign asset's filename would still be on screen.
   */
  principalId?: number
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
 * Lower-level entry point that exposes the `cancel()` handle alongside the
 * promise. Plugin callers can ignore the handle and just await the returned
 * promise from `openMediaPicker`; host-side callers that need to abort a
 * picker (e.g. on route change) use this form.
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

  // The picker's own i18n instance — see the note where it is installed.
  const pickerI18n = createAppI18n(i18n.global.locale.value)

  function settle(assets: MediaAsset[]): void {
    if (settled) return
    settled = true
    if (app !== null) {
      try { app.unmount() } catch { /* may already be unmounted */ }
      app = null
    }
    root.remove()
    resolve(assets)
  }

  // Fresh app per call: reusing one would carry stale selection, debounce
  // timers, and pagination state into the next session. The wrapper owns the
  // `modelValue` flag — without a parent to bind `v-model` to, the picker
  // would open and immediately try to close.
  const Wrapper = defineComponent({
    name: 'OpenMediaPickerWrapper',
    data(): { open: boolean } { return { open: true } },
    setup() {
      // The picker follows the host's language. A snapshot would leave the
      // modal in the language it was opened in while the page around it
      // moved on — and the host's own context is a live getter for the same
      // reason.
      //
      // The watcher belongs to this component's scope, so it stops when the
      // picker unmounts, which it does on every close.
      watch(
        () => i18n.global.locale.value,
        (next) => { pickerI18n.global.locale.value = next },
      )
    },
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
        // `null` and not `undefined`, for the same reason as `agentId`: the
        // overlay reads the absence of a principal as "fall back to the
        // legacy ownership filter".
        agentPrincipalId: options.principalId ?? null,
        'onUpdate:modelValue': (value: boolean) => this.onUpdate(value),
        onAttach: (assets: MediaAsset[]) => this.onAttach(assets),
        mediaKind: options.mediaKind ?? 'image+document',
        title: options.title,
        multi: options.multi ?? true,
      })
    },
  })

  app = createApp(Wrapper)
  // The picker is a fresh app and inherits none of the host's plugins, and
  // the overlay reads its own copy through `useI18n()` — which throws
  // "Need to install with app.use" without an i18n instance on the app.
  //
  // A fresh instance rather than the host's: vue-i18n disposes the instance
  // it was installed on when its app unmounts, and the picker unmounts every
  // time it closes — which would take the host's own translations with it.
  app.use(pickerI18n)
  app.mount(root)

  return { promise, cancel: () => settle([]) }
}
