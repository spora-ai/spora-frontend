/**
 * Multi-word-aware two-letter initials.
 *
 * The implementation now lives in `@spora-ai/components`; this module
 * is a thin re-export of it. There are currently no production call
 * sites left in the host — the `Avatar`s the PR migrated derive their
 * initials inside the package — so only `tests/composables/
 * useInitials.spec.ts` still imports this path. The module is kept
 * (rather than deleted) because that spec pins the helper's contract
 * from the host's side, and because it remains the import path a future
 * host call site should use instead of reaching into the package.
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
