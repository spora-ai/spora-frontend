import { ref, type Ref } from 'vue'
import { mountPlugin, type PluginHostContext } from '@/apps/registry'

/**
 * usePluginApp — owns the lifecycle of a single plugin mount inside the
 * generic `/apps/:appName` route. Callers render a loading spinner while
 * `loading`, an error fallback when `error` is non-null, and the plugin's
 * UI once `mounted` flips to true.
 *
 * The composable is intentionally decoupled from the Pinia apps store so
 * it can be unit-tested with a stubbed `mountPlugin` (see
 * `tests/composables/usePluginApp.spec.ts`).
 */
export interface UsePluginAppReturn {
  loading: Ref<boolean>
  error: Ref<PluginAppError | null>
  mounted: Ref<boolean>
  mount: (target: HTMLElement, slug: string, frontendEntry: string, ctx: PluginHostContext) => Promise<void>
  unmount: () => void
}

/**
 * The error kinds the plugin registry can surface. Kept as a literal-string
 * union so callers (and tests) can match without depending on the registry's
 * internal discriminated-union shape.
 */
export type PluginAppErrorKind = 'not_found' | 'invalid' | 'uninstalled' | 'load_failed'

export interface PluginAppError {
  kind: PluginAppErrorKind
  message: string
}

/**
 * Options for `usePluginApp`. `mountImpl` lets tests substitute a stub
 * for `mountPlugin` so they don't have to mock the global `window` /
 * dynamic `import()`.
 */
export interface UsePluginAppOptions {
  /** Override for the registry call. Defaults to the real `mountPlugin`. */
  mountImpl?: typeof mountPlugin
}

export function usePluginApp(options: UsePluginAppOptions = {}): UsePluginAppReturn {
  const loading = ref(false)
  const error = ref<PluginAppError | null>(null)
  const mounted = ref(false)
  const targetRef = ref<HTMLElement | null>(null)
  const instanceRef = ref<{ unmount: () => void } | null>(null)

  async function mount(
    target: HTMLElement,
    slug: string,
    frontendEntry: string,
    ctx: PluginHostContext,
  ): Promise<void> {
    if (mounted.value && instanceRef.value) {
      // Tear down the previous instance so its slot is empty before the
      // next plugin writes into it.
      instanceRef.value.unmount()
      mounted.value = false
      instanceRef.value = null
    }
    targetRef.value = target
    loading.value = true
    error.value = null
    const mountFn = options.mountImpl ?? mountPlugin
    const result = await mountFn(target, slug, frontendEntry, ctx)
    loading.value = false
    if (result.ok) {
      instanceRef.value = result.instance
      mounted.value = true
      return
    }
    error.value = { kind: result.error, message: result.message }
  }

  function unmount(): void {
    if (instanceRef.value) {
      instanceRef.value.unmount()
      instanceRef.value = null
      mounted.value = false
    }
    targetRef.value = null
  }

  return { loading, error, mounted, mount, unmount }
}
