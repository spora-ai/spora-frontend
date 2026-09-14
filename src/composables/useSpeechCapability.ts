/**
 * useSpeechCapability — global speech-to-text capability gate.
 *
 * The recording button in `ComposerInput` and `TaskChatFollowup` only
 * renders when `canRecord === true`. That derivation reads from a
 * module-level cache backed by `GET /api/v1/speech/capability`, so the
 * UI doesn't have to re-probe on every composer mount.
 *
 * The capability is a **global** view (one configured provider wins
 * everywhere) — per-agent override is out of scope for v1. See
 * `spora-workspace/plans/speech-input-plugin.md` §1 Decision #3.
 *
 * Cache invalidation strategy:
 *   - Initial fetch happens lazily on the first `refresh()` call (the
 *     composer mounts the button behind `v-if="canRecord"`, so the
 *     network round-trip only fires when the operator lands on an
 *     eligible page).
 *   - Subsequent `refresh()` calls refetch unconditionally — the page
 *     uses this after the operator saves plugin settings.
 *   - Tests call `resetSpeechCapability()` to clear the module state.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ApiError, getSpeechCapability } from '@/api/client'
import type { SpeechCapability, SpeechProviderSource } from '@/types/speech'

export interface UseSpeechCapability {
  state: Ref<SpeechCapability>
  canRecord: ComputedRef<boolean>
  /** Resolved provider class for the calling principal (FQCN). Null when nothing configured. */
  effectiveClass: ComputedRef<string | null>
  /** Which cascade tier supplied `effectiveClass`. See {@link SpeechProviderSource}. */
  effectiveSource: ComputedRef<SpeechProviderSource>
  loading: Ref<boolean>
  error: Ref<string | null>
  refresh(): Promise<void>
}

const EMPTY: SpeechCapability = {
  available: false,
  configured: false,
  providers: [],
}

export function useSpeechCapability(): UseSpeechCapability {
  const state = ref<SpeechCapability>({ ...EMPTY })
  const loading = ref(false)
  const error = ref<string | null>(null)

  const canRecord = computed(() => state.value?.available === true && state.value?.configured === true)

  // The backend's `describe()` emits the same `effective_class` /
  // `effective_source` pair on every row of `providers[]` (the resolved
  // class is per-principal, not per-provider). The first row is enough.
  const effectiveClass = computed<string | null>(
    () => state.value.providers[0]?.effective_class ?? null,
  )
  const effectiveSource = computed<SpeechProviderSource>(
    () => state.value.providers[0]?.effective_source ?? null,
  )

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // `api.get<T>` already unwraps the `{ data: ... }` envelope, so
      // the typed return is the inner `SpeechCapability` payload — not
      // a wrapper. `getSpeechCapability()`'s return type encodes this.
      const response = await getSpeechCapability()
      state.value = response ?? { ...EMPTY }
    } catch (e) {
      // 404 / 401 / network failure → capability stays empty. The
      // recording button simply won't render. Surfacing the message
      // here would only matter if the operator navigates to a place
      // that shows the underlying failure; today nothing does, so we
      // silence it. If that changes, expose `error` to the consumer.
      state.value = { ...EMPTY }
      error.value = e instanceof ApiError ? e.message : null
    } finally {
      loading.value = false
    }
  }

  return {
    state,
    canRecord,
    effectiveClass,
    effectiveSource,
    loading,
    error,
    refresh,
  }
}

/**
 * Reset the module state — currently a no-op since state lives inside
 * each composable instance, but exposed for tests and a future
 * `window.__sporaDebug` hook so operators can force a re-probe after
 * toggling a plugin on/off.
 */
export function resetSpeechCapability(): void {
  // Intentionally empty — see docblock.
}
