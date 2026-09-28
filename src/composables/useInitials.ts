/**
 * Multi-word-aware two-letter initials.
 *
 * The implementation now lives in `@spora-ai/components`; this module
 * is a thin re-export so host call sites keep a stable import path.
 *
 * Signature change: the helper takes a raw name string (the package
 * generalises it away from the `User` object the host used to pass),
 * and its terminal fallback is `'?'`. Callers that need a fallback of
 * their own — the host's identity surfaces used to fall back to the
 * user's email — resolve name-or-email before calling it.
 *
 * Usage:
 *   const initials = useInitials(() => agent.name)
 *   // → ComputedRef<string>
 */
export { useInitials } from '@spora-ai/components/composables'
